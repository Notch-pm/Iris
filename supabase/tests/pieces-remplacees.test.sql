-- ============================================================================
-- Tests de l'ajout de pièce depuis la fiche, du remplacement, et de la trace
-- des réponses modifiées (migration 20260828110000).
--
-- Les quatre règles tenues ici :
--   1. « LA PLUS RÉCENTE FAIT FOI » (décision PO 2026-08-28) — la pièce ajoutée
--      remplace celles déjà actives de la même exigence. Elles restent au
--      dossier (rien ne se supprime) mais sortent du calcul de conformité :
--      sans cela, une pièce corrigée ne débloquerait jamais rien.
--   2. ATOMICITÉ — ajout, remplacement et journal en une transaction. C'est ce
--      qui justifie une RPC alors que la policy INSERT autorise déjà le client.
--   3. LE CHEMIN PORTE LE RLS — un `storage_path` hors de la demande est refusé
--      côté serveur, pas seulement côté écran.
--   4. UNE RÉPONSE CORRIGÉE LAISSE UNE TRACE — `form_data_updated`, avec les
--      CLÉS touchées et jamais les valeurs (données personnelles + journal
--      immuable : on n'y écrit pas ce qu'une purge devrait effacer).
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur, jamais `exception when others
-- then null`.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  proc     uuid := gen_random_uuid();
  orgA uuid; p_id uuid;
  req uuid; req_clos uuid;
  att_vieille uuid; att_autre uuid; att_libre uuid; att_mail uuid;
  mail uuid;
  u_instructeur uuid := gen_random_uuid();
  u_ccas        uuid := gen_random_uuid();
  snap jsonb := jsonb_build_object('id', proc::text, 'form_schema', '{
    "version": 1,
    "content": [
      {"id":"f-prenom","key":"prenom","label":"Prénom","type":"text"},
      {"id":"f-dom","key":"justificatif_domicile","label":"Justificatif de domicile",
       "type":"attachment","required":true,"maxFiles":3},
      {"id":"f-id","key":"piece_identite","label":"Pièce d''identité","type":"attachment"}
    ]}'::jsonb);
  v_fail text[] := '{}';
  v_int int;
  v_text text;
  v_uuid uuid;
  v_arr text[];
  v_jsonb jsonb;
  v_prefix text;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_instructeur, 'inst@o.test', now(), now()),
    (u_ccas,        'ccas@o.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie A') returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_instructeur, 'agent'), (orgA, u_ccas, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie'), (orgA, s_ccas, s_root, 'CCAS');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Acte de naissance');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process, right_close)
    values (p_id, proc, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_instructeur);

  -- Le CCAS : tout sur SA branche — mais la demande est à la Voirie.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur CCAS', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  insert into public.requests (organization_id, subject, status, socle_procedure_id, procedure_snapshot,
                               form_data, socle_organization_id, socle_organization_label)
  values (orgA, 'Acte de naissance', 'en_instruction', proc, snap,
          '{"prenom":"Camille"}'::jsonb, s_voirie, 'Voirie')
  returning id into req;

  insert into public.requests (organization_id, subject, status, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Close', 'en_instruction', proc, snap, s_voirie, 'Voirie')
  returning id into req_clos;
  update public.requests set status = 'annulee', closure_motif = 'abandon' where id = req_clos;

  v_prefix := orgA::text || '/' || req::text || '/';

  insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                          form_field_key, compliance, compliance_motif,
                                          compliance_by, compliance_at)
  values (orgA, req, v_prefix || 'a-flou.pdf', 'flou.pdf', 'justificatif_domicile',
          'non_conforme', 'illisible', u_instructeur, now())
  returning id into att_vieille;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                          form_field_key, compliance, compliance_by, compliance_at)
  values (orgA, req, v_prefix || 'b-page2.pdf', 'page2.pdf', 'justificatif_domicile',
          'conforme', u_instructeur, now())
  returning id into att_autre;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req, v_prefix || 'c-libre.pdf', 'annexe.pdf')
  returning id into att_libre;

  select public.start_request_email(req, u_instructeur, 'usager@exemple.fr', 'Objet', 'Corps') into mail;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                          form_field_key, email_id)
  values (orgA, req, v_prefix || 'd-reponse.pdf', 'reponse.pdf', 'justificatif_domicile', mail)
  returning id into att_mail;

  -- ==========================================================================
  -- P1. L'exigence bloque : une pièce non conforme parmi deux
  -- ==========================================================================
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', '{"prenom":"Camille"}'::jsonb);
  if v_arr is distinct from array['Justificatif de domicile'] then
    v_fail := v_fail || format('P1: attendu le justificatif bloquant, obtenu %s', v_arr); end if;

  -- ==========================================================================
  -- P2. Le geste nominal : « la plus récente fait foi »
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select public.attach_request_piece(
           req, v_prefix || 'e-net.pdf', 'net.pdf', 'application/pdf', 2048,
           'justificatif_domicile') into v_jsonb;
  v_uuid := (v_jsonb ->> 'attachment_id')::uuid;

  -- Les DEUX pièces actives de l'exigence sont remplacées — y compris celle qui
  -- était conforme : c'est la règle choisie, et l'écran l'annonce avant l'envoi.
  if (v_jsonb ->> 'remplacees')::int <> 2 then
    v_fail := v_fail || format('P2a: %s pièces remplacées au lieu de 2', v_jsonb ->> 'remplacees'); end if;
  select superseded_by into v_uuid from public.request_attachments where id = att_vieille;
  if v_uuid is distinct from (v_jsonb ->> 'attachment_id')::uuid then
    v_fail := v_fail || 'P2b: la pièce non conforme n''a pas été marquée remplacée'::text; end if;
  select count(*) into v_int from public.request_attachments
   where id in (att_vieille, att_autre) and superseded_at is null;
  if v_int <> 0 then
    v_fail := v_fail || 'P2b: superseded_at non posé sur une pièce remplacée'::text; end if;

  -- La pièce d'un ÉCHANGE SORTANT porte pourtant la même clé : elle n'est pas touchée.
  select superseded_by into v_uuid from public.request_attachments where id = att_mail;
  if v_uuid is not null then
    v_fail := v_fail || 'P2c: une pièce d''échange sortant a été remplacée'::text; end if;

  -- La pièce hors formulaire non plus.
  select superseded_by into v_uuid from public.request_attachments where id = att_libre;
  if v_uuid is not null then
    v_fail := v_fail || 'P2d: une pièce hors formulaire a été remplacée'::text; end if;

  -- ⚠️ `request_pieces_blocking` a son EXECUTE révoqué aux clients (c'est
  -- vérifié en Q6c de qualification-pieces.test.sql) : on repasse en contexte
  -- postgres pour l'interroger, comme le fait le trigger t17 en DEFINER.
  execute 'reset role';
  -- L'exigence est de nouveau « à qualifier » : la neuve n'a pas de verdict.
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', '{"prenom":"Camille"}'::jsonb);
  if v_arr is distinct from array['Justificatif de domicile'] then
    v_fail := v_fail || format('P2e: attendu à qualifier, obtenu %s', v_arr); end if;

  -- Qualifiée conforme, elle débloque — ce que l'ancienne, non conforme,
  -- empêchait : c'est TOUT l'intérêt du remplacement.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.qualify_request_attachment((v_jsonb ->> 'attachment_id')::uuid, 'conforme');

  execute 'reset role';
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', '{"prenom":"Camille"}'::jsonb);
  if array_length(v_arr, 1) is not null then
    v_fail := v_fail || format('P2f: une pièce remplacée bloque encore (%s)', v_arr); end if;

  -- ==========================================================================
  -- P3. Le journal
  -- ==========================================================================
  select payload ->> 'remplacees' into v_text from public.request_events
   where request_id = req and event_type = 'piece_ajoutee';
  if v_text is distinct from '2' then
    v_fail := v_fail || format('P3a: journal « piece_ajoutee » incomplet (%s)', v_text); end if;

  -- ==========================================================================
  -- P4. Pièce hors formulaire : le remplacement se désigne nommément
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.attach_request_piece(
           req, v_prefix || 'f-annexe2.pdf', 'annexe2.pdf', null, null, null, att_libre) into v_jsonb;
  if (v_jsonb ->> 'remplacees')::int <> 1 then
    v_fail := v_fail || 'P4a: le remplacement explicite hors formulaire n''a pas eu lieu'::text; end if;

  -- Sans cible ET sans clé, rien n'est remplacé : on n'invente pas de victime.
  select public.attach_request_piece(req, v_prefix || 'g-seule.pdf', 'seule.pdf') into v_jsonb;
  if (v_jsonb ->> 'remplacees')::int <> 0 then
    v_fail := v_fail || 'P4b: un ajout sans clé ni cible a remplacé quelque chose'::text; end if;

  -- ==========================================================================
  -- P5. Les gardes de la RPC
  -- ==========================================================================
  begin
    perform public.attach_request_piece(req, orgA::text || '/' || req_clos::text || '/x.pdf', 'x.pdf');
    v_fail := v_fail || 'P5a: chemin hors de la demande accepté'::text;
  exception when others then
    if position('hors de la demande' in sqlerrm) = 0 then
      v_fail := v_fail || format('P5a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.attach_request_piece(req, v_prefix || 'h.pdf', '   ');
    v_fail := v_fail || 'P5b: nom de fichier vide accepté'::text;
  exception when others then
    if position('nom du fichier est obligatoire' in sqlerrm) = 0 then
      v_fail := v_fail || format('P5b: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.attach_request_piece(
      req_clos, orgA::text || '/' || req_clos::text || '/i.pdf', 'i.pdf');
    v_fail := v_fail || 'P5c: pièce ajoutée à une demande close'::text;
  exception when others then
    if position('demande est close' in sqlerrm) = 0 then
      v_fail := v_fail || format('P5c: refus inattendu (%s)', sqlerrm); end if;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.attach_request_piece(req, v_prefix || 'j.pdf', 'j.pdf');
    v_fail := v_fail || 'P5d: FUITE intra-tenant — le CCAS a déposé sur une demande de la Voirie'::text;
  exception when others then
    if position('droit d''instruction' in sqlerrm) = 0 then
      v_fail := v_fail || format('P5d: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- P6. Les réponses modifiées laissent une trace — les CLÉS, pas les valeurs
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.requests
     set form_data = '{"prenom":"Camille Rose","date_naissance":"2015-07-26"}'::jsonb
   where id = req;

  select payload into v_jsonb from public.request_events
   where request_id = req and event_type = 'form_data_updated';
  if v_jsonb is null then
    v_fail := v_fail || 'P6a: aucune trace de la modification des réponses'::text;
  else
    if (v_jsonb ->> 'count')::int <> 2 then
      v_fail := v_fail || format('P6b: %s réponses modifiées au lieu de 2', v_jsonb ->> 'count'); end if;
    if not (v_jsonb -> 'keys' @> '["prenom","date_naissance"]'::jsonb) then
      v_fail := v_fail || format('P6c: clés attendues absentes (%s)', v_jsonb -> 'keys'); end if;
    if v_jsonb::text like '%Camille Rose%' then
      v_fail := v_fail || 'P6d: le journal cite la VALEUR d''une réponse'::text; end if;
  end if;

  -- Une écriture sans changement ne journalise rien.
  update public.requests
     set form_data = '{"prenom":"Camille Rose","date_naissance":"2015-07-26"}'::jsonb
   where id = req;
  select count(*) into v_int from public.request_events
   where request_id = req and event_type = 'form_data_updated';
  if v_int <> 1 then
    v_fail := v_fail || format('P6e: %s traces au lieu de 1 (écriture sans changement)', v_int); end if;

  -- Sans droit d'instruction, la garde existante refuse — rien de neuf, mais
  -- c'est ce qui rend l'UPDATE direct acceptable pour ce geste.
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set form_data = '{"prenom":"Piraté"}'::jsonb where id = req;
  get diagnostics v_int = row_count;
  if v_int <> 0 then
    v_fail := v_fail || 'P6f: le CCAS a modifié les réponses d''une demande de la Voirie'::text; end if;

  -- ==========================================================================
  -- P7. Cohérence de la colonne
  -- ==========================================================================
  -- ⚠️ Sur une ligne DÉJÀ remplacée, poser `superseded_by` seul ne violerait
  -- rien : `superseded_at` y est déjà. On vise donc une pièce intacte —
  -- att_mail, que rien ne remplace jamais (pièce d'échange sortant).
  execute 'reset role';
  begin
    update public.request_attachments set superseded_by = att_libre where id = att_mail;
    v_fail := v_fail || 'P7a: superseded_by sans superseded_at accepté'::text;
  exception when check_violation then null;
  when others then
    v_fail := v_fail || format('P7a: refus inattendu (%s)', sqlerrm); end;
  begin
    update public.request_attachments
       set superseded_by = att_mail, superseded_at = now() where id = att_mail;
    v_fail := v_fail || 'P7b: une pièce a pu se remplacer elle-même'::text;
  exception when check_violation then null;
  when others then
    v_fail := v_fail || format('P7b: refus inattendu (%s)', sqlerrm); end;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (pièces remplacées et réponses) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
