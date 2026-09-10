-- ============================================================================
-- Statistiques — tables de faits INSENSIBLES À LA PURGE RGPD (2026-09-18).
--
-- L'écran « Statistiques » (motif Clara : ApexCharts, filtres organisme et
-- période) ne lit JAMAIS `requests` : il lit deux tables de faits, une ligne
-- par demande et une par intervention, qui ne portent AUCUNE donnée d'usager
-- (ni identité, ni objet, ni formulaire, ni pièce) et AUCUNE FK vers la
-- demande — un UUID nu. La future procédure de purge supprimera des lignes de
-- `requests` et leurs satellites en cascade : ces deux tables ne bougent pas,
-- et les chiffres d'une année restent justes après la purge de ses dossiers.
--
--   1. `request_stats` — jalons d'une demande : réception, première entrée en
--      instruction, résolution (`closed_at`, remise à NULL à la réouverture),
--      issue, auteur de la résolution (décision PO 2026-09-18 : « l'agent qui a
--      instruit » = celui qui pose `resolue_positive` / `resolue_negative`).
--   2. `intervention_stats` — sollicitation et réalisation d'une intervention.
--   3. Alimentation par TRIGGER (`t31_*`, DEFINER, jamais de policy d'écriture
--      cliente) ; reconstruction par `rebuild_*_stats` (service, réparation et
--      backfill — appelé une fois ici).
--   4. Lecture sous le MÊME prédicat de consultation par couple que
--      `requests_select` (sans la branche « sollicitation » : un intervenant
--      pur ne consulte pas de statistiques) ; `intervention_stats` par EXISTS
--      direct sur `request_stats` (ADR-05).
--   5. Huit RPC `stats_*` SECURITY INVOKER : bornées au périmètre du lecteur.
--
-- ⚠️ Ce que la purge RGPD NE DOIT PAS toucher : `request_stats`,
-- `intervention_stats`. Les scripts de nettoyage e2e et la purge du jeu ACCM,
-- eux, suppriment des demandes qui ne sont PAS des dossiers réels : ils
-- doivent vider les faits des demandes qu'ils effacent.
--
-- Libellés d'organisme et d'agent : NON copiés. Ils se relisent dans
-- `socle_organizations` (miroir soft-delete, survit à la purge) et `users`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. request_stats
-- ----------------------------------------------------------------------------
create table if not exists public.request_stats (
  request_id             uuid primary key,   -- UUID NU : aucune FK vers requests, la purge ne l'emporte pas
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  socle_root_org_id      uuid not null,
  socle_scope_org_id     uuid not null,
  socle_procedure_id     uuid,
  source                 text not null,
  channel                text,
  received_at            timestamptz not null,
  created_at             timestamptz not null,
  current_status         text not null,
  -- Première entrée en `en_instruction` (instruction → attente → instruction
  -- a bien commencé à la première date).
  instruction_started_at timestamptz,
  -- = requests.closed_at : posée par requests_guard_write, purgée à la réouverture.
  resolved_at            timestamptz,
  -- Statut terminal atteint ; CONSERVÉ à l'archivage ; NULL sinon.
  outcome                text check (outcome in ('annulee', 'resolue_positive', 'resolue_negative')),
  -- Auteur de la résolution (resolue_* seulement ; NULL pour une annulation).
  resolved_by            uuid references public.users(id) on delete set null,
  updated_at             timestamptz not null default now()
);

comment on table public.request_stats is
  'Faits statistiques d''une demande — une ligne par demande, AUCUNE donnée d''usager, AUCUNE FK vers requests. JAMAIS purgée : la purge RGPD supprime les dossiers, pas leurs chiffres. Écrite par t31_requests_stats et rebuild_request_stats uniquement.';
comment on column public.request_stats.request_id is
  'UUID nu de la demande. Après purge, ne résout plus rien : c''est voulu.';
