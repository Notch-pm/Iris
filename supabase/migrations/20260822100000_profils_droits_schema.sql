-- ============================================================================
-- Profils de droits — M1/9 : schéma (5 tables), sentinelles, cohérence de
-- tenant sans FK inter-domaine, journal immuable.
-- Réf : spec-profils-droits.md RM-01 à RM-09, RM-25, RM-33, RM-57 ·
-- architecture-profils-droits.md ADR-01 (fonctions d'appoint), ADR-02.
-- Rejouable : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS partout.
-- Ordre de la carte de couplage : M1 → M9, aucune inversion (M6 avant M8).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sentinelle « sans démarche (historique) » — RM-36. IMMUTABLE : repliée en
-- constante à la planification, coût nul dans les policies et dans
-- permission_pairs_of (M2).
-- ----------------------------------------------------------------------------
create or replace function public.nil_procedure()
returns uuid language sql immutable parallel safe set search_path = '' as $$
  select '00000000-0000-0000-0000-000000000000'::uuid;
$$;
comment on function public.nil_procedure() is
  'Pseudo-démarche « Sans démarche (historique) » (RM-36) : couvre requests.socle_procedure_id IS NULL, couverte par les droits par défaut d''un profil.';
revoke execute on function public.nil_procedure() from public, anon;
grant  execute on function public.nil_procedure() to authenticated;

-- ----------------------------------------------------------------------------
-- Cast protégé pour les policies storage (ADR-06/M8) : le segment de chemin
-- n''est pas garanti UUID (dette existante : les policies actuelles castent
-- sans garde → 22P02 sur un chemin malformé, corrigée au passage).
-- ----------------------------------------------------------------------------
create or replace function public.uuid_or_null(p text)
returns uuid language plpgsql immutable parallel safe set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;
comment on function public.uuid_or_null(text) is
  'Cast text→uuid protégé (retourne NULL au lieu de lever 22P02). Usage : policies storage sur des segments de chemin non garantis UUID.';
revoke execute on function public.uuid_or_null(text) from public, anon;
grant  execute on function public.uuid_or_null(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Sérialisation d''un jeu de quatre booléens vers le vocabulaire de surface
-- (libellés imposés : consultation | creation | instruction | cloture — H).
-- ----------------------------------------------------------------------------
create or replace function public.rights_array(
  p_view boolean, p_create boolean, p_process boolean, p_close boolean)
returns jsonb language sql immutable parallel safe set search_path = '' as $$
  select to_jsonb(array_remove(array[
    case when p_view    then 'consultation' end,
    case when p_create  then 'creation'     end,
    case when p_process then 'instruction'  end,
    case when p_close   then 'cloture'      end
  ], null));
$$;
comment on function public.rights_array(boolean, boolean, boolean, boolean) is
  'Sérialise un jeu de 4 booléens de droits vers le tableau de libellés de surface (my_rights, M5).';
revoke execute on function public.rights_array(boolean, boolean, boolean, boolean) from public, anon;
grant  execute on function public.rights_array(boolean, boolean, boolean, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- permission_profiles — profil de droits d'un tenant (jamais partagé entre
-- tenants). NE PAS confondre avec public.users (« profils applicatifs »).
-- ----------------------------------------------------------------------------
create table if not exists public.permission_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  description     text,
  -- « Administration » (RM-20 à RM-24) : attribut du profil, PAS un cinquième
  -- niveau de la matrice. N'accorde par lui-même aucun droit sur les demandes.
  is_admin        boolean not null default false,
  -- Droits appliqués à toute démarche NON listée dans la matrice de ce profil,
  -- présente ou future, ainsi qu'aux demandes historiques sans démarche (RM-33,
  -- RM-36). Valeur initiale : aucun (fail closed, RM-32).
  default_view    boolean not null default false,
  default_create  boolean not null default false,
  default_process boolean not null default false,
  default_close   boolean not null default false,
  status          text not null default 'active' check (status in ('active','inactive')),
  version         int  not null default 1,          -- verrou optimiste (RM-56)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),  -- NULL = reprise (M6) ou service
  updated_by      uuid references public.users(id),
  constraint permission_profiles_default_implies_view
    check (default_view or not (default_create or default_process or default_close))
);
comment on table public.permission_profiles is
  'Profil de droits d''un tenant. Périmètre = permission_profile_organizations (sous-arbre), matrice = permission_profile_procedures, défaut = colonnes default_*.';

