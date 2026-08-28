-- ============================================================================
-- Tests de la qualification des pièces justificatives.
--
-- Les quatre règles tenues ici :
--   1. LE JUMEAU SQL DIT LA MÊME CHOSE QUE L'ÉCRAN — `form_attachment_requirements`
--      rejoue visibleIf (section ET champ) puis `required` / `requiredIf`
--      exactement comme `pieceFields()` de conformite.ts. Les cas Q1 sont les
--      jumeaux littéraux de ceux de `conformite.test.ts`.
--   2. SEULE LA RÉSOLUTION POSITIVE EST FERMÉE (décision PO 2026-08-28) — la
--      mise en attente, l'annulation et la résolution négative restent ouvertes :
--      on refuse souvent PARCE QU'une pièce manque.
--   3. L'ÉCRITURE N'A QU'UNE PORTE — `qualify_request_attachment`. Aucune policy
--      UPDATE cliente sur `request_attachments`, hier comme aujourd'hui.
--   4. UNE PIÈCE NON CONFORME MET LA DEMANDE EN ATTENTE — depuis l'instruction
--      seulement : depuis « À traiter », la matrice l'interdit et le statut ne
--      bouge pas.
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur, jamais `exception when others
-- then null` : c'est la leçon de modeles-email.test.sql, où un
-- « permission denied » passait pour un refus légitime.
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
  req uuid; req_at uuid; req_b uuid;
  att_dom uuid; att_id uuid; att_libre uuid; att_mail uuid; att_at uuid;
  mail uuid;
  u_instructeur uuid := gen_random_uuid();  -- instruction sur (Voirie, proc)
  u_consultant  uuid := gen_random_uuid();  -- consultation SEULE
  u_ccas        uuid := gen_random_uuid();  -- même tenant, AUTRE sous-arbre
  u_autre       uuid := gen_random_uuid();  -- autre tenant
  -- Le formulaire de référence : un justificatif OBLIGATOIRE, une pièce
  -- d'identité facultative, et un RIB obligatoire seulement pour les pros.
  snap jsonb := jsonb_build_object('id', proc::text, 'form_schema', '{
    "version": 1,
    "content": [
      {"id":"f-type","key":"type_demandeur","label":"Type","type":"radio",
       "options":[{"value":"pro","label":"Professionnel"},{"value":"part","label":"Particulier"}]},
      {"id":"f-dom","key":"justificatif_domicile","label":"Justificatif de domicile",
       "type":"attachment","required":true},
      {"id":"f-id","key":"piece_identite","label":"Pièce d''identité","type":"attachment"},
      {"id":"f-rib","key":"rib","label":"RIB","type":"attachment",
       "requiredIf":{"combinator":"and","rules":[{"fieldId":"f-type","operator":"equals","value":"pro"}]}}
    ]}'::jsonb);
  data_part jsonb := '{"type_demandeur":"part"}'::jsonb;
  v_fail text[] := '{}';
  v_int int;
  v_text text;
  v_text2 text;
  v_text3 text;
  v_bool boolean;
  v_arr text[];
  v_jsonb jsonb;

  -- Q1 : jumeaux littéraux des cas de conformite.test.ts.
  function_cas record;