comment on column public.request_stats.resolved_by is
  'Agent qui a posé resolue_positive / resolue_negative (décision PO 2026-09-18 : c''est lui qui « a instruit »). NULL pour annulee, ou si le geste vient d''un contexte de service.';

-- Jumeau de requests_org_scope_proc_idx : support du prédicat RLS par couple.
create index if not exists request_stats_org_scope_proc_idx
  on public.request_stats (organization_id, socle_scope_org_id, socle_procedure_id);
create index if not exists request_stats_org_received_idx
  on public.request_stats (organization_id, received_at desc);
create index if not exists request_stats_resolved_by_idx
  on public.request_stats (resolved_by);

-- ----------------------------------------------------------------------------
-- 2. intervention_stats
-- ----------------------------------------------------------------------------
create table if not exists public.intervention_stats (
  intervention_id uuid primary key,   -- UUID nu
  request_id      uuid not null,      -- UUID nu (jointure sur request_stats, jamais sur requests)
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intervenant_id  uuid references public.users(id) on delete set null,
  requested_at    timestamptz not null,
  completed_at    timestamptz,
  completed_on    date,
  updated_at      timestamptz not null default now()
);

comment on table public.intervention_stats is
  'Faits statistiques d''une intervention — sollicitation et réalisation. AUCUNE FK vers request_interventions ni requests. JAMAIS purgée. Écrite par t31_request_interventions_stats et rebuild_intervention_stats uniquement.';

create index if not exists intervention_stats_request_idx
  on public.intervention_stats (request_id);
create index if not exists intervention_stats_intervenant_idx
  on public.intervention_stats (intervenant_id);
create index if not exists intervention_stats_org_completed_idx
  on public.intervention_stats (organization_id, completed_at);

-- ----------------------------------------------------------------------------
-- 3. RLS — lecture par couple, aucune écriture cliente
-- ----------------------------------------------------------------------------
alter table public.request_stats      enable row level security;
alter table public.intervention_stats enable row level security;

-- Même prédicat que requests_select (20260914100000), SANS la branche
-- my_intervention_request_ids() : la sollicitation ouvre une demande à son
-- intervenant, pas les statistiques du service.
drop policy if exists request_stats_select on public.request_stats;
create policy request_stats_select on public.request_stats
  for select to authenticated
  using (
    (select public.is_platform_admin())
    or (organization_id, socle_scope_org_id, coalesce(socle_procedure_id, public.nil_procedure()))
       in (select s.organization_id, s.socle_org_id, s.socle_procedure_id
             from public.my_permission_pairs('consultation') s)
  );

drop policy if exists request_stats_service on public.request_stats;
create policy request_stats_service on public.request_stats
  for all to service_role using (true) with check (true);

-- ADR-05 : EXISTS direct vers la table mère, pas de ré-énumération des couples.
drop policy if exists intervention_stats_select on public.intervention_stats;
create policy intervention_stats_select on public.intervention_stats
  for select to authenticated
  using (exists (select 1 from public.request_stats s where s.request_id = intervention_stats.request_id));

