-- ============================================================================
-- Tests des notifications in-app — les cinq motifs, la règle « jamais pour son
-- propre geste », le périmètre d'instruction du fan-out, l'étanchéité RLS
-- (chacun ne voit que les siennes) et l'absence totale d'écriture cliente.
--
-- Exécution : même motif que les autres tests du dossier — bloc DO lancé dans
-- un contexte postgres en lecture-écriture (SQL editor du dashboard ; le MCP
-- execute_sql est en lecture seule → passer par apply_migration, l'échec final
-- VOLONTAIRE annule la transaction et empêche l'enregistrement de la migration).
--
-- Simulation d'identité : `set_config('request.jwt.claims', …)` seul suffit à
-- donner un `auth.uid()` à l'acteur SANS passer en rôle `authenticated` — les
-- gardes d'écriture de requests laissent alors passer le décor (contexte de
-- service), ce qui est exactement ce qu'on veut : on teste ici les TRIGGERS de
-- notification, pas les gardes d'écriture (couvertes par profils-droits.test.sql).
-- Les scénarios d'étanchéité, eux, passent bien en `set local role authenticated`.
-- ============================================================================

do $main$
declare
  s_root      uuid := gen_random_uuid();
  s_voirie    uuid := gen_random_uuid();
  s_ccas      uuid := gen_random_uuid();
  org1        uuid;
  proc_d1     uuid := gen_random_uuid();
  proc_d2     uuid := gen_random_uuid();
  snap_d1     jsonb;
  snap_d2     jsonb;
  -- Acteurs.
  u_alex      uuid := gen_random_uuid();  -- instruction Voirie D1 + D2 (l'auteur des gestes)
  u_camille   uuid := gen_random_uuid();  -- instruction Voirie D1 (l'affectataire)
  u_dominique uuid := gen_random_uuid();  -- instruction Voirie D1 (témoin du fan-out)
  u_lecteur   uuid := gen_random_uuid();  -- consultation SEULE sur D1 (ne doit RIEN recevoir)
  u_ccas      uuid := gen_random_uuid();  -- instruction CCAS D2 (hors périmètre de D1/Voirie)
  p_id        uuid;
  r1 uuid; r2 uuid; r3 uuid;
  v_fail  text[] := '{}';
  v_int   int;
  v_bool  boolean;
  v_text  text;
  v_json  jsonb;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,      'alex@notif.test',      now(), now()),
    (u_camille,   'camille@notif.test',   now(), now()),
    (u_dominique, 'dominique@notif.test', now(), now()),
    (u_lecteur,   'lecteur@notif.test',   now(), now()),
    (u_ccas,      'ccas@notif.test',      now(), now());
  -- Nom affichable : Camille a un état civil, Alex non (repli sur le courriel).
  update public.users set first_name = 'Camille', last_name = 'Martin' where id = u_camille;

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Notif')
    returning id into org1;

  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_alex, 'agent'), (org1, u_camille, 'agent'), (org1, u_dominique, 'agent'),
    (org1, u_lecteur, 'agent'), (org1, u_ccas, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root,   null,   'Mairie'),
    (org1, s_voirie, s_root, 'Voirie'),
    (org1, s_ccas,   s_root, 'CCAS');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name) values
    (proc_d1, org1, s_root, 'Signalement nid-de-poule'),
    (proc_d2, org1, s_root, 'Demande d''aide sociale');
  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement nid-de-poule');
  snap_d2 := jsonb_build_object('id', proc_d2::text, 'name', 'Demande d''aide sociale');

  -- Alex : instruction sur Voirie, D1 et D2.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Alex-Voirie-Instruction', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true), (p_id, proc_d2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_alex);

  -- Camille : instruction sur Voirie, D1 seulement.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Camille-Voirie-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_camille);

  -- Dominique : instruction sur Voirie, D1 seulement (témoin du fan-out).
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Dominique-Voirie-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_dominique);

  -- Lecteur : CONSULTATION seule sur D1 — le fan-out ne doit pas le toucher.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'Lecteur-D1', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
    values (p_id, proc_d1, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_lecteur);

  -- CCAS : instruction sur CCAS/D2 — hors du couple (Voirie, D1).
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (org1, 'CCAS-D2', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (org1, p_id, u_ccas);

  -- ==========================================================================
  -- 1. Création par Alex, affectée à Camille (couple Voirie / D1)
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, assigned_to)
  values (org1, 'Nid-de-poule rue des Lilas', proc_d1, snap_d1, s_voirie, 'Voirie',
          'Signalement nid-de-poule', u_camille)
  returning id into r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'assigned';
  if v_int <> 1 then v_fail := v_fail || format('T1a: affectataire — %s notif "assigned" au lieu de 1', v_int); end if;

  -- L'affectataire ne reçoit PAS en plus le fan-out : un geste, une notification.
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'new_request_in_scope';
  if v_int <> 0 then v_fail := v_fail || 'T1b: affectataire notifié DEUX fois (assigned + new_request_in_scope)'::text; end if;

  -- L'acteur ne se notifie jamais lui-même.
  select count(*) into v_int from public.notifications where request_id = r1 and user_id = u_alex;
  if v_int <> 0 then v_fail := v_fail || format('T1c: l''ACTEUR a reçu %s notification(s) pour son propre geste', v_int); end if;

  -- Dominique (instruction Voirie/D1) reçoit le fan-out.
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_dominique and kind = 'new_request_in_scope';
  if v_int <> 1 then v_fail := v_fail || format('T1d: témoin instruction — %s notif "new_request_in_scope" au lieu de 1', v_int); end if;

  -- Le lecteur (consultation SEULE) ne reçoit rien.
  select count(*) into v_int from public.notifications where request_id = r1 and user_id = u_lecteur;
  if v_int <> 0 then v_fail := v_fail || format('T1e: FUITE — consultation seule notifiée (%s)', v_int); end if;

  -- CCAS (autre couple) ne reçoit rien.
  select count(*) into v_int from public.notifications where request_id = r1 and user_id = u_ccas;
  if v_int <> 0 then v_fail := v_fail || format('T1f: FUITE — hors périmètre notifié (%s)', v_int); end if;

  -- Instantané : référence, objet, acteur figés dans le payload.
  select payload into v_json from public.notifications
   where request_id = r1 and user_id = u_dominique and kind = 'new_request_in_scope';
  if v_json ->> 'subject' <> 'Nid-de-poule rue des Lilas' then
    v_fail := v_fail || 'T1g: payload sans objet'::text; end if;
  if v_json ->> 'reference' is null then v_fail := v_fail || 'T1h: payload sans référence'::text; end if;
  if v_json ->> 'actor_name' <> 'alex@notif.test' then
    v_fail := v_fail || format('T1i: acteur mal résolu (%s) — repli courriel attendu', v_json ->> 'actor_name'); end if;

  -- ==========================================================================
  -- 2. Changement de statut par un TIERS → l'affectataire est prévenu
  -- ==========================================================================
  update public.requests set status = 'en_instruction' where id = r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'status_changed';
  if v_int <> 1 then v_fail := v_fail || format('T2a: %s notif "status_changed" au lieu de 1', v_int); end if;

  select payload into v_json from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'status_changed';
  if v_json ->> 'from' <> 'a_traiter' or v_json ->> 'to' <> 'en_instruction' then
    v_fail := v_fail || format('T2b: payload de transition faux (%s)', v_json::text); end if;

  -- ==========================================================================
  -- 3. Changement de statut par l'AFFECTATAIRE lui-même → silence
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  update public.requests set status = 'en_attente' where id = r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'status_changed'
     and payload ->> 'to' = 'en_attente';
  if v_int <> 0 then v_fail := v_fail || 'T3: l''affectataire est notifié de SON PROPRE changement de statut'::text; end if;

  -- ==========================================================================
  -- 4. Note interne — par un tiers, puis par l'affectataire
  -- ==========================================================================
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, 'Passage sur site prévu jeudi.');

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_int <> 1 then v_fail := v_fail || format('T4a: %s notif "note_added" au lieu de 1', v_int); end if;

  -- Le CORPS de la note ne doit JAMAIS entrer dans le payload (invariant :
  -- les notes internes ne quittent pas Iris — on annonce, on ne recopie pas).
  select payload::text into v_text from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_text like '%Passage sur site%' then
    v_fail := v_fail || 'T4b: le CORPS de la note interne a fuité dans le payload'::text; end if;

  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_camille, 'Note écrite par l''affectataire lui-même.');
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'note_added';
  if v_int <> 1 then v_fail := v_fail || format('T4c: notifié de SA PROPRE note (%s notif au total)', v_int); end if;

  -- ==========================================================================
  -- 5. Désaffectation — par un tiers, puis auto-désaffectation
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  update public.requests set assigned_to = null where id = r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'unassigned';
  if v_int <> 1 then v_fail := v_fail || format('T5a: %s notif "unassigned" au lieu de 1', v_int); end if;

  select payload into v_json from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'unassigned';
  if (v_json ->> 'reassigned')::boolean is distinct from false then
    v_fail := v_fail || 'T5b: "reassigned" devrait être faux (retrait sec)'::text; end if;

  -- Auto-désaffectation : Camille se réaffecte puis se retire elle-même.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  update public.requests set assigned_to = u_camille where id = r1;
  update public.requests set assigned_to = null      where id = r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind in ('assigned','unassigned');
  if v_int <> 2 then
    v_fail := v_fail || format('T5c: auto-affectation/désaffectation notifiée — %s lignes au lieu des 2 initiales', v_int); end if;

  -- ==========================================================================
  -- 6. Réaffectation d'un tiers à un autre : l'ancien ET le nouveau sont servis
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  update public.requests set assigned_to = u_camille   where id = r1;
  update public.requests set assigned_to = u_dominique where id = r1;

  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_dominique and kind = 'assigned';
  if v_int <> 1 then v_fail := v_fail || format('T6a: nouveau destinataire — %s notif "assigned" au lieu de 1', v_int); end if;
  select count(*) into v_int from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'unassigned';
  if v_int <> 2 then v_fail := v_fail || format('T6b: ancien destinataire — %s notif "unassigned" au lieu de 2', v_int); end if;
  select payload into v_json from public.notifications
   where request_id = r1 and user_id = u_camille and kind = 'unassigned'
   order by created_at desc limit 1;
  if (v_json ->> 'reassigned')::boolean is distinct from true then
    v_fail := v_fail || 'T6c: "reassigned" devrait être vrai (passage de main)'::text; end if;

  -- ==========================================================================
  -- 7. Ingestion (aucun acteur : auth.uid() NULL) → tout le périmètre est servi
  -- ==========================================================================
  perform set_config('request.jwt.claims', '', true);
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, source)
  values (org1, 'Demande ingérée depuis Clara', proc_d1, snap_d1, s_voirie, 'Voirie', 'iris')
  returning id into r2;

  select count(*) into v_int from public.notifications
   where request_id = r2 and kind = 'new_request_in_scope';
  if v_int <> 3 then
    v_fail := v_fail || format('T7a: ingestion — %s destinataires au lieu de 3 (alex, camille, dominique)', v_int); end if;
  select count(*) into v_int from public.notifications
   where request_id = r2 and user_id in (u_lecteur, u_ccas);
  if v_int <> 0 then v_fail := v_fail || 'T7b: FUITE — ingestion notifiée hors périmètre d''instruction'::text; end if;
  select payload ->> 'actor_name' into v_text from public.notifications
   where request_id = r2 limit 1;
  if v_text is not null then v_fail := v_fail || 'T7c: un acteur a été inventé pour une demande ingérée'::text; end if;

  -- ==========================================================================
  -- 8. Périmètre : une demande d'un AUTRE couple (CCAS / D2)
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (org1, 'Aide sociale', proc_d2, snap_d2, s_ccas, 'CCAS')
  returning id into r3;

  select count(*) into v_int from public.notifications
   where request_id = r3 and user_id = u_ccas and kind = 'new_request_in_scope';
  if v_int <> 1 then v_fail := v_fail || format('T8a: instructeur CCAS/D2 non notifié (%s)', v_int); end if;
  select count(*) into v_int from public.notifications
   where request_id = r3 and user_id in (u_camille, u_dominique, u_lecteur);
  if v_int <> 0 then v_fail := v_fail || format('T8b: FUITE — %s notification(s) hors du couple (CCAS, D2)', v_int); end if;

  -- ==========================================================================
  -- 9. Étanchéité RLS — chacun ne voit QUE les siennes
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.notifications where user_id <> u_camille;
  if v_int <> 0 then v_fail := v_fail || format('T9a: FUITE RLS — %s notification(s) d''autrui visibles', v_int); end if;
  select count(*) into v_int from public.notifications;
  if v_int = 0 then v_fail := v_fail || 'T9b: Camille ne voit AUCUNE de ses propres notifications'::text; end if;

  -- Aucune écriture cliente : ni fabrication, ni retouche, ni suppression.
  begin
    insert into public.notifications (organization_id, user_id, request_id, kind)
    values (org1, u_dominique, r1, 'assigned');
    v_fail := v_fail || 'T9c: un client a pu FABRIQUER une notification pour autrui'::text;
  exception when others then null;   -- toute erreur vaut refus : c'est le but
  end;

  update public.notifications set read_at = now() where user_id = u_camille;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || format('T9d: UPDATE client direct a touché %s ligne(s)', v_int); end if;

  delete from public.notifications where user_id = u_camille;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || format('T9e: DELETE client direct a touché %s ligne(s)', v_int); end if;

  -- Les fonctions internes ne sont pas appelables par un client.
  if has_function_privilege('authenticated',
       'public.push_notification(uuid,uuid,uuid,uuid,text,text,text,jsonb)', 'execute') then
    v_fail := v_fail || 'T9f: push_notification est exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated',
       'public.can_process_request_for(uuid,uuid,uuid,uuid)', 'execute') then
    v_fail := v_fail || 'T9g: can_process_request_for est exécutable par authenticated'::text; end if;

  -- ==========================================================================
  -- 10. Accusé de lecture — RPC, et seulement sur SES lignes
  -- ==========================================================================
  select count(*) into v_int from public.notifications where user_id = u_camille and read_at is null;
  if v_int = 0 then v_fail := v_fail || 'T10a: décor sans notification non lue'::text; end if;

  select public.mark_all_notifications_read(org1) into v_int;
  if v_int = 0 then v_fail := v_fail || 'T10b: mark_all_notifications_read n''a rien marqué'::text; end if;
  select count(*) into v_int from public.notifications where user_id = u_camille and read_at is null;
  if v_int <> 0 then v_fail := v_fail || format('T10c: %s notification(s) encore non lues après le marquage', v_int); end if;

  execute 'reset role';
  -- Les notifications d'autrui n'ont pas été touchées par ce marquage.
  select count(*) into v_int from public.notifications
   where user_id = u_dominique and read_at is not null;
  if v_int <> 0 then v_fail := v_fail || format('T10d: FUITE — %s notification(s) d''autrui marquées lues', v_int); end if;

  -- Marquage ciblé : l'identifiant d'autrui est ignoré silencieusement.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_dominique, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.mark_notifications_read(
           array(select id from public.notifications where user_id = u_dominique limit 1))
    into v_int;
  if v_int <> 1 then v_fail := v_fail || format('T10e: marquage ciblé — %s ligne(s) au lieu de 1', v_int); end if;
  execute 'reset role';

  -- Identité JWT toujours Dominique, lignes visées : les NON LUES d'Alex
  -- (ingestion T7). Le filtre `user_id = auth.uid()` de la RPC doit tout écarter.
  select public.mark_notifications_read(
           array(select id from public.notifications where user_id = u_alex and read_at is null))
    into v_int;
  if v_int <> 0 then
    v_fail := v_fail || format('T10f: marquage des notifications d''AUTRUI — %s ligne(s) touchée(s)', v_int); end if;

  -- ==========================================================================
  -- 11. Temps réel — la table est bien publiée
  -- ==========================================================================
  select exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'notifications')
    into v_bool;
  if not v_bool then v_fail := v_fail || 'T11: notifications absente de la publication supabase_realtime'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (notifications) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
