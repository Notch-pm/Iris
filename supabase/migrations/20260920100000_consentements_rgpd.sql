-- ---------------------------------------------------------------------------
-- Consentements RGPD au dépôt (2026-09-20)
--
-- Deux questions posées SYSTÉMATIQUEMENT à l'usager, quelle que soit la
-- démarche — jamais des champs de `form_schema` (un consentement qu'un service
-- pourrait décocher dans son paramétrage ne vaudrait rien) :
--   • traitement — obligatoire pour valider le dépôt ;
--   • partage aux services de l'organisme principal — facultatif, proposé coché.
-- Catalogue FERMÉ, côté code : `supabase/functions/_shared/consents/catalog.ts`.
--
-- Le référentiel (Socle, `contact_consents`) est le propriétaire du
-- consentement d'une PERSONNE. Ce qui est consigné ici, c'est le consentement
-- de CE DÉPÔT : ce que l'usager a lu et accepté ce jour-là, pour ce dossier.
-- Les deux sont nécessaires et ne disent pas la même chose —
--   • un dépôt ANONYME, ou une identité non rapprochée, n'a aucune fiche au
--     référentiel : sans cette colonne la preuve n'existerait nulle part ;
--   • un consentement retiré plus tard au référentiel ne doit pas réécrire ce
--     qui a été accepté au dépôt.
-- D'où l'IMMUABILITÉ, ajoutée à `requests_protect_immutable` : `consents` est
-- une pièce du dossier, au même titre que `requester_snapshot`. Un retrait se
-- consigne au référentiel, jamais en réécrivant un dépôt.
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. La trace du dépôt
-- ----------------------------------------------------------------------------

alter table public.requests
  add column if not exists consents jsonb not null default '[]'::jsonb;

comment on column public.requests.consents is
  'Consentements RGPD recueillis AU DÉPÔT : [{kind, granted, statement}] — la phrase exacte soumise, pas seulement le booléen. Immuable (t10). Catalogue fermé : _shared/consents/catalog.ts.';

-- `coalesce(jsonb_typeof(...), '')` et non `jsonb_typeof(...) = 'array'` :
-- sur un NULL, `jsonb_typeof` rend NULL, le CHECK vaut NULL, et un CHECK NULL
-- PASSE. La colonne est `not null`, mais une garde qui dépend d'une autre
-- garde n'en est pas une (leçon des jumeaux SQL, 2026-08).
alter table public.requests
  drop constraint if exists requests_consents_array;
alter table public.requests
  add constraint requests_consents_array
  check (coalesce(jsonb_typeof(consents), '') = 'array');

-- ----------------------------------------------------------------------------
-- 2. Immuabilité — `consents` rejoint `requester_snapshot`
--
--    ⚠️ CREATE OR REPLACE re-accorde EXECUTE à PUBLIC : re-révoquer dans la
--    MÊME migration (piège vécu chez Clara).
-- ----------------------------------------------------------------------------

create or replace function public.requests_protect_immutable()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_service           boolean := public.is_service_context();
  v_only_scope_refresh boolean;
