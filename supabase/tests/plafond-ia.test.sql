-- ============================================================================
-- Tests du plafond d'utilisation IA.
--
-- Les cinq règles tenues ici :
--   1. LE REFUS N'INCRÉMENTE RIEN — l'UPDATE conditionnel de reserve_ai_usage
--      est la porte de concurrence. 0 ligne affectée ⇒ refus, compteur
--      inchangé, fournisseur jamais appelé.
--   2. UN ÉCHEC N'EST JAMAIS FACTURÉ — settle('failed'/'timeout') libère la
--      réservation et ne touche PAS `used_tokens`.
--   3. LE RÈGLEMENT EST IDEMPOTENT — un second settle ne double pas la
--      consommation (retry de l'edge function, ou cron qui double).
--   4. L'ÉCRITURE N'A QU'UNE PORTE — set_ai_usage_quota, réservée à l'admin
--      PLATEFORME. Aucune policy d'écriture cliente sur les trois tables.
--      C'est LA divergence avec Clara, où le navigateur du superadmin fait
--      lui-même l'UPSERT sous une policy RLS.
--   5. LA SENTINELLE '__global__' REND `ON CONFLICT` OPÉRANT — régression
--      Clara (20260617090000) : avec provider NULL, deux enregistrements
--      créaient deux lignes, car deux NULL ne sont jamais égaux pour un UNIQUE.
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur, jamais `exception when
-- others then null` : la leçon de modeles-email.test.sql, où un « permission
-- denied » passait pour un refus légitime.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL
-- editor du dashboard ; le MCP execute_sql est en lecture seule →
-- apply_migration, l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  s_root2  uuid := gen_random_uuid();
  orgA uuid; orgB uuid; p_id uuid;
  u_admin_voirie uuid := gen_random_uuid();  -- administration sur le sous-arbre Voirie
  u_agent        uuid := gen_random_uuid();  -- même tenant, AUCUNE administration
  u_admin_b      uuid := gen_random_uuid();  -- administration sur l'AUTRE tenant
  u_platform     uuid := gen_random_uuid();  -- admin plateforme
  ev1 uuid; ev2 uuid; ev3 uuid;
  v_fail text[] := '{}';
  v_period text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  v_prev   text := to_char((now() at time zone 'utc') - interval '1 month', 'YYYY-MM');
  r record;
  v_int int; v_big bigint; v_big2 bigint; v_bool boolean; v_text text;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin_voirie, 'adminvoirie@o.test', now(), now()),
    (u_agent,        'agent@o.test',       now(), now()),
    (u_admin_b,      'adminb@o.test',      now(), now()),
    (u_platform,     'plateforme@o.test',  now(), now());

  update public.users set is_platform_admin = true where id = u_platform;

  insert into public.organizations (socle_org_id, name) values (s_root,  'Mairie A') returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Mairie B') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_admin_voirie, 'agent'), (orgA, u_agent, 'agent'), (orgB, u_admin_b, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie'), (orgA, s_ccas, s_root, 'CCAS'),
    (orgB, s_root2, null, 'Mairie B');

  -- Administration sur le sous-arbre Voirie SEULEMENT (tenant A).
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Admin Voirie', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_admin_voirie);

  -- Un agent sans administration (profil non-admin).
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Agent Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent);

  -- Administration sur l'autre tenant.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgB, 'Admin B', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root2);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_admin_b);

  -- ==========================================================================
  -- Q1. Aucun plafond ⇒ illimité, et AUCUN compteur n'est créé
  -- ==========================================================================
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 500, u_agent);
  if not r.allowed or r.reason is distinct from 'no_quota_configured' then
    v_fail := v_fail || format('Q1a: sans plafond, allowed=%s reason=%s', r.allowed, r.reason);
  end if;
  if r.event_id is null then
    v_fail := v_fail || 'Q1b: aucun événement journalisé alors que l''appel a eu lieu'::text;
  end if;
  select count(*) into v_int from public.ai_usage_counters where organization_id = orgA;
  if v_int <> 0 then
    v_fail := v_fail || format('Q1c: %s compteur(s) créé(s) sans plafond configuré', v_int);
  end if;
  -- counter_provider NULL dit « rien n'a été décompté ».
  select counter_provider into v_text from public.ai_usage_events where id = r.event_id;
  if v_text is not null then
    v_fail := v_fail || format('Q1d: counter_provider=%s au lieu de NULL', v_text);
  end if;
  -- Le règlement d'un appel hors plafond ne doit toucher aucun compteur.
  perform public.settle_ai_usage(r.event_id, 400, 'completed');
  select count(*) into v_int from public.ai_usage_counters where organization_id = orgA;
  if v_int <> 0 then
    v_fail := v_fail || 'Q1e: le règlement a créé un compteur hors plafond'::text;
  end if;

  -- ==========================================================================
  -- Q2. Plafond posé : la réservation qui dépasse est REFUSÉE sans incrément
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_ai_usage_quota(orgA, 1000);
  execute 'reset role';

  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 600, u_agent);
  if not r.allowed or r.reason is distinct from 'ok' then
    v_fail := v_fail || format('Q2a: la première réservation a été refusée (%s)', r.reason);
  end if;
  ev1 := r.event_id;

  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 600, u_agent);
  if r.allowed or r.reason is distinct from 'quota_exceeded' then
    v_fail := v_fail || format('Q2b: le dépassement a été accepté (allowed=%s)', r.allowed);
  end if;
  if r.event_id is not null then
    v_fail := v_fail || 'Q2c: un refus a laissé une ligne au grand livre'::text;
  end if;
  select used_tokens, reserved_tokens into v_big, v_big2
    from public.ai_usage_counters
   where organization_id = orgA and provider = '__global__' and period = v_period;
  if v_big <> 0 or v_big2 <> 600 then
    v_fail := v_fail || format('Q2d: compteur %s/%s après refus, attendu 0/600', v_big, v_big2);
  end if;

  -- ==========================================================================
  -- Q3. Le règlement corrige par le RÉEL
  -- ==========================================================================
  perform public.settle_ai_usage(ev1, 480, 'completed');
  select used_tokens, reserved_tokens into v_big, v_big2
    from public.ai_usage_counters
   where organization_id = orgA and provider = '__global__' and period = v_period;
  if v_big <> 480 or v_big2 <> 0 then
    v_fail := v_fail || format('Q3a: compteur %s/%s après règlement, attendu 480/0', v_big, v_big2);
  end if;

  -- ==========================================================================
  -- Q4. Un échec n'est JAMAIS facturé
  -- ==========================================================================
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 300, u_agent);
  ev2 := r.event_id;
  perform public.settle_ai_usage(ev2, null, 'failed');
  select used_tokens, reserved_tokens into v_big, v_big2
    from public.ai_usage_counters
   where organization_id = orgA and provider = '__global__' and period = v_period;
  if v_big <> 480 or v_big2 <> 0 then
    v_fail := v_fail || format('Q4a: compteur %s/%s après échec, attendu 480/0 (used intact)', v_big, v_big2);
  end if;
  select actual_tokens into v_big from public.ai_usage_events where id = ev2;
  if v_big is not null then
    v_fail := v_fail || format('Q4b: actual_tokens=%s sur un échec, attendu NULL', v_big);
  end if;

  -- ==========================================================================
  -- Q5. Le règlement est idempotent
  -- ==========================================================================
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 100, u_agent);
  ev3 := r.event_id;
  perform public.settle_ai_usage(ev3, 100, 'completed');
  perform public.settle_ai_usage(ev3, 100, 'completed');
  select used_tokens, reserved_tokens into v_big, v_big2
    from public.ai_usage_counters
   where organization_id = orgA and provider = '__global__' and period = v_period;
  if v_big <> 580 or v_big2 <> 0 then
    v_fail := v_fail || format('Q5a: compteur %s/%s après double règlement, attendu 580/0', v_big, v_big2);
  end if;

  -- ==========================================================================
  -- Q6. Le filet : une réservation orpheline est soldée en timeout
  -- ==========================================================================
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 200, u_agent);
  update public.ai_usage_events set created_at = now() - interval '20 minutes' where id = r.event_id;
  select public.release_stale_ai_reservations(15) into v_int;
  if v_int <> 1 then
    v_fail := v_fail || format('Q6a: %s réservation(s) libérée(s), attendu 1', v_int);
  end if;
  select status into v_text from public.ai_usage_events where id = r.event_id;
  if v_text is distinct from 'timeout' then
    v_fail := v_fail || format('Q6b: statut %s au lieu de timeout', v_text);
  end if;
  select used_tokens, reserved_tokens into v_big, v_big2
    from public.ai_usage_counters
   where organization_id = orgA and provider = '__global__' and period = v_period;
  if v_big <> 580 or v_big2 <> 0 then
    v_fail := v_fail || format('Q6c: compteur %s/%s après timeout, attendu 580/0', v_big, v_big2);
  end if;
  -- Une réservation FRAÎCHE ne doit pas être emportée par le balayage.
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 50, u_agent);
  select public.release_stale_ai_reservations(15) into v_int;
  if v_int <> 0 then
    v_fail := v_fail || format('Q6d: le balayage a emporté %s réservation(s) fraîche(s)', v_int);
  end if;
  perform public.settle_ai_usage(r.event_id, 50, 'completed');

  -- ==========================================================================
  -- Q7. RÉGRESSION CLARA : deux enregistrements ⇒ UNE ligne de plafond
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_ai_usage_quota(orgA, 5000);
  perform public.set_ai_usage_quota(orgA, 7000);
  execute 'reset role';
  select count(*) into v_int from public.ai_usage_quotas
   where organization_id = orgA and provider = '__global__';
  if v_int <> 1 then
    v_fail := v_fail || format('Q7a: %s lignes de plafond au lieu de 1 (ON CONFLICT inopérant)', v_int);
  end if;
  select monthly_limit_tokens into v_big from public.ai_usage_quotas
   where organization_id = orgA and provider = '__global__';
  if v_big <> 7000 then
    v_fail := v_fail || format('Q7b: plafond %s au lieu de 7000', v_big);
  end if;

  -- ==========================================================================
  -- Q8. Un plafond par fournisseur PRIME sur le global
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_ai_usage_quota(orgA, 100, true, 'mistral');
  execute 'reset role';
  -- 100 pour mistral (déjà dépassé par le compteur global ? non : compteur
  -- distinct, provider = 'mistral'). 200 > 100 ⇒ refus.
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 200, u_agent);
  if r.allowed then
    v_fail := v_fail || 'Q8a: le plafond fournisseur n''a pas primé sur le global'::text;
  end if;
  if r.limit_tokens is distinct from 100::bigint then
    v_fail := v_fail || format('Q8b: plafond retenu %s au lieu de 100', r.limit_tokens);
  end if;
  -- Un AUTRE fournisseur retombe sur le global (7000), donc passe.
  select * into r from public.reserve_ai_usage(orgA, 'autre', 'chat', 200, u_agent);
  if not r.allowed or r.limit_tokens is distinct from 7000::bigint then
    v_fail := v_fail || format('Q8c: fournisseur sans plafond dédié : allowed=%s plafond=%s',
      r.allowed, r.limit_tokens);
  end if;
  perform public.settle_ai_usage(r.event_id, 200, 'completed');
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.delete_ai_usage_quota(orgA, 'mistral');
  execute 'reset role';

  -- ==========================================================================
  -- Q9. La période précédente n'influe pas sur la période courante
  -- ==========================================================================
  insert into public.ai_usage_counters (organization_id, provider, period, used_tokens)
    values (orgA, '__global__', v_prev, 999999);
  select * into r from public.reserve_ai_usage(orgA, 'mistral', 'chat', 100, u_agent);
  if not r.allowed then
    v_fail := v_fail || 'Q9a: un compteur du mois précédent a bloqué le mois courant'::text;
  end if;
  perform public.settle_ai_usage(r.event_id, 100, 'completed');

  -- ==========================================================================
  -- E1. Étanchéité CROSS-TENANT
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_ai_usage_quota(orgB, 4242);
  execute 'reset role';
  select * into r from public.reserve_ai_usage(orgB, 'mistral', 'chat', 10, u_admin_b);
  perform public.settle_ai_usage(r.event_id, 10, 'completed');

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_voirie, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.ai_usage_quotas where organization_id = orgB;
  if v_int <> 0 then
    v_fail := v_fail || format('E1a: l''admin du tenant A voit %s plafond(s) du tenant B', v_int);
  end if;
  select count(*) into v_int from public.ai_usage_counters where organization_id = orgB;
  if v_int <> 0 then
    v_fail := v_fail || format('E1b: l''admin du tenant A voit %s compteur(s) du tenant B', v_int);
  end if;
  select count(*) into v_int from public.ai_usage_events where organization_id = orgB;
  if v_int <> 0 then
    v_fail := v_fail || format('E1c: l''admin du tenant A voit %s événement(s) du tenant B', v_int);
  end if;
  -- ...et il voit bien son propre tenant.
  select count(*) into v_int from public.ai_usage_quotas where organization_id = orgA;
  if v_int <> 1 then
    v_fail := v_fail || format('E1d: l''admin du tenant A voit %s plafond(s) du sien, attendu 1', v_int);
  end if;

  -- ==========================================================================
  -- E2. Étanchéité INTRA-TENANT : un agent sans administration ne voit rien
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.ai_usage_quotas where organization_id = orgA;
  if v_int <> 0 then
    v_fail := v_fail || format('E2a: un agent sans administration voit %s plafond(s)', v_int);
  end if;
  select count(*) into v_int from public.ai_usage_counters where organization_id = orgA;
  if v_int <> 0 then
    v_fail := v_fail || format('E2b: un agent sans administration voit %s compteur(s)', v_int);
  end if;
  -- ⚠️ COMPORTEMENT VOULU, épinglé pour qu'un changement soit délibéré :
  -- l'administrateur d'un SOUS-ARBRE (Voirie) voit la consommation du TENANT
  -- ENTIER — même posture que permission_audit_log (docs/droits.md, § Risques
  -- résiduels). Une consommation est un chiffre de gestion du tenant.
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_voirie, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.ai_usage_counters where organization_id = orgA;
  if v_int = 0 then
    v_fail := v_fail || 'E2c: l''admin d''un sous-arbre ne voit AUCUN compteur de son tenant'::text;
  end if;

  -- ==========================================================================
  -- E3. LA DIVERGENCE AVEC CLARA : aucune écriture cliente, même superadmin
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.ai_usage_quotas (organization_id, monthly_limit_tokens)
      values (orgA, 99999);
    v_fail := v_fail || 'E3a: un INSERT client sur ai_usage_quotas a été accepté'::text;
  exception when insufficient_privilege then null;
  when others then
    v_fail := v_fail || format('E3a: refus inattendu (%s / %s)', sqlstate, sqlerrm); end;
  begin
    update public.ai_usage_counters set used_tokens = 0 where organization_id = orgA;
    v_fail := v_fail || 'E3b: un UPDATE client sur ai_usage_counters a été accepté'::text;
  exception when insufficient_privilege then null;
  when others then
    v_fail := v_fail || format('E3b: refus inattendu (%s / %s)', sqlstate, sqlerrm); end;
  begin
    delete from public.ai_usage_events where organization_id = orgA;
    v_fail := v_fail || 'E3c: un DELETE client sur ai_usage_events a été accepté'::text;
  exception when insufficient_privilege then null;
  when others then
    v_fail := v_fail || format('E3c: refus inattendu (%s / %s)', sqlstate, sqlerrm); end;

  -- ==========================================================================
  -- E4. La porte de réglage est réservée à l'admin PLATEFORME
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_voirie, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.set_ai_usage_quota(orgA, 123456);
    v_fail := v_fail || 'E4a: un administrateur de tenant a pu régler le plafond'::text;
  exception when others then
    if sqlerrm not like '%zone superadmin%' then
      v_fail := v_fail || format('E4a: refusé, mais message inattendu (%s)', sqlerrm);
    end if; end;
  begin
    perform public.delete_ai_usage_quota(orgA);
    v_fail := v_fail || 'E4b: un administrateur de tenant a pu retirer le plafond'::text;
  exception when others then
    if sqlerrm not like '%zone superadmin%' then
      v_fail := v_fail || format('E4b: refusé, mais message inattendu (%s)', sqlerrm);
    end if; end;
  -- Le plafond n'a pas bougé.
  execute 'reset role';
  select monthly_limit_tokens into v_big from public.ai_usage_quotas
   where organization_id = orgA and provider = '__global__';
  if v_big is distinct from 7000::bigint then
    v_fail := v_fail || format('E4c: le plafond vaut %s après refus, attendu 7000', v_big);
  end if;
  -- ...et l'admin plateforme, lui, passe.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.set_ai_usage_quota(orgA, 8000);
  exception when others then
    v_fail := v_fail || format('E4d: l''admin plateforme a été refusé (%s)', sqlerrm); end;
  -- Un plafond nul ou négatif est refusé, message explicite.
  begin
    perform public.set_ai_usage_quota(orgA, 0);
    v_fail := v_fail || 'E4e: un plafond de 0 a été accepté'::text;
  exception when others then
    if sqlerrm not like '%strictement positif%' then
      v_fail := v_fail || format('E4e: refusé, mais message inattendu (%s)', sqlerrm);
    end if; end;

  -- ==========================================================================
  -- E5. Le cycle d'appel est fermé aux clients
  -- ==========================================================================
  execute 'reset role';
  select has_function_privilege('authenticated',
    'public.reserve_ai_usage(uuid,text,text,bigint,uuid,uuid,uuid)', 'execute') into v_bool;
  if v_bool then
    v_fail := v_fail || 'E5a: authenticated peut exécuter reserve_ai_usage'::text;
  end if;
  select has_function_privilege('authenticated',
    'public.settle_ai_usage(uuid,bigint,text)', 'execute') into v_bool;
  if v_bool then
    v_fail := v_fail || 'E5b: authenticated peut exécuter settle_ai_usage'::text;
  end if;
  select has_function_privilege('authenticated',
    'public.release_stale_ai_reservations(int)', 'execute') into v_bool;
  if v_bool then
    v_fail := v_fail || 'E5c: authenticated peut exécuter release_stale_ai_reservations'::text;
  end if;
  select has_table_privilege('authenticated', 'public.ai_usage_quotas', 'insert') into v_bool;
  if v_bool then
    v_fail := v_fail || 'E5d: authenticated a le privilège INSERT sur ai_usage_quotas'::text;
  end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (plafond IA) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