begin
  -- ==========================================================================
  -- Q1. Le jumeau SQL du moteur de formulaire
  -- ==========================================================================
  for function_cas in
    select * from (values
      ('Q1a statique obligatoire',
       '{"version":1,"content":[{"id":"f1","key":"justif","label":"J","type":"attachment","required":true}]}'::jsonb,
       '{}'::jsonb, 'justif/true'),
      ('Q1b requiredIf non satisfaite',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"pro"}]}}]}'::jsonb,
       '{"type":"part"}'::jsonb, 'justif/false'),
      ('Q1c requiredIf satisfaite',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"pro"}]}}]}'::jsonb,
       '{"type":"pro"}'::jsonb, 'justif/true'),
      ('Q1d champ masqué par visibleIf',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","required":true,"visibleIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"pro"}]}}]}'::jsonb,
       '{"type":"part"}'::jsonb, '(aucune)'),
      ('Q1e section masquée',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"sec","kind":"section","title":"Pros","visibleIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"pro"}]},"fields":[{"id":"f1","key":"justif","label":"J","type":"attachment","required":true}]}]}'::jsonb,
       '{"type":"part"}'::jsonb, '(aucune)'),
      ('Q1f section visible',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"sec","kind":"section","title":"Pros","visibleIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"pro"}]},"fields":[{"id":"f1","key":"justif","label":"J","type":"attachment","required":true}]}]}'::jsonb,
       '{"type":"pro"}'::jsonb, 'justif/true'),
      ('Q1g clé machine vide, repli sur l''id',
       '{"version":1,"content":[{"id":"f-dom","key":"","label":"J","type":"attachment","required":true}]}'::jsonb,
       '{}'::jsonb, 'f-dom/true'),
      ('Q1h un nœud illisible vide TOUT le schéma',
       '{"version":1,"content":[{"id":"f1","key":"justif","label":"J","type":"attachment","required":true},{"id":"f2","key":"x","label":"X","type":"type_inconnu"}]}'::jsonb,
       '{}'::jsonb, '(aucune)'),
      ('Q1i version non prise en charge',
       '{"version":2,"content":[{"id":"f1","key":"justif","label":"J","type":"attachment","required":true}]}'::jsonb,
       '{}'::jsonb, '(aucune)'),
      ('Q1j snapshot dégradé, sans form_schema',
       null::jsonb, '{}'::jsonb, '(aucune)'),
      ('Q1k combinator « or »',
       '{"version":1,"content":[{"id":"ft","key":"type","label":"T","type":"radio","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"or","rules":[{"fieldId":"ft","operator":"equals","value":"pro"},{"fieldId":"ft","operator":"equals","value":"asso"}]}}]}'::jsonb,
       '{"type":"asso"}'::jsonb, 'justif/true'),
      ('Q1l isNotEmpty sur un tableau vide',
       '{"version":1,"content":[{"id":"ft","key":"choix","label":"C","type":"checkboxes","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"isNotEmpty"}]}}]}'::jsonb,
       '{"choix":[]}'::jsonb, 'justif/false'),
      ('Q1m equals sur un tableau vaut « contient »',
       '{"version":1,"content":[{"id":"ft","key":"choix","label":"C","type":"checkboxes","options":[]},{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"and","rules":[{"fieldId":"ft","operator":"equals","value":"b"}]}}]}'::jsonb,
       '{"choix":["a","b"]}'::jsonb, 'justif/true'),
      ('Q1n requiredIf sans règle n''oblige à rien',
       '{"version":1,"content":[{"id":"f1","key":"justif","label":"J","type":"attachment","requiredIf":{"combinator":"and","rules":[]}}]}'::jsonb,
       '{}'::jsonb, 'justif/false')
    ) as t(titre, schema, data, attendu)
  loop
    select coalesce(string_agg(r.field_key || '/' || r.required::text, ', '), '(aucune)')
      into v_text
      from public.form_attachment_requirements(function_cas.schema, function_cas.data) r;
    if v_text is distinct from function_cas.attendu then
      v_fail := v_fail || format('%s: « %s » au lieu de « %s »',
        function_cas.titre, v_text, function_cas.attendu);
    end if;
  end loop;

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
    (proc, orgA, s_root, 'Demande de subvention'),
    (proc2, orgB, s_root2, 'Démarche B');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process, right_close)
    values (p_id, proc, true, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_instructeur);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Consultant voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_consultant);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Instructeur CCAS', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgB, 'Instructeur B', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root2);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_autre);

  -- La demande de travail : en instruction, un particulier (donc pas de RIB).
  insert into public.requests (organization_id, subject, status, socle_procedure_id, procedure_snapshot,
                               form_data, socle_organization_id, socle_organization_label)
  values (orgA, 'Subvention association', 'en_instruction', proc, snap, data_part, s_voirie, 'Voirie')
  returning id into req;

  -- Une seconde, restée « À traiter » (Q4d).
  insert into public.requests (organization_id, subject, status, socle_procedure_id, procedure_snapshot,
                               form_data, socle_organization_id, socle_organization_label)
  values (orgA, 'Subvention 2', 'a_traiter', proc, snap, data_part, s_voirie, 'Voirie')
  returning id into req_at;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgB, 'Demande B', proc2, jsonb_build_object('id', proc2::text), s_root2, 'Mairie B')
  returning id into req_b;

  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, form_field_key)
  values (orgA, req, orgA::text || '/' || req::text || '/a-justif.pdf', 'justificatif.pdf', 'justificatif_domicile')
  returning id into att_dom;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, form_field_key)
  values (orgA, req, orgA::text || '/' || req::text || '/b-cni.pdf', 'cni.pdf', 'piece_identite')
  returning id into att_id;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name)
  values (orgA, req, orgA::text || '/' || req::text || '/c-libre.pdf', 'annexe.pdf')
  returning id into att_libre;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, form_field_key)
  values (orgA, req_at, orgA::text || '/' || req_at::text || '/d-justif.pdf', 'justificatif.pdf', 'justificatif_domicile')
  returning id into att_at;

  -- Une pièce jointe à un e-mail SORTANT : elle n'entre dans aucun examen.
  select public.start_request_email(req, u_instructeur, 'usager@exemple.fr', 'Objet', 'Corps') into mail;
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name,
                                          form_field_key, email_id)
  values (orgA, req, orgA::text || '/' || req::text || '/e-reponse.pdf', 'reponse.pdf',
          'justificatif_domicile', mail)
  returning id into att_mail;

  -- ==========================================================================
  -- Q2. request_pieces_blocking — ce qui ferme la résolution positive
  -- ==========================================================================
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
  if v_arr is distinct from array['Justificatif de domicile'] then
    v_fail := v_fail || format('Q2a: pièce déposée non qualifiée → attendu le justificatif, obtenu %s', v_arr);
  end if;

  -- La pièce de l'e-mail sortant porte pourtant la même clé : elle ne compte pas.
  update public.request_attachments set compliance = 'conforme',
         compliance_by = u_instructeur, compliance_at = now()
   where id = att_mail;
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
  if v_arr is distinct from array['Justificatif de domicile'] then
    v_fail := v_fail || 'Q2b: une pièce d''échange SORTANT a été comptée dans l''examen'::text; end if;
  update public.request_attachments set compliance = null, compliance_by = null, compliance_at = null
   where id = att_mail;

  update public.request_attachments set compliance = 'conforme',
         compliance_by = u_instructeur, compliance_at = now()
   where id = att_dom;
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
  if array_length(v_arr, 1) is not null then
    v_fail := v_fail || format('Q2c: tout est conforme, pourtant %s bloque', v_arr); end if;

  -- La pièce d'identité est FACULTATIVE : non conforme, elle ne bloque rien.
  update public.request_attachments set compliance = 'non_conforme', compliance_motif = 'illisible',
         compliance_by = u_instructeur, compliance_at = now()
   where id = att_id;
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
  if array_length(v_arr, 1) is not null then
    v_fail := v_fail || 'Q2d: une pièce FACULTATIVE non conforme bloque la résolution'::text; end if;

  -- Le RIB devient obligatoire pour un professionnel — et il n'a jamais été déposé.
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', '{"type_demandeur":"pro"}'::jsonb);
  if v_arr is distinct from array['RIB'] then
    v_fail := v_fail || format('Q2e: exigence conditionnelle jamais déposée → attendu RIB, obtenu %s', v_arr);
  end if;

  update public.request_attachments set compliance = 'non_conforme', compliance_motif = 'non_a_jour'
   where id = att_dom;
  v_arr := public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
  if v_arr is distinct from array['Justificatif de domicile'] then
    v_fail := v_fail || 'Q2f: une pièce obligatoire NON CONFORME ne bloque pas'::text; end if;

  -- ==========================================================================
  -- Q3. La garde t17 — seule la résolution POSITIVE est fermée
  --     (et elle s'applique même en contexte de service : règle métier)
  -- ==========================================================================
  begin
    update public.requests set status = 'resolue_positive', closure_text = 'Accordé.' where id = req;
    v_fail := v_fail || 'Q3a: résolution POSITIVE acceptée avec une pièce obligatoire non conforme'::text;
  exception when others then
    if position('pièce(s) obligatoire(s)' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q3a: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- La mise en attente, elle, reste ouverte — c'est la sortie dont on a besoin.
  update public.requests set status = 'en_attente' where id = req;
  select status into v_text from public.requests where id = req;
  if v_text is distinct from 'en_attente' then
    v_fail := v_fail || 'Q3b: la mise en attente a été bloquée'::text; end if;
  update public.requests set status = 'en_instruction' where id = req;

  -- La résolution NÉGATIVE aussi : on refuse souvent PARCE QU'une pièce cloche.
  update public.requests set status = 'resolue_negative', closure_text = 'Refusé.' where id = req;
  select status into v_text from public.requests where id = req;
  if v_text is distinct from 'resolue_negative' then
    v_fail := v_fail || 'Q3c: la résolution NÉGATIVE a été bloquée'::text; end if;
  update public.requests set status = 'en_instruction', closure_text = null, closed_at = null where id = req;

  -- Une fois la pièce conforme, la résolution positive s'ouvre.
  update public.request_attachments set compliance = 'conforme', compliance_motif = null where id = att_dom;
  update public.requests set status = 'resolue_positive', closure_text = 'Accordé.' where id = req;
  select status into v_text from public.requests where id = req;
  if v_text is distinct from 'resolue_positive' then
    v_fail := v_fail || 'Q3d: résolution positive refusée alors que tout est conforme'::text; end if;
  update public.requests set status = 'en_instruction' where id = req;

  -- ==========================================================================
  -- Q4. qualify_request_attachment — la porte, ses gardes, ses effets
  -- ==========================================================================
  update public.request_attachments
     set compliance = null, compliance_motif = null, compliance_note = null,
         compliance_by = null, compliance_at = null
   where request_id in (req, req_at);

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Q4a : le geste nominal — conforme.
  select public.qualify_request_attachment(att_id, 'conforme', null, '  RAS  ') into v_jsonb;
  if (v_jsonb ->> 'compliance') is distinct from 'conforme'
     or (v_jsonb ->> 'status_changed')::boolean then
    v_fail := v_fail || format('Q4a: retour inattendu %s', v_jsonb); end if;
  select compliance, compliance_motif, compliance_note, compliance_by is not null
    into v_text, v_text2, v_text3, v_bool
    from public.request_attachments where id = att_id;
  if v_text is distinct from 'conforme' or v_text2 is not null then
    v_fail := v_fail || 'Q4a: un verdict conforme ne doit porter aucun motif'::text; end if;
  if v_text3 is distinct from 'RAS' then
    v_fail := v_fail || format('Q4a: précision non normalisée (%s)', v_text3); end if;
  if not v_bool then v_fail := v_fail || 'Q4a: compliance_by non renseigné'::text; end if;

  -- Q4b : non conforme → la demande passe en attente d'information.
  select public.qualify_request_attachment(att_dom, 'non_conforme', 'illisible', 'Page 2 floue.') into v_jsonb;
  if not (v_jsonb ->> 'status_changed')::boolean or (v_jsonb ->> 'status') is distinct from 'en_attente' then
    v_fail := v_fail || format('Q4b: la bascule en attente n''a pas eu lieu (%s)', v_jsonb); end if;
  select status into v_text from public.requests where id = req;
  if v_text is distinct from 'en_attente' then
    v_fail := v_fail || format('Q4b: statut %s au lieu de en_attente', v_text); end if;

  -- Q4c : le journal garde la trace du geste.
  select count(*) into v_int from public.request_events
   where request_id = req and event_type = 'piece_qualifiee';
  if v_int <> 2 then
    v_fail := v_fail || format('Q4c: %s événements « piece_qualifiee » au lieu de 2', v_int); end if;
  select payload ->> 'motif' into v_text from public.request_events
   where request_id = req and event_type = 'piece_qualifiee'
     and payload ->> 'attachment_id' = att_dom::text;
  if v_text is distinct from 'illisible' then
    v_fail := v_fail || 'Q4c: le motif n''est pas journalisé'::text; end if;

  -- Q4d : depuis « À traiter », la matrice interdit l'attente — rien ne bouge.
  select public.qualify_request_attachment(att_at, 'non_conforme', 'incomplete') into v_jsonb;
  if (v_jsonb ->> 'status_changed')::boolean then
    v_fail := v_fail || 'Q4d: bascule en attente depuis « À traiter », que la matrice interdit'::text; end if;
  select status into v_text from public.requests where id = req_at;
  if v_text is distinct from 'a_traiter' then
    v_fail := v_fail || format('Q4d: statut %s au lieu de a_traiter', v_text); end if;

  -- Q4e : un verdict inconnu, un motif manquant, un motif inconnu.
  begin
    perform public.qualify_request_attachment(att_libre, 'peut_etre');
    v_fail := v_fail || 'Q4e: verdict inconnu accepté'::text;
  exception when others then
    if position('verdict attendu' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q4e: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.qualify_request_attachment(att_libre, 'non_conforme');
    v_fail := v_fail || 'Q4f: non-conformité SANS motif acceptée'::text;
  exception when others then
    if position('motif de non-conformité est obligatoire' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q4f: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.qualify_request_attachment(att_libre, 'non_conforme', 'trop_moche');
    v_fail := v_fail || 'Q4g: motif hors catalogue accepté'::text;
  exception when others then
    if position('motif de non-conformité inconnu' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q4g: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.qualify_request_attachment(att_libre, 'conforme', null, repeat('x', 501));
    v_fail := v_fail || 'Q4h: précision de plus de 500 caractères acceptée'::text;
  exception when others then
    if position('500 caractères' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q4h: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- Q4i : une pièce d'échange sortant ne se qualifie pas.
  begin
    perform public.qualify_request_attachment(att_mail, 'conforme');
    v_fail := v_fail || 'Q4i: une pièce jointe à un envoi du service a été qualifiée'::text;
  exception when others then
    if position('échange sortant' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q4i: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- Q5. Le droit d'INSTRUCTION, et lui seul, ouvre la qualification
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_consultant, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.qualify_request_attachment(att_libre, 'conforme');
    v_fail := v_fail || 'Q5a: un CONSULTANT a pu qualifier une pièce'::text;
  exception when others then
    if position('droit d''instruction' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q5a: refus inattendu (%s)', sqlerrm); end if;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_ccas, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.qualify_request_attachment(att_libre, 'conforme');
    v_fail := v_fail || 'Q5b: FUITE intra-tenant — le CCAS a qualifié une pièce de la Voirie'::text;
  exception when others then
    if position('droit d''instruction' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q5b: refus inattendu (%s)', sqlerrm); end if;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_autre, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.qualify_request_attachment(att_libre, 'conforme');
    v_fail := v_fail || 'Q5c: FUITE cross-tenant — un autre tenant a qualifié la pièce'::text;
  exception when others then
    if position('droit d''instruction' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q5c: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- Q6. AUCUNE écriture directe — la RPC reste la seule porte
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.request_attachments set compliance = 'conforme' where id = att_libre;
  get diagnostics v_int = row_count;
  if v_int <> 0 then
    v_fail := v_fail || 'Q6a: un agent a pu écrire compliance en DIRECT (policy UPDATE cliente ?)'::text; end if;

  begin
    perform public.form_attachment_requirements(snap -> 'form_schema', data_part);
    v_fail := v_fail || 'Q6b: le jumeau SQL du moteur est exécutable par un client'::text;
  exception when insufficient_privilege then null;
  when others then
    v_fail := v_fail || format('Q6b: refus inattendu (%s)', sqlerrm); end;

  begin
    perform public.request_pieces_blocking(req, snap -> 'form_schema', data_part);
    v_fail := v_fail || 'Q6c: request_pieces_blocking est exécutable par un client'::text;
  exception when insufficient_privilege then null;
  when others then
    v_fail := v_fail || format('Q6c: refus inattendu (%s)', sqlerrm); end;

  -- ==========================================================================
  -- Q7. La demande close ne se requalifie plus
  -- ==========================================================================
  execute 'reset role';
  update public.requests set status = 'en_instruction' where id = req;
  update public.requests set status = 'annulee', closure_motif = 'abandon' where id = req;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_instructeur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.qualify_request_attachment(att_libre, 'conforme');
    v_fail := v_fail || 'Q7a: pièce qualifiée sur une demande close'::text;
  exception when others then
    if position('demande est close' in sqlerrm) = 0 then
      v_fail := v_fail || format('Q7a: refus inattendu (%s)', sqlerrm); end if;
  end;

  -- ==========================================================================
  -- Q8. La cohérence est aussi tenue par la table (ceinture et bretelles)
  -- ==========================================================================
  execute 'reset role';
  begin
    update public.request_attachments set compliance_motif = 'illisible' where id = att_libre;
    v_fail := v_fail || 'Q8a: un motif sans verdict a été accepté'::text;
  exception when check_violation then null;
  when others then
    v_fail := v_fail || format('Q8a: refus inattendu (%s)', sqlerrm); end;
  begin
    update public.request_attachments
       set compliance = 'non_conforme', compliance_by = u_instructeur, compliance_at = now()
     where id = att_libre;
    v_fail := v_fail || 'Q8b: une non-conformité sans motif a été acceptée par la table'::text;
  exception when check_violation then null;
  when others then
    v_fail := v_fail || format('Q8b: refus inattendu (%s)', sqlerrm); end;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (qualification des pièces) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
