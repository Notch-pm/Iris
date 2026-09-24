-- ============================================================================
-- Sollicitation d'un intervenant : « Ce qui est attendu » devient FACULTATIF
-- (demande PO 2026-09-24).
--
-- Un commentaire absent est NULL, jamais une chaîne blanche : la contrainte
-- garde « null ou non blanc », et la RPC normalise (`nullif(btrim(...))`),
-- comme `complete_request_intervention` le fait déjà pour `completion_comment`.
-- ============================================================================

alter table public.request_interventions
  alter column request_comment drop not null;
alter table public.request_interventions
  drop constraint request_interventions_request_comment_check;
alter table public.request_interventions
  add constraint request_interventions_request_comment_check
  check (request_comment is null or btrim(request_comment) <> '');

create or replace function public.request_intervention(
  p_request_id uuid, p_intervenant_id uuid, p_requested_for date, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  r         public.requests%rowtype;
  v_id      uuid;
  -- Facultatif (2026-09-24) : absent = NULL, jamais une chaîne blanche.
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select * into r from public.requests where id = p_request_id;
  if not found then
    raise exception 'Demande introuvable.';
  end if;

  if not public.request_right_for(v_uid, r.organization_id, r.socle_organization_id,
                                  r.socle_procedure_id, 'instruction') then
    raise exception 'Solliciter un intervenant exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  if r.status <> 'en_instruction' then
    raise exception 'Une intervention ne se sollicite que sur une demande en cours d''instruction.';
  end if;

  if p_intervenant_id is null then
    raise exception 'Sollicitation : intervenant obligatoire.';
  end if;
  if not public.is_intervenant_for(p_intervenant_id, r.organization_id, r.socle_scope_org_id) then
    raise exception 'Cette personne n''est pas intervenant sur l''organisme de la demande.';
  end if;

  if p_requested_for is null then
    raise exception 'Sollicitation : date d''intervention demandée obligatoire.';
  end if;
  if p_requested_for < public.paris_today() then
    raise exception 'La date d''intervention demandée ne peut pas être passée.';
  end if;

  if exists (select 1 from public.request_interventions i
              where i.request_id = p_request_id
                and i.intervenant_id = p_intervenant_id
                and i.status = 'demandee') then
    raise exception 'Cet intervenant a déjà une intervention en attente sur cette demande.';
  end if;

  insert into public.request_interventions
    (organization_id, request_id, intervenant_id, requested_by, requested_for, request_comment)
  values (r.organization_id, p_request_id, p_intervenant_id, v_uid, p_requested_for, v_comment)
  returning id into v_id;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (r.organization_id, p_request_id, 'intervention_requested',
          jsonb_build_object(
            'intervention_id', v_id,
            'intervenant', p_intervenant_id,
            'intervenant_name', public.user_display_name(p_intervenant_id),
            'requested_for', p_requested_for),
          v_uid);

  -- L'e-mail demandé : gabarit agent, boîte d'envoi drainée par le cron.
  -- Le commentaire, s'il y en a un, y figure : il est écrit POUR
  -- l'intervenant, c'est la consigne. Le demandeur, lui, n'y figure pas
  -- (règle commune des e-mails).
  perform public.push_notification(
    p_intervenant_id, v_uid, r.organization_id, p_request_id, 'intervention_requested',
    r.reference, r.subject,
    jsonb_build_object(
      'status', r.status,
      'procedure', r.socle_procedure_label,
      'destinataire', r.socle_organization_label,
      'intervention_id', v_id,
      'requested_for', p_requested_for,
      'comment', v_comment));

  return jsonb_build_object('id', v_id);
end;
$$;
comment on function public.request_intervention(uuid, uuid, date, text) is
  'Sollicite un intervenant sur une demande EN COURS D''INSTRUCTION (garde serveur). Exige l''instruction sur le couple ; « ce qui est attendu » facultatif. Journalise (intervention_requested) et notifie l''intervenant (volet + e-mail). Unique porte d''écriture avec complete_request_intervention.';
revoke execute on function public.request_intervention(uuid, uuid, date, text) from public, anon;
grant  execute on function public.request_intervention(uuid, uuid, date, text) to authenticated;
