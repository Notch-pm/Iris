// Le logo du client dans le header — la charte graphique de la collectivité,
// lue chez le Socle par `socle-proxy` (`/v1/organizations/branding` : la
// racine du tenant, et aucune autre — la route ne prend pas d'identifiant du
// navigateur). Iris n'en garde rien : ni colonne, ni miroir, ni fichier. Le
// navigateur charge l'image à l'URL publique que le référentiel sert.
//
// ⚠️ UN CONFORT, JAMAIS UNE DÉPENDANCE. Pas de logo, référentiel muet, image
// cassée : le header écrit le nom de l'organisation, comme avant. D'où
// l'absence de `retry` et l'erreur avalée — motif `useOrganisationAnchor`.

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";

const ONE_HOUR = 60 * 60 * 1000;

interface BrandingResponse {
  branding?: { logo_url?: string | null } | null;
}

export interface BrandingResult {
  /** URL http(s) du logo couleur, ou `null` pour de bon. */
  logoUrl: string | null;
  /** La réponse n'est pas encore là : ne pas écrire le nom pour l'effacer une seconde plus tard. */
  pending: boolean;
}

/** `orgId` : le TENANT Iris (`organization_id` vérifié par `resolveTenant`), pas la racine Socle. */
export function useOrganisationBranding(orgId: string | null): BrandingResult {
  const query = useQuery({
    queryKey: ["socle-organisation-branding", orgId],
    enabled: Boolean(orgId),
    // Une charte graphique change deux fois par décennie.
    staleTime: ONE_HOUR,
    gcTime: ONE_HOUR,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const data = await invokeEdge<BrandingResponse>(
        "socle-proxy/v1/organizations/branding",
        { organization_id: orgId },
      ).catch(() => null);
      return data?.branding?.logo_url ?? null;
    },
  });
  return { logoUrl: query.data ?? null, pending: query.isLoading };
}
