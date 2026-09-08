-- ============================================================================
-- Tests de l'outbox de suppression et de la purge de la zone d'attente
-- (lot 4 — migration 20260913100000).
--
--   1. Supprimer une pièce enfile son objet — SAUF si une autre ligne le
--      référence encore (« joindre à un échange » : deux lignes, un objet).
--   2. Le même objet n'est enfilé qu'une fois tant qu'il n'est pas retiré.
--   3. claim / settle : un lot réclamé avance son prochain essai ; un succès
--      solde ; un échec garde l'erreur ; huit échecs = abandon (plus réclamé).
--   4. expired_attachment_uploads ne rend que les lignes vivantes expirées ou
--      retirées ; purge_attachment_upload ne touche jamais une consommée ;
--      purge_consumed_uploads ne retire que les consommées anciennes.
--   5. attachment_known_paths / mark_attachments_missing.
--   6. Aucun client n'exécute rien de tout cela ; le cron est programmé.
--
-- Exécution : bloc DO en lecture-écriture, l'échec final VOLONTAIRE annule tout.
-- ============================================================================

do $main$
declare
  s_root  uuid := gen_random_uuid();
  orgA    uuid;
  proc    uuid := gen_random_uuid();
  snap    jsonb;
  u_agent uuid := gen_random_uuid();
  req     uuid;
  a_orig  uuid; a_solo uuid;
  v_email uuid;
  up_dead uuid; up_disc uuid; up_live uuid; up_old uuid; up_fresh uuid;
  d_id    uuid;
  v_fail  text[] := '{}';
  v_int   int;
  v_ts    timestamptz;
