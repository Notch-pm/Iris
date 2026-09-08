-- ============================================================================
-- Tests du lien pièce → usager (`request_attachments.socle_contact_id`,
-- lot 3 — migration 20260912100000).
--
--   1. La colonne est ÉCRITE PAR TRIGGER depuis la demande : une valeur fournie
--      à l'insertion est écrasée, une demande sans usager donne NULL.
--   2. Le RAPPROCHEMENT POSTÉRIEUR d'une demande resynchronise toutes ses
--      pièces — y compris les copies jointes à un échange.
--   3. Le détachement (retour à NULL) suit aussi.
--   4. L'index de la fiche usager existe.
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
  c1      uuid := gen_random_uuid();
  c2      uuid := gen_random_uuid();
  req     uuid;
  req_anon uuid;
  a1      uuid; a2 uuid; a_anon uuid;
  v_email uuid;
  v_fail  text[] := '{}';
  v_int   int;
  v_uuid  uuid;
begin
  insert into auth.users (id, email, created_at, updated_at) values (u_agent, 'agent@usager.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Usager') returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values (orgA, u_agent, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values (orgA, s_root, null, 'Mairie');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement voirie');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement voirie');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_root);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, socle_contact_id, identity_status)
  values (orgA, 'Rapprochée', proc, snap, s_root, 'Mairie', c1, 'rapprochee')
  returning id into req;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Anonyme', proc, snap, s_root, 'Mairie')
  returning id into req_anon;

  -- ==========================================================================
  -- U1. L'insertion hérite de la demande, et ignore la valeur fournie
  -- ==========================================================================
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, socle_contact_id)
  values (orgA, req, orgA || '/' || req || '/a.pdf', 'a.pdf', c2)
  returning id into a1;
  select socle_contact_id into v_uuid from public.request_attachments where id = a1;
  if v_uuid is distinct from c1 then
    v_fail := v_fail || format('U1a: la valeur fournie a survécu (%s au lieu de %s)', v_uuid, c1); end if;

  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req_anon, orgA || '/' || req_anon || '/b.pdf', 'b.pdf')
  returning id into a_anon;
  select socle_contact_id into v_uuid from public.request_attachments where id = a_anon;
  if v_uuid is not null then v_fail := v_fail || 'U1b: une demande sans usager a donné un usager à sa pièce'::text; end if;

  -- Une copie jointe à un échange hérite aussi.
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, kind)
  values (orgA, req, orgA || '/' || req || '/courrier.pdf', 'courrier.pdf', 'courrier')
  returning id into a2;
  v_email := public.start_request_email(req, u_agent, 'u@exemple.fr', 'Objet', 'Corps', null, null,
    jsonb_build_array(jsonb_build_object('attachment_id', a2)));
  select count(*) into v_int from public.request_attachments where email_id = v_email and socle_contact_id = c1;
  if v_int <> 1 then v_fail := v_fail || 'U1c: la copie jointe à un échange n''a pas hérité de l''usager'::text; end if;

  -- ==========================================================================
  -- U2. Rapprochement postérieur : toutes les pièces suivent
  -- ==========================================================================
  update public.requests set socle_contact_id = c2, identity_status = 'rapprochee' where id = req;
  select count(*) into v_int from public.request_attachments where request_id = req and socle_contact_id = c2;
  if v_int <> 3 then v_fail := v_fail || format('U2a: %s pièce(s) resynchronisée(s) au lieu de 3', v_int); end if;

  update public.requests set socle_contact_id = c1, identity_status = 'rapprochee' where id = req_anon;
  select socle_contact_id into v_uuid from public.request_attachments where id = a_anon;
  if v_uuid is distinct from c1 then v_fail := v_fail || 'U2b: la pièce d''une demande rapprochée après coup n''a pas suivi'::text; end if;

  -- ==========================================================================
  -- U3. Détachement
  -- ==========================================================================
  update public.requests set socle_contact_id = null, identity_status = 'non_rapprochee' where id = req_anon;
  select socle_contact_id into v_uuid from public.request_attachments where id = a_anon;
  if v_uuid is not null then v_fail := v_fail || 'U3: la pièce garde un usager que sa demande n''a plus'::text; end if;

  -- ==========================================================================
  -- U4. L'index de la fiche usager
  -- ==========================================================================
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'request_attachments_contact_idx') then
    v_fail := v_fail || 'U4: index request_attachments_contact_idx absent'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (lien pièce → usager) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