drop policy if exists intervention_stats_service on public.intervention_stats;
create policy intervention_stats_service on public.intervention_stats
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 4. Alimentation — trigger t31 sur requests
-- ----------------------------------------------------------------------------
-- DEFINER (aucune policy d'écriture cliente sur request_stats). Ne teste
-- JAMAIS is_service_context() (piège current_user en DEFINER, CLAUDE.md).
-- auth.uid() vaut NULL en contexte de service (ingestion, seed) : resolved_by
-- reste NULL, c'est honnête — aucun agent n'a résolu.
create or replace function public.requests_stats_upsert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_instr       timestamptz;
  v_outcome     text;
  v_resolved_by uuid;
begin
  -- Écrêtage : t31 se déclenche aussi sur chaque version+1 et sur
  -- refresh_request_scope_org (potentiellement tout le tenant).
  -- (`old` n'est lu QUE sous tg_op = 'UPDATE' : ifs imbriqués, pas de pari
  -- sur l'ordre d'évaluation d'un AND.)
  if tg_op = 'UPDATE' then
    if new.status             is not distinct from old.status
       and new.socle_scope_org_id is not distinct from old.socle_scope_org_id
       and new.socle_procedure_id is not distinct from old.socle_procedure_id
       and new.closed_at          is not distinct from old.closed_at then
      return null;
    end if;
    select s.instruction_started_at, s.outcome, s.resolved_by
      into v_instr, v_outcome, v_resolved_by
      from public.request_stats s
     where s.request_id = new.id;
  end if;

  -- Première entrée en instruction (INSERT direct en instruction : contexte
  -- de service seulement, la date est celle de la création).
  if new.status = 'en_instruction' and v_instr is null then
    v_instr := case when tg_op = 'INSERT' then new.created_at else now() end;
  end if;

  if new.status in ('annulee', 'resolue_positive', 'resolue_negative') then
    -- Un DÉSARCHIVAGE revient sur le statut terminal sans rien résoudre :
    -- l'issue et son auteur sont ceux de la résolution d'origine.
    if tg_op = 'INSERT' then
      v_outcome     := new.status;
      v_resolved_by := case when new.status like 'resolue_%' then auth.uid() end;
    elsif old.status is distinct from new.status and old.status <> 'archivee' then
      v_outcome     := new.status;
      v_resolved_by := case when new.status like 'resolue_%' then auth.uid() end;
    end if;
  elsif new.status = 'archivee' then
    null;  -- conservés : on n'archive que depuis un terminal
  else
    v_outcome     := null;  -- réouverture (ou jamais résolue)
    v_resolved_by := null;
  end if;

  insert into public.request_stats (
    request_id, organization_id, socle_root_org_id, socle_scope_org_id, socle_procedure_id,
    source, channel, received_at, created_at, current_status,
    instruction_started_at, resolved_at, outcome, resolved_by, updated_at)
  values (
    new.id, new.organization_id, new.socle_root_org_id, new.socle_scope_org_id, new.socle_procedure_id,
    new.source, new.channel, new.received_at, new.created_at, new.status,
    v_instr, new.closed_at, v_outcome, v_resolved_by, now())
  on conflict (request_id) do update set
    organization_id        = excluded.organization_id,
    socle_root_org_id      = excluded.socle_root_org_id,
    socle_scope_org_id     = excluded.socle_scope_org_id,
    socle_procedure_id     = excluded.socle_procedure_id,
    source                 = excluded.source,
    channel                = excluded.channel,
    received_at            = excluded.received_at,
    created_at             = excluded.created_at,
    current_status         = excluded.current_status,
    instruction_started_at = excluded.instruction_started_at,
    resolved_at            = excluded.resolved_at,
    outcome                = excluded.outcome,
    resolved_by            = excluded.resolved_by,
    updated_at             = excluded.updated_at;
  return null;
end;
$$;
revoke execute on function public.requests_stats_upsert() from public, anon, authenticated;

drop trigger if exists t31_requests_stats on public.requests;
create trigger t31_requests_stats
  after insert or update on public.requests
  for each row execute function public.requests_stats_upsert();

-- ----------------------------------------------------------------------------
-- 5. Alimentation — trigger t31 sur request_interventions
-- ----------------------------------------------------------------------------
create or replace function public.request_interventions_stats_upsert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.intervention_stats (
    intervention_id, request_id, organization_id, intervenant_id,
    requested_at, completed_at, completed_on, updated_at)
  values (
    new.id, new.request_id, new.organization_id, new.intervenant_id,
    new.requested_at, new.completed_at, new.completed_on, now())
  on conflict (intervention_id) do update set
    request_id      = excluded.request_id,
    organization_id = excluded.organization_id,
    intervenant_id  = excluded.intervenant_id,
    requested_at    = excluded.requested_at,
    completed_at    = excluded.completed_at,
    completed_on    = excluded.completed_on,
    updated_at      = excluded.updated_at;
  return null;
end;
$$;
revoke execute on function public.request_interventions_stats_upsert() from public, anon, authenticated;

drop trigger if exists t31_request_interventions_stats on public.request_interventions;
create trigger t31_request_interventions_stats
  after insert or update on public.request_interventions
  for each row execute function public.request_interventions_stats_upsert();

-- ----------------------------------------------------------------------------
-- 6. Reconstruction (service) — backfill et réparation
-- ----------------------------------------------------------------------------
-- Relit `requests` et le journal : première entrée en instruction, dernier
-- passage à resolue_* (auteur), issue d'une archivée (`from` du passage à
-- archivee). Motif refresh_request_scope_org. Ne PEUT reconstruire que ce qui
-- existe encore : après purge, les faits déjà écrits font foi.
create or replace function public.rebuild_request_stats(p_request_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with base as (
    select r.*,
           least(
             (select min(e.created_at) from public.request_events e
               where e.request_id = r.id and e.event_type = 'status_changed'
                 and e.payload ->> 'to' = 'en_instruction'),
             (select min(e.created_at) from public.request_events e
               where e.request_id = r.id and e.event_type = 'created'
                 and e.payload ->> 'status' = 'en_instruction')
           ) as v_instr,
           case
             when r.status in ('annulee', 'resolue_positive', 'resolue_negative') then r.status
             when r.status = 'archivee' then
               (select e.payload ->> 'from' from public.request_events e
                 where e.request_id = r.id and e.event_type = 'status_changed'
                   and e.payload ->> 'to' = 'archivee'
                   and e.payload ->> 'from' in ('annulee', 'resolue_positive', 'resolue_negative')
                 order by e.created_at desc limit 1)
           end as v_outcome
      from public.requests r
     where p_request_id is null or r.id = p_request_id
  )
  insert into public.request_stats (
    request_id, organization_id, socle_root_org_id, socle_scope_org_id, socle_procedure_id,
    source, channel, received_at, created_at, current_status,
    instruction_started_at, resolved_at, outcome, resolved_by, updated_at)
  select b.id, b.organization_id, b.socle_root_org_id, b.socle_scope_org_id, b.socle_procedure_id,
         b.source, b.channel, b.received_at, b.created_at, b.status,
         b.v_instr, b.closed_at, b.v_outcome,
         case when b.v_outcome like 'resolue_%' then
           (select e.created_by from public.request_events e
             where e.request_id = b.id and e.event_type = 'status_changed'
               and e.payload ->> 'to' = b.v_outcome
             order by e.created_at desc limit 1)
         end,
         now()
    from base b
  on conflict (request_id) do update set
    organization_id        = excluded.organization_id,
    socle_root_org_id      = excluded.socle_root_org_id,
    socle_scope_org_id     = excluded.socle_scope_org_id,
    socle_procedure_id     = excluded.socle_procedure_id,
    source                 = excluded.source,
    channel                = excluded.channel,
    received_at            = excluded.received_at,
    created_at             = excluded.created_at,
    current_status         = excluded.current_status,
    instruction_started_at = excluded.instruction_started_at,
    resolved_at            = excluded.resolved_at,
    outcome                = excluded.outcome,
    resolved_by            = excluded.resolved_by,
    updated_at             = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.rebuild_request_stats(uuid) is
  'Reconstruit request_stats depuis requests + request_events (une demande, ou tout). service_role uniquement — réparation et backfill.';
revoke execute on function public.rebuild_request_stats(uuid) from public, anon, authenticated;

create or replace function public.rebuild_intervention_stats(p_request_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.intervention_stats (
    intervention_id, request_id, organization_id, intervenant_id,
    requested_at, completed_at, completed_on, updated_at)
  select i.id, i.request_id, i.organization_id, i.intervenant_id,
         i.requested_at, i.completed_at, i.completed_on, now()
    from public.request_interventions i
   where p_request_id is null or i.request_id = p_request_id
  on conflict (intervention_id) do update set
    request_id      = excluded.request_id,
    organization_id = excluded.organization_id,
    intervenant_id  = excluded.intervenant_id,
    requested_at    = excluded.requested_at,
    completed_at    = excluded.completed_at,
    completed_on    = excluded.completed_on,
    updated_at      = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.rebuild_intervention_stats(uuid) is
  'Reconstruit intervention_stats depuis request_interventions. service_role uniquement.';
revoke execute on function public.rebuild_intervention_stats(uuid) from public, anon, authenticated;

-- Backfill : tout ce qui existe aujourd'hui (le jeu ACCM a un journal antidaté,
-- les délais de la démonstration sont réalistes).
do $$
begin
  perform public.rebuild_request_stats();
  perform public.rebuild_intervention_stats();
end $$;

-- ----------------------------------------------------------------------------
-- 7. RPC de lecture — SECURITY INVOKER, bornées par le RLS
-- ----------------------------------------------------------------------------
-- Gabarit contact_request_counts : `security invoker` VOULU, deux agents lisent
-- légitimement deux chiffres différents. ⚠️ Ne jamais les passer en DEFINER.
-- Noms de colonnes OUT DISTINCTS des colonnes lues (paramètres OUT visibles
-- dans le corps en language sql). Filtre `organization_id = p_org_id`
-- explicite : c'est lui qui porte l'index, et qui borne un admin plateforme.
-- Mois et jours : Europe/Paris, la collectivité vit à cette heure.

-- 7a. Demandes reçues par mois (N derniers mois, mois vides rendus à 0)
create or replace function public.stats_requests_by_month(
  p_org_id uuid, p_months integer default 12, p_socle_org_id uuid default null)
returns table (month_key text, request_count bigint)
language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Europe/Paris')
             - make_interval(months => least(greatest(coalesce(p_months, 12), 1), 36) - 1) as first_month,
           date_trunc('month', now() at time zone 'Europe/Paris') as last_month
  ),
  months as (
    select generate_series(b.first_month, b.last_month, interval '1 month') as m from bounds b
  )
  select to_char(m.m, 'YYYY-MM'),
         count(s.request_id)::bigint
    from months m
    left join public.request_stats s
      on s.organization_id = p_org_id
     and s.received_at >= ((select first_month from bounds) at time zone 'Europe/Paris')
     and date_trunc('month', s.received_at at time zone 'Europe/Paris') = m.m
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id)
   group by m.m
   order by m.m;
