-- ============================================================================
-- Tests du doublage par e-mail et des préférences par canal.
--
-- Complète `notifications.test.sql` (production des cinq motifs, étanchéité) :
-- ici, on vérifie QUELS CANAUX sont servis et comment la boîte d'envoi se
-- comporte — réclamation atomique, règlement, temporisation, abandon.
--
-- ⚠️ Les préférences sont GLOBALES au compte (décision PO 2026-08-24) : la clé
-- est (user_id, kind), sans organisation. Un agent rattaché à plusieurs
-- collectivités règle ses notifications une seule fois.
--
-- Exécution : même motif que les autres tests du dossier — bloc DO dans un
-- contexte postgres en lecture-écriture (SQL editor du dashboard ; le MCP
-- execute_sql est en lecture seule → passer par apply_migration, l'échec final
-- VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_root      uuid := gen_random_uuid();
  s_voirie    uuid := gen_random_uuid();
  s_b         uuid := gen_random_uuid();   -- racine d'un SECOND tenant
  org1        uuid; org2 uuid;
  proc_d1     uuid := gen_random_uuid();
  proc_t2     uuid := gen_random_uuid();
  snap_d1     jsonb; snap_t2 jsonb;
  u_alex      uuid := gen_random_uuid();  -- l'auteur des gestes
  u_camille   uuid := gen_random_uuid();  -- l'affectataire, dont on règle les préférences
  u_dominique uuid := gen_random_uuid();  -- témoin du fan-out
  p_id        uuid;
  r1 uuid; r2 uuid; r3 uuid;
  v_fail  text[] := '{}';
  v_int   int;
  v_text  text;
  v_bool  boolean;
  v_rec   record;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,      'alex@mail.test',      now(), now()),
    (u_camille,   'camille@mail.test',   now(), now()),
    (u_dominique, 'dominique@mail.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Mail')
    returning id into org1;
  -- Camille est rattachée à DEUX collectivités : c'est ce qui permet de
  -- vérifier qu'une préférence vaut partout (T13bis).
  insert into public.organizations (socle_org_id, name) values (s_b, 'Second Tenant')
    returning id into org2;
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_alex, 'agent'), (org1, u_camille, 'agent'), (org1, u_dominique, 'agent'),
    (org2, u_alex, 'agent'), (org2, u_camille, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Mairie'), (org1, s_voirie, s_root, 'Voirie'),
    (org2, s_b, null, 'Second');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc_d1, org1, s_root, 'Voirie D1'), (proc_t2, org2, s_b, 'Démarche T2');
  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Voirie D1');
  snap_t2 := jsonb_build_object('id', proc_t2::text, 'name', 'Démarche T2');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Camille-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_camille);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Dominique-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_dominique);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  -- ==========================================================================
  -- 12. Aucune préférence → les deux canaux servis (fail OPEN)
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R1', proc_d1, snap_d1, s_voirie, u_camille) returning id into r1;

  select in_app, email_status into v_rec from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'assigned';
  if v_rec.in_app is distinct from true or v_rec.email_status is distinct from 'pending' then
    v_fail := v_fail || format('T12: défaut fail-open faux (in_app=%s, email=%s)',
                               v_rec.in_app, v_rec.email_status); end if;

  -- ==========================================================================
  -- 13. E-mail coupé → la ligne existe (volet), l'envoi est 'skipped'
  -- ==========================================================================
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_camille, '*', true, false);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R2', proc_d1, snap_d1, s_voirie, u_camille) returning id into r2;

  select in_app, email_status into v_rec from public.notifications
   where request_id = r2 and user_id = u_camille and kind = 'assigned';
  if v_rec.in_app is distinct from true or v_rec.email_status is distinct from 'skipped' then
    v_fail := v_fail || format('T13: e-mail coupé non respecté (in_app=%s, email=%s)',
                               v_rec.in_app, v_rec.email_status); end if;

  -- ==========================================================================
  -- 13bis. La MÊME préférence s'applique dans un AUTRE tenant
  -- (c'est tout l'objet de la bascule : on règle ses notifications une fois,
  --  pas une fois par collectivité de rattachement).
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org2, 'R-T2', proc_t2, snap_t2, s_b, u_camille);

  select in_app, email_status into v_rec from public.notifications
   where user_id = u_camille and payload ->> 'subject' = 'R-T2' and kind = 'assigned';
  if v_rec.email_status is distinct from 'skipped' then
    v_fail := v_fail || format('T13bis: la préférence NE SUIT PAS sur le second tenant (%s)',
                               v_rec.email_status); end if;

  -- ==========================================================================
  -- 14. In-app coupé, e-mail gardé → ligne MUETTE qui ne sert qu'à l'envoi
  -- ==========================================================================
  update public.notification_preferences set in_app = false, email = true
   where user_id = u_camille and kind = '*';

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R3', proc_d1, snap_d1, s_voirie, u_camille) returning id into r3;

  select in_app, email_status into v_rec from public.notifications
   where request_id = r3 and user_id = u_camille and kind = 'assigned';
  if v_rec.in_app is distinct from false or v_rec.email_status is distinct from 'pending' then
    v_fail := v_fail || format('T14: in-app coupé non respecté (in_app=%s, email=%s)',
                               v_rec.in_app, v_rec.email_status); end if;

  -- ==========================================================================
  -- 15. Les DEUX coupés → aucune ligne du tout (rien à dire, rien à envoyer)
  -- ==========================================================================
  update public.notification_preferences set in_app = false, email = false
   where user_id = u_camille and kind = '*';
  update public.requests set status = 'en_instruction' where id = r1;
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'status_changed';
  if v_int <> 0 then v_fail := v_fail || 'T15: ligne créée alors que TOUT est coupé'::text; end if;

  -- ==========================================================================
  -- 16. Une ligne de MOTIF surcharge le défaut '*'
  -- ==========================================================================
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_camille, 'note_added', true, true);
  insert into public.request_messages (organization_id, request_id, author_id, body)
    values (org1, r1, u_alex, 'Note.');
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_int <> 1 then v_fail := v_fail || format('T16: surcharge par motif ignorée (%s)', v_int); end if;

  -- ==========================================================================
  -- 17. Le fan-out respecte les préférences, pas seulement l'envoi unitaire
  -- ==========================================================================
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_dominique, '*', false, false);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id)
  values (org1, 'R4', proc_d1, snap_d1, s_voirie);
  select count(*) into v_int from public.notifications
   where user_id = u_dominique and payload ->> 'subject' = 'R4';
  if v_int <> 0 then v_fail := v_fail || format('T17: fan-out ignore les préférences (%s)', v_int); end if;

  -- ==========================================================================
  -- 18. Réclamation ATOMIQUE : une ligne réclamée n'est plus réclamable
  -- ==========================================================================
  delete from public.notification_preferences;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, assigned_to)
  values (org1, 'R5', proc_d1, snap_d1, s_voirie, u_camille);

  select count(*) into v_int from public.claim_notification_emails(50);
  if v_int = 0 then v_fail := v_fail || 'T18a: première réclamation vide'::text; end if;
  select count(*) into v_int from public.claim_notification_emails(50);
  if v_int <> 0 then
    v_fail := v_fail || format('T18b: DOUBLE réclamation possible (%s lignes) — deux mailers concurrents expédieraient deux fois', v_int); end if;
  select count(*) into v_int from public.notifications where email_status = 'sending';
  if v_int = 0 then v_fail := v_fail || 'T18c: rien n''est passé en sending'::text; end if;

  -- ==========================================================================
  -- 19. Règlement : succès · échec temporisé · abandon au-delà du plafond
  -- ==========================================================================
  select id into r2 from public.notifications where email_status = 'sending' limit 1;
  perform public.settle_notification_email(r2, true);
  select email_status into v_text from public.notifications where id = r2;
  if v_text <> 'sent' then v_fail := v_fail || format('T19a: succès non enregistré (%s)', v_text); end if;
  select count(*) into v_int from public.notifications
   where id = r2 and email_sent_at is not null and email_error is null and email_next_attempt_at is null;
  if v_int <> 1 then v_fail := v_fail || 'T19b: horodatage / erreur mal remis à zéro'::text; end if;

  select id into r3 from public.notifications where email_status = 'sending' limit 1;
  if r3 is null then
    v_fail := v_fail || 'T19c: décor insuffisant (pas de seconde ligne à régler)'::text;
  else
    perform public.settle_notification_email(r3, false, 'relais injoignable');
    select email_status into v_text from public.notifications where id = r3;
    if v_text <> 'pending' then
      v_fail := v_fail || format('T19c: échec non remis en file (%s)', v_text); end if;
    select email_next_attempt_at > now() into v_bool from public.notifications where id = r3;
    if v_bool is not true then
      v_fail := v_fail || 'T19d: échec remis en file SANS temporisation (réessai immédiat en boucle)'::text; end if;

    update public.notifications set email_attempts = public.notification_email_max_attempts()
     where id = r3;
    perform public.settle_notification_email(r3, false, 'relais toujours injoignable');
    select email_status into v_text from public.notifications where id = r3;
    if v_text <> 'failed' then
      v_fail := v_fail || format('T19e: abandon non déclenché après le plafond (%s)', v_text); end if;
  end if;

  -- ==========================================================================
  -- 20. La boîte d'envoi est hors de portée d'un client
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.claim_notification_emails(integer)', 'execute') then
    v_fail := v_fail || 'T20a: claim_notification_emails exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.settle_notification_email(uuid,boolean,text)', 'execute') then
    v_fail := v_fail || 'T20b: settle_notification_email exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.notification_channels_for(uuid,text)', 'execute') then
    v_fail := v_fail || 'T20c: notification_channels_for exécutable par authenticated'::text; end if;

  -- ==========================================================================
  -- 21. La préférence est le geste de son TITULAIRE — et de lui seul
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_camille, 'assigned', true, false);
  select count(*) into v_int from public.notification_preferences
   where user_id = u_camille and kind = 'assigned';
  if v_int <> 1 then v_fail := v_fail || 'T21a: un titulaire ne peut pas écrire SA préférence'::text; end if;

  begin
    insert into public.notification_preferences (user_id, kind, in_app, email)
      values (u_dominique, 'assigned', false, false);
    v_fail := v_fail || 'T21b: un client a pu écrire la préférence d''AUTRUI'::text;
  exception when others then null;   -- toute erreur vaut refus : c'est le but
  end;

  select count(*) into v_int from public.notification_preferences where user_id <> u_camille;
  if v_int <> 0 then v_fail := v_fail || 'T21c: FUITE — préférences d''autrui visibles'::text; end if;

  execute 'reset role';

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (notifications e-mail) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
