-- ============================================================================
-- API d'ingestion générique — modèle multi-source.
-- integration_sources / integration_credentials / integration_api_logs,
-- registre de sources DYNAMIQUE sur requests (fin de la liste fermée en CHECK),
-- clé d'idempotence + empreinte de contenu, fetch_url des pièces à copier.
-- Réf : docs/architecture-proposee.md §5, §8.1 · docs/api-ingestion.md.
-- Aucune logique spécifique à un émetteur : Clara, portail citoyen ou tiers
-- sont de simples lignes d'integration_sources.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- integration_sources — un système source enregistré, rattaché à UN tenant
-- (organisation racine Socle). C'est l'ancrage du périmètre : une intégration
-- ne peut agir que dans son tenant.
-- ----------------------------------------------------------------------------
create table if not exists public.integration_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null
                    check (code ~ '^[a-z][a-z0-9_-]{1,39}$' and code <> 'iris'),
  name            text not null,
  status          text not null default 'active' check (status in ('active','suspended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);
comment on table public.integration_sources is
  'Systèmes sources autorisés à déposer des demandes (Clara, portail, partenaires…). Un par tenant et par code. La suspension coupe l''ingestion sans révoquer les clés.';
comment on column public.integration_sources.code is
  'Identifiant machine de la source — devient requests.source. ''iris'' est réservé aux demandes nées dans Iris.';

drop trigger if exists t02_integration_sources_updated_at on public.integration_sources;
create trigger t02_integration_sources_updated_at
  before update on public.integration_sources
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- integration_credentials — clés d'une source : hachées (SHA-256, jamais en
-- clair), révocables, expirables, scopées. Plusieurs clés actives par source
-- (rotation par double clé).
-- ----------------------------------------------------------------------------
create table if not exists public.integration_credentials (
  id                    uuid primary key default gen_random_uuid(),
  integration_source_id uuid not null references public.integration_sources(id) on delete cascade,
  name                  text not null,
  key_prefix            text not null,     -- affichage/repérage uniquement (ex. 'irs_live_ab12…')
  key_hash              text not null unique,  -- SHA-256 hex du secret complet
  scopes                text[] not null
                          check (scopes <@ array['requests:write','requests:read']::text[]
                                 and array_length(scopes, 1) >= 1),
  expires_at            timestamptz not null,  -- systématique (12 mois recommandés)
  revoked_at            timestamptz,
  last_used_at          timestamptz,
  created_at            timestamptz not null default now()
);
comment on table public.integration_credentials is
  'Secrets d''intégration : SHA-256 en base, le clair ne s''affiche qu''une fois à la génération. Jamais dans un navigateur.';

-- ----------------------------------------------------------------------------
-- integration_api_logs — journal d'audit append-only des appels à l'API
-- d'ingestion (capacité de forensic absente chez Socle, exigée pour Iris).
-- Jamais le contenu des payloads.
-- ----------------------------------------------------------------------------
create table if not exists public.integration_api_logs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid,
  integration_source_id uuid,
  credential_id         uuid,
  method                text not null,
  path                  text not null,
  status                int  not null,
  error_code            text,
  request_id            uuid,   -- demande concernée le cas échéant (uuid nu, pas de FK : le journal survit)
  created_at            timestamptz not null default now()
);
create index if not exists integration_api_logs_org_idx
  on public.integration_api_logs (organization_id, created_at desc);
create index if not exists integration_api_logs_credential_idx
  on public.integration_api_logs (credential_id, created_at desc);

drop trigger if exists t01_integration_api_logs_immutable on public.integration_api_logs;
create trigger t01_integration_api_logs_immutable
  before update or delete on public.integration_api_logs
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- requests — registre de sources dynamique + idempotence renforcée.
-- ----------------------------------------------------------------------------

-- La liste fermée ('iris','clara','portail','arpege') cède la place au registre
-- integration_sources ; seul le format reste contraint.
alter table public.requests drop constraint if exists requests_source_check;
alter table public.requests add constraint requests_source_format
  check (source ~ '^[a-z][a-z0-9_-]{1,39}$') not valid;
alter table public.requests validate constraint requests_source_format;

alter table public.requests add column if not exists idempotency_key text;
alter table public.requests add column if not exists ingest_fingerprint text;
comment on column public.requests.idempotency_key is
  'Clé d''idempotence fournie par l''émetteur (complète l''unicité (source, external_ref)).';
comment on column public.requests.ingest_fingerprint is
  'Empreinte SHA-256 du contenu canonique à l''ingestion : rejeu identique → 200, contenu divergent → 409.';

create unique index if not exists requests_idempotency_key_unique
  on public.requests (organization_id, source, idempotency_key)
  where idempotency_key is not null;

-- Garde : toute source autre que 'iris' doit être ENREGISTRÉE et ACTIVE pour le
-- tenant (DEFINER : lit integration_sources hors RLS ; s'applique aussi aux
-- écritures service_role — le registre fait foi pour tout le monde).
create or replace function public.requests_check_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source <> 'iris' and not exists (
    select 1 from public.integration_sources s
    where s.organization_id = new.organization_id
      and s.code = new.source
      and s.status = 'active'
  ) then
    raise exception 'Source d''ingestion « % » inconnue ou suspendue pour ce tenant.', new.source;
  end if;
  return new;
end;
$$;
revoke execute on function public.requests_check_source() from public, anon, authenticated;

drop trigger if exists t15_requests_check_source on public.requests;
create trigger t15_requests_check_source
  before insert on public.requests
  for each row execute function public.requests_check_source();

-- Pièce à copier : URL signée courte durée fournie par l'émetteur, consommée
-- par le worker de copie (jamais servie à un client ; expire vite).
alter table public.request_attachments add column if not exists fetch_url text;
comment on column public.request_attachments.fetch_url is
  'URL signée temporaire fournie à l''ingestion (copy_status=pending). Consommée par le worker de copie, jamais re-servie.';

-- ----------------------------------------------------------------------------
-- RLS — l'API d'ingestion opère en service_role (contourne le RLS par attribut,
-- le périmètre est reconstruit en code et lié à la clé). Côté clients :
-- gestion des sources/clés réservée à la plateforme, diagnostic aux admins.
-- ----------------------------------------------------------------------------
alter table public.integration_sources enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.integration_api_logs enable row level security;

drop policy if exists integration_sources_select on public.integration_sources;
create policy integration_sources_select on public.integration_sources
  for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists integration_sources_write on public.integration_sources;
create policy integration_sources_write on public.integration_sources
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Les clés (hash compris) ne sont visibles que de la plateforme (motif api_keys Socle).
drop policy if exists integration_credentials_all on public.integration_credentials;
create policy integration_credentials_all on public.integration_credentials
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists integration_api_logs_select on public.integration_api_logs;
create policy integration_api_logs_select on public.integration_api_logs
  for select to authenticated using (public.is_org_admin(organization_id));
-- Aucune écriture cliente sur les journaux.
