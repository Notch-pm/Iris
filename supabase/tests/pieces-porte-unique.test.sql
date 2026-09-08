-- ============================================================================
-- Tests de la PORTE UNIQUE des pièces (lot 2a — migration 20260911100000) :
-- les RPC métier consomment la zone d'attente et ne croient plus rien du client.
--
--   1. `create_request_from_procedure` v3 écrit les pièces DEPUIS la zone
--      d'attente (upload_id), et refuse une pièce d'un autre agent ou encore
--      en attente.
--   2. `start_request_email` v3 accepte { upload_id } et { attachment_id },
--      rien d'autre ; un interne ne sort toujours pas.
--   3. `request_attachment_paths` ne rend jamais un chemin hors de la demande
--      (elle est appelée en service_role : le préfixe est la garde).
--   4. `discard_attachment_uploads` ne retire que les lignes VIVANTES du
--      déposant.
-- (Les gardes d'`attach_request_piece` v2 sont dans pieces-remplacees.test.sql,
--  celles de `consume_attachment_upload` dans pieces-zone-attente.test.sql.)
--
-- Exécution : bloc DO en lecture-écriture, l'échec final VOLONTAIRE annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  orgA     uuid;
  proc     uuid := gen_random_uuid();
  snap     jsonb;
  u_agent  uuid := gen_random_uuid();
  u_autre  uuid := gen_random_uuid();
  p_id     uuid;
  req      uuid := gen_random_uuid();   -- créée par la RPC
  req2     uuid;
  up_a     uuid; up_b uuid; up_autre uuid; up_mail uuid; up_dead uuid;
  a_interne uuid; a_hors uuid;
  v_email  uuid;
  v_jsonb  jsonb;
  v_fail   text[] := '{}';
  v_int    int;
  v_text   text;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@porte.test', now(), now()),
    (u_autre, 'autre@porte.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Porte') returning id into orgA;
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
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process)
    values (p_id, proc, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent), (orgA, p_id, u_autre);

  -- Pièces reçues au guichet (portée organisation), déjà DÉPLACÉES sous la
  -- future demande par l'edge function (simulé), sauf up_dead, restée en attente.
  insert into public.attachment_uploads (organization_id, uploaded_by, storage_path, file_name, mime_type,
    file_size, checksum, expires_at) values
    (orgA, u_agent, orgA || '/' || req || '/a-cni.pdf', 'cni.pdf', 'application/pdf', 100, 'a', now() + interval '1 day'),
    (orgA, u_agent, orgA || '/' || req || '/b-photo.jpg', 'photo.jpg', 'image/jpeg', 200, 'b', now() + interval '1 day'),
    (orgA, u_autre, orgA || '/' || req || '/c-autre.pdf', 'autre.pdf', 'application/pdf', 300, 'c', now() + interval '1 day'),
    (orgA, u_agent, orgA || '/_staging/dead', 'dead.pdf', 'application/pdf', 400, 'd', now() + interval '1 day');
  select id into up_a     from public.attachment_uploads where checksum = 'a';
  select id into up_b     from public.attachment_uploads where checksum = 'b';
  select id into up_autre from public.attachment_uploads where checksum = 'c';
  select id into up_dead  from public.attachment_uploads where checksum = 'd';

  -- ==========================================================================
  -- C1. create_request_from_procedure v3 : les pièces naissent de la zone d'attente
  -- ==========================================================================
  v_jsonb := public.create_request_from_procedure(jsonb_build_object(
    'agent_id', u_agent, 'organization_id', orgA, 'request_id', req,
    'subject', 'Nid-de-poule', 'priority', 'normale', 'channel', 'guichet',
    'socle_organization_id', s_voirie, 'socle_organization_label', 'Voirie',
    'socle_procedure_id', proc, 'procedure_snapshot', snap,
    'requester_snapshot', jsonb_build_object('declared', jsonb_build_object('anonymous', true)),
    'identity_status', 'anonyme', 'form_data', '{}'::jsonb,
    'attachments', jsonb_build_array(
      jsonb_build_object('upload_id', up_a, 'form_field_key', 'piece_identite'),
      jsonb_build_object('upload_id', up_b, 'form_field_key', 'photo'))
  ));
  if (v_jsonb ->> 'id')::uuid is distinct from req then
    v_fail := v_fail || 'C1a: la demande n''a pas l''identifiant du brouillon'::text; end if;
  select count(*) into v_int from public.request_attachments where request_id = req;
  if v_int <> 2 then v_fail := v_fail || format('C1b: %s pièce(s) au lieu de 2', v_int); end if;
  select file_name || '|' || mime_type || '|' || file_size || '|' || coalesce(checksum, '') || '|' || kind
         || '|' || coalesce(form_field_key, '') || '|' || coalesce(uploaded_by::text, 'null') || '|' || copy_status
    into v_text from public.request_attachments where request_id = req and checksum = 'a';
  if v_text is distinct from 'cni.pdf|application/pdf|100|a|demande|piece_identite|' || u_agent || '|copied' then
    v_fail := v_fail || format('C1c: pièce écrite avec d''autres valeurs que la zone d''attente (%s)', v_text); end if;
  select count(*) into v_int from public.attachment_uploads
   where id in (up_a, up_b) and consumed_at is not null and request_attachment_id is not null;
  if v_int <> 2 then v_fail := v_fail || 'C1d: lignes d''attente non consommées / sans trace'::text; end if;
  select payload ->> 'attachments' into v_text from public.request_events
   where request_id = req and event_type = 'request_created_from_procedure';
  if v_text is distinct from '2' then v_fail := v_fail || format('C1e: journal incomplet (%s)', v_text); end if;

  -- ==========================================================================
  -- C2. La RPC de création REFUSE la pièce d'un autre agent, ou encore en attente
  --     — et n'écrit alors RIEN (une transaction).
  -- ==========================================================================
  req2 := gen_random_uuid();
  begin
    perform public.create_request_from_procedure(jsonb_build_object(
      'agent_id', u_agent, 'organization_id', orgA, 'request_id', req2,
      'subject', 'X', 'socle_organization_id', s_voirie, 'socle_organization_label', 'Voirie',
      'socle_procedure_id', proc, 'procedure_snapshot', snap,
      'requester_snapshot', jsonb_build_object('declared', jsonb_build_object('anonymous', true)),
      'identity_status', 'anonyme',
      'attachments', jsonb_build_array(jsonb_build_object('upload_id', up_autre, 'form_field_key', 'k'))));
    v_fail := v_fail || 'C2a: pièce d''un AUTRE agent acceptée à la création'::text;
  exception when others then
    if position('autre déposant' in sqlerrm) = 0 then
      v_fail := v_fail || format('C2a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.create_request_from_procedure(jsonb_build_object(
      'agent_id', u_agent, 'organization_id', orgA, 'request_id', req2,
      'subject', 'X', 'socle_organization_id', s_voirie, 'socle_organization_label', 'Voirie',
      'socle_procedure_id', proc, 'procedure_snapshot', snap,
      'requester_snapshot', jsonb_build_object('declared', jsonb_build_object('anonymous', true)),
      'identity_status', 'anonyme',
      'attachments', jsonb_build_array(jsonb_build_object('upload_id', up_dead, 'form_field_key', 'k'))));
    v_fail := v_fail || 'C2b: pièce encore en zone d''attente acceptée'::text;
  exception when others then
    if position('non déplacé' in sqlerrm) = 0 then
      v_fail := v_fail || format('C2b: refus inattendu (%s)', sqlerrm); end if;
  end;
  if exists (select 1 from public.requests where id = req2) then
    v_fail := v_fail || 'C2c: une demande a survécu au refus de sa pièce (transaction non atomique)'::text; end if;

  -- ==========================================================================
  -- C3. start_request_email v3 : { upload_id } consommé, { attachment_id } relu,
  --     tout autre forme refusée, un interne ne sort pas.
  -- ==========================================================================
  insert into public.attachment_uploads (organization_id, scope_request_id, uploaded_by, storage_path,
    file_name, mime_type, file_size, checksum, expires_at)
  values (orgA, req, u_agent, orgA || '/' || req || '/m-plan.pdf', 'plan.pdf', 'application/pdf', 500, 'm',
          now() + interval '1 day') returning id into up_mail;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, mime_type,
    file_size, kind)
  values (orgA, req, orgA || '/' || req || '/note.pdf', 'note.pdf', 'application/pdf', 10, 'instruction_interne')
  returning id into a_interne;

  v_email := public.start_request_email(req, u_agent, 'u@exemple.fr', 'Objet', 'Corps', null, null,
    jsonb_build_array(
      jsonb_build_object('upload_id', up_mail),
      jsonb_build_object('attachment_id', (select id from public.request_attachments where request_id = req and checksum = 'a'))));
  select count(*) into v_int from public.request_attachments where email_id = v_email;
  if v_int <> 2 then v_fail := v_fail || format('C3a: %s pièce(s) jointes à l''échange au lieu de 2', v_int); end if;
  select file_name || '|' || coalesce(checksum, '') || '|' || storage_path into v_text
    from public.request_attachments where email_id = v_email and checksum = 'm';
  if v_text is distinct from 'plan.pdf|m|' || orgA || '/' || req || '/m-plan.pdf' then
    v_fail := v_fail || format('C3b: pièce d''échange écrite avec d''autres valeurs (%s)', v_text); end if;
  select consumed_at into v_text from public.attachment_uploads where id = up_mail;
  if v_text is null then v_fail := v_fail || 'C3c: ligne d''attente de l''échange non consommée'::text; end if;

  begin
    perform public.start_request_email(req, u_agent, 'u@exemple.fr', 'Objet', 'Corps', null, null,
      jsonb_build_array(jsonb_build_object('storage_path', orgA || '/' || req || '/z.pdf', 'file_name', 'z.pdf')));
    v_fail := v_fail || 'C3d: la forme { storage_path } du contrat 1.x est encore acceptée'::text;
  exception when others then
    if position('upload_id attendu' in sqlerrm) = 0 then
      v_fail := v_fail || format('C3d: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.start_request_email(req, u_agent, 'u@exemple.fr', 'Objet', 'Corps', null, null,
      jsonb_build_array(jsonb_build_object('attachment_id', a_interne)));
    v_fail := v_fail || 'C3e: un document INTERNE est sorti'::text;
  exception when check_violation then null;
  end;
  begin
    perform public.start_request_email(req, u_autre, 'u@exemple.fr', 'Objet', 'Corps', null, null,
      jsonb_build_array(jsonb_build_object('upload_id', up_autre)));
    -- up_autre est de u_autre mais SANS portée demande et à un chemin sous req : accepté.
  exception when others then
    v_fail := v_fail || format('C3f: refus inattendu d''une pièce de son propre déposant (%s)', sqlerrm);
  end;

  -- ==========================================================================
  -- C4. request_attachment_paths : jamais un chemin hors de la demande
  -- ==========================================================================
  -- Une ligne héritée d'un INSERT client trop large : chemin d'un autre dossier.
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req, orgA || '/' || gen_random_uuid() || '/ailleurs.pdf', 'ailleurs.pdf')
  returning id into a_hors;
  select count(*) into v_int from public.request_attachment_paths(req, array[a_hors, a_interne]);
  if v_int <> 1 then
    v_fail := v_fail || format('C4: request_attachment_paths rend %s ligne(s) au lieu de 1 — un chemin hors demande est sorti', v_int); end if;

  -- ==========================================================================
  -- C5. discard_attachment_uploads : le déposant, les lignes vivantes, rien d'autre
  -- ==========================================================================
  select public.discard_attachment_uploads(array[up_dead, up_a, up_autre], u_agent) into v_int;
  if v_int <> 1 then
    v_fail := v_fail || format('C5a: %s ligne(s) retirée(s) au lieu de 1 (up_dead seule : up_a consommée, up_autre d''un autre)', v_int); end if;
  if (select discarded_at from public.attachment_uploads where id = up_dead) is null then
    v_fail := v_fail || 'C5b: up_dead non marquée retirée'::text; end if;
  if (select discarded_at from public.attachment_uploads where id = up_autre) is not null then
    v_fail := v_fail || 'C5c: la pièce d''un autre déposant a été retirée'::text; end if;

  -- ==========================================================================
  -- C6. Aucun client n'exécute la RPC de retrait ; l'ancienne signature d'ajout a disparu
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.discard_attachment_uploads(uuid[], uuid)', 'execute') then
    v_fail := v_fail || 'C6a: discard_attachment_uploads exécutable par authenticated'::text; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'attach_request_piece'
                and pg_get_function_identity_arguments(p.oid) like '%p_storage_path%') then
    v_fail := v_fail || 'C6b: l''ancienne attach_request_piece (chemin fourni par le client) existe encore'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (porte unique des pièces) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
