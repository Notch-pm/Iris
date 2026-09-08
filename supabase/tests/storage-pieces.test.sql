-- ============================================================================
-- Test d'étanchéité du bucket `request-attachments` après la fermeture de
-- l'ancien chemin (lot 2b — migration 20260911100100). Premier test à viser
-- les policies `storage.objects` elles-mêmes (elles n'en avaient aucun).
--
-- Les règles tenues ici :
--   1. UN CLIENT NE FAIT QUE LIRE, et seulement ce que la demande du chemin
--      lui ouvre : ni INSERT ni DELETE, sous aucun chemin — demande existante,
--      zone d'attente, demande fictive.
--   2. LA ZONE D'ATTENTE EST INVISIBLE aux clients, même à son déposant.
--   3. LA BRANCHE « BROUILLON » A DISPARU : un objet sous une demande
--      inexistante n'est plus visible par son `owner`.
--   4. `request_attachments` n'a plus d'INSERT client — même avec le droit
--      d'instruction, même sur sa propre demande.
--   5. Le bucket porte la liste fermée des types (`allowed_mime_types`).
--
-- Exécution : bloc DO en lecture-écriture (apply_migration) ; l'échec final
-- VOLONTAIRE annule tout.
-- ============================================================================

do $main$
declare
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  orgA     uuid;
  proc     uuid := gen_random_uuid();
  snap     jsonb;
  u_agent  uuid := gen_random_uuid();   -- création + instruction sur la Voirie
  u_autre  uuid := gen_random_uuid();   -- membre SANS droit
  p_id     uuid;
  req      uuid;
  fantome  uuid := gen_random_uuid();   -- une demande qui n'existe pas
  o_req    text; o_stage text; o_fant text;
  v_fail   text[] := '{}';
  v_int    int;
  v_types  text[];
begin
  perform set_config('storage.allow_delete_query', 'true', true);

  -- ==========================================================================
  -- MISE EN PLACE (contexte postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_agent, 'agent@storage.test', now(), now()),
    (u_autre, 'autre@storage.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Storage') returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_agent, 'agent'), (orgA, u_autre, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root, null, 'Mairie'), (orgA, s_voirie, s_root, 'Voirie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement voirie');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create, right_process)
    values (p_id, proc, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, socle_procedure_label)
  values (orgA, 'Nid-de-poule', proc, snap, s_voirie, 'Voirie', 'Signalement voirie')
  returning id into req;

  o_req   := orgA::text || '/' || req::text || '/piece.pdf';
  o_stage := orgA::text || '/_staging/' || gen_random_uuid()::text;
  o_fant  := orgA::text || '/' || fantome::text || '/brouillon.pdf';
  -- Les objets sont écrits par le SERVEUR (service_role) : ici en postgres,
  -- avec u_agent pour propriétaire — le cas le plus favorable à une fuite.
  insert into storage.objects (bucket_id, name, owner_id) values
    ('request-attachments', o_req,   u_agent::text),
    ('request-attachments', o_stage, u_agent::text),
    ('request-attachments', o_fant,  u_agent::text);

  -- ==========================================================================
  -- S1. L'agent lit l'objet de SA demande, et rien d'autre
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from storage.objects where bucket_id = 'request-attachments' and name = o_req;
  if v_int <> 1 then v_fail := v_fail || 'S1a: l''agent ne voit pas la pièce de sa demande'::text; end if;
  select count(*) into v_int from storage.objects where bucket_id = 'request-attachments' and name = o_stage;
  if v_int <> 0 then v_fail := v_fail || 'S1b: la zone d''attente est visible par son déposant'::text; end if;
  select count(*) into v_int from storage.objects where bucket_id = 'request-attachments' and name = o_fant;
  if v_int <> 0 then v_fail := v_fail || 'S1c: la branche « brouillon » vit encore — objet d''une demande fictive visible par son owner'::text; end if;

  -- ==========================================================================
  -- S2. Aucune écriture cliente, sous aucun chemin
  -- ==========================================================================
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('request-attachments', orgA::text || '/' || req::text || '/direct.pdf', u_agent::text);
    v_fail := v_fail || 'S2a: INSERT storage accepté sous une demande que l''agent instruit'::text;
  exception when others then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('request-attachments', orgA::text || '/_staging/' || gen_random_uuid()::text, u_agent::text);
    v_fail := v_fail || 'S2b: INSERT storage accepté en zone d''attente'::text;
  exception when others then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('request-attachments', orgA::text || '/' || gen_random_uuid()::text || '/x.pdf', u_agent::text);
    v_fail := v_fail || 'S2c: INSERT storage accepté sous une demande fictive (vecteur d''écriture non borné)'::text;
  exception when others then null;
  end;
  delete from storage.objects where bucket_id = 'request-attachments' and name = o_req;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'S2d: DELETE storage accepté par un client'::text; end if;

  -- ==========================================================================
  -- S3. request_attachments : plus d'INSERT client, même instructeur
  -- ==========================================================================
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name, uploaded_by)
    values (orgA, req, o_req, 'piece.pdf', u_agent);
    v_fail := v_fail || 'S3a: INSERT client sur request_attachments accepté (le chemin n''y est pas vérifié)'::text;
  exception when others then
    if position('row-level security' in lower(sqlerrm)) = 0 then
      v_fail := v_fail || format('S3a: refus inattendu (%s)', sqlerrm); end if;
  end;
  -- Un chemin d'un AUTRE dossier — exactement l'attaque que la fermeture vise.
  begin
    insert into public.request_attachments (organization_id, request_id, storage_path, file_name, uploaded_by)
    values (orgA, req, orgA::text || '/' || gen_random_uuid()::text || '/secret.pdf', 'secret.pdf', u_agent);
    v_fail := v_fail || 'S3b: un chemin hors demande a pu être déclaré par un client'::text;
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- S4. Un membre sans droit ne lit rien
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from storage.objects where bucket_id = 'request-attachments'
   and name in (o_req, o_stage, o_fant);
  if v_int <> 0 then v_fail := v_fail || format('S4: un membre sans droit lit %s objet(s)', v_int); end if;
  execute 'reset role';

  -- ==========================================================================
  -- S5. Le schéma dit ce que les tests viennent de constater
  -- ==========================================================================
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname in ('request_attachments_storage_insert', 'request_attachments_storage_delete')) then
    v_fail := v_fail || 'S5a: une policy storage d''écriture cliente existe encore'::text; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'request_attachments'
              and policyname = 'request_attachments_insert') then
    v_fail := v_fail || 'S5b: la policy request_attachments_insert existe encore'::text; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'has_any_creation_right') then
    v_fail := v_fail || 'S5c: has_any_creation_right (helper de la policy disparue) existe encore'::text; end if;
  select allowed_mime_types into v_types from storage.buckets where id = 'request-attachments';
  if v_types is null or not ('application/pdf' = any (v_types)) then
    v_fail := v_fail || 'S5d: allowed_mime_types absent ou sans PDF'::text; end if;
  if v_types is not null and ('image/svg+xml' = any (v_types) or 'text/html' = any (v_types)) then
    v_fail := v_fail || 'S5e: un type actif figure dans allowed_mime_types'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (étanchéité storage des pièces) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
