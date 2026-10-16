-- ============================================================================
-- Tests des DEMANDES LIÉES — fondations (migration 20261016120000).
--
--   L1. Démarche mutualisable : réglée par un administrateur de la RACINE, seul.
--   L2. Lieu recopié du formulaire (champ `location`, ancien bloc), suivi des
--       modifications de `form_data`, jamais inventé.
--   L3. Liaison : groupe créé, journal sur les deux demandes.
--   L4. Refus : démarche non mutualisable, autre tenant, droits insuffisants.
--   L5. Fusion de deux groupes.
--   L6. RLS : un agent ne voit que les membres qu'il peut consulter
--       (sous-arbres frères Voirie / CCAS).
--   L7. Délier, jusqu'à la dissolution du groupe.
--   L8. Aucune écriture cliente directe.
--
-- ⚠️ Chaque refus vérifie le MESSAGE, jamais `when others then null`.
-- Exécution : bloc DO, contexte postgres en lecture-écriture (SQL editor, ou
-- apply_migration volontairement en échec) — le `raise exception` final annule
-- tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  s_root2  uuid := gen_random_uuid();
  org1 uuid; org2 uuid;
  proc_d1 uuid := gen_random_uuid();  -- Signalement voirie (mutualisable)
  proc_d2 uuid := gen_random_uuid();  -- Carte de déchetterie (non)
  proc_t2 uuid := gen_random_uuid();
  schema_loc jsonb := '{"version":1,"content":[{"id":"f-lieu","key":"intervention_lieu","label":"Lieu","type":"location"}]}'::jsonb;
  snap_d1 jsonb; snap_d2 jsonb; snap_t2 jsonb;
  u_admin  uuid := gen_random_uuid();  -- administrateur racine, AUCUN droit sur les demandes
  u_voirie uuid := gen_random_uuid();  -- création + instruction D1 à la Voirie
  u_large  uuid := gen_random_uuid();  -- instruction D1 sur la racine
  u_lect   uuid := gen_random_uuid();  -- consultation D1 au CCAS seulement
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r_t2 uuid;
  v_fail text[] := '{}';
  v_int  int;
  v_json jsonb;
  v_lat  double precision;
  v_text text;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin, 'admin@liees.test', now(), now()), (u_voirie, 'voirie@liees.test', now(), now()),
    (u_large, 'large@liees.test', now(), now()), (u_lect, 'lect@liees.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Liées') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Autre tenant') returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_admin, 'agent'), (org1, u_voirie, 'agent'), (org1, u_large, 'agent'), (org1, u_lect, 'agent'),
    (org2, u_large, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS'),
    (org2, s_root2, null, 'Racine 2');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc_d1, org1, s_root, 'Signalement voirie'), (proc_d2, org1, s_root, 'Carte de déchetterie'),
    (proc_t2, org2, s_root2, 'Signalement tenant 2');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_d1, s_voirie), (org1, proc_d1, s_ccas), (org1, proc_d2, s_voirie), (org2, proc_t2, s_root2);

  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie', 'form_schema', schema_loc);
  snap_d2 := jsonb_build_object('id', proc_d2::text, 'name', 'Carte de déchetterie');
  snap_t2 := jsonb_build_object('id', proc_t2::text, 'name', 'Signalement tenant 2', 'form_schema', schema_loc);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Admin', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_admin);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process)
    values (p_id, proc_d1, true, true, true), (p_id, proc_d2, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_voirie);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Large', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_large);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Lecture CCAS', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc_d1, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_lect);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, form_data)
  values (org1, 'Nid-de-poule rue des Lilas', proc_d1, snap_d1, s_voirie,
          '{"intervention_lieu":{"address":"12 rue des Lilas 13200 Arles","lat":43.6767,"lon":4.6278,"precision":"housenumber","adjusted":false}}')
  returning id into r1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, form_data)
  values (org1, 'Trou dans la chaussée', proc_d1, snap_d1, s_voirie,
          '{"intervention_lieu":"14 rue des Lilas, Arles"}')
  returning id into r2;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org1, 'Trottoir abîmé (CCAS)', proc_d1, snap_d1, s_ccas) returning id into r3;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, form_data)
  values (org1, 'Carte déchetterie', proc_d2, snap_d2, s_voirie,
          '{"intervention_voie":"Rue Émile Zola","intervention_numero":"3","intervention_code_postal":"13200","intervention_ville":"Arles"}')
  returning id into r4;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org1, 'Lampadaire éteint', proc_d1, snap_d1, s_voirie) returning id into r5;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org1, 'Lampadaire éteint bis', proc_d1, snap_d1, s_voirie) returning id into r6;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org2, 'Autre tenant', proc_t2, snap_t2, s_root2) returning id into r_t2;

  -- ==========================================================================
  -- L1. Démarche mutualisable — administrateur de la racine seul
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  begin
    perform public.save_procedure_link_settings(org1, proc_d1, true);
    v_fail := v_fail || 'L1a: un agent non administrateur a rendu une demarche mutualisable'::text;
  exception when others then
    if sqlerrm not like '%exige l''administration%' then
      v_fail := v_fail || format('L1a: message inattendu - %s', sqlerrm); end if;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  v_json := public.save_procedure_link_settings(org1, proc_d1, true, 200, 30);
  if not public.procedure_linkable(org1, proc_d1) then
    v_fail := v_fail || 'L1b: D1 non mutualisable apres reglage'::text; end if;
  if public.procedure_linkable(org1, proc_d2) then
    v_fail := v_fail || 'L1c: D2 mutualisable sans reglage (fail closed)'::text; end if;
  begin
    perform public.save_procedure_link_settings(org1, proc_t2, true);
    v_fail := v_fail || 'L1d: demarche d''un autre tenant reglee'::text;
  exception when others then
    if sqlerrm not like '%Démarche inconnue%' then
      v_fail := v_fail || format('L1d: message inattendu - %s', sqlerrm); end if;
  end;
  begin
    perform public.save_procedure_link_settings(org1, proc_d1, true, 5, 30);
    v_fail := v_fail || 'L1e: rayon de 5 m accepte'::text;
  exception when others then
    if sqlerrm not like '%rayon%' then
      v_fail := v_fail || format('L1e: message inattendu - %s', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- L2. Lieu recopié du formulaire
  -- ==========================================================================
  select lat into v_lat from public.request_locations where request_id = r1;
  if v_lat is distinct from 43.6767::double precision then
    v_fail := v_fail || format('L2a: point declare non recopie (%s)', v_lat); end if;
  select lat, address_norm into v_lat, v_text from public.request_locations where request_id = r2;
  if v_lat is not null or v_text is distinct from '14 rue des lilas arles' then
    v_fail := v_fail || format('L2b: chaine nue mal recopiee (%s, %s)', v_lat, v_text); end if;
  select address_norm into v_text from public.request_locations where request_id = r4;
  if v_text is distinct from '3 rue emile zola 13200 arles' then
    v_fail := v_fail || format('L2c: ancien bloc mal recopie (%s)', v_text); end if;
  select count(*) into v_int from public.request_locations where request_id = r3;
  if v_int <> 0 then
    v_fail := v_fail || 'L2d: un lieu a ete invente pour une demande sans lieu'::text; end if;

  reset role;
  update public.requests set form_data = '{"intervention_lieu":{"address":"1 place de la République","lat":43.68,"lon":4.63}}'
   where id = r3;
  select lat into v_lat from public.request_locations where request_id = r3;
  if v_lat is distinct from 43.68::double precision then
    v_fail := v_fail || 'L2e: modification de form_data non suivie'::text; end if;
  update public.requests set form_data = '{}' where id = r3;
  select count(*) into v_int from public.request_locations where request_id = r3;
  if v_int <> 0 then
    v_fail := v_fail || 'L2f: lieu retire du formulaire mais conserve'::text; end if;

  -- ==========================================================================
  -- L3. Liaison
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  v_json := public.link_requests(r1, r2);
  if (v_json ->> 'changed')::boolean is not true then
    v_fail := v_fail || format('L3a: liaison non faite - %s', v_json); end if;
  select count(*) into v_int from public.request_group_members where group_id = (v_json ->> 'group_id')::uuid;
  if v_int <> 2 then
    v_fail := v_fail || format('L3b: %s membres au lieu de 2', v_int); end if;
  select count(*) into v_int from public.request_events
   where event_type = 'request_linked' and request_id in (r1, r2);
  if v_int <> 2 then
    v_fail := v_fail || format('L3c: %s evenements request_linked au lieu de 2', v_int); end if;
  v_json := public.link_requests(r2, r1);
  if (v_json ->> 'changed')::boolean is not false then
    v_fail := v_fail || 'L3d: relier deux demandes deja liees a change quelque chose'::text; end if;

  -- ==========================================================================
  -- L4. Refus
  -- ==========================================================================
  begin
    perform public.link_requests(r1, r4);
    v_fail := v_fail || 'L4a: demarche non mutualisable liee'::text;
  exception when others then
    if sqlerrm not like '%mutualisable%' then
      v_fail := v_fail || format('L4a: message inattendu - %s', sqlerrm); end if;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  begin
    perform public.link_requests(r1, r_t2);
    v_fail := v_fail || 'L4b: liaison entre deux tenants'::text;
  exception when others then
    if sqlerrm not like '%introuvable%' then
      v_fail := v_fail || format('L4b: message inattendu - %s', sqlerrm); end if;
  end;

  -- Lecteur du CCAS : il consulte r3 mais n'écrit sur rien, et ne voit pas r1.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_lect, 'role', 'authenticated')::text, true);
  begin
    perform public.link_requests(r3, r1);
    v_fail := v_fail || 'L4c: un simple lecteur a lie deux demandes'::text;
  exception when others then
    if sqlerrm not like '%exige un droit de création ou d''instruction%' then
      v_fail := v_fail || format('L4c: message inattendu - %s', sqlerrm); end if;
  end;

  -- L'administrateur n'a, par lui-même, AUCUN droit sur les demandes.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.link_requests(r5, r6);
    v_fail := v_fail || 'L4d: l''administration a suffi a lier'::text;
  exception when others then
    if sqlerrm not like '%exige un droit de création ou d''instruction%' then
      v_fail := v_fail || format('L4d: message inattendu - %s', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- L5. Fusion
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  perform public.link_requests(r3, r5);
  v_json := public.link_requests(r2, r5);
  if (v_json ->> 'merged')::boolean is not true then
    v_fail := v_fail || format('L5a: fusion non annoncee - %s', v_json); end if;
  select count(distinct group_id) into v_int from public.request_group_members where request_id in (r1, r2, r3, r5);
  if v_int <> 1 then
    v_fail := v_fail || format('L5b: %s groupes apres fusion au lieu de 1', v_int); end if;
  select count(*) into v_int from public.request_groups where organization_id = org1;
  if v_int <> 1 then
    v_fail := v_fail || format('L5c: %s groupes restants (le groupe absorbe n''est pas supprime)', v_int); end if;

  -- ==========================================================================
  -- L6. RLS : chacun ne voit que ce qu'il consulte
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_int from public.request_group_members;
  if v_int <> 3 then
    v_fail := v_fail || format('L6a: l''agent Voirie voit %s membres au lieu de 3 (r3 est au CCAS)', v_int); end if;
  select count(*) into v_int from public.request_locations where request_id = r1;
  if v_int <> 1 then
    v_fail := v_fail || 'L6b: l''agent Voirie ne lit pas le lieu de sa demande'::text; end if;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_lect, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_int from public.request_group_members;
  if v_int <> 1 then
    v_fail := v_fail || format('L6c: le lecteur CCAS voit %s membres au lieu de 1', v_int); end if;
  select count(*) into v_int from public.request_groups;
  if v_int <> 1 then
    v_fail := v_fail || format('L6d: le lecteur CCAS voit %s groupes au lieu de 1', v_int); end if;
  select count(*) into v_int from public.request_locations where request_id = r1;
  if v_int <> 0 then
    v_fail := v_fail || 'L6e: le lecteur CCAS lit le lieu d''une demande de la Voirie'::text; end if;

  -- ==========================================================================
  -- L8. Aucune écriture cliente directe
  -- ==========================================================================
  begin
    insert into public.request_group_members (group_id, request_id, organization_id)
      select group_id, r6, org1 from public.request_group_members limit 1;
    v_fail := v_fail || 'L8a: insertion cliente directe acceptee'::text;
  exception when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || format('L8a: message inattendu - %s', sqlerrm); end if;
  end;
  reset role;

  -- ==========================================================================
  -- L7. Délier, jusqu'à la dissolution
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  perform public.unlink_request(r1);
  perform public.unlink_request(r2);
  select count(*) into v_int from public.request_group_members where request_id in (r3, r5);
  if v_int <> 2 then
    v_fail := v_fail || format('L7a: %s membres restants au lieu de 2', v_int); end if;
  v_json := public.unlink_request(r3);
  if (v_json ->> 'dissolved')::boolean is not true then
    v_fail := v_fail || format('L7b: groupe d''une demande non dissous - %s', v_json); end if;
  select count(*) into v_int from public.request_group_members where request_id = r5;
  if v_int <> 0 then
    v_fail := v_fail || 'L7c: la derniere demande reste seule dans un groupe'::text; end if;
  select count(*) into v_int from public.request_groups where organization_id = org1;
  if v_int <> 0 then
    v_fail := v_fail || 'L7d: groupe vide conserve'::text; end if;
  select count(*) into v_int from public.request_events
   where request_id = r5 and event_type = 'request_unlinked' and payload ->> 'reason' = 'groupe_dissous';
  if v_int <> 1 then
    v_fail := v_fail || 'L7e: la dissolution n''est pas au journal de la derniere demande'::text; end if;
  v_json := public.unlink_request(r1);
  if (v_json ->> 'changed')::boolean is not false then
    v_fail := v_fail || 'L7f: delier une demande hors groupe a change quelque chose'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (demandes liees) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
