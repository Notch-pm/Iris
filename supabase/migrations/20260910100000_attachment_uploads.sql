-- ============================================================================
-- Zone d'attente des pièces jointes — `attachment_uploads` (lot 1 du chantier
-- « documents joints aux demandes », 2026-09-08).
--
-- POURQUOI. Jusqu'ici, un octet entrait dans le bucket `request-attachments`
-- par CINQ chemins : le navigateur (guichet, ajout de pièce, e-mail — écriture
-- directe sous une policy storage), l'ingestion partenaire (qui n'écrivait
-- RIEN : elle enregistrait une `fetch_url` qu'aucun worker n'a jamais lue) et
-- la génération de documents. Aucun de ces chemins ne vérifiait le TYPE RÉEL du
-- fichier, et rien ne liait un objet à sa ligne autrement que par convention
-- de chemin.
--
-- DÉSORMAIS, TOUT OCTET ENTRE PAR LE SERVEUR (edge functions), qui le vérifie
-- (taille, signature binaire contre une allowlist fermée, extension cohérente,
-- sha256) et l'inscrit ICI avant qu'il n'appartienne à une demande. Cette table
-- est la VÉRITÉ de tout fichier reçu et pas encore rattaché :
--
--   · portée ORGANISATION (`scope_request_id` null — la demande n'existe pas
--     encore : guichet, dépôt partenaire) : l'objet est écrit sous
--     `{org}/_staging/{upload_id}`. Le deuxième segment n'est pas un UUID, donc
--     `uuid_or_null` y rend NULL et AUCUNE policy storage cliente ne le voit.
--     À la consommation, l'edge function DÉPLACE l'objet sous
--     `{org}/{request_id}/…` (opération de métadonnées) PUIS appelle la RPC ;
--   · portée DEMANDE (`scope_request_id` posé — ajout de pièce, pièce jointe
--     d'un e-mail : la demande existe et le droit d'instruction a été vérifié à
--     la réception) : l'objet est écrit directement sous la demande. Sans ligne
--     `request_attachments`, il reste invisible à l'écran et part à la purge.
--
-- CONSOMMATION = UNE SEULE FONCTION, `consume_attachment_upload`, appelée par
-- les RPC métier DANS LEUR TRANSACTION (création guidée, ajout de pièce,
-- échange, ingestion). Elle verrouille la ligne et refuse tout ce qui n'est
-- pas exactement ce qui a été reçu : autre tenant, autre déposant, autre
-- portée, expiré, déjà consommé, retiré, ou objet pas encore sous la demande.
-- Le client n'envoie JAMAIS un chemin — seulement un `upload_id`.
--
-- ⚠️ `p_actor` et `p_source` sont des PARAMÈTRES, jamais `auth.uid()` : deux
-- des appelants (`create_request_from_procedure`, `ingest_request_attachments`)
-- sont des fonctions DEFINER appelées en service_role, où `auth.uid()` ne dit
-- rien d'utile (piège du 2026-08-22, docs/droits.md).
--
-- CE QU'ON NE FAIT PAS. Pas de policy cliente : la table n'a de sens que pour
-- les edge functions (service_role). Pas de FK vers `request_attachments` :
-- `request_attachment_id` est une trace qui doit survivre à la ligne.
-- Les lignes consommées sont CONSERVÉES (30 jours, purge au lot 4) : c'est par
-- elles que le rejeu idempotent d'un dépôt partenaire retrouve les empreintes
-- de contenu de ses pièces.
-- ============================================================================

create table if not exists public.attachment_uploads (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- Portée : null = organisation (demande pas encore créée), sinon LA demande.
  scope_request_id      uuid references public.requests(id) on delete cascade,
  -- Déposant : une source d'intégration OU un agent — exactement l'un des deux.
  integration_source_id uuid references public.integration_sources(id) on delete cascade,
  uploaded_by           uuid references public.users(id) on delete cascade,
  storage_path          text not null unique,
  file_name             text not null,
  mime_type             text not null,      -- type DÉTECTÉ (signature binaire), jamais déclaré
  file_size             bigint not null check (file_size > 0),
  checksum              text not null,      -- sha256 hexadécimal, calculé à la réception
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  request_attachment_id uuid,               -- trace, sans FK : survit à la ligne
  discarded_at          timestamptz,
  constraint attachment_uploads_one_depositor
    check ((integration_source_id is null) <> (uploaded_by is null)),
  constraint attachment_uploads_path_in_tenant
    check (storage_path like organization_id::text || '/%')
);
comment on table public.attachment_uploads is
  'Zone d''attente des pièces : tout octet reçu par le serveur, vérifié (type réel, sha256) et pas encore rattaché à une demande. Consommation par consume_attachment_upload uniquement. Aucune policy cliente.';
comment on column public.attachment_uploads.scope_request_id is
  'NULL = portée organisation (objet sous {org}/_staging/, demande pas encore créée). Sinon la demande sous laquelle l''objet a été écrit directement.';
comment on column public.attachment_uploads.mime_type is
  'Type DÉTECTÉ par la signature binaire à la réception — jamais celui annoncé par le client.';
comment on column public.attachment_uploads.request_attachment_id is
  'Ligne request_attachments née de cette réception. UUID nu, sans FK : la trace survit à la suppression de la pièce.';