create unique index if not exists permission_profiles_name_unique
  on public.permission_profiles (organization_id, lower(btrim(name)));
create index if not exists permission_profiles_org_idx
  on public.permission_profiles (organization_id, status);

drop trigger if exists t02_permission_profiles_updated_at on public.permission_profiles;
create trigger t02_permission_profiles_updated_at
  before update on public.permission_profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- permission_profile_organizations — périmètre (sémantique SOUS-ARBRE, RM-25).
-- UUID Socle nu : AUCUNE FK (le miroir socle_organizations peut soft-delete un
-- nœud — CL-08/CL-25 — une organisation obsolète reste utilisable, RM-30).
-- ----------------------------------------------------------------------------
create table if not exists public.permission_profile_organizations (
  profile_id   uuid not null references public.permission_profiles(id) on delete cascade,
  socle_org_id uuid not null,
  created_at   timestamptz not null default now(),
  primary key (profile_id, socle_org_id)
);
comment on column public.permission_profile_organizations.socle_org_id is
  'Nœud du miroir socle_organizations du tenant. Inclut TOUTE sa descendance (RM-25). Cohérence de tenant garantie par trigger (permission_check_tenant_scope), jamais par FK inter-domaine.';
create index if not exists permission_profile_organizations_org_idx
  on public.permission_profile_organizations (socle_org_id);

-- ----------------------------------------------------------------------------
-- permission_profile_procedures — matrice de démarches. Une ligne à 4
-- booléens FALSE est une EXCEPTION EXPLICITE qui prime sur le défaut du
-- profil (« tout sauf l'état civil ») — voir permission_pairs_of (M2).
-- ----------------------------------------------------------------------------
create table if not exists public.permission_profile_procedures (
  profile_id         uuid not null references public.permission_profiles(id) on delete cascade,
  socle_procedure_id uuid not null,  -- UUID Socle nu ; nil_procedure() = pseudo-démarche historique
  right_view    boolean not null default false,
  right_create  boolean not null default false,
  right_process boolean not null default false,
  right_close   boolean not null default false,
  primary key (profile_id, socle_procedure_id),
  constraint permission_profile_procedures_implies_view
    check (right_view or not (right_create or right_process or right_close))
);
comment on table public.permission_profile_procedures is
  'Droits explicites par démarche (ou par la pseudo-démarche nil_procedure()). Ligne conservée si la démarche disparaît du cache (CL-25) — affichée « Démarche inconnue » côté UI.';

-- ----------------------------------------------------------------------------
-- permission_profile_assignments — attribution d'un profil à un utilisateur.
-- RM-40 déclaratif : on n'attribue qu'à un MEMBRE du tenant, et la perte de la
-- qualité de membre purge les attributions (CL-18, ON DELETE CASCADE via la FK
-- composite vers organization_members).
-- ----------------------------------------------------------------------------
create table if not exists public.permission_profile_assignments (
  organization_id uuid not null,      -- dénormalisé = permission_profiles.organization_id
  profile_id      uuid not null references public.permission_profiles(id) on delete cascade,
  user_id         uuid not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id),
  primary key (profile_id, user_id),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);
comment on table public.permission_profile_assignments is
  'Attribution (profil, utilisateur). Plusieurs profils par utilisateur — droits effectifs = union par couple (organisation, démarche), jamais stockée (calculée par permission_pairs_of, M2).';
create index if not exists permission_profile_assignments_user_idx
  on public.permission_profile_assignments (user_id, organization_id);
create index if not exists permission_profile_assignments_org_idx
  on public.permission_profile_assignments (organization_id, user_id);

