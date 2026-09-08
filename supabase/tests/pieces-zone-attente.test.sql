-- ============================================================================
-- Tests de la ZONE D'ATTENTE des pièces (`attachment_uploads`,
-- `consume_attachment_upload`, `ingest_request_attachments`) — lot 1 du
-- chantier documents (migrations 20260910100000 et 20260910100100).
--
-- Les règles tenues ici :
--   1. UNE PORTE DE CONSOMMATION, et elle refuse tout ce qui n'est pas
--      exactement ce qui a été reçu : autre tenant, autre déposant, autre
--      portée, expiré, retiré, déjà consommé, objet pas encore sous la demande.
--   2. L'INGESTION PARTENAIRE écrit la pièce DEPUIS la ligne d'attente (type
--      détecté, empreinte, taille) — jamais depuis ce que l'enveloppe dit.
--   3. AUCUN CLIENT ne lit la zone d'attente ni n'exécute ses fonctions.
--   4. Le mode « URL signée » n'existe plus : ni colonne, ni état `pending`.
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur (leçon modeles-email.test.sql).
--
-- Exécution : bloc DO en lecture-écriture (SQL editor, ou apply_migration —
-- l'échec final VOLONTAIRE annule la transaction, rien n'est conservé).
-- ============================================================================

do $main$
declare
  s_root  uuid := gen_random_uuid();
  s_root2 uuid := gen_random_uuid();
  orgA    uuid;
  orgB    uuid;
  proc    uuid := gen_random_uuid();
  snap    jsonb;
  src     uuid;
  src_b   uuid;
  u_agent uuid := gen_random_uuid();
  req     uuid;
  req2    uuid;
  up1     uuid;
  up2     uuid;
  up3     uuid;
  v_row   public.attachment_uploads%rowtype;
  v_fail  text[] := '{}';
  v_int   int;
  v_text  text;
  v_uuid  uuid;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@attente.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie A') returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Mairie B') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values (orgA, u_agent, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie A'), (orgB, s_root2, null, 'Mairie B');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement voirie');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_root);

  insert into public.integration_sources (organization_id, code, name)
    values (orgA, 'portail', 'Portail') returning id into src;
  insert into public.integration_sources (organization_id, code, name)
    values (orgB, 'portail', 'Portail B') returning id into src_b;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, socle_procedure_label,
                               source, external_ref)
  values (orgA, 'Nid-de-poule', proc, snap, s_root, 'Mairie A', 'Signalement voirie', 'portail', 'd-1')
  returning id into req;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, socle_procedure_label,
                               source, external_ref)
  values (orgA, 'Autre', proc, snap, s_root, 'Mairie A', 'Signalement voirie', 'portail', 'd-2')
  returning id into req2;

  -- Trois fichiers reçus par le serveur, en zone d'attente (portée organisation).
  insert into public.attachment_uploads (organization_id, integration_source_id, storage_path,
    file_name, mime_type, file_size, checksum, expires_at)
  values (orgA, src, orgA || '/_staging/00000000-0000-4000-8000-000000000001',
          'cni.pdf', 'application/pdf', 1234, 'aaa', now() + interval '1 day')
  returning id into up1;
  insert into public.attachment_uploads (organization_id, integration_source_id, storage_path,
    file_name, mime_type, file_size, checksum, expires_at)
  values (orgA, src, orgA || '/_staging/00000000-0000-4000-8000-000000000002',
          'photo.jpg', 'image/jpeg', 5678, 'bbb', now() + interval '1 day')
  returning id into up2;
  insert into public.attachment_uploads (organization_id, integration_source_id, storage_path,
    file_name, mime_type, file_size, checksum, expires_at)
  values (orgA, src, orgA || '/_staging/00000000-0000-4000-8000-000000000003',
          'perime.pdf', 'application/pdf', 10, 'ccc', now() - interval '1 minute')
  returning id into up3;

  -- ==========================================================================
  -- Z0. Le schéma : un déposant exactement, un chemin dans le tenant
  -- ==========================================================================
  begin
    insert into public.attachment_uploads (organization_id, integration_source_id, uploaded_by,
      storage_path, file_name, mime_type, file_size, checksum, expires_at)
    values (orgA, src, u_agent, orgA || '/_staging/x', 'x.pdf', 'application/pdf', 1, 'x', now());
    v_fail := v_fail || 'Z0a: deux déposants acceptés'::text;
  exception when check_violation then null;
  end;
  begin
    insert into public.attachment_uploads (organization_id, integration_source_id,
      storage_path, file_name, mime_type, file_size, checksum, expires_at)
    values (orgA, src, orgB || '/_staging/x', 'x.pdf', 'application/pdf', 1, 'x', now());
    v_fail := v_fail || 'Z0b: chemin hors du tenant accepté'::text;
  exception when check_violation then null;
  end;

  -- ==========================================================================
  -- Z1. Introuvable / autre tenant : même refus, sans révéler l'existence
  -- ==========================================================================
  begin
    perform public.consume_attachment_upload(gen_random_uuid(), orgA, req, null, src);
    v_fail := v_fail || 'Z1a: identifiant inconnu consommé'::text;
  exception when others then
    if position('introuvable' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z1a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.consume_attachment_upload(up1, orgB, req, null, src_b);
    v_fail := v_fail || 'Z1b: consommé depuis un autre tenant'::text;
  exception when others then
    if position('introuvable' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z1b: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- Z2. Objet encore en zone d'attente : refus tant qu'il n'est pas déplacé
  -- ==========================================================================
  begin
    perform public.consume_attachment_upload(up1, orgA, req, null, src);
    v_fail := v_fail || 'Z2: consommé alors que l''objet est encore sous _staging'::text;
  exception when others then
    if position('non déplacé' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z2: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- L'edge function a déplacé les objets sous la demande (simulé).
  update public.attachment_uploads set storage_path = orgA || '/' || req || '/' || id || '-cni.pdf' where id = up1;
  update public.attachment_uploads set storage_path = orgA || '/' || req || '/' || id || '-photo.jpg' where id = up2;
  update public.attachment_uploads set storage_path = orgA || '/' || req || '/' || id || '-perime.pdf' where id = up3;

  -- ==========================================================================
  -- Z3. Déposant, portée, expiration, retrait
  -- ==========================================================================
  begin
    perform public.consume_attachment_upload(up1, orgA, req, null, src_b);
    v_fail := v_fail || 'Z3a: consommé par une autre source'::text;
  exception when others then
    if position('autre déposant' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.consume_attachment_upload(up1, orgA, req, u_agent, null);
    v_fail := v_fail || 'Z3b: pièce d''une source consommée par un agent'::text;
  exception when others then
    if position('autre déposant' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3b: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.consume_attachment_upload(up1, orgA, req, u_agent, src);
    v_fail := v_fail || 'Z3c: deux déposants acceptés à la consommation'::text;
  exception when others then
    if position('un déposant exactement' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3c: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.consume_attachment_upload(up3, orgA, req, null, src);
    v_fail := v_fail || 'Z3d: pièce expirée consommée'::text;
  exception when others then
    if position('expirée' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3d: refus inattendu (%s)', sqlerrm); end if;
  end;
  update public.attachment_uploads set discarded_at = now() where id = up3;
  begin
    perform public.consume_attachment_upload(up3, orgA, req, null, src);
    v_fail := v_fail || 'Z3e: pièce retirée consommée'::text;
  exception when others then
    if position('retirée' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3e: refus inattendu (%s)', sqlerrm); end if;
  end;
  -- Portée demande : une pièce reçue POUR req2 ne se rattache pas à req.
  update public.attachment_uploads set scope_request_id = req2 where id = up2;
  begin
    perform public.consume_attachment_upload(up2, orgA, req, null, src);
    v_fail := v_fail || 'Z3f: pièce d''une autre portée consommée'::text;
  exception when others then
    if position('autre demande' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z3f: refus inattendu (%s)', sqlerrm); end if;
  end;
  update public.attachment_uploads set scope_request_id = null where id = up2;

  -- ==========================================================================
  -- Z4. Consommation nominale, puis refus de la seconde
  -- ==========================================================================
  v_row := public.consume_attachment_upload(up1, orgA, req, null, src);
  if v_row.consumed_at is null then v_fail := v_fail || 'Z4a: consumed_at non posé'::text; end if;
  if v_row.checksum is distinct from 'aaa' then v_fail := v_fail || 'Z4b: la ligne rendue n''est pas celle consommée'::text; end if;
  begin
    perform public.consume_attachment_upload(up1, orgA, req, null, src);
    v_fail := v_fail || 'Z4c: consommée deux fois'::text;
  exception when others then
    if position('déjà rattachée' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z4c: refus inattendu (%s)', sqlerrm); end if;
  end;
  update public.attachment_uploads set consumed_at = null where id = up1;  -- pour Z5

  -- ==========================================================================
  -- Z5. Ingestion : la pièce naît DE la ligne d'attente, en une transaction
  -- ==========================================================================
  select public.ingest_request_attachments(req, orgA, src, jsonb_build_array(
    jsonb_build_object('upload_id', up1, 'form_field_key', 'piece_identite'),
    jsonb_build_object('upload_id', up2)
  )) into v_int;
  if v_int <> 2 then v_fail := v_fail || format('Z5a: %s pièce(s) rattachée(s) au lieu de 2', v_int); end if;

  select count(*) into v_int from public.request_attachments where request_id = req;
  if v_int <> 2 then v_fail := v_fail || format('Z5b: %s ligne(s) request_attachments au lieu de 2', v_int); end if;

  select a.copy_status || '|' || a.kind || '|' || coalesce(a.checksum, '') || '|' || a.mime_type
         || '|' || a.file_size || '|' || coalesce(a.form_field_key, '') || '|' || coalesce(a.uploaded_by::text, 'null')
    into v_text
    from public.request_attachments a
   where a.request_id = req and a.file_name = 'cni.pdf';
  if v_text is distinct from 'copied|demande|aaa|application/pdf|1234|piece_identite|null' then
    v_fail := v_fail || format('Z5c: pièce écrite avec d''autres valeurs que la ligne d''attente (%s)', v_text); end if;

  select a.storage_path into v_text from public.request_attachments a where a.request_id = req and a.file_name = 'cni.pdf';
  if v_text not like orgA || '/' || req || '/%' then
    v_fail := v_fail || 'Z5d: le chemin de la pièce n''est pas sous la demande'::text; end if;

  select request_attachment_id into v_uuid from public.attachment_uploads where id = up1;
  if v_uuid is null or not exists (select 1 from public.request_attachments where id = v_uuid) then
    v_fail := v_fail || 'Z5e: la ligne d''attente ne garde pas la trace de la pièce née'::text; end if;
  select count(*) into v_int from public.attachment_uploads where id in (up1, up2) and consumed_at is not null;
  if v_int <> 2 then v_fail := v_fail || 'Z5f: lignes d''attente non consommées après ingestion'::text; end if;

  -- Rejeu : les mêmes upload_id ne se rattachent pas deux fois — et rien n'est écrit.
  begin
    perform public.ingest_request_attachments(req, orgA, src, jsonb_build_array(jsonb_build_object('upload_id', up1)));
    v_fail := v_fail || 'Z5g: rattachement rejoué accepté'::text;
  exception when others then
    if position('déjà rattachée' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z5g: refus inattendu (%s)', sqlerrm); end if;
  end;
  select count(*) into v_int from public.request_attachments where request_id = req;
  if v_int <> 2 then v_fail := v_fail || 'Z5h: une pièce de plus après un rejeu refusé'::text; end if;

  -- ==========================================================================
  -- Z6. Ingestion sur une demande d'un autre tenant, ou sans source
  -- ==========================================================================
  begin
    perform public.ingest_request_attachments(req, orgB, src_b, '[]'::jsonb);
    v_fail := v_fail || 'Z6a: ingestion sur une demande hors tenant acceptée'::text;
  exception when others then
    if position('introuvable dans ce tenant' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z6a: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.ingest_request_attachments(req, orgA, null, '[]'::jsonb);
    v_fail := v_fail || 'Z6b: ingestion sans source acceptée'::text;
  exception when others then
    if position('source d''intégration requise' in sqlerrm) = 0 then
      v_fail := v_fail || format('Z6b: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- Z7. Aucun client ne voit la zone d'attente ni n'appelle ses fonctions
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.attachment_uploads;
  if v_int <> 0 then v_fail := v_fail || format('Z7a: un client lit %s ligne(s) de la zone d''attente', v_int); end if;
  begin
    perform public.consume_attachment_upload(up2, orgA, req, u_agent, null);
    v_fail := v_fail || 'Z7b: consume_attachment_upload exécutable par un client'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ingest_request_attachments(req, orgA, src, '[]'::jsonb);
    v_fail := v_fail || 'Z7c: ingest_request_attachments exécutable par un client'::text;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- Z8. Le mode « URL signée » n'existe plus
  -- ==========================================================================
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'request_attachments' and column_name = 'fetch_url') then
    v_fail := v_fail || 'Z8a: la colonne fetch_url existe encore'::text; end if;
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name, copy_status)
    values (orgA, req, orgA || '/' || req || '/pending.pdf', 'pending.pdf', 'pending');
    v_fail := v_fail || 'Z8b: copy_status = pending encore accepté'::text;
  exception when check_violation then null;
  end;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (zone d''attente des pièces) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
