-- ============================================================================
-- Tests du COURRIER DE RÉPONSE VALIDÉ DANS CLARA (migration 20261112150000).
--
--   C1. Le circuit ne s'applique que si la démarche l'active ET que la source
--       clara du tenant est active (request_reply_via_clara).
--   C2. Démarche concernée : la résolution directe par un client est refusée
--       (UPDATE direct ET résolution groupée, qui l'écarte en disant pourquoi).
--   C3. reserve : droit de clôture, contact Socle, pièces conformes (issue
--       positive), statut ; rejeu de la même soumission sans effet.
--   C4. release libère une réservation ; confirm pose « en validation », le lien
--       externe et l'événement ; rejeu sans effet.
--   C5. Pendant la validation : aucun changement de statut, de clôture, ni
--       transfert ; aucune écriture cliente des colonnes du circuit.
--   C6. finalize : l'issue réservée est appliquée (texte, motif, closed_at),
--       statistiques imputées à l'agent qui a rédigé ; rejeu = 'already' ;
--       mauvais courrier ou autre tenant refusés.
--   C7. cancel : retour à l'instruction simple ; rejeu = 'already'.
--   C8. Privilèges : les portes de service ne sont pas exécutables par
--       anon/authenticated.
--
-- Exécution : bloc DO, contexte postgres — le `raise exception` final annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  org1 uuid;
  org2 uuid;
  proc_c  uuid := gen_random_uuid();  -- circuit Clara
  proc_n  uuid := gen_random_uuid();  -- circuit normal
  snap_c  jsonb;
  snap_n  jsonb;
  snap_pj jsonb;
  u_agent uuid := gen_random_uuid();
  u_lect  uuid := gen_random_uuid();  -- instruction sans clôture
  p_id uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  sub1 uuid := gen_random_uuid();
  sub2 uuid := gen_random_uuid();
  cour1 uuid := gen_random_uuid();
  cour2 uuid := gen_random_uuid();
  v_fail text[] := '{}';
  res    record;
  v_status text;
  v_text   text;
  v_uuid   uuid;
  v_int    int;
  v_bool   boolean;
  v_ts     timestamptz;
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@clara.test', now(), now()), (u_lect, 'lect@clara.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Clara') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (gen_random_uuid(), 'Autre tenant') returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_agent, 'agent'), (org1, u_lect, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'), (org1, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name, reply_via_clara) values
    (proc_c, org1, s_root, 'Permis de voirie', true), (proc_n, org1, s_root, 'Signalement', false);
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (org1, proc_c, s_voirie), (org1, proc_c, s_ccas), (org1, proc_n, s_voirie);
  snap_c  := jsonb_build_object('id', proc_c::text, 'name', 'Permis de voirie');
  snap_n  := jsonb_build_object('id', proc_n::text, 'name', 'Signalement');
  snap_pj := jsonb_build_object('id', proc_c::text, 'name', 'Permis de voirie', 'form_schema',
    '{"version":1,"content":[{"id":"f-plan","key":"plan","label":"Plan","type":"attachment","required":true}]}'::jsonb);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Agent', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_c, true, true, true, true), (p_id, proc_n, true, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_agent);
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Lecteur', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values (p_id, proc_c, true, true, true, false);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_id, u_lect);

  -- r1 : circuit Clara, contact Socle ; r2 : circuit normal ; r3 : circuit Clara
  -- sans contact ; r4 : circuit Clara, pièce obligatoire absente ; r5 : circuit
  -- Clara (résolution groupée) ; r6 : circuit Clara (annulation).
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, socle_contact_id)
    values (org1, 'Clara', proc_c, snap_c, s_voirie, gen_random_uuid()) returning id into r1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, socle_contact_id)
    values (org1, 'Normal', proc_n, snap_n, s_voirie, gen_random_uuid()) returning id into r2;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
    values (org1, 'Sans contact', proc_c, snap_c, s_voirie) returning id into r3;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, socle_contact_id)
    values (org1, 'Piece', proc_c, snap_pj, s_voirie, gen_random_uuid()) returning id into r4;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, socle_contact_id)
    values (org1, 'Groupe', proc_c, snap_c, s_voirie, gen_random_uuid()) returning id into r5;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id, socle_contact_id)
    values (org1, 'Annulation', proc_c, snap_c, s_voirie, gen_random_uuid()) returning id into r6;
  update public.requests set assigned_to = u_agent, status = 'en_instruction' where id in (r1, r2, r3, r4, r5, r6);

  -- ==========================================================================
  -- C1. Sans source clara active, le circuit ne s'applique pas.
  -- ==========================================================================
  if public.request_reply_via_clara(r1) then
    v_fail := v_fail || 'C1a: circuit actif sans source clara'::text; end if;
  insert into public.integration_sources (organization_id, code, name, status)
    values (org1, 'clara', 'Clara', 'active');
  if not public.request_reply_via_clara(r1) then
    v_fail := v_fail || 'C1b: circuit inactif avec source clara et reglage'::text; end if;
  if public.request_reply_via_clara(r2) then
    v_fail := v_fail || 'C1c: circuit actif sur une demarche qui ne le demande pas'::text; end if;

  -- ==========================================================================
  -- C2. Résolution directe refusée au client ; circuit normal intact.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.requests set status = 'resolue_positive' where id = r1;
    v_fail := v_fail || 'C2a: resolution directe acceptee sur demarche Clara'::text;
  exception when others then
    if sqlerrm not like '%préparez le courrier de réponse%' then v_fail := v_fail || format('C2a: %s', sqlerrm); end if;
  end;
  select * into res from public.resolve_one_request(r5, 'resolue_negative', null, null);
  if res.ok or res.error not like '%préparez le courrier de réponse%' then
    v_fail := v_fail || format('C2b: resolution groupee %s', row_to_json(res)); end if;
  update public.requests set status = 'resolue_positive' where id = r2;
  begin
    update public.requests set reply_validation_state = 'en_validation' where id = r1;
    v_fail := v_fail || 'C2c: ecriture cliente du sous-etat acceptee'::text;
  exception when others then
    if sqlerrm not like '%que par le serveur%' then v_fail := v_fail || format('C2c: %s', sqlerrm); end if;
  end;
  reset role;
  select status into v_status from public.requests where id = r2;
  if v_status <> 'resolue_positive' then v_fail := v_fail || 'C2d: circuit normal bloque'::text; end if;
  select status into v_status from public.requests where id = r5;
  if v_status <> 'en_instruction' then v_fail := v_fail || format('C2e: r5 = %s', v_status); end if;

  -- ==========================================================================
  -- C3. reserve
  -- ==========================================================================
  begin
    perform public.reserve_clara_reply(u_lect, r1, sub1, 'resolue_positive', null, null);
    v_fail := v_fail || 'C3a: reserve sans droit de cloture acceptee'::text;
  exception when others then
    if sqlerrm not like '%droit de clôture%' then v_fail := v_fail || format('C3a: %s', sqlerrm); end if;
  end;
  begin
    perform public.reserve_clara_reply(u_agent, r3, gen_random_uuid(), 'resolue_negative', null, null);
    v_fail := v_fail || 'C3b: reserve sans contact Socle acceptee'::text;
  exception when others then
    if sqlerrm not like '%aucune fiche du Socle%' then v_fail := v_fail || format('C3b: %s', sqlerrm); end if;
  end;
  begin
    perform public.reserve_clara_reply(u_agent, r4, gen_random_uuid(), 'resolue_positive', null, null);
    v_fail := v_fail || 'C3c: reserve positive avec piece manquante acceptee'::text;
  exception when others then
    if sqlerrm not like '%pièce(s) obligatoire(s)%' then v_fail := v_fail || format('C3c: %s', sqlerrm); end if;
  end;
  begin
    perform public.reserve_clara_reply(u_agent, r2, gen_random_uuid(), 'resolue_positive', null, null);
    v_fail := v_fail || 'C3d: reserve sur demande close acceptee'::text;
  exception when others then
    if sqlerrm not like '%en instruction%' then v_fail := v_fail || format('C3d: %s', sqlerrm); end if;
  end;
  perform public.reserve_clara_reply(u_agent, r1, sub1, 'resolue_positive', 'conforme', '  Accordé.  ');
  perform public.reserve_clara_reply(u_agent, r1, sub1, 'resolue_positive', 'conforme', 'Accordé.');  -- rejeu
  select reply_validation_state, reply_pending_closure_text into v_status, v_text from public.requests where id = r1;
  if v_status <> 'depot_en_cours' or v_text <> 'Accordé.' then
    v_fail := v_fail || format('C3e: %s / %s', v_status, v_text); end if;
  begin
    perform public.reserve_clara_reply(u_agent, r1, gen_random_uuid(), 'resolue_negative', null, null);
    v_fail := v_fail || 'C3f: seconde reservation acceptee'::text;
  exception when others then
    if sqlerrm not like '%déjà en validation%' then v_fail := v_fail || format('C3f: %s', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- C4. release / confirm
  -- ==========================================================================
  perform public.release_clara_reply(r1, gen_random_uuid());  -- mauvaise soumission : sans effet
  select reply_validation_state into v_status from public.requests where id = r1;
  if v_status is distinct from 'depot_en_cours' then v_fail := v_fail || 'C4a: release d''une autre soumission'::text; end if;
  perform public.release_clara_reply(r1, sub1);
  select reply_validation_state into v_status from public.requests where id = r1;
  if v_status is not null then v_fail := v_fail || 'C4b: release sans effet'::text; end if;

  perform public.reserve_clara_reply(u_agent, r1, sub2, 'resolue_positive', null, 'Accordé.');
  perform public.confirm_clara_reply(r1, sub2, cour1, '2026-S-00042', 'https://clara.example.fr/courriers/x');
  perform public.confirm_clara_reply(r1, sub2, cour1, '2026-S-00042', 'https://clara.example.fr/courriers/x');  -- rejeu
  select reply_validation_state, clara_courier_reference into v_status, v_text from public.requests where id = r1;
  if v_status <> 'en_validation' or v_text <> '2026-S-00042' then
    v_fail := v_fail || format('C4c: %s / %s', v_status, v_text); end if;
  select count(*) into v_int from public.request_links
   where request_id = r1 and link_type = 'externe' and external_type = 'clara_courier' and external_id = cour1::text;
  if v_int <> 1 then v_fail := v_fail || format('C4d: %s liens externes', v_int); end if;
  select count(*) into v_int from public.request_events where request_id = r1 and event_type = 'clara_reply_submitted';
  if v_int <> 1 then v_fail := v_fail || format('C4e: %s evenements de depot', v_int); end if;

  -- ==========================================================================
  -- C5. Pendant la validation
  -- ==========================================================================
  set local role authenticated;
  begin
    update public.requests set status = 'en_attente' where id = r1;
    v_fail := v_fail || 'C5a: changement de statut pendant la validation'::text;
  exception when others then
    if sqlerrm not like '%Réponse en validation%' then v_fail := v_fail || format('C5a: %s', sqlerrm); end if;
  end;
  begin
    update public.requests set closure_text = 'autre' where id = r1;
    v_fail := v_fail || 'C5b: texte de cloture modifie pendant la validation'::text;
  exception when others then
    if sqlerrm not like '%Réponse en validation%' then v_fail := v_fail || format('C5b: %s', sqlerrm); end if;
  end;
  update public.requests set priority = priority where id = r1;  -- le reste du dossier vit
  reset role;
  begin
    update public.requests set socle_organization_id = s_ccas where id = r1;  -- même en service
    v_fail := v_fail || 'C5c: transfert pendant la validation'::text;
  exception when others then
    if sqlerrm not like '%ni transférée%' then v_fail := v_fail || format('C5c: %s', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- C6. finalize
  -- ==========================================================================
  begin
    perform public.finalize_clara_reply(org1, r1, cour2, now());
    v_fail := v_fail || 'C6a: finalisation par un autre courrier'::text;
  exception when others then
    if sqlerrm not like '%pas le courrier de réponse%' then v_fail := v_fail || format('C6a: %s', sqlerrm); end if;
  end;
  begin
    perform public.finalize_clara_reply(org2, r1, cour1, now());
    v_fail := v_fail || 'C6b: finalisation depuis un autre tenant'::text;
  exception when others then
    if sqlerrm not like '%introuvable%' then v_fail := v_fail || format('C6b: %s', sqlerrm); end if;
  end;
  v_ts := now() - interval '1 hour';
  if public.finalize_clara_reply(org1, r1, cour1, v_ts) <> 'finalized' then
    v_fail := v_fail || 'C6c: finalisation non rendue'::text; end if;
  select status, closure_text into v_status, v_text from public.requests where id = r1;
  if v_status <> 'resolue_positive' or v_text <> 'Accordé.' then
    v_fail := v_fail || format('C6d: %s / %s', v_status, v_text); end if;
  select closed_at into v_ts from public.requests where id = r1;
  if v_ts > now() - interval '59 minutes' then v_fail := v_fail || format('C6e: closed_at = %s', v_ts); end if;
  select resolved_by into v_uuid from public.request_stats where request_id = r1;
  if v_uuid is distinct from u_agent then v_fail := v_fail || format('C6f: resolved_by = %s', v_uuid); end if;
  if public.finalize_clara_reply(org1, r1, cour1, now()) <> 'already' then
    v_fail := v_fail || 'C6g: rejeu de finalisation non idempotent'::text; end if;
  select count(*) into v_int from public.request_events where request_id = r1 and event_type = 'clara_reply_sent';
  if v_int <> 1 then v_fail := v_fail || format('C6h: %s evenements d''envoi', v_int); end if;

  -- ==========================================================================
  -- C7. cancel
  -- ==========================================================================
  perform public.reserve_clara_reply(u_agent, r6, gen_random_uuid(), 'resolue_negative', null, null);
  select reply_submission_id into v_uuid from public.requests where id = r6;
  perform public.confirm_clara_reply(r6, v_uuid, cour2, '2026-S-00043', null);
  if public.cancel_clara_reply(org1, r6, cour2) <> 'cancelled' then
    v_fail := v_fail || 'C7a: annulation non rendue'::text; end if;
  select status, reply_validation_state, clara_courier_id into v_status, v_text, v_uuid from public.requests where id = r6;
  if v_status <> 'en_instruction' or v_text is not null or v_uuid is not null then
    v_fail := v_fail || format('C7b: %s / %s / %s', v_status, v_text, v_uuid); end if;
  if public.cancel_clara_reply(org1, r6, cour2) <> 'already' then
    v_fail := v_fail || 'C7c: rejeu d''annulation non idempotent'::text; end if;

  -- ==========================================================================
  -- C8. Privilèges
  -- ==========================================================================
  select bool_or(has_function_privilege(rl, fn, 'execute')) into v_bool
    from unnest(array['anon', 'authenticated']) rl,
         unnest(array['public.reserve_clara_reply(uuid, uuid, uuid, text, text, text)',
                      'public.release_clara_reply(uuid, uuid)',
                      'public.confirm_clara_reply(uuid, uuid, uuid, text, text)',
                      'public.finalize_clara_reply(uuid, uuid, uuid, timestamp with time zone)',
                      'public.cancel_clara_reply(uuid, uuid, uuid)',
                      'public.requests_guard_clara_reply()']) fn;
  if v_bool then v_fail := v_fail || 'C8a: une porte de service est executable par un client'::text; end if;
  if has_function_privilege('anon', 'public.request_reply_via_clara(uuid)', 'execute') then
    v_fail := v_fail || 'C8b: request_reply_via_clara executable par anon'::text; end if;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (reponse validation clara) - transaction annulee';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' || ');
  end if;
end;
$main$;
