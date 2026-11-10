-- Profil système « Administrateur », attribué par le Socle (2026-11-10).
--
-- Complète la décision du 2026-10-30 (« le Socle ouvre l'accès, sans rôle ») :
-- le Socle déclare pour Iris un second rôle de base, `administrateur`. Il donne
-- dans Iris le profil SYSTÈME « Administrateur » de la collectivité —
-- administration + tous droits sur toutes les démarches, présentes et futures,
-- sur toute la collectivité (périmètre = la racine, sous-arbre implicite).
--
-- Partage net : le Socle est maître de CE profil (attribution et retrait, par
-- `sync-socle-users`) ; Iris reste maître de tous les autres. D'où :
--   - `permission_profiles.system_key = 'admin'` marque le profil, un par tenant ;
--   - le profil ne se modifie, ne se désactive ni ne se supprime dans Iris, et
--     ne s'y attribue ni ne s'y retire (garde `permission_system_profile_guard`,
--     sur les quatre tables) ;
--   - seule porte : `socle_set_admin_profile` (service_role), qui lève la garde
--     pour sa transaction (GUC local `iris.socle_admin_profile`).
--   - le dernier administrateur racine n'est jamais retiré par la synchro :
--     elle le garde et le signale (`kept_last_admin`).
--
-- Reprise : chaque tenant avait UN profil « Administrateur » (reprise RM-48 du
-- 2026-08-22), tous droits par défaut, racine dans le périmètre (vérifié le
-- 2026-11-10 ; la seule ligne de matrice, chez ACCM, donnait déjà tous les
-- droits). Il devient le profil système, normalisé (périmètre = la racine,
-- matrice vide) : aucun droit effectif ne change, ses attributions restent.

-- --------------------------------------------------------------------------
-- 1. Marque du profil système.
-- --------------------------------------------------------------------------
alter table public.permission_profiles
  add column if not exists system_key text,
  add constraint permission_profiles_system_key_known check (system_key is null or system_key = 'admin');

create unique index if not exists permission_profiles_system_key_unique
  on public.permission_profiles (organization_id, system_key) where system_key is not null;

comment on column public.permission_profiles.system_key is
  'Profil système (''admin'' = « Administrateur », attribué par le Socle). Verrouillé dans Iris ; seule porte : socle_set_admin_profile.';

-- --------------------------------------------------------------------------
-- 2. Garde : le profil système ne bouge que par la porte du Socle.
--
-- Une garde par trigger et non dans chaque RPC : save / set_status / delete /
-- assign / revoke sont toutes couvertes, et toute future écriture aussi. Elle
-- ne dépend pas de `current_user` (piège DEFINER documenté dans
-- profils-droits.test.sql) mais d'un GUC transactionnel posé par la seule
-- fonction habilitée. Les suppressions EN CASCADE (tenant, membre retiré du
-- tenant, profil supprimé) passent : la ligne parente a déjà disparu.
-- --------------------------------------------------------------------------
create or replace function public.permission_system_profile_guard() returns trigger
    language plpgsql security definer
    set search_path to ''
as $$
declare
  v_profile uuid;
begin
  if coalesce(current_setting('iris.socle_admin_profile', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'permission_profiles' then
    if tg_op = 'INSERT' then
      if new.system_key is not null then
        raise exception 'Le profil « Administrateur » est géré par le Socle.' using errcode = '42501';
      end if;
      return new;
    elsif tg_op = 'DELETE' then
      if old.system_key is not null
         and exists (select 1 from public.organizations o where o.id = old.organization_id) then
        raise exception 'Le profil « Administrateur » est géré par le Socle : il ne se supprime pas.' using errcode = '42501';
      end if;
      return old;
    else
      if new.system_key is distinct from old.system_key
         or (old.system_key is not null and (
               new.name is distinct from old.name
            or new.is_admin is distinct from old.is_admin
            or new.status is distinct from old.status
            or new.default_view is distinct from old.default_view
            or new.default_create is distinct from old.default_create
            or new.default_process is distinct from old.default_process
            or new.default_close is distinct from old.default_close)) then
        raise exception 'Le profil « Administrateur » est géré par le Socle : il ne se modifie pas dans Iris.' using errcode = '42501';
      end if;
      return new;
    end if;
  end if;

  v_profile := coalesce(new.profile_id, old.profile_id);
  if not exists (select 1 from public.permission_profiles p where p.id = v_profile and p.system_key is not null) then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'permission_profile_assignments' then
    -- Membre retiré du tenant : l'attribution part avec lui (cascade).
    if tg_op = 'DELETE' and not exists (
         select 1 from public.organization_members m
          where m.organization_id = old.organization_id and m.user_id = old.user_id) then
      return old;
    end if;
    raise exception 'Le profil « Administrateur » s''attribue dans le Socle (rôle Iris « Administrateur »).' using errcode = '42501';
  end if;

  raise exception 'Le profil « Administrateur » est géré par le Socle : il ne se modifie pas dans Iris.' using errcode = '42501';
end;
$$;

comment on function public.permission_system_profile_guard() is
  'Verrou du profil système (system_key) : seule socle_set_admin_profile le modifie ou l''attribue. Cascades permises.';

revoke all on function public.permission_system_profile_guard() from public, anon, authenticated;

drop trigger if exists t03_permission_profiles_system_guard on public.permission_profiles;
create trigger t03_permission_profiles_system_guard
  before insert or update or delete on public.permission_profiles
  for each row execute function public.permission_system_profile_guard();

drop trigger if exists t03_permission_profile_organizations_system_guard on public.permission_profile_organizations;
create trigger t03_permission_profile_organizations_system_guard
  before insert or update or delete on public.permission_profile_organizations
  for each row execute function public.permission_system_profile_guard();

drop trigger if exists t03_permission_profile_procedures_system_guard on public.permission_profile_procedures;
create trigger t03_permission_profile_procedures_system_guard
  before insert or update or delete on public.permission_profile_procedures
  for each row execute function public.permission_system_profile_guard();

drop trigger if exists t03_permission_profile_assignments_system_guard on public.permission_profile_assignments;
create trigger t03_permission_profile_assignments_system_guard
  before insert or update or delete on public.permission_profile_assignments
  for each row execute function public.permission_system_profile_guard();

-- --------------------------------------------------------------------------
-- 3. Le profil système d'un tenant : trouvé, repris ou créé (idempotent).
--    `null` si la racine du tenant n'est pas encore dans le miroir Socle (le
--    périmètre l'exige) : la prochaine synchro le créera.
-- --------------------------------------------------------------------------
create or replace function public.ensure_system_admin_profile(p_org_id uuid) returns uuid
    language plpgsql security definer
    set search_path to ''
as $$
declare
  v_root uuid;
  v_id uuid;
  v_description constant text :=
    'Profil système, attribué par le Socle (rôle Iris « Administrateur ») : administration et tous droits sur toutes les démarches de la collectivité, présentes et futures. Ne se modifie pas dans Iris.';
begin
  select p.id into v_id from public.permission_profiles p
   where p.organization_id = p_org_id and p.system_key = 'admin';
  if v_id is not null then
    return v_id;
  end if;

  select o.socle_org_id into v_root from public.organizations o where o.id = p_org_id;
  if v_root is null
     or not exists (select 1 from public.socle_organizations m where m.organization_id = p_org_id and m.socle_id = v_root) then
    return null;
  end if;

  perform set_config('iris.socle_admin_profile', 'on', true);

  select p.id into v_id from public.permission_profiles p
   where p.organization_id = p_org_id and lower(btrim(p.name)) = 'administrateur';

  if v_id is not null then
    update public.permission_profiles
       set system_key = 'admin', name = 'Administrateur', description = v_description,
           is_admin = true, status = 'active', knowledge_base_access = true,
           default_view = true, default_create = true, default_process = true, default_close = true,
           version = version + 1, updated_at = now(), updated_by = null
     where id = v_id;
    delete from public.permission_profile_procedures where profile_id = v_id;
    delete from public.permission_profile_organizations where profile_id = v_id and socle_org_id <> v_root;
    insert into public.permission_profile_organizations (profile_id, socle_org_id)
    values (v_id, v_root) on conflict do nothing;
    insert into public.permission_audit_log (organization_id, actor_id, action, profile_id, profile_name, before, after)
    values (p_org_id, null, 'profile_updated', v_id, 'Administrateur', null,
            jsonb_build_object('system_key', 'admin', 'organizations', jsonb_build_array(v_root)));
  else
    insert into public.permission_profiles (
      organization_id, name, description, is_admin, knowledge_base_access, system_key,
      default_view, default_create, default_process, default_close, created_by, updated_by
    ) values (
      p_org_id, 'Administrateur', v_description, true, true, 'admin', true, true, true, true, null, null
    ) returning id into v_id;
    insert into public.permission_profile_organizations (profile_id, socle_org_id) values (v_id, v_root);
    insert into public.permission_audit_log (organization_id, actor_id, action, profile_id, profile_name, before, after)
    values (p_org_id, null, 'profile_created', v_id, 'Administrateur', null,
            jsonb_build_object('system_key', 'admin', 'organizations', jsonb_build_array(v_root)));
  end if;

  perform set_config('iris.socle_admin_profile', 'off', true);
  perform public.refresh_member_roles(p_org_id);
  return v_id;
end;
$$;

comment on function public.ensure_system_admin_profile(uuid) is
  'Profil système « Administrateur » du tenant : trouvé, repris (profil « Administrateur » existant, normalisé) ou créé. NULL si la racine manque au miroir. Service role.';

revoke all on function public.ensure_system_admin_profile(uuid) from public, anon, authenticated;
grant execute on function public.ensure_system_admin_profile(uuid) to service_role;

-- --------------------------------------------------------------------------
-- 4. La porte du Socle : attribuer ou retirer le profil système.
--    Rend 'granted' | 'revoked' | 'unchanged' | 'kept_last_admin' |
--    'not_member' | 'no_profile'.
-- --------------------------------------------------------------------------
create or replace function public.socle_set_admin_profile(p_org_id uuid, p_user_id uuid, p_admin boolean) returns text
    language plpgsql security definer
    set search_path to ''
as $$
declare
  v_profile uuid := public.ensure_system_admin_profile(p_org_id);
  v_root uuid;
  v_done uuid;
begin
  if v_profile is null then
    return 'no_profile';
  end if;

  if p_admin then
    if not exists (select 1 from public.organization_members m where m.organization_id = p_org_id and m.user_id = p_user_id) then
      return 'not_member';
    end if;
    perform set_config('iris.socle_admin_profile', 'on', true);
    insert into public.permission_profile_assignments (organization_id, profile_id, user_id, created_by)
    values (p_org_id, v_profile, p_user_id, null)
    on conflict (profile_id, user_id) do nothing
    returning profile_id into v_done;
    perform set_config('iris.socle_admin_profile', 'off', true);
    if v_done is null then
      return 'unchanged';
    end if;
    insert into public.permission_audit_log (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
    values (p_org_id, null, 'assignment_granted', v_profile, 'Administrateur', p_user_id, null,
            jsonb_build_object('profile_id', v_profile, 'user_id', p_user_id, 'source', 'socle'));
    perform public.refresh_member_roles(p_org_id);
    return 'granted';
  end if;

  if not exists (select 1 from public.permission_profile_assignments a where a.profile_id = v_profile and a.user_id = p_user_id) then
    return 'unchanged';
  end if;

  -- Le tenant garde au moins un administrateur sur la racine (même règle que
  -- `tenant_has_root_admin`, l'agent retiré mis à part).
  select o.socle_org_id into v_root from public.organizations o where o.id = p_org_id;
  if not exists (
    select 1
      from public.permission_profile_assignments a
      join public.permission_profiles p on p.id = a.profile_id and p.status = 'active' and p.is_admin
      join public.permission_profile_organizations po on po.profile_id = p.id and po.socle_org_id = v_root
     where a.organization_id = p_org_id and a.user_id <> p_user_id
  ) then
    return 'kept_last_admin';
  end if;

  perform set_config('iris.socle_admin_profile', 'on', true);
  delete from public.permission_profile_assignments where profile_id = v_profile and user_id = p_user_id;
  perform set_config('iris.socle_admin_profile', 'off', true);
  insert into public.permission_audit_log (organization_id, actor_id, action, profile_id, profile_name, target_user_id, before, after)
  values (p_org_id, null, 'assignment_revoked', v_profile, 'Administrateur', p_user_id,
          jsonb_build_object('profile_id', v_profile, 'user_id', p_user_id, 'source', 'socle'), null);
  perform public.refresh_member_roles(p_org_id);
  return 'revoked';
end;
$$;

comment on function public.socle_set_admin_profile(uuid, uuid, boolean) is
  'Seule porte du profil système « Administrateur » : attribution / retrait selon le rôle Iris donné par le Socle. Ne retire jamais le dernier administrateur racine. Service role (sync-socle-users).';

revoke all on function public.socle_set_admin_profile(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.socle_set_admin_profile(uuid, uuid, boolean) to service_role;

-- --------------------------------------------------------------------------
-- 5. Reprise : chaque tenant reçoit son profil système.
-- --------------------------------------------------------------------------
select public.ensure_system_admin_profile(o.id) from public.organizations o;
