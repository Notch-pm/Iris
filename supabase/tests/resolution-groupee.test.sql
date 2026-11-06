-- ============================================================================
-- Tests de la RÉSOLUTION GROUPÉE d'une sélection libre (migration
-- 20261104100000, B7 — décision PO du 2026-11-04).
--
--   G1. Sélection libre, sans aucun lien : une demande « À traiter » sans
--       instructeur passe par l'instruction (FAIT PAR LE SERVEUR) et l'agent
--       en devient l'instructeur ; une demande déjà affectée garde son
--       instructeur ; une demande « En attente » passe par l'instruction.
--   G2. Résultat PARTIEL : t17 refuse la résolution positive d'une demande à
--       pièce obligatoire manquante, qui revient EXACTEMENT à son état.
--   G3. Hors périmètre, déjà close, sans droit de clôture : refusées, motif dit.
--   G4. Doublons de la sélection retirés ; lot vide, lot trop grand, et toute
--       autre transition qu'une résolution : refusés en bloc.
--   G5. Journal : `resolved_in_batch` (taille du lot) sur chaque demande
--       résolue, aucun sur une refusée ; `log_batch_resolution` appelé seul ne
--       consigne rien qui n'ait été fait dans la transaction par l'appelant.
--   G6. Résolution négative avec motif depuis « À traiter ».
--   G7. Les fonctions ne sont pas exécutables par `anon`.
--
-- Exécution : bloc DO, contexte postgres — le `raise exception` final annule tout.
-- La résolution commune des groupes garde son propre test
-- (demandes-liees-resolution.test.sql), à rejouer avec celui-ci.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  org1 uuid;
  proc_d1 uuid := gen_random_uuid();
  proc_d2 uuid := gen_random_uuid();  -- consultation + instruction seulement pour u_agent
  snap    jsonb;
  snap2   jsonb;
  snap_pj jsonb;
  u_agent uuid := gen_random_uuid();
  u_autre uuid := gen_random_uuid();
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid;
  big uuid[];
  v_fail text[] := '{}';
  res    record;
  v_status text;
  v_uuid   uuid;
  v_text   text;
  v_int    int;
  v_json   jsonb;
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@lot.test', now(), now()), (u_autre, 'autre@lot.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Lot') returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_agent, 'agent'), (org1, u_autre, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc_d1, org1, s_root, 'Signalement voirie'), (proc_d2, org1, s_root, 'Autre démarche');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_d1, s_voirie), (org1, proc_d1, s_ccas), (org1, proc_d2, s_voirie);
  snap    := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie');
  snap2   := jsonb_build_object('id', proc_d2::text, 'name', 'Autre démarche');
  snap_pj := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie', 'form_schema',
    '{"version":1,"content":[{"id":"f-photo","key":"photo","label":"Photo","type":"attachment","required":true}]}'::jsonb);

  -- u_agent : tous droits sur D1 à la Voirie ; D2 sans clôture.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Agent Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, true, true, true), (p_id, proc_d2, true, true, true, false);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_agent);
  -- u_autre : instructeur de r3 (tous droits partout).
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Autre', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_autre);

  -- r1 à traiter sans instructeur ; r2 en instruction affectée à u_autre ; r3 en
  -- attente ; r4 pièce obligatoire absente (à traiter, sans instructeur) ; r5 au
  -- CCAS (invisible) ; r6 déjà résolue ; r7 D2 (pas de clôture) ; r8 à traiter
  -- (résolution négative) ; r9 témoin pour log_batch_resolution.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'A traiter', proc_d1, snap, s_voirie) returning id into r1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Deja affectee', proc_d1, snap, s_voirie) returning id into r2;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'En attente', proc_d1, snap, s_voirie) returning id into r3;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Piece manquante', proc_d1, snap_pj, s_voirie) returning id into r4;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'CCAS', proc_d1, snap, s_ccas) returning id into r5;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Deja resolue', proc_d1, snap, s_voirie) returning id into r6;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Sans cloture', proc_d2, snap2, s_voirie) returning id into r7;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Negative', proc_d1, snap, s_voirie) returning id into r8;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Temoin', proc_d1, snap, s_voirie) returning id into r9;

  -- Décor en contexte service (postgres).
  update public.requests set assigned_to = u_autre, status = 'en_instruction' where id = r2;
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id in (r3, r6, r9);
  update public.requests set status = 'en_attente' where id = r3;
  update public.requests set status = 'resolue_negative', closure_motif = 'abandon' where id in (r6, r9);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ==========================================================================
  -- G1–G3, G4 (doublons) : un lot, sans aucun lien entre les demandes.
  -- ==========================================================================
  v_int := 0;
  for res in
    select * from public.resolve_requests(array[r1, r2, r3, r4, r5, r6, r7, r1],
                                          'resolue_positive', null, 'Traité le 4 novembre.')
  loop
    v_int := v_int + 1;
    if res.request_id = r1 and not (res.ok and res.took_over and res.chained) then
      v_fail := v_fail || format('G1a: r1 %s', row_to_json(res)); end if;
    if res.request_id = r2 and not (res.ok and not res.took_over and not res.chained) then
      v_fail := v_fail || format('G1b: r2 %s', row_to_json(res)); end if;
    if res.request_id = r3 and not (res.ok and res.chained and not res.took_over) then
      v_fail := v_fail || format('G1c: r3 %s', row_to_json(res)); end if;
    if res.request_id = r4 and (res.ok or res.error not like '%pièce(s) obligatoire(s)%') then
      v_fail := v_fail || format('G2a: r4 %s', row_to_json(res)); end if;
    if res.request_id = r5 and (res.ok or res.error not like '%hors de votre périmètre%') then
      v_fail := v_fail || format('G3a: r5 %s', row_to_json(res)); end if;
    if res.request_id = r6 and (res.ok or res.error not like '%déjà close%') then
      v_fail := v_fail || format('G3b: r6 %s', row_to_json(res)); end if;
    if res.request_id = r7 and res.ok then
      v_fail := v_fail || format('G3c: r7 resolue sans droit de cloture %s', row_to_json(res)); end if;
  end loop;
  if v_int <> 7 then v_fail := v_fail || format('G4a: %s lignes au lieu de 7 (doublon non retire)', v_int); end if;
  reset role;

  select status, assigned_to, closure_text into v_status, v_uuid, v_text from public.requests where id = r1;
  if v_status <> 'resolue_positive' or v_uuid is distinct from u_agent or v_text is distinct from 'Traité le 4 novembre.' then
    v_fail := v_fail || format('G1d: r1 %s / %s / %s', v_status, v_uuid, v_text); end if;
  select count(*) into v_int from public.request_events
   where request_id = r1 and event_type = 'status_changed' and payload ->> 'to' = 'en_instruction';
  if v_int <> 1 then v_fail := v_fail || 'G1e: le passage par l''instruction n''est pas au journal de r1'::text; end if;
  select assigned_to into v_uuid from public.requests where id = r2;
  if v_uuid is distinct from u_autre then v_fail := v_fail || 'G1f: l''instructeur de r2 a ete remplace'::text; end if;
  select status, assigned_to into v_status, v_uuid from public.requests where id = r4;
  if v_status <> 'a_traiter' or v_uuid is not null then
    v_fail := v_fail || format('G2b: r4 n''est pas revenue a son etat (%s, %s)', v_status, v_uuid); end if;
  select status, assigned_to into v_status, v_uuid from public.requests where id = r7;
  if v_status <> 'a_traiter' or v_uuid is not null then
    v_fail := v_fail || format('G3d: r7 n''est pas revenue a son etat (%s, %s)', v_status, v_uuid); end if;
  select status into v_status from public.requests where id = r5;
  if v_status <> 'a_traiter' then v_fail := v_fail || 'G3e: r5 (hors perimetre) a ete modifiee'::text; end if;

  -- G5. Journal
  select payload into v_json from public.request_events where request_id = r1 and event_type = 'resolved_in_batch';
  if v_json is null or (v_json ->> 'took_over')::boolean is not true or (v_json ->> 'chained')::boolean is not true
     or (v_json ->> 'batch_size')::int <> 7 then
    v_fail := v_fail || format('G5a: resolved_in_batch de r1 %s', v_json); end if;
  select count(*) into v_int from public.request_events
   where request_id in (r4, r5, r6, r7) and event_type = 'resolved_in_batch';
  if v_int <> 0 then v_fail := v_fail || 'G5b: une demande refusee est dite resolue en lot'::text; end if;
  select resolved_by into v_uuid from public.request_stats where request_id = r1;
  if v_uuid is distinct from u_agent then v_fail := v_fail || format('G5c: resolved_by de r1 = %s', v_uuid); end if;

  set local role authenticated;
  -- r9 a été résolue dans le décor, pas par u_agent : rien à consigner.
  perform public.log_batch_resolution(array[r9], '{}', '{}', 1);
  reset role;
  select count(*) into v_int from public.request_events where request_id = r9 and event_type = 'resolved_in_batch';
  if v_int <> 0 then v_fail := v_fail || 'G5d: log_batch_resolution a consigne une resolution qui n''est pas de l''appelant'::text; end if;

  -- G6. Négative avec motif depuis « À traiter »
  set local role authenticated;
  select * into res from public.resolve_requests(array[r8], 'resolue_negative', 'reorientation', null);
  reset role;
  select status into v_status from public.requests where id = r8;
  if not res.ok or v_status <> 'resolue_negative' then
    v_fail := v_fail || format('G6a: r8 %s / %s', row_to_json(res), v_status); end if;

  -- G4. Refus en bloc
  set local role authenticated;
  begin
    perform * from public.resolve_requests(array[r4], 'annulee', 'abandon', null);
    v_fail := v_fail || 'G4b: une annulation en lot a ete acceptee'::text;
  exception when others then
    if sqlerrm not like '%seule une résolution%' then v_fail := v_fail || format('G4b: %s', sqlerrm); end if;
  end;
  begin
    perform * from public.resolve_requests('{}', 'resolue_positive', null, null);
    v_fail := v_fail || 'G4c: un lot vide a ete accepte'::text;
  exception when others then
    if sqlerrm not like '%aucune demande%' then v_fail := v_fail || format('G4c: %s', sqlerrm); end if;
  end;
  select array_agg(gen_random_uuid()) into big from generate_series(1, 51);
  begin
    perform * from public.resolve_requests(big, 'resolue_positive', null, null);
    v_fail := v_fail || 'G4d: un lot de 51 a ete accepte'::text;
  exception when others then
    if sqlerrm not like '%50 demandes au plus%' then v_fail := v_fail || format('G4d: %s', sqlerrm); end if;
  end;
  -- La garde reste fermée à un UPDATE client direct.
  begin
    update public.requests set assigned_to = u_agent, status = 'resolue_positive' where id = r4;
    v_fail := v_fail || 'G4e: a_traiter -> resolue_positive accepte en UPDATE direct'::text;
  exception when others then
    if sqlerrm not like '%Transition de statut interdite%' then v_fail := v_fail || format('G4e: %s', sqlerrm); end if;
  end;
  reset role;

  -- G7. Privilèges
  if has_function_privilege('anon', 'public.resolve_requests(uuid[], text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.resolve_one_request(uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.log_batch_resolution(uuid[], uuid[], uuid[], integer)', 'execute') then
    v_fail := v_fail || 'G7a: une fonction de la resolution groupee est executable par anon'::text; end if;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (resolution groupee) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
