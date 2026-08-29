// Base de connaissances d'une démarche, lue dans le SOCLE à chaque visite
// (socle-proxy `/v1/procedures/get`). Aucune rétention côté Iris : une
// consigne corrigée ce matin dans le référentiel est celle que l'agent lit cet
// après-midi. C'est aussi la raison pour laquelle elle n'entre pas dans le
// `procedure_snapshot`, qui fige au contraire le formulaire du dépôt.
//
// Le parcours de CRÉATION, lui, n'appelle pas ce hook : il tient déjà la
// démarche chargée en mémoire (`fetchProcedureSnapshot`), dont la réponse
// porte désormais le même bloc — inutile de redemander.

import { useMutation, useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import {
  emptyKnowledge,
  parseAgentKnowledge,
  type AgentKnowledge,
} from "@fn/socle-proxy/_shared/knowledge";

export function useProcedureKnowledge(organizationId: string, socleProcedureId: string | null) {
  return useQuery({
    queryKey: ["procedure-knowledge", organizationId, socleProcedureId],
    enabled: Boolean(organizationId && socleProcedureId),
    // Une base de connaissances change au rythme d'un service, pas d'un clic :
    // cinq minutes de fraîcheur évitent un appel au Socle à chaque va-et-vient
    // entre les onglets de la fiche.
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<AgentKnowledge> => {
      const data = await invokeEdge<{ procedure: { knowledge_base?: unknown } | null }>(
        "socle-proxy/v1/procedures/get",
        { organization_id: organizationId, socle_procedure_id: socleProcedureId },
      );
      if (!data.procedure) return emptyKnowledge();
      return parseAgentKnowledge(data.procedure.knowledge_base);
    },
  });
}

/**
 * URL signée d'un document d'aide agent. Le chemin est confronté côté serveur
 * à la démarche rechargée : le navigateur ne peut pas désigner un document que
 * la base de connaissances ne cite pas (documents d'entraînement IA compris).
 */
export function useProcedureDocumentUrl() {
  return useMutation({
    mutationFn: async (vars: {
      organizationId: string;
      socleProcedureId: string;
      path: string;
    }): Promise<string> => {
      const data = await invokeEdge<{ url: string }>(
        "socle-proxy/v1/procedures/document-url",
        {
          organization_id: vars.organizationId,
          socle_procedure_id: vars.socleProcedureId,
          path: vars.path,
        },
      );
      return data.url;
    },
  });
}
