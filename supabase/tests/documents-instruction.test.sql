-- ============================================================================
-- Tests des DOCUMENTS D'INSTRUCTION et des courriers (migration 20260901140000).
--
-- L'INVARIANT DU LOT, et la seule raison d'être de ce fichier :
--   **un document `instruction_interne` ne peut JAMAIS partir chez l'usager.**
-- Il est gardé à trois niveaux, et le test les éprouve tous les trois :
--   1. le TRIGGER `t05_attachments_internal_never_sent` — dernier rempart, il
--      vaut même pour le `service_role` et même si l'edge function a un bug ;
--   2. la RPC `start_request_email`, qui refuse un document interne désigné
--      par identifiant, AVANT d'ouvrir l'échange ;
--   3. (côté serveur d'envoi) `request_attachment_paths`, qui rend la NATURE
--      pour que l'edge function refuse sans même écrire.
--
-- Le reste vérifie que joindre un document du dossier fait ce qu'il annonce :
-- une ligne de plus, le MÊME objet de stockage, la trace de l'original.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  orgA     uuid;
  proc     uuid := gen_random_uuid();
  snap     jsonb;
  u_agent  uuid := gen_random_uuid();  -- instruction sur la Voirie
  u_autre  uuid := gen_random_uuid();  -- membre SANS droit sur la Voirie
  p_id     uuid;
  req      uuid;
  req2     uuid;
  a_interne uuid;
  a_externe uuid;
  a_courrier uuid;
  v_email  uuid;
  v_fail   text[] := '{}';
  v_int    int;
  v_text   text;
  v_uuid   uuid;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@documents.test', now(), now()),
    (u_autre, 'autre@documents.test', now(), now());

  insert into public.organizations (socle_org_id, name)
    values (s_root, 'Mairie Documents') returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_agent, 'agent'), (orgA, u_autre, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement voirie');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_root);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values (orgA, 'Nid-de-poule rue des Lilas', proc, snap, s_voirie, 'Voirie',
          'Signalement voirie', '2026-03-12T09:30:00Z')
  returning id into req;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values (orgA, 'Autre demande', proc, snap, s_voirie, 'Voirie',
          'Signalement voirie', '2026-03-13T09:30:00Z')
  returning id into req2;

  insert into public.request_attachments
    (organization_id, request_id, storage_path, file_name, mime_type, file_size, kind,
     template_label, generated_at, generated_by)
  values
    (orgA, req, orgA || '/' || req || '/note-interne.pdf', 'note-interne.pdf',
     'application/pdf', 1000, 'instruction_interne', 'Note d''analyse', now(), u_agent)
  returning id into a_interne;

  insert into public.request_attachments
    (organization_id, request_id, storage_path, file_name, mime_type, file_size, kind)
  values (orgA, req, orgA || '/' || req || '/avis.pdf', 'avis.pdf', 'application/pdf', 2000,
          'instruction_externe')
  returning id into a_externe;

  insert into public.request_attachments
    (organization_id, request_id, storage_path, file_name, mime_type, file_size, kind,
     template_label)
  values (orgA, req, orgA || '/' || req || '/courrier.pdf', 'courrier.pdf', 'application/pdf', 3000,
          'courrier', 'Courrier usager.docx')
  returning id into a_courrier;

  -- ==========================================================================
  -- T1. La nature est un registre FERMÉ
  -- ==========================================================================
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name, kind)
    values (orgA, req, orgA || '/' || req || '/x.pdf', 'x.pdf', 'note_secrete');
    v_fail := v_fail || 'T1: une nature inconnue a été acceptée'::text;
  exception when check_violation then null;
  end;

  -- ==========================================================================
  -- T2. LE TRIGGER : un interne ne peut pas porter d'email_id
  -- ==========================================================================
  insert into public.request_emails (organization_id, request_id, sent_by, to_email, subject, body)
    values (orgA, req, u_agent, 'usager@exemple.fr', 'Objet', 'Corps')
    returning id into v_email;

  begin
    insert into public.request_attachments
      (organization_id, request_id, storage_path, file_name, kind, email_id)
    values (orgA, req, orgA || '/' || req || '/interne2.pdf', 'interne2.pdf',
            'instruction_interne', v_email);
    v_fail := v_fail || 'T2a: un document INTERNE a pu être joint à un échange (insert)'::text;
  exception when check_violation then null;
  end;

  -- Et par la bande : une pièce d'échange qu'on RENOMMERAIT interne.
  begin
    update public.request_attachments set kind = 'instruction_interne' where id = a_courrier;
    update public.request_attachments set email_id = v_email where id = a_courrier;
    v_fail := v_fail || 'T2b: un document devenu interne a gardé son rattachement à un échange'::text;
  exception when check_violation then null;
  end;
  update public.request_attachments set kind = 'courrier', email_id = null where id = a_courrier;

  -- Un EXTERNE, lui, passe.
  insert into public.request_attachments
    (organization_id, request_id, storage_path, file_name, kind, email_id)
  values (orgA, req, orgA || '/' || req || '/externe-envoye.pdf', 'externe-envoye.pdf',
          'instruction_externe', v_email);

  -- ==========================================================================
  -- T3. start_request_email : joindre un document DU DOSSIER
  -- ==========================================================================
  v_email := public.start_request_email(
    req, u_agent, 'usager@exemple.fr', 'Votre demande', 'Bonjour…', null, null,
    jsonb_build_array(jsonb_build_object('attachment_id', a_courrier::text))
  );

  select count(*) into v_int from public.request_attachments
   where email_id = v_email;
  if v_int <> 1 then
    v_fail := v_fail || format('T3a: %s pièce(s) rattachée(s) à l''échange au lieu d''une', v_int); end if;

  select storage_path into v_text from public.request_attachments where email_id = v_email;
  if v_text is distinct from (select storage_path from public.request_attachments where id = a_courrier) then
    v_fail := v_fail || 'T3b: la pièce envoyée ne pointe pas le MÊME objet de stockage'::text; end if;
  select source_attachment_id into v_uuid from public.request_attachments where email_id = v_email;
  if v_uuid is distinct from a_courrier then
    v_fail := v_fail || 'T3c: la pièce envoyée ne cite pas le document d''origine'::text; end if;
  select kind into v_text from public.request_attachments where email_id = v_email;
  if v_text is distinct from 'courrier' then
    v_fail := v_fail || format('T3d: la nature du document n''a pas suivi (%s)', v_text); end if;

  -- Le document d'origine reste au dossier, sans email_id : il est toujours
  -- listé dans « Courriers », et peut repartir dans un second message.
  select email_id into v_uuid from public.request_attachments where id = a_courrier;
  if v_uuid is not null then
    v_fail := v_fail || 'T3e: le document du dossier a été consommé par l''envoi'::text; end if;

  -- ==========================================================================
  -- T4. start_request_email REFUSE un interne, et un document d'une AUTRE demande
  -- ==========================================================================
  begin
    perform public.start_request_email(
      req, u_agent, 'usager@exemple.fr', 'Objet', 'Corps', null, null,
      jsonb_build_array(jsonb_build_object('attachment_id', a_interne::text))
    );
    v_fail := v_fail || 'T4a: la RPC a accepté de joindre un document INTERNE'::text;
  exception when check_violation then null;
  end;

  begin
    perform public.start_request_email(
      req2, u_agent, 'usager@exemple.fr', 'Objet', 'Corps', null, null,
      jsonb_build_array(jsonb_build_object('attachment_id', a_courrier::text))
    );
    v_fail := v_fail || 'T4b: un document d''une AUTRE demande a été joint'::text;
  exception when others then null;
  end;

  -- ==========================================================================
  -- T5. request_attachment_paths : SECURITY INVOKER, donc borné par le RLS
  -- ==========================================================================
  execute 'set local role authenticated';
  select count(*) into v_int
    from public.request_attachment_paths(req, array[a_interne, a_externe, a_courrier]);
  if v_int <> 3 then
    v_fail := v_fail || format('T5a: l''agent de la Voirie lit %s chemins au lieu de 3', v_int); end if;

  select nature into v_text
    from public.request_attachment_paths(req, array[a_interne]);
  if v_text is distinct from 'instruction_interne' then
    v_fail := v_fail || 'T5b: la NATURE n''est pas rendue — l''envoi ne pourrait pas refuser'::text; end if;

  -- Un document d'une autre demande n'est jamais rendu, même si son id est connu.
  select count(*) into v_int from public.request_attachment_paths(req2, array[a_courrier]);
  if v_int <> 0 then
    v_fail := v_fail || 'T5c: un document a été rendu pour une demande à laquelle il n''appartient pas'::text; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int
    from public.request_attachment_paths(req, array[a_interne, a_externe, a_courrier]);
  if v_int <> 0 then
    v_fail := v_fail || format('T5d: un membre SANS droit lit %s chemins', v_int); end if;
  execute 'reset role';

  -- ==========================================================================
  -- T6. Les pièces de l'usager ne sont pas devenues des documents
  -- ==========================================================================
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
    values (orgA, req, orgA || '/' || req || '/piece-usager.pdf', 'piece-usager.pdf');
  select kind into v_text from public.request_attachments where file_name = 'piece-usager.pdf';
  if v_text is distinct from 'demande' then
    v_fail := v_fail || format('T6: la nature par défaut est %s au lieu de « demande »', v_text); end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (documents d''instruction) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
