-- ============================================================================
-- Tests de la RECHERCHE des demandes approchantes (migration 20261016140000).
--
--   S1. Depuis une demande : la voisine à 50 m est proposée avec sa distance ;
--       la lointaine sans texte commun ne l'est pas.
--   S2. Préfiltre : démarche non mutualisable, hors fenêtre, close depuis plus
--       de 30 jours — écartées ; résolue récemment — proposée.
--   S3. Texte seul : une demande sans lieu au texte proche est proposée.
--   S4. RLS : un agent ne se voit proposer que ce qu'il consulte (sous-arbres
--       frères Voirie / CCAS) ; le lieu d'une demande invisible reste illisible.
--   S5. Démarche source non mutualisable : rien (et pas d'erreur).
--   S6. Brouillon de guichet : point + texte, sans demande source.
--   S7. Les membres du groupe de la demande source ne sont plus proposés.
--
-- Exécution : bloc DO, contexte postgres (SQL editor / `supabase db query -f`) —
-- le `raise exception` final annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  org1 uuid;
  proc_d1 uuid := gen_random_uuid();  -- mutualisable, rayon 200 m, fenêtre 60 j
  proc_d2 uuid := gen_random_uuid();  -- non mutualisable
  schema_loc jsonb := '{"version":1,"content":[{"id":"f-lieu","key":"intervention_lieu","label":"Lieu","type":"location"}]}'::jsonb;
  snap_d1 jsonb; snap_d2 jsonb;
  u_voirie uuid := gen_random_uuid();
  u_large  uuid := gen_random_uuid();
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid;
  v_fail text[] := '{}';
  v_ids  uuid[];
  v_dist double precision;
  v_int  int;
  lieu_a jsonb := '{"intervention_lieu":{"address":"12 rue des Lilas 13200 Arles","lat":43.6767,"lon":4.6278}}';
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_voirie, 'voirie@recherche.test', now(), now()), (u_large, 'large@recherche.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Recherche') returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_voirie, 'agent'), (org1, u_large, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc_d1, org1, s_root, 'Signalement voirie'), (proc_d2, org1, s_root, 'Carte de déchetterie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_d1, s_voirie), (org1, proc_d1, s_ccas), (org1, proc_d2, s_voirie);
  insert into public.procedure_link_settings (organization_id, socle_procedure_id, enabled, radius_m, window_days)
    values (org1, proc_d1, true, 200, 60);
  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie', 'form_schema', schema_loc);
  snap_d2 := jsonb_build_object('id', proc_d2::text, 'name', 'Carte de déchetterie', 'form_schema', schema_loc);

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

  -- r1 : la demande source. r2 : la voisine à ~50 m.
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
  values (org1, 'Nid-de-poule', 'Gros nid-de-poule devant le 12 rue des Lilas', proc_d1, snap_d1, s_voirie, lieu_a)
  returning id into r1;
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
  values (org1, 'Trou dans la chaussée', 'Chaussée abîmée', proc_d1, snap_d1, s_voirie,
          '{"intervention_lieu":{"address":"14 rue des Lilas 13200 Arles","lat":43.6771,"lon":4.6280}}')
  returning id into r2;
  -- r3 : à ~1,5 km, rien en commun.
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
  values (org1, 'Lampadaire éteint', 'Avenue Victor Hugo', proc_d1, snap_d1, s_voirie,
          '{"intervention_lieu":{"address":"Avenue Victor Hugo 13200 Arles","lat":43.6900,"lon":4.6300}}')
  returning id into r3;
  -- r4 : même point, démarche NON mutualisable.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
  values (org1, 'Carte déchetterie', proc_d2, snap_d2, s_voirie, lieu_a) returning id into r4;
  -- r5 : même point, au CCAS (invisible pour l'agent Voirie).
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data)
  values (org1, 'Nid-de-poule (CCAS)', proc_d1, snap_d1, s_ccas, lieu_a) returning id into r5;
  -- r6 : même point, reçue il y a 100 jours (hors fenêtre de 60).
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data, received_at)
  values (org1, 'Ancien signalement', proc_d1, snap_d1, s_voirie, lieu_a, now() - interval '100 days') returning id into r6;
  -- r7 : même point, résolue aujourd'hui → proposée. r8 : close depuis 40 jours → écartée.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data, received_at)
  values (org1, 'Déjà traité', proc_d1, snap_d1, s_voirie, lieu_a, now() - interval '20 days') returning id into r7;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, form_data, received_at)
  values (org1, 'Traité il y a longtemps', proc_d1, snap_d1, s_voirie, lieu_a, now() - interval '50 days') returning id into r8;
  update public.requests set status = 'resolue_negative', closure_motif = 'irrecevable' where id in (r7, r8);
  update public.requests set closed_at = now() - interval '40 days' where id = r8;
  -- r9 : aucun lieu, texte proche de r1.
  insert into public.requests (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_organization_id)
  values (org1, 'Nid-de-poule rue des Lilas', 'Gros nid-de-poule devant le 12 rue des Lilas', proc_d1, snap_d1, s_voirie)
  returning id into r9;

  -- ==========================================================================
  -- S1–S3. Depuis r1, agent Voirie
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select array_agg(f.request_id) into v_ids from public.find_similar_requests_for(r1) f;
  v_ids := coalesce(v_ids, '{}');
  if not (r2 = any(v_ids)) then v_fail := v_fail || 'S1a: la voisine a 50 m n''est pas proposee'::text; end if;
  if r3 = any(v_ids) then v_fail := v_fail || 'S1b: une demande a 1,5 km sans texte commun est proposee'::text; end if;
  select f.distance_m into v_dist from public.find_similar_requests_for(r1) f where f.request_id = r2;
  if v_dist is null or v_dist not between 30 and 70 then
    v_fail := v_fail || format('S1c: distance de la voisine %s m (attendu ~50)', v_dist); end if;
  if r4 = any(v_ids) then v_fail := v_fail || 'S2a: demarche non mutualisable proposee'::text; end if;
  if r6 = any(v_ids) then v_fail := v_fail || 'S2b: demande hors fenetre proposee'::text; end if;
  if not (r7 = any(v_ids)) then v_fail := v_fail || 'S2c: demande resolue recemment non proposee'::text; end if;
  if r8 = any(v_ids) then v_fail := v_fail || 'S2d: demande close depuis 40 jours proposee'::text; end if;
  if not (r9 = any(v_ids)) then v_fail := v_fail || 'S3a: demande sans lieu au texte proche non proposee'::text; end if;
  if r1 = any(v_ids) then v_fail := v_fail || 'S1d: la demande source se propose elle-meme'::text; end if;

  -- S4. RLS
  if r5 = any(v_ids) then v_fail := v_fail || 'S4a: une demande du CCAS est proposee a l''agent Voirie'::text; end if;
  select count(*) into v_int from public.request_locations where request_id = r5;
  if v_int <> 0 then v_fail := v_fail || 'S4b: l''agent Voirie lit le lieu d''une demande du CCAS'::text; end if;

  -- S5. Source non mutualisable
  select count(*) into v_int from public.find_similar_requests_for(r4);
  if v_int <> 0 then v_fail := v_fail || format('S5a: %s propositions pour une demarche non mutualisable', v_int); end if;

  -- S6. Brouillon de guichet
  select array_agg(f.request_id) into v_ids
    from public.find_similar_requests(org1, proc_d1, 43.6768, 4.6279, null, 'trou chaussée', null) f;
  v_ids := coalesce(v_ids, '{}');
  if not (r1 = any(v_ids) and r2 = any(v_ids)) then
    v_fail := v_fail || 'S6a: le brouillon ne retrouve pas les deux demandes voisines'::text; end if;
  select count(*) into v_int from public.find_similar_requests(org1, proc_d2, 43.6768, 4.6279, null, null, null);
  if v_int <> 0 then v_fail := v_fail || 'S6b: brouillon sur demarche non mutualisable : propositions'::text; end if;
  reset role;

  -- S4 (suite). L'agent à la racine voit le CCAS.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select array_agg(f.request_id) into v_ids from public.find_similar_requests_for(r1) f;
  if not (r5 = any(coalesce(v_ids, '{}'))) then
    v_fail := v_fail || 'S4c: l''agent a la racine ne se voit pas proposer la demande du CCAS'::text; end if;
  reset role;

  -- S7. Les membres du groupe ne sont plus proposés
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_voirie, 'role', 'authenticated')::text, true);
  perform public.link_requests(r1, r2);
  set local role authenticated;
  select array_agg(f.request_id) into v_ids from public.find_similar_requests_for(r1) f;
  if r2 = any(coalesce(v_ids, '{}')) then
    v_fail := v_fail || 'S7a: une demande deja liee est encore proposee'::text; end if;
  reset role;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (recherche demandes liees) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