$$;
comment on function public.stats_requests_by_month(uuid, integer, uuid) is
  'Statistiques : demandes reçues par mois (received_at, Europe/Paris), mois vides à 0. SECURITY INVOKER — borné au périmètre du lecteur.';
revoke execute on function public.stats_requests_by_month(uuid, integer, uuid) from public, anon;
grant  execute on function public.stats_requests_by_month(uuid, integer, uuid) to authenticated;

-- 7b. Demandes reçues par source (le regroupement en canaux vit côté écran)
create or replace function public.stats_requests_by_source(
  p_org_id uuid, p_since timestamptz, p_socle_org_id uuid default null)
returns table (source_code text, request_count bigint)
language sql stable security invoker set search_path = '' as $$
  select s.source, count(*)::bigint
    from public.request_stats s
   where s.organization_id = p_org_id
     and s.received_at >= p_since
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id)
   group by s.source
   order by count(*) desc, s.source;
$$;
comment on function public.stats_requests_by_source(uuid, timestamptz, uuid) is
  'Statistiques : demandes reçues par source (iris, clara, portail-citoyen, partenaires). SECURITY INVOKER.';
revoke execute on function public.stats_requests_by_source(uuid, timestamptz, uuid) from public, anon;
grant  execute on function public.stats_requests_by_source(uuid, timestamptz, uuid) to authenticated;

