-- ============================================================================
-- Tests des STATISTIQUES (migration 20260918100000).
--
--   1. Les FAITS suivent la demande : réception au dépôt, première entrée en
--      instruction, résolution (issue + auteur), réouverture (effacés),
--      archivage (conservés), désarchivage (inchangés).
--   2. Le trigger et la RECONSTRUCTION (`rebuild_request_stats`) produisent la
--      même ligne.
--   3. La VISIBILITÉ est celle des demandes : par couple (organisme, démarche),
--      elle suit un transfert ; un autre tenant, un service frère et un
--      intervenant pur ne voient rien ; l'admin plateforme voit.
--   4. AUCUNE écriture cliente.
--   5. Les RPC `stats_*` rendent, sous `authenticated`, ce que le lecteur a le
--      droit de voir — et rien pour `anon`.
--   6. Les interventions ont leurs faits (sollicitation, réalisation).
--   7. SURVIE À LA PURGE : la demande supprimée, ses faits restent, et restent
--      visibles par l'agent du couple.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root    uuid := gen_random_uuid();
  s_voirie  uuid := gen_random_uuid();
  s_ccas    uuid := gen_random_uuid();
  s_rootB   uuid := gen_random_uuid();
  orgA      uuid;
  orgB      uuid;
  proc      uuid := gen_random_uuid();
  snap      jsonb;
  u_alex     uuid := gen_random_uuid();  -- instruction Voirie seule
  u_large    uuid := gen_random_uuid();  -- racine : instruction + clôture + administration
  u_ccas     uuid := gen_random_uuid();  -- instruction CCAS seule
  u_sam      uuid := gen_random_uuid();  -- INTERVENANT Voirie, aucun droit
  u_other    uuid := gen_random_uuid();  -- agent d'un AUTRE tenant
  u_platform uuid := gen_random_uuid();  -- admin plateforme
  p_id      uuid;
  req1 uuid; req2 uuid; req3 uuid;
  v_inter   uuid;
  v_fail    text[] := '{}';
  v_int     int;
  v_int2    int;
  v_text    text;
  v_uuid    uuid;
  v_ts      timestamptz;
  v_ts2     timestamptz;
  v_json    jsonb;
  v_json2   jsonb;
  v_num     double precision;
  v_today   date := (now() at time zone 'Europe/Paris')::date;
  v_since   timestamptz := '2026-01-01T00:00:00Z';
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,     'alex@stats.test',     now(), now()),
    (u_large,    'large@stats.test',    now(), now()),
    (u_ccas,     'ccas@stats.test',     now(), now()),
    (u_sam,      'sam@stats.test',      now(), now()),
    (u_other,    'other@stats.test',    now(), now()),
    (u_platform, 'platform@stats.test', now(), now());
  update public.users set first_name = 'Large', last_name = 'Mairie' where id = u_large;
  update public.users set first_name = 'Sam',   last_name = 'Ouvrier' where id = u_sam;
  update public.users set is_platform_admin = true where id = u_platform;

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Stats')
    returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_rootB, 'Autre tenant')
    returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_alex, 'agent'), (orgA, u_large, 'agent'), (orgA, u_ccas, 'agent'),
    (orgA, u_sam, 'agent'), (orgB, u_other, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,   null,   'Mairie'),
    (orgA, s_voirie, s_root, 'Voirie'),
    (orgA, s_ccas,   s_root, 'CCAS'),
    (orgB, s_rootB,  null,   'Autre');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement nid-de-poule');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement nid-de-poule');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_ccas), (orgA, proc, s_root);

  insert into public.permission_profiles (organization_id, name) values (orgA, 'Alex-Voirie')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_alex);

  insert into public.permission_profiles (organization_id, name, is_admin, default_view, default_process, default_close)
    values (orgA, 'Large-Mairie', true, true, true, true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process, right_close)
    values (p_id, proc, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_large);

  insert into public.permission_profiles (organization_id, name) values (orgA, 'CCAS-instruction')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  insert into public.permission_profiles (organization_id, name, is_intervenant)
    values (orgA, 'Intervenant-Voirie', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_sam);

  insert into public.permission_profiles (organization_id, name, default_view, default_process)
    values (orgB, 'Other-tout', true, true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_rootB);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_other);

  -- ==========================================================================
  -- S1. Le dépôt crée la ligne de faits
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, assigned_to, received_at, channel)
  values (orgA, 'Nid-de-poule', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', u_alex, '2026-03-12T09:30:00Z', 'guichet')
  returning id into req1;

  select count(*) into v_int from public.request_stats where request_id = req1;
  if v_int <> 1 then v_fail := v_fail || 'S1a: aucune ligne de faits au depot'::text; end if;
  select s.source, s.current_status, s.socle_scope_org_id, s.received_at, s.instruction_started_at
    into v_text, v_json, v_uuid, v_ts, v_ts2
    from (select source, to_jsonb(current_status) as current_status, socle_scope_org_id, received_at, instruction_started_at
            from public.request_stats where request_id = req1) s;
  if v_text is distinct from 'iris' then v_fail := v_fail || format('S1b: source %s', v_text); end if;
  if v_json #>> '{}' is distinct from 'a_traiter' then v_fail := v_fail || format('S1c: statut %s', v_json); end if;
  if v_uuid is distinct from s_voirie then v_fail := v_fail || 'S1d: organisme porteur non repris'::text; end if;
  if v_ts is distinct from '2026-03-12T09:30:00Z'::timestamptz then v_fail := v_fail || 'S1e: received_at non repris'::text; end if;
  if v_ts2 is not null then v_fail := v_fail || 'S1f: instruction_started_at pose au depot'::text; end if;
  select count(*) into v_int from public.request_stats where request_id = req1 and outcome is null and resolved_at is null;
  if v_int <> 1 then v_fail := v_fail || 'S1g: issue posee au depot'::text; end if;

  -- ==========================================================================
  -- S2. Prise en charge : première entrée en instruction
  -- ==========================================================================
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction' where id = req1;
  execute 'reset role';
  select instruction_started_at, current_status into v_ts, v_text from public.request_stats where request_id = req1;
  if v_ts is null then v_fail := v_fail || 'S2a: instruction_started_at absent apres prise en charge'::text; end if;
  if v_text is distinct from 'en_instruction' then v_fail := v_fail || format('S2b: statut courant %s', v_text); end if;

  -- ==========================================================================
  -- S3. Résolution : issue, date (= closed_at) et AUTEUR
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set status = 'resolue_positive' where id = req1;
  execute 'reset role';
  select s.resolved_at, s.outcome, s.resolved_by, r.closed_at
    into v_ts2, v_text, v_uuid, v_ts
    from public.request_stats s join public.requests r on r.id = s.request_id
   where s.request_id = req1;
  if v_ts2 is null or v_ts2 is distinct from v_ts then v_fail := v_fail || 'S3a: resolved_at ne suit pas closed_at'::text; end if;
  if v_text is distinct from 'resolue_positive' then v_fail := v_fail || format('S3b: issue %s', v_text); end if;
  if v_uuid is distinct from u_large then v_fail := v_fail || 'S3c: l''auteur de la resolution n''est pas retenu'::text; end if;

  -- ==========================================================================
  -- S4. Réouverture : issue et auteur effacés, première instruction conservée
  -- ==========================================================================
  select instruction_started_at into v_ts from public.request_stats where request_id = req1;
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction' where id = req1;
  execute 'reset role';
  select count(*) into v_int from public.request_stats
   where request_id = req1 and outcome is null and resolved_by is null and resolved_at is null;
  if v_int <> 1 then v_fail := v_fail || 'S4a: la reouverture n''efface pas la resolution'::text; end if;
  select instruction_started_at into v_ts2 from public.request_stats where request_id = req1;
  if v_ts2 is distinct from v_ts then v_fail := v_fail || 'S4b: la premiere entree en instruction a bouge'::text; end if;

  -- ==========================================================================
  -- S5. Nouvelle résolution, archivage (conservés), désarchivage (inchangés)
  -- ==========================================================================
  execute 'set local role authenticated';
  update public.requests set status = 'resolue_negative' where id = req1;
  update public.requests set status = 'archivee' where id = req1;
  execute 'reset role';
  select outcome, resolved_by, current_status into v_text, v_uuid, v_json
    from (select outcome, resolved_by, to_jsonb(current_status) as current_status
            from public.request_stats where request_id = req1) s;
  if v_text is distinct from 'resolue_negative' then v_fail := v_fail || format('S5a: issue %s apres archivage', v_text); end if;
  if v_uuid is distinct from u_large then v_fail := v_fail || 'S5b: auteur perdu a l''archivage'::text; end if;
  if v_json #>> '{}' is distinct from 'archivee' then v_fail := v_fail || 'S5c: statut courant non archive'::text; end if;

  execute 'set local role authenticated';
  update public.requests set status = 'resolue_negative' where id = req1;
  execute 'reset role';
  select outcome, resolved_by into v_text, v_uuid from public.request_stats where request_id = req1;
  if v_text is distinct from 'resolue_negative' or v_uuid is distinct from u_large then
    v_fail := v_fail || 'S5d: le desarchivage a modifie l''issue ou son auteur'::text; end if;
  execute 'set local role authenticated';
  update public.requests set status = 'archivee' where id = req1;
  execute 'reset role';

  -- ==========================================================================
  -- S6. Trigger et reconstruction produisent la même ligne
  -- ==========================================================================
  select to_jsonb(s) - 'updated_at' into v_json from public.request_stats s where s.request_id = req1;
  perform public.rebuild_request_stats(req1);
  select to_jsonb(s) - 'updated_at' into v_json2 from public.request_stats s where s.request_id = req1;
  if v_json is distinct from v_json2 then
    v_fail := v_fail || format('S6a: reconstruction divergente - %s vs %s', v_json, v_json2); end if;

  -- ==========================================================================
  -- S7. Visibilité par couple, transfert, autre tenant, admin plateforme
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values (orgA, 'A transferer', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', '2026-03-12T09:30:00Z')
  returning id into req2;

  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req2;
  execute 'reset role';
  if v_int <> 1 then v_fail := v_fail || 'S7a: l''instructeur du couple ne voit pas les faits'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req2;
  execute 'reset role';
  if v_int <> 0 then v_fail := v_fail || 'S7b: un service frere voit les faits d''un autre'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where organization_id = orgA;
  execute 'reset role';
  if v_int <> 0 then v_fail := v_fail || 'S7c: un autre tenant voit les faits'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req2;
  execute 'reset role';
  if v_int <> 1 then v_fail := v_fail || 'S7d: l''admin plateforme ne voit pas les faits'::text; end if;

  -- Transfert Voirie → CCAS par u_large : les faits changent de couple.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.transfer_request(req2, s_ccas);
  execute 'reset role';
  select socle_scope_org_id into v_uuid from public.request_stats where request_id = req2;
  if v_uuid is distinct from s_ccas then v_fail := v_fail || 'S7e: les faits n''ont pas suivi le transfert'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req2;
  execute 'reset role';
  if v_int <> 0 then v_fail := v_fail || 'S7f: l''ancien couple voit encore les faits'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req2;
  execute 'reset role';
  if v_int <> 1 then v_fail := v_fail || 'S7g: le couple d''arrivee ne voit pas les faits'::text; end if;

  -- ==========================================================================
  -- S8. Aucune écriture cliente
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.request_stats (request_id, organization_id, socle_root_org_id, socle_scope_org_id,
                                      source, received_at, created_at, current_status)
    values (gen_random_uuid(), orgA, s_root, s_voirie, 'iris', now(), now(), 'a_traiter');
    v_fail := v_fail || 'S8a: un client a pu inserer un fait'::text;
  exception when others then
    if position('row-level security' in lower(sqlerrm)) = 0 and position('permission denied' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('S8a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    update public.request_stats set outcome = 'resolue_positive' where request_id = req1;
    get diagnostics v_int = row_count;
    if v_int <> 0 then v_fail := v_fail || 'S8b: un client a pu modifier un fait'::text; end if;
  exception when others then
    if position('permission denied' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('S8b: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    delete from public.request_stats where request_id = req1;
    get diagnostics v_int = row_count;
    if v_int <> 0 then v_fail := v_fail || 'S8c: un client a pu supprimer un fait'::text; end if;
  exception when others then
    if position('permission denied' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('S8c: refus inattendu (%s)', sqlerrm); end if;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- S9. Les RPC rendent ce que le lecteur voit — et rien à anon
  -- ==========================================================================
  -- Alex (Voirie seule) : req1 seulement (req2 est partie au CCAS).
  execute 'set local role authenticated';
  select coalesce(sum(request_count), 0) into v_int from public.stats_requests_by_source(orgA, v_since, null);
  select count(*) into v_int2 from public.requests where organization_id = orgA;
  execute 'reset role';
  if v_int <> v_int2 or v_int <> 1 then
    v_fail := v_fail || format('S9a: par source %s demande(s), la liste en montre %s (attendu 1)', v_int, v_int2); end if;

  execute 'set local role authenticated';
  select negative_count, positive_count, open_count into v_int, v_int2, v_num from public.stats_outcomes(orgA, v_since, null);
  execute 'reset role';
  if v_int <> 1 or v_int2 <> 0 or v_num <> 0 then
    v_fail := v_fail || format('S9b: issues inattendues (neg %s, pos %s, ouvertes %s)', v_int, v_int2, v_num); end if;

  execute 'set local role authenticated';
  select user_id, user_name, request_count into v_uuid, v_text, v_int from public.stats_top_resolvers(orgA, v_since, null, 10);
  execute 'reset role';
  if v_uuid is distinct from u_large or v_text is distinct from 'Large Mairie' or v_int <> 1 then
    v_fail := v_fail || format('S9c: top instructeurs inattendu (%s, %s, %s)', v_uuid, v_text, v_int); end if;

  execute 'set local role authenticated';
  select count(*), coalesce(sum(request_count), 0) into v_int, v_int2 from public.stats_requests_by_month(orgA, 12, null);
  execute 'reset role';
  if v_int <> 12 then v_fail := v_fail || format('S9d: %s mois au lieu de 12', v_int); end if;
  if v_int2 <> 1 then v_fail := v_fail || format('S9e: %s demande(s) sur 12 mois au lieu de 1', v_int2); end if;

  execute 'set local role authenticated';
  select org_name, avg_days_to_instruction into v_text, v_num from public.stats_processing_times(orgA, v_since);
  execute 'reset role';
  if v_text is distinct from 'Voirie' then v_fail := v_fail || format('S9f: organisme %s au lieu de Voirie', v_text); end if;
  if v_num is null or v_num <= 0 then v_fail := v_fail || format('S9g: delai avant instruction %s', v_num); end if;
  execute 'set local role authenticated';
  select avg_days_to_resolution into v_num from public.stats_processing_times(orgA, v_since);
  select count(*) into v_int from public.stats_requests_by_organization(orgA, v_since);
  execute 'reset role';
  if v_num is null or v_num <= 0 then v_fail := v_fail || format('S9h: delai avant resolution %s', v_num); end if;
  if v_int <> 1 then v_fail := v_fail || format('S9i: %s organisme(s) au lieu de 1', v_int); end if;

  -- Le CCAS ne voit que req2, ouverte.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select open_count, negative_count into v_int, v_int2 from public.stats_outcomes(orgA, v_since, null);
  execute 'reset role';
  if v_int <> 1 or v_int2 <> 0 then
    v_fail := v_fail || format('S9j: le CCAS voit %s ouverte(s) et %s negative(s)', v_int, v_int2); end if;

  if has_function_privilege('anon', 'public.stats_outcomes(uuid, timestamptz, uuid)', 'execute') then
    v_fail := v_fail || 'S9k: stats_outcomes est executable par anon'::text; end if;
  if not has_function_privilege('authenticated', 'public.stats_top_intervenants(uuid, timestamptz, uuid, integer)', 'execute') then
    v_fail := v_fail || 'S9l: stats_top_intervenants n''est pas executable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.rebuild_request_stats(uuid)', 'execute') then
    v_fail := v_fail || 'S9m: rebuild_request_stats est executable par authenticated'::text; end if;

  -- ==========================================================================
  -- S10. Interventions : sollicitation puis réalisation
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, assigned_to, received_at)
  values (orgA, 'Avec intervention', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', u_alex, '2026-03-12T09:30:00Z')
  returning id into req3;
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction' where id = req3;
  perform public.request_intervention(req3, u_sam, v_today, 'Reboucher');
  execute 'reset role';
  select id into v_inter from public.request_interventions where request_id = req3;
  select count(*) into v_int from public.intervention_stats where intervention_id = v_inter and completed_at is null;
  if v_int <> 1 then v_fail := v_fail || 'S10a: la sollicitation n''a pas de faits'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.complete_request_intervention(v_inter, v_today, null);
  -- Un intervenant pur ne consulte pas de statistiques.
  select count(*) into v_int from public.request_stats where request_id = req3;
  select count(*) into v_int2 from public.intervention_stats where intervention_id = v_inter;
  execute 'reset role';
  if v_int <> 0 or v_int2 <> 0 then v_fail := v_fail || 'S10b: un intervenant pur lit des statistiques'::text; end if;
  select count(*) into v_int from public.intervention_stats where intervention_id = v_inter and completed_at is not null;
  if v_int <> 1 then v_fail := v_fail || 'S10c: la realisation n''est pas dans les faits'::text; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select requested_count, completed_count, avg_days_to_completion into v_int, v_int2, v_num
    from public.stats_interventions(orgA, v_since, null);
  select user_id, user_name into v_uuid, v_text from public.stats_top_intervenants(orgA, v_since, null, 10);
  execute 'reset role';
  if v_int <> 1 or v_int2 <> 1 then v_fail := v_fail || format('S10d: interventions %s demandee(s) / %s realisee(s)', v_int, v_int2); end if;
  if v_num is null or v_num < 0 then v_fail := v_fail || format('S10e: delai de realisation %s', v_num); end if;
  if v_uuid is distinct from u_sam or v_text is distinct from 'Sam Ouvrier' then
    v_fail := v_fail || format('S10f: top intervenants inattendu (%s, %s)', v_uuid, v_text); end if;

  -- ==========================================================================
  -- S11. SURVIE À LA PURGE : la demande disparaît, ses faits restent
  -- ==========================================================================
  -- Ce que la purge devra lever : l'immuabilité du journal ET celle de
  -- l'historique d'affectation (req3 est affectée, la cascade y bute aussi).
  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  execute 'alter table public.request_assignments disable trigger t01_request_assignments_immutable';
  delete from public.requests where id = req3;
  execute 'alter table public.request_assignments enable trigger t01_request_assignments_immutable';
  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  select count(*) into v_int from public.requests where id = req3;
  if v_int <> 0 then v_fail := v_fail || 'S11a: decor incoherent, la demande existe encore'::text; end if;
  select count(*) into v_int from public.request_interventions where id = v_inter;
  if v_int <> 0 then v_fail := v_fail || 'S11b: decor incoherent, l''intervention existe encore'::text; end if;

  select count(*) into v_int from public.request_stats where request_id = req3;
  select count(*) into v_int2 from public.intervention_stats where intervention_id = v_inter;
  if v_int <> 1 or v_int2 <> 1 then v_fail := v_fail || 'S11c: la purge a emporte les faits'::text; end if;

  execute 'set local role authenticated';
  select count(*) into v_int from public.request_stats where request_id = req3;
  select count(*) into v_int2 from public.intervention_stats where intervention_id = v_inter;
  select completed_count into v_num from public.stats_interventions(orgA, v_since, null);
  execute 'reset role';
  if v_int <> 1 or v_int2 <> 1 then v_fail := v_fail || 'S11d: les faits d''une demande purgee ne sont plus visibles par l''agent du couple'::text; end if;
  if v_num <> 1 then v_fail := v_fail || format('S11e: %s intervention(s) realisee(s) apres purge au lieu de 1', v_num); end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (statistiques) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
