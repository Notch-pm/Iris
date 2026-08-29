-- ============================================================================
-- Plafond d'utilisation IA — les cinq fonctions.
--
-- Deux familles, deux habilitations :
--
--   • LE CYCLE D'UN APPEL — reserve → (appel fournisseur) → settle, plus le
--     filet release_stale. Réservé au `service_role` : ces fonctions sont
--     appelées par l'edge function, jamais par un navigateur.
--
--   • LE RÉGLAGE DU PLAFOND — set / delete. Ouvertes à `authenticated`, mais
--     la garde est DANS la fonction : `is_platform_admin()`. Le plafond est le
--     levier de maîtrise des coûts côté éditeur, pas un paramètre métier
--     délégué aux collectivités.
--
-- ⚠️ PIÈGE `SECURITY DEFINER` / `current_user` (docs/droits.md, vérifié
-- empiriquement le 2026-08-22) : à l'intérieur d'une fonction DEFINER,
-- `current_user` devient le propriétaire, donc `is_service_context()` y vaut
-- TOUJOURS vrai — y compris pour un vrai client authentifié. La garde ci-
-- dessous s'appuie sur `is_platform_admin()`, fondée sur `auth.uid()` (GUC
-- `request.jwt.claims`), insensible au changement de `current_user`. C'est
-- exactement l'usage prescrit.
--
-- ⚠️ Les REVOKE sont dans CETTE migration, et doivent être re-posés à chaque
-- `CREATE OR REPLACE` : le replace re-grante PUBLIC (piège vécu chez Clara).
--
-- LA CONCURRENCE tient en un seul UPDATE conditionnel — voir reserve_ai_usage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- reserve_ai_usage — la porte de concurrence.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_ai_usage(
  p_org_id             uuid,
  p_provider           text,
  p_resource_type      text,
  p_estimated_tokens   bigint,
  p_user_id            uuid,
  p_request_id         uuid default null,
  p_socle_procedure_id uuid default null
) returns table (
  event_id        uuid,
  allowed         boolean,
  reason          text,
  limit_tokens    bigint,
  used_tokens     bigint,
  reserved_tokens bigint
)
language plpgsql security definer set search_path = '' as $fn$
declare
  -- Période en UTC, explicitement : le libellé français calculé côté
  -- TypeScript (`_shared/ai/quota.ts`) doit désigner LA MÊME période, et il
  -- la calcule en UTC. Un décalage ferait annoncer « renouvelé le 1er
  -- octobre » alors que la période SQL est encore août.
  v_period   text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_estimate bigint := greatest(coalesce(p_estimated_tokens, 0), 0);
  v_quota    public.ai_usage_quotas%rowtype;
  v_event    uuid;
  v_rows     int;
  v_used     bigint;
  v_reserved bigint;
begin
  -- Plafond effectif : un plafond du fournisseur précis PRIME sur le global.
  select q.* into v_quota
    from public.ai_usage_quotas q
   where q.organization_id = p_org_id
     and q.provider in (p_provider, '__global__')
     and q.is_active
   order by (q.provider = p_provider) desc
   limit 1;

  -- Aucun plafond (ou désactivé) ⇒ ILLIMITÉ. C'est ce qui permet un
  -- déploiement progressif : un tenant sans ligne de plafond n'est pas cassé
  -- par l'arrivée de l'assistant. L'appel est journalisé (on veut savoir ce
  -- qui a été consommé même hors plafond) mais aucun compteur n'est touché,
  -- et `counter_provider` reste NULL pour le dire.
  if v_quota.id is null then
    insert into public.ai_usage_events (
      organization_id, provider, counter_provider, resource_type, status,
      estimated_tokens, period, request_id, socle_procedure_id, created_by
    ) values (
      p_org_id, p_provider, null, p_resource_type, 'reserved',
      v_estimate, v_period, p_request_id, p_socle_procedure_id, p_user_id
    ) returning id into v_event;
    return query select v_event, true, 'no_quota_configured'::text,
                        null::bigint, null::bigint, null::bigint;
    return;
  end if;

  -- Le compteur de la période. `do nothing` : le passage au mois suivant crée
  -- naturellement une ligne, sans job de reset.
  insert into public.ai_usage_counters (organization_id, provider, period)
       values (p_org_id, v_quota.provider, v_period)
  on conflict (organization_id, provider, period) do nothing;

  -- ── LE point de concurrence ────────────────────────────────────────────
  -- UN SEUL UPDATE conditionnel. Postgres prend le verrou de ligne dès
  -- l'évaluation du WHERE : deux transactions concurrentes sur la même ligne
  -- se sérialisent d'elles-mêmes (MVCC standard, valable dès READ COMMITTED —
  -- ni SERIALIZABLE ni verrou consultatif). Si 0 ligne est affectée, le
  -- plafond est atteint : refus SANS incrément et SANS avoir appelé le
  -- fournisseur.
  update public.ai_usage_counters c
     set reserved_tokens = c.reserved_tokens + v_estimate,
         updated_at      = now()
   where c.organization_id = p_org_id
     and c.provider        = v_quota.provider
     and c.period          = v_period
     and (c.used_tokens + c.reserved_tokens + v_estimate) <= v_quota.monthly_limit_tokens;
  get diagnostics v_rows = row_count;

  select c.used_tokens, c.reserved_tokens into v_used, v_reserved
    from public.ai_usage_counters c
   where c.organization_id = p_org_id
     and c.provider        = v_quota.provider
     and c.period          = v_period;

  if v_rows = 0 then
    -- Refus. AUCUNE ligne de journal : le grand livre recense des APPELS, et
    -- un appel refusé n'a pas eu lieu. Le compteur dit déjà l'histoire
    -- (consommé + réservé au plafond), et l'edge function répond 429.
    return query select null::uuid, false, 'quota_exceeded'::text,
                        v_quota.monthly_limit_tokens, v_used, v_reserved;
    return;
  end if;

  insert into public.ai_usage_events (
    organization_id, provider, counter_provider, resource_type, status,
    estimated_tokens, period, request_id, socle_procedure_id, created_by
  ) values (
    p_org_id, p_provider, v_quota.provider, p_resource_type, 'reserved',
    v_estimate, v_period, p_request_id, p_socle_procedure_id, p_user_id
  ) returning id into v_event;

  return query select v_event, true, 'ok'::text,
                      v_quota.monthly_limit_tokens, v_used, v_reserved;
