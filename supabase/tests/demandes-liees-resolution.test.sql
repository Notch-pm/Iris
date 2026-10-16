-- ============================================================================
-- Tests de la RÉSOLUTION COMMUNE (migration 20261016160000).
--
--   R1. Une demande « À traiter » sans instructeur se résout avec le groupe :
--       passage par l'instruction FAIT PAR LE SERVEUR, agent qui résout affecté
--       (décision PO 2026-10-16).
--   R2. Une demande déjà affectée garde son instructeur.
--   R3. Une demande « En attente » passe par l'instruction elle aussi.
--   R4. Résultat PARTIEL : t17 refuse la résolution positive d'une demande à
--       pièce obligatoire non conforme — et cette demande revient EXACTEMENT à
--       son état (aucune affectation résiduelle).
--   R5. Hors groupe, hors périmètre, déjà close : refusées, motif dit.
--   R6. Journal : `resolved_with_group` sur chaque demande résolue,
--       `group_resolution` sur la source ; statistiques : resolved_by = l'agent.
--   R7. Seule une résolution se propage ; une source hors groupe est refusée.
--   R8. La garde n'est pas ouverte : un UPDATE client direct `a_traiter →
--       resolue_positive` reste interdit.
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
  proc_d1 uuid := gen_random_uuid();
  snap    jsonb;
  snap_pj jsonb;
  u_agent uuid := gen_random_uuid();  -- création + instruction + clôture, Voirie
  u_autre uuid := gen_random_uuid();  -- instructeur déjà affecté à r3
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid;
  v_fail text[] := '{}';
  res    record;
  v_status text;
  v_uuid   uuid;
  v_text   text;
  v_int    int;
  v_json   jsonb;
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@resolution.test', now(), now()), (u_autre, 'autre@resolution.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Résolution') returning id into org1;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_agent, 'agent'), (org1, u_autre, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc_d1, org1, s_root, 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_d1, s_voirie), (org1, proc_d1, s_ccas);
  insert into public.procedure_link_settings (organization_id, socle_procedure_id, enabled)
    values (org1, proc_d1, true);
  snap := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie');
  snap_pj := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement voirie', 'form_schema',
    '{"version":1,"content":[{"id":"f-photo","key":"photo","label":"Photo","type":"attachment","required":true}]}'::jsonb);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Agent Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_agent);
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Autre', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_d1, true, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_autre);

  -- r1 source (en instruction) ; r2 à traiter sans instructeur ; r3 en instruction
  -- affectée à u_autre ; r4 en attente ; r5 pièce obligatoire absente ; r6 au CCAS
  -- (invisible pour u_agent) ; r7 hors groupe ; r8 déjà résolue.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Source', proc_d1, snap, s_voirie) returning id into r1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'A traiter', proc_d1, snap, s_voirie) returning id into r2;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Deja affectee', proc_d1, snap, s_voirie) returning id into r3;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'En attente', proc_d1, snap, s_voirie) returning id into r4;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Piece manquante', proc_d1, snap_pj, s_voirie) returning id into r5;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'CCAS', proc_d1, snap, s_ccas) returning id into r6;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Hors groupe', proc_d1, snap, s_voirie) returning id into r7;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Deja resolue', proc_d1, snap, s_voirie) returning id into r8;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Garde', proc_d1, snap, s_voirie) returning id into r9;

  -- Décor en contexte service (postgres).
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id = r1;
  update public.requests set assigned_to = u_autre, status = 'en_instruction' where id = r3;
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id in (r4, r8);
  update public.requests set status = 'en_attente' where id = r4;
  update public.requests set status = 'resolue_negative', closure_motif = 'abandon' where id = r8;
  -- r5 reste « à traiter » et SANS instructeur : t17 doit le refuser, et l'affectation doit être annulée avec.

  -- Groupe : r1..r6, r8 (par u_autre, qui voit tout).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  perform public.link_requests(r1, r2);
  perform public.link_requests(r1, r3);
  perform public.link_requests(r1, r4);
  perform public.link_requests(r1, r5);
  perform public.link_requests(r1, r6);
  perform public.link_requests(r1, r8);

  -- ==========================================================================
  -- La source passe par le chemin ordinaire, puis le groupe.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.requests set status = 'resolue_positive', closure_text = 'Réparé le 16 octobre.' where id = r1;

  for res in
    select * from public.resolve_linked_requests(r1, array[r2, r3, r4, r5, r6, r7, r8],
                                                 'resolue_positive', null, 'Réparé le 16 octobre.')
  loop
    if res.request_id = r2 and not (res.ok and res.took_over and res.chained) then
      v_fail := v_fail || format('R1a: r2 %s', row_to_json(res)); end if;
    if res.request_id = r3 and not (res.ok and not res.took_over and not res.chained) then
      v_fail := v_fail || format('R2a: r3 %s', row_to_json(res)); end if;
    if res.request_id = r4 and not (res.ok and res.chained) then
      v_fail := v_fail || format('R3a: r4 %s', row_to_json(res)); end if;
    if res.request_id = r5 and (res.ok or res.error not like '%pièce(s) obligatoire(s)%') then
      v_fail := v_fail || format('R4a: r5 %s', row_to_json(res)); end if;
    if res.request_id = r6 and (res.ok or res.error not like '%hors de votre périmètre%') then
      v_fail := v_fail || format('R5a: r6 %s', row_to_json(res)); end if;
    if res.request_id = r7 and (res.ok or res.error not like '%pas liée%') then
      v_fail := v_fail || format('R5b: r7 %s', row_to_json(res)); end if;
    if res.request_id = r8 and (res.ok or res.error not like '%déjà close%') then
      v_fail := v_fail || format('R5c: r8 %s', row_to_json(res)); end if;
  end loop;
  reset role;

  select status, assigned_to, closure_text into v_status, v_uuid, v_text from public.requests where id = r2;
  if v_status <> 'resolue_positive' or v_uuid is distinct from u_agent or v_text is distinct from 'Réparé le 16 octobre.' then
    v_fail := v_fail || format('R1b: r2 %s / %s / %s', v_status, v_uuid, v_text); end if;
  select count(*) into v_int from public.request_events
   where request_id = r2 and event_type = 'status_changed' and payload ->> 'to' = 'en_instruction';
  if v_int <> 1 then v_fail := v_fail || 'R1c: le passage par l''instruction n''est pas au journal de r2'::text; end if;
  select assigned_to, status into v_uuid, v_status from public.requests where id = r3;
  if v_uuid is distinct from u_autre or v_status <> 'resolue_positive' then
    v_fail := v_fail || 'R2b: l''instructeur affecte de r3 a ete remplace'::text; end if;
  select status into v_status from public.requests where id = r4;
  if v_status <> 'resolue_positive' then v_fail := v_fail || format('R3b: r4 %s', v_status); end if;
  select status, assigned_to into v_status, v_uuid from public.requests where id = r5;
  if v_status <> 'a_traiter' or v_uuid is not null then
    v_fail := v_fail || format('R4b: r5 n''est pas revenue a son etat (%s, %s)', v_status, v_uuid); end if;
  select status into v_status from public.requests where id = r6;
  if v_status <> 'a_traiter' then v_fail := v_fail || 'R5d: r6 (hors perimetre) a ete modifiee'::text; end if;

  -- R6. Journal et statistiques
  select payload into v_json from public.request_events where request_id = r2 and event_type = 'resolved_with_group';
  if v_json is null or (v_json ->> 'took_over')::boolean is not true or (v_json ->> 'source_request_id')::uuid <> r1 then
    v_fail := v_fail || format('R6a: evenement resolved_with_group de r2 %s', v_json); end if;
  select payload into v_json from public.request_events where request_id = r1 and event_type = 'group_resolution';
  if v_json is null or (v_json ->> 'count')::int <> 3 then
    v_fail := v_fail || format('R6b: evenement group_resolution de la source %s', v_json); end if;
  select count(*) into v_int from public.request_events where request_id = r5 and event_type = 'resolved_with_group';
  if v_int <> 0 then v_fail := v_fail || 'R6c: une demande refusee est dite resolue au journal'::text; end if;
  select resolved_by into v_uuid from public.request_stats where request_id = r2;
  if v_uuid is distinct from u_agent then
    v_fail := v_fail || format('R6d: resolved_by de r2 = %s', v_uuid); end if;

  -- R7. Seule une résolution se propage ; source hors groupe
  set local role authenticated;
  begin
    perform * from public.resolve_linked_requests(r1, array[r5], 'annulee', 'abandon', null);
    v_fail := v_fail || 'R7a: une annulation s''est propagee'::text;
  exception when others then
    if sqlerrm not like '%seule une résolution%' then v_fail := v_fail || format('R7a: %s', sqlerrm); end if;
  end;
  begin
    perform * from public.resolve_linked_requests(r7, array[r5], 'resolue_positive', null, null);
    v_fail := v_fail || 'R7b: source hors groupe acceptee'::text;
  exception when others then
    if sqlerrm not like '%liée à aucune autre%' then v_fail := v_fail || format('R7b: %s', sqlerrm); end if;
  end;

  -- R8. La garde n'est pas ouverte pour un client
  begin
    update public.requests set assigned_to = u_agent, status = 'resolue_positive' where id = r9;
    v_fail := v_fail || 'R8a: a_traiter -> resolue_positive accepte en UPDATE direct'::text;
  exception when others then
    if sqlerrm not like '%Transition de statut interdite%' then v_fail := v_fail || format('R8a: %s', sqlerrm); end if;
  end;
  reset role;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (resolution commune) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
