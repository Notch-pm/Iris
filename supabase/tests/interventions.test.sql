-- ============================================================================
-- Tests des INTERVENTIONS (migration 20260914100000).
--
--   1. Un profil « Intervenant » sans droit est VALIDE ; un profil ordinaire
--      sans droit ne l'est toujours pas (forme).
--   2. `eligible_intervenants` : profil actif is_intervenant, périmètre en
--      sous-arbre ; un intervenant d'un autre service n'y est pas.
--   3. `request_intervention` : refusée hors instruction, sans le droit
--      d'instruction, pour un non-intervenant, à une date passée, sans
--      commentaire, en doublon ; acceptée sinon — journal + notification
--      `intervention_requested` (in_app, e-mail en attente, payload
--      : jour, commentaire, JAMAIS le demandeur).
--   4. VISIBILITÉ : avant la sollicitation l'intervenant ne voit pas la demande ;
--      après, il la voit, ainsi que le journal et les pièces — mais NI les notes
--      internes NI les échanges (`can_consult_request`). L'agent, lui, voit tout.
--   5. `complete_request_intervention` : refusée à un tiers, à une date future,
--      deux fois ; acceptée par l'intervenant — journal + notification
--      `intervention_completed` à l'agent qui a sollicité ET à l'affectataire,
--      jamais à l'intervenant (acteur).
--   6. Aucune écriture cliente sur `request_interventions`.
--   7. JUSTIFICATIFS (second lot) : quatre au plus, consommés depuis la zone
--      d'attente (déposant = l'intervenant), rattachés à l'intervention avec
--      `kind = intervention`, lisibles par l'intervenant comme par l'agent ; un
--      refus annule toute la déclaration.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root    uuid := gen_random_uuid();
  s_voirie  uuid := gen_random_uuid();
  s_ccas    uuid := gen_random_uuid();
  orgA      uuid;
  proc      uuid := gen_random_uuid();
  snap      jsonb;
  u_alex    uuid := gen_random_uuid();  -- instruction Voirie (celui qui sollicite)
  u_camille uuid := gen_random_uuid();  -- instruction Voirie (l'affectataire)
  u_sam     uuid := gen_random_uuid();  -- INTERVENANT Voirie (profil is_intervenant, aucun droit)
  u_lea     uuid := gen_random_uuid();  -- intervenant CCAS seulement
  u_lecteur uuid := gen_random_uuid();  -- consultation seule Voirie
  p_id      uuid;
  req       uuid;
  req_at    uuid;   -- demande « à traiter »
  v_inter   uuid;
  v_fail    text[] := '{}';
  v_int     int;
  v_json    jsonb;
  v_text    text;
  v_today   date := (now() at time zone 'Europe/Paris')::date;  -- paris_today() est interne (révoquée d'authenticated)
  up_p1     uuid; up_p2 uuid; up_alex uuid;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,    'alex@interv.test',    now(), now()),
    (u_camille, 'camille@interv.test', now(), now()),
    (u_sam,     'sam@interv.test',     now(), now()),
    (u_lea,     'lea@interv.test',     now(), now()),
    (u_lecteur, 'lecteur@interv.test', now(), now());
  update public.users set first_name = 'Sam', last_name = 'Ouvrier' where id = u_sam;
  update public.users set first_name = 'Alex', last_name = 'Dupont' where id = u_alex;

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Interv')
    returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_alex, 'agent'), (orgA, u_camille, 'agent'), (orgA, u_sam, 'agent'),
    (orgA, u_lea, 'agent'), (orgA, u_lecteur, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,   null,   'Mairie'),
    (orgA, s_voirie, s_root, 'Voirie'),
    (orgA, s_ccas,   s_root, 'CCAS');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement nid-de-poule');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement nid-de-poule');
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_root);

  -- Alex et Camille : instruction Voirie.
  insert into public.permission_profiles (organization_id, name) values (orgA, 'Instruction-Voirie')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_alex), (orgA, p_id, u_camille);

  -- Lecteur : consultation seule Voirie.
  insert into public.permission_profiles (organization_id, name) values (orgA, 'Lecture-Voirie')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_lecteur);

  -- ==========================================================================
  -- T1. Forme d'un profil : « Intervenant » sans droit est valide
  -- ==========================================================================
  insert into public.permission_profiles (organization_id, name, is_intervenant)
    values (orgA, 'Intervenant-Voirie', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_sam);
  begin
    perform public.validate_permission_profile_shape(p_id);
  exception when others then
    v_fail := v_fail || format('T1a: profil intervenant sans droit refuse - %s', sqlerrm);
  end;

  insert into public.permission_profiles (organization_id, name) values (orgA, 'Vide')
    returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  begin
    perform public.validate_permission_profile_shape(p_id);
    v_fail := v_fail || 'T1b: un profil ordinaire sans droit a ete accepte'::text;
  exception when others then
    if sqlerrm not like '%aucun droit%' then
      v_fail := v_fail || format('T1b: message inattendu - %s', sqlerrm); end if;
  end;
  delete from public.permission_profiles where name = 'Vide' and organization_id = orgA;

  -- Léa : intervenante au CCAS seulement.
  insert into public.permission_profiles (organization_id, name, is_intervenant)
    values (orgA, 'Intervenant-CCAS', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_lea);

  -- Décor : deux demandes Voirie, l'une en instruction (affectée à Camille),
  -- l'autre à traiter. Créées par Alex.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, assigned_to, status, received_at,
                               requester_snapshot)
  values (orgA, 'Nid-de-poule rue des Lilas', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', u_camille, 'a_traiter', '2026-03-12T09:30:00Z',
          jsonb_build_object('last_name', 'Usager', 'first_name', 'Jean'))
  returning id into req;
  update public.requests set status = 'en_instruction' where id = req;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values (orgA, 'Lampadaire en panne', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', '2026-03-13T09:30:00Z')
  returning id into req_at;

  insert into public.request_messages (organization_id, request_id, author_id, body)
    values (orgA, req, u_alex, 'Note interne SECRETE');
  insert into public.request_events (organization_id, request_id, event_type, payload, created_by)
    values (orgA, req, 'created', '{}'::jsonb, u_alex);

  -- ==========================================================================
  -- T2. eligible_intervenants — Sam oui, Léa non (CCAS), Alex non (pas intervenant)
  -- ==========================================================================
  select count(*) into v_int from public.eligible_intervenants(req) e where e.user_id = u_sam;
  if v_int <> 1 then v_fail := v_fail || 'T2a: Sam absent des intervenants eligibles'::text; end if;
  select count(*) into v_int from public.eligible_intervenants(req) e where e.user_id in (u_lea, u_alex, u_lecteur);
  if v_int <> 0 then v_fail := v_fail || 'T2b: un non-intervenant Voirie est propose'::text; end if;

  -- ==========================================================================
  -- T3. request_intervention — gardes
  -- ==========================================================================
  execute 'set local role authenticated';

  -- Hors instruction.
  begin
    perform public.request_intervention(req_at, u_sam, v_today, 'Voir');
    v_fail := v_fail || 'T3a: sollicitation acceptee hors instruction'::text;
  exception when others then
    if sqlerrm not like '%en cours d''instruction%' then
      v_fail := v_fail || format('T3a: message inattendu - %s', sqlerrm); end if;
  end;

  -- Non-intervenant.
  begin
    perform public.request_intervention(req, u_lea, v_today, 'Voir');
    v_fail := v_fail || 'T3b: sollicitation acceptee pour un intervenant d''un autre service'::text;
  exception when others then
    if sqlerrm not like '%pas intervenant%' then
      v_fail := v_fail || format('T3b: message inattendu - %s', sqlerrm); end if;
  end;

  -- Date passée.
  begin
    perform public.request_intervention(req, u_sam, v_today - 1, 'Voir');
    v_fail := v_fail || 'T3c: date passee acceptee'::text;
  exception when others then
    if sqlerrm not like '%passée%' then
      v_fail := v_fail || format('T3c: message inattendu - %s', sqlerrm); end if;
  end;

  -- Commentaire vide.
  begin
    perform public.request_intervention(req, u_sam, v_today, '   ');
    v_fail := v_fail || 'T3d: commentaire vide accepte'::text;
  exception when others then
    if sqlerrm not like '%attendu%' then
      v_fail := v_fail || format('T3d: message inattendu - %s', sqlerrm); end if;
  end;

  -- Lecteur (consultation seule) : refusé.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_lecteur, 'role', 'authenticated')::text, true);
  begin
    perform public.request_intervention(req, u_sam, v_today, 'Voir');
    v_fail := v_fail || 'T3e: un lecteur a pu solliciter'::text;
  exception when others then
    if sqlerrm not like '%droit d''instruction%' then
      v_fail := v_fail || format('T3e: message inattendu - %s', sqlerrm); end if;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- T4. Visibilité AVANT : Sam ne voit pas la demande
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = req;
  if v_int <> 0 then v_fail := v_fail || 'T4a: Sam voit une demande sans sollicitation'::text; end if;
  execute 'reset role';

  -- ==========================================================================
  -- T5. Sollicitation acceptée (Alex) — ligne, journal, notification
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select (public.request_intervention(req, u_sam, v_today + 3,
              'Sécuriser la zone et reboucher.') ->> 'id')::uuid into v_inter;
  exception when others then
    v_fail := v_fail || format('T5a: sollicitation legitime refusee - %s', sqlerrm);
  end;
  -- Doublon en attente.
  begin
    perform public.request_intervention(req, u_sam, v_today + 5, 'Encore');
    v_fail := v_fail || 'T5b: doublon en attente accepte'::text;
  exception when others then
    if sqlerrm not like '%déjà une intervention en attente%' then
      v_fail := v_fail || format('T5b: message inattendu - %s', sqlerrm); end if;
  end;
  execute 'reset role';

  select count(*) into v_int from public.request_interventions
   where id = v_inter and status = 'demandee' and requested_by = u_alex and intervenant_id = u_sam;
  if v_int <> 1 then v_fail := v_fail || 'T5c: ligne d''intervention absente ou incorrecte'::text; end if;

  select count(*) into v_int from public.request_events
   where request_id = req and event_type = 'intervention_requested'
     and (payload ->> 'intervention_id')::uuid = v_inter
     and payload ->> 'intervenant_name' = 'Sam Ouvrier';
  if v_int <> 1 then v_fail := v_fail || 'T5d: journal intervention_requested absent'::text; end if;

  select payload into v_json from public.notifications
   where request_id = req and user_id = u_sam and kind = 'intervention_requested'
     and in_app and email_status = 'pending';
  if v_json is null then
    v_fail := v_fail || 'T5e: notification intervention_requested absente pour Sam'::text;
  else
    if v_json ->> 'comment' <> 'Sécuriser la zone et reboucher.' then
      v_fail := v_fail || 'T5f: le commentaire manque au payload'::text; end if;
    if v_json ->> 'requested_for' is null then
      v_fail := v_fail || 'T5g: le jour souhaite manque au payload'::text; end if;
    if v_json ->> 'actor_name' <> 'Alex Dupont' then
      v_fail := v_fail || 'T5h: acteur incorrect'::text; end if;
    if v_json::text like '%Usager%' then
      v_fail := v_fail || 'T5i: le demandeur figure au payload'::text; end if;
  end if;
  select count(*) into v_int from public.notifications
   where request_id = req and kind = 'intervention_requested' and user_id <> u_sam;
  if v_int <> 0 then v_fail := v_fail || 'T5j: quelqu''un d''autre que Sam a ete notifie'::text; end if;

  -- ==========================================================================
  -- T6. Visibilité APRÈS : Sam voit la demande, le journal, mais ni notes ni échanges
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = req;
  if v_int <> 1 then v_fail := v_fail || 'T6a: Sam ne voit pas la demande apres sollicitation'::text; end if;
  select count(*) into v_int from public.requests where id = req_at;
  if v_int <> 0 then v_fail := v_fail || 'T6b: Sam voit une autre demande du service'::text; end if;
  select count(*) into v_int from public.request_events where request_id = req;
  if v_int < 1 then v_fail := v_fail || 'T6c: Sam ne voit pas le journal'::text; end if;
  select count(*) into v_int from public.request_interventions where request_id = req;
  if v_int <> 1 then v_fail := v_fail || 'T6d: Sam ne voit pas sa sollicitation'::text; end if;
  select count(*) into v_int from public.request_messages where request_id = req;
  if v_int <> 0 then v_fail := v_fail || 'T6e: Sam voit les NOTES INTERNES'::text; end if;
  select count(*) into v_int from public.request_emails where request_id = req;
  if v_int <> 0 then v_fail := v_fail || 'T6f: Sam voit les echanges'::text; end if;
  if not public.can_read_request(req) then v_fail := v_fail || 'T6g: can_read_request faux pour Sam'::text; end if;
  if public.can_consult_request(req) then v_fail := v_fail || 'T6h: can_consult_request VRAI pour Sam'::text; end if;
  -- Aucune écriture cliente.
  begin
    update public.request_interventions set status = 'realisee' where id = v_inter;
    select count(*) into v_int from public.request_interventions where id = v_inter and status = 'realisee';
    if v_int <> 0 then v_fail := v_fail || 'T6i: UPDATE client passe sur request_interventions'::text; end if;
  exception when others then null;  -- un refus franc vaut aussi
  end;
  begin
    insert into public.request_interventions (organization_id, request_id, intervenant_id, requested_for, request_comment)
      values (orgA, req_at, u_sam, v_today, 'auto-sollicitation');
    v_fail := v_fail || 'T6j: INSERT client passe sur request_interventions'::text;
  exception when others then null;
  end;
  execute 'reset role';

  -- L'agent, lui, voit tout (les notes comprises).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_messages where request_id = req;
  if v_int <> 1 then v_fail := v_fail || 'T6k: l''agent ne voit plus les notes'::text; end if;
  execute 'reset role';

  -- ==========================================================================
  -- T7. complete_request_intervention — gardes puis succès
  -- ==========================================================================
  -- Un tiers (Camille, affectataire) ne peut pas déclarer à la place de Sam.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.complete_request_intervention(v_inter, v_today, null);
    v_fail := v_fail || 'T7a: un tiers a declare l''intervention realisee'::text;
  exception when others then
    if sqlerrm not like '%Seul l''intervenant%' then
      v_fail := v_fail || format('T7a: message inattendu - %s', sqlerrm); end if;
  end;
  execute 'reset role';

  -- Justificatifs (second lot, décor posé HORS RLS, avant de reprendre l'identité de Sam) : deux pièces reçues par la porte unique POUR
  -- cette demande PAR Sam, une pièce reçue par Alex (refusée : autre déposant),
  -- et cinq identifiants (refusés : quatre au plus).
  insert into public.attachment_uploads (organization_id, scope_request_id, uploaded_by, storage_path,
    file_name, mime_type, file_size, checksum, expires_at) values
    (orgA, req, u_sam,  orgA || '/' || req || '/p1-photo.jpg', 'photo-1.jpg', 'image/jpeg', 1000, 'p1', now() + interval '1 day'),
    (orgA, req, u_sam,  orgA || '/' || req || '/p2-photo.jpg', 'photo-2.jpg', 'image/jpeg', 2000, 'p2', now() + interval '1 day'),
    (orgA, req, u_alex, orgA || '/' || req || '/p3-alex.pdf',  'alex.pdf',    'application/pdf', 300, 'p3', now() + interval '1 day');
  select id into up_p1   from public.attachment_uploads where checksum = 'p1';
  select id into up_p2   from public.attachment_uploads where checksum = 'p2';
  select id into up_alex from public.attachment_uploads where checksum = 'p3';

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.complete_request_intervention(v_inter, v_today + 1, null);
    v_fail := v_fail || 'T7b: date future acceptee'::text;
  exception when others then
    if sqlerrm not like '%future%' then
      v_fail := v_fail || format('T7b: message inattendu - %s', sqlerrm); end if;
  end;
  begin
    perform public.complete_request_intervention(v_inter, v_today, 'x',
      array[up_p1, up_p2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]);
    v_fail := v_fail || 'T7k: cinq justificatifs acceptes'::text;
  exception when others then
    if sqlerrm not like '%Au plus 4 justificatifs%' then
      v_fail := v_fail || format('T7k: message inattendu - %s', sqlerrm); end if;
  end;
  begin
    perform public.complete_request_intervention(v_inter, v_today, 'x', array[up_alex]);
    v_fail := v_fail || 'T7l: la piece d''un autre deposant a ete rattachee'::text;
  exception when others then
    if sqlerrm not like '%autre déposant%' then
      v_fail := v_fail || format('T7l: message inattendu - %s', sqlerrm); end if;
  end;
  -- Le refus a bien annulé la déclaration : toujours à réaliser.
  execute 'reset role';
  select count(*) into v_int from public.request_interventions where id = v_inter and status = 'demandee';
  if v_int <> 1 then v_fail := v_fail || 'T7m: un refus de justificatif n''a pas annule la declaration'::text; end if;
  execute 'set local role authenticated';
  begin
    select public.complete_request_intervention(v_inter, v_today, 'Rebouché.', array[up_p1, up_p2, up_p1]) into v_json;
    if (v_json ->> 'attachments')::int <> 2 then
      v_fail := v_fail || format('T7c: 2 justificatifs attendus, %s rendus', v_json ->> 'attachments'); end if;
  exception when others then
    v_fail := v_fail || format('T7c: declaration legitime refusee - %s', sqlerrm);
  end;
  begin
    perform public.complete_request_intervention(v_inter, v_today, 'Encore');
    v_fail := v_fail || 'T7d: double declaration acceptee'::text;
  exception when others then
    if sqlerrm not like '%déjà déclarée%' then
      v_fail := v_fail || format('T7d: message inattendu - %s', sqlerrm); end if;
  end;
  -- Sam voit encore la demande, réalisée comprise.
  select count(*) into v_int from public.requests where id = req;
  if v_int <> 1 then v_fail := v_fail || 'T7e: Sam a perdu la demande apres realisation'::text; end if;
  execute 'reset role';

  select count(*) into v_int from public.request_interventions
   where id = v_inter and status = 'realisee' and completed_on = v_today
     and completion_comment = 'Rebouché.' and completed_at is not null;
  if v_int <> 1 then v_fail := v_fail || 'T7f: ligne non passee a realisee'::text; end if;
  select count(*) into v_int from public.request_events
   where request_id = req and event_type = 'intervention_completed'
     and (payload ->> 'intervention_id')::uuid = v_inter
     and (payload ->> 'attachments')::int = 2;
  if v_int <> 1 then v_fail := v_fail || 'T7g: journal intervention_completed absent (ou sans le compte de justificatifs)'::text; end if;
  -- Les deux justificatifs : kind = intervention, rattachés à l'intervention,
  -- déposés par Sam, uploads consommés — et lisibles par Sam ET par Alex.
  select count(*) into v_int from public.request_attachments a
   where a.request_id = req and a.kind = 'intervention' and a.intervention_id = v_inter
     and a.uploaded_by = u_sam and a.copy_status = 'copied';
  if v_int <> 2 then v_fail := v_fail || format('T7n: %s justificatif(s) rattaches au lieu de 2', v_int); end if;
  select count(*) into v_int from public.attachment_uploads
   where id in (up_p1, up_p2) and consumed_at is not null and request_attachment_id is not null;
  if v_int <> 2 then v_fail := v_fail || 'T7o: uploads non consommes'::text; end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_attachments where intervention_id = v_inter;
  if v_int <> 2 then v_fail := v_fail || 'T7p: Sam ne relit pas ses justificatifs'::text; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_attachments where intervention_id = v_inter;
  if v_int <> 2 then v_fail := v_fail || 'T7q: l''agent ne voit pas les justificatifs'::text; end if;
  execute 'reset role';

  -- Notifiés : Alex (a sollicité) et Camille (affectataire). Jamais Sam.
  select count(*) into v_int from public.notifications
   where request_id = req and kind = 'intervention_completed' and user_id = u_alex
     and payload ->> 'intervenant_name' = 'Sam Ouvrier' and payload ->> 'comment' = 'Rebouché.'
     and (payload ->> 'attachments')::int = 2;
  if v_int <> 1 then v_fail := v_fail || 'T7h: Alex non notifie de la realisation (ou sans le compte de justificatifs)'::text; end if;
  select count(*) into v_int from public.notifications
   where request_id = req and kind = 'intervention_completed' and user_id = u_camille;
  if v_int <> 1 then v_fail := v_fail || 'T7i: l''affectataire non notifie'::text; end if;
  select count(*) into v_int from public.notifications
   where request_id = req and kind = 'intervention_completed' and user_id = u_sam;
  if v_int <> 0 then v_fail := v_fail || 'T7j: l''intervenant notifie de son propre geste'::text; end if;

  -- ==========================================================================
  -- T8. my_rights expose l'attribut
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_sam, 'role', 'authenticated')::text, true);
  select public.my_rights(orgA) into v_json;
  if (v_json ->> 'is_intervenant')::boolean is distinct from true then
    v_fail := v_fail || 'T8a: my_rights.is_intervenant faux pour Sam'::text; end if;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  select public.my_rights(orgA) into v_json;
  if (v_json ->> 'is_intervenant')::boolean is distinct from false then
    v_fail := v_fail || 'T8b: my_rights.is_intervenant vrai pour Alex'::text; end if;

  -- ==========================================================================
  -- VERDICT — l'exception annule TOUT (aucune donnée conservée)
  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (interventions, T1–T8, justificatifs compris) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
