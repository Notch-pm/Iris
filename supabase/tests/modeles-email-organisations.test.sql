-- ============================================================================
-- Tests de l'activation des modèles d'e-mail organisation par organisation.
--
-- La règle tenue ici : activer un modèle sur une organisation est une décision
-- SUR CETTE ORGANISATION. Ce n'est donc pas `is_org_admin_anywhere` (qui
-- gouverne l'écriture du modèle lui-même, objet de tenant) mais
-- `has_admin_scope(tenant, socle_org)` — d'où le décor à DEUX administrateurs
-- de portées différentes, qui est le cœur de ce fichier.
--
-- Et : **un modèle neuf n'est activé nulle part**. L'ouverture est un geste.
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_a uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_ccas uuid := gen_random_uuid();
  s_b uuid := gen_random_uuid();
  orgA uuid; orgB uuid; p_id uuid; t_id uuid; t_b uuid;
  u_admin_racine uuid := gen_random_uuid();  -- administre TOUT le tenant A
  u_admin_voirie uuid := gen_random_uuid();  -- administre la Voirie SEULE
  u_agent        uuid := gen_random_uuid();  -- aucune administration
  u_admin_b      uuid := gen_random_uuid();  -- administrateur d'un AUTRE tenant
  v_fail text[] := '{}';
  v_int int;
begin
  -- ==========================================================================
  -- MISE EN PLACE
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin_racine, 'ar@o.test', now(), now()),
    (u_admin_voirie, 'av@o.test', now(), now()),
    (u_agent,        'ag@o.test', now(), now()),
    (u_admin_b,      'ab@o.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_a, 'A') returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_b, 'B') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_admin_racine, 'agent'), (orgA, u_admin_voirie, 'agent'), (orgA, u_agent, 'agent'),
    (orgB, u_admin_b, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_a, null, 'Mairie A'), (orgA, s_voirie, s_a, 'Voirie'), (orgA, s_ccas, s_a, 'CCAS'),
    (orgB, s_b, null, 'Mairie B');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Admin racine', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_a);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_admin_racine);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Admin voirie', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_admin_voirie);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Agent', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_a);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgB, 'Admin B', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_b);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_admin_b);

  insert into public.email_templates (organization_id, name, subject, body, created_by)
  values (orgA, 'M', 'Objet', 'Corps', u_admin_racine) returning id into t_id;
  insert into public.email_templates (organization_id, name, subject, body, created_by)
  values (orgB, 'MB', 'Objet', 'Corps', u_admin_b) returning id into t_b;

  -- ==========================================================================
  -- O1. Un modèle NEUF n'est activé nulle part
  -- ==========================================================================
  select count(*) into v_int from public.email_template_organizations where template_id = t_id;
  if v_int <> 0 then v_fail := v_fail || 'O1: un modèle neuf est déjà activé quelque part'::text; end if;

  -- ==========================================================================
  -- O2 / O3. L'administrateur racine couvre tout le tenant
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_racine, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.email_template_organizations (template_id, socle_org_id, created_by)
    values (t_id, s_voirie, u_admin_racine), (t_id, s_ccas, u_admin_racine);
  get diagnostics v_int = row_count;
  if v_int <> 2 then v_fail := v_fail || 'O2: l''administrateur racine ne peut pas activer'::text; end if;

  select count(*) into v_int from public.administrable_organizations(orgA);
  if v_int <> 3 then
    v_fail := v_fail || format('O3: %s organisations administrables au lieu de 3', v_int); end if;

  -- ==========================================================================
  -- O4 / O5. L'administrateur de la Voirie est borné à SA branche
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_voirie, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.administrable_organizations(orgA);
  if v_int <> 1 then
    v_fail := v_fail || format('O4a: l''administrateur Voirie voit %s organisations au lieu de 1', v_int); end if;
  select count(*) into v_int from public.administrable_organizations(orgA) where socle_org_id = s_voirie;
  if v_int <> 1 then v_fail := v_fail || 'O4b: l''administrateur Voirie ne voit pas SA branche'::text; end if;

  delete from public.email_template_organizations where template_id = t_id and socle_org_id = s_voirie;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'O5a: il ne peut pas désactiver sur SA branche'::text; end if;

  insert into public.email_template_organizations (template_id, socle_org_id, created_by)
    values (t_id, s_voirie, u_admin_voirie);
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'O5b: il ne peut pas activer sur SA branche'::text; end if;

  -- Le CCAS n'est pas à lui : ni désactivation…
  delete from public.email_template_organizations where template_id = t_id and socle_org_id = s_ccas;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'O5c: il a pu DÉSACTIVER sur le CCAS'::text; end if;
  -- …ni activation sur la racine.
  begin
    insert into public.email_template_organizations (template_id, socle_org_id, created_by)
      values (t_id, s_a, u_admin_voirie);
    v_fail := v_fail || 'O5d: il a pu activer sur la RACINE'::text;
  exception when others then null;   -- toute erreur vaut refus : c'est le but
  end;

  -- ==========================================================================
  -- O6. Un agent lit, mais n'active rien — et n'administre rien
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.email_template_organizations where template_id = t_id;
  if v_int = 0 then v_fail := v_fail || 'O6a: un agent ne lit pas les rattachements'::text; end if;
  begin
    insert into public.email_template_organizations (template_id, socle_org_id, created_by)
      values (t_id, s_ccas, u_agent);
    v_fail := v_fail || 'O6b: un agent a pu activer un modèle'::text;
  exception when others then null;
  end;
  select count(*) into v_int from public.administrable_organizations(orgA);
  if v_int <> 0 then
    v_fail := v_fail || format('O6c: un agent voit %s organisations administrables', v_int); end if;

  -- ==========================================================================
  -- O7 / O8. Étanchéité cross-tenant, et garde de cohérence
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_racine, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.email_template_organizations where template_id = t_b;
  if v_int <> 0 then v_fail := v_fail || 'O7a: FUITE — rattachements d''un autre tenant visibles'::text; end if;
  begin
    insert into public.email_template_organizations (template_id, socle_org_id, created_by)
      values (t_b, s_b, u_admin_racine);
    v_fail := v_fail || 'O7b: activation d''un modèle d''un AUTRE tenant'::text;
  exception when others then null;
  end;

  -- Un modèle de A activé sur une organisation de B : aucune FK ne peut
  -- l'interdire ici, c'est le trigger t01 qui tient la cohérence.
  begin
    insert into public.email_template_organizations (template_id, socle_org_id, created_by)
      values (t_id, s_b, u_admin_racine);
    v_fail := v_fail || 'O8: activation sur une organisation HORS tenant'::text;
  exception when others then null;
  end;

  -- ==========================================================================
  -- O9. Supprimer le modèle emporte ses rattachements
  -- ==========================================================================
  execute 'reset role';
  select count(*) into v_int from public.email_template_organizations where template_id = t_id;
  if v_int = 0 then v_fail := v_fail || 'O9a: décor vide avant la cascade'::text; end if;
  delete from public.email_templates where id = t_id;
  select count(*) into v_int from public.email_template_organizations where template_id = t_id;
  if v_int <> 0 then v_fail := v_fail || 'O9b: rattachements orphelins après suppression'::text; end if;

  -- ==========================================================================
  -- O10. La RPC reste fermée aux anonymes
  -- ==========================================================================
  if has_function_privilege('anon', 'public.administrable_organizations(uuid)', 'execute') then
    v_fail := v_fail || 'O10: administrable_organizations exécutable par anon'::text; end if;

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (activation par organisation) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
