// Géocodage d'une adresse écrite (Base Adresse Nationale par défaut — voir
// `src/lib/carto.ts` pour le service et sa substitution). Brique partagée par
// le bloc « Lieu d'intervention » d'une fiche et le champ d'adresse assisté,
// d'où sa place à côté de `TileLayer`.
//
// Confort d'affichage, jamais une donnée de la demande : le point n'est ni
// stocké ni renvoyé au serveur Iris, seulement mis en cache le temps de la
// session. Une panne du service laisse l'adresse et l'itinéraire intacts.
// Une requête vide n'appelle rien : c'est ainsi qu'un lieu déposé AVEC son
// point (champ `location` du Socle) s'en dispense.

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
