-- ============================================================================
-- Tests du TRANSFERT vers un autre organisme responsable
-- (migrations 20260901100000 et 20260901110000).
--
--   0. Le geste passe par la RPC `transfer_request` — UNIQUE porte. Un UPDATE
--      client de `socle_organization_id` est refusé par le RLS (42501) dès que
--      la cible sort du périmètre de l'auteur, ce qui est PRÉCISÉMENT le geste
--      RM-19. Voir l'en-tête de 20260901110000 pour les sondes.
--   1. Le LIBELLÉ vient du miroir, jamais du client (t08).
--   2. L'AFFECTATION ne survit pas au transfert quand l'agent ne peut pas
--      instruire le couple d'arrivée — et survit quand il le peut (t08).
--   3. L'organisme cible doit AVOIR LA DÉMARCHE ACTIVÉE (t12) ; une demande
--      HISTORIQUE sans démarche échappe à ce contrôle.
--   4. Le JOURNAL porte `transferred`, avec les deux libellés et le sort de
--      l'affectation (t30).
--   5. La NOTIFICATION `transferred_in` part vers les agents qui instruisent
--      le couple d'ARRIVÉE — jamais vers ceux du seul couple de départ, jamais
--      vers l'auteur du geste (t40).
--   6. Le DROIT porte sur le couple ACTUEL, jamais sur la cible.
--
-- ⚠️ **L'ACTEUR COMPTE, ET IL CHANGE.** Le droit de transférer s'évalue sur le
-- couple où la demande se trouve À CET INSTANT : un agent qui vient de céder
-- une demande ne peut plus la reprendre. Les allers-retours du décor sont donc
-- faits par `u_large` (périmètre sur la racine, donc les deux services), et
-- l'identité est repositionnée explicitement avant chaque scénario. C'est ce
-- que le premier jet de ce test ignorait — et la RPC le lui a rappelé.
--
-- ⚠️ Chaque refus vérifie le MESSAGE de l'erreur, jamais `exception when
-- others then null`.
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
  s_etatciv uuid := gen_random_uuid();  -- n'assure PAS la démarche
  orgA      uuid;
  proc      uuid := gen_random_uuid();
  snap      jsonb;
  -- Acteurs.
  u_alex    uuid := gen_random_uuid();  -- instruction Voirie SEULE (celui qui cède)
  u_camille uuid := gen_random_uuid();  -- instruction Voirie SEULE (l'affectataire)
  u_large   uuid := gen_random_uuid();  -- instruction sur la RACINE, donc partout
  u_ccas    uuid := gen_random_uuid();  -- instruction CCAS seule (celui qui hérite)
  p_id      uuid;
  req uuid; req_libre uuid; req_garde uuid; req_notif uuid;
  v_fail  text[] := '{}';
  v_int   int;
  v_text  text;
  v_uuid  uuid;
  v_json  jsonb;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_alex,    'alex@transfert.test',    now(), now()),
    (u_camille, 'camille@transfert.test', now(), now()),
    (u_large,   'large@transfert.test',   now(), now()),
    (u_ccas,    'ccas@transfert.test',    now(), now());
  update public.users set first_name = 'Camille', last_name = 'Martin' where id = u_camille;

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Transfert')
    returning id into orgA;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_alex, 'agent'), (orgA, u_camille, 'agent'),
    (orgA, u_large, 'agent'), (orgA, u_ccas, 'agent');

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_root,    null,   'Mairie'),
    (orgA, s_voirie,  s_root, 'Voirie'),
    (orgA, s_ccas,    s_root, 'CCAS'),
    (orgA, s_etatciv, s_root, 'Etat civil');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc, orgA, s_root, 'Signalement nid-de-poule');
  snap := jsonb_build_object('id', proc::text, 'name', 'Signalement nid-de-poule');

  -- La démarche est activée à la Voirie, au CCAS et à la racine — PAS à l'État
  -- civil (opt-in strict : l'absence de ligne vaut « cet organisme ne l'assure
  -- pas »).
  insert into public.socle_procedure_organizations (organization_id, socle_procedure_id, socle_org_id)
    values (orgA, proc, s_voirie), (orgA, proc, s_ccas), (orgA, proc, s_root);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Alex-Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_alex);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Camille-Voirie', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_camille);

  -- ⚠️ `default_view`/`default_process` ne sont pas un détail de décor : ce sont
  -- eux qui portent les droits sur les démarches NON LISTÉES (RM-33), donc sur
  -- la pseudo-démarche « sans démarche » (RM-36) que T4 met en scène. Sans eux,
  -- u_large ne peut pas transférer une demande historique — *fail closed*, et
  -- c'est la bonne règle : le premier jet de ce test l'avait oublié.
  insert into public.permission_profiles (organization_id, name, is_admin, default_view, default_process)
    values (orgA, 'Large-Mairie', false, true, true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_large);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'CCAS-instruction', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_ccas);

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, assigned_to, received_at)
  values (orgA, 'Nid-de-poule rue des Lilas', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', u_camille, '2026-03-12T09:30:00Z')
  returning id into req;

  -- ==========================================================================
  -- T1. La RPC rend ce que le SERVEUR a décidé, et le libellé vient du miroir
  -- ==========================================================================
  -- La RPC ne prend QUE l'identifiant : le libellé n'est même pas une entrée
  -- possible, donc aucun client ne peut faire mentir la destination.
  v_json := public.transfer_request(req, s_ccas);
  if (v_json ->> 'changed')::boolean is not true then
    v_fail := v_fail || format('T1a: la RPC dit n''avoir rien change - %s', v_json); end if;
  if v_json ->> 'organisme' is distinct from 'CCAS' then
    v_fail := v_fail || format('T1b: la RPC annonce %s au lieu de CCAS', v_json ->> 'organisme'); end if;
  if (v_json ->> 'unassigned')::boolean is not true then
    v_fail := v_fail || 'T1c: la RPC n''annonce pas le retrait d''affectation'::text; end if;
  select socle_organization_label into v_text from public.requests where id = req;
  if v_text is distinct from 'CCAS' then
    v_fail := v_fail || format('T1d: libelle %s au lieu de CCAS (miroir ignore)', v_text); end if;
  select socle_scope_org_id into v_uuid from public.requests where id = req;
  if v_uuid is distinct from s_ccas then
    v_fail := v_fail || 'T1e: socle_scope_org_id n''a pas suivi le transfert'::text; end if;

  -- ==========================================================================
  -- T2. L'affectation ne survit pas quand l'agent ne peut pas instruire la
  --     cible — et survit quand il le peut
  -- ==========================================================================
  select assigned_to into v_uuid from public.requests where id = req;
  if v_uuid is not null then
    v_fail := v_fail || 'T2a: Camille (Voirie seule) est restee affectee apres un transfert au CCAS'::text; end if;

  -- ⚠️ Alex ne peut PLUS ramener cette demande : elle est au CCAS, où il n'a
  -- rien. C'est u_large qui fait les allers-retours du décor.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  perform public.transfer_request(req, s_voirie);
  update public.requests set assigned_to = u_large where id = req;
  perform public.transfer_request(req, s_ccas);
  select assigned_to into v_uuid from public.requests where id = req;
  if v_uuid is distinct from u_large then
    v_fail := v_fail || 'T2b: une affectation VALIDE sur le couple d''arrivee a ete retiree'::text; end if;

  -- ==========================================================================
  -- T3. L'organisme cible doit assurer la démarche (t12)
  -- ==========================================================================
  begin
    perform public.transfer_request(req, s_etatciv);
    v_fail := v_fail || 'T3a: transfert accepte vers un organisme qui n''assure pas la demarche'::text;
  exception when others then
    if sqlerrm not like '%pas activée pour l''organisme cible%' then
      v_fail := v_fail || format('T3a: message inattendu - %s', sqlerrm); end if;
  end;

  -- Le refus tient même quand l'activation a été RETIRÉE après coup
  -- (obsoleted_at) : l'opt-in porte sur les lignes vivantes.
  update public.socle_procedure_organizations set obsoleted_at = now()
   where organization_id = orgA and socle_org_id = s_voirie and socle_procedure_id = proc;
  begin
    perform public.transfer_request(req, s_voirie);
    v_fail := v_fail || 'T3b: transfert accepte vers une activation perimee'::text;
  exception when others then
    if sqlerrm not like '%pas activée pour l''organisme cible%' then
      v_fail := v_fail || format('T3b: message inattendu - %s', sqlerrm); end if;
  end;
  update public.socle_procedure_organizations set obsoleted_at = null
   where organization_id = orgA and socle_org_id = s_voirie and socle_procedure_id = proc;

  -- ==========================================================================
  -- T4. Une demande HISTORIQUE sans démarche se transfère quand même
  -- ==========================================================================
  -- t16 interdit de NAÎTRE sans démarche : on fabrique la situation comme la
  -- base en porte encore (colonne vidée après coup, triggers d'insertion déjà
  -- passés) — c'est celle des demandes d'avant le 2026-08-20.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label)
  values (orgA, 'Demande historique', proc, snap, s_voirie, 'Voirie')
  returning id into req_libre;
  update public.requests set socle_procedure_id = null, procedure_snapshot = null where id = req_libre;

  begin
    perform public.transfer_request(req_libre, s_etatciv);
  exception when others then
    v_fail := v_fail || format('T4a: transfert d''une demande sans demarche refuse - %s', sqlerrm);
  end;
  select socle_organization_label into v_text from public.requests where id = req_libre;
  if v_text is distinct from 'Etat civil' then
    v_fail := v_fail || format('T4b: libelle %s au lieu de Etat civil', v_text); end if;

  -- ==========================================================================
  -- T5. Le journal porte `transferred`, avec les deux libellés
  -- ==========================================================================
  select payload into v_json from public.request_events
   where request_id = req and event_type = 'transferred'
   order by created_at limit 1;
  if v_json is null then
    v_fail := v_fail || 'T5a: aucun evenement transferred au journal'::text;
  else
    if v_json ->> 'from_label' is distinct from 'Voirie'
       or v_json ->> 'to_label' is distinct from 'CCAS' then
      v_fail := v_fail || format('T5b: libelles du journal inattendus - %s', v_json); end if;
    if (v_json ->> 'unassigned')::boolean is not true then
      v_fail := v_fail || 'T5c: le journal ne dit pas que l''affectation a ete retiree'::text; end if;
  end if;

  -- Le retrait d'affectation laisse AUSSI sa trace propre (`assigned` → null).
  select count(*) into v_int from public.request_events
   where request_id = req and event_type = 'assigned' and payload ->> 'to' is null;
  if v_int < 1 then
    v_fail := v_fail || 'T5d: le retrait d''affectation n''est pas journalise'::text; end if;

  -- ==========================================================================
  -- T6. La notification `transferred_in` va aux agents du couple d'ARRIVÉE
  -- ==========================================================================
  -- Demande DÉDIÉE, et UN SEUL transfert : `req` a fait plusieurs allers-retours
  -- plus haut, et compter ses notifications ne prouverait rien — un aller
  -- CCAS→Voirie sert légitimement les instructeurs de la Voirie.
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label,
                               socle_procedure_label, received_at)
  values (orgA, 'A notifier', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule', '2026-03-12T09:30:00Z')
  returning id into req_notif;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  perform public.transfer_request(req_notif, s_ccas);

  select count(*) into v_int from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_ccas;
  if v_int <> 1 then
    v_fail := v_fail || format('T6a: l''instructeur de la cible a recu %s notification(s) au lieu d''1', v_int); end if;

  -- Camille n'instruit que la Voirie, le couple de DÉPART : rien pour elle.
  select count(*) into v_int from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_camille;
  if v_int <> 0 then
    v_fail := v_fail || 'T6b: un instructeur du seul couple de DEPART a ete notifie du transfert'::text; end if;

  -- Jamais pour son propre geste.
  select count(*) into v_int from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_alex;
  if v_int <> 0 then
    v_fail := v_fail || 'T6c: l''auteur du transfert s''est notifie lui-meme'::text; end if;

  -- Le payload porte de quoi reconnaître la demande — et RIEN de l'usager.
  select payload into v_json from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_ccas
   order by created_at limit 1;
  if v_json ->> 'from_destinataire' is distinct from 'Voirie'
     or v_json ->> 'destinataire' is distinct from 'CCAS' then
    v_fail := v_fail || format('T6d: payload de transfert inattendu - %s', v_json); end if;
  if v_json ->> 'received_at' is null then
    v_fail := v_fail || 'T6e: la date de depot manque au payload'::text; end if;
  if v_json ? 'requester' or v_json ? 'requester_snapshot' or v_json ? 'socle_contact_id' then
    v_fail := v_fail || 'T6f: une identite d''usager a fui dans le payload de notification'::text; end if;

  -- L'e-mail est mis en file comme n'importe quelle notification.
  select count(*) into v_int from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_ccas
     and email_status = 'pending';
  if v_int <> 1 then
    v_fail := v_fail || 'T6g: la notification de transfert n''est pas entree dans la boite d''envoi'::text; end if;

  -- Une préférence coupée fait taire les DEUX canaux, ici comme ailleurs :
  -- deux transferts de plus vers le CCAS ne produisent aucune ligne.
  insert into public.notification_preferences (user_id, kind, in_app, email)
    values (u_ccas, 'transferred_in', false, false);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  perform public.transfer_request(req_notif, s_voirie);
  perform public.transfer_request(req_notif, s_ccas);
  select count(*) into v_int from public.notifications
   where request_id = req_notif and kind = 'transferred_in' and user_id = u_ccas;
  if v_int <> 1 then
    v_fail := v_fail || format('T6h: preference coupee ignoree - %s notification(s) au lieu d''1', v_int); end if;
  delete from public.notification_preferences where user_id = u_ccas and kind = 'transferred_in';

  -- ==========================================================================
  -- T7. Le DROIT de transférer : instruction sur le couple ACTUEL, et la
  --     cible peut être hors de tout périmètre (RM-19)
  -- ==========================================================================
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                               socle_organization_id, socle_organization_label, socle_procedure_label)
  values (orgA, 'A transferer par un client reel', proc, snap, s_voirie, 'Voirie',
          'Signalement nid-de-poule')
  returning id into req_garde;

  -- Alex, VRAI client authentifié : il n'a AUCUN droit au CCAS, et transfère
  -- pourtant. ⚠️ C'est exactement ce qu'un UPDATE nu ne pouvait pas faire
  -- (42501) : la RPC existe pour ça.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.transfer_request(req_garde, s_ccas);
  exception when others then
    v_fail := v_fail || format('T7a: transfert legitime refuse - %s', sqlerrm);
  end;
  execute 'reset role';
  select socle_organization_id into v_uuid from public.requests where id = req_garde;
  if v_uuid is distinct from s_ccas then
    v_fail := v_fail || 'T7b: le transfert d''un client authentifie n''a pas pris'::text; end if;

  -- …et la demande a bien quitté son périmètre : il ne la voit plus.
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = req_garde;
  execute 'reset role';
  if v_int <> 0 then
    v_fail := v_fail || 'T7c: l''auteur voit encore une demande sortie de son perimetre'::text; end if;

  -- Camille (instruction Voirie seule) ne peut PAS la retransférer : le droit
  -- porte sur le couple ACTUEL, qui est désormais le CCAS.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.transfer_request(req_garde, s_voirie);
    v_fail := v_fail || 'T7d: une demande hors perimetre a ete retransferee par un non-instructeur'::text;
  exception when others then
    if sqlerrm not like '%droit d''instruction%' then
      v_fail := v_fail || format('T7d: message inattendu - %s', sqlerrm); end if;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- T8. Organisation inconnue refusée ; transfert SUR PLACE sans effet
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_large, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.transfer_request(req_notif, gen_random_uuid());
    v_fail := v_fail || 'T8a: transfert accepte vers une organisation inconnue du referentiel'::text;
  exception when others then
    if sqlerrm not like '%destinataire inconnue%' then
      v_fail := v_fail || format('T8a: message inattendu - %s', sqlerrm); end if;
  end;

  -- Un transfert SUR PLACE ne change rien et ne journalise rien.
  select count(*) into v_int from public.request_events
   where request_id = req_notif and event_type = 'transferred';
  v_json := public.transfer_request(req_notif, s_ccas);
  if (v_json ->> 'changed')::boolean is not false then
    v_fail := v_fail || 'T8b: un transfert sur place se dit changed'::text; end if;
  select count(*) - v_int into v_int from public.request_events
   where request_id = req_notif and event_type = 'transferred';
  if v_int <> 0 then
    v_fail := v_fail || 'T8c: un transfert sur place a ete journalise'::text; end if;
  execute 'reset role';

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (transfert d''organisme) - transaction annulee, aucune donnee conservee.';
  else
    raise exception 'ECHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' | ');
  end if;
end
$main$;
