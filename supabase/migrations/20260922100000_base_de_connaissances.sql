-- ============================================================================
-- Base de connaissances — un écran, et le droit d'y accéder (demande PO du
-- 2026-09-18).
--
-- L'écran « Base de connaissances » (entrée de rail, route
-- `/base-de-connaissances`) liste les démarches PUBLIÉES du tenant et ouvre,
-- pour chacune, ce que la collectivité écrit pour ses usagers, ce que le
-- service écrit pour ses agents, et l'assistant.
--
-- Ce que ce lot pose, et pourquoi :
--
--   1. `permission_profiles.knowledge_base_access` — un ATTRIBUT de profil,
--      simple marche/arrêt, comme `is_admin` et `is_intervenant` : pas un
--      cinquième droit de la matrice. Il ne s'exprime pas par couple
--      (organisation, démarche) : l'écran montre tout le catalogue publié du
--      tenant, et un catalogue ne se découpe pas en périmètres.
--      ⚠️ C'est le droit d'ouvrir un ÉCRAN, pas une frontière de données :
--      tout ce que l'écran montre est déjà lisible par tout membre du tenant
--      (catalogue miroité, `socle-proxy /v1/procedures/get` — que lit le
--      rail « Procédure » au guichet comme à l'instruction). Le reflet est
--      dans l'UI (rail, route) ; la seule garde SERVEUR qui en dépend est
--      celle de l'assistant (`request-assistant`, mode démarche), parce que
--      chaque question mord sur le plafond de la collectivité.
--
--   2. ACTIVÉ SUR TOUS LES PROFILS EXISTANTS (décision PO) ; un profil créé
--      ensuite part de `false`, et c'est l'écran qui le propose (les modèles
--      « agent » le cochent). La mise à jour ne touche pas `version` : un
--      éditeur ouvert pendant la migration n'est pas renvoyé à « modifié
--      entre-temps » pour un changement qu'il n'a pas pu voir.
--
--   3. `save_permission_profile` : une clé ABSENTE du payload CONSERVE la
--      valeur en place (création : `false`). Sans cela, un navigateur servi
--      avant ce lot — qui ne connaît pas la clé — éteindrait l'accès de tout
--      profil qu'il enregistre.
--
--   4. Un profil « Base de connaissances » seul est VALIDE (forme) : c'est un
--      accès réel, comme l'administration ou l'intervention pures.
--
--   5. `my_rights` l'expose (par profil, et « quelque part » en tête — admin
--      plateforme compris, comme `has_any_creation_right_for`) ;
--      `has_knowledge_base_access_for` le dit au service_role.
--
-- ⚠️ Piège DEFINER/current_user (CLAUDE.md) : rien ici ne teste
-- `is_service_context()`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Attribut de profil, activé sur l'existant
-- ----------------------------------------------------------------------------
alter table public.permission_profiles
  add column if not exists knowledge_base_access boolean not null default false;
comment on column public.permission_profiles.knowledge_base_access is
  'Accès à l''écran « Base de connaissances » (catalogue des démarches publiées, fiches, assistant). Attribut marche/arrêt, pas un droit par couple : n''ouvre aucune demande. Activé sur les profils existants le 2026-09-18.';

update public.permission_profiles set knowledge_base_access = true where not knowledge_base_access;

