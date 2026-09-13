-- ============================================================================
-- Premier administrateur d'un tenant NEUF — l'invariant du dernier
-- administrateur (RM-42) devient DIFFÉRENTIEL.
--
-- Constat (2026-09-13, tenant « Seine Normandie Agglomération ») : sur un
-- tenant qui n'a encore AUCUN administrateur racine, la création du tout
-- premier profil de droits est refusée par
--   « Le tenant doit conserver au moins un administrateur sur l'organisation
--     racine. »
-- quel que soit le profil demandé. `assert_tenant_keeps_root_admin` est en
-- effet appelée en POST-CONDITION ABSOLUE à la fin de
-- `save_permission_profile` : elle exige un administrateur racine APRÈS la
-- mutation, y compris quand il n'y en avait aucun AVANT — et créer un profil
-- ne crée pas son attribution. Verrou circulaire : aucun profil ne peut
-- naître, donc aucun administrateur ne peut être attribué, donc aucun profil
-- ne peut naître. Aucun contournement possible, admin plateforme compris
-- (c'est la seule garde du projet qui n'en a pas, et c'est voulu).
--
-- Les tests ne pouvaient pas le voir : `profils-droits.test.sql` sème tous ses
-- profils par `insert` direct en contexte postgres et n'appelle la RPC que sur
-- un tenant qui a DÉJÀ son administrateur racine. Deux scénarios sont ajoutés
-- au harnais dans le même geste.
--
-- Correctif — l'invariant est reformulé tel que son message l'énonce déjà :
-- « CONSERVER » un administrateur racine, c'est interdire à une opération de
-- faire passer un tenant de ≥ 1 à 0. Un tenant à 0 n'a rien à conserver ; il
-- n'y a là aucun affaiblissement — la propriété garantie (un tenant qui a un
-- administrateur racine n'en perd jamais le dernier) est identique, et le
-- chemin « retrait du membre » (`is_last_root_admin`, trigger
-- t05_organization_members_protect_last_admin) était DÉJÀ différentiel par
-- construction.
--
-- Mise en œuvre : l'état de l'invariant est mesuré AVANT toute mutation
-- (`tenant_has_root_admin`), et l'assertion n'est jouée que s'il était
-- satisfait. Les trois RPC concernées (`save_permission_profile`,
-- `set_permission_profile_status`, `revoke_permission_profile`) sont
-- réécrites à l'identique pour le reste.
--
-- ⚠️ `CREATE OR REPLACE` re-accorde PUBLIC (piège vécu chez Clara) : les
-- `revoke`/`grant` sont rejoués pour chacune, à l'identique de l'existant.
--
-- ⚠️ ORDRE DE REJEU : ce fichier doit rester APRÈS
-- `20260914100000_interventions.sql`, qui redéfinit lui aussi
-- `save_permission_profile` (ajout d'`is_intervenant`) — d'où sa numérotation en
-- fin de séquence. Les corps repris ci-dessous sont ceux du schéma LIVE au
-- 2026-09-13, `is_intervenant` compris.
--
-- Rollback : ré-appliquer `20260822100400_profils_droits_rpc.sql` puis
-- `20260914100000_interventions.sql` (dans cet ordre) restaure les trois RPC
-- dans leur version à post-condition absolue, puis
-- `drop function if exists public.tenant_has_root_admin(uuid);`.
--
-- Réf : docs/droits.md § « Dernier administrateur », 20260822100300.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tenant_has_root_admin — état COURANT de l'invariant, sans jugement. Unique
-- définition du prédicat (l'assertion s'appuie désormais dessus).
-- ----------------------------------------------------------------------------
create or replace function public.tenant_has_root_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
      join public.permission_profile_organizations po
        on po.profile_id = p.id
       and po.socle_org_id = (select o.socle_org_id from public.organizations o where o.id = p_org_id)
     where a.organization_id = p_org_id
  );
$$;
comment on function public.tenant_has_root_admin(uuid) is
  'RM-42 : vrai si au moins un utilisateur détient l''administration sur la racine Socle du tenant. Mesuré AVANT mutation par les RPC, pour que l''invariant reste différentiel (un tenant neuf n''a rien à conserver).';
revoke execute on function public.tenant_has_root_admin(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- assert_tenant_keeps_root_admin — inchangée dans son verdict (aucun
-- contournement, admin plateforme compris). Elle juge l'état APRÈS mutation :
-- c'est l'APPELANT qui décide de la jouer, selon l'état d'AVANT.
-- ----------------------------------------------------------------------------
create or replace function public.assert_tenant_keeps_root_admin(p_org_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    return;  -- tenant supprimé dans la même transaction
  end if;
  if not public.tenant_has_root_admin(p_org_id) then
    raise exception 'Le tenant doit conserver au moins un administrateur sur l''organisation racine.';
  end if;
end;
$$;
comment on function public.assert_tenant_keeps_root_admin(uuid) is
  'RM-42 : au moins un utilisateur détenant administration sur la racine Socle du tenant, en permanence. Aucun contournement, admin plateforme compris. À jouer par l''appelant SEULEMENT si l''invariant était satisfait avant sa mutation (tenant_has_root_admin) : un tenant neuf n''a pas d''administrateur à conserver.';
revoke execute on function public.assert_tenant_keeps_root_admin(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- save_permission_profile — identique, hormis la capture de l'état d'avant
-- (v_had_root_admin) et l'assertion devenue conditionnelle.
-- ----------------------------------------------------------------------------
create or replace function public.save_permission_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id               uuid := nullif(p ->> 'profile_id', '')::uuid;
  v_org              uuid := (p ->> 'organization_id')::uuid;
  v_name             text := btrim(coalesce(p ->> 'name', ''));
  v_description      text := nullif(p ->> 'description', '');
  v_is_admin         boolean := coalesce((p ->> 'is_admin')::boolean, false);
  v_is_intervenant   boolean := coalesce((p ->> 'is_intervenant')::boolean, false);
  v_default_rights   text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'default_rights', '[]'::jsonb))), '{}');
  v_organizations    uuid[] := coalesce(array(select (jsonb_array_elements_text(coalesce(p -> 'organizations', '[]'::jsonb)))::uuid), '{}');
  v_procedures       jsonb  := coalesce(p -> 'procedures', '[]'::jsonb);
  v_expected_version int    := nullif(p ->> 'expected_version', '')::int;
  v_current_version  int;
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

  v_default_view    := coalesce(array_length(v_default_rights, 1), 0) > 0;
  v_default_create  := 'creation'    = any(v_default_rights);
  v_default_process := 'instruction' = any(v_default_rights);
  v_default_close   := 'cloture'     = any(v_default_rights);

  select v_default_view or exists (
    select 1 from jsonb_array_elements(v_procedures) e
     where jsonb_array_length(coalesce(e -> 'rights', '[]'::jsonb)) > 0
  ) into v_has_right;
  if not v_is_admin and not v_is_intervenant and not v_has_right then
    raise exception 'Ce profil n''accorderait aucun droit.';
  end if;

  if v_id is not null then
    select version, jsonb_build_object(
             'name', name, 'description', description, 'is_admin', is_admin,
             'is_intervenant', is_intervenant, 'status', status,
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
      organization_id, name, description, is_admin, is_intervenant,
      default_view, default_create, default_process, default_close,
      created_by, updated_by
    ) values (
      v_org, v_name, v_description, v_is_admin, v_is_intervenant,
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
  -- s'il en existait un avant cette écriture (sinon : tenant neuf, le premier
  -- profil doit pouvoir naître pour qu'un administrateur soit attribuable).
  if v_had_root_admin then
    perform public.assert_tenant_keeps_root_admin(v_org);
  end if;

  v_after := jsonb_build_object(
    'name', v_name, 'description', v_description, 'is_admin', v_is_admin,
    'is_intervenant', v_is_intervenant,
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

-- ----------------------------------------------------------------------------
-- set_permission_profile_status — même correctif (désactiver un profil dans un
-- tenant qui n'a aucun administrateur racine ne doit pas être refusé au nom
-- d'un administrateur qui n'a jamais existé).
-- ----------------------------------------------------------------------------
create or replace function public.set_permission_profile_status(
  p_profile_id uuid, p_status text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_current_version int; v_before jsonb; v_had_root_admin boolean;
begin
  if p_status not in ('active', 'inactive') then
    raise exception 'Statut invalide : %.', p_status;
  end if;

  select organization_id, name, version into v_org, v_name, v_current_version
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;

  v_had_root_admin := public.tenant_has_root_admin(v_org);

  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);
  if p_expected_version is null or p_expected_version <> v_current_version then
    raise exception 'Ce profil a été modifié entre-temps par quelqu''un d''autre ; rechargez avant de réessayer.';
  end if;

  v_before := jsonb_build_object('status',
    (select status from public.permission_profiles where id = p_profile_id));

  update public.permission_profiles
     set status = p_status, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_profile_id
   returning version into v_current_version;

  if v_had_root_admin then
    perform public.assert_tenant_keeps_root_admin(v_org);
  end if;

  insert into public.permission_audit_log
    (organization_id, actor_id, action, profile_id, profile_name, before, after)
  values (v_org, auth.uid(),
          case when p_status = 'active' then 'profile_activated' else 'profile_deactivated' end,
          p_profile_id, v_name, v_before, jsonb_build_object('status', p_status));

  perform public.refresh_member_roles(v_org);
  return jsonb_build_object('id', p_profile_id, 'version', v_current_version);
end;
$$;
revoke execute on function public.set_permission_profile_status(uuid, text, integer) from public, anon;
grant  execute on function public.set_permission_profile_status(uuid, text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_permission_profile — même correctif.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_permission_profile(p_profile_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_deleted_id uuid; v_had_root_admin boolean;
begin
  select organization_id, name into v_org, v_name
    from public.permission_profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;

  v_had_root_admin := public.tenant_has_root_admin(v_org);

  perform public.assert_editor_can_manage_profile(v_org, p_profile_id);

  delete from public.permission_profile_assignments
   where profile_id = p_profile_id and user_id = p_user_id
  returning profile_id into v_deleted_id;

  if v_deleted_id is not null then
    if v_had_root_admin then
      perform public.assert_tenant_keeps_root_admin(v_org);
    end if;

    insert into public.permission_audit_log
      (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
    values (v_org, auth.uid(), 'assignment_revoked', p_profile_id, v_name, p_user_id,
            jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id), null);
    perform public.refresh_member_roles(v_org);
  end if;
  return jsonb_build_object('profile_id', p_profile_id, 'user_id', p_user_id);
end;
$$;
revoke execute on function public.revoke_permission_profile(uuid, uuid) from public, anon;
grant  execute on function public.revoke_permission_profile(uuid, uuid) to authenticated;
