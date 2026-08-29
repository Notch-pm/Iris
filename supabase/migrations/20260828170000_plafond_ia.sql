-- ============================================================================
-- Plafond d'utilisation IA — tables, RLS, privilèges.
--
-- Trois tables, un seul métier : borner ce que l'assistant IA coûte, par
-- tenant et par mois, et savoir a posteriori où est passé le budget.
--
--   • ai_usage_quotas   — LE PLAFOND. Écrit par le SUPERADMIN uniquement.
--   • ai_usage_counters — le compteur vivant (consommé + réservé) par
--                         organisation, fournisseur et période 'YYYY-MM'.
--   • ai_usage_events   — le grand livre : une ligne par appel, de la
--                         réservation au règlement.
--
-- Motif Clara (`ai_usage_quotas`, 2026-06-16), avec TROIS corrections. Elles
-- sont la raison d'être de ce commentaire :
--
--  1. LA SENTINELLE `'__global__'` EST LÀ DÈS LA PREMIÈRE MIGRATION. Clara a
--     d'abord écrit `provider = NULL` pour « tous fournisseurs confondus », et
--     a dû migrer (20260617090000) : deux NULL ne sont JAMAIS égaux pour une
--     contrainte UNIQUE, donc `ON CONFLICT (organization_id, provider)` ne
--     rattrapait rien et créait une ligne de plus à chaque enregistrement — la
--     lecture `LIMIT 1` devenant non déterministe. On ne rejoue pas la dette.
--
--  2. AUCUNE POLICY D'ÉCRITURE CLIENTE, sur aucune des trois tables. Chez
--     Clara, le navigateur du superadmin fait lui-même l'UPSERT sous une
--     policy `for all`. Iris a déjà tranché l'inverse pour `smtp_settings`
--     (20260823100000) et les 5 tables `permission_*` (20260822100800) : les
--     RPC de 20260828170100 sont l'UNIQUE porte. PostgreSQL refuse par défaut
--     ce qu'aucune policy ne couvre — c'est tout ce qu'il faut.
--
--  3. AUCUNE POLICY `service_role` NON PLUS, et c'est délibéré. L'écriture
--     vient de `reserve_ai_usage` / `settle_ai_usage`, `SECURITY DEFINER`,
--     qui s'exécutent comme le propriétaire et sortent donc du RLS : une
--     policy service serait du bruit. Même posture que `permission_*`.
--     (`smtp_settings`, `notifications` et `email_templates` en portent une —
--     ces tables-là sont écrites par le CLIENT service, pas par une RPC
--     definer. La différence est là, elle n'est pas un oubli.)
--
-- LECTURE : réservée à l'ADMINISTRATION. Une consommation est un chiffre de
-- gestion ; l'agent, lui, apprend le dépassement par le 429 de l'edge
-- function, dont le message nomme la date de renouvellement et se suffit.
--
-- Rejouable : IF NOT EXISTS / DROP … IF EXISTS partout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Le plafond
-- ----------------------------------------------------------------------------
create table if not exists public.ai_usage_quotas (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  -- Sentinelle, jamais NULL (correction 1). '__global__' = tous fournisseurs
  -- confondus ; une valeur concrète ('mistral') pose un plafond dédié qui
  -- prime sur le global.
  provider             text not null default '__global__',
  period_unit          text not null default 'month' check (period_unit in ('month')),
  monthly_limit_tokens bigint not null check (monthly_limit_tokens > 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.users(id) on delete set null,
  unique (organization_id, provider)
);

comment on table public.ai_usage_quotas is
  'Plafond mensuel de jetons IA par tenant. Écrit UNIQUEMENT par set_ai_usage_quota (admin plateforme) — aucune policy d''écriture cliente.';
comment on column public.ai_usage_quotas.provider is
  'Sentinelle ''__global__'' = tous fournisseurs. JAMAIS NULL : deux NULL ne sont pas égaux pour un UNIQUE, ce qui casserait ON CONFLICT (dette Clara 20260617090000).';
comment on column public.ai_usage_quotas.monthly_limit_tokens is
  'Unité = JETONS, pas euros : le prix au jeton est commercial et bouge sans préavis, un montant serait faux le jour du changement de tarif.';

-- ----------------------------------------------------------------------------
-- Le compteur vivant
-- ----------------------------------------------------------------------------
create table if not exists public.ai_usage_counters (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider        text not null default '__global__',
  period          text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  used_tokens     bigint not null default 0 check (used_tokens >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider, period)
);

comment on table public.ai_usage_counters is
  'Consommé + réservé par organisation, fournisseur et période. Le passage au mois suivant crée naturellement une nouvelle ligne — AUCUN job de reset destructif.';
comment on column public.ai_usage_counters.period is
  'Période au format ''YYYY-MM'', en UTC (to_char(now(),''YYYY-MM'') sur Supabase). Texte libre borné par CHECK, pour permettre une autre granularité plus tard sans migration de type.';
comment on column public.ai_usage_counters.reserved_tokens is
  'Jetons réservés par un appel en cours. Libérés au règlement (ou par release_stale_ai_reservations si l''appelant est mort en route).';

-- ----------------------------------------------------------------------------
-- Le grand livre
-- ----------------------------------------------------------------------------
create table if not exists public.ai_usage_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  -- Toujours CONCRET ('mistral') : le journal doit rester lisible même quand
  -- aucun plafond n'est configuré et qu'aucun compteur n'a été touché.
  provider           text not null,
  -- Clé du compteur RÉELLEMENT réservé : '__global__', un fournisseur précis,
  -- ou NULL quand aucun plafond n'existait au moment de la réservation.
  counter_provider   text,
  resource_type      text not null check (resource_type in ('chat', 'agent', 'ocr')),
  status             text not null default 'reserved'
                       check (status in ('reserved', 'completed', 'failed', 'timeout')),
  estimated_tokens   bigint not null check (estimated_tokens >= 0),
  actual_tokens      bigint check (actual_tokens is null or actual_tokens >= 0),
  period             text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  -- ON DELETE SET NULL : la comptabilité survit à la purge RGPD d'une demande,
  -- le lien non. Un CASCADE effacerait une consommation déjà facturée ; un
  -- RESTRICT bloquerait la purge.
  request_id         uuid references public.requests(id) on delete set null,
  -- UUID Socle NU — aucune FK ne franchit une frontière de projet.
  socle_procedure_id uuid,
  created_by         uuid references public.users(id) on delete set null,
  -- clock_timestamp() et non now() : deux réservations dans la MÊME
  -- transaction doivent s'ordonner (motif notifications, 20260824100100).
  created_at         timestamptz not null default clock_timestamp(),
  settled_at         timestamptz
);

comment on table public.ai_usage_events is
  'Grand livre des appels IA : une ligne par appel, de la réservation au règlement. Ne conserve AUCUN texte de prompt ni de réponse.';
comment on column public.ai_usage_events.counter_provider is
  'Compteur réellement réservé. NULL = aucun plafond configuré à cet instant (l''appel a eu lieu, il n''a rien décompté).';
comment on column public.ai_usage_events.request_id is
  'Demande concernée, quand il y en a une. Nul en mode « démarche seule » (guichet), et remis à null par la purge RGPD.';

create index if not exists ai_usage_counters_org_period_idx
  on public.ai_usage_counters (organization_id, period);
create index if not exists ai_usage_events_org_period_idx
  on public.ai_usage_events (organization_id, period, created_at desc);
-- Index partiel : le SEUL consommateur est le balayage des réservations
-- orphelines, qui ne regarde que les lignes encore 'reserved'.
create index if not exists ai_usage_events_stale_idx
  on public.ai_usage_events (created_at) where status = 'reserved';

-- ----------------------------------------------------------------------------
-- RLS — lecture par l'administration, écriture nulle part côté client.
-- ----------------------------------------------------------------------------
alter table public.ai_usage_quotas   enable row level security;
alter table public.ai_usage_counters enable row level security;
alter table public.ai_usage_events   enable row level security;

-- `(select public.is_platform_admin())` : le sous-select force l'évaluation
-- UNE fois par requête et non par ligne (motif 20260822100900).
drop policy if exists ai_usage_quotas_select on public.ai_usage_quotas;
create policy ai_usage_quotas_select on public.ai_usage_quotas
  for select to authenticated
  using ((select public.is_platform_admin()) or public.is_org_admin_anywhere(organization_id));

drop policy if exists ai_usage_counters_select on public.ai_usage_counters;
create policy ai_usage_counters_select on public.ai_usage_counters
  for select to authenticated
  using ((select public.is_platform_admin()) or public.is_org_admin_anywhere(organization_id));

drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using ((select public.is_platform_admin()) or public.is_org_admin_anywhere(organization_id));

-- Privilèges de table : lecture seule pour le client. Le DML lui est retiré
-- même si une policy d'écriture apparaissait un jour par accident.
revoke all on table public.ai_usage_quotas   from anon, authenticated;
revoke all on table public.ai_usage_counters from anon, authenticated;
revoke all on table public.ai_usage_events   from anon, authenticated;
grant select on table public.ai_usage_quotas   to authenticated;
grant select on table public.ai_usage_counters to authenticated;
grant select on table public.ai_usage_events   to authenticated;
