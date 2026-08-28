-- ============================================================================
-- Depuis la fiche d'instruction : ajouter une pièce, et modifier les réponses
-- au formulaire de la démarche (décisions PO, 2026-08-28).
--
-- 1. AJOUTER UNE PIÈCE sur une exigence non conforme ou manquante.
--    **La plus récente fait foi** (décision PO) : la pièce ajoutée REMPLACE
--    celles déjà déposées pour la même exigence. Elles ne sont pas supprimées —
--    une pièce est un élément du dossier administratif — mais marquées
--    `superseded_by` et sorties du calcul de conformité.
--    ⚠️ Conséquence assumée, signalée au PO avant décision : sur le motif « la
--    pièce est incomplète », la page manquante ne s'AJOUTE pas, elle remplace.
--    L'écran l'annonce avant l'envoi (« remplacera les N pièces déjà
--    déposées ») ; le jour où le besoin se précise, seule change la LISTE des
--    lignes que la RPC marque — la colonne, elle, tient déjà les deux régimes.
--
-- 2. MODIFIER LES RÉPONSES du formulaire (`requests.form_data`). Aucune
--    nouvelle garde : `requests_guard_write` exige déjà le droit d'INSTRUCTION
--    pour toucher `form_data`, et `requests_protect_immutable` gèle une demande
--    archivée. Ce qui manquait, c'est la TRACE : une réponse corrigée après
--    coup doit se lire dans le journal.
--    ⚠️ Le `procedure_snapshot` reste FIGÉ : on édite les réponses au
--    formulaire retenu au dépôt, jamais la définition de la démarche — elle
--    vit dans le Socle, et Iris ne la redéfinit pas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La pièce remplacée
-- ----------------------------------------------------------------------------

alter table public.request_attachments
  add column if not exists superseded_by uuid references public.request_attachments(id) on delete set null,
  add column if not exists superseded_at timestamptz;

alter table public.request_attachments drop constraint if exists request_attachments_superseded_coherent;
alter table public.request_attachments add constraint request_attachments_superseded_coherent
  check ((superseded_by is null) = (superseded_at is null));

-- Une pièce ne se remplace pas elle-même.
alter table public.request_attachments drop constraint if exists request_attachments_superseded_not_self;
alter table public.request_attachments add constraint request_attachments_superseded_not_self
  check (superseded_by is distinct from id);

create index if not exists request_attachments_active_idx
  on public.request_attachments (request_id, form_field_key)
  where superseded_by is null and email_id is null;

comment on column public.request_attachments.superseded_by is
  'Pièce qui a remplacé celle-ci (décision PO 2026-08-28 : « la plus récente fait foi »). Non-NULL = hors du calcul de conformité, mais TOUJOURS au dossier : une pièce administrative ne se supprime pas. Posée par la seule RPC attach_request_piece.';

-- ----------------------------------------------------------------------------
-- 2. Le calcul de blocage ignore les pièces remplacées
--    (sinon une pièce corrigée ne débloquerait jamais rien : l'ancienne,
--    non conforme, continuerait de compter.)
-- ----------------------------------------------------------------------------
create or replace function public.request_pieces_blocking(
  p_request_id  uuid,
  p_form_schema jsonb,
  p_form_data   jsonb
) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.label order by r.ord), '{}'::text[])
    from (
      select req.label,
             row_number() over () as ord,
             (select count(*) from public.request_attachments a
               where a.request_id = p_request_id
                 and a.email_id is null
                 and a.superseded_by is null
                 and a.form_field_key = req.field_key) as total,
             (select count(*) from public.request_attachments a
               where a.request_id = p_request_id
                 and a.email_id is null
                 and a.superseded_by is null
                 and a.form_field_key = req.field_key
                 and a.compliance = 'conforme') as conformes
        from public.form_attachment_requirements(p_form_schema, p_form_data) req
       where req.required
    ) r
   where r.total = 0 or r.conformes < r.total;
$$;
revoke execute on function public.request_pieces_blocking(uuid, jsonb, jsonb) from public, anon, authenticated;

comment on function public.request_pieces_blocking(uuid, jsonb, jsonb) is
  'Libellés des exigences de pièces OBLIGATOIRES non satisfaites (manquante, pas encore qualifiée, ou non conforme). Ignore les pièces remplacées (superseded_by) et les pièces d''échange sortant. Vide = « Résoudre positivement » est ouvert. Jumeau de blockingRequirements() (conformite.ts).';

