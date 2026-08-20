-- ============================================================================
-- Tests des fondations Iris — isolation entre tenants, rôles (agent /
-- administrateur), transitions refusées, immuabilité, idempotence, numérotation.
--
-- Exécution : lancer ce script tel quel dans un contexte postgres en
-- lecture-écriture (SQL editor du dashboard ; le MCP execute_sql est en
-- lecture seule → passer par apply_migration, l'échec final volontaire
-- empêche tout enregistrement de migration).
-- Le bloc DO simule les identités via request.jwt.claims + SET LOCAL ROLE,
-- puis se termine TOUJOURS par RAISE EXCEPTION : la transaction est annulée,
-- aucune donnée de test ne subsiste (motif Socle « test transactionnel annulé »).
-- ============================================================================

do $main$
declare
  v_year   int  := extract(year from now())::int;
  s_a      uuid := gen_random_uuid();  -- racine Socle du tenant 1
  s_b      uuid := gen_random_uuid();  -- racine Socle du tenant 2
  org1     uuid;
  org2     uuid;
  u_admin1 uuid := gen_random_uuid();  -- administrateur du tenant 1
  u_agent1 uuid := gen_random_uuid();  -- agent du tenant 1
  u_agent2 uuid := gen_random_uuid();  -- agent du tenant 2
  r1       uuid;
  r2       uuid;
  v_ref    text;
  v_status text;
  v_root   uuid;
  v_int    int;
  v_ts     timestamptz;
  v_fail   text[] := '{}';
