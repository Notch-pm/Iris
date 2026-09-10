-- ============================================================================
-- Interventions — JUSTIFICATIFS de l'intervenant (demande PO du 2026-09-14,
-- second lot) : en déclarant son intervention réalisée, l'intervenant joint
-- jusqu'à QUATRE fichiers (documents, ou photos prises à l'instant avec la
-- caméra de son appareil).
--
-- Ce que ce lot pose, et pourquoi :
--
--   1. Une QUATRIÈME nature sur `request_attachments.kind` : `intervention`,
--      rattachée à sa sollicitation par `intervention_id`. Même table que les
--      autres natures (une table parallèle dupliquerait policies, purge RGPD
--      et lecture) — et donc mêmes règles : lecture par `can_read_request`
--      (l'intervenant relit ce qu'il a déposé), URL signée sur le même bucket.
--      Ces pièces ne sont PAS des pièces de l'usager : l'écran les retire du
--      groupement par exigence et de la conformité (`t17` ne regarde que les
--      exigences du formulaire, elles n'y entrent pas).
--
--   2. Le fichier entre par la PORTE UNIQUE (`request-attachments`, invariant
--      du 2026-09-08 : signature binaire, taille, sha256, zone d'attente),
--      avec une portée de plus dans l'URL — `intervention_id` — ouverte à
--      l'INTERVENANT SOLLICITÉ, tant que l'intervention est à réaliser, sans
--      droit d'instruction et même si la demande a été close entre-temps :
--      c'est SA déclaration, elle ne dépend pas du sort du dossier.
--
--   3. `complete_request_intervention` reçoit les `upload_id` et les CONSOMME
--      dans sa transaction (`consume_attachment_upload` : tenant, déposant =
--      l'intervenant, portée = la demande, expiration, objet sous la demande).
--      Quatre au plus — la règle est ICI, pas seulement à l'écran. Tout ou
--      rien : une pièce refusée annule la déclaration, l'intervenant recommence.
--
-- ⚠️ Signature changée : l'ancienne fonction à trois arguments est SUPPRIMÉE
-- (la garder à côté d'une v4 à défaut rendrait l'appel à trois arguments
-- ambigu). Le front se déploie avec cette migration.
-- ============================================================================

alter table public.request_attachments drop constraint if exists request_attachments_kind_check;
alter table public.request_attachments add constraint request_attachments_kind_check
  check (kind in ('demande', 'instruction_interne', 'instruction_externe', 'courrier', 'intervention'));

alter table public.request_attachments
  add column if not exists intervention_id uuid references public.request_interventions(id) on delete set null;
comment on column public.request_attachments.intervention_id is
  'Justificatif d''intervention (kind = intervention) : la sollicitation qu''il documente. Déposé par l''intervenant via complete_request_intervention.';
create index if not exists request_attachments_intervention_idx
  on public.request_attachments (intervention_id) where intervention_id is not null;

/** Plafond de justificatifs par intervention (décision PO 2026-09-14). */
create or replace function public.intervention_max_attachments()
returns int language sql immutable set search_path = '' as $$ select 4 $$;
revoke execute on function public.intervention_max_attachments() from public, anon;
grant  execute on function public.intervention_max_attachments() to authenticated;

drop function if exists public.complete_request_intervention(uuid, date, text);

create or replace function public.complete_request_intervention(
  p_intervention_id uuid, p_completed_on date, p_comment text,
  p_upload_ids uuid[] default '{}'::uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  i         public.request_interventions%rowtype;
  r         public.requests%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_name    text;
  v_ids     uuid[];
  v_up_id   uuid;
  v_up      public.attachment_uploads%rowtype;
  v_att     uuid;
  v_n       int := 0;
  v_extra   jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into i from public.request_interventions where id = p_intervention_id;
  if not found then
    raise exception 'Intervention introuvable.';
  end if;
  if i.intervenant_id <> v_uid and not public.is_platform_admin() then
    raise exception 'Seul l''intervenant sollicité peut déclarer cette intervention réalisée.';
  end if;
  if i.status <> 'demandee' then
    raise exception 'Cette intervention est déjà déclarée réalisée.';
  end if;

  if p_completed_on is null then
    raise exception 'Date de finalisation obligatoire.';
  end if;
  if p_completed_on > public.paris_today() then
    raise exception 'La date de finalisation ne peut pas être future.';
  end if;

  -- Dédoublonnés, bornés — la règle des quatre vit ici.
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_upload_ids, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) > public.intervention_max_attachments() then
    raise exception 'Au plus % justificatifs par intervention.', public.intervention_max_attachments();
  end if;

  select * into r from public.requests where id = i.request_id;
  v_name := public.user_display_name(i.intervenant_id);

  update public.request_interventions
     set status = 'realisee', completed_at = now(),
         completed_on = p_completed_on, completion_comment = v_comment
   where id = p_intervention_id;

  -- Les justificatifs : reçus par la porte unique POUR cette demande, PAR cet
  -- intervenant — consume_attachment_upload le vérifie, tout le reste (chemin,
  -- nom, type, taille, empreinte) est relu en base.
  foreach v_up_id in array v_ids loop
    v_up := public.consume_attachment_upload(v_up_id, r.organization_id, r.id, v_uid, null);
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      checksum, copy_status, uploaded_by, kind, intervention_id
    ) values (
      r.organization_id, r.id, v_up.storage_path, v_up.file_name, v_up.mime_type,
      v_up.file_size, v_up.checksum, 'copied', v_uid, 'intervention', i.id
    ) returning id into v_att;
    update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
    v_n := v_n + 1;
  end loop;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, r.id, 'intervention_completed',
          jsonb_build_object(
            'intervention_id', i.id,
            'intervenant', i.intervenant_id,
            'intervenant_name', v_name,
            'completed_on', p_completed_on,
            'attachments', v_n),
          v_uid);

  v_extra := jsonb_build_object(
    'status', r.status,
    'procedure', r.socle_procedure_label,
    'destinataire', r.socle_organization_label,
    'intervention_id', i.id,
    'intervenant_name', v_name,
    'completed_on', p_completed_on,
    'comment', v_comment,
    'attachments', v_n);

  -- À qui a sollicité, et à l'affectataire si c'est quelqu'un d'autre.
  perform public.push_notification(
    i.requested_by, v_uid, r.organization_id, r.id, 'intervention_completed',
    r.reference, r.subject, v_extra);
  if r.assigned_to is distinct from i.requested_by then
    perform public.push_notification(
      r.assigned_to, v_uid, r.organization_id, r.id, 'intervention_completed',
      r.reference, r.subject, v_extra);
  end if;

  return jsonb_build_object('id', i.id, 'completed_on', p_completed_on, 'attachments', v_n);
end;
$$;
comment on function public.complete_request_intervention(uuid, date, text, uuid[]) is
  'L''intervenant sollicité déclare son intervention réalisée (date de finalisation, commentaire facultatif, jusqu''à 4 justificatifs reçus par request-attachments — consommés ici, kind = intervention). Journalise (intervention_completed) et notifie l''agent qui a sollicité et l''affectataire.';
revoke execute on function public.complete_request_intervention(uuid, date, text, uuid[]) from public, anon;
grant  execute on function public.complete_request_intervention(uuid, date, text, uuid[]) to authenticated;
