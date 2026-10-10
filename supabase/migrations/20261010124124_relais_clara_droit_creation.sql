-- « Demande complexe » relayée à Clara (2026-10-10) : qui peut relayer, et vers
-- quel organisme ?
--
-- Une demande complexe n'a PAS de démarche — c'est précisément pourquoi elle
-- part à Clara au lieu de devenir une demande d'Iris (aucune demande libre,
-- invariant). Le droit se lit donc sur l'ORGANISME seul : l'agent doit détenir
-- le droit de CRÉATION sur au moins un couple (organisme, démarche) — explicite
-- ou par défaut, la pseudo-démarche « sans démarche » comprise. Relayer, c'est
-- un geste de guichet : qui ne peut rien déposer pour cet organisme n'a pas à
-- lui adresser de courrier au nom d'un usager.
--
-- Rien n'est écrit dans Iris : cette fonction est la seule trace du lot en base.
-- Appelée par l'edge function `relay-courrier-clara` (service_role) — jamais
-- par un client : le navigateur reflète la même règle dans `rights.ts`
-- (`relayOrganizationIds`), le serveur décide.

create or replace function public.user_can_create_on_organization(
  p_user_id uuid, p_org_id uuid, p_socle_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_platform_admin from public.users u where u.id = p_user_id), false)
      or exists (
        select 1 from public.permission_pairs_of(
                 array(select a.profile_id
                         from public.permission_profile_assignments a
                         join public.permission_profiles p on p.id = a.profile_id
                        where a.user_id = p_user_id
                          and a.organization_id = p_org_id
                          and p.status = 'active'),
                 'creation', p_org_id) s
         where s.socle_org_id = public.request_scope_org(p_org_id, p_socle_org_id)
      );
$$;

comment on function public.user_can_create_on_organization(uuid, uuid, uuid) is
  'Droit de création sur au moins une démarche (ou la pseudo-démarche « sans démarche ») pour cet organisme — garde du relais d''une demande complexe à Clara. Service seulement.';

revoke execute on function public.user_can_create_on_organization(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.user_can_create_on_organization(uuid, uuid, uuid) to service_role;
