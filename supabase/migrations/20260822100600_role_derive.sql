-- ============================================================================
-- Profils de droits — M7/9 : organization_members.role devient une colonne
-- DÉRIVÉE, en écriture forcée (RM-43, Q6 recommandation b).
-- Réf : spec-profils-droits.md §3.G · architecture-profils-droits.md ADR-10.
-- Filet de compatibilité pendant la bascule progressive (front/edge functions
-- en version courante lisent encore `role`) : la colonne reste exacte à tout
-- instant, mais n'est plus la source d'autorité — is_org_admin (redéfinie
-- ci-dessous) et le reste du RLS (M8) lisent has_admin_scope/permission_pairs_of.
-- is_org_writer N'EST PAS supprimée ici : elle reste appelée par les policies
-- pré-bascule jusqu'à M8, qui la remplace ET la supprime dans la MÊME
-- migration (jamais de fenêtre où elle existe sans appelant ni où elle est
-- absente avec un appelant restant).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- member_role_derived — administrateur ⇔ au moins une attribution active à un
-- profil is_admin dans CE tenant ; agent sinon. Fonction interne (appelée par
-- le trigger et par refresh_member_roles), jamais exécutable par un client.
-- ----------------------------------------------------------------------------
create or replace function public.member_role_derived(p_org_id uuid, p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
     where a.organization_id = p_org_id and a.user_id = p_user_id
  ) then 'administrateur' else 'agent' end;
