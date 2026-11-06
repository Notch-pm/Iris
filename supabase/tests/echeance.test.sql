-- ============================================================================
-- Tests de l'ÉCHÉANCE CALCULÉE (migration 20261106100000, B16 — PO 2026-11-06).
--
--   E1. Le calcul pur : chaque unité (jour, semaine, mois, jours ouvrés qui
--       enjambent un week-end), le défaut, le jour de réception pris à Paris.
--   E2. À l'insertion : défaut de la collectivité, délai de la démarche (cache),
--       `received_at` antidaté, valeur fournie par l'appelant ÉCRASÉE.
--   E3. Immuable : UPDATE refusé en contexte de service ET pour un client
--       détenant l'instruction ; une mise en attente laisse l'échéance intacte.
--   E4. Alertes : « proche » à l'instructeur, « dépassée » au périmètre
--       (instruction, pas la consultation seule) faute d'instructeur, une seule
--       fois par motif ; demande close ou lointaine ignorée.
--   E5. Fonctions hors de portée des clients.
--
-- Exécution : bloc DO, contexte postgres — le `raise exception` final annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  org1 uuid;
  proc_d1 uuid := gen_random_uuid();  -- sans délai annoncé
  proc_d2 uuid := gen_random_uuid();  -- 2 semaines
  snap1 jsonb;
  snap2 jsonb;
  u_agent   uuid := gen_random_uuid();  -- instruction + clôture
  u_consult uuid := gen_random_uuid();  -- consultation seule
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r_soon uuid; r_late uuid; r_closed uuid; r_far uuid;
  v_fail text[] := '{}';
  v_ts   timestamptz;
  v_int  int;
  v_n    int;
  paris  text := 'Europe/Paris';
