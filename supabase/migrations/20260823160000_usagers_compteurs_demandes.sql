-- ============================================================================
-- Liste des usagers — compteurs de demandes par usager.
--
-- La liste des usagers est servie par le SOCLE (socle-proxy /v1/contacts/list) :
-- Iris n'a aucun miroir d'usagers et n'en aura pas. Les seules colonnes qui
-- soient des données Iris sont le NOMBRE de demandes et le nombre de demandes
-- ENCORE OUVERTES de chaque usager — d'où cette agrégation, qui remplace le
-- rapatriement de toutes les demandes du tenant dans le navigateur.
--
-- `security invoker` VOULU : le RLS s'applique donc à l'appelant, et les
-- compteurs ne comptent QUE les demandes de son périmètre (profils de droits,
-- couple organisation porteuse × démarche). Deux agents peuvent légitimement
-- lire deux nombres différents pour le même usager — c'est la règle, la même
-- que pour la liste des demandes et la fiche usager.
-- ⚠️ Ne jamais la passer en SECURITY DEFINER : ce serait une fuite de volumétrie
-- hors périmètre (et le piège `current_user` documenté dans CLAUDE.md).
-- ============================================================================

-- Les compteurs balaient les demandes d'un tenant par usager rapproché.
create index if not exists requests_org_contact_idx
  on public.requests (organization_id, socle_contact_id)
  where socle_contact_id is not null;

-- Noms de colonnes de sortie DISTINCTS des colonnes de `requests` : en
-- `language sql`, les colonnes d'un RETURNS TABLE sont des paramètres OUT
-- visibles dans le corps, et `socle_contact_id` y serait ambigu.
create or replace function public.contact_request_counts(p_org_id uuid)
returns table (contact_id uuid, total bigint, open_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.socle_contact_id,
         count(*)::bigint,
         -- Miroir EXACT de isFinal() (src/features/requests/statuts.ts) :
         -- ouvertes = les trois statuts non finaux du workflow fixe.
         count(*) filter (
           where r.status in ('a_traiter', 'en_instruction', 'en_attente')
         )::bigint
    from public.requests r
   where r.organization_id = p_org_id
     and r.socle_contact_id is not null
   group by r.socle_contact_id;
$$;

comment on function public.contact_request_counts(uuid) is
  'Liste des usagers : nombre de demandes et de demandes ouvertes par usager Socle rapproché. SECURITY INVOKER — borné au périmètre du lecteur par le RLS.';

revoke execute on function public.contact_request_counts(uuid) from public, anon;
grant  execute on function public.contact_request_counts(uuid) to authenticated;