begin
  insert into auth.users (id, email, created_at, updated_at) values (u_agent, 'agent@outbox.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Outbox') returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values (orgA, u_agent, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values (orgA, s_root, null, 'Mairie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement voirie');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_root);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Outbox', proc, snap, s_root, 'Mairie') returning id into req;

  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, kind)
  values (orgA, req, orgA || '/' || req || '/courrier.pdf', 'courrier.pdf', 'courrier') returning id into a_orig;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req, orgA || '/' || req || '/solo.pdf', 'solo.pdf') returning id into a_solo;
  v_email := public.start_request_email(req, u_agent, 'u@exemple.fr', 'Objet', 'Corps', null, null,
    jsonb_build_array(jsonb_build_object('attachment_id', a_orig)));

  -- ==========================================================================
  -- O1. Deux lignes, un objet : l'objet ne part qu'avec la dernière
  --     (la copie d'échange d'abord : l'original est référencé par sa FK
  --     `source_attachment_id`, RESTRICT — un document envoyé ne s'efface pas
  --     tant que sa trace d'envoi existe).
  -- ==========================================================================
  delete from public.request_attachments where email_id = v_email;
  select count(*) into v_int from public.storage_deletions where storage_path = orgA || '/' || req || '/courrier.pdf' and done_at is null;
  if v_int <> 0 then v_fail := v_fail || 'O1a: objet enfilé alors que l''original le référence encore'::text; end if;
  delete from public.request_attachments where id = a_orig;
  select count(*) into v_int from public.storage_deletions where storage_path = orgA || '/' || req || '/courrier.pdf' and done_at is null;
  if v_int <> 1 then v_fail := v_fail || format('O1b: %s entrée(s) d''outbox pour la dernière ligne au lieu de 1', v_int); end if;

  -- ==========================================================================
  -- O2. Une seule entrée vivante par objet
  -- ==========================================================================
  perform public.enqueue_storage_deletion(orgA || '/' || req || '/courrier.pdf', orgA, 'orphan');
  select count(*) into v_int from public.storage_deletions where storage_path = orgA || '/' || req || '/courrier.pdf';
  if v_int <> 1 then v_fail := v_fail || format('O2: %s entrées pour le même objet', v_int); end if;

  -- ==========================================================================
  -- O3. claim / settle / abandon
  -- ==========================================================================
  delete from public.request_attachments where id = a_solo;
  select count(*) into v_int from public.claim_storage_deletions(10) c
   where c.storage_path in (orgA || '/' || req || '/courrier.pdf', orgA || '/' || req || '/solo.pdf');
  if v_int <> 2 then v_fail := v_fail || format('O3a: %s entrée(s) réclamée(s) au lieu de 2', v_int); end if;
  -- Réclamées : plus dues tout de suite.
  select count(*) into v_int from public.claim_storage_deletions(10) c
   where c.storage_path in (orgA || '/' || req || '/courrier.pdf', orgA || '/' || req || '/solo.pdf');
  if v_int <> 0 then v_fail := v_fail || 'O3b: une entrée tout juste réclamée l''a été deux fois'::text; end if;

  select id into d_id from public.storage_deletions where storage_path = orgA || '/' || req || '/solo.pdf';
  perform public.settle_storage_deletion(d_id, true);
  select done_at into v_ts from public.storage_deletions where id = d_id;
  if v_ts is null then v_fail := v_fail || 'O3c: un succès n''a pas soldé l''entrée'::text; end if;

  select id into d_id from public.storage_deletions where storage_path = orgA || '/' || req || '/courrier.pdf';
  perform public.settle_storage_deletion(d_id, false, repeat('x', 900));
  select length(last_error) into v_int from public.storage_deletions where id = d_id;
  if v_int <> 500 then v_fail := v_fail || 'O3d: erreur non tronquée à 500'::text; end if;
  if (select done_at from public.storage_deletions where id = d_id) is not null then
    v_fail := v_fail || 'O3e: un échec a soldé l''entrée'::text; end if;
  -- Abandon : huit essais et l'entrée n'est plus réclamée.
  update public.storage_deletions set attempts = 8, next_attempt_at = now() - interval '1 minute' where id = d_id;
  select count(*) into v_int from public.claim_storage_deletions(10) c where c.id = d_id;
  if v_int <> 0 then v_fail := v_fail || 'O3f: une entrée abandonnée (8 essais) est encore réclamée'::text; end if;

  -- ==========================================================================
  -- O4. Zone d'attente
  -- ==========================================================================
  insert into public.attachment_uploads (organization_id, uploaded_by, storage_path, file_name, mime_type,
    file_size, checksum, expires_at, consumed_at, discarded_at) values
    (orgA, u_agent, orgA || '/_staging/dead',  'dead.pdf',  'application/pdf', 1, 'dead',  now() - interval '1 minute', null, null),
    (orgA, u_agent, orgA || '/_staging/disc',  'disc.pdf',  'application/pdf', 1, 'disc',  now() + interval '1 day', null, now()),
    (orgA, u_agent, orgA || '/_staging/live',  'live.pdf',  'application/pdf', 1, 'live',  now() + interval '1 day', null, null),
    (orgA, u_agent, orgA || '/' || req || '/old.pdf',   'old.pdf',   'application/pdf', 1, 'old',   now() - interval '40 days', now() - interval '40 days', null),
    (orgA, u_agent, orgA || '/' || req || '/fresh.pdf', 'fresh.pdf', 'application/pdf', 1, 'fresh', now() + interval '1 day', now() - interval '1 day', null);
  select id into up_dead  from public.attachment_uploads where checksum = 'dead'  and uploaded_by = u_agent;
  select id into up_disc  from public.attachment_uploads where checksum = 'disc'  and uploaded_by = u_agent;
  select id into up_live  from public.attachment_uploads where checksum = 'live'  and uploaded_by = u_agent;
  select id into up_old   from public.attachment_uploads where checksum = 'old'   and uploaded_by = u_agent;
  select id into up_fresh from public.attachment_uploads where checksum = 'fresh' and uploaded_by = u_agent;

  select count(*) into v_int from public.expired_attachment_uploads(100) e where e.id in (up_dead, up_disc);
  if v_int <> 2 then v_fail := v_fail || format('O4a: %s ligne(s) à purger au lieu de 2 (expirée + retirée)', v_int); end if;
  select count(*) into v_int from public.expired_attachment_uploads(100) e where e.id in (up_live, up_old, up_fresh);
  if v_int <> 0 then v_fail := v_fail || 'O4b: une ligne vivante ou consommée est proposée à la purge'::text; end if;

  perform public.purge_attachment_upload(up_dead);
  if exists (select 1 from public.attachment_uploads where id = up_dead) then
    v_fail := v_fail || 'O4c: la ligne expirée n''a pas été purgée'::text; end if;
  perform public.purge_attachment_upload(up_old);
  if not exists (select 1 from public.attachment_uploads where id = up_old) then
    v_fail := v_fail || 'O4d: purge_attachment_upload a supprimé une ligne CONSOMMÉE'::text; end if;

  select public.purge_consumed_uploads(30) into v_int;
  if exists (select 1 from public.attachment_uploads where id = up_old) then
    v_fail := v_fail || 'O4e: la ligne consommée depuis 40 jours est encore là'::text; end if;
  if not exists (select 1 from public.attachment_uploads where id = up_fresh) then
    v_fail := v_fail || 'O4f: une ligne consommée hier a été purgée'::text; end if;

  -- ==========================================================================
  -- O5. Réconciliation : chemins connus, pièces sans objet
  -- ==========================================================================
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req, orgA || '/' || req || '/fantome.pdf', 'fantome.pdf');
  select count(*) into v_int from public.attachment_known_paths() k
   where k.path in (orgA || '/' || req || '/fantome.pdf', orgA || '/_staging/live');
  if v_int <> 2 then v_fail := v_fail || format('O5a: %s chemin(s) connu(s) au lieu de 2', v_int); end if;
  select public.mark_attachments_missing(array[orgA || '/' || req || '/fantome.pdf']) into v_int;
  if v_int <> 1 then v_fail := v_fail || format('O5b: %s pièce(s) marquée(s) manquante(s) au lieu de 1', v_int); end if;
  if (select copy_status from public.request_attachments where storage_path = orgA || '/' || req || '/fantome.pdf') <> 'error' then
    v_fail := v_fail || 'O5c: copy_status non passé à error'::text; end if;

  -- ==========================================================================
  -- O6. Rien pour les clients ; le cron existe
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.claim_storage_deletions(int)', 'execute')
     or has_function_privilege('authenticated', 'public.bucket_objects(text)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_consumed_uploads(int)', 'execute') then
    v_fail := v_fail || 'O6a: une RPC de maintenance est exécutable par authenticated'::text; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.storage_deletions;
  if v_int <> 0 then v_fail := v_fail || 'O6b: un client lit l''outbox'::text; end if;
  execute 'reset role';
  if not exists (select 1 from cron.job where jobname = 'attachments-maintenance') then
    v_fail := v_fail || 'O6c: job cron attachments-maintenance absent'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (outbox et purge des pièces) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