begin
  -- ==========================================================================
  -- E1. Calcul pur
  -- ==========================================================================
  -- Réception le vendredi 6 novembre 2026 à 10:00 (Paris).
  v_ts := timestamp '2026-11-06 10:00' at time zone paris;
  if public.request_due_at(v_ts, 10, 'jour', 15) <> timestamp '2026-11-16 23:59:59' at time zone paris then
    v_fail := v_fail || format('E1a: jour %s', public.request_due_at(v_ts, 10, 'jour', 15)); end if;
  if public.request_due_at(v_ts, 2, 'semaine', 15) <> timestamp '2026-11-20 23:59:59' at time zone paris then
    v_fail := v_fail || format('E1b: semaine %s', public.request_due_at(v_ts, 2, 'semaine', 15)); end if;
  -- 10 jours ouvrés depuis un vendredi : lundi 9 … vendredi 13 (5), lundi 16 … vendredi 20 (10).
  if public.request_due_at(v_ts, 10, 'jour_ouvre', 15) <> timestamp '2026-11-20 23:59:59' at time zone paris then
    v_fail := v_fail || format('E1c: jours ouvres %s', public.request_due_at(v_ts, 10, 'jour_ouvre', 15)); end if;
  -- 1 jour ouvré depuis un vendredi : le lundi.
  if public.request_due_at(v_ts, 1, 'jour_ouvre', 15) <> timestamp '2026-11-09 23:59:59' at time zone paris then
    v_fail := v_fail || format('E1d: 1 jour ouvre %s', public.request_due_at(v_ts, 1, 'jour_ouvre', 15)); end if;
  -- Mois : fin de mois bornée (31 janvier + 1 mois = 28 février).
  if public.request_due_at(timestamp '2026-01-31 10:00' at time zone paris, 1, 'mois', 15)
       <> timestamp '2026-02-28 23:59:59' at time zone paris then
    v_fail := v_fail || 'E1e: mois en fin de mois'::text; end if;
  -- Défaut : sans délai, ou unité absente (jamais déduite), ou valeur hors bornes.
  if public.request_due_at(v_ts, null, null, 15) <> timestamp '2026-11-21 23:59:59' at time zone paris
     or public.request_due_at(v_ts, 10, null, 15) <> timestamp '2026-11-21 23:59:59' at time zone paris
     or public.request_due_at(v_ts, 0, 'jour', 20) <> timestamp '2026-11-26 23:59:59' at time zone paris then
    v_fail := v_fail || 'E1f: defaut'::text; end if;
  -- Le jour de réception est celui de PARIS : 23:30 UTC le 6 = le 7 à Paris.
  if public.request_due_at(timestamptz '2026-11-06 23:30:00+00', null, null, 15)
       <> timestamp '2026-11-22 23:59:59' at time zone paris then
    v_fail := v_fail || 'E1g: jour de reception a Paris'::text; end if;

  -- ==========================================================================
  -- Décor
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@echeance.test', now(), now()), (u_consult, 'consult@echeance.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Echeance') returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_agent, 'agent'), (org1, u_consult, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name,
                                            processing_time_value, processing_time_unit) values
    (proc_d1, org1, s_root, 'Sans delai', null, null),
    (proc_d2, org1, s_root, 'Deux semaines', 2, 'semaine');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_d1, s_voirie), (org1, proc_d2, s_voirie);
  snap1 := jsonb_build_object('id', proc_d1::text, 'name', 'Sans delai');
  snap2 := jsonb_build_object('id', proc_d2::text, 'name', 'Deux semaines');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Agent', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, true, true, true), (p_id, proc_d2, true, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_agent);
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Lecteur', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, false, false, false);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_consult);

  -- ==========================================================================
  -- E2. À l'insertion
  -- ==========================================================================
  -- r1 : défaut de la collectivité (15), une échéance fournie est écrasée.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id,
                               received_at, due_at)
    values (org1, 'Defaut', proc_d1, snap1, s_voirie, v_ts, now() + interval '400 days') returning id into r1;
  if (select due_at from public.requests where id = r1) <> timestamp '2026-11-21 23:59:59' at time zone paris then
    v_fail := v_fail || format('E2a: r1 %s', (select due_at from public.requests where id = r1)); end if;
  -- r2 : délai de la démarche (2 semaines).
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, received_at)
    values (org1, 'Deux semaines', proc_d2, snap2, s_voirie, v_ts) returning id into r2;
  if (select due_at from public.requests where id = r2) <> timestamp '2026-11-20 23:59:59' at time zone paris then
    v_fail := v_fail || format('E2b: r2 %s', (select due_at from public.requests where id = r2)); end if;
  -- r3 : défaut propre à la collectivité (20 jours).
  update public.organizations set default_due_days = 20 where id = org1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, received_at)
    values (org1, 'Defaut 20', proc_d1, snap1, s_voirie, v_ts) returning id into r3;
  if (select due_at from public.requests where id = r3) <> timestamp '2026-11-26 23:59:59' at time zone paris then
    v_fail := v_fail || format('E2c: r3 %s', (select due_at from public.requests where id = r3)); end if;
  update public.organizations set default_due_days = 15 where id = org1;

  -- ==========================================================================
  -- E3. Immuable
  -- ==========================================================================
  begin
    update public.requests set due_at = now() where id = r1;
    v_fail := v_fail || 'E3a: due_at modifiee en contexte de service'::text;
  exception when others then
    if sqlerrm not like '%due_at%' then v_fail := v_fail || format('E3a: %s', sqlerrm); end if;
  end;
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id = r2;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.requests set due_at = now() + interval '90 days' where id = r2;
    v_fail := v_fail || 'E3b: due_at modifiee par un instructeur'::text;
  exception when others then
    if sqlerrm not like '%due_at%' then v_fail := v_fail || format('E3b: %s', sqlerrm); end if;
  end;
  update public.requests set status = 'en_attente' where id = r2;
  reset role;
  if (select due_at from public.requests where id = r2) <> timestamp '2026-11-20 23:59:59' at time zone paris then
    v_fail := v_fail || 'E3c: la mise en attente a touche l''echeance'::text; end if;

  -- ==========================================================================
  -- E4. Alertes
  -- ==========================================================================
  -- r_soon : reçue il y a 13 jours (défaut 15) → 2 jours restants, affectée à u_agent.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, received_at)
    values (org1, 'Bientot', proc_d1, snap1, s_voirie, now() - interval '13 days') returning id into r_soon;
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id = r_soon;
  -- r_late : reçue il y a 20 jours, sans instructeur → périmètre.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, received_at)
    values (org1, 'En retard', proc_d1, snap1, s_voirie, now() - interval '20 days') returning id into r_late;
  -- r_closed : en retard mais close.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, received_at)
    values (org1, 'Close', proc_d1, snap1, s_voirie, now() - interval '20 days') returning id into r_closed;
  update public.requests set status = 'resolue_negative', closure_motif = 'irrecevable' where id = r_closed;
  -- r_far : reçue aujourd'hui → 15 jours.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Lointaine', proc_d1, snap1, s_voirie) returning id into r_far;

  -- Les demandes du décor des autres tenants peuvent aussi être alertées : on
  -- ne compte que celles de ce tenant.
  perform public.notify_request_deadlines();

  select count(*) into v_int from public.notifications
   where request_id = r_soon and kind = 'deadline_soon' and user_id = u_agent;
  if v_int <> 1 then v_fail := v_fail || format('E4a: %s alerte(s) proche pour l''instructeur', v_int); end if;
  select count(*) into v_int from public.notifications
   where request_id = r_late and kind = 'deadline_overdue' and user_id = u_agent;
  if v_int <> 1 then v_fail := v_fail || format('E4b: %s alerte(s) depassee pour le perimetre', v_int); end if;
  select count(*) into v_int from public.notifications where request_id = r_late and user_id = u_consult;
  if v_int <> 0 then v_fail := v_fail || 'E4c: la consultation seule a ete alertee'::text; end if;
  select count(*) into v_int from public.notifications
   where request_id in (r_closed, r_far, r1, r3) and kind in ('deadline_soon', 'deadline_overdue');
  if v_int <> 0 then v_fail := v_fail || format('E4d: %s alerte(s) sur une demande close ou lointaine', v_int); end if;
  select (payload ->> 'days')::int into v_int from public.notifications
   where request_id = r_soon and kind = 'deadline_soon';
  if v_int is distinct from 2 then v_fail := v_fail || format('E4e: jours restants dans le payload = %s', v_int); end if;

  -- Second passage : rien de neuf.
  perform public.notify_request_deadlines();
  select count(*) into v_n from public.notifications
   where request_id in (r_soon, r_late) and kind in ('deadline_soon', 'deadline_overdue');
  if v_n <> 2 then v_fail := v_fail || format('E4f: %s alertes apres deux passages (2 attendues)', v_n); end if;

  -- ==========================================================================
  -- E5. Privilèges
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.notify_request_deadlines()', 'execute')
     or has_function_privilege('anon', 'public.notify_request_deadlines()', 'execute')
     or has_function_privilege('authenticated', 'public.requests_set_due_at()', 'execute') then
    v_fail := v_fail || 'E5a: fonction d''echeance executable par un client'::text; end if;
  set local role authenticated;
  begin
    perform 1 from public.request_deadline_alerts;
    get diagnostics v_int = row_count;
    if v_int > 0 then v_fail := v_fail || 'E5b: request_deadline_alerts lisible par un client'::text; end if;
  exception when others then null;  -- refus d'accès : attendu aussi
  end;
  reset role;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (echeance) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
