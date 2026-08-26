// Géocodage de l'adresse d'intervention (Base Adresse Nationale par défaut —
// voir `src/lib/carto.ts` pour le service et sa substitution).
//
// Confort d'instruction, jamais une donnée de la demande : le point n'est ni
// stocké ni renvoyé au serveur Iris, seulement mis en cache le temps de la
// session. Une panne du service laisse l'adresse et l'itinéraire intacts.

import { useQuery } from "@tanstack/react-query";
import { geocodeUrl, parseGeocodeResponse, type GeoPoint } from "@/lib/carto";

const ONE_DAY = 24 * 60 * 60 * 1000;

export function useGeocode(query: string, postcode: string | null) {
  const url = geocodeUrl(query, postcode);
  return useQuery({
    queryKey: ["geocode", url],
    enabled: url !== null,
    staleTime: ONE_DAY,
    gcTime: ONE_DAY,
    retry: 1,
    queryFn: async ({ signal }): Promise<GeoPoint | null> => {
      const response = await fetch(url!, { signal, headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Service de localisation indisponible (HTTP ${response.status}).`);
      }
      return parseGeocodeResponse(await response.json());
    },
  });
}