-- 7c. Demandes reçues par organisme porteur (libellé relu dans le miroir,
--     sans filtre obsoleted_at : un organisme disparu garde son nom)
create or replace function public.stats_requests_by_organization(
  p_org_id uuid, p_since timestamptz)
returns table (org_socle_id uuid, org_name text, request_count bigint)
language sql stable security invoker set search_path = '' as $$
  select s.socle_scope_org_id,
         coalesce(m.name, 'Organisme inconnu'),
         count(*)::bigint
    from public.request_stats s
    left join public.socle_organizations m
      on m.organization_id = s.organization_id and m.socle_id = s.socle_scope_org_id
   where s.organization_id = p_org_id
     and s.received_at >= p_since
   group by s.socle_scope_org_id, m.name
   order by count(*) desc, coalesce(m.name, 'Organisme inconnu');
$$;
comment on function public.stats_requests_by_organization(uuid, timestamptz) is
  'Statistiques : demandes reçues par organisme porteur. SECURITY INVOKER.';
revoke execute on function public.stats_requests_by_organization(uuid, timestamptz) from public, anon;
grant  execute on function public.stats_requests_by_organization(uuid, timestamptz) to authenticated;

-- 7d. Délais moyens (jours, 1 décimale) par organisme : réception → première
--     instruction, réception → résolution (resolue_* seulement : une
--     annulation n'est pas une résolution)
create or replace function public.stats_processing_times(
  p_org_id uuid, p_since timestamptz)
returns table (
  org_socle_id uuid, org_name text,
  avg_days_to_instruction double precision, avg_days_to_resolution double precision,
  request_count bigint)
language sql stable security invoker set search_path = '' as $$
  select s.socle_scope_org_id,
         coalesce(m.name, 'Organisme inconnu'),
         round(avg(extract(epoch from (s.instruction_started_at - s.received_at)) / 86400)::numeric, 1)::double precision,
         round(avg(extract(epoch from (s.resolved_at - s.received_at)) / 86400)
                 filter (where s.outcome in ('resolue_positive', 'resolue_negative'))::numeric, 1)::double precision,
         count(*)::bigint
    from public.request_stats s
    left join public.socle_organizations m
      on m.organization_id = s.organization_id and m.socle_id = s.socle_scope_org_id
   where s.organization_id = p_org_id
     and s.received_at >= p_since
   group by s.socle_scope_org_id, m.name
   order by 4 desc nulls last, 2;
$$;
comment on function public.stats_processing_times(uuid, timestamptz) is
  'Statistiques : délais moyens en jours par organisme (réception → instruction, réception → résolution). SECURITY INVOKER.';
revoke execute on function public.stats_processing_times(uuid, timestamptz) from public, anon;
grant  execute on function public.stats_processing_times(uuid, timestamptz) to authenticated;

-- 7e. Issues (le taux se calcule côté écran : positive / closes)
create or replace function public.stats_outcomes(
  p_org_id uuid, p_since timestamptz, p_socle_org_id uuid default null)
returns table (positive_count bigint, negative_count bigint, cancelled_count bigint, open_count bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where s.outcome = 'resolue_positive')::bigint,
         count(*) filter (where s.outcome = 'resolue_negative')::bigint,
         count(*) filter (where s.outcome = 'annulee')::bigint,
         count(*) filter (where s.outcome is null)::bigint
    from public.request_stats s
   where s.organization_id = p_org_id
     and s.received_at >= p_since
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id);
$$;
comment on function public.stats_outcomes(uuid, timestamptz, uuid) is
  'Statistiques : issues des demandes reçues sur la période (positives, négatives, annulées, en cours). SECURITY INVOKER.';
