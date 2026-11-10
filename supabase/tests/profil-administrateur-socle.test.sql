-- ============================================================================
-- Tests du profil système « Administrateur », attribué par le Socle
-- (migration `profil_administrateur_socle`, 2026-11-10).
--
-- Motif des autres tests : un bloc `DO` qui finit par un `raise exception`
-- volontaire s'annule lui-même et ne laisse aucune donnée.
--
-- Les règles tenues :
--   E. ensure_system_admin_profile REPREND le profil « Administrateur »
--      existant (normalisé : périmètre = la racine, matrice vide, tous droits)
--      et est idempotent ; il le CRÉE là où il manque.
--   V. LE PROFIL SYSTÈME EST VERROUILLÉ dans Iris : ni renommé, ni désactivé,
--      ni supprimé, ni périmètre ni matrice modifiés, ni attribué ni retiré —
--      même par le propriétaire, même par les RPC d'administration.
--   S. LA PORTE DU SOCLE (socle_set_admin_profile) attribue et retire, journal
--      compris ; elle ne retire jamais le dernier administrateur racine.
--   C. LES CASCADES PASSENT : un membre retiré du tenant emporte l'attribution.
--   A. Les autres profils restent libres.
--
-- Exécution : contexte postgres (SQL editor, ou `execute_sql`) — l'échec final
-- VOLONTAIRE annule la transaction.
-- ============================================================================

do $main$
declare
  s_root uuid := gen_random_uuid();
  s_svc  uuid := gen_random_uuid();
  s_root2 uuid := gen_random_uuid();
  org1 uuid; org2 uuid;
  u_a uuid := gen_random_uuid();   -- administrateur historique (profil repris)
  u_b uuid := gen_random_uuid();   -- agent promu par le Socle
  u_c uuid := gen_random_uuid();   -- agent simple
  p_old uuid; p_sys uuid; p_sys2 uuid; p_free uuid;
  v_fail text[] := '{}';
  v_text text; v_int int; v_bool boolean;