-- ----------------------------------------------------------------------------
-- 3. attach_request_piece — l'unique porte d'ajout depuis la fiche
--
-- Pourquoi une RPC alors que `request_attachments_insert` autorise déjà le
-- client : l'ajout et le remplacement doivent être ATOMIQUES, et le journal
-- avec. Un INSERT client suivi d'un UPDATE client laisserait, sur coupure, une
-- pièce neuve à côté d'une ancienne toujours active — c'est-à-dire une exigence
-- bloquée que personne ne comprendrait.
--
-- ⚠️ Même piège DEFINER que qualify_request_attachment : `is_service_context()`
-- y vaut toujours vrai, donc le droit d'INSTRUCTION est vérifié ICI.
-- ----------------------------------------------------------------------------
create or replace function public.attach_request_piece(
  p_request_id     uuid,
  p_storage_path   text,
  p_file_name      text,
  p_mime_type      text default null,
  p_file_size      bigint default null,
  p_form_field_key text default null,
  p_replaces_id    uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_req      public.requests%rowtype;
  v_uid      uuid := auth.uid();
  v_key      text := nullif(btrim(coalesce(p_form_field_key, '')), '');
  v_name     text := btrim(coalesce(p_file_name, ''));
  v_path     text := btrim(coalesce(p_storage_path, ''));
  v_prefix   text;
  v_id       uuid;
  v_replaced int := 0;
begin
  if v_uid is null then
    raise exception 'Ajout de pièce : authentification requise.';
  end if;
  if v_name = '' then
    raise exception 'Ajout de pièce : le nom du fichier est obligatoire.';
  end if;

  select * into v_req from public.requests r where r.id = p_request_id;
  if not found then
    raise exception 'Ajout de pièce : demande introuvable.';
  end if;
  if v_req.status in ('annulee', 'resolue_positive', 'resolue_negative', 'archivee') then
    raise exception 'Ajout de pièce : la demande est close (%).', v_req.status;
  end if;

  if not (public.is_platform_admin() or public.user_has_request_right(
            v_uid, v_req.organization_id, v_req.socle_organization_id,
            v_req.socle_procedure_id, 'instruction')) then
    raise exception 'Ajouter une pièce exige le droit d''instruction sur cette démarche pour ce service.';
  end if;

  -- Le chemin porte le RLS storage (1er et 2e segments) : il ne peut pas
  -- désigner une autre demande, ni un autre tenant.
  v_prefix := v_req.organization_id::text || '/' || v_req.id::text || '/';
  if position(v_prefix in v_path) <> 1 then
    raise exception 'Ajout de pièce : chemin de stockage hors de la demande.';
  end if;

  insert into public.request_attachments (
    organization_id, request_id, storage_path, file_name, mime_type, file_size,
    form_field_key, copy_status, uploaded_by
  ) values (
    v_req.organization_id, v_req.id, v_path, v_name,
    nullif(btrim(coalesce(p_mime_type, '')), ''), p_file_size,
    v_key, 'copied', v_uid
  )
  returning id into v_id;

  -- « La plus récente fait foi » : tout ce qui était actif pour cette exigence
  -- passe en remplacé. Sans clé de formulaire (pièce hors formulaire), on ne
  -- remplace que la ligne explicitement désignée — il n'y a pas d'exigence à
  -- laquelle rattacher un groupe.
  if v_key is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.request_id = v_req.id
       and a.form_field_key = v_key
       and a.email_id is null
       and a.superseded_by is null
       and a.id <> v_id;
    get diagnostics v_replaced = row_count;
  elsif p_replaces_id is not null then
    update public.request_attachments a
       set superseded_by = v_id, superseded_at = now()
     where a.id = p_replaces_id
       and a.request_id = v_req.id
       and a.email_id is null
       and a.superseded_by is null;
    get diagnostics v_replaced = row_count;
  end if;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (v_req.organization_id, v_req.id, 'piece_ajoutee',
          jsonb_build_object(
            'attachment_id',  v_id,
            'file_name',      v_name,
            'form_field_key', v_key,
            'remplacees',     v_replaced),
          v_uid);

  return jsonb_build_object(
    'attachment_id', v_id,
    'request_id',    v_req.id,
    'remplacees',    v_replaced);
end;
$$;
revoke execute on function public.attach_request_piece(uuid, text, text, text, bigint, text, uuid)
  from public, anon;
grant execute on function public.attach_request_piece(uuid, text, text, text, bigint, text, uuid)
  to authenticated;

comment on function public.attach_request_piece(uuid, text, text, text, bigint, text, uuid) is
  'Ajoute une pièce à une demande depuis la fiche d''instruction, et REMPLACE les pièces déjà actives de la même exigence (décision PO 2026-08-28 : « la plus récente fait foi »). Ajout + remplacement + journal en une transaction. Exige le droit d''instruction, vérifié ICI (piège DEFINER / is_service_context).';

-- ----------------------------------------------------------------------------
-- 4. Journal des réponses modifiées
--
-- ⚠️ CREATE OR REPLACE re-accorde EXECUTE à PUBLIC : la révocation est
-- REJOUÉE juste après (piège vécu chez Clara, règle du CLAUDE.md racine).
--
-- Le payload ne porte que les CLÉS touchées, jamais les valeurs : une réponse
-- de formulaire peut contenir des données personnelles, et le journal est
-- immuable — on n'y écrit pas ce qu'une purge devrait plus tard effacer.
-- ----------------------------------------------------------------------------
create or replace function public.requests_log_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
begin
  if new.status is distinct from old.status then
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'motif', new.closure_motif, 'version', new.version),
            auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.request_assignments (organization_id, request_id, assigned_to, assigned_by)
    values (new.organization_id, new.id, new.assigned_to, auth.uid());
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'assigned',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), auth.uid());
  end if;
  if new.form_data is distinct from old.form_data then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_keys
      from jsonb_object_keys(
             coalesce(old.form_data, '{}'::jsonb) || coalesce(new.form_data, '{}'::jsonb)) as k
     where (coalesce(old.form_data, '{}'::jsonb) -> k)
           is distinct from (coalesce(new.form_data, '{}'::jsonb) -> k);
    insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (new.organization_id, new.id, 'form_data_updated',
            jsonb_build_object('keys', to_jsonb(v_keys),
                               'count', coalesce(array_length(v_keys, 1), 0)),
            auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_log_update() from public, anon, authenticated;
