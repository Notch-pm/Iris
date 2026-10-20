/**
 * Base Iris de test : un schéma RÉDUIT (les tables que lit la vue usager) sur
 * PGlite, auquel on applique les VRAIES migrations de l'espace usager :
 *   · `20261019150000_acces_usager_invite.sql`     — accès invité (code, verrou) ;
 *   · `20261020150000_espace_usager_mes_demandes.sql` — `citizen_visible`, t13, t14.
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
`;

let shared: PGlite | null = null;

export async function createIrisDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STUB_SCHEMA);
  for (const file of ["20261019150000_acces_usager_invite.sql", "20261020150000_espace_usager_mes_demandes.sql"]) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
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
    truncate table public.request_access_codes, public.request_receipts, public.request_messages,
      public.request_attachments, public.request_emails, public.requests, public.integration_api_logs,
      public.integration_credentials, public.integration_sources, public.organizations restart identity cascade;
    select set_config('app.service', '', false);
  `);
  return shared;
}