begin
  insert into auth.users (id, email, created_at, updated_at) values
    (u_a, 'a@sys.test', now(), now()), (u_b, 'b@sys.test', now(), now()), (u_c, 'c@sys.test', now(), now());
  insert into public.organizations (socle_org_id, name) values (s_root, 'Ville Système') returning id into org1;
  insert into public.organizations (socle_org_id, name) values (s_root2, 'Ville Neuve') returning id into org2;
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (org1, s_root, null, 'Ville'), (org1, s_svc, s_root, 'Service'), (org2, s_root2, null, 'Neuve');
  insert into public.organization_members (organization_id, user_id, role) values
    (org1, u_a, 'agent'), (org1, u_b, 'agent'), (org1, u_c, 'agent');

  -- Profil « Administrateur » de reprise, périmètre racine + service, une ligne de matrice.
  insert into public.permission_profiles (organization_id, name, is_admin, default_view, default_create, default_process, default_close)
  values (org1, 'Administrateur', true, true, true, true, true) returning id into p_old;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_old, s_root), (p_old, s_svc);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view)
  values (p_old, public.nil_procedure(), true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_old, u_a);

  -- E ------------------------------------------------------------------------
  p_sys := public.ensure_system_admin_profile(org1);
  if p_sys is distinct from p_old then v_fail := v_fail || 'E1: le profil existant n''est pas repris'; end if;
  select system_key into v_text from public.permission_profiles where id = p_sys;
  if v_text is distinct from 'admin' then v_fail := v_fail || 'E2: system_key non posé'; end if;
  select count(*) into v_int from public.permission_profile_organizations where profile_id = p_sys;
  if v_int <> 1 or not exists (select 1 from public.permission_profile_organizations where profile_id = p_sys and socle_org_id = s_root) then
    v_fail := v_fail || format('E3: périmètre non normalisé (%s lignes)', v_int);
  end if;
  if exists (select 1 from public.permission_profile_procedures where profile_id = p_sys) then
    v_fail := v_fail || 'E4: matrice non vidée';
  end if;
  if not exists (select 1 from public.permission_profile_assignments where profile_id = p_sys and user_id = u_a) then
    v_fail := v_fail || 'E5: attribution historique perdue';
  end if;
  if public.ensure_system_admin_profile(org1) is distinct from p_sys then v_fail := v_fail || 'E6: non idempotent'; end if;
  p_sys2 := public.ensure_system_admin_profile(org2);
  if p_sys2 is null or not exists (select 1 from public.permission_profiles where id = p_sys2 and system_key = 'admin' and is_admin and default_close) then
    v_fail := v_fail || 'E7: profil système non créé pour un tenant sans profil';
  end if;

  -- V ------------------------------------------------------------------------
  begin
    update public.permission_profiles set name = 'Admin bis' where id = p_sys;
    v_fail := v_fail || 'V1: profil système renommé';
  exception when insufficient_privilege then null; end;
  begin
    update public.permission_profiles set status = 'inactive' where id = p_sys;
    v_fail := v_fail || 'V2: profil système désactivé';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.permission_profiles where id = p_sys;
    v_fail := v_fail || 'V3: profil système supprimé';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_sys, s_svc);
    v_fail := v_fail || 'V4: périmètre du profil système modifié';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view) values (p_sys, public.nil_procedure(), true);
    v_fail := v_fail || 'V5: matrice du profil système modifiée';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id) values (org1, p_sys, u_c);
    v_fail := v_fail || 'V6: profil système attribué hors Socle';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.permission_profile_assignments where profile_id = p_sys and user_id = u_a;
    v_fail := v_fail || 'V7: profil système retiré hors Socle';
  exception when insufficient_privilege then null; end;
  begin
    update public.permission_profiles set system_key = 'admin' where organization_id = org1 and id <> p_sys;
    insert into public.permission_profiles (organization_id, name, system_key) values (org1, 'Faux système', 'admin');
    v_fail := v_fail || 'V8: un profil se déclare système hors Socle';
  exception when insufficient_privilege or unique_violation then null; end;

  -- Les RPC d'administration butent aussi (appel en tant qu'administrateur du tenant).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.assign_permission_profile(p_sys, u_c);
    v_fail := v_fail || 'V9: assign_permission_profile attribue le profil système';
  exception when others then
    if sqlerrm not like '%Socle%' then v_fail := v_fail || format('V9: refus inattendu (%s)', sqlerrm); end if;
  end;
  begin
    perform public.delete_permission_profile(p_sys, (select version from public.permission_profiles where id = p_sys));
    v_fail := v_fail || 'V10: delete_permission_profile supprime le profil système';
  exception when others then null; end;
  execute 'reset role';

  -- S ------------------------------------------------------------------------
  v_text := public.socle_set_admin_profile(org1, u_a, false);
  if v_text <> 'kept_last_admin' then v_fail := v_fail || format('S1: dernier administrateur → %s', v_text); end if;
  v_text := public.socle_set_admin_profile(org1, u_b, true);
  if v_text <> 'granted' then v_fail := v_fail || format('S2: attribution → %s', v_text); end if;
  select role into v_text from public.organization_members where organization_id = org1 and user_id = u_b;
  if v_text is distinct from 'administrateur' then v_fail := v_fail || format('S3: rôle dérivé %s', v_text); end if;
  if public.socle_set_admin_profile(org1, u_b, true) <> 'unchanged' then v_fail := v_fail || 'S4: attribution non idempotente'; end if;
  v_text := public.socle_set_admin_profile(org1, u_a, false);
  if v_text <> 'revoked' then v_fail := v_fail || format('S5: retrait → %s', v_text); end if;
  if not exists (select 1 from public.permission_audit_log where profile_id = p_sys and target_user_id = u_a and action = 'assignment_revoked') then
    v_fail := v_fail || 'S6: retrait non journalisé';
  end if;
  if public.socle_set_admin_profile(org2, u_c, true) <> 'not_member' then v_fail := v_fail || 'S7: non-membre accepté'; end if;

  -- C ------------------------------------------------------------------------
  perform public.socle_set_admin_profile(org1, u_c, true);
  delete from public.organization_members where organization_id = org1 and user_id = u_c;
  if exists (select 1 from public.permission_profile_assignments where profile_id = p_sys and user_id = u_c) then
    v_fail := v_fail || 'C1: attribution survivante au retrait du membre';
  end if;

  -- A ------------------------------------------------------------------------
  insert into public.permission_profiles (organization_id, name) values (org1, 'Guichet') returning id into p_free;
  update public.permission_profiles set name = 'Guichet central' where id = p_free;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_free, s_svc);
  delete from public.permission_profiles where id = p_free;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (profil système Administrateur) — transaction annulée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end;
$main$;
