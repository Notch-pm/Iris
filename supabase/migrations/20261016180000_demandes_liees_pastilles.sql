-- ============================================================================
-- Demandes liées — PASTILLES de la liste des demandes (lot L5 de
-- docs/demandes-liees.md).
--
-- Pour les lignes d'une page de la liste (50 au plus), en UN appel :
--   · `group_size` — membres VISIBLES du groupe « même incident » de la demande
--     (le RLS des membres borne le compte : aucun membre invisible n'est
--     compté), 0 hors groupe ;
--   · `likely_similar` — demandes approchantes « même incident probable »,
--     parmi celles que l'agent peut lire (`find_similar_requests_for`, SECURITY
--     INVOKER), hors du groupe.
--
-- C'est ainsi que les demandes ARRIVÉES SANS AGENT (portail, partenaires, Clara)
-- sont repérées : la piste est calculée à l'AFFICHAGE, quelle que soit l'origine
-- du dépôt, toujours à jour, sans rien greffer sur le chemin d'ingestion et sans
-- rien stocker. Aucune notification (choix par défaut, 2026-10-16) : une pastille,
-- l'agent ouvre la fiche et décide.
--
-- ⚠️ JUMEAU de `likely` dans `src/features/linking/similaires.ts` : lieu proche
-- (point à moins de la moitié du rayon, ou adresse similaire à 0,5 au moins) ET
-- description qui converge (texte à 0,3 au moins). Toute évolution de l'un se
-- reporte dans l'autre — sinon la pastille annoncerait ce que la fiche ne
-- montre pas.
-- ============================================================================

create or replace function public.request_link_hints(p_request_ids uuid[])
returns table (request_id uuid, group_size integer, likely_similar integer)
language sql stable security invoker set search_path = '' as $$
  select r.id,
         coalesce((select count(*)::int from public.request_group_members m2
                    where m2.group_id = m.group_id), 0),
         case when r.status in ('a_traiter', 'en_instruction', 'en_attente') then
           (select count(*)::int
              from public.find_similar_requests_for(r.id, 30) f
             where ((f.distance_m is not null and f.distance_m <= f.radius_m / 2.0)
                    or coalesce(f.address_similarity, 0) >= 0.5)
               and coalesce(f.text_similarity, 0) >= 0.3)
         else 0 end
    from public.requests r
    left join public.request_group_members m on m.request_id = r.id
   where r.id = any((coalesce(p_request_ids, '{}'))[1:50]);
$$;
revoke execute on function public.request_link_hints(uuid[]) from public, anon;
grant execute on function public.request_link_hints(uuid[]) to authenticated, service_role;