-- ----------------------------------------------------------------------------
-- 2. Forme d'un profil : l'accès à la base de connaissances est un accès
-- ----------------------------------------------------------------------------
create or replace function public.validate_permission_profile_shape(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_is_admin       boolean;
  v_is_intervenant boolean;
  v_knowledge      boolean;
  v_default_view   boolean;
  v_has_org        boolean;
  v_has_right      boolean;
begin
  select is_admin, is_intervenant, knowledge_base_access, default_view
    into v_is_admin, v_is_intervenant, v_knowledge, v_default_view
    from public.permission_profiles where id = p_profile_id;
  if v_is_admin is null then
    return;
  end if;

  select exists(select 1 from public.permission_profile_organizations where profile_id = p_profile_id)
    into v_has_org;
  if not v_has_org then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  select v_default_view or exists (
    select 1 from public.permission_profile_procedures pp
     where pp.profile_id = p_profile_id and pp.right_view
  ) into v_has_right;
  if not v_is_admin and not v_is_intervenant and not v_knowledge and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;
end;
$$;
revoke execute on function public.validate_permission_profile_shape(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Qui y a accès — pour le service_role (request-assistant)
-- ----------------------------------------------------------------------------
create or replace function public.has_knowledge_base_access_for(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1
          from public.permission_profile_assignments a
          join public.permission_profiles p
            on p.id = a.profile_id and p.status = 'active' and p.knowledge_base_access
         where a.user_id = p_user_id and a.organization_id = p_org_id
      );
$$;
comment on function public.has_knowledge_base_access_for(uuid, uuid) is
  'Vrai si l''utilisateur détient, dans ce tenant, un profil ACTIF donnant accès à la base de connaissances (ou est admin plateforme). Appelée par request-assistant (mode démarche), jamais par un client.';
revoke execute on function public.has_knowledge_base_access_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.has_knowledge_base_access_for(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. my_rights — expose l'attribut (par profil, et « quelque part » en tête)
-- ----------------------------------------------------------------------------
create or replace function public.my_rights(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Ressource introuvable.';
  end if;
  select jsonb_build_object(
    'organization_id', p_org_id,
    'is_platform_admin', public.is_platform_admin(),
    'is_admin', public.is_org_admin_anywhere(p_org_id),
    'is_intervenant', exists (
      select 1 from public.permission_profile_assignments a
        join public.permission_profiles p
          on p.id = a.profile_id and p.status = 'active' and p.is_intervenant
       where a.user_id = auth.uid() and a.organization_id = p_org_id),
    'knowledge_base_access', public.has_knowledge_base_access_for(auth.uid(), p_org_id),
    'no_procedure_id', public.nil_procedure(),
    'profiles', coalesce(jsonb_agg(x.profile order by x.name), '[]'::jsonb)
  ) into v
  from (
    select p.name, jsonb_build_object(
      'id', p.id, 'name', p.name, 'status', p.status, 'is_admin', p.is_admin,
      'is_intervenant', p.is_intervenant,
      'knowledge_base_access', p.knowledge_base_access,
      'scope_organization_ids', (
        select coalesce(jsonb_agg(distinct t.socle_org_id), '[]'::jsonb)
          from public.permission_profile_scope(p.id) t),
      'procedures', (
        select coalesce(jsonb_object_agg(pp.socle_procedure_id, public.rights_array(
                 pp.right_view, pp.right_create, pp.right_process, pp.right_close)), '{}'::jsonb)
          from public.permission_profile_procedures pp where pp.profile_id = p.id),
      'default', public.rights_array(p.default_view, p.default_create,
                                     p.default_process, p.default_close)
    ) as profile
    from public.permission_profiles p
    join public.permission_profile_assignments a on a.profile_id = p.id and a.user_id = auth.uid()
   where p.organization_id = p_org_id
  ) x;
  return v;
end;
$$;
revoke execute on function public.my_rights(uuid) from public, anon;
grant  execute on function public.my_rights(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. save_permission_profile — accepte `knowledge_base_access`. Corps
--    identique à la version LIVE (RM-42 différentiel, 20260921100000) hors
--    ces lignes.
-- ----------------------------------------------------------------------------
create or replace function public.save_permission_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id               uuid := nullif(p ->> 'profile_id', '')::uuid;
  v_org              uuid := (p ->> 'organization_id')::uuid;
  v_name             text := btrim(coalesce(p ->> 'name', ''));
  v_description      text := nullif(p ->> 'description', '');
  v_is_admin         boolean := coalesce((p ->> 'is_admin')::boolean, false);
  v_is_intervenant   boolean := coalesce((p ->> 'is_intervenant')::boolean, false);
  -- NULL = clé absente : on CONSERVE la valeur en place (voir l'en-tête, § 3).
  v_knowledge        boolean := case when p ? 'knowledge_base_access'
                                     then coalesce((p ->> 'knowledge_base_access')::boolean, false)
                                end;
  v_default_rights   text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'default_rights', '[]'::jsonb))), '{}');
  v_organizations    uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'organizations', '[]'::jsonb)))::uuid), '{}');
  v_procedures       jsonb  := coalesce(p -> 'procedures', '[]'::jsonb);
  v_expected_version int    := nullif(p ->> 'expected_version', '')::int;
  v_current_version  int;
  v_current_knowledge boolean;
  v_default_view boolean; v_default_create boolean; v_default_process boolean; v_default_close boolean;
  v_has_right   boolean;
  v_before jsonb; v_after jsonb; v_action text;
  v_item jsonb; v_rights text[]; v_view boolean; v_create boolean; v_process boolean; v_close boolean;
  v_socle_org uuid; v_right text;
  v_had_root_admin boolean;
  v_pre text[] := array(
    select r.code || '|' || y.organization_id || '|' || y.socle_org_id || '|' || y.socle_procedure_id
      from unnest(array['consultation','creation','instruction','cloture']) r(code),
      lateral public.my_permission_pairs(r.code) y
  );
