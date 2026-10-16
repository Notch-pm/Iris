-- ============================================================================
-- Tests des PASTILLES de la liste (migration 20261016180000).
--
--   P1. `likely_similar` compte une demande au même endroit ET à la description
--       proche ; pas une demande au même endroit pour un autre problème.
--   P2. Le RLS borne tout : une demande d'un service voisin n'est ni comptée
--       comme similaire, ni comme membre du groupe.
--   P3. Après liaison, `group_size` = membres visibles, et la demande liée
--       n'est plus « similaire ».
--   P4. Une demande close n'a pas de piste ; démarche non mutualisable : 0.
-- Exécution : bloc DO, contexte postgres — le `raise exception` final annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  org1 uuid;
  proc uuid := gen_random_uuid();
  proc_off uuid := gen_random_uuid();
  schema_loc jsonb := '{"version":1,"content":[{"id":"f-lieu","key":"intervention_lieu","label":"Lieu","type":"location"}]}'::jsonb;
  snap jsonb; snap_off jsonb;
  lieu jsonb := '{"intervention_lieu":{"address":"12 rue des Lilas 13200 Arles","lat":43.6767,"lon":4.6278}}';
  u_voirie uuid := gen_random_uuid();
  u_large  uuid := gen_random_uuid();
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  v_fail text[] := '{}';
  h record;
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_voirie, 'voirie@pastilles.test', now(), now()), (u_large, 'large@pastilles.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Pastilles') returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_voirie, 'agent'), (org1, u_large, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc, org1, s_root, 'Signalement voirie'), (proc_off, org1, s_root, 'Carte de déchetterie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc, s_voirie), (org1, proc, s_ccas), (org1, proc_off, s_voirie);
  insert into public.procedure_link_settings (organization_id, socle_procedure_id, enabled, radius_m)
    values (org1, proc, true, 200);
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie', 'form_schema', schema_loc);
  snap_off := jsonb_build_object('id', proc_off::text, 'name', 'Carte de déchetterie', 'form_schema', schema_loc);

  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process)
    values (p_id, proc, true, true, true), (p_id, proc_off, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_voirie);
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Large', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_large);

  -- r1 et r2 : même trou, même endroit. r3 : même endroit, autre problème.
  -- r4 : même trou au CCAS. r5 : démarche non mutualisable. r6 : close.
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Nid-de-poule rue des Lilas', 'Gros nid-de-poule sur la chaussée', proc, snap, s_voirie, lieu) returning id into r1;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Nid de poule rue des Lilas', 'Nid-de-poule profond sur la chaussée', proc, snap, s_voirie, lieu) returning id into r2;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Lampadaire éteint', 'Plus de lumière depuis lundi', proc, snap, s_voirie, lieu) returning id into r3;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Nid-de-poule rue des Lilas (CCAS)', 'Gros nid-de-poule sur la chaussée', proc, snap, s_ccas, lieu) returning id into r4;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Nid-de-poule rue des Lilas', 'Gros nid-de-poule sur la chaussée', proc_off, snap_off, s_voirie, lieu) returning id into r5;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
    values (org1, 'Nid-de-poule rue des Lilas', 'Gros nid-de-poule sur la chaussée', proc, snap, s_voirie, lieu) returning id into r6;
  update public.requests set status = 'resolue_negative', closure_motif = 'irrecevable' where id = r6;

  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for h in select * from public.request_link_hints(array[r1, r3, r5, r6]) loop
    -- r1 : r2 (même trou) — pas r3 (autre problème), pas r4 (CCAS, invisible), pas r6 (close
    -- mais résolue récemment : elle EST une piste pour r1, comptée avec r2).
    if h.request_id = r1 and h.likely_similar <> 2 then
      v_fail := v_fail || format('P1a: r1 likely_similar = %s (attendu 2 : r2 et r6)', h.likely_similar); end if;
    if h.request_id = r3 and h.likely_similar <> 0 then
      v_fail := v_fail || format('P1b: r3 (autre probleme) likely_similar = %s', h.likely_similar); end if;
    if h.request_id = r5 and h.likely_similar <> 0 then
      v_fail := v_fail || format('P4a: demarche non mutualisable likely_similar = %s', h.likely_similar); end if;
    if h.request_id = r6 and h.likely_similar <> 0 then
      v_fail := v_fail || format('P4b: demande close likely_similar = %s', h.likely_similar); end if;
    if h.group_size <> 0 then
      v_fail := v_fail || format('P3a: group_size %s hors groupe', h.group_size); end if;
  end loop;
  reset role;

  -- P2. L'agent à la racine voit aussi r4.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into h from public.request_link_hints(array[r1]);
  if h.likely_similar <> 3 then
    v_fail := v_fail || format('P2a: agent racine likely_similar = %s (attendu 3 : r2, r4, r6)', h.likely_similar); end if;
  reset role;

  -- P3. Lier r1–r2–r4 (par l'agent racine), puis lire comme l'agent Voirie.
  perform public.link_requests(r1, r2);
  perform public.link_requests(r1, r4);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into h from public.request_link_hints(array[r1]);
  if h.group_size <> 2 then
    v_fail := v_fail || format('P2b/P3b: group_size vu par Voirie = %s (attendu 2 : r1, r2 — r4 invisible)', h.group_size); end if;
  if h.likely_similar <> 1 then
    v_fail := v_fail || format('P3c: apres liaison likely_similar = %s (attendu 1 : r6)', h.likely_similar); end if;
  reset role;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (pastilles demandes liees) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
