// Recherche globale du header — les DEUX sources, et le rythme de la frappe.
//
//  · les DEMANDES sont des données Iris : requête PostgREST bornée au tenant et
//    au RLS (l'agent ne trouve que ce qu'il a le droit de voir) ;
//  · les USAGERS vivent dans le Socle : `socle-proxy /v1/contacts/search`, dont
//    la garde exige un droit de création (RM-64). Sans ce droit, la barre ne
//    cherche que des demandes — l'appel n'est même pas émis.
//
// Invariant : aucun usager n'est mis en cache par Iris (`gcTime: 0`), comme la
// fiche usager et l'annuaire. Une panne du référentiel ne fait pas échouer la
// recherche : elle en retire le groupe « Usagers ».

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { SocleContact } from "@/features/contacts/rapprochement";
import { useTenantMembers } from "@/features/requests/useRequests";
import { invokeEdge } from "@/lib/edge";
import { supabase } from "@/lib/supabase";
import {
  buildGroups, isSearchable, normalizeQuery, RESULTS_PER_KIND, SEARCH_DEBOUNCE_MS,
  type RequestSearchRow, type SearchGroup,
} from "./search";

const THIRTY_SECONDS = 30_000;

/**
 * Valeur retardée d'un délai (motif `useAddressSuggestions`) : le cache de
 * TanStack Query dédoublonne les préfixes déjà tapés, ce délai-ci évite
 * d'ÉMETTRE la requête intermédiaire — un aller-retour par caractère sinon.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface GlobalSearchResult {
  groups: SearchGroup[];
  /** Une requête est en vol pour une saisie sans réponse affichée. */
  isLoading: boolean;
  /** La frappe est en avance sur les résultats affichés. */
  isStale: boolean;
  /** Le référentiel d'usagers n'a pas répondu — les demandes, elles, sont là. */
  usagersUnavailable: boolean;
  /** Les demandes n'ont pas pu être lues (panne, session expirée). */
  requestsFailed: boolean;
  /** La recherche a rendu son verdict : le vide affiché est un vrai « rien ». */
  settled: boolean;
}

export function useGlobalSearch(
  orgId: string,
  raw: string,
  withUsagers: boolean,
): GlobalSearchResult {
  const query = normalizeQuery(raw);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const active = Boolean(orgId) && isSearchable(debounced);

  const requests = useQuery({
    queryKey: ["global-search-requests", orgId, debounced],
    enabled: active,
    staleTime: THIRTY_SECONDS,
    // Pendant la frappe, un échec se remplace tout seul au caractère suivant.
    retry: false,
    queryFn: async (): Promise<RequestSearchRow[]> => {
      // RPC et non `from("requests")` : la comparaison doit être faite sur du
      // texte DÉSACCENTUÉ des deux côtés, ce que PostgREST ne sait pas
      // exprimer dans un filtre. `search_requests` est SECURITY INVOKER — le
      // RLS borne le résultat exactement comme le faisait le select.
      const { data, error } = await supabase.rpc("search_requests", {
        p_org_id: orgId,
        p_query: debounced,
        p_limit: RESULTS_PER_KIND,
      });
      if (error) throw error;
      return (data ?? []) as RequestSearchRow[];
    },
  });

  const usagers = useQuery({
    queryKey: ["global-search-usagers", orgId, debounced],
    enabled: active && withUsagers,
    // Aucune rétention : Iris ne met aucun usager en cache (invariant).
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<SocleContact[]> => {
      const data = await invokeEdge<{ contacts: SocleContact[] }>(
        "socle-proxy/v1/contacts/search",
        { organization_id: orgId, search: debounced, limit: RESULTS_PER_KIND },
      );
      return Array.isArray(data.contacts) ? data.contacts : [];
    },
  });

  // Les noms d'agents ne sont chargés qu'une fois une recherche lancée : le
  // header est monté sur toutes les pages, il n'a pas à interroger le tenant
  // tant que personne n'a rien cherché.
  const members = useTenantMembers(orgId, active);
  const memberList = members.data ?? [];
  const nameOf = React.useCallback(
    (userId: string) => memberList.find((m) => m.userId === userId)?.displayName ?? "Utilisateur",
    [memberList],
  );

  const requestHits = requests.data ?? [];
  const contactHits = usagers.data ?? [];
  const groups = React.useMemo(
    () => buildGroups(requestHits, contactHits, nameOf),
    [requestHits, contactHits, nameOf],
  );

  const isLoading = requests.isFetching || usagers.isFetching;
  return {
    groups,
    isLoading,
    isStale: debounced !== query,
    usagersUnavailable: withUsagers && usagers.isError,
    requestsFailed: requests.isError,
    settled: active && !isLoading && debounced === query,
  };
}
