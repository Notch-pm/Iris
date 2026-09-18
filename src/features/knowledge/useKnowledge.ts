// Données de la base de connaissances — assemblées dans le navigateur à partir
// de lectures que d'autres écrans font déjà (démarches publiées du cache,
// activations par organisme, organisations miroitées, volume du mois), plus UNE
// lecture du référentiel : les publics admis de chaque démarche, que le cache
// ne porte pas (`socle-proxy /v1/procedures/list`, résumé whitelisté).
//
// Le CONTENU d'une fiche, lui, est relu dans le Socle à l'ouverture
// (`useProcedureFiche`, `socle-proxy /v1/procedures/get`).

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import {
  useSocleOrganizationsCatalog,
  useSocleProcedureActivations,
  useSocleProcedureRows,
} from "@/features/socle/useSocleCatalog";
import { parseAudiences, type AudienceKey } from "@fn/_shared/procedures/audiences";
import { buildCatalogue, type KnowledgeProcedure } from "./catalogue";

/**
 * Publics admis par démarche, lus dans le Socle. Décoratif : Socle muet ⇒ carte
 * vide, jamais une erreur — la liste reste utile sans le public.
 */
export function useProcedureAudiences(orgId: string) {
  return useQuery({
    queryKey: ["procedure-audiences", orgId],
    enabled: Boolean(orgId),
    // Un paramétrage de démarche change au rythme d'un service.
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<Map<string, AudienceKey[]>> => {
      const data = await invokeEdge<{ procedures?: unknown }>("socle-proxy/v1/procedures/list", {
        organization_id: orgId,
      });
      const map = new Map<string, AudienceKey[]>();
      for (const p of Array.isArray(data.procedures) ? data.procedures : []) {
        if (typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string") {
          map.set((p as { id: string }).id, parseAudiences((p as { audiences?: unknown }).audiences));
        }
      }
      return map;
    },
  });
}

export function useKnowledgeCatalogue(orgId: string) {
  const rows = useSocleProcedureRows(orgId);
  const activations = useSocleProcedureActivations(orgId);
  const organisations = useSocleOrganizationsCatalog(orgId);
  const audiences = useProcedureAudiences(orgId);

  const data = React.useMemo<KnowledgeProcedure[] | null>(() => {
    if (!rows.data) return null;
    // Activations, organisations ou publics illisibles : la liste reste utile
    // sans eux — on ne bloque pas le catalogue pour une étiquette.
    return buildCatalogue(rows.data, activations.data ?? [], organisations.data ?? [], audiences.data);
  }, [rows.data, activations.data, organisations.data, audiences.data]);

  return {
    data,
    isLoading: rows.isLoading,
    isError: rows.isError,
    detailsLoading: activations.isLoading || organisations.isLoading || audiences.isLoading,
  };
}
