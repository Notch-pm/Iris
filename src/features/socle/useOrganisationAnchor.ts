// Point d'ancrage de la carte : le SIÈGE de la collectivité.
//
// POURQUOI. La carte des interventions se recadrait sur le barycentre de ses
// épingles (`fitBounds`). Une seule demande à l'autre bout du pays suffisait à
// planter le centre au milieu de nulle part — une demande à Nantes et le reste
// autour d'Arles donnent la Corrèze, où il n'y a rien à voir, et à `MIN_ZOOM`
// (12) pas même les épingles qui ont produit ce centre. L'organisation
// principale, elle, est un lieu qui a un SENS : c'est le territoire de l'agent.
//
// D'OÙ VIENT L'ADRESSE. Du Socle, source de vérité des organisations, lue à la
// demande par `socle-proxy` (`/v1/organizations/root` — la racine du tenant, et
// aucune autre : la route ne prend pas d'identifiant du navigateur). Iris n'en
// garde rien : ni colonne, ni miroir. Le référentiel ne sert QUE du texte : il
// ne stocke aucune coordonnée pour une organisation.
//
// D'OÙ VIENNENT LES COORDONNÉES. De la BAN (Géoplateforme), comme pour un lieu
// d'intervention. Ce qui transite est une ADRESSE POSTALE D'ADMINISTRATION et
// rien qui l'accompagne — ni nom d'usager, ni référence de demande.
//
// ⚠️ UN CONFORT, JAMAIS UNE DÉPENDANCE. Pas d'adresse renseignée, référentiel
// muet, géocodeur en panne, adresse introuvable : la fonction rend `null` et la
// carte reprend exactement son comportement d'avant. D'où l'absence de `retry`
// et l'erreur avalée — motif `useQuartiers`.

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { geocodeUrl, parseGeocodeResponse, type GeoPoint } from "@/lib/carto";

const ONE_HOUR = 60 * 60 * 1000;

interface RootOrganizationResponse {
  organization?: { id?: string; name?: string | null; address?: string | null } | null;
}

/**
 * `null` tant qu'on ne sait pas, et `null` pour de bon si l'ancrage n'est pas
 * possible : l'appelant n'a qu'un cas à traiter — il y a un siège, ou il n'y en
 * a pas.
 */
export function useOrganisationAnchor(orgId: string): GeoPoint | null {
  const query = useQuery({
    queryKey: ["socle-organisation-anchor", orgId],
    enabled: Boolean(orgId),
    // Un siège d'administration déménage une fois par décennie.
    staleTime: ONE_HOUR,
    gcTime: ONE_HOUR,
    retry: false,
    queryFn: async (): Promise<GeoPoint | null> => {
      const data = await invokeEdge<RootOrganizationResponse>(
        "socle-proxy/v1/organizations/root",
        { organization_id: orgId },
      );
      const address = (data?.organization?.address ?? "").trim();
      if (address === "") return null;

      // `geocodeUrl` (et non `addressSearchUrl`) : l'adresse est ÉCRITE, pas en
      // cours de frappe — pas d'autocomplétion, un seul résultat demandé.
      const url = geocodeUrl(address, null);
      if (!url) return null;
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return null;
      return parseGeocodeResponse(await res.json().catch(() => null));
    },
  });
  return query.data ?? null;
}
