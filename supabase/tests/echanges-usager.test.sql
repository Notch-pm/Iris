-- ============================================================================
-- Tests des échanges sortants vers l'usager (`request_emails`).
--
-- Les deux règles tenues ici :
--   1. LA LECTURE SUIT LA DEMANDE — qui consulte le dossier voit les échanges.
--      Un échange avec l'usager n'est pas une note interne.
--   2. L'ÉCRITURE N'A QU'UNE PORTE — l'edge function, en service_role. Aucun
--      INSERT, UPDATE ni DELETE client, PAS MÊME par l'expéditeur : le corps
--      enregistré doit être celui qui est réellement parti, et un e-mail parti
--      ne se dé-envoie pas.
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur, jamais `exception when others
-- then null` : c'est la leçon de modeles-email.test.sql, où un
-- `permission denied` passait pour un refus légitime et rendait le test vert
-- alors que le client réel échouait.
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
  s_root2  uuid := gen_random_uuid();
  proc     uuid := gen_random_uuid();
  proc2    uuid := gen_random_uuid();
  orgA uuid; orgB uuid; p_id uuid;
  req  uuid; req_b uuid;
  mail uuid; mail_b uuid;
  up_plan uuid;
  u_instructeur uuid := gen_random_uuid();  -- instruction sur (Voirie, proc)
  u_consultant  uuid := gen_random_uuid();  -- consultation SEULE
  u_ccas        uuid := gen_random_uuid();  -- même tenant, AUTRE sous-arbre
  u_autre       uuid := gen_random_uuid();  -- autre tenant
  v_fail text[] := '{}';
  v_int int;
  v_text text;
  v_ts timestamptz;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_instructeur, 'inst@o.test', now(), now()),
    (u_consultant,  'cons@o.test', now(), now()),
    (u_ccas,        'ccas@o.test', now(), now()),
    (u_autre,       'autre@o.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie A') returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Mairie B') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_instructeur, 'agent'), (orgA, u_consultant, 'agent'), (orgA, u_ccas, 'agent'),
    (orgB, u_autre, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie'), (orgA, s_ccas, s_root, 'CCAS'),
    (orgB, s_root2, null, 'Mairie B');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc, orgA, s_root, 'Signalement de voirie'),
    (proc2, orgB, s_root2, 'Démarche B');
  -- t18 (2026-08-31) : une démarche doit être ACTIVÉE pour l'organisme porteur.
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id) values
    (orgA, proc, s_voirie), (orgB, proc2, s_root2);

  -- Instructeur : Voirie, droit d'instruction sur la démarche.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_instructeur);

  -- Consultant : Voirie, consultation SEULE.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Consultant voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_consultant);

  -- CCAS : tout sur SA branche — mais la demande est à la Voirie.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur CCAS', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  -- Autre tenant : tout sur SA racine.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgB, 'Instructeur B', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root2);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_autre);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Nid-de-poule', proc, jsonb_build_object('id', proc::text), s_voirie, 'Voirie')
  returning id into req;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgB, 'Demande B', proc2, jsonb_build_object('id', proc2::text), s_root2, 'Mairie B')
  returning id into req_b;

  -- ==========================================================================
  -- E1. La RPC de service ouvre l'échange ET ses pièces, en une transaction
  -- ==========================================================================
  -- La pièce jointe a été REÇUE par le serveur pour cette demande (zone
  -- d'attente) : la RPC ne connaît que son upload_id.
  insert into public.attachment_uploads (organization_id, scope_request_id, uploaded_by, storage_path,
    file_name, mime_type, file_size, checksum, expires_at)
  values (orgA, req, u_instructeur, orgA::text || '/' || req::text || '/abc-plan.pdf',
          'plan.pdf', 'application/pdf', 1024, 'plan', now() + interval '1 day')
  returning id into up_plan;
  select public.start_request_email(
           req, u_instructeur, '  marie@exemple.fr  ', 'Votre demande', 'Bonjour,',
           null, '  ',
           jsonb_build_array(jsonb_build_object('upload_id', up_plan))
         ) into mail;

  select to_email into v_text from public.request_emails where id = mail;
  if v_text is distinct from 'marie@exemple.fr' then
    v_fail := v_fail || format('E1a: adresse non normalisée (%s)', v_text); end if;
  select status into v_text from public.request_emails where id = mail;
  if v_text is distinct from 'en_cours' then
    v_fail := v_fail || format('E1b: statut initial %s au lieu de en_cours', v_text); end if;
  select template_name into v_text from public.request_emails where id = mail;
  if v_text is not null then
    v_fail := v_fail || 'E1c: un nom de modèle vide devrait rester NULL'::text; end if;
  select count(*) into v_int from public.request_attachments where email_id = mail;
  if v_int <> 1 then
    v_fail := v_fail || format('E1d: %s pièce rattachée au lieu de 1', v_int); end if;
  select organization_id::text into v_text from public.request_attachments where email_id = mail;
  if v_text is distinct from orgA::text then
    v_fail := v_fail || 'E1e: la pièce n''hérite pas du tenant de la demande'::text; end if;

  -- ==========================================================================
  -- E2. settle : « envoye » pose sent_at ; « echec » garde le motif, tronqué
  -- ==========================================================================
  perform public.settle_request_email(mail, true);
  select status, sent_at into v_text, v_ts from public.request_emails where id = mail;
  if v_text is distinct from 'envoye' then v_fail := v_fail || 'E2a: statut non « envoye »'::text; end if;
  if v_ts is null then v_fail := v_fail || 'E2b: sent_at non posé à l''envoi'::text; end if;

  select public.start_request_email(req, u_instructeur, 'x@y.fr', 'Objet', 'Corps') into mail_b;
  perform public.settle_request_email(mail_b, false, repeat('e', 900));
  select status, length(error), sent_at into v_text, v_int, v_ts
    from public.request_emails where id = mail_b;
  if v_text is distinct from 'echec' then v_fail := v_fail || 'E2c: statut non « echec »'::text; end if;
  if v_int <> 500 then
    v_fail := v_fail || format('E2d: motif d''échec de %s caractères au lieu de 500', v_int); end if;
  if v_ts is not null then v_fail := v_fail || 'E2e: sent_at posé alors que rien n''est parti'::text; end if;

  -- ==========================================================================
  -- E3. La lecture SUIT la demande — instructeur ET simple consultant
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 2 then
    v_fail := v_fail || format('E3a: l''instructeur voit %s échanges au lieu de 2', v_int); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_consultant, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 2 then
    v_fail := v_fail || format('E3b: le consultant voit %s échanges au lieu de 2', v_int); end if;

  -- ==========================================================================
  -- E4. Qui ne voit pas la demande ne voit pas les échanges
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 0 then
    v_fail := v_fail || format('E4a: FUITE intra-tenant — le CCAS voit %s échanges de la Voirie', v_int); end if;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_emails;
  if v_int <> 0 then
    v_fail := v_fail || format('E4b: FUITE cross-tenant — %s échanges d''un autre tenant visibles', v_int); end if;

  -- ==========================================================================
  -- E5. AUCUNE écriture cliente — pas même par l'expéditeur
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.request_emails (organization_id, request_id, sent_by, to_email, subject, body)
    values (orgA, req, u_instructeur, 'a@b.fr', 'Objet', 'Corps');
    v_fail := v_fail || 'E5a: un agent a pu INSÉRER un échange'::text;
  exception when others then
    -- Le refus doit venir du RLS, pas d'un droit manquant sur autre chose.
    if position('row-level security' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('E5a: refus inattendu à l''insertion (%s)', sqlerrm); end if;
  end;

  -- Sans policy UPDATE/DELETE, le RLS ne lève pas : il n'affecte AUCUNE ligne.
  update public.request_emails set body = 'réécrit' where id = mail;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E5b: un agent a pu MODIFIER un échange envoyé'::text; end if;

  delete from public.request_emails where id = mail;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E5c: un agent a pu SUPPRIMER un échange envoyé'::text; end if;

  -- ==========================================================================
  -- E6. Une pièce ne se rattache JAMAIS depuis le navigateur — pas même par
  --     l'instructeur (2026-09-08 : plus d'INSERT client, la porte est la RPC
  --     start_request_email en service_role, alimentée par la zone d'attente).
  -- ==========================================================================
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                            uploaded_by, email_id)
    values (orgA, req, orgA::text || '/' || req::text || '/def-note.pdf', 'note.pdf', u_instructeur, mail);
    v_fail := v_fail || 'E6a: l''instructeur a pu INSÉRER une pièce depuis le navigateur'::text;
  exception when others then
    if position('row-level security' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('E6a: refus inattendu (%s)', sqlerrm); end if;
  end;
  -- Le décor de E9 : la seconde pièce d'échange, posée par la porte légitime.
  execute 'reset role';
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                          uploaded_by, email_id)
  values (orgA, req, orgA::text || '/' || req::text || '/def-note.pdf', 'note.pdf', u_instructeur, mail);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_consultant, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                            uploaded_by, email_id)
    values (orgA, req, orgA::text || '/' || req::text || '/ghi.pdf', 'x.pdf', u_consultant, mail);
    v_fail := v_fail || 'E6b: un simple consultant a pu joindre une pièce'::text;
  exception when others then
    if position('row-level security' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('E6b: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- E7. Les RPC de service restent fermées aux clients
  -- ==========================================================================
  execute 'reset role';
  if has_function_privilege('authenticated',
       'public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)', 'execute') then
    v_fail := v_fail || 'E7a: start_request_email exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated',
       'public.settle_request_email(uuid,boolean,text)', 'execute') then
    v_fail := v_fail || 'E7b: settle_request_email exécutable par authenticated'::text; end if;
  if has_function_privilege('anon',
       'public.start_request_email(uuid,uuid,text,text,text,uuid,text,jsonb)', 'execute') then
    v_fail := v_fail || 'E7c: start_request_email exécutable par anon'::text; end if;
  -- La fonction edge en a besoin, elle : le grant service_role est la garde.
  if not has_function_privilege('service_role',
       'public.request_right_for(uuid,uuid,uuid,uuid,text)', 'execute') then
    v_fail := v_fail || 'E7d: request_right_for INEXÉCUTABLE par service_role'::text; end if;
  if has_function_privilege('authenticated',
       'public.request_right_for(uuid,uuid,uuid,uuid,text)', 'execute') then
    v_fail := v_fail || 'E7e: request_right_for exécutable par authenticated'::text; end if;

  -- ==========================================================================
  -- E8. Le moteur de droits dit bien ce que la fonction edge lui demandera
  -- ==========================================================================
  if not public.request_right_for(u_instructeur, orgA, s_voirie, proc, 'instruction') then
    v_fail := v_fail || 'E8a: l''instructeur n''a pas le droit d''instruction'::text; end if;
  if public.request_right_for(u_consultant, orgA, s_voirie, proc, 'instruction') then
    v_fail := v_fail || 'E8b: un consultant obtient le droit d''instruction'::text; end if;
  if public.request_right_for(u_ccas, orgA, s_voirie, proc, 'instruction') then
    v_fail := v_fail || 'E8c: l''instructeur CCAS instruit une demande de la Voirie'::text; end if;

  -- ==========================================================================
  -- E9. Supprimer la demande emporte échanges ET pièces
  --
  -- ⚠️ Constat de ce test : une demande n'est PAS supprimable telle quelle —
  -- la cascade atteint `request_events`, que `t01_request_events_immutable`
  -- interdit de supprimer. La future purge RGPD (procédure service_role
  -- dédiée, pas encore écrite) devra lever cette garde ; on la lève ici pour
  -- vérifier ce qui nous concerne : que les échanges suivent bien la demande.
  --
  -- La trace d'un envoi, elle, est protégée par l'ABSENCE de policy DELETE
  -- (E5c) — pas par une FK RESTRICT, qui ne protégeait rien.
  -- ==========================================================================
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 2 then v_fail := v_fail || 'E9a: décor incohérent avant la cascade'::text; end if;
  -- Borné à la demande du test : la base réelle porte ses propres pièces d'échange.
  select count(*) into v_int from public.request_attachments where request_id = req and email_id is not null;
  if v_int <> 2 then v_fail := v_fail || 'E9b: décor incohérent (pièces jointes) avant la cascade'::text; end if;

  begin
    delete from public.requests where id = req;
    v_fail := v_fail || 'E9c: une demande a pu être supprimée malgré son journal'::text;
  exception when others then
    if position('immuable' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('E9c: refus inattendu (%s)', sqlerrm); end if;
  end;

  execute 'alter table public.request_events disable trigger t01_request_events_immutable';
  delete from public.requests where id = req;
  execute 'alter table public.request_events enable trigger t01_request_events_immutable';
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 0 then v_fail := v_fail || 'E9d: échanges orphelins après suppression de la demande'::text; end if;
  select count(*) into v_int from public.request_attachments where request_id = req;
  if v_int <> 0 then v_fail := v_fail || 'E9e: pièces orphelines après suppression de la demande'::text; end if;

  -- ==========================================================================
  -- E10. La garde de périmètre : un échange sur une demande d'un AUTRE tenant
  -- ==========================================================================
  begin
    insert into public.request_emails (organization_id, request_id, sent_by, to_email, subject, body)
    values (orgA, req_b, u_instructeur, 'a@b.fr', 'Objet', 'Corps');
    v_fail := v_fail || 'E10: échange écrit sur une demande HORS tenant'::text;
  exception when others then
    if position('hors tenant' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('E10: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (échanges usager) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
