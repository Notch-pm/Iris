-- ============================================================================
-- Agents gérés par le Socle (annuaire des agents, lot 3 côté Iris).
--
-- Le Socle OUVRE l'accès à Iris (`GET /v1/users`, public-api 1.43.0 : un seul
-- rôle de base, « acces ») ; la fonction `sync-socle-users` l'applique.
-- Décision du 2026-10-30 : AUCUN profil par défaut — ce qu'un agent voit et
-- fait vient toujours de ses profils de droits, attribués dans Iris.
--
--   - accès ouvert   → appartenance au tenant (`organization_members`), sans
--                      profil : l'agent se connecte, ne voit rien tant qu'un
--                      administrateur ne lui a pas attribué de profil ;
--   - accès retiré   → compte BANNI, appartenance et profils CONSERVÉS (le
--                      retrait du membre supprimerait ses attributions en
--                      cascade — elles reviennent ainsi à la réactivation) ;
--   - admin plateforme : jamais touché.
-- ============================================================================

-- 1. Clé de correspondance : l'identifiant de l'agent dans le Socle.
alter table public.users add column if not exists socle_user_id uuid;
create unique index if not exists users_socle_user_id_key on public.users (socle_user_id);

comment on column public.users.socle_user_id is
  'Identifiant de l''agent dans le Socle (GET /v1/users). Posé = compte géré par le Socle. Écrit par le service role seulement.';

-- Le rattachement au Socle ne s'écrit que côté serveur (service role et
-- migrations : auth.uid() nul) — motif `t01_users_prevent_admin_escalation`.
create or replace function public.users_protect_socle_user_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.socle_user_id is distinct from old.socle_user_id and auth.uid() is not null then
    raise exception 'Le rattachement au Socle d''un compte ne se modifie pas depuis Iris.';
  end if;
  return new;
end $$;

revoke all on function public.users_protect_socle_user_id() from public, anon, authenticated;

drop trigger if exists t04_users_protect_socle_user_id on public.users;
create trigger t04_users_protect_socle_user_id
  before update of socle_user_id on public.users
  for each row execute function public.users_protect_socle_user_id();

-- 2. Ce que le Socle dit de chaque agent, par tenant : un accès actif ou non.
--    `organization_members` n'a pas d'état « inactif » (et le retrait d'un
--    membre emporte ses profils) : l'état vit ici, et le bannissement du
--    compte en découle (plus aucun accès actif nulle part ⇒ banni).
create table if not exists public.socle_member_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  is_active       boolean not null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.socle_member_access is
  'Accès à Iris ouvert (ou retiré) par le Socle, par tenant. Écrit par sync-socle-users (service role) seulement.';

alter table public.socle_member_access enable row level security;
revoke all on table public.socle_member_access from anon, authenticated;

-- 3. Curseur de lecture incrémentale, par tenant.
create table if not exists public.socle_user_sync_state (
  organization_id   uuid primary key references public.organizations(id) on delete cascade,
  cursor            text,
  last_full_sync_at timestamptz,
  last_run_at       timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);

comment on table public.socle_user_sync_state is
  'État de la synchronisation des agents depuis le Socle, par tenant. Service role seulement.';

alter table public.socle_user_sync_state enable row level security;
revoke all on table public.socle_user_sync_state from anon, authenticated;
