/**
 * Base Iris de test : un schéma RÉDUIT (les tables que lit la vue usager) sur
 * PGlite, auquel on applique les VRAIES migrations de l'espace usager :
 *   · `20261019150000_acces_usager_invite.sql`     — accès invité (code, verrou) ;
 *   · `20261020150000_espace_usager_mes_demandes.sql` — `citizen_visible`, t13, t14 ;
 *   · `20261021090000_acces_invite_renvoi_coupure.sql` — renvoi, coupure, nouveau code (L4a).
 *
 * Ce que le schéma réduit ne dit pas : le reste du modèle d'Iris (workflow,
 * instruction, droits réels). `is_service_context()` et `user_has_request_right()`
 * sont remplacées par des doublures pilotées par des réglages de session
 * (`app.service`, `app.right`, `app.uid`) — de quoi tester les gardes t13/t14.
 *
 * Lancer : `npx vitest run supabase/functions/requests-api/espace-usager`.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "migrations");

const STUB_SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

  create table public.organizations (
    id uuid primary key default gen_random_uuid(), socle_org_id uuid unique, name text);
  create table public.integration_sources (
    id uuid primary key default gen_random_uuid(), code text not null, status text not null default 'active',
    organization_id uuid references public.organizations(id));
  create table public.integration_credentials (
    id uuid primary key default gen_random_uuid(),
    integration_source_id uuid not null references public.integration_sources(id),
    key_hash text unique not null, scopes text[] not null,
    expires_at timestamptz not null default now() + interval '1 year',
    revoked_at timestamptz, last_used_at timestamptz);

  create table public.requests (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id),
    source text not null default 'portail-citoyen',
    reference text not null,
    status text not null default 'a_traiter',
    subject text not null default '',
    procedure_snapshot jsonb,
    body text,
    received_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    closed_at timestamptz,
    closure_text text,
    closure_motif text,
    assigned_to text,
    socle_contact_id uuid,
    socle_organization_id uuid,
    socle_scope_org_id uuid,
    socle_procedure_id text,
    unique (organization_id, reference));
  create table public.request_emails (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.requests(id) on delete cascade,
    to_email text, subject text, body text, sent_at timestamptz, status text not null default 'envoye',
    sent_by text);
  create table public.request_attachments (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.requests(id) on delete cascade,
    file_name text not null, mime_type text, file_size int, kind text not null default 'demande',
    email_id uuid, superseded_by uuid, storage_path text, created_at timestamptz not null default now());
  create table public.request_messages (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.requests(id) on delete cascade,
    kind text, body text, author_id text);
  create table public.request_receipts (
    request_id uuid primary key references public.requests(id) on delete cascade,
    status text not null default 'pending', attempts int not null default 0, next_attempt_at timestamptz,
    attempted_at timestamptz, settled_at timestamptz, error text, email_id uuid,
    created_at timestamptz not null default now());
  create table public.integration_api_logs (
    id bigint generated always as identity primary key, created_at timestamptz not null default now(),
    organization_id uuid, integration_source_id uuid, credential_id uuid,
    method text, path text, status int, error_code text, request_id uuid);

  create function public.is_service_context() returns boolean language sql stable
    as $$ select coalesce(current_setting('app.service', true), '') = '1' $$;
  create function public.user_has_request_right(uuid, uuid, uuid, text, text) returns boolean language sql stable
    as $$ select coalesce(current_setting('app.right', true), '') = '1' $$;
  create function public.enqueue_request_receipt(p_request_id uuid) returns void language sql
    as $$ insert into public.request_receipts(request_id) values (p_request_id) on conflict do nothing $$;

  -- Lot L4a (20261021090000) : agents, échanges et file des nouveaux codes.
  create table public.users (id uuid primary key default gen_random_uuid(), email text);
  create function public.notification_email_max_attempts() returns int language sql immutable as $$ select 5 $$;
  create function public.start_request_email(p_request_id uuid, p_sent_by uuid, p_to_email text, p_subject text, p_body text)
    returns uuid language sql as $$
      insert into public.request_emails (request_id, sent_by, to_email, subject, body, status)
      values (p_request_id, p_sent_by::text, btrim(p_to_email), p_subject, p_body, 'en_cours') returning id $$;
  create function public.settle_request_email(p_id uuid, p_ok boolean, p_error text default null)
    returns void language sql as $$
      update public.request_emails set status = case when p_ok then 'envoye' else 'echec' end,
        sent_at = case when p_ok then now() end where id = p_id $$;

  -- Lot L4b (20261021120000) : réponse de l'usager — zone d'attente des pièces,
  -- journal, notifications, membres, droits (doublures pilotées par des tables).
  alter table public.request_attachments
    add column organization_id uuid, add column checksum text, add column copy_status text,
    add column uploaded_by uuid;
  create table public.attachment_uploads (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null, scope_request_id uuid, integration_source_id uuid, uploaded_by uuid,
    storage_path text not null, file_name text not null, mime_type text, file_size int, checksum text,
    expires_at timestamptz not null default now() + interval '1 day', consumed_at timestamptz,
    discarded_at timestamptz, request_attachment_id uuid);
  create table public.request_events (
    id uuid primary key default gen_random_uuid(), organization_id uuid not null,
    request_id uuid not null references public.requests(id) on delete cascade,
    event_type text not null, payload jsonb not null default '{}', created_by uuid,
    created_at timestamptz not null default now());
  create table public.notifications (
    id uuid primary key default gen_random_uuid(), organization_id uuid, user_id text not null,
    request_id uuid, kind text not null, actor_id uuid, payload jsonb not null default '{}',
    in_app boolean not null default true, email_status text, created_at timestamptz not null default now());
  create table public.notification_preferences (user_id text, kind text);
  create table public.organization_members (organization_id uuid not null, user_id text not null);
  -- Qui détient « instruction » (doublure de request_right_for) : une ligne par agent.
  create table public.stub_instructors (user_id text primary key);
  create function public.request_right_for(p_user_id text, p_org_id uuid, p_socle_org_id uuid, p_proc text, p_right text)
    returns boolean language sql stable
    as $$ select p_right = 'instruction' and exists (select 1 from public.stub_instructors i where i.user_id = p_user_id) $$;
  create function public.notification_channels_for(p_user_id text, p_kind text)
    returns table (use_in_app boolean, use_email boolean) language sql stable as $$ select true, true $$;
  create function public.push_notification(p_user_id text, p_actor_id uuid, p_org_id uuid, p_request_id uuid,
    p_kind text, p_reference text, p_subject text, p_extra jsonb default '{}')
    returns void language sql as $$
      insert into public.notifications (organization_id, user_id, request_id, kind, actor_id, payload, email_status)
      select p_org_id, p_user_id, p_request_id, p_kind, p_actor_id,
             jsonb_build_object('reference', p_reference, 'subject', p_subject) || coalesce(p_extra, '{}'), 'pending'
       where p_user_id is not null $$;
  create function public.satellite_check_request_org() returns trigger language plpgsql as $$
    begin
      if not exists (select 1 from public.requests r where r.id = new.request_id and r.organization_id = new.organization_id) then
        raise exception 'satellite : demande d''un autre tenant';
      end if;
      return new;
    end $$;
  create function public.forbid_change() returns trigger language plpgsql as $$
    begin raise exception '% immuable : % interdit.', tg_table_name, tg_op; end $$;
  create function public.can_consult_request(uuid) returns boolean language sql stable
    as $$ select coalesce(current_setting('app.right', true), '') = '1' $$;

  -- Suites PO du 2026-10-24 (20261024100000) : versement au dossier (B10) et
  -- trigger de notification des changements de statut (B11).
  alter table public.request_attachments
    add column form_field_key text, add column superseded_at timestamptz,
    add column source_attachment_id uuid references public.request_attachments(id);
  alter table public.requests
    add column socle_procedure_label text, add column socle_organization_label text;
  create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
  create function public.user_display_name(uuid) returns text language sql stable as $$ select null::text $$;
  -- Mêmes gardes que la vraie RPC (20260910100000) : un déposant (la source),
  -- même tenant, ni retirée, ni consommée, ni expirée, objet DÉJÀ sous la demande.
  create function public.consume_attachment_upload(p_id uuid, p_org uuid, p_request_id uuid, p_actor uuid, p_source uuid)
    returns public.attachment_uploads language plpgsql as $$
    declare v public.attachment_uploads%rowtype;
    begin
      if (p_actor is null) = (p_source is null) then raise exception 'consume : un déposant exactement'; end if;
      select * into v from public.attachment_uploads where id = p_id and organization_id = p_org for update;
      if not found or v.consumed_at is not null or v.discarded_at is not null or v.expires_at < now()
         or v.integration_source_id is distinct from p_source
         or v.storage_path not like p_org::text || '/' || p_request_id::text || '/%' then
        raise exception 'consume : pièce refusée';
      end if;
      update public.attachment_uploads set consumed_at = now() where id = p_id returning * into v;
      return v;
    end $$;
`;

let shared: PGlite | null = null;

export async function createIrisDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB_SCHEMA);
  for (const file of [
    "20261019150000_acces_usager_invite.sql",
    "20261020150000_espace_usager_mes_demandes.sql",
    "20261021090000_acces_invite_renvoi_coupure.sql",
    "20261021120000_reponse_usager.sql",
    "20261024100000_reponse_usager_suites_po.sql",
    "20261025100000_request_emails_nature_delivery.sql",
  ]) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  // Le trigger existe en production depuis 20260824100000 ; la migration ne
  // fait que remplacer sa fonction.
  await db.exec(`create trigger t40_requests_notify_update after update on public.requests
    for each row execute function public.requests_notify_update()`);
  return db;
}

/** Une base par fichier de test, vidée entre deux tests. */
export async function freshIrisDb(): Promise<PGlite> {
  if (shared === null) {
    shared = await createIrisDb();
    return shared;
  }
  await shared.exec(`
    select set_config('app.service', '1', false);
    truncate table public.notifications, public.request_events, public.attachment_uploads,
      public.organization_members, public.stub_instructors, public.request_citizen_messages, public.request_access_mails, public.request_access_codes, public.request_receipts, public.request_messages,
      public.request_attachments, public.request_emails, public.requests, public.integration_api_logs,
      public.integration_credentials, public.integration_sources, public.organizations, public.users restart identity cascade;
    select set_config('app.service', '', false);
  `);
  return shared;
}