end $fn$;

comment on function public.reserve_ai_usage(uuid, text, text, bigint, uuid, uuid, uuid) is
  'Réserve des jetons AVANT l''appel fournisseur. UN seul UPDATE conditionnel = la sérialisation. 0 ligne ⇒ refus sans incrément. Aucun plafond configuré ⇒ illimité.';

-- ----------------------------------------------------------------------------
-- settle_ai_usage — le règlement, idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.settle_ai_usage(
  p_event_id      uuid,
  p_actual_tokens bigint,
  p_status        text
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_event  public.ai_usage_events%rowtype;
  v_actual bigint;
begin
  if p_status not in ('completed', 'failed', 'timeout') then
    raise exception 'Statut de règlement invalide : %', p_status using errcode = '22023';
  end if;

  -- Idempotence : on ne transitionne QUE depuis 'reserved'. Un second appel
  -- (retry de l'edge function, balayage cron qui double un règlement) ne
  -- double donc jamais la consommation.
  select e.* into v_event
    from public.ai_usage_events e
   where e.id = p_event_id and e.status = 'reserved'
   for update;
  if v_event.id is null then
    return;
  end if;

  v_actual := greatest(coalesce(p_actual_tokens, v_event.estimated_tokens), 0);

  update public.ai_usage_events
     set status        = p_status,
         actual_tokens = case when p_status = 'completed' then v_actual else null end,
         settled_at    = now()
   where id = p_event_id;

  -- Aucun compteur à corriger quand l'appel n'a rien réservé (pas de plafond).
  if v_event.counter_provider is null then
    return;
  end if;

  if p_status = 'completed' then
    update public.ai_usage_counters c
       set reserved_tokens = greatest(c.reserved_tokens - v_event.estimated_tokens, 0),
           used_tokens     = c.used_tokens + v_actual,
           updated_at      = now()
     where c.organization_id = v_event.organization_id
       and c.provider        = v_event.counter_provider
       and c.period          = v_event.period;
  else
    -- Échec / timeout : la réservation est LIBÉRÉE et `used_tokens` n'est
    -- JAMAIS touché. Un appel qui n'a pas abouti n'est pas facturé au tenant.
    update public.ai_usage_counters c
       set reserved_tokens = greatest(c.reserved_tokens - v_event.estimated_tokens, 0),
           updated_at      = now()
     where c.organization_id = v_event.organization_id
       and c.provider        = v_event.counter_provider
       and c.period          = v_event.period;
  end if;
end $fn$;

comment on function public.settle_ai_usage(uuid, bigint, text) is
  'Solde une réservation. Idempotent (ne transitionne que depuis reserved). completed ⇒ used += réel ; failed/timeout ⇒ réservation libérée, used JAMAIS touché.';

-- ----------------------------------------------------------------------------
-- release_stale_ai_reservations — le filet.
-- ----------------------------------------------------------------------------
create or replace function public.release_stale_ai_reservations(
  p_max_age_minutes int default 15
) returns int
language plpgsql security definer set search_path = '' as $fn$
declare
  v_id    uuid;
  v_count int := 0;
begin
  -- Une edge function peut mourir entre la réservation et le règlement
  -- (déploiement, timeout de plateforme, onglet fermé). Sans ce balayage, sa
  -- réservation resterait posée jusqu'à la fin du mois et rognerait le
  -- plafond pour rien.
  for v_id in
    select e.id
      from public.ai_usage_events e
     where e.status = 'reserved'
       and e.created_at < now() - make_interval(mins => greatest(p_max_age_minutes, 1))
     order by e.created_at
     for update skip locked
  loop
    perform public.settle_ai_usage(v_id, null, 'timeout');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $fn$;

comment on function public.release_stale_ai_reservations(int) is
  'Solde en timeout les réservations orphelines (edge function morte entre reserve et settle). Appelée par le job cron release-stale-ai-reservations.';

-- ----------------------------------------------------------------------------
-- set_ai_usage_quota / delete_ai_usage_quota — l'UNIQUE porte d'écriture.
-- ----------------------------------------------------------------------------
create or replace function public.set_ai_usage_quota(
  p_org_id               uuid,
  p_monthly_limit_tokens bigint,
  p_is_active            boolean default true,
  p_provider             text default '__global__'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_provider text := coalesce(nullif(btrim(p_provider), ''), '__global__');
  v_row      public.ai_usage_quotas%rowtype;
begin
  -- Voir l'en-tête : `is_platform_admin()` et surtout PAS `is_service_context()`.
  if not public.is_platform_admin() then
    raise exception 'Le plafond d''utilisation IA se règle depuis la zone superadmin.'
      using errcode = '42501';
  end if;
  if coalesce(p_monthly_limit_tokens, 0) <= 0 then
    raise exception 'Le plafond doit être un nombre de jetons strictement positif.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'Organisation introuvable.' using errcode = '23503';
  end if;

  insert into public.ai_usage_quotas (
    organization_id, provider, monthly_limit_tokens, is_active, updated_at, updated_by
  ) values (
    p_org_id, v_provider, p_monthly_limit_tokens, coalesce(p_is_active, true), now(), auth.uid()
  )
  -- La sentinelle rend ce ON CONFLICT opérant — avec provider NULL il ne
  -- rattrapait rien et empilait les lignes (dette Clara).
  on conflict (organization_id, provider) do update set
    monthly_limit_tokens = excluded.monthly_limit_tokens,
    is_active            = excluded.is_active,
    updated_at           = now(),
    updated_by           = excluded.updated_by
  returning * into v_row;

  return jsonb_build_object(
    'organization_id', v_row.organization_id,
    'provider', v_row.provider,
    'monthly_limit_tokens', v_row.monthly_limit_tokens,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at
  );
end $fn$;

comment on function public.set_ai_usage_quota(uuid, bigint, boolean, text) is
  'Pose ou modifie le plafond IA d''un tenant. Admin plateforme UNIQUEMENT (garde dans la fonction) — les tables n''ont aucune policy d''écriture cliente.';

create or replace function public.delete_ai_usage_quota(
  p_org_id   uuid,
  p_provider text default '__global__'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_provider text := coalesce(nullif(btrim(p_provider), ''), '__global__');
  v_count    int;
begin
  if not public.is_platform_admin() then
    raise exception 'Le plafond d''utilisation IA se règle depuis la zone superadmin.'
      using errcode = '42501';
  end if;
  delete from public.ai_usage_quotas q
   where q.organization_id = p_org_id and q.provider = v_provider;
  get diagnostics v_count = row_count;
  -- Les compteurs et le grand livre SURVIVENT : retirer un plafond n'efface
  -- pas ce qui a été consommé.
  return jsonb_build_object('removed', v_count);
end $fn$;

comment on function public.delete_ai_usage_quota(uuid, text) is
  'Retire le plafond IA d''un tenant (consommation redevient illimitée). Admin plateforme UNIQUEMENT. Les compteurs et le journal sont conservés.';

-- ----------------------------------------------------------------------------
-- Privilèges — à re-poser à CHAQUE CREATE OR REPLACE de ces fonctions.
-- ----------------------------------------------------------------------------
revoke execute on function public.reserve_ai_usage(uuid, text, text, bigint, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.settle_ai_usage(uuid, bigint, text)
  from public, anon, authenticated;
-- release_stale : AUCUN grant. Le job cron s'exécute comme postgres,
-- propriétaire de la fonction — il n'a besoin d'aucun privilège explicite.
revoke execute on function public.release_stale_ai_reservations(int)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_usage(uuid, text, text, bigint, uuid, uuid, uuid)
  to service_role;
grant execute on function public.settle_ai_usage(uuid, bigint, text)
  to service_role;

-- Les deux portes de réglage restent appelables par un client : la garde est
-- DANS la fonction, et un non-superadmin y reçoit un refus explicite plutôt
-- qu'un « permission denied » opaque.
revoke execute on function public.set_ai_usage_quota(uuid, bigint, boolean, text) from public, anon;
revoke execute on function public.delete_ai_usage_quota(uuid, text) from public, anon;
grant execute on function public.set_ai_usage_quota(uuid, bigint, boolean, text) to authenticated;
grant execute on function public.delete_ai_usage_quota(uuid, text) to authenticated;