revoke execute on function public.stats_outcomes(uuid, timestamptz, uuid) from public, anon;
grant  execute on function public.stats_outcomes(uuid, timestamptz, uuid) to authenticated;

-- 7f. Agents ayant le plus résolu (nom inline comme eligible_assignees :
--     user_display_name est DEFINER et révoquée, inutilisable en invoker)
create or replace function public.stats_top_resolvers(
  p_org_id uuid, p_since timestamptz, p_socle_org_id uuid default null, p_limit integer default 10)
returns table (user_id uuid, user_name text, request_count bigint)
language sql stable security invoker set search_path = '' as $$
  select s.resolved_by,
         coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, 'Agent retiré'),
         count(*)::bigint
    from public.request_stats s
    left join public.users u on u.id = s.resolved_by
   where s.organization_id = p_org_id
     and s.received_at >= p_since
     and s.resolved_by is not null
     and s.outcome in ('resolue_positive', 'resolue_negative')
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id)
   group by s.resolved_by, u.first_name, u.last_name, u.email
   order by count(*) desc, 2
   limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;
comment on function public.stats_top_resolvers(uuid, timestamptz, uuid, integer) is
  'Statistiques : agents ayant résolu le plus de demandes (resolue_*) sur la période. SECURITY INVOKER.';
