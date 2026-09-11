-- ============================================================================
-- Tableau de bord — flux mensuels (2026-09-19).
--
-- L'accueil (motif Clara `Dashboard.tsx`) affiche trois grands indicateurs et
-- leur équivalent du mois précédent : demandes REÇUES, demandes MISES EN
-- INSTRUCTION, demandes INSTRUITES (résolues positivement ou négativement).
-- Une seule RPC, lue dans `request_stats` (faits insensibles à la purge,
-- 20260918100000), SECURITY INVOKER : les chiffres couvrent exactement les
-- couples (organisme, démarche) que le lecteur a le droit de consulter —
-- « l'ensemble des organisations auxquelles l'utilisateur a accès ».
--
-- Trois FLUX datés par leur jalon (réception, première instruction, résolution)
-- et non trois stocks : c'est ce qui rend « M-1 » comparable — un stock « en
-- cours d'instruction » n'a pas d'équivalent au mois précédent sans historique.
-- ============================================================================

create or replace function public.stats_monthly_flows(
  p_org_id uuid, p_months integer default 2, p_socle_org_id uuid default null)
returns table (month_key text, received_count bigint, instruction_count bigint, resolved_count bigint)
language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Europe/Paris')
             - make_interval(months => least(greatest(coalesce(p_months, 2), 1), 36) - 1) as first_month,
           date_trunc('month', now() at time zone 'Europe/Paris') as last_month
  ),
  months as (
    select generate_series(b.first_month, b.last_month, interval '1 month') as m from bounds b
  ),
  facts as (
    select s.received_at, s.instruction_started_at, s.resolved_at, s.outcome
      from public.request_stats s
     where s.organization_id = p_org_id
       and (p_socle_org_id is null or s.socle_scope_org_id = p_socle_org_id)
       and (
         s.received_at            >= ((select first_month from bounds) at time zone 'Europe/Paris')
         or s.instruction_started_at >= ((select first_month from bounds) at time zone 'Europe/Paris')
         or s.resolved_at          >= ((select first_month from bounds) at time zone 'Europe/Paris')
       )
  )
  select to_char(m.m, 'YYYY-MM'),
         (select count(*) from facts f
           where date_trunc('month', f.received_at at time zone 'Europe/Paris') = m.m)::bigint,
         (select count(*) from facts f
           where date_trunc('month', f.instruction_started_at at time zone 'Europe/Paris') = m.m)::bigint,
         (select count(*) from facts f
           where f.outcome in ('resolue_positive', 'resolue_negative')
             and date_trunc('month', f.resolved_at at time zone 'Europe/Paris') = m.m)::bigint
    from months m
   order by m.m;
$$;
comment on function public.stats_monthly_flows(uuid, integer, uuid) is
  'Tableau de bord : par mois (Europe/Paris), demandes reçues, mises en instruction (première entrée), instruites (resolue_*). SECURITY INVOKER — borné au périmètre du lecteur.';
revoke execute on function public.stats_monthly_flows(uuid, integer, uuid) from public, anon;
grant  execute on function public.stats_monthly_flows(uuid, integer, uuid) to authenticated;