-- Purge des lignes vivantes expirées (lot 4) et relecture par déposant.
create index if not exists attachment_uploads_expiry_idx
  on public.attachment_uploads (expires_at)
  where consumed_at is null and discarded_at is null;
create index if not exists attachment_uploads_consumed_idx
  on public.attachment_uploads (consumed_at)
  where consumed_at is not null;
create index if not exists attachment_uploads_org_idx
  on public.attachment_uploads (organization_id, created_at desc);

alter table public.attachment_uploads enable row level security;
-- Aucune policy cliente, DÉLIBÉRÉMENT : la table n'existe que pour les edge
-- functions. `TO service_role` explicite (piège Clara : sans le TO, la policy
-- s'évalue aussi pour authenticated).
drop policy if exists attachment_uploads_service on public.attachment_uploads;
create policy attachment_uploads_service on public.attachment_uploads
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- consume_attachment_upload — LA porte de consommation. Verrouille, vérifie,
-- marque consommée, rend la ligne. Toute violation est une exception, avec un
-- message qui dit quoi faire (le client le relaie tel quel).
-- ----------------------------------------------------------------------------
create or replace function public.consume_attachment_upload(
  p_id         uuid,
  p_org        uuid,
  p_request_id uuid,
  p_actor      uuid,
  p_source     uuid
) returns public.attachment_uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attachment_uploads%rowtype;
begin
  if p_request_id is null then
    raise exception 'Pièce téléversée : demande de rattachement absente.';
  end if;
  if (p_actor is null) = (p_source is null) then
    raise exception 'Pièce téléversée : un déposant exactement est attendu (agent OU source).';
  end if;

  select * into v_row
    from public.attachment_uploads
   where id = p_id
   for update;

  if not found or v_row.organization_id is distinct from p_org then
    raise exception 'Pièce téléversée introuvable (%).', p_id;
  end if;
  if v_row.discarded_at is not null then
    raise exception 'Pièce téléversée retirée avant d''être rattachée : redéposez le fichier.';
  end if;
  if v_row.consumed_at is not null then
    raise exception 'Pièce téléversée déjà rattachée à une demande.';
  end if;
  if v_row.expires_at < now() then
    raise exception 'Pièce téléversée expirée : redéposez le fichier.';
  end if;
  if v_row.scope_request_id is not null and v_row.scope_request_id <> p_request_id then
    raise exception 'Pièce téléversée pour une autre demande.';
  end if;
  if v_row.uploaded_by is distinct from p_actor
     or v_row.integration_source_id is distinct from p_source then
    raise exception 'Pièce téléversée par un autre déposant.';
  end if;
  -- Preuve que l'objet est sous la demande : soit écrit là d'emblée (portée
  -- demande), soit DÉPLACÉ par l'edge function avant l'appel (portée org).
  if v_row.storage_path not like p_org::text || '/' || p_request_id::text || '/%' then
    raise exception 'Pièce téléversée encore en zone d''attente : objet non déplacé sous la demande.';
  end if;

  update public.attachment_uploads
     set consumed_at = now()
   where id = p_id
   returning * into v_row;
  return v_row;
end;
$$;
comment on function public.consume_attachment_upload(uuid, uuid, uuid, uuid, uuid) is
  'Porte unique de consommation d''une pièce téléversée : verrou, tenant, déposant, portée, expiration, objet sous la demande. Appelée par les RPC métier dans leur transaction — jamais par un client.';
revoke execute on function public.consume_attachment_upload(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- ingest_request_attachments — rattachement des pièces d'un dépôt PARTENAIRE
-- (requests-api, service_role). Une transaction pour N pièces : consommation
-- + ligne `request_attachments` (`copy_status = copied` — l'octet est déjà là,
-- vérifié, c'est tout le sens du push) + trace sur la ligne de staging.
-- L'appelant a déjà déplacé chaque objet sous la demande.
-- ----------------------------------------------------------------------------
create or replace function public.ingest_request_attachments(
  p_request_id uuid,
  p_org        uuid,
  p_source     uuid,
  p_items      jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item   jsonb;
  v_up   public.attachment_uploads%rowtype;
  v_att  uuid;
  v_n    integer := 0;
begin
  if p_source is null then
    raise exception 'ingest_request_attachments : source d''intégration requise.';
  end if;
  if not exists (
    select 1 from public.requests r
     where r.id = p_request_id and r.organization_id = p_org
  ) then
    raise exception 'ingest_request_attachments : demande introuvable dans ce tenant.';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_up := public.consume_attachment_upload(
      (item ->> 'upload_id')::uuid, p_org, p_request_id, null, p_source);

    insert into public.request_attachments (
      organization_id, request_id, storage_path, file_name, mime_type, file_size,
      checksum, form_field_key, copy_status, uploaded_by, kind
    ) values (
      p_org, p_request_id, v_up.storage_path, v_up.file_name, v_up.mime_type, v_up.file_size,
      v_up.checksum, nullif(item ->> 'form_field_key', ''), 'copied', null, 'demande'
    ) returning id into v_att;

    update public.attachment_uploads set request_attachment_id = v_att where id = v_up.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;
comment on function public.ingest_request_attachments(uuid, uuid, uuid, jsonb) is
  'Rattache à une demande les pièces téléversées par un partenaire ({upload_id, form_field_key}) — consommation + ligne request_attachments, en une transaction. service_role uniquement.';
revoke execute on function public.ingest_request_attachments(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