revoke execute on function public.stats_top_resolvers(uuid, timestamptz, uuid, integer) from public, anon;
grant  execute on function public.stats_top_resolvers(uuid, timestamptz, uuid, integer) to authenticated;

-- 7g. Interventions : demandées et réalisées sur la période, délai moyen
--     sollicitation → réalisation (jours, sur les réalisées de la période)
create or replace function public.stats_interventions(
  p_org_id uuid, p_since timestamptz, p_socle_org_id uuid default null)
returns table (requested_count bigint, completed_count bigint, avg_days_to_completion double precision)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where i.requested_at >= p_since)::bigint,
         count(*) filter (where i.completed_at >= p_since)::bigint,
         round(avg(extract(epoch from (i.completed_at - i.requested_at)) / 86400)
                 filter (where i.completed_at >= p_since)::numeric, 1)::double precision
    from public.intervention_stats i
    join public.request_stats s on s.request_id = i.request_id
   where i.organization_id = p_org_id
     and (i.requested_at >= p_since or i.completed_at >= p_since)
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id);
$$;
comment on function public.stats_interventions(uuid, timestamptz, uuid) is
  'Statistiques : interventions demandées et réalisées sur la période, délai moyen de réalisation en jours. SECURITY INVOKER.';
revoke execute on function public.stats_interventions(uuid, timestamptz, uuid) from public, anon;
grant  execute on function public.stats_interventions(uuid, timestamptz, uuid) to authenticated;

-- 7h. Intervenants ayant le plus réalisé d'interventions
create or replace function public.stats_top_intervenants(
  p_org_id uuid, p_since timestamptz, p_socle_org_id uuid default null, p_limit integer default 10)
returns table (user_id uuid, user_name text, intervention_count bigint)
language sql stable security invoker set search_path = '' as $$
  select i.intervenant_id,
         coalesce(nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, 'Agent retiré'),
         count(*)::bigint
    from public.intervention_stats i
    join public.request_stats s on s.request_id = i.request_id
    left join public.users u on u.id = i.intervenant_id
   where i.organization_id = p_org_id
     and i.completed_at >= p_since
     and i.intervenant_id is not null
     and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id)
   group by i.intervenant_id, u.first_name, u.last_name, u.email
   order by count(*) desc, 2
   limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;
comment on function public.stats_top_intervenants(uuid, timestamptz, uuid, integer) is
  'Statistiques : intervenants ayant réalisé le plus d''interventions sur la période. SECURITY INVOKER.';
revoke execute on function public.stats_top_intervenants(uuid, timestamptz, uuid, integer) from public, anon;
grant  execute on function public.stats_top_intervenants(uuid, timestamptz, uuid, integer) to authenticated;