$$;
revoke execute on function public.member_role_derived(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- organization_members_force_role — écrase toute valeur fournie par le
-- client : `role` n'est plus ni saisi ni éditable en surface (RM-43).
-- ----------------------------------------------------------------------------
create or replace function public.organization_members_force_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.role := public.member_role_derived(new.organization_id, new.user_id);
  return new;
end;
$$;
revoke execute on function public.organization_members_force_role() from public, anon, authenticated;

drop trigger if exists t01_organization_members_role_derived on public.organization_members;
create trigger t01_organization_members_role_derived
  before insert or update on public.organization_members
  for each row execute function public.organization_members_force_role();

-- ----------------------------------------------------------------------------
-- refresh_member_roles — appelée par les RPC d'écriture (M5) après toute
-- modification affectant potentiellement des rôles dérivés. Ne touche que
-- les lignes dont la valeur change réellement.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_member_roles(p_org_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.organization_members m
     set role = public.member_role_derived(m.organization_id, m.user_id)
   where m.organization_id = p_org_id
     and m.role is distinct from public.member_role_derived(m.organization_id, m.user_id);
$$;
revoke execute on function public.refresh_member_roles(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Filet défensif : toute écriture FUTURE sur permission_profiles ou
-- permission_profile_assignments qui contournerait les RPC (service_role
-- direct, script de purge) déclenche quand même un rafraîchissement. Limité à
-- CES DEUX tables : ce sont les seules dont une colonne (is_admin, status) ou
-- l'existence d'une ligne (attribution) entre dans member_role_derived — le
-- périmètre d'organisations (permission_profile_organizations) et la matrice
-- de démarches (permission_profile_procedures) n'y entrent JAMAIS, un trigger
-- dessus serait un coût sans effet. Row-level (pas STATEMENT) : évite les
-- tables de transition, le volume de ces tables reste faible (paramétrage,
-- jamais le chemin chaud des listes de demandes).
-- ----------------------------------------------------------------------------
create or replace function public.permission_profiles_refresh_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_member_roles(old.organization_id);
    return old;
  else
    perform public.refresh_member_roles(new.organization_id);
    return new;
  end if;
end;
$$;
revoke execute on function public.permission_profiles_refresh_roles() from public, anon, authenticated;

drop trigger if exists t95_permission_profiles_refresh_roles on public.permission_profiles;
create trigger t95_permission_profiles_refresh_roles
  after insert or update or delete on public.permission_profiles
  for each row execute function public.permission_profiles_refresh_roles();

create or replace function public.permission_profile_assignments_refresh_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_member_roles(old.organization_id);
    return old;
  else
    perform public.refresh_member_roles(new.organization_id);
    return new;
  end if;
end;
$$;
revoke execute on function public.permission_profile_assignments_refresh_roles() from public, anon, authenticated;

drop trigger if exists t95_permission_profile_assignments_refresh_roles on public.permission_profile_assignments;
create trigger t95_permission_profile_assignments_refresh_roles
  after insert or update or delete on public.permission_profile_assignments
  for each row execute function public.permission_profile_assignments_refresh_roles();

-- ----------------------------------------------------------------------------
-- is_org_admin — REDÉFINIE : « administration sur TOUT le tenant » (racine),
-- au sens des profils. Continue de gouverner les gestes GLOBAUX (gestion des
-- membres, journal des intégrations) — PAS les gestes liés à une demande
-- précise, qui passent tous à has_admin_scope(org, socle_scope_org_id) dès M8.
-- Re-révoque/re-grante par principe (piège CLAUDE.md : CREATE OR REPLACE).
-- ----------------------------------------------------------------------------
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or public.has_admin_scope(p_org_id,
           (select o.socle_org_id from public.organizations o where o.id = p_org_id));
$$;
comment on function public.is_org_admin(uuid) is
  'Administration sur la RACINE du tenant (gestes globaux : membres, intégrations). Redéfinie sur has_admin_scope (M7) — ne lit plus organization_members.role.';
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant  execute on function public.is_org_admin(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- is_last_root_admin — RM-42 côté RETRAIT DE MEMBRE (pas seulement retrait de
-- profil, M5) : la policy organization_members_delete reste ouverte aux
-- administrateurs (is_org_admin, redéfini ci-dessus) et une suppression de
-- membre CASCADE vers permission_profile_assignments (FK ON DELETE CASCADE,
-- M1) — un chemin d'écriture HORS des RPC de M5, qui doit donc porter son
-- propre garde-fou (ci-dessous). Fonction booléenne pure, GRANT authenticated
-- (appelée par un trigger INVOKER, cf. plus bas) : ne révèle qu'un booléen
-- sur un membre du MÊME tenant que l'appelant — is_org_member(p_org_id) en
-- protège l'accès (sinon FALSE, jamais d'erreur : simple prédicat).
-- ----------------------------------------------------------------------------
create or replace function public.is_last_root_admin(p_org_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when not public.is_org_member(p_org_id) then false else
    exists (
      select 1
        from public.permission_profile_assignments a
        join public.permission_profiles p
          on p.id = a.profile_id and p.status = 'active' and p.is_admin
        join public.permission_profile_organizations po
          on po.profile_id = p.id
         and po.socle_org_id = (select o.socle_org_id from public.organizations o where o.id = p_org_id)
       where a.organization_id = p_org_id and a.user_id = p_user_id
    )
    and not exists (
      select 1
        from public.permission_profile_assignments a
        join public.permission_profiles p
          on p.id = a.profile_id and p.status = 'active' and p.is_admin
        join public.permission_profile_organizations po
          on po.profile_id = p.id
         and po.socle_org_id = (select o.socle_org_id from public.organizations o where o.id = p_org_id)
       where a.organization_id = p_org_id and a.user_id <> p_user_id
    )
  end;
$$;
comment on function public.is_last_root_admin(uuid, uuid) is
  'Vrai si p_user_id est le SEUL détenteur actif d''une attribution admin sur la racine Socle de p_org_id (RM-42). FALSE si l''appelant n''est pas membre de p_org_id (anti-fuite).';
revoke execute on function public.is_last_root_admin(uuid, uuid) from public, anon;
grant  execute on function public.is_last_root_admin(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- organization_members_protect_last_admin — BEFORE DELETE, INVOKER (SANS
-- security definer, volontairement — cf. piège DEFINER/current_user en tête
-- de 20260822100300_profils_droits_gardes.sql : is_service_context() n'est
-- fiable QUE dans une fonction INVOKER). Bloque la suppression du dernier
-- membre détenant l'administration racine, sauf en contexte de service
-- (reprise, purge RGPD service_role — de confiance par construction, même
-- posture que le reste du projet).
-- ----------------------------------------------------------------------------
create or replace function public.organization_members_protect_last_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_service_context()
     and public.is_last_root_admin(old.organization_id, old.user_id) then
    raise exception 'Le tenant doit conserver au moins un administrateur sur l''organisation racine.';
  end if;
  return old;
end;
$$;
revoke execute on function public.organization_members_protect_last_admin() from public, anon, authenticated;

drop trigger if exists t05_organization_members_protect_last_admin on public.organization_members;
create trigger t05_organization_members_protect_last_admin
  before delete on public.organization_members
  for each row execute function public.organization_members_protect_last_admin();

-- ----------------------------------------------------------------------------
-- Rattrapage immédiat : tous les tenants existants reflètent déjà M6 (reprise)
-- au moment où cette migration s'applique — un seul passage suffit, mais il
-- est explicite plutôt qu'implicite (les triggers ci-dessus ne couvrent que
-- l'AVENIR).
-- ----------------------------------------------------------------------------
do $$
declare v_org record;
begin
  for v_org in select id from public.organizations loop
    perform public.refresh_member_roles(v_org.id);
  end loop;
end;
$$;