begin
  if v_org is null then
    raise exception 'organization_id manquant.';
  end if;
  if v_name = '' then
    raise exception 'Le nom du profil est obligatoire.';
  end if;
  if array_length(v_organizations, 1) is null or array_length(v_organizations, 1) = 0 then
    raise exception 'Sélectionnez au moins une organisation.';
  end if;

  -- État de l'invariant AVANT toute mutation (RM-42, différentiel).
  v_had_root_admin := public.tenant_has_root_admin(v_org);

  if not public.is_org_admin_anywhere(v_org) then
    raise exception 'Accès réservé aux administrateurs.';
  end if;
  foreach v_socle_org in array v_organizations loop
    if not public.has_admin_scope(v_org, v_socle_org) then
      raise exception 'Votre périmètre d''administration ne couvre pas l''organisation %.',
        coalesce((select m.name from public.socle_organizations m
                   where m.organization_id = v_org and m.socle_id = v_socle_org),
                 v_socle_org::text);
    end if;
  end loop;

  -- Valeur retenue : celle du payload, sinon celle en place, sinon `false`.
  if v_id is not null then
    select knowledge_base_access into v_current_knowledge
      from public.permission_profiles where id = v_id and organization_id = v_org;
  end if;
  v_knowledge := coalesce(v_knowledge, v_current_knowledge, false);

  v_default_view    := coalesce(array_length(v_default_rights, 1), 0) > 0;
  v_default_create  := 'creation'    = any(v_default_rights);
  v_default_process := 'instruction' = any(v_default_rights);
  v_default_close   := 'cloture'     = any(v_default_rights);

  select v_default_view or exists (
    select 1 from jsonb_array_elements(v_procedures) e
     where jsonb_array_length(coalesce(e -> 'rights', '[]'::jsonb)) > 0
  ) into v_has_right;
  if not v_is_admin and not v_is_intervenant and not v_knowledge and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;

  if v_id is not null then
    select version, jsonb_build_object(
             'name', name, 'description', description, 'is_admin', is_admin,
             'is_intervenant', is_intervenant,
             'knowledge_base_access', knowledge_base_access, 'status', status,
             'default_rights', public.rights_array(default_view, default_create, default_process, default_close),
             'organizations', (select coalesce(jsonb_agg(socle_org_id), '[]'::jsonb)
                                  from public.permission_profile_organizations where profile_id = v_id),
             'procedures', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', socle_procedure_id,
                                'rights', public.rights_array(right_view, right_create, right_process, right_close))), '[]'::jsonb)
                               from public.permission_profile_procedures where profile_id = v_id))
      into v_current_version, v_before
      from public.permission_profiles where id = v_id and organization_id = v_org;
    if v_current_version is null then
      raise exception 'Profil de droits introuvable.';
    end if;

    perform public.assert_editor_can_manage_profile(v_org, v_id);

    if v_expected_version is null or v_expected_version <> v_current_version then
      raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
    end if;

    update public.permission_profiles
       set name = v_name, description = v_description, is_admin = v_is_admin,
           is_intervenant = v_is_intervenant,
           knowledge_base_access = v_knowledge,
           default_view = v_default_view, default_create = v_default_create,
           default_process = v_default_process, default_close = v_default_close,
           version = version + 1, updated_at = now(), updated_by = auth.uid()
     where id = v_id
     returning version into v_current_version;

    delete from public.permission_profile_organizations where profile_id = v_id;
    delete from public.permission_profile_procedures where profile_id = v_id;
    v_action := 'profile_updated';
  else
    insert into public.permission_profiles (
      organization_id, name, description, is_admin, is_intervenant, knowledge_base_access,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org, v_name, v_description, v_is_admin, v_is_intervenant, v_knowledge,
      v_default_view, v_default_create, v_default_process, v_default_close,
      auth.uid(), auth.uid()
    ) returning id, version into v_id, v_current_version;
    v_before := null;
    v_action := 'profile_created';
  end if;

  insert into public.permission_profile_organizations (profile_id, socle_org_id)
  select distinct v_id, x from unnest(v_organizations) as x;

  for v_item in select * from jsonb_array_elements(v_procedures) loop
    v_rights  := array(select jsonb_array_elements_text(coalesce(v_item -> 'rights', '[]'::jsonb)));
    v_view    := coalesce(array_length(v_rights, 1), 0) > 0;
    v_create  := 'creation'    = any(v_rights);
    v_process := 'instruction' = any(v_rights);
    v_close   := 'cloture'     = any(v_rights);
    insert into public.permission_profile_procedures
      (profile_id, socle_procedure_id, right_view, right_create, right_process, right_close)
    values
      (v_id, (v_item ->> 'id')::uuid, v_view, v_create, v_process, v_close)
    on conflict (profile_id, socle_procedure_id) do update
      set right_view = excluded.right_view, right_create = excluded.right_create,
          right_process = excluded.right_process, right_close = excluded.right_close;
  end loop;

  perform public.validate_permission_profile_shape(v_id);

  if not public.is_platform_admin() then
    foreach v_right in array array['consultation','creation','instruction','cloture'] loop
      if exists (
        select 1 from public.permission_pairs_of(array[v_id], v_right, v_org) x
         where not ((v_right || '|' || x.organization_id || '|' || x.socle_org_id || '|' || x.socle_procedure_id) = any(v_pre))
      ) then
        raise exception 'Ce profil accorderait le droit « % » que vous ne détenez pas vous-même sur tout son périmètre.', v_right;
      end if;
    end loop;
  end if;

  -- RM-42, différentiel : on n'exige de conserver un administrateur racine que
  -- s'il en existait un avant cette écriture.
  if v_had_root_admin then
    perform public.assert_tenant_keeps_root_admin(v_org);
  end if;

  v_after := jsonb_build_object(
    'name', v_name, 'description', v_description, 'is_admin', v_is_admin,
    'is_intervenant', v_is_intervenant,
    'knowledge_base_access', v_knowledge,
    'default_rights', public.rights_array(v_default_view, v_default_create, v_default_process, v_default_close),
    'organizations', to_jsonb(v_organizations),
    'procedures', v_procedures
  );
  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(), v_action, v_id, v_name, v_before, v_after);

  perform public.refresh_member_roles(v_org);

  return jsonb_build_object('id', v_id, 'version', v_current_version);
end;
$$;
revoke execute on function public.save_permission_profile(jsonb) from public, anon;
grant  execute on function public.save_permission_profile(jsonb) to authenticated;
