-- ============================================================================
-- Tests de l'accès à la BASE DE CONNAISSANCES (migration 20260922100000).
--
--   1. FORME : un profil « Base de connaissances » seul est VALIDE ; un profil
--      sans rien ne l'est toujours pas.
--   2. `save_permission_profile` : la clé est enregistrée et journalisée ;
--      ABSENTE du payload, elle CONSERVE la valeur en place (navigateur servi
--      avant ce lot) ; absente à la création, elle vaut `false`.
--   3. `my_rights` l'expose en tête (profil ACTIF seulement) et par profil.
--   4. `has_knowledge_base_access_for` : profil actif oui, inactif non,
--      admin plateforme oui ; aucune EXECUTE cliente.
--
-- Exécution : bloc DO en lecture-écriture (SQL editor, ou apply_migration —
-- le MCP execute_sql est en lecture seule) ; l'échec final VOLONTAIRE annule
-- la transaction.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  orgA     uuid;
  proc     uuid := gen_random_uuid();
  u_admin  uuid := gen_random_uuid();  -- administrateur racine, tous droits
  u_kb     uuid := gen_random_uuid();  -- base de connaissances seule
  u_sans   uuid := gen_random_uuid();  -- consultation, SANS base de connaissances
  u_off    uuid := gen_random_uuid();  -- base de connaissances sur un profil INACTIF
  p_admin  uuid;
  p_id     uuid;
  p_saved  uuid;
  v_ver    int;
  v_json   jsonb;
  v_bool   boolean;
  v_fail   text[] := '{}';
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin, 'admin@kb.test', now(), now()),
    (u_kb,    'kb@kb.test',    now(), now()),
    (u_sans,  'sans@kb.test',  now(), now()),
    (u_off,   'off@kb.test',   now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie KB')
    returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_admin, 'agent'), (orgA, u_kb, 'agent'), (orgA, u_sans, 'agent'), (orgA, u_off, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Carte de déchetterie');

  -- Administrateur racine, tous droits, base de connaissances.
  insert into public.permission_profiles (organization_id, name, is_admin, knowledge_base_access,
                                          default_view, default_create, default_process, default_close)
    values (orgA, 'Admin', true, true, true, true, true, true) returning id into p_admin;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_admin, s_root);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_admin, u_admin);

  -- Consultation Voirie, SANS base de connaissances (valeur par défaut).
  insert into public.permission_profiles (organization_id, name, default_view)
    values (orgA, 'Lecture', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_sans);

  -- Base de connaissances, mais profil INACTIF.
  insert into public.permission_profiles (organization_id, name, knowledge_base_access, status)
    values (orgA, 'KB-inactif', true, 'inactive') returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_off);

  -- ==========================================================================
  -- T1. Forme
  -- ==========================================================================
  insert into public.permission_profiles (organization_id, name, knowledge_base_access)
    values (orgA, 'KB-seule', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_kb);
  begin
    perform public.validate_permission_profile_shape(p_id);
  exception when others then
    v_fail := v_fail || format('T1a: profil base de connaissances seule refuse - %s', sqlerrm);
  end;

  insert into public.permission_profiles (organization_id, name) values (orgA, 'Vide')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  begin
    perform public.validate_permission_profile_shape(p_id);
    v_fail := v_fail || 'T1b: un profil sans rien a ete accepte'::text;
  exception when others then
    if sqlerrm not like '%aucun droit%' then
      v_fail := v_fail || format('T1b: message inattendu - %s', sqlerrm); end if;
  end;
  delete from public.permission_profiles where id = p_id;

  -- ==========================================================================
  -- T2. save_permission_profile (en administrateur)
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- T2a : création avec la clé → enregistrée ; un profil « base seule » passe.
  select (public.save_permission_profile(jsonb_build_object(
    'organization_id', orgA, 'name', 'Accueil', 'knowledge_base_access', true,
    'organizations', jsonb_build_array(s_voirie))) ->> 'id')::uuid into p_saved;
  execute 'reset role';
  select knowledge_base_access, version into v_bool, v_ver from public.permission_profiles where id = p_saved;
  if v_bool is distinct from true then
    v_fail := v_fail || 'T2a: knowledge_base_access non enregistre a la creation'::text; end if;
  if not exists (select 1 from public.permission_audit_log
                  where profile_id = p_saved and (after ->> 'knowledge_base_access')::boolean) then
    v_fail := v_fail || 'T2a: knowledge_base_access absent du journal'::text; end if;

  -- T2b : mise à jour SANS la clé (ancien navigateur) → la valeur est CONSERVÉE.
  execute 'set local role authenticated';
  perform public.save_permission_profile(jsonb_build_object(
    'profile_id', p_saved, 'expected_version', v_ver,
    'organization_id', orgA, 'name', 'Accueil', 'default_rights', jsonb_build_array('consultation'),
    'organizations', jsonb_build_array(s_voirie)));
  execute 'reset role';
  select knowledge_base_access, version into v_bool, v_ver from public.permission_profiles where id = p_saved;
  if v_bool is distinct from true then
    v_fail := v_fail || 'T2b: une mise a jour sans la cle a eteint l''acces'::text; end if;

  -- T2c : mise à jour AVEC la clé à faux → éteinte.
  execute 'set local role authenticated';
  perform public.save_permission_profile(jsonb_build_object(
    'profile_id', p_saved, 'expected_version', v_ver, 'knowledge_base_access', false,
    'organization_id', orgA, 'name', 'Accueil', 'default_rights', jsonb_build_array('consultation'),
    'organizations', jsonb_build_array(s_voirie)));
  execute 'reset role';
  select knowledge_base_access into v_bool from public.permission_profiles where id = p_saved;
  if v_bool is distinct from false then
    v_fail := v_fail || 'T2c: la cle a faux n''a pas eteint l''acces'::text; end if;

  -- T2d : création SANS la clé → `false`.
  execute 'set local role authenticated';
  select (public.save_permission_profile(jsonb_build_object(
    'organization_id', orgA, 'name', 'Sans cle', 'default_rights', jsonb_build_array('consultation'),
    'organizations', jsonb_build_array(s_voirie))) ->> 'id')::uuid into p_id;
  execute 'reset role';
  select knowledge_base_access into v_bool from public.permission_profiles where id = p_id;
  if v_bool is distinct from false then
    v_fail := v_fail || 'T2d: creation sans la cle ne vaut pas false'::text; end if;

  -- T2e : un profil SANS RIEN reste refusé par la RPC.
  execute 'set local role authenticated';
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', orgA, 'name', 'Rien', 'knowledge_base_access', false,
      'organizations', jsonb_build_array(s_voirie)));
    v_fail := v_fail || 'T2e: un profil sans rien a ete enregistre'::text;
  exception when others then
    if sqlerrm not like '%aucun droit%' then
      v_fail := v_fail || format('T2e: message inattendu - %s', sqlerrm); end if;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- T3. my_rights
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_kb, 'role', 'authenticated')::text, true);
  select public.my_rights(orgA) into v_json;
  if (v_json ->> 'knowledge_base_access')::boolean is distinct from true then
    v_fail := v_fail || 'T3a: my_rights.knowledge_base_access faux pour un titulaire'::text; end if;
  if (v_json -> 'profiles' -> 0 ->> 'knowledge_base_access')::boolean is distinct from true then
    v_fail := v_fail || 'T3a: attribut absent du profil dans my_rights'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sans, 'role', 'authenticated')::text, true);
  select public.my_rights(orgA) into v_json;
  if (v_json ->> 'knowledge_base_access')::boolean is distinct from false then
    v_fail := v_fail || 'T3b: my_rights.knowledge_base_access vrai sans le droit'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_off, 'role', 'authenticated')::text, true);
  select public.my_rights(orgA) into v_json;
  if (v_json ->> 'knowledge_base_access')::boolean is distinct from false then
    v_fail := v_fail || 'T3c: un profil INACTIF ouvre la base de connaissances'::text; end if;

  -- ==========================================================================
  -- T4. has_knowledge_base_access_for (service_role)
  -- ==========================================================================
  if not public.has_knowledge_base_access_for(u_kb, orgA) then
    v_fail := v_fail || 'T4a: titulaire refuse'::text; end if;
  if public.has_knowledge_base_access_for(u_sans, orgA) then
    v_fail := v_fail || 'T4b: non-titulaire accepte'::text; end if;
  if public.has_knowledge_base_access_for(u_off, orgA) then
    v_fail := v_fail || 'T4c: profil inactif accepte'::text; end if;
  update public.users set is_platform_admin = true where id = u_sans;
  if not public.has_knowledge_base_access_for(u_sans, orgA) then
    v_fail := v_fail || 'T4d: admin plateforme refuse'::text; end if;
  if has_function_privilege('authenticated', 'public.has_knowledge_base_access_for(uuid, uuid)', 'execute') then
    v_fail := v_fail || 'T4e: EXECUTE ouverte aux clients'::text; end if;

  -- ==========================================================================
  -- VERDICT — l'exception annule TOUT (aucune donnée conservée)
  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (base de connaissances, T1–T4) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