begin
  -- ----------------------------------------------------------------------
  -- Mise en place (en tant que postgres : propriétaire, hors RLS)
  -- ⚠️ auth.users.created_at n'a PAS de défaut : NULL fait planter GoTrue.
  -- ----------------------------------------------------------------------
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin1, 'admin1@t1.test', now(), now()),
    (u_agent1, 'agent1@t1.test', now(), now()),
    (u_agent2, 'agent2@t2.test', now(), now());

  select count(*) into v_int from public.users
   where id in (u_admin1, u_agent1, u_agent2);
  if v_int <> 3 then v_fail := v_fail || format('SETUP: handle_new_user — %s profils créés au lieu de 3', v_int); end if;

  insert into public.organizations (socle_org_id, name) values (s_a, 'Tenant Un') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_b, 'Tenant Deux') returning id into org2;
  -- Registre dynamique : toute source non-iris doit être enregistrée et active.
  insert into public.integration_sources (organization_id, code, name)
  values (org1, 'source-test', 'Source de test');
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_admin1, 'administrateur'),
    (org1, u_agent1, 'agent'),
    (org2, u_agent2, 'agent');

  -- ----------------------------------------------------------------------
  -- T1 — création par un agent, numérotation, racine Socle, journal
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.requests (organization_id, subject, body)
  values (org1, 'Nid de poule rue des Lilas', 'Signalement de voirie.')
  returning id into r1;

  select reference, status, socle_root_org_id into v_ref, v_status, v_root
    from public.requests where id = r1;
  if v_ref is distinct from format('DEM-%s-000001', v_year) then v_fail := v_fail || format('T1: référence %s au lieu de DEM-%s-000001', v_ref, v_year); end if;
  if v_status <> 'a_traiter' then v_fail := v_fail || 'T1: statut de naissance différent de a_traiter'; end if;
  if v_root is distinct from s_a then v_fail := v_fail || 'T1: socle_root_org_id non dérivée du tenant'; end if;

  select count(*) into v_int from public.request_events where request_id = r1 and event_type = 'created';
  if v_int <> 1 then v_fail := v_fail || 'T1: événement created absent du journal'; end if;

  -- ----------------------------------------------------------------------
  -- T2 — numérotation indépendante par tenant
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent2, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject) values (org2, 'Demande tenant 2')
  returning id into r2;
  select reference into v_ref from public.requests where id = r2;
  if v_ref is distinct from format('DEM-%s-000001', v_year) then v_fail := v_fail || 'T2: la séquence du tenant 2 n''est pas indépendante'; end if;

  -- ----------------------------------------------------------------------
  -- T3 — isolation en lecture : agent2 ne voit rien du tenant 1
  -- ----------------------------------------------------------------------
  select count(*) into v_int from public.requests;
  if v_int <> 1 then v_fail := v_fail || format('T3: agent2 voit %s demandes au lieu de 1', v_int); end if;
  select count(*) into v_int from public.requests where id = r1;
  if v_int <> 0 then v_fail := v_fail || 'T3: agent2 voit la demande du tenant 1'; end if;
  select count(*) into v_int from public.request_events where request_id = r1;
  if v_int <> 0 then v_fail := v_fail || 'T3: agent2 voit le journal du tenant 1'; end if;

  -- ----------------------------------------------------------------------
  -- T4 — isolation en écriture : agent2 ne crée pas dans le tenant 1
  -- ----------------------------------------------------------------------
  begin
    insert into public.requests (organization_id, subject) values (org1, 'Intrusion');
    v_fail := v_fail || 'T4: insertion cross-tenant acceptée';
  exception when others then null;  -- refus attendu (RLS)
  end;

  -- ----------------------------------------------------------------------
  -- T5 — transitions refusées (matrice + exigences de données)
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  begin
    update public.requests set status = 'resolue_positive', closure_text = 'x' where id = r1;
    v_fail := v_fail || 'T5: a_traiter → resolue_positive acceptée (interdit sans instruction)';
  exception when others then null;
  end;
  begin
    update public.requests set status = 'archivee' where id = r1;
    v_fail := v_fail || 'T5: a_traiter → archivee acceptée';
  exception when others then null;
  end;
  begin
    update public.requests set status = 'en_instruction' where id = r1;  -- sans assigné
    v_fail := v_fail || 'T5: passage en instruction sans agent assigné accepté';
  exception when others then null;
  end;

  -- Transition légitime : prise en charge par agent1.
  update public.requests set status = 'en_instruction', assigned_to = u_agent1 where id = r1;
  select version into v_int from public.requests where id = r1;
  if v_int <> 2 then v_fail := v_fail || format('T5: version %s au lieu de 2 après première écriture', v_int); end if;
  select count(*) into v_int from public.request_events where request_id = r1 and event_type = 'status_changed';
  if v_int <> 1 then v_fail := v_fail || 'T5: événement status_changed absent'; end if;
  select count(*) into v_int from public.request_assignments where request_id = r1;
  if v_int <> 1 then v_fail := v_fail || 'T5: historique d''affectation non alimenté'; end if;

  -- ----------------------------------------------------------------------
  -- T6 — résolution : texte de clôture obligatoire
  -- ----------------------------------------------------------------------
  begin
    update public.requests set status = 'resolue_positive' where id = r1;
    v_fail := v_fail || 'T6: résolution sans texte de clôture acceptée';
  exception when others then null;
  end;
  update public.requests set status = 'resolue_positive',
         closure_text = 'Votre signalement a été traité : rebouchage effectué.' where id = r1;
  select closed_at into v_ts from public.requests where id = r1;
  if v_ts is null then v_fail := v_fail || 'T6: closed_at non posée à la clôture'; end if;

  -- ----------------------------------------------------------------------
  -- T7 — réouverture : refusée à l'agent, permise à l'administrateur
  -- ----------------------------------------------------------------------
  begin
    update public.requests set status = 'en_instruction' where id = r1;
    v_fail := v_fail || 'T7: réouverture acceptée pour un agent';
  exception when others then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin1, 'role', 'authenticated')::text, true);
  update public.requests set status = 'en_instruction' where id = r1;
  select closed_at into v_ts from public.requests where id = r1;
  if v_ts is not null then v_fail := v_fail || 'T7: closed_at non purgée à la réouverture'; end if;

  -- ----------------------------------------------------------------------
  -- T8 — archivage : refusé à l'agent, permis à l'administrateur ; gel archivé
  -- ----------------------------------------------------------------------
  update public.requests set status = 'resolue_positive',
         closure_text = 'Clôture après réexamen.' where id = r1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  begin
    update public.requests set status = 'archivee' where id = r1;
    v_fail := v_fail || 'T8: archivage accepté pour un agent';
  exception when others then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_admin1, 'role', 'authenticated')::text, true);
  update public.requests set status = 'archivee' where id = r1;
  begin
    update public.requests set subject = 'retouche interdite' where id = r1;
    v_fail := v_fail || 'T8: modification d''une demande archivée acceptée';
  exception when others then null;
  end;
  update public.requests set status = 'resolue_positive' where id = r1;  -- désarchivage admin

  -- ----------------------------------------------------------------------
  -- T9 — colonnes immuables et interdiction de suppression
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  begin
    update public.requests set received_at = now() - interval '1 day' where id = r1;
    v_fail := v_fail || 'T9: modification de received_at acceptée';
  exception when others then null;
  end;
  delete from public.requests where id = r1;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'T9: DELETE accepté sur une demande'; end if;

  -- ----------------------------------------------------------------------
  -- T10 — lien vers une demande d'un autre tenant : refusé
  -- ----------------------------------------------------------------------
  begin
    insert into public.request_links (organization_id, request_id, link_type, target_request_id)
    values (org1, r1, 'liee_a', r2);
    v_fail := v_fail || 'T10: lien cross-tenant accepté';
  exception when others then null;
  end;

  -- ----------------------------------------------------------------------
  -- T11 — journal immuable, même en contexte de service
  -- ----------------------------------------------------------------------
  execute 'reset role';
  begin
    update public.request_events set payload = '{}'::jsonb where request_id = r1;
    v_fail := v_fail || 'T11: UPDATE du journal accepté';
  exception when others then null;
  end;
  begin
    delete from public.request_events where request_id = r1;
    v_fail := v_fail || 'T11: DELETE du journal accepté';
  exception when others then null;
  end;

  -- ----------------------------------------------------------------------
  -- T12 — idempotence d'ingestion (contexte de service, source externe)
  -- ----------------------------------------------------------------------
  insert into public.requests (organization_id, subject, source, external_ref)
  values (org1, 'Depuis une source externe', 'source-test', 'action-ticket-1');
  begin
    insert into public.requests (organization_id, subject, source, external_ref)
    values (org1, 'Depuis une source externe (rejeu)', 'source-test', 'action-ticket-1');
    v_fail := v_fail || 'T12: doublon (source, external_ref) accepté';
  exception when unique_violation then null;
  end;

  -- ----------------------------------------------------------------------
  -- T13 — un client authentifié ne crée pas de demande de source externe
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.requests (organization_id, subject, source, external_ref)
    values (org1, 'Fausse ingestion', 'source-test', 'forge-1');
    v_fail := v_fail || 'T13: un agent a créé une demande de source externe';
  exception when others then null;
  end;
  execute 'reset role';

  -- ----------------------------------------------------------------------
  -- Verdict — l'exception finale annule TOUTE la transaction.
  -- ----------------------------------------------------------------------
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (13 scénarios) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%s) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
