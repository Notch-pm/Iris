-- ============================================================================
-- Tests des fondations Iris — isolation entre tenants, rôles (agent /
-- administrateur), transitions refusées, immuabilité, idempotence, numérotation,
-- règle impérative « toute demande est fondée sur une démarche Socle active ».
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
  proc1    uuid := gen_random_uuid();  -- démarche active du tenant 1
  proc2    uuid := gen_random_uuid();  -- démarche active du tenant 2
  proc_obs uuid := gen_random_uuid();  -- démarche OBSOLÈTE du tenant 1
  snap1    jsonb;
  snap2    jsonb;
  r1       uuid;
  r2       uuid;
  r3       uuid;
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

  -- Démarches du cache Socle (règle impérative : socle_procedure_id obligatoire).
  insert into public.socle_procedure_cache
    (socle_id, organization_id, socle_root_org_id, name, category_name, type) values
    (proc1,    org1, s_a, 'Signalement voirie', 'Cadre de vie', 'signalement'),
    (proc_obs, org1, s_a, 'Ancienne démarche',  null,           null),
    (proc2,    org2, s_b, 'Demande tenant 2',   null,           null);
  update public.socle_procedure_cache set obsoleted_at = now() where socle_id = proc_obs;
  snap1 := jsonb_build_object('id', proc1::text, 'name', 'Signalement voirie', 'form_schema', null);
  snap2 := jsonb_build_object('id', proc2::text, 'name', 'Demande tenant 2');

  -- ----------------------------------------------------------------------
  -- Décor profils de droits (vague « profils de droits ») — depuis cette
  -- vague, la visibilité et les gardes de requests ne lisent plus
  -- organization_members.role (devenu colonne dérivée, M7) mais les droits
  -- effectifs par couple (organisation, démarche). Sans profils attribués,
  -- aucun des 15 scénarios ci-dessous ne pourrait plus rien voir ni écrire
  -- (fail closed). On reproduit ici EXACTEMENT la reprise M6 : deux profils
  -- par tenant, racine, matrice vide, défaut = les quatre droits — l'un
  -- is_admin (rôle admin1/administrateur), l'autre non (agent1/agent2/agent).
  -- ----------------------------------------------------------------------
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name)
  values (org1, s_a, null, 'Tenant Un'), (org2, s_b, null, 'Tenant Deux');

  declare
    p_admin1 uuid; p_agent1 uuid; p_agent2 uuid;
  begin
    insert into public.permission_profiles
      (organization_id, name, is_admin, default_view, default_create, default_process, default_close)
    values (org1, 'Administrateur', true, true, true, true, true)
    returning id into p_admin1;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_admin1, s_a);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_admin1, u_admin1);

    insert into public.permission_profiles
      (organization_id, name, is_admin, default_view, default_create, default_process, default_close)
    values (org1, 'Agent', false, true, true, true, true)
    returning id into p_agent1;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_agent1, s_a);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_agent1, u_agent1);

    insert into public.permission_profiles
      (organization_id, name, is_admin, default_view, default_create, default_process, default_close)
    values (org2, 'Agent', false, true, true, true, true)
    returning id into p_agent2;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_agent2, s_b);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org2, p_agent2, u_agent2);
  end;

  -- ----------------------------------------------------------------------
  -- T1 — création par un agent, numérotation, racine Socle, journal,
  --      libellés démarche/catégorie réécrits depuis le cache (vérité serveur)
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.requests
    (organization_id, subject, body, socle_procedure_id, procedure_snapshot, socle_procedure_label)
  values
    (org1, 'Nid de poule rue des Lilas', 'Signalement de voirie.', proc1, snap1, 'LIBELLÉ FALSIFIÉ')
  returning id into r1;

  select reference, status, socle_root_org_id into v_ref, v_status, v_root
    from public.requests where id = r1;
  if v_ref is distinct from format('DEM-%s-000001', v_year) then v_fail := v_fail || format('T1: référence %s au lieu de DEM-%s-000001', v_ref, v_year); end if;
  if v_status <> 'a_traiter' then v_fail := v_fail || 'T1: statut de naissance différent de a_traiter'; end if;
  if v_root is distinct from s_a then v_fail := v_fail || 'T1: socle_root_org_id non dérivée du tenant'; end if;

  select socle_procedure_label into v_ref from public.requests where id = r1;
  if v_ref is distinct from 'Signalement voirie' then v_fail := v_fail || 'T1: libellé démarche non réécrit depuis le cache'; end if;
  select socle_category_label into v_ref from public.requests where id = r1;
  if v_ref is distinct from 'Cadre de vie' then v_fail := v_fail || 'T1: libellé catégorie non réécrit depuis le cache'; end if;

  select count(*) into v_int from public.request_events where request_id = r1 and event_type = 'created';
  if v_int <> 1 then v_fail := v_fail || 'T1: événement created absent du journal'; end if;

  -- ----------------------------------------------------------------------
  -- T2 — numérotation indépendante par tenant
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent2, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
  values (org2, 'Demande tenant 2', proc2, snap2)
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
  select count(*) into v_int from public.socle_procedure_cache;
  if v_int <> 1 then v_fail := v_fail || format('T3: agent2 voit %s démarches en cache au lieu de 1 (fuite cross-tenant)', v_int); end if;

  -- ----------------------------------------------------------------------
  -- T4 — isolation en écriture : agent2 ne crée pas dans le tenant 1
  --      (démarche et snapshot VALIDES pour que le refus vienne bien de la RLS)
  -- ----------------------------------------------------------------------
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
    values (org1, 'Intrusion', proc1, snap1);
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
  -- T7 — réouverture : refusée à l'agent (a la clôture via le défaut de son
  -- profil, mais pas l'administration), permise à l'administrateur (profil
  -- is_admin + clôture par défaut — RM-21, désormais administration + clôture
  -- plutôt qu'un rôle).
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
  -- T8 — archivage : refusé à l'agent (clôture sans administration), permis
  --      à l'administrateur (administration + clôture, RM-21) ; gel archivé
  --      (procedure_snapshot compris) ; désarchivage = statut seul
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
  begin
    update public.requests
       set status = 'resolue_positive',
           procedure_snapshot = snap1 || jsonb_build_object('name', 'altéré')
     where id = r1;
    v_fail := v_fail || 'T8: désarchivage avec altération du snapshot de démarche accepté';
  exception when others then null;
  end;
  update public.requests set status = 'resolue_positive' where id = r1;  -- désarchivage admin

  -- ----------------------------------------------------------------------
  -- T9 — colonnes immuables (requester_snapshot compris), pas de suppression
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  begin
    update public.requests set received_at = now() - interval '1 day' where id = r1;
    v_fail := v_fail || 'T9: modification de received_at acceptée';
  exception when others then null;
  end;
  begin
    update public.requests
       set requester_snapshot = jsonb_build_object('declared', jsonb_build_object('last_name', 'Falsifié'))
     where id = r1;
    v_fail := v_fail || 'T9: modification de requester_snapshot acceptée (identité retenue au dépôt)';
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
  insert into public.requests (organization_id, subject, source, external_ref, socle_procedure_id, procedure_snapshot)
  values (org1, 'Depuis une source externe', 'source-test', 'action-ticket-1', proc1, snap1);
  begin
    insert into public.requests (organization_id, subject, source, external_ref, socle_procedure_id, procedure_snapshot)
    values (org1, 'Depuis une source externe (rejeu)', 'source-test', 'action-ticket-1', proc1, snap1);
    v_fail := v_fail || 'T12: doublon (source, external_ref) accepté';
  exception when unique_violation then null;
  end;

  -- ----------------------------------------------------------------------
  -- T13 — un client authentifié ne crée pas de demande de source externe
  -- ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.requests (organization_id, subject, source, external_ref, socle_procedure_id, procedure_snapshot)
    values (org1, 'Fausse ingestion', 'source-test', 'forge-1', proc1, snap1);
    v_fail := v_fail || 'T13: un agent a créé une demande de source externe';
  exception when others then null;
  end;
  execute 'reset role';

  -- ----------------------------------------------------------------------
  -- T14 — règle impérative : aucune demande libre. Testée en contexte de
  --       service (postgres, hors RLS) : la garde s'applique à TOUT LE MONDE.
  -- ----------------------------------------------------------------------
  begin
    insert into public.requests (organization_id, subject) values (org1, 'Demande libre');
    v_fail := v_fail || 'T14: demande SANS démarche acceptée';
  exception when others then null;
  end;
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
    values (org1, 'Démarche d''un autre tenant', proc2, snap2);
    v_fail := v_fail || 'T14: démarche d''un AUTRE TENANT acceptée';
  exception when others then null;
  end;
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
    values (org1, 'Démarche obsolète', proc_obs,
            jsonb_build_object('id', proc_obs::text, 'name', 'Ancienne démarche'));
    v_fail := v_fail || 'T14: démarche OBSOLÈTE acceptée';
  exception when others then null;
  end;
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id)
    values (org1, 'Sans snapshot', proc1);
    v_fail := v_fail || 'T14: demande sans procedure_snapshot acceptée';
  exception when others then null;
  end;
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
    values (org1, 'Snapshot incohérent', proc1, snap2);
    v_fail := v_fail || 'T14: snapshot d''une AUTRE démarche accepté';
  exception when others then null;
  end;

  -- ----------------------------------------------------------------------
  -- T15 — les demandes HISTORIQUES sans démarche restent transitionnables
  --       (simulation : garde désactivée le temps d'un insert « legacy »)
  -- ----------------------------------------------------------------------
  execute 'alter table public.requests disable trigger t16_requests_require_procedure';
  insert into public.requests (organization_id, subject)
  values (org1, 'Demande historique sans démarche') returning id into r3;
  execute 'alter table public.requests enable trigger t16_requests_require_procedure';

  select socle_procedure_id::text into v_ref from public.requests where id = r3;
  if v_ref is not null then v_fail := v_fail || 'T15: la demande historique porte une démarche inattendue'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction', assigned_to = u_agent1 where id = r3;
  select status into v_status from public.requests where id = r3;
  if v_status <> 'en_instruction' then v_fail := v_fail || 'T15: transition refusée sur une demande historique sans démarche'; end if;
  execute 'reset role';

  -- La garde réactivée refuse bien une nouvelle demande libre.
  begin
    insert into public.requests (organization_id, subject) values (org1, 'Nouvelle demande libre');
    v_fail := v_fail || 'T15: la garde n''a pas été réactivée (demande libre acceptée)';
  exception when others then null;
  end;

  -- ----------------------------------------------------------------------
  -- Verdict — l'exception finale annule TOUTE la transaction.
  -- ----------------------------------------------------------------------
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (15 scénarios) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%s) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
