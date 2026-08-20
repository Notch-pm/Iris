-- ============================================================================
-- Fondations Iris — 1/4 : identité, tenants, appartenances, helpers RLS.
-- Réf : docs/architecture-proposee.md §1.1, §1.2, §4 · docs/data-model.md.
-- Rejouable : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS partout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables d'identité
-- ----------------------------------------------------------------------------

-- Tenant Iris = une organisation RACINE Socle. Pas de hiérarchie locale :
-- la hiérarchie vit dans le Socle (le miroir arrivera dans une vague ultérieure).
create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  socle_org_id  uuid not null unique,
  name          text not null,
  status        text not null default 'active' check (status in ('active','obsolete')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.organizations is
  'Tenants Iris. Un tenant = une organisation racine Socle (socle_org_id).';
comment on column public.organizations.socle_org_id is
  'UUID de l''organisation racine côté Socle. Référence nue, SANS FK inter-base (projets Supabase distincts).';

-- Profils applicatifs, créés par trigger depuis auth.users — jamais par le client.
create table if not exists public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null unique,
  first_name         text,
  last_name          text,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now()
);
comment on column public.users.is_platform_admin is
  'Admin plateforme (provisioning tenants, clés API). Auto-promotion bloquée par trigger.';

-- Appartenance au tenant + rôle fonctionnel. PK composite et colonnes NOT NULL
-- (correction volontaire par rapport à user_organizations de Socle, nullable).
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  role            text not null check (role in ('admin','superviseur','agent','lecteur')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
comment on column public.organization_members.role is
  'admin : paramétrage/membres/archivage · superviseur : affectation/réouverture · agent : instruction · lecteur : lecture seule.';

-- ----------------------------------------------------------------------------
-- Helpers RLS — SECURITY DEFINER, search_path vide, anti-récursion.
-- ⚠️ SECURITY DEFINER obligatoire : en INVOKER, une policy qui relit la table
-- qu'elle protège provoque une récursion infinie (stack depth limit exceeded)
-- — piège documenté chez Socle. Chaque fonction est STABLE et entièrement
-- qualifiée (search_path = '').
-- ----------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.is_platform_admin from public.users u where u.id = auth.uid()),
    false
  );
$$;

create or replace function public.member_role(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m
  where m.organization_id = p_org_id and m.user_id = auth.uid();
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or public.member_role(p_org_id) is not null;
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or public.member_role(p_org_id) = 'admin';
$$;

-- Rôles autorisés à écrire (le lecteur est exclu de toute écriture).
create or replace function public.is_org_writer(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
      or public.member_role(p_org_id) in ('admin','superviseur','agent');
$$;

-- Visibilité des profils : partage d'au moins un tenant (affichage des
-- affectations et des auteurs).
create or replace function public.shares_org_with(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b using (organization_id)
    where a.user_id = auth.uid() and b.user_id = p_user_id
  );
$$;

-- Contexte de service (migrations, tests SQL, edge functions en service_role).
-- ⚠️ SECURITY INVOKER volontaire : current_user doit refléter le rôle de session,
-- pas le propriétaire — ne JAMAIS passer cette fonction en DEFINER.
create or replace function public.is_service_context()
returns boolean language sql stable set search_path = '' as $$
  select current_user in ('postgres','service_role','supabase_admin');
$$;

-- Droits EXECUTE minimaux : les helpers évalués par le RLS doivent être
-- exécutables par authenticated (évaluation avec les droits de l'appelant) ;
-- tout le reste est révoqué.
revoke execute on function
  public.is_platform_admin(), public.member_role(uuid), public.is_org_member(uuid),
  public.is_org_admin(uuid), public.is_org_writer(uuid), public.shares_org_with(uuid),
  public.is_service_context()
from public, anon;
grant execute on function
  public.is_platform_admin(), public.member_role(uuid), public.is_org_member(uuid),
  public.is_org_admin(uuid), public.is_org_writer(uuid), public.shares_org_with(uuid),
  public.is_service_context()
to authenticated;

-- ----------------------------------------------------------------------------
-- Fonctions trigger — SECURITY DEFINER quand elles doivent contourner le RLS,
-- INVOKER quand elles portent une logique dépendant du rôle de session.
-- ⚠️ EXECUTE révoqué de anon/authenticated/PUBLIC (advisors 0028/0029 : sinon
-- appelables via /rest/v1/rpc/…). À re-révoquer à chaque CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Miroir auth.users → public.users à l'inscription.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, first_name, last_name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@inconnu.local'),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anti-escalade : is_platform_admin n'est modifiable que par un admin plateforme
-- ou en contexte de service (motif prevent_superadmin_escalation de Clara).
create or replace function public.users_prevent_admin_escalation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and not public.is_service_context()
     and not public.is_platform_admin() then
    raise exception 'Seul un administrateur plateforme peut modifier is_platform_admin.';
  end if;
  return new;
end;
$$;
revoke execute on function public.users_prevent_admin_escalation() from public, anon, authenticated;

drop trigger if exists t01_users_prevent_admin_escalation on public.users;
create trigger t01_users_prevent_admin_escalation
  before update on public.users
  for each row execute function public.users_prevent_admin_escalation();

drop trigger if exists t02_organizations_updated_at on public.organizations;
create trigger t02_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — activée sur TOUTES les tables. Le service_role contourne le RLS par
-- attribut : aucune policy « service » à écrire (en écrire une avec un TO
-- manquant l'ouvrirait à authenticated — faille documentée chez Clara).
-- ----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations
  for insert to authenticated with check (public.is_platform_admin());
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations
  for delete to authenticated using (public.is_platform_admin());

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_platform_admin() or public.shares_org_with(id));
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());
-- Pas de policy INSERT (trigger handle_new_user seul) ni DELETE (cascade auth).

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin(organization_id));
drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members
  for insert to authenticated with check (public.is_org_admin(organization_id));
drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members
  for delete to authenticated using (public.is_org_admin(organization_id));
