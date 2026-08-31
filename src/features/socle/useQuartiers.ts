// Quartiers du territoire, lus à la demande via `socle-proxy` (le référentiel
// fait foi ; Iris n'en garde rien). La géométrie ne sert qu'à DESSINER : elle
// n'est ni stockée, ni renvoyée au serveur Iris — même règle que les points de
// la carte des interventions.
//
// Les limites bougent rarement : cache long, pour ne pas redemander un
// polygone à chaque frappe dans un champ d'adresse.
//
// ⚠️ Une couche de CONFORT : si le référentiel n'expose pas la route, ou s'il
// ne répond pas, la carte s'affiche sans quartiers et rien d'autre ne change.
// D'où l'absence de `retry` et l'erreur avalée en liste vide.

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { parseQuartiers, type QuartierShape } from "./quartiers";

const ONE_HOUR = 60 * 60 * 1000;

export interface QuartiersResult {
  quartiers: QuartierShape[];
  /**
   * La réponse n'est pas encore là. À distinguer d'une liste vide : « pas de
   * quartiers » et « on ne sait pas encore » ne se cadrent pas pareil sur la
   * carte des interventions, qui s'ouvre sur l'étendue du territoire.
   */
  pending: boolean;
}

export function useQuartiers(orgId: string): QuartiersResult {
  const query = useQuery({
    queryKey: ["socle-quartiers", orgId],
    enabled: Boolean(orgId),
    staleTime: ONE_HOUR,
    gcTime: ONE_HOUR,
    retry: false,
    queryFn: async (): Promise<QuartierShape[]> => {
      const data = await invokeEdge<unknown>("socle-proxy/v1/quartiers/list", {
        organization_id: orgId,
      });
      return parseQuartiers(data);
    },
  });
  // `isLoading` et non `isPending` : une requête désactivée (pas d'orgId) reste
  // `pending` pour toujours, et bloquerait l'appelant qui l'attend.
  return { quartiers: query.data ?? [], pending: query.isLoading };
}
