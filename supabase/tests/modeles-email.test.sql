-- ============================================================================
-- Tests des modèles d'e-mail.
--
-- Deux frontières tenues ici :
--   · l'ÉCRITURE est réservée aux administrateurs du tenant, la LECTURE est
--     ouverte à tout membre (un agent choisira un modèle depuis une demande en
--     vague 2, rien ne justifie de le lui cacher d'ici là) ;
--   · les VARIABLES sont un contrat : `{{demande.inexistant}}` fait échouer
--     l'écriture, garde serveur `t03_email_templates_guard_variables` — l'écran
--     n'en est que le reflet, les scénarios attaquent donc l'insertion
--     directement.
--
-- Décor : deux tenants (étanchéité cross-tenant) et, dans le tenant A, un
-- administrateur et un agent non administrateur (étanchéité intra-tenant).
--
-- Exécution : bloc DO dans un contexte postgres en lecture-écriture (SQL editor
-- du dashboard ; le MCP execute_sql est en lecture seule → apply_migration,
-- l'échec final VOLONTAIRE annule la transaction).
-- ============================================================================

do $main$
declare
  s_a      uuid := gen_random_uuid();
  s_voirie uuid := gen_random_uuid();
  s_b      uuid := gen_random_uuid();
  orgA uuid; orgB uuid;
  proc_d1 uuid := gen_random_uuid();
  u_admin_a uuid := gen_random_uuid();  -- administrateur du tenant A
  u_agent_a uuid := gen_random_uuid();  -- agent SANS administration
  u_admin_b uuid := gen_random_uuid();  -- administrateur d'un AUTRE tenant
  p_id uuid; t_id uuid; t_b uuid;
  v_fail text[] := '{}';
  v_int  int;
  v_text text;
begin
  -- ==========================================================================
  -- MISE EN PLACE (postgres, hors RLS)
  -- ==========================================================================
  insert into auth.users (id, email, created_at, updated_at) values
    (u_admin_a, 'admin-a@t.test', now(), now()),
    (u_agent_a, 'agent-a@t.test', now(), now()),
    (u_admin_b, 'admin-b@t.test', now(), now());

  insert into public.organizations (socle_org_id, name) values (s_a, 'Tenant A') returning id into orgA;
  insert into public.organizations (socle_org_id, name) values (s_b, 'Tenant B') returning id into orgB;
  insert into public.organization_members (organization_id, user_id, role) values
    (orgA, u_admin_a, 'agent'), (orgA, u_agent_a, 'agent'), (orgB, u_admin_b, 'agent');
  insert into public.socle_organizations (organization_id, socle_id, socle_parent_id, name) values
    (orgA, s_a, null, 'Mairie A'), (orgA, s_voirie, s_a, 'Voirie'), (orgB, s_b, null, 'Mairie B');
  insert into public.socle_procedure_cache (socle_id, organization_id, socle_root_org_id, name)
    values (proc_d1, orgA, s_a, 'D1');

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Admin A', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_a);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_admin_a);

  -- Instruction, mais AUCUNE administration : c'est le cas qui doit échouer en
  -- écriture tout en réussissant en lecture.
  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgA, 'Agent A', false) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_voirie);
  insert into public.permission_profile_procedures (profile_id, socle_procedure_id, right_view, right_process)
    values (p_id, proc_d1, true, true);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgA, p_id, u_agent_a);

  insert into public.permission_profiles (organization_id, name, is_admin)
    values (orgB, 'Admin B', true) returning id into p_id;
  insert into public.permission_profile_organizations (profile_id, socle_org_id) values (p_id, s_b);
  insert into public.permission_profile_assignments (organization_id, profile_id, user_id)
    values (orgB, p_id, u_admin_b);

  -- Un modèle du tenant B, posé hors RLS : cible des scénarios d'étanchéité.
  insert into public.email_templates (organization_id, name, subject, body, created_by)
  values (orgB, 'Modèle B', 'Objet B', 'Corps B', u_admin_b) returning id into t_b;

  -- ==========================================================================
  -- E1. L'administrateur crée un modèle de SON tenant
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.email_templates (organization_id, name, description, subject, body, created_by)
  values (orgA, 'Accusé de réception', 'Envoyé au dépôt',
          'Votre demande {{demande.reference}}',
          'Bonjour {{usager.civilite}} {{usager.nom}}, reçue le {{demande.date_depot}}.',
          u_admin_a)
  returning id into t_id;
  if t_id is null then v_fail := v_fail || 'E1: création impossible pour un administrateur'::text; end if;

  -- ==========================================================================
  -- E2. Le catalogue de variables est un contrat
  -- ==========================================================================
  -- ⚠️ On vérifie le MESSAGE du refus, pas seulement qu'il y en a un.
  -- Un `exception when others then null` accueillerait n'importe quelle erreur
  -- comme un refus légitime — y compris un « permission denied » dû à une garde
  -- mal déclarée. C'est exactement ce qui a laissé passer le défaut corrigé par
  -- la migration 20260826100100 : le test était vert, le client réel échouait.
  begin
    insert into public.email_templates (organization_id, name, subject, body, created_by)
    values (orgA, 'Mauvais objet', 'Votre demande {{demande.inexistant}}', 'Corps', u_admin_a);
    v_fail := v_fail || 'E2a: variable inconnue acceptée dans l''objet'::text;
  exception when others then
    if sqlerrm not like 'Variable inconnue dans l%objet%' then
      v_fail := v_fail || format('E2a: refus pour la MAUVAISE raison (%s)', sqlerrm);
    end if;
  end;

  begin
    insert into public.email_templates (organization_id, name, subject, body, created_by)
    values (orgA, 'Mauvais corps', 'Objet', 'Bonjour {{usager.pseudo}}', u_admin_a);
    v_fail := v_fail || 'E2b: variable inconnue acceptée dans le corps'::text;
  exception when others then
    if sqlerrm not like 'Variable inconnue dans le corps%' then
      v_fail := v_fail || format('E2b: refus pour la MAUVAISE raison (%s)', sqlerrm);
    end if;
  end;

  -- Une accolade qui n'est pas une variable reste du texte ordinaire : la garde
  -- ne doit pas transformer le moindre `{` en erreur.
  insert into public.email_templates (organization_id, name, subject, body, created_by)
  values (orgA, 'Accolades', 'Objet {littéral}', 'Corps {{ PAS UNE VARIABLE }}', u_admin_a);
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'E2c: du texte entre accolades ordinaire a été refusé'::text; end if;

  -- ==========================================================================
  -- E3. Le nom est unique par tenant, casse et espaces de bordure ignorés
  -- ==========================================================================
  begin
    insert into public.email_templates (organization_id, name, subject, body, created_by)
    values (orgA, '  accusé de réception  ', 'Objet', 'Corps', u_admin_a);
    v_fail := v_fail || 'E3: doublon de nom accepté (casse / espaces)'::text;
  exception when unique_violation then null;
  end;

  -- ==========================================================================
  -- E4. Verrou optimiste : une version périmée n'écrase rien
  -- ==========================================================================
  update public.email_templates set subject = 'Objet v2', version = version + 1
   where id = t_id and version = 1;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'E4a: mise à jour avec la bonne version refusée'::text; end if;

  update public.email_templates set subject = 'Objet v3', version = version + 1
   where id = t_id and version = 1;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E4b: version périmée acceptée — pas de verrou'::text; end if;

  select subject into v_text from public.email_templates where id = t_id;
  if v_text <> 'Objet v2' then v_fail := v_fail || format('E4c: contenu écrasé (%s)', v_text); end if;

  -- ==========================================================================
  -- E5. Étanchéité cross-tenant
  -- ==========================================================================
  select count(*) into v_int from public.email_templates where organization_id = orgB;
  if v_int <> 0 then v_fail := v_fail || 'E5a: FUITE — modèles d''un autre tenant visibles'::text; end if;

  update public.email_templates set subject = 'Pirate' where id = t_b;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E5b: modèle d''un autre tenant modifiable'::text; end if;

  delete from public.email_templates where id = t_b;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E5c: modèle d''un autre tenant supprimable'::text; end if;

  begin
    insert into public.email_templates (organization_id, name, subject, body, created_by)
    values (orgB, 'Intrus', 'Objet', 'Corps', u_admin_a);
    v_fail := v_fail || 'E5d: création dans un AUTRE tenant acceptée'::text;
  exception when others then null;
  end;

  -- ==========================================================================
  -- E6. L'agent non administrateur LIT, mais n'écrit pas
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_agent_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_int from public.email_templates where organization_id = orgA;
  if v_int <> 2 then
    v_fail := v_fail || format('E6a: un agent ne lit pas les modèles (%s au lieu de 2)', v_int); end if;

  begin
    insert into public.email_templates (organization_id, name, subject, body, created_by)
    values (orgA, 'Par un agent', 'Objet', 'Corps', u_agent_a);
    v_fail := v_fail || 'E6b: un NON-administrateur a pu créer un modèle'::text;
  exception when others then null;
  end;

  update public.email_templates set subject = 'Par un agent' where id = t_id;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E6c: un NON-administrateur a pu modifier un modèle'::text; end if;

  delete from public.email_templates where id = t_id;
  get diagnostics v_int = row_count;
  if v_int <> 0 then v_fail := v_fail || 'E6d: un NON-administrateur a pu supprimer un modèle'::text; end if;

  -- ==========================================================================
  -- E7. L'administrateur, lui, supprime
  -- ==========================================================================
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', u_admin_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  delete from public.email_templates where id = t_id;
  get diagnostics v_int = row_count;
  if v_int <> 1 then v_fail := v_fail || 'E7: l''administrateur ne peut pas supprimer'::text; end if;

  -- ==========================================================================
  -- E8. Le catalogue reste hors de portée d'un client
  -- ==========================================================================
  if has_function_privilege('authenticated', 'public.email_template_variables()', 'execute') then
    v_fail := v_fail || 'E8a: email_template_variables exécutable par authenticated'::text; end if;
  if has_function_privilege('authenticated', 'public.email_template_unknown_variables(text)', 'execute') then
    v_fail := v_fail || 'E8b: email_template_unknown_variables exécutable par authenticated'::text; end if;
  execute 'reset role';

  -- ==========================================================================
  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSÉS (modèles d''e-mail) — transaction annulée, aucune donnée conservée.';
  else
    raise exception 'ÉCHECS (%) : %', array_length(v_fail, 1), array_to_string(v_fail, ' · ');
  end if;
end
$main$;
