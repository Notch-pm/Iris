-- ============================================================================
-- Tests des profils de droits — étanchéité par couple (organisation,
-- démarche), non-escalade, dernier administrateur, verrou optimiste, RPC.
-- Réf : spec-profils-droits.md CA-01 à CA-21, CL-01 à CL-28 · fondations.test.sql
-- (motif du harnais).
--
-- Exécution : contexte postgres en lecture-écriture (SQL editor / apply_migration
-- volontairement en échec). Identités simulées par request.jwt.claims +
-- SET LOCAL ROLE authenticated ; retour en `reset role` pour les seeds.
--
-- ⚠️ Les gardes RM-05/06/38/39/42 des profils de droits ne sont PAS portées
-- par des triggers (différés ou non) : elles sont appelées EXPLICITEMENT,
-- IMMÉDIATEMENT, par les RPC de M5 (save_permission_profile,
-- set_permission_profile_status, assign_/revoke_permission_profile) — voir
-- l'en-tête de 20260822100300_profils_droits_gardes.sql pour le pourquoi
-- (piège SECURITY DEFINER / current_user, vérifié empiriquement : un trigger
-- différé aurait été soit systématiquement court-circuité — is_service_context()
-- vaut toujours vrai à l'intérieur d'une fonction DEFINER, ce que sont TOUTES
-- les RPC — soit en échec « permission denied » au COMMIT en production).
-- Conséquence pour CE test : aucun `SET CONSTRAINTS` n'est nécessaire — les
-- refus s'observent directement en résultat de l'appel RPC, comme en
-- production (PostgREST = une requête, une transaction implicite).
-- ============================================================================

do $main$
declare
  -- Tenant 1 : Mairie (racine) → Voirie, CCAS (frères) ; petit-enfant sous Voirie.
  s_root   uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas   uuid := gen_random_uuid();
  s_petit  uuid := gen_random_uuid();
  org1     uuid;
  -- Tenant 2 (étanchéité cross-tenant, CA-20).
  s_root2  uuid := gen_random_uuid();
  org2     uuid;
  -- Démarches.
  proc_d1  uuid := gen_random_uuid();  -- D1 : Signalement nid-de-poule
  proc_d2  uuid := gen_random_uuid();  -- D2 : Demande d'aide sociale
  proc_t2  uuid := gen_random_uuid();  -- démarche du tenant 2
  snap_d1  jsonb; snap_d2 jsonb; snap_t2 jsonb;
  -- Utilisateurs.
  u_camille   uuid := gen_random_uuid();
  u_dominique uuid := gen_random_uuid();
  u_alex      uuid := gen_random_uuid();
  u_morgane   uuid := gen_random_uuid();
  u_beatrice  uuid := gen_random_uuid();
  u_guichet   uuid := gen_random_uuid();
  u_lecteur   uuid := gen_random_uuid();
  u_sans      uuid := gen_random_uuid();
  u_extra     uuid := gen_random_uuid();  -- décor volant (CA-05, CL-02, ...)
  -- Profils.
  p_camille   uuid;
  p_dom_a     uuid;
  p_dom_b     uuid;
  p_alex      uuid;
  p_morgane   uuid;
  p_beatrice  uuid;
  p_beatrice2 uuid;  -- second profil admin de Béatrice, périmètre Voirie (isole RM-38 de RM-39 dans CL-15a)
  p_guichet   uuid;
  p_lecteur   uuid;
  -- Demandes.
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r_new uuid;
  -- Scratch.
  v_fail   text[] := '{}';
  v_int    int;
  v_bool   boolean;
  v_uuid   uuid;
  v_text   text;
  v_status text;
  v_jsonb  jsonb;
  v_result jsonb;
  v_extra_profile uuid;
  v_version int;
  v_p_test  uuid;
