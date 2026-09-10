-- ============================================================================
-- Tests du canal PUSH (Web Push) — migration 20260915100000.
--
-- Ce qu'on vérifie : la décision à l'insertion (t10 — pending ssi in-app ET
-- un appareil actif), la reprise d'un endpoint par son nouveau titulaire, la
-- boîte d'envoi (renoncements, réclamation atomique, règlement, abandon) et
-- l'étanchéité RLS de `push_subscriptions`.
--
-- Exécution : bloc DO en lecture-écriture (SQL editor, ou apply_migration —
-- le MCP execute_sql est en lecture seule). L'échec final est VOLONTAIRE :
-- il annule la transaction, aucune donnée n'est conservée.
-- ============================================================================

do $main$
declare
  s_root      uuid := gen_random_uuid();
  s_voirie    uuid := gen_random_uuid();
  org1        uuid;
  proc_d1     uuid := gen_random_uuid();
  snap_d1     jsonb;
  u_alex      uuid := gen_random_uuid();  -- l'auteur des gestes
  u_camille   uuid := gen_random_uuid();  -- l'affectataire, qui inscrit ses appareils
  u_dominique uuid := gen_random_uuid();  -- témoin du fan-out, sans appareil
  p_id        uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  n_id        uuid;
  sub_a       uuid; sub_b uuid; sub_x uuid;
  ep_a        text := 'https://push.example/ep/' || gen_random_uuid();
  ep_b        text := 'https://push.example/ep/' || gen_random_uuid();
  ep_x        text := 'https://push.example/ep/' || gen_random_uuid();
  v_fail  text[] := '{}';
  v_int   int;
  v_text  text;
  v_rec   record;
