-- ============================================================================
-- Administration des comptes — habilitations lisibles côté SERVICE.
-- Réf : docs/droits.md (RM-20/RM-23), CLAUDE.md « la sécurité vit dans le RLS ».
--
-- L'edge function `admin-users` (service_role) doit répondre à deux questions
-- que le RLS ne peut pas trancher pour elle, faute de `auth.uid()` :
--   • cet appelant administre-t-il ce tenant ?
--   • cet appelant a-t-il autorité sur ce compte (invitation, renvoi de lien) ?
--
-- Motif déjà en place dans le projet : `has_any_creation_right_for`, variante
-- paramétrée par utilisateur, révoquée des clients et appelée en service_role
-- par socle-proxy. Même forme ici — la règle reste écrite une seule fois, en
-- SQL, et l'edge function ne fait que la consulter.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_org_admin_anywhere_for — miroir de is_org_admin_anywhere pour un
-- utilisateur DONNÉ (l'appelant du service), et non `auth.uid()`.
-- ----------------------------------------------------------------------------
create or replace function public.is_org_admin_anywhere_for(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
    select 1 from public.permission_profile_assignments a
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
     where a.user_id = p_user_id and a.organization_id = p_org_id
  );
$$;

comment on function public.is_org_admin_anywhere_for(uuid, uuid) is
  'Administration d''un tenant par un utilisateur donné (RM-20) — variante service de is_org_admin_anywhere, révoquée des clients.';
revoke execute on function public.is_org_admin_anywhere_for(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.is_org_admin_anywhere_for(uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- can_manage_account — autorité d'un acteur sur un compte : administrateur
-- plateforme, ou administrateur d'AU MOINS UN tenant dont le compte est membre.
-- Gouverne l'invitation et le renvoi d'un lien de mot de passe.
-- ----------------------------------------------------------------------------
create or replace function public.can_manage_account(p_actor_id uuid, p_target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_actor_id), false)
      or exists (
    select 1
      from public.organization_members m
      join public.permission_profile_assignments a
        on a.organization_id = m.organization_id and a.user_id = p_actor_id
      join public.permission_profiles p
        on p.id = a.profile_id and p.status = 'active' and p.is_admin
     where m.user_id = p_target_id
  );
$$;

comment on function public.can_manage_account(uuid, uuid) is
  'Autorité d''un acteur sur un compte (invitation, renvoi de lien de mot de passe) : plateforme, ou administration d''un tenant dont le compte est membre. SERVICE UNIQUEMENT.';
revoke execute on function public.can_manage_account(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.can_manage_account(uuid, uuid) to service_role;
