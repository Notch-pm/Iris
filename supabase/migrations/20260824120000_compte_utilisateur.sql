-- ============================================================================
-- « Mon compte » — photo de profil et verrouillage de l'adresse e-mail.
--
-- Le changement de mot de passe ne demande AUCUNE migration : il passe par
-- GoTrue (`auth.updateUser`), après revérification de l'ancien mot de passe
-- côté client (`signInWithPassword`) — Iris ne stocke aucun mot de passe et
-- n'en voit jamais un seul.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Photo de profil — bucket PRIVÉ.
--
-- ⚠️ Les policies storage vivent dans une migration versionnée : le `db dump`
-- ne couvre pas le schéma storage (constat Socle).
--
-- Pourquoi privé et pas public : la photo d'un agent est une donnée
-- personnelle. Un bucket public la sert à qui connaît l'URL, sans
-- authentification et sans trace. On la lit donc par URL signée temporaire,
-- comme les pièces de demandes.
--
-- Convention de chemin PORTEUSE du RLS : {user_id}/{uuid}.{ext}
-- Un nouvel envoi écrit un NOUVEAU chemin (l'ancien est supprimé ensuite) :
-- pas de cache de navigateur à combattre, pas d'objet écrasé en place.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- Lecture : la sienne, et celle des collègues du même tenant — la photo sert à
-- se reconnaître, elle n'aurait aucun intérêt visible de son seul propriétaire.
-- `shares_org_with` est le helper existant (SECURITY DEFINER, anti-récursion).
drop policy if exists "avatars_storage_select" on storage.objects;
create policy "avatars_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1])::uuid = (select auth.uid())
      or public.shares_org_with(((storage.foldername(name))[1])::uuid)
    )
  );

-- Écriture : SA photo, et rien d'autre. Aucun administrateur ne pose la photo
-- de quelqu'un d'autre — ce n'est pas un attribut administré, c'est un geste
-- personnel.
drop policy if exists "avatars_storage_insert" on storage.objects;
create policy "avatars_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

drop policy if exists "avatars_storage_update" on storage.objects;
create policy "avatars_storage_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

drop policy if exists "avatars_storage_delete" on storage.objects;
create policy "avatars_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

-- Chemin de la photo courante. NULL = pas de photo, on affiche les initiales.
alter table public.users add column if not exists avatar_path text;
comment on column public.users.avatar_path is
  'Chemin de la photo de profil dans le bucket privé « avatars » ({user_id}/{uuid}.{ext}). NULL = initiales. Lu par URL signée, jamais public.';

-- ----------------------------------------------------------------------------
-- 2. L'adresse e-mail n'est pas modifiable par son titulaire.
--
-- `public.users.email` est un MIROIR de `auth.users.email` (posé par
-- handle_new_user) : c'est l'identifiant de connexion, il est administré. La
-- policy `users_update` autorise un utilisateur à écrire SA ligne (nom,
-- photo) — sans cette garde, il pourrait aussi y réécrire son adresse et
-- désynchroniser silencieusement le miroir de l'identité GoTrue, sans que sa
-- connexion change pour autant.
--
-- L'UI ne fait que refléter cette règle : la sécurité vit ici.
-- Le contexte de service (admin-users, provisionnement) et l'administrateur de
-- plateforme passent — même posture que l'anti-escalade voisine.
-- ----------------------------------------------------------------------------

create or replace function public.users_protect_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.email is distinct from old.email
     and not public.is_service_context()
     and not public.is_platform_admin() then
    raise exception 'L''adresse e-mail est administrée : elle ne se modifie pas depuis « Mon compte ».';
  end if;
  return new;
end;
$$;
revoke execute on function public.users_protect_email() from public, anon, authenticated;

drop trigger if exists t03_users_protect_email on public.users;
create trigger t03_users_protect_email
  before update on public.users
  for each row execute function public.users_protect_email();