-- ----------------------------------------------------------------------------
-- permission_audit_log — journal des droits (RM-57), immuable, pièce d'audit
-- RGPD. Écrit uniquement par les RPC (M5), jamais par le client.
-- ----------------------------------------------------------------------------
create table if not exists public.permission_audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references public.users(id) on delete set null,  -- NULL = service / reprise (M6)
  action          text not null check (action in (
                    'profile_created','profile_updated','profile_activated',
                    'profile_deactivated','profile_deleted',
                    'assignment_granted','assignment_revoked')),
  profile_id      uuid,          -- PAS de FK : le profil peut être supprimé, le journal survit
  profile_name    text not null,
  target_user_id  uuid references public.users(id) on delete set null,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
comment on table public.permission_audit_log is
  'Journal append-only des modifications de droits (qui, quand, quoi, avant/après). Pièce d''audit RGPD (RM-57) — jamais modifié ni supprimé, service_role compris.';
create index if not exists permission_audit_log_org_idx
  on public.permission_audit_log (organization_id, created_at desc);

-- forbid_change() existe déjà (supabase/migrations/20260820100200_requests_satellites.sql,
-- motif request_events) : réutilisée telle quelle, aucune redéfinition ici.
drop trigger if exists t01_permission_audit_log_immutable on public.permission_audit_log;
create trigger t01_permission_audit_log_immutable
  before update or delete on public.permission_audit_log
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- Cohérence intra-tenant SANS FK (RM-07) : une organisation ou une démarche
-- référencée par un profil doit appartenir au miroir/cache du MÊME tenant que
-- le profil. Vérifié à l'écriture uniquement (une démarche disparue du cache
-- plus tard conserve sa ligne — CL-25, comportement voulu).
-- SECURITY DEFINER : lit socle_organizations/socle_procedure_cache hors RLS.
-- ----------------------------------------------------------------------------
create or replace function public.permission_check_tenant_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select p.organization_id into v_org
    from public.permission_profiles p where p.id = new.profile_id;
  if v_org is null then
    raise exception 'Profil de droits introuvable.';
  end if;

  if tg_table_name = 'permission_profile_organizations' then
    if not exists (select 1 from public.socle_organizations m
                    where m.organization_id = v_org and m.socle_id = new.socle_org_id) then
      raise exception 'Organisation hors du miroir Socle du tenant : %.', new.socle_org_id;
    end if;

  elsif tg_table_name = 'permission_profile_procedures' then
    if new.socle_procedure_id <> public.nil_procedure()
       and not exists (select 1 from public.socle_procedure_cache c
                        where c.organization_id = v_org and c.socle_id = new.socle_procedure_id) then
      raise exception 'Démarche hors du cache du tenant : %.', new.socle_procedure_id;
    end if;

  elsif tg_table_name = 'permission_profile_assignments' then
    if new.organization_id is distinct from v_org then
      raise exception 'Attribution : le tenant de l''attribution ne correspond pas à celui du profil.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.permission_check_tenant_scope() from public, anon, authenticated;

drop trigger if exists t01_permission_profile_organizations_scope on public.permission_profile_organizations;
create trigger t01_permission_profile_organizations_scope
  before insert or update on public.permission_profile_organizations
  for each row execute function public.permission_check_tenant_scope();

drop trigger if exists t01_permission_profile_procedures_scope on public.permission_profile_procedures;
create trigger t01_permission_profile_procedures_scope
  before insert or update on public.permission_profile_procedures
  for each row execute function public.permission_check_tenant_scope();

drop trigger if exists t01_permission_profile_assignments_scope on public.permission_profile_assignments;
create trigger t01_permission_profile_assignments_scope
  before insert or update on public.permission_profile_assignments
  for each row execute function public.permission_check_tenant_scope();

-- ----------------------------------------------------------------------------
-- RLS activée dès la création (event trigger rls_auto_enable, préexistant) —
-- aucune policy ici : M9 pose les SELECT, aucune écriture cliente (ADR-03).
-- ----------------------------------------------------------------------------
alter table public.permission_profiles enable row level security;
alter table public.permission_profile_organizations enable row level security;
alter table public.permission_profile_procedures enable row level security;
alter table public.permission_profile_assignments enable row level security;
alter table public.permission_audit_log enable row level security;