begin
  if new.id                is distinct from old.id
     or new.reference         is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq  is distinct from old.reference_seq
     or new.organization_id   is distinct from old.organization_id
     or new.socle_root_org_id is distinct from old.socle_root_org_id
     or new.source          is distinct from old.source
     or new.external_ref    is distinct from old.external_ref
     or new.received_at     is distinct from old.received_at
     or new.created_at      is distinct from old.created_at
     or new.requester_snapshot is distinct from old.requester_snapshot
     or new.consents        is distinct from old.consents then
    raise exception 'Colonne immuable : id, reference, organization_id, socle_root_org_id, source, external_ref, received_at, created_at, requester_snapshot et consents ne changent jamais.';
  end if;

  if old.status = 'archivee' then
    v_only_scope_refresh :=
      v_service
      and new.status = 'archivee'
      and new.subject           is not distinct from old.subject
      and new.body              is not distinct from old.body
      and new.form_data         is not distinct from old.form_data
      and new.procedure_snapshot is not distinct from old.procedure_snapshot
      and new.closure_motif     is not distinct from old.closure_motif
      and new.closure_text      is not distinct from old.closure_text
      and new.assigned_to       is not distinct from old.assigned_to
      and new.priority          is not distinct from old.priority
      and new.socle_organization_id is not distinct from old.socle_organization_id
      and new.socle_procedure_id    is not distinct from old.socle_procedure_id
      and new.socle_contact_id      is not distinct from old.socle_contact_id
      and (new.socle_scope_org_id is distinct from old.socle_scope_org_id
           or new.anomalies is distinct from old.anomalies);

    if new.status = 'archivee' and not v_only_scope_refresh then
      raise exception 'Demande archivée : aucune modification possible (désarchiver d''abord).';
    end if;
    if new.status <> 'archivee'
       and (new.subject       is distinct from old.subject
         or new.body       is distinct from old.body
         or new.form_data  is distinct from old.form_data
         or new.procedure_snapshot is distinct from old.procedure_snapshot
         or new.closure_motif is distinct from old.closure_motif
         or new.closure_text  is distinct from old.closure_text
         or new.assigned_to   is distinct from old.assigned_to
         or new.priority      is distinct from old.priority
         or new.anomalies     is distinct from old.anomalies
         or new.socle_organization_id is distinct from old.socle_organization_id
         or new.socle_procedure_id    is distinct from old.socle_procedure_id
         or new.socle_contact_id      is distinct from old.socle_contact_id) then
      raise exception 'Désarchivage : seul le statut peut changer.';
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.requests_protect_immutable() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. La RPC de création consigne les consentements du dépôt
--
--    Le libellé n'est PAS composé ici : il arrive déjà écrit de l'edge
--    function, qui l'a recomposé depuis le catalogue et le nom de l'organisme
--    principal relu en base. Le navigateur, lui, n'envoie que `kind` et
--    `granted` (cf. `_shared/consents/catalog.ts`, `normalizeConsents`).
-- ----------------------------------------------------------------------------

create or replace function public.create_request_from_procedure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id   uuid;
  v_ref  text;
  a      jsonb;
  v_up   public.attachment_uploads%rowtype;
  v_att  uuid;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p ->> 'agent_id', 'role', 'authenticated')::text, true);

  insert into public.requests (
    id, organization_id,
    reference, reference_year, reference_seq, socle_root_org_id,
    subject, body, priority, channel,
    socle_organization_id, socle_organization_label,
    socle_procedure_id, socle_contact_id,
    procedure_snapshot, requester_snapshot, identity_status, form_data,
    anomalies, consents
  ) values (
    (p ->> 'request_id')::uuid,
    (p ->> 'organization_id')::uuid,
    'en-attente', 0, 0, (p ->> 'organization_id')::uuid,
    p ->> 'subject',
    nullif(p ->> 'body', ''),
    coalesce(p ->> 'priority', 'normale'),
    nullif(p ->> 'channel', ''),
    nullif(p ->> 'socle_organization_id', '')::uuid,
    nullif(p ->> 'socle_organization_label', ''),
    (p ->> 'socle_procedure_id')::uuid,
    nullif(p ->> 'socle_contact_id', '')::uuid,
    p -> 'procedure_snapshot',
    p -> 'requester_snapshot',
    coalesce(p ->> 'identity_status', 'non_rapprochee'),
    coalesce(p -> 'form_data', '{}'::jsonb),
    coalesce(p -> 'anomalies', '[]'::jsonb),
    coalesce(p -> 'consents', '[]'::jsonb)
  )
  returning id, reference into v_id, v_ref;

  for a in select * from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb)) loop
    v_up := public.consume_attachment_upload(
      (a ->> 'upload_id')::uuid, (p ->> 'organization_id')::uuid, v_id,
      (p ->> 'agent_id')::uuid, null);
    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      checksum, form_field_key, copy_status, uploaded_by, kind
    ) values (
      (p ->> 'organization_id')::uuid, v_id, v_up.storage_path, v_up.file_name, v_up.mime_type,
      v_up.file_size, v_up.checksum, nullif(a ->> 'form_field_key', ''), 'copied',
      (p ->> 'agent_id')::uuid, 'demande'
    ) returning id into v_att;
    update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
  end loop;

  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
  values (
    (p ->> 'organization_id')::uuid,
    v_id,
    'request_created_from_procedure',
    jsonb_build_object(
      'socle_procedure_id', p ->> 'socle_procedure_id',
      'socle_contact_id',   p ->> 'socle_contact_id',
      'audience',           p ->> 'audience',
      'attachments',        jsonb_array_length(coalesce(p -> 'attachments', '[]'::jsonb))
    ),
    (p ->> 'agent_id')::uuid
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$function$;

revoke execute on function public.create_request_from_procedure(jsonb)
  from public, anon, authenticated;