begin
  -- ==========================================================================
  -- MISE EN PLACE (décor de notifications-email.test.sql)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,      'alex@push.test',      now(), now()),
    (u_camille,   'camille@push.test',   now(), now()),
    (u_dominique, 'dominique@push.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Push')
    returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_alex, 'agent'), (org1, u_camille, 'agent'), (org1, u_dominique, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc_d1, org1, s_root, 'Voirie D1');
  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Voirie D1');
  -- Garde t18 : la démarche doit être activée pour l'organisme porteur.
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (org1, proc_d1, s_voirie);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Camille-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_camille);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Dominique-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_dominique);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  -- ==========================================================================
  -- T1. Sans appareil → 'skipped' (la ligne existe pour le volet)
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R1', proc_d1, snap_d1, s_voirie, u_camille) returning id into r1;

  select in_app, push_status into v_rec from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'assigned';
  if v_rec.in_app is distinct from true or v_rec.push_status is distinct from 'skipped' then
    v_fail := v_fail || format('T1: sans appareil (in_app=%s, push=%s)', v_rec.in_app, v_rec.push_status); end if;

  -- ==========================================================================
  -- T2. Camille inscrit un appareil → 'pending'
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  sub_a := public.register_push_subscription(ep_a, 'p256dh-a', 'auth-a', 'Android · Chrome');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R2', proc_d1, snap_d1, s_voirie, u_camille) returning id into r2;

  select push_status into v_text from public.notifications
   where request_id = r2 and user_id = u_camille and kind = 'assigned';
  if v_text is distinct from 'pending' then
    v_fail := v_fail || format('T2: appareil actif non pris en compte (push=%s)', v_text); end if;

  -- ==========================================================================
  -- T3. In-app coupé par préférence → le push suit : 'skipped' malgré l'appareil
  -- ==========================================================================
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_camille, 'assigned', false, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R3', proc_d1, snap_d1, s_voirie, u_camille) returning id into r3;
  select in_app, push_status into v_rec from public.notifications
   where request_id = r3 and user_id = u_camille and kind = 'assigned';
  if v_rec.in_app is distinct from false or v_rec.push_status is distinct from 'skipped' then
    v_fail := v_fail || format('T3: le push ne suit pas l''in-app (in_app=%s, push=%s)', v_rec.in_app, v_rec.push_status); end if;
  delete from public.notification_preferences where user_id = u_camille;

  -- ==========================================================================
  -- T4. Appareil désactivé (410) → 'skipped' ; ré-enregistrement → réactivé
  -- ==========================================================================
  perform public.disable_push_subscription(sub_a, 'HTTP 410');
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R4', proc_d1, snap_d1, s_voirie, u_camille) returning id into r4;
  select push_status into v_text from public.notifications
   where request_id = r4 and user_id = u_camille and kind = 'assigned';
  if v_text is distinct from 'skipped' then
    v_fail := v_fail || format('T4a: appareil désactivé compté actif (push=%s)', v_text); end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  sub_x := public.register_push_subscription(ep_a, 'p256dh-a2', 'auth-a2', 'Android · Chrome');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  if sub_x is distinct from sub_a then
    v_fail := v_fail || 'T4b: le ré-enregistrement a créé une seconde ligne'::text; end if;
  select disabled_at, p256dh into v_rec from public.push_subscriptions where id = sub_a;
  if v_rec.disabled_at is not null or v_rec.p256dh is distinct from 'p256dh-a2' then
    v_fail := v_fail || 'T4c: ré-enregistrement sans réactivation ni rafraîchissement des clés'::text; end if;

  -- ==========================================================================
  -- T5. Fan-out « nouvelle demande dans le périmètre » : Camille (appareil)
  --     pending, Dominique (sans appareil) skipped — même règle, insert set-based
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org1, 'R5', proc_d1, snap_d1, s_voirie) returning id into r5;
  select push_status into v_text from public.notifications
   where request_id = r5 and user_id = u_camille and kind = 'new_request_in_scope';
  if v_text is distinct from 'pending' then
    v_fail := v_fail || format('T5a: fan-out Camille (push=%s)', v_text); end if;
  select push_status into v_text from public.notifications
   where request_id = r5 and user_id = u_dominique and kind = 'new_request_in_scope';
  if v_text is distinct from 'skipped' then
    v_fail := v_fail || format('T5b: fan-out Dominique (push=%s)', v_text); end if;

  -- ==========================================================================
  -- T6. Lue avant l'envoi → le claim la passe 'skipped' et ne la rend pas
  -- ==========================================================================
  update public.notifications set read_at = now()
   where request_id = r2 and user_id = u_camille and kind = 'assigned';

  -- Un second appareil pour Camille, pour T7.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  sub_b := public.register_push_subscription(ep_b, 'p256dh-b', 'auth-b', 'iPhone · Safari');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  select count(*) into v_int from public.claim_notification_pushes(50) c
   where c.request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'T6a: une notification LUE a été réclamée'::text; end if;
  select push_status, push_error into v_rec from public.notifications
   where request_id = r2 and user_id = u_camille and kind = 'assigned';
  if v_rec.push_status is distinct from 'skipped' or v_rec.push_error is distinct from 'lue avant envoi' then
    v_fail := v_fail || format('T6b: lue avant envoi (push=%s, err=%s)', v_rec.push_status, v_rec.push_error); end if;

  -- ==========================================================================
  -- T7. Le claim précédent a réclamé la ligne de R5 (Camille) : 'sending',
  --     deux appareils en JSON ; un second claim ne rend plus rien.
  -- ==========================================================================
  select id, push_status, push_attempts into v_rec from public.notifications
   where request_id = r5 and user_id = u_camille and kind = 'new_request_in_scope';
  n_id := v_rec.id;
  if v_rec.push_status is distinct from 'sending' or v_rec.push_attempts <> 1 then
    v_fail := v_fail || format('T7a: réclamation (push=%s, tentatives=%s)', v_rec.push_status, v_rec.push_attempts); end if;

  select count(*) into v_int from public.claim_notification_pushes(50);
  if v_int <> 0 then v_fail := v_fail || format('T7b: second claim non vide (%s)', v_int); end if;

  -- Rejouer la réclamation pour lire le JSON des appareils : on repasse la
  -- ligne en pending (c'est ce que fait un settle en échec).
  perform public.settle_notification_push(n_id, false, 'test');
  update public.notifications set push_next_attempt_at = null where id = n_id;
  select c.subscriptions into v_rec from public.claim_notification_pushes(50) c
   where c.notification_id = n_id;
  if jsonb_array_length(coalesce(v_rec.subscriptions, '[]'::jsonb)) <> 2 then
    v_fail := v_fail || format('T7c: appareils agrégés = %s (attendu 2)', jsonb_array_length(coalesce(v_rec.subscriptions, '[]'::jsonb))); end if;
  if not (v_rec.subscriptions @> jsonb_build_array(jsonb_build_object('id', sub_b, 'endpoint', ep_b, 'p256dh', 'p256dh-b', 'auth', 'auth-b'))) then
    v_fail := v_fail || 'T7d: le JSON ne porte pas id/endpoint/p256dh/auth'::text; end if;

  -- ==========================================================================
  -- T8. Règlement : succès → sent ; échec → pending + temporisation ; plafond → failed
  -- ==========================================================================
  perform public.settle_notification_push(n_id, true);
  select push_status, push_sent_at, push_error into v_rec from public.notifications where id = n_id;
  if v_rec.push_status is distinct from 'sent' or v_rec.push_sent_at is null or v_rec.push_error is not null then
    v_fail := v_fail || format('T8a: succès (push=%s)', v_rec.push_status); end if;

  update public.notifications set push_status = 'sending', push_attempts = 2 where id = n_id;
  perform public.settle_notification_push(n_id, false, 'HTTP 503');
  select push_status, push_next_attempt_at, push_error into v_rec from public.notifications where id = n_id;
  if v_rec.push_status is distinct from 'pending' or v_rec.push_next_attempt_at is null
     or v_rec.push_next_attempt_at < now() + interval '3 minutes' or v_rec.push_error is distinct from 'HTTP 503' then
    v_fail := v_fail || format('T8b: échec (push=%s, next=%s)', v_rec.push_status, v_rec.push_next_attempt_at); end if;

  update public.notifications set push_status = 'sending', push_attempts = 5 where id = n_id;
  perform public.settle_notification_push(n_id, false, 'HTTP 503');
  select push_status into v_text from public.notifications where id = n_id;
  if v_text is distinct from 'failed' then
    v_fail := v_fail || format('T8c: plafond (push=%s)', v_text); end if;

  perform public.skip_notification_push(n_id, 'test');
  select push_status into v_text from public.notifications where id = n_id;
  if v_text is distinct from 'skipped' then v_fail := v_fail || 'T8d: skip'::text; end if;

  -- ==========================================================================
  -- T9. Tous les appareils désactivés après coup → le claim renonce
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R6', proc_d1, snap_d1, s_voirie, u_camille) returning id into r6;
  perform public.disable_push_subscription(sub_a, 'HTTP 410');
  perform public.disable_push_subscription(sub_b, 'HTTP 404');
  select count(*) into v_int from public.claim_notification_pushes(50) c where c.request_id = r6;
  if v_int <> 0 then v_fail := v_fail || 'T9a: réclamée sans appareil'::text; end if;
  select push_status, push_error into v_rec from public.notifications
   where request_id = r6 and user_id = u_camille and kind = 'assigned';
  if v_rec.push_status is distinct from 'skipped' or v_rec.push_error is distinct from 'aucun appareil actif' then
    v_fail := v_fail || format('T9b: sans appareil (push=%s, err=%s)', v_rec.push_status, v_rec.push_error); end if;

  -- ==========================================================================
  -- T10. Poste partagé : Dominique reprend l'endpoint de Camille
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  perform public.register_push_subscription(ep_x, 'p256dh-x', 'auth-x', 'Poste partagé');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_dominique, 'role', 'authenticated')::text, true);
  perform public.register_push_subscription(ep_x, 'p256dh-x2', 'auth-x2', 'Poste partagé');
  select count(*), min(user_id::text) into v_rec from public.push_subscriptions where endpoint = ep_x;
  if v_rec.count <> 1 or v_rec.min is distinct from u_dominique::text then
    v_fail := v_fail || format('T10: reprise d''endpoint (lignes=%s, titulaire=%s)', v_rec.count, v_rec.min); end if;

  -- Gardes d'entrée.
  begin
    perform public.register_push_subscription('http://insecure.example/x', 'k', 'a');
    v_fail := v_fail || 'T10b: endpoint non https accepté'::text;
  exception when others then null;
  end;
  begin
    perform public.register_push_subscription('https://push.example/vide', '', 'a');
    v_fail := v_fail || 'T10c: clé vide acceptée'::text;
  exception when others then null;
  end;

  -- ==========================================================================
  -- T11. Privilèges : la boîte d'envoi est service_role, l'enregistrement client
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.claim_notification_pushes(integer)', 'execute') then
    v_fail := v_fail || 'T11a: claim_notification_pushes exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.settle_notification_push(uuid,boolean,text)', 'execute') then
    v_fail := v_fail || 'T11b: settle_notification_push exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.skip_notification_push(uuid,text)', 'execute') then
    v_fail := v_fail || 'T11c: skip_notification_push exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.disable_push_subscription(uuid,text)', 'execute') then
    v_fail := v_fail || 'T11d: disable_push_subscription exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.notifications_push_queue()', 'execute') then
    v_fail := v_fail || 'T11e: notifications_push_queue exécutable par authenticated'::text; end if;
  if not has_function_privilege('authenticated', 'public.register_push_subscription(text,text,text,text)', 'execute') then
    v_fail := v_fail || 'T11f: register_push_subscription NON exécutable par authenticated'::text; end if;
  if has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text)', 'execute') then
    v_fail := v_fail || 'T11g: register_push_subscription exécutable par anon'::text; end if;

  -- ==========================================================================
  -- T12. RLS en rôle authenticated : Camille ne voit et ne touche que ses lignes
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.push_subscriptions;
  if v_int <> 2 then v_fail := v_fail || format('T12a: Camille voit %s lignes (attendu 2 : ep_a, ep_b)', v_int); end if;
  select count(*) into v_int from public.push_subscriptions where endpoint = ep_x;
  if v_int <> 0 then v_fail := v_fail || 'T12b: FUITE — l''abonnement de Dominique visible'::text; end if;

  update public.push_subscriptions set last_seen_at = now() where endpoint = ep_a;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'T12c: Camille ne peut pas toucher last_seen_at'::text; end if;

  update public.push_subscriptions set last_seen_at = now() where endpoint = ep_x;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'T12d: Camille a modifié la ligne de Dominique'::text; end if;

  begin
    update public.push_subscriptions set user_id = u_dominique where endpoint = ep_a;
    get diagnostics v_int = row_count;
    if v_int <> 0 then v_fail := v_fail || 'T12e: Camille a donné sa ligne à autrui'::text; end if;
  exception when others then null;   -- with check → refus : c'est le but
  end;

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values (u_camille, 'https://push.example/direct', 'k', 'a');
    v_fail := v_fail || 'T12f: insert direct accepté (la RPC doit être la seule porte)'::text;
  exception when others then null;
  end;

  delete from public.push_subscriptions where endpoint = ep_x;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'T12g: Camille a supprimé la ligne de Dominique'::text; end if;
  delete from public.push_subscriptions where endpoint = ep_b;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'T12h: Camille ne peut pas retirer SON appareil'::text; end if;

  execute 'reset role';

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (notifications push) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
