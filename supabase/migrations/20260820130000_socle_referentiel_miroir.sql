-- ============================================================================
-- Miroir léger du référentiel Socle (phase 1 suite) — motif Clara, périmètre
-- minimal : hiérarchie d'organisations (id, parent, nom, statut) et cache des
-- démarches (id + libellés + type). RIEN d'autre n'est répliqué (pas de
-- form_schema, pas de coordonnées) — la ligne à ne pas franchir (architecture §7).
-- Écriture : service_role uniquement (edge sync-socle-referentiel).
-- ============================================================================

create table if not exists public.socle_organizations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  socle_id        uuid not null,          -- UUID Socle (clé d'idempotence de la sync)
  socle_parent_id uuid,                   -- parenté logique socle→socle, sans FK
                                          -- (racine du tenant : NULL, motif Clara)
  name            text not null,
  status          text not null default 'active',
  synced_at       timestamptz not null default now(),
  obsoleted_at    timestamptz,            -- disparue du périmètre = soft-delete, jamais de DELETE
  unique (organization_id, socle_id)
);
comment on table public.socle_organizations is
  'Miroir du sous-arbre Socle du tenant (id, parent, nom, statut — rien de plus). Les champs Socle sont réécrasés à chaque sync. Support futur de la visibilité par sous-arbre.';

create index if not exists socle_organizations_org_idx
  on public.socle_organizations (organization_id, socle_parent_id);

create table if not exists public.socle_procedure_cache (
  socle_id          uuid primary key,     -- UUID Socle de la démarche
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  socle_root_org_id uuid not null,        -- racine Socle propriétaire (redondant, lisible)
  name              text not null,
  category_socle_id uuid,
  category_name     text,
  type              text,
  synced_at         timestamptz not null default now(),
  obsoleted_at      timestamptz
);
comment on table public.socle_procedure_cache is
  'Cache léger des démarches Socle du tenant : sélecteurs, filtres, validation. Explicitement HORS cache : form_schema, requester_config, knowledge_base (snapshot par demande via socle-proxy).';

create index if not exists socle_procedure_cache_org_idx
  on public.socle_procedure_cache (organization_id, name);

create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'socle-referentiel',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running','success','error')),
  counters    jsonb not null default '{}'::jsonb,
  error       text
);
comment on table public.sync_runs is
  'Journal des synchronisations du référentiel Socle (motif socle_sync_runs de Clara).';

alter table public.socle_organizations enable row level security;
alter table public.socle_procedure_cache enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists socle_organizations_select on public.socle_organizations;
create policy socle_organizations_select on public.socle_organizations
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists socle_procedure_cache_select on public.socle_procedure_cache;
create policy socle_procedure_cache_select on public.socle_procedure_cache
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs
  for select to authenticated using (public.is_platform_admin());
-- Aucune écriture cliente sur les trois tables : sync service_role uniquement.
