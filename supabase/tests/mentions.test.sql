-- ============================================================================
-- Tests des mentions dans les notes internes.
--
-- La règle tenue ici : on ne mentionne QUE quelqu'un qui peut CONSULTER la
-- demande, et c'est la BASE qui le décide. Le sélecteur de l'interface
-- (`mentionable_users`) n'est qu'un reflet — les scénarios M3 et M4 attaquent
-- donc directement l'insertion, comme le ferait un client contournant l'écran.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL
-- editor ; le MCP execute_sql est en lecture seule → apply_migration, l'échec
-- final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  org1 uuid; org2 uuid;
  proc_d1 uuid := gen_random_uuid();
  proc_d2 uuid := gen_random_uuid();
  snap_d1 jsonb;
  u_alex    uuid := gen_random_uuid();  -- auteur des notes, instruction Voirie/D1
  u_camille uuid := gen_random_uuid();  -- affectataire, instruction Voirie/D1
  u_lecteur uuid := gen_random_uuid();  -- CONSULTATION seule → mentionnable
  u_ccas    uuid := gen_random_uuid();  -- CCAS/D2 → ne peut PAS consulter
  u_dehors  uuid := gen_random_uuid();  -- membre d'un AUTRE tenant
  p_id uuid; r1 uuid;
  v_fail text[] := '{}';
  v_int  int;
  v_ids  uuid[];
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,    'alex@m.test',    now(), now()),
    (u_camille, 'camille@m.test', now(), now()),
    (u_lecteur, 'lecteur@m.test', now(), now()),
    (u_ccas,    'ccas@m.test',    now(), now()),
    (u_dehors,  'dehors@m.test',  now(), now());
  update public.users set first_name = 'Camille', last_name = 'Martin' where id = u_camille;

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie M') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (gen_random_uuid(), 'Autre') returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_alex, 'agent'), (org1, u_camille, 'agent'), (org1, u_lecteur, 'agent'),
    (org1, u_ccas, 'agent'), (org2, u_dehors, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc_d1, org1, s_root, 'D1'), (proc_d2, org1, s_root, 'D2');
  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'D1');

  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Alex', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_alex);

  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Camille', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_camille);

  -- Consultation SEULE : mentionnable, alors qu'il n'est pas affectable.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Lecteur', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc_d1, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_lecteur);

  -- Autre couple (CCAS, D2) : membre du tenant, mais aveugle sur cette demande.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'CCAS', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_ccas);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R1', proc_d1, snap_d1, s_voirie, u_camille) returning id into r1;

  -- ==========================================================================
  -- M1. Extraction et dédoublonnage
  -- ==========================================================================
  v_ids := public.message_mentions(
    format('Voir @[Camille Martin](%s) et @[X](%s) et encore @[C](%s)',
           u_camille, u_lecteur, u_camille));
  if array_length(v_ids, 1) <> 2 then
    v_fail := v_fail || format('M1: extraction/dédoublonnage faux (%s)', array_length(v_ids, 1)); end if;

  -- ==========================================================================
  -- M2. Mention de quelqu'un qui peut CONSULTER → acceptée et notifiée
  -- ==========================================================================
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, format('Ton avis @[Lecteur](%s) ?', u_lecteur));
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_lecteur and kind = 'mentioned';
  if v_int <> 1 then v_fail := v_fail || format('M2: %s notif « mentioned » au lieu de 1', v_int); end if;

  -- ==========================================================================
  -- M3. Mention de quelqu'un SANS consultation → REFUSÉE
  -- (attaque directe sur l'insertion : c'est la base qui garde, pas l'écran)
  -- ==========================================================================
  begin
    insert into public.request_messages (organization_id, request_id, author_id, body)
    values (org1, r1, u_alex, format('Coucou @[CCAS](%s)', u_ccas));
    v_fail := v_fail || 'M3: mention d''un utilisateur SANS consultation acceptée'::text;
  exception when others then null;   -- toute erreur vaut refus : c'est le but
  end;

  -- ==========================================================================
  -- M4. Mention d'un membre d'un AUTRE tenant → REFUSÉE
  -- ==========================================================================
  begin
    insert into public.request_messages (organization_id, request_id, author_id, body)
    values (org1, r1, u_alex, format('Coucou @[Dehors](%s)', u_dehors));
    v_fail := v_fail || 'M4: mention d''un non-membre acceptée'::text;
  exception when others then null;
  end;

  -- ==========================================================================
  -- M5. Se mentionner soi-même → aucune notification
  -- ==========================================================================
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, format('Note pour @[Alex](%s)', u_alex));
  select count(*) into v_int from public.notifications where request_id = r1 and user_id = u_alex;
  if v_int <> 0 then v_fail := v_fail || format('M5: notifié de SA PROPRE mention (%s)', v_int); end if;

  -- ==========================================================================
  -- M6. L'affectataire MENTIONNÉ reçoit « mentioned », et PAS « note_added »
  -- (un geste, une notification par personne)
  -- ==========================================================================
  delete from public.notifications where request_id = r1;
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, format('Regarde @[Camille Martin](%s)', u_camille));
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'mentioned';
  if v_int <> 1 then v_fail := v_fail || format('M6a: affectataire mentionné — %s « mentioned »', v_int); end if;
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_int <> 0 then v_fail := v_fail || 'M6b: DOUBLE notification (mentioned + note_added)'::text; end if;

  -- ==========================================================================
  -- M7. L'affectataire NON mentionné reçoit bien « note_added »
  -- ==========================================================================
  delete from public.notifications where request_id = r1;
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, 'Note sans mention.');
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_int <> 1 then v_fail := v_fail || format('M7: %s « note_added » au lieu de 1', v_int); end if;

  -- ==========================================================================
  -- M8. La préférence « mentioned » coupée fait taire les deux canaux
  -- ==========================================================================
  delete from public.notifications where request_id = r1;
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_lecteur, 'mentioned', false, false);
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, format('Re @[Lecteur](%s)', u_lecteur));
  select count(*) into v_int from public.notifications where request_id = r1 and user_id = u_lecteur;
  if v_int <> 0 then v_fail := v_fail || format('M8: préférence « mentioned » ignorée (%s)', v_int); end if;
  delete from public.notification_preferences;

  -- ==========================================================================
  -- M9. `mentionable_users` = exactement ceux qui peuvent consulter
  -- ==========================================================================
  execute 'set local role authenticated';
  select count(*) into v_int from public.mentionable_users(r1);
  if v_int <> 3 then
    v_fail := v_fail || format('M9a: %s mentionnables au lieu de 3 (alex, camille, lecteur)', v_int); end if;
  select count(*) into v_int from public.mentionable_users(r1) where user_id = u_ccas;
  if v_int <> 0 then v_fail := v_fail || 'M9b: FUITE — un non-consultant est proposé'::text; end if;
  select count(*) into v_int from public.mentionable_users(r1) where user_id = u_dehors;
  if v_int <> 0 then v_fail := v_fail || 'M9c: FUITE — un membre d''un autre tenant est proposé'::text; end if;

  -- ==========================================================================
  -- M10. Les helpers internes restent hors de portée d'un client
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.request_right_for(uuid,uuid,uuid,uuid,text)', 'execute') then
    v_fail := v_fail || 'M10a: request_right_for exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.message_mentions(text)', 'execute') then
    v_fail := v_fail || 'M10b: message_mentions exécutable par authenticated'::text; end if;
  execute 'reset role';

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (mentions) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