begin
  -- Garde-fou plateforme Supabase : storage.protect_delete() (trigger STATEMENT
  -- sur storage.objects) interdit tout DELETE direct hors API Storage, sauf si
  -- ce GUC transactionnel vaut 'true'. Le test vérifie l'effet des POLICIES
  -- (0 ligne affectée pour un appelant sans droit), pas ce garde-fou : on le
  -- lève pour la durée de la transaction (annulée de toute façon).
  perform set_config('storage.allow_delete_query', 'true', true);
  -- ==========================================================================
  -- MISE EN PLACE (contexte postgres, propriétaire, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_camille,   'camille@t1.test',   now(), now()),
    (u_dominique, 'dominique@t1.test', now(), now()),
    (u_alex,      'alex@t1.test',      now(), now()),
    (u_morgane,   'morgane@t1.test',   now(), now()),
    (u_beatrice,  'beatrice@t1.test',  now(), now()),
    (u_guichet,   'guichet@t1.test',   now(), now()),
    (u_lecteur,   'lecteur@t1.test',   now(), now()),
    (u_sans,      'sans-profil@t1.test', now(), now()),
    (u_extra,     'extra@t1.test',     now(), now());

  insert into public.organizations (socle_org_id, name) values (s_root, 'Mairie Test') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Autre Collectivité') returning id into org2;

  insert into public.integration_sources (organization_id, code, name)
  values (org1, 'source-test', 'Source de test');

  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_camille,   'agent'), (org1, u_dominique, 'agent'), (org1, u_alex, 'agent'),
    (org1, u_morgane,   'agent'), (org1, u_beatrice,  'agent'), (org1, u_guichet, 'agent'),
    (org1, u_lecteur,   'agent'), (org1, u_sans,      'agent'), (org1, u_extra,   'agent');
  -- role : valeur d'appel indifférente, forcée par le trigger dérivé (M7).

  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root,   null,     'Mairie'),
    (org1, s_voirie, s_root,   'Voirie'),
    (org1, s_ccas,   s_root,   'CCAS'),
    (org1, s_petit,  s_voirie, 'Antenne Voirie Nord');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name)
  values (org2, s_root2, null, 'Racine Tenant 2');

  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name, category_name) values
    (proc_d1, org1, s_root, 'Signalement nid-de-poule', 'Cadre de vie'),
    (proc_d2, org1, s_root, 'Demande d''aide sociale',  'Social');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
  values (proc_t2, org2, s_root2, 'Démarche tenant 2');

  snap_d1 := jsonb_build_object('id', proc_d1::text, 'name', 'Signalement nid-de-poule');
  snap_d2 := jsonb_build_object('id', proc_d2::text, 'name', 'Demande d''aide sociale');
  snap_t2 := jsonb_build_object('id', proc_t2::text, 'name', 'Démarche tenant 2');

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                                socle_organization_id, socle_organization_label)
  values (org1, 'R1 Voirie D1', proc_d1, snap_d1, s_voirie, 'Voirie') returning id into r1;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                                socle_organization_id, socle_organization_label)
  values (org1, 'R2 CCAS D2', proc_d2, snap_d2, s_ccas, 'CCAS') returning id into r2;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                                socle_organization_id, socle_organization_label)
  values (org1, 'R3 Voirie D2', proc_d2, snap_d2, s_voirie, 'Voirie') returning id into r3;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot)
  values (org1, 'R4 sans destinataire D1', proc_d1, snap_d1) returning id into r4;
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                                socle_organization_id, socle_organization_label)
  values (org1, 'R5 petit-enfant D1', proc_d1, snap_d1, s_petit, 'Antenne Voirie Nord') returning id into r5;

  -- Profils de reprise : AUCUN ici (décor du lot 1 dédié, pas la reprise M6 —
  -- fondations.test.sql couvre M6 séparément). On construit directement les
  -- profils du décor de la spécification.

  -- Camille : Voirie, D1 instruction, défaut aucun.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Camille-Voirie-D1', false) returning id into p_camille;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_camille, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
  values (p_camille, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_camille, u_camille);

  -- Dominique A : Voirie, D1 instruction.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Dominique-A-Voirie-D1', false) returning id into p_dom_a;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_dom_a, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
  values (p_dom_a, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_dom_a, u_dominique);

  -- Dominique B : CCAS, D2 clôture.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Dominique-B-CCAS-D2', false) returning id into p_dom_b;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_dom_b, s_ccas);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_close)
  values (p_dom_b, proc_d2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_dom_b, u_dominique);

  -- Alex : racine, admin, défaut = tous droits.
  insert into public.permission_profiles (organization_id, name, is_admin, default_view, default_create, default_process, default_close)
  values (org1, 'Alex-Admin-Tous', true, true, true, true, true) returning id into p_alex;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_alex, s_root);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_alex, u_alex);

  -- Morgane : racine, admin, défaut aucun (RM-22).
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Morgane-Admin-Aucun', true) returning id into p_morgane;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_morgane, s_root);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_morgane, u_morgane);

  -- Béatrice : Voirie, admin, D1 instruction explicite, D2 consultation
  -- explicite. + p_beatrice2 : second profil admin PUR (Voirie), pour isoler
  -- RM-38 (droits) de RM-39 (périmètre) dans CL-15a.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Beatrice-Admin-Voirie', true) returning id into p_beatrice;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_beatrice, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process) values (p_beatrice, proc_d1, true, true);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view) values (p_beatrice, proc_d2, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_beatrice, u_beatrice);

  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Beatrice-Admin-Voirie-Secours', true) returning id into p_beatrice2;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_beatrice2, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_beatrice2, u_beatrice);

  -- Guichet : racine, D1 création seule.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Guichet-D1-Creation', false) returning id into p_guichet;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_guichet, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_create) values (p_guichet, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_guichet, u_guichet);

  -- Lecteur : racine, D1 consultation seule.
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Lecteur-D1-Consultation', false) returning id into p_lecteur;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_lecteur, s_root);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view) values (p_lecteur, proc_d1, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_lecteur, u_lecteur);

  -- u_sans : membre du tenant, AUCUN profil (CL-01) — ne rien attribuer.

  -- ==========================================================================
  -- CL-05 / CL-06 — rattachement racine (destinataire NULL / inconnu)
  -- ==========================================================================
  select socle_scope_org_id into v_uuid from public.requests where id = r4;
  if v_uuid is distinct from s_root then
    v_fail := v_fail || 'CL-05: R4 (destinataire NULL) non rattachée à la racine';
  end if;

  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
  values (org1, 'R6 destinataire inconnu du miroir', proc_d1, snap_d1, gen_random_uuid()) returning id into r6;
  select socle_scope_org_id, anomalies into v_uuid, v_jsonb from public.requests where id = r6;
  if v_uuid is distinct from s_root then
    v_fail := v_fail || 'CL-06: R6 (destinataire inconnu) non rattachée à la racine';
  end if;
  if not (v_jsonb @> '[{"code":"destinataire_inconnu"}]'::jsonb) then
    v_fail := v_fail || 'CL-06: anomalie destinataire_inconnu absente';
  end if;

  -- ==========================================================================
  -- CL-11 — demande historique sans démarche (garde t16 désactivée le temps
  -- de l'insertion, comme dans fondations.test.sql).
  -- ==========================================================================
  execute 'alter table public.requests disable trigger t16_requests_require_procedure';
  insert into public.requests (organization_id, subject) values (org1, 'R7 historique sans démarche') returning id into r7;
  execute 'alter table public.requests enable trigger t16_requests_require_procedure';

  -- Camille (défaut aucun) ne voit pas R7 ; Alex (défaut tous droits) la voit.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r7;
  if v_int <> 0 then v_fail := v_fail || 'CL-11: Camille (défaut aucun) voit la demande historique'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r7;
  if v_int <> 1 then v_fail := v_fail || 'CL-11: Alex (défaut tous droits) ne voit pas la demande historique'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- CL-01 — membre sans profil : aucune demande visible.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_sans, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests;
  if v_int <> 0 then v_fail := v_fail || format('CL-01: u_sans voit %s demandes au lieu de 0', v_int); end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-01 — étanchéité par organisation (profil temporaire élargi de Camille).
  -- ==========================================================================
  insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'Temp-Voirie-Instruction-CA01', false) returning id into v_extra_profile;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (v_extra_profile, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
  values (v_extra_profile, proc_d2, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, v_extra_profile, u_camille);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id in (r1, r3);
  if v_int <> 2 then v_fail := v_fail || 'CA-01: Camille (Voirie D1+D2) ne voit pas R1 et R3'; end if;
  select count(*) into v_int from public.requests where id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-01: Camille voit R2 (CCAS)'; end if;
  select count(*) into v_int from public.request_events where request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-01: Camille voit le journal de R2'; end if;
  execute 'reset role';

  delete from public.permission_profile_assignments where profile_id = v_extra_profile and user_id = u_camille;
  delete from public.permission_profiles where id = v_extra_profile;

  -- ==========================================================================
  -- CA-02 — étanchéité par démarche (baseline Camille : D1 seul).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r1;
  if v_int <> 1 then v_fail := v_fail || 'CA-02: Camille (baseline) ne voit pas R1'; end if;
  select count(*) into v_int from public.requests where id = r3;
  if v_int <> 0 then v_fail := v_fail || 'CA-02: Camille (baseline) voit R3 (D2, non attribué)'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- CL-04 — un profil étroit n'abaisse jamais un droit plus large (profil
  -- temporaire racine/défaut consultation, en PLUS de la baseline Voirie/D1).
  -- ==========================================================================
  insert into public.permission_profiles (organization_id, name, is_admin, default_view)
  values (org1, 'Temp-Racine-Consultation-CL04', false, true) returning id into v_extra_profile;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (v_extra_profile, s_root);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, v_extra_profile, u_camille);

  if not public.user_has_request_right(u_camille, org1, s_ccas, proc_d2, 'consultation') then
    v_fail := v_fail || 'CL-04: le profil large (défaut consultation) n''étend pas le droit sur CCAS/D2';
  end if;
  if not public.user_has_request_right(u_camille, org1, s_voirie, proc_d1, 'instruction') then
    v_fail := v_fail || 'CL-04: le profil large abaisse le droit d''instruction déjà détenu sur Voirie/D1';
  end if;

  delete from public.permission_profile_assignments where profile_id = v_extra_profile and user_id = u_camille;
  delete from public.permission_profiles where id = v_extra_profile;

  -- ==========================================================================
  -- CA-03 — le sous-arbre est inclus (Alex, racine, voit tout, y compris R4
  -- et R5 du petit-enfant).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id in (r1, r2, r3, r4, r5);
  if v_int <> 5 then v_fail := v_fail || format('CA-03: Alex voit %s/5 demandes du tenant', v_int); end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-04 — combinaison par couple, ABSENCE de produit cartésien (Dominique :
  -- A=Voirie/D1 instruction, B=CCAS/D2 clôture).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_dominique, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id in (r1, r2);
  if v_int <> 2 then v_fail := v_fail || 'CA-04: Dominique ne voit pas R1 et R2'; end if;
  select count(*) into v_int from public.requests where id = r3;
  if v_int <> 0 then v_fail := v_fail || 'CA-04: Dominique voit R3 (Voirie, D2) — produit cartésien détecté !'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-05 — le plus haut niveau l'emporte (décor isolé : u_extra avec
  -- profil C = racine/défaut consultation, profil D = Voirie/D1 clôture).
  -- ==========================================================================
  declare
    p_c uuid; p_d uuid;
  begin
    insert into public.permission_profiles (organization_id, name, is_admin, default_view)
    values (org1, 'CA05-C-Racine-Consultation', false, true) returning id into p_c;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_c, s_root);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_c, u_extra);

    insert into public.permission_profiles (organization_id, name, is_admin) values (org1, 'CA05-D-Voirie-D1-Cloture', false) returning id into p_d;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_d, s_voirie);
    insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_close) values (p_d, proc_d1, true, true);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_d, u_extra);
  end;
  -- Sur (Voirie, D1) : clôture (implique consultation) — pas d'instruction
  -- (RM-01, droits indépendants : clôture n'emporte pas instruction).
  if not public.user_has_request_right(u_extra, org1, s_voirie, proc_d1, 'cloture') then
    v_fail := v_fail || 'CA-05: u_extra (C+D) n''a pas la clôture sur R1';
  end if;
  if public.user_has_request_right(u_extra, org1, s_voirie, proc_d1, 'instruction') then
    v_fail := v_fail || 'CA-05: u_extra (C+D) a l''instruction sur R1 alors que seule la clôture a été accordée';
  end if;
  -- Sur (CCAS, D2) : seule la consultation par défaut du profil C s'applique
  -- (D ne couvre pas CCAS) — lecture seule.
  if public.user_has_request_right(u_extra, org1, s_ccas, proc_d2, 'ecriture') then
    v_fail := v_fail || 'CA-05: u_extra a un droit d''écriture sur R2 (CCAS/D2), attendu lecture seule';
  end if;
  if not public.user_has_request_right(u_extra, org1, s_ccas, proc_d2, 'consultation') then
    v_fail := v_fail || 'CA-05: u_extra n''a pas la consultation par défaut sur R2';
  end if;

  -- ==========================================================================
  -- CA-06 — consultation seule : lecture stricte (lecteur, D1 consultation).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_lecteur, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r1;
  if v_int <> 1 then v_fail := v_fail || 'CA-06: le lecteur ne peut pas lire R1'; end if;
  begin
    update public.requests set status = 'en_instruction', assigned_to = u_lecteur where id = r1;
    get diagnostics v_int = row_count;
    if v_int <> 0 then v_fail := v_fail || 'CA-06: le lecteur a pu transitionner R1 (consultation seule)'; end if;
  exception when others then null;  -- refus également acceptable (garde ou RLS)
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CA-07 — création sans instruction (guichet, D1 création seule).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_guichet, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot, socle_organization_id)
  values (org1, 'Créée par le guichet', proc_d1, snap_d1, s_root) returning id into r_new;
  select count(*) into v_int from public.requests where id = r_new;
  if v_int <> 1 then v_fail := v_fail || 'CA-07: le guichet ne voit pas sa propre création'; end if;
  begin
    update public.requests set status = 'en_instruction', assigned_to = u_guichet where id = r_new;
    v_fail := v_fail || 'CA-07: le guichet a pu prendre en charge sa propre demande (pas de droit d''instruction)';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CA-08 — instruction sans clôture (Camille, baseline Voirie/D1
  -- instruction). Prend en charge R1, ne peut pas le résoudre.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction', assigned_to = u_camille where id = r1;
  select status into v_status from public.requests where id = r1;
  if v_status <> 'en_instruction' then v_fail := v_fail || 'CA-08: Camille n''a pas pu prendre en charge R1'; end if;
  begin
    update public.requests set status = 'resolue_positive', closure_text = 'x' where id = r1;
    v_fail := v_fail || 'CA-08: Camille (instruction seule) a pu résoudre positivement R1';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CA-09 — réouverture et archivage : administration + clôture.
  -- Substitution documentée : le profil « Camille (Voirie, D1 clôture,
  -- administration : non) » de la spécification est porté par u_extra, déjà
  -- doté exactement de cette forme via le profil D de CA-05 (Voirie, D1 :
  -- clôture, is_admin = false) — décor réutilisé pour ne pas dupliquer.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_extra, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set status = 'resolue_positive', closure_text = 'Rebouchage effectué.' where id = r1;
  select status into v_status from public.requests where id = r1;
  if v_status <> 'resolue_positive' then v_fail := v_fail || 'CA-09: u_extra (clôture) n''a pas pu résoudre R1'; end if;
  begin
    update public.requests set status = 'en_instruction' where id = r1;
    v_fail := v_fail || 'CA-09: u_extra (clôture, non-admin) a pu rouvrir R1';
  exception when others then null;
  end;
  begin
    update public.requests set status = 'archivee' where id = r1;
    v_fail := v_fail || 'CA-09: u_extra (clôture, non-admin) a pu archiver R1';
  exception when others then null;
  end;
  execute 'reset role';

  -- Alex (admin, tous droits) : rouvre, re-résout, archive.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set status = 'en_instruction' where id = r1;
  select status into v_status from public.requests where id = r1;
  if v_status <> 'en_instruction' then v_fail := v_fail || 'CA-09: Alex n''a pas pu rouvrir R1'; end if;
  update public.requests set status = 'resolue_positive', closure_text = 'Clôture après réexamen.' where id = r1;
  update public.requests set status = 'archivee' where id = r1;
  select status into v_status from public.requests where id = r1;
  if v_status <> 'archivee' then v_fail := v_fail || 'CA-09: Alex n''a pas pu archiver R1'; end if;
  execute 'reset role';

  -- Morgane (admin, défaut aucun) : ne voit pas R1, ne peut ni rouvrir ni
  -- archiver (RLS l'exclut silencieusement : 0 ligne affectée).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_morgane, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r1;
  if v_int <> 0 then v_fail := v_fail || 'CA-09: Morgane (défaut aucun) voit R1'; end if;
  update public.requests set status = 'resolue_positive' where id = r1 and status = 'archivee';
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'CA-09: Morgane a pu désarchiver R1 malgré défaut aucun'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-10 — administration n'ouvre pas les dossiers (Morgane).
  -- ==========================================================================
  if not public.is_org_admin_anywhere(org1) then
    -- (vérifié hors RLS : is_org_admin_anywhere lit auth.uid(), il faut donc
    -- être authentifié en Morgane pour ce test précis)
    null;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_morgane, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.is_org_admin_anywhere(org1) then
    v_fail := v_fail || 'CA-10: Morgane ne détient pas is_org_admin_anywhere (entrée Paramètres absente)';
  end if;
  select count(*) into v_int from public.requests;
  if v_int <> 0 then v_fail := v_fail || format('CA-10: Morgane voit %s demandes au lieu de 0', v_int); end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-11 — demande sans destinataire (R4) : invisible d'un profil de
  -- sous-arbre, visible et prenable en charge par un profil racine.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r4;
  if v_int <> 0 then v_fail := v_fail || 'CA-11: Camille (Voirie) voit R4 (destinataire NULL)'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.requests where id = r4;
  if v_int <> 1 then v_fail := v_fail || 'CA-11: Alex (racine) ne voit pas R4'; end if;
  update public.requests set status = 'en_instruction', assigned_to = u_alex where id = r4;
  select status into v_status from public.requests where id = r4;
  if v_status <> 'en_instruction' then v_fail := v_fail || 'CA-11: Alex n''a pas pu prendre en charge R4'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- CA-12 — affectation à un collègue ÉLIGIBLE uniquement (Alex affecte R5 à
  -- Camille [éligible, sous-arbre Voirie] puis R2 à Camille [refusé, CCAS]).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set assigned_to = u_camille where id = r5;
  select assigned_to into v_uuid from public.requests where id = r5;
  if v_uuid is distinct from u_camille then v_fail := v_fail || 'CA-12: affectation de R5 (petit-enfant, sous-arbre Voirie) à Camille refusée à tort'; end if;

  select count(*) into v_int from public.eligible_assignees(r2) where user_id = u_camille;
  if v_int <> 0 then v_fail := v_fail || 'CA-12: eligible_assignees(R2) propose Camille (non éligible)'; end if;

  begin
    update public.requests set assigned_to = u_camille where id = r2;
    v_fail := v_fail || 'CA-12: affectation de R2 (CCAS) à Camille acceptée (elle n''a aucun droit d''instruction CCAS)';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CA-13 / CL-14 — non-escalade de périmètre et de droits (Béatrice, admin
  -- de sous-arbre Voirie).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_beatrice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- CL-14 : périmètre racine hors de sa portée.
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA13-Racine-Refuse', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_root),
      'procedures', '[]'::jsonb));
    v_fail := v_fail || 'CA-13/CL-14: Béatrice a pu créer un profil de périmètre racine';
  exception when others then null;
  end;

  -- CA-13 cas 2 : droit demandé (instruction sur D2) supérieur à ce qu'elle
  -- détient elle-même (consultation seule sur D2).
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA13-D2-Instruction-Refuse', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_voirie),
      'procedures', jsonb_build_array(jsonb_build_object('id', proc_d2, 'rights', jsonb_build_array('instruction')))));
    v_fail := v_fail || 'CA-13: Béatrice a pu accorder instruction sur D2 alors qu''elle n''a que consultation';
  exception when others then null;
  end;

  -- CA-13 cas 3 : droit qu'elle détient réellement (D1 instruction sur
  -- Voirie) — doit réussir, puis être attribuable.
  select public.save_permission_profile(jsonb_build_object(
    'organization_id', org1, 'name', 'CA13-D1-Instruction-Ok', 'is_admin', false,
    'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_voirie),
    'procedures', jsonb_build_array(jsonb_build_object('id', proc_d1, 'rights', jsonb_build_array('instruction')))))
    into v_result;
  v_p_test := (v_result ->> 'id')::uuid;
  if v_p_test is null then
    v_fail := v_fail || 'CA-13: Béatrice n''a pas pu créer un profil qu''elle détient réellement';
  else
    perform public.assign_permission_profile(v_p_test, u_sans);
    if not exists (select 1 from public.permission_profile_assignments where profile_id = v_p_test and user_id = u_sans) then
      v_fail := v_fail || 'CA-13: Béatrice n''a pas pu attribuer le profil qu''elle vient de créer';
    end if;
  end if;

  -- Item 1.a (revue de sécurité) : « admin de sous-arbre édite le profil
  -- racine d'AUTRUI → refusé (autorité sur l'existant) ». Le périmètre
  -- PROPOSÉ ici (Voirie) est volontairement DANS la portée de Béatrice — le
  -- pré-contrôle sur le périmètre proposé passerait donc seul ; c'est
  -- assert_editor_can_manage_profile(v_org, v_id), appelée EN TÊTE de la
  -- branche édition sur le périmètre EXISTANT de p_alex (racine, hors de
  -- sa portée), qui doit refuser spécifiquement.
  declare v_alex_version_beatrice int; begin
    select version into v_alex_version_beatrice from public.permission_profiles where id = p_alex;
    begin
      perform public.save_permission_profile(jsonb_build_object(
        'profile_id', p_alex, 'organization_id', org1, 'name', 'Alex-Devenu-Voirie',
        'is_admin', true, 'default_rights', jsonb_build_array('consultation'),
        'organizations', jsonb_build_array(s_voirie), 'procedures', '[]'::jsonb,
        'expected_version', v_alex_version_beatrice));
      v_fail := v_fail || 'Item1.a: Béatrice (admin Voirie) a pu éditer le profil racine d''Alex';
    exception when others then null;
    end;
    select name into v_text from public.permission_profiles where id = p_alex;
    if v_text = 'Alex-Devenu-Voirie' then
      v_fail := v_fail || 'Item1.a: le profil d''Alex a été altéré malgré le refus attendu';
    end if;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CL-02 — profil attribué mais désactivé : zéro droit produit, attribution
  -- conservée. u_extra perd temporairement son droit de clôture (profil D de
  -- CA-05) une fois désactivé par Alex.
  -- ==========================================================================
  declare p_d_status text; p_d_version int; p_d_id uuid; begin
    select id, version into p_d_id, p_d_version from public.permission_profiles
     where organization_id = org1 and name = 'CA05-D-Voirie-D1-Cloture';

    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.set_permission_profile_status(p_d_id, 'inactive', p_d_version);
    execute 'reset role';

    select status into p_d_status from public.permission_profiles where id = p_d_id;
    if p_d_status <> 'inactive' then v_fail := v_fail || 'CL-02: le profil n''est pas passé inactif'; end if;
    if public.user_has_request_right(u_extra, org1, s_voirie, proc_d1, 'cloture') then
      v_fail := v_fail || 'CL-02: un profil inactif produit encore un droit';
    end if;
    if not exists (select 1 from public.permission_profile_assignments where profile_id = p_d_id and user_id = u_extra) then
      v_fail := v_fail || 'CL-02: l''attribution a disparu alors que le profil est seulement désactivé';
    end if;
  end;

  -- ==========================================================================
  -- CL-15a — auto-escalade refusée : l'éditeur, LUI-MÊME attribué au profil
  -- qu'il élargit, ne peut pas se l'octroyer via l'édition (Béatrice élargit
  -- p_beatrice — déjà sienne — pour y ajouter la clôture sur D1, qu'elle ne
  -- détient nulle part ailleurs). Son PÉRIMÈTRE est couvert par p_beatrice2
  -- (profil admin distinct) : seule la vérification DIFFÉRÉE des DROITS
  -- (RM-38) doit intervenir ici, pas le pré-contrôle de périmètre (RM-39).
  -- ==========================================================================
  declare v_beatrice_version int; begin
    select version into v_beatrice_version from public.permission_profiles where id = p_beatrice;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_beatrice, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.save_permission_profile(jsonb_build_object(
        'profile_id', p_beatrice, 'organization_id', org1, 'name', 'Beatrice-Admin-Voirie',
        'is_admin', true, 'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_voirie),
        'procedures', jsonb_build_array(
          jsonb_build_object('id', proc_d1, 'rights', jsonb_build_array('instruction', 'cloture')),
          jsonb_build_object('id', proc_d2, 'rights', jsonb_build_array('consultation'))),
        'expected_version', v_beatrice_version));
      v_fail := v_fail || 'CL-15a: Béatrice a pu s''octroyer la clôture sur D1 via son propre profil';
    exception when others then null;
    end;
    execute 'reset role';
  end;

  -- ==========================================================================
  -- CL-15b — auto-escalade refusée : l'éditeur s'attribue un profil PLUS
  -- LARGE créé par un tiers (Alex crée P = Voirie/D1 clôture ; Béatrice se
  -- l'attribue elle-même — elle n'a que l'instruction sur D1/Voirie).
  -- ==========================================================================
  declare v_p_wide uuid; begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CL15b-Voirie-D1-Cloture', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_voirie),
      'procedures', jsonb_build_array(jsonb_build_object('id', proc_d1, 'rights', jsonb_build_array('cloture')))))
      into v_result;
    v_p_wide := (v_result ->> 'id')::uuid;
    execute 'reset role';

    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_beatrice, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.assign_permission_profile(v_p_wide, u_beatrice);
      v_fail := v_fail || 'CL-15b: Béatrice a pu s''auto-attribuer un profil de clôture qu''elle ne détenait pas';
    exception when others then null;
    end;
    execute 'reset role';
  end;

  -- ==========================================================================
  -- CA-19 — profils invalides refusés (RM-05/RM-06, via la RPC).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA19-Sans-Organisation', 'is_admin', false,
      'default_rights', jsonb_build_array('consultation'), 'organizations', '[]'::jsonb, 'procedures', '[]'::jsonb));
    v_fail := v_fail || 'CA-19: profil sans organisation accepté';
  exception when others then null;
  end;
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA19-Aucun-Droit', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_root), 'procedures', '[]'::jsonb));
    v_fail := v_fail || 'CA-19: profil sans administration ni droit accepté';
  exception when others then null;
  end;

  -- ==========================================================================
  -- CA-20 — étanchéité cross-tenant dans les profils (organisation ET
  -- démarche du tenant 2 refusées dans un profil du tenant 1).
  -- ==========================================================================
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA20-Org-Tenant2-Refuse', 'is_admin', false,
      'default_rights', jsonb_build_array('consultation'), 'organizations', jsonb_build_array(s_root2), 'procedures', '[]'::jsonb));
    v_fail := v_fail || 'CA-20: organisation du tenant 2 acceptée dans un profil du tenant 1';
  exception when others then null;
  end;
  begin
    perform public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'CA20-Proc-Tenant2-Refuse', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_root),
      'procedures', jsonb_build_array(jsonb_build_object('id', proc_t2, 'rights', jsonb_build_array('consultation')))));
    v_fail := v_fail || 'CA-20: démarche du tenant 2 acceptée dans un profil du tenant 1';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- CA-18 — storage et satellites suivent la demande (Camille vs pièce/note/
  -- journal de R2 [CCAS, hors périmètre] ; contrôle positif sur R1).
  -- ==========================================================================
  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r2, u_dominique, 'Note interne sur R2');
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, uploaded_by)
  values (org1, r2, org1::text || '/' || r2::text || '/piece-r2.txt', 'piece-r2.txt', u_dominique);
  insert into storage.objects (bucket_id, name)
  values ('request-attachments', org1::text || '/' || r2::text || '/piece-r2.txt');

  insert into public.request_messages (organization_id, request_id, author_id, body)
  values (org1, r1, u_alex, 'Note interne sur R1');
  insert into public.request_attachments (organization_id, request_id, storage_path, file_name, uploaded_by)
  values (org1, r1, org1::text || '/' || r1::text || '/piece-r1.txt', 'piece-r1.txt', u_alex);
  insert into storage.objects (bucket_id, name)
  values ('request-attachments', org1::text || '/' || r1::text || '/piece-r1.txt');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.request_messages where request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-18: Camille voit les notes internes de R2'; end if;
  select count(*) into v_int from public.request_attachments where request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-18: Camille voit les pièces de R2'; end if;
  select count(*) into v_int from public.request_events where request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-18: Camille voit le journal de R2'; end if;
  select count(*) into v_int from public.request_assignments where request_id = r2;
  if v_int <> 0 then v_fail := v_fail || 'CA-18: Camille voit l''historique d''affectation de R2'; end if;
  select count(*) into v_int from storage.objects
   where bucket_id = 'request-attachments' and name = org1::text || '/' || r2::text || '/piece-r2.txt';
  if v_int <> 0 then v_fail := v_fail || 'CA-18: Camille voit l''objet storage de R2 (hors périmètre)'; end if;

  -- Contrôle positif : Camille voit bien la note, la pièce et l'objet
  -- storage de R1 (Voirie/D1, dans son périmètre).
  select count(*) into v_int from public.request_messages where request_id = r1;
  if v_int <> 1 then v_fail := v_fail || 'CA-18 (positif): Camille ne voit pas la note de R1'; end if;
  select count(*) into v_int from public.request_attachments where request_id = r1;
  if v_int <> 1 then v_fail := v_fail || 'CA-18 (positif): Camille ne voit pas la pièce de R1'; end if;
  select count(*) into v_int from storage.objects
   where bucket_id = 'request-attachments' and name = org1::text || '/' || r1::text || '/piece-r1.txt';
  if v_int <> 1 then v_fail := v_fail || 'CA-18 (positif): Camille ne voit pas l''objet storage de R1'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- Item 2 (E-1, revue de sécurité) : UPDATE client direct de
  -- socle_scope_org_id → valeur RECALCULÉE par t09 (désormais inconditionnel),
  -- jamais celle envoyée par le client, même sans toucher
  -- socle_organization_id dans le même UPDATE. R5 (petit-enfant, D1) : encore
  -- 'a_traiter', non archivée (CA-12 n'a touché qu'assigned_to) — utilisée
  -- plutôt que R1 (archivée depuis CA-09, où toute écriture cliente est de
  -- toute façon bloquée par le gel des archivées, masquant ce test précis).
  -- ==========================================================================
  -- Item F-7 (revue de sécurité) : id ajoutée aux colonnes immuables de
  -- requests_protect_immutable — une UPDATE client qui tente de réécrire id
  -- est refusée, y compris pour quelqu'un ayant par ailleurs tous les
  -- droits d'écriture sur la ligne visée.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.requests set id = gen_random_uuid() where id = r5;
    v_fail := v_fail || 'ItemF7: id de la demande modifiable par UPDATE';
  exception when others then null;
  end;
  select count(*) into v_int from public.requests where id = r5;
  if v_int <> 1 then v_fail := v_fail || 'ItemF7: R5 a disparu de son id d''origine malgré le refus attendu'; end if;
  execute 'reset role';

  -- ==========================================================================
  -- Item F-3 (revue de sécurité) : permission_profiles_select restreinte —
  -- un agent (Camille, non-admin) ne voit QUE les profils auxquels IL est
  -- attribué, pas la topologie complète du tenant (p_alex, p_morgane…).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.permission_profiles where id = p_camille;
  if v_int <> 1 then v_fail := v_fail || 'ItemF3: Camille ne voit pas son propre profil'; end if;
  select count(*) into v_int from public.permission_profiles where id in (p_alex, p_morgane);
  if v_int <> 0 then v_fail := v_fail || 'ItemF3: Camille voit des profils auxquels elle n''est pas attribuée (fuite de topologie)'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.requests set socle_scope_org_id = s_ccas where id = r5;
  select socle_scope_org_id into v_uuid from public.requests where id = r5;
  if v_uuid is distinct from s_petit then
    v_fail := v_fail || 'Item2 (E-1): socle_scope_org_id a conservé la valeur cliente au lieu d''être recalculée par t09';
  end if;
  execute 'reset role';

  -- ==========================================================================
  -- Item 3 (E-2/M-2, revue de sécurité) — storage : la branche « brouillon »
  -- ne doit JAMAIS traiter une demande EXISTANTE mais invisible comme un
  -- brouillon (request_exists, hors RLS, remplace le not exists soumis au
  -- RLS de l'appelant).
  -- ==========================================================================
  -- 3.a Pièce d'une demande EXISTANTE (R2, CCAS/D2) mais invisible pour
  -- Camille : même « déposée » par elle (owner_id), ni SELECT ni DELETE.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('request-attachments', org1::text || '/' || r2::text || '/piece-r2-camille.txt', u_camille::text);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_camille, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from storage.objects
   where bucket_id = 'request-attachments' and name = org1::text || '/' || r2::text || '/piece-r2-camille.txt';
  if v_int <> 0 then
    v_fail := v_fail || 'Item3.a (E-2): l''ancien déposant garde SELECT sur une pièce d''une demande existante mais invisible';
  end if;
  delete from storage.objects
   where bucket_id = 'request-attachments' and name = org1::text || '/' || r2::text || '/piece-r2-camille.txt';
  get diagnostics v_int = row_count;
  if v_int <> 0 then
    v_fail := v_fail || 'Item3.a (E-2): l''ancien déposant a pu supprimer une pièce d''une demande existante mais invisible';
  end if;
  execute 'reset role';

  -- 3.b Dépôt SOUS le chemin d'une demande EXISTANTE (R1, Voirie/D1) sans
  -- droit d'instruction : le guichet a la création (has_any_creation_right),
  -- mais pas l'instruction sur R1 → refus (M-2, durcissement de l'INSERT).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_guichet, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('request-attachments', org1::text || '/' || r1::text || '/piece-r1-guichet.txt', u_guichet::text);
    v_fail := v_fail || 'Item3.b (M-2): dépôt sous une demande existante accepté sans droit d''instruction';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- Item 4 (M-1, revue de sécurité) : RM-16 dès la CRÉATION — une demande ne
  -- peut pas naître affectée à un agent sans droit d'instruction sur son
  -- couple (le guichet a la création sur D1/racine, u_lecteur n'a que la
  -- consultation : aucun droit d'instruction).
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_guichet, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.requests (organization_id, subject, socle_procedure_id, procedure_snapshot,
                                  socle_organization_id, assigned_to)
    values (org1, 'Créée avec affectation invalide', proc_d1, snap_d1, s_root, u_lecteur);
    v_fail := v_fail || 'Item4 (M-1): création avec affectation à un agent sans droit d''instruction acceptée';
  exception when others then null;
  end;
  execute 'reset role';

  -- ==========================================================================
  -- Équivalence user_has_request_right ⟺ permission_pairs_of.
  -- ==========================================================================
  if public.user_has_request_right(u_camille, org1, s_voirie, proc_d1, 'instruction')
     is distinct from exists (
       select 1 from public.permission_pairs_of(
                array(select a.profile_id from public.permission_profile_assignments a
                        join public.permission_profiles p on p.id = a.profile_id
                       where a.user_id = u_camille and a.organization_id = org1 and p.status = 'active'),
                'instruction', org1) s
        where s.socle_org_id = s_voirie and s.socle_procedure_id = proc_d1
     ) then
    v_fail := v_fail || 'Équivalence: user_has_request_right(Camille, Voirie, D1, instruction) diverge de permission_pairs_of';
  end if;

  if public.user_has_request_right(u_dominique, org1, s_ccas, proc_d2, 'cloture')
     is distinct from exists (
       select 1 from public.permission_pairs_of(
                array(select a.profile_id from public.permission_profile_assignments a
                        join public.permission_profiles p on p.id = a.profile_id
                       where a.user_id = u_dominique and a.organization_id = org1 and p.status = 'active'),
                'cloture', org1) s
        where s.socle_org_id = s_ccas and s.socle_procedure_id = proc_d2
     ) then
    v_fail := v_fail || 'Équivalence: user_has_request_right(Dominique, CCAS, D2, cloture) diverge de permission_pairs_of';
  end if;

  -- ==========================================================================
  -- CL-22 — verrou optimiste : la seconde écriture concurrente est refusée.
  -- ==========================================================================
  declare v_lock_version int; begin
    select version into v_lock_version from public.permission_profiles where id = p_guichet;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- Première écriture (version courante) : réussit.
    perform public.save_permission_profile(jsonb_build_object(
      'profile_id', p_guichet, 'organization_id', org1, 'name', 'Guichet-D1-Creation',
      'description', 'Première modification concurrente', 'is_admin', false,
      'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_root),
      'procedures', jsonb_build_array(jsonb_build_object('id', proc_d1, 'rights', jsonb_build_array('creation'))),
      'expected_version', v_lock_version));
    -- Seconde écriture avec la MÊME version périmée : refusée.
    begin
      perform public.save_permission_profile(jsonb_build_object(
        'profile_id', p_guichet, 'organization_id', org1, 'name', 'Guichet-D1-Creation',
        'description', 'Seconde modification concurrente (version périmée)', 'is_admin', false,
        'default_rights', '[]'::jsonb, 'organizations', jsonb_build_array(s_root),
        'procedures', jsonb_build_array(jsonb_build_object('id', proc_d1, 'rights', jsonb_build_array('creation'))),
        'expected_version', v_lock_version));
      v_fail := v_fail || 'CL-22: écriture concurrente avec version périmée acceptée';
    exception when others then null;
    end;
    execute 'reset role';
  end;

  -- ==========================================================================
  -- « Admin plateforme SANS AUCUN PROFIL peut sauvegarder un profil » — RM-24.
  -- u_platform n'est même pas membre du tenant (is_platform_admin() court-
  -- circuite aussi is_org_admin_anywhere) : contrôle direct que le
  -- contournement RM-24 est bien is_platform_admin() — jamais
  -- is_service_context(), qui ne serait pas fiable ici (les RPC sont toutes
  -- SECURITY DEFINER, voir l'en-tête de ce fichier et de M4/M5).
  -- ==========================================================================
  declare
    u_platform uuid := gen_random_uuid();
    v_platform_result jsonb;
  begin
    insert into auth.users (id, email, created_at, updated_at)
    values (u_platform, 'platform-admin@t1.test', now(), now());
    update public.users set is_platform_admin = true where id = u_platform;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_platform, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.save_permission_profile(jsonb_build_object(
      'organization_id', org1, 'name', 'Platform-Admin-Sans-Profil', 'is_admin', true,
      'default_rights', jsonb_build_array('consultation', 'creation', 'instruction', 'cloture'),
      'organizations', jsonb_build_array(s_root), 'procedures', '[]'::jsonb))
      into v_platform_result;
    if (v_platform_result ->> 'id') is null then
      v_fail := v_fail || 'Admin plateforme sans profil : n''a pas pu sauvegarder un profil (RM-24)';
    end if;
    execute 'reset role';
  end;

  -- ==========================================================================
  -- Tenant NEUF — le PREMIER profil doit pouvoir naître (RM-42 différentiel).
  -- Régression du verrou circulaire constaté le 2026-09-13 (tenant SNA27) :
  -- sur un tenant sans aucun administrateur racine, save_permission_profile
  -- refusait TOUT premier profil au nom de l'invariant du dernier
  -- administrateur — donc aucun administrateur ne pouvait jamais être
  -- attribué, donc aucun profil ne pouvait naître. Le décor de ce fichier ne
  -- pouvait pas le voir : ses profils sont tous semés par `insert` direct en
  -- contexte postgres, et la RPC n'était appelée que sur un tenant qui avait
  -- DÉJÀ son administrateur racine. On rejoue donc le geste RÉEL — par la RPC,
  -- sur un tenant vierge — puis on vérifie que l'invariant s'arme dès qu'il
  -- est satisfait.
  -- ==========================================================================
  declare
    s_root3  uuid := gen_random_uuid();
    proc_t3  uuid := gen_random_uuid();
    org3     uuid;
    u_neuf   uuid := gen_random_uuid();  -- admin plateforme qui ouvre le tenant
    u_agent3 uuid := gen_random_uuid();
    p_admin3 uuid;
    v_r      jsonb;
  begin
    insert into auth.users (id, email, created_at, updated_at) values
      (u_neuf,   'plateforme@t3.test', now(), now()),
      (u_agent3, 'agent@t3.test',      now(), now());
    update public.users set is_platform_admin = true where id = u_neuf;

    insert into public.organizations (socle_org_id, name)
    values (s_root3, 'Tenant Neuf') returning id into org3;
    insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name)
    values (org3, s_root3, null, 'Racine Tenant Neuf');
    insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc_t3, org3, s_root3, 'Démarche tenant neuf');
    insert into public.organization_members (organization_id, user_id, role)
    values (org3, u_agent3, 'agent');

    if public.tenant_has_root_admin(org3) then
      v_fail := v_fail || 'Tenant neuf : un administrateur racine est détecté alors que le tenant est vierge';
    end if;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', u_neuf, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    -- 1. Le tout premier profil (administrateur) doit être ACCEPTÉ.
    begin
      select public.save_permission_profile(jsonb_build_object(
        'organization_id', org3, 'name', 'Administrateur', 'is_admin', true,
        'default_rights', jsonb_build_array('consultation', 'creation', 'instruction', 'cloture'),
        'organizations', jsonb_build_array(s_root3), 'procedures', '[]'::jsonb)) into v_r;
      p_admin3 := (v_r ->> 'id')::uuid;
    exception when others then
      v_fail := v_fail || ('Tenant neuf : le premier profil a été refusé (' || sqlerrm || ')');
    end;

    if p_admin3 is not null then
      -- 2. Un second profil, non administrateur, AVANT toute attribution : le
      --    tenant n'a toujours aucun administrateur racine, ce n'est pas un
      --    motif de refus.
      begin
        perform public.save_permission_profile(jsonb_build_object(
          'organization_id', org3, 'name', 'Agent', 'is_admin', false,
          'default_rights', jsonb_build_array('consultation', 'creation', 'instruction', 'cloture'),
          'organizations', jsonb_build_array(s_root3), 'procedures', '[]'::jsonb));
      exception when others then
        v_fail := v_fail || ('Tenant neuf : le second profil a été refusé (' || sqlerrm || ')');
      end;

      -- 3. L'attribution : le tenant acquiert son administrateur racine.
      perform public.assign_permission_profile(p_admin3, u_agent3);

      -- Vérifications en contexte postgres : tenant_has_root_admin est interne
      -- (EXECUTE révoqué d'authenticated), l'appeler sous ce rôle échouerait.
      execute 'reset role';
      if not public.tenant_has_root_admin(org3) then
        v_fail := v_fail || 'Tenant neuf : l''attribution du profil administrateur ne donne pas d''administrateur racine';
      end if;
      select version into v_version from public.permission_profiles where id = p_admin3;
      execute 'set local role authenticated';

      -- 4. L'invariant est DÈS LORS armé : retirer ce seul administrateur est refusé.
      begin
        perform public.revoke_permission_profile(p_admin3, u_agent3);
        v_fail := v_fail || 'Tenant neuf : le dernier administrateur racine a pu être retiré';
      exception when others then null;
      end;

      -- 5. ... et désactiver son profil est refusé de la même manière.
      begin
        perform public.set_permission_profile_status(p_admin3, 'inactive', v_version);
        v_fail := v_fail || 'Tenant neuf : le profil du dernier administrateur racine a pu être désactivé';
      exception when others then null;
      end;

      execute 'reset role';
      if not public.tenant_has_root_admin(org3) then
        v_fail := v_fail || 'Tenant neuf : l''administrateur racine a disparu malgré les deux refus attendus';
      end if;
    else
      execute 'reset role';
    end if;
  end;

  -- ==========================================================================
  -- CA-14 / CL-16 — dernier administrateur. DERNIER bloc à toucher
  -- l'administration d'Alex : le retrait, une fois réussi, le prive
  -- durablement de is_org_admin_anywhere pour le reste du script.
  -- ==========================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- Étape 1 : Alex retire l'administration de Morgane (Alex reste seul admin racine).
  perform public.revoke_permission_profile(p_morgane, u_morgane);

  -- Item 1 (revue de sécurité, redesign pré-image) : « sole root admin
  -- renomme son propre profil → OK ». Sous l'ANCIENNE logique (exclusion
  -- post-mutation), Alex — dont l'unique profil est celui édité — se serait
  -- vu refuser jusqu'à ce simple renommage (RM-51, cas du fondateur).
  declare v_alex_version int; v_rename_result jsonb; begin
    select version into v_alex_version from public.permission_profiles where id = p_alex;
    select public.save_permission_profile(jsonb_build_object(
      'profile_id', p_alex, 'organization_id', org1, 'name', 'Alex-Admin-Tous-Renomme',
      'is_admin', true, 'default_rights', jsonb_build_array('consultation', 'creation', 'instruction', 'cloture'),
      'organizations', jsonb_build_array(s_root), 'procedures', '[]'::jsonb,
      'expected_version', v_alex_version))
      into v_rename_result;
    if (v_rename_result ->> 'id')::uuid is distinct from p_alex then
      v_fail := v_fail || 'Item1: le dernier administrateur n''a pas pu renommer son propre profil';
    end if;
    select name into v_text from public.permission_profiles where id = p_alex;
    if v_text <> 'Alex-Admin-Tous-Renomme' then
      v_fail := v_fail || 'Item1: le renommage n''a pas été appliqué';
    end if;
  end;

  -- « sole root admin rétrécit son propre profil en retirant la racine →
  -- refusé (dernier administrateur) ». Ici, la pré-image (v_pre) ne bloque
  -- RIEN (un rétrécissement n'accorde jamais un droit non détenu) : c'est
  -- assert_tenant_keeps_root_admin, appelée après la mutation, qui refuse.
  declare v_alex_version2 int; begin
    select version into v_alex_version2 from public.permission_profiles where id = p_alex;
    begin
      perform public.save_permission_profile(jsonb_build_object(
        'profile_id', p_alex, 'organization_id', org1, 'name', 'Alex-Admin-Tous-Renomme',
        'is_admin', true, 'default_rights', jsonb_build_array('consultation', 'creation', 'instruction', 'cloture'),
        'organizations', jsonb_build_array(s_voirie), 'procedures', '[]'::jsonb,
        'expected_version', v_alex_version2));
      v_fail := v_fail || 'Item1: le dernier administrateur a pu retirer la racine de son propre profil';
    exception when others then null;
    end;
    if not exists (select 1 from public.permission_profile_organizations
                    where profile_id = p_alex and socle_org_id = s_root) then
      v_fail := v_fail || 'Item1: la racine a disparu du périmètre du profil malgré le refus attendu';
    end if;
  end;

  -- Étape 2 : Alex, désormais SEUL administrateur racine, tente de se retirer
  -- lui-même → refusé.
  begin
    perform public.revoke_permission_profile(p_alex, u_alex);
    v_fail := v_fail || 'CA-14/CL-16: le dernier administrateur a pu se retirer lui-même';
  exception when others then null;
  end;
  if not public.is_org_admin_anywhere(org1) then
    v_fail := v_fail || 'CA-14/CL-16: Alex a perdu l''administration malgré le refus (transaction non annulée par l''échec)';
  end if;

  -- « Retrait du dernier membre admin racine » via DELETE organization_members
  -- (chemin M7 — is_last_root_admin + organization_members_protect_last_admin
  -- — hors des RPC de M5) : Alex, encore seul admin racine à ce stade,
  -- tente de se retirer lui-même DU TENANT → refusé également.
  begin
    delete from public.organization_members where organization_id = org1 and user_id = u_alex;
    v_fail := v_fail || 'CA-14/CL-16: le dernier membre admin racine a pu être retiré du tenant (DELETE organization_members)';
  exception when others then null;
  end;
  select count(*) into v_int from public.organization_members where organization_id = org1 and user_id = u_alex;
  if v_int <> 1 then
    v_fail := v_fail || 'CA-14/CL-16: Alex a disparu de organization_members malgré le refus attendu';
  end if;

  -- Étape 3 : un second administrateur racine est recréé, puis Alex se
  -- retire à nouveau → réussit cette fois.
  perform public.assign_permission_profile(p_morgane, u_morgane);
  perform public.revoke_permission_profile(p_alex, u_alex);
  execute 'reset role';

  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_alex, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.is_org_admin_anywhere(org1) then
    v_fail := v_fail || 'CA-14/CL-16: Alex détient encore l''administration après un retrait qui aurait dû réussir';
  end if;
  execute 'reset role';

  -- ==========================================================================
  -- Verdict — l'exception finale annule TOUTE la transaction.
  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (profils de droits) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%s) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
