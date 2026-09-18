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
import {
  emptyDocuments,
  parseProcedureDocuments,
  type ProcedureDocuments,
} from "@fn/_shared/document/templates";
import { parseProcedureFiche, type ProcedureFiche } from "./ficheDemarche";

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
 * « Fiche démarche » — la démarche entière telle qu'un agent la consulte avant
 * de la choisir : communication usager, base de connaissances agent, publics
 * admis, pièces du formulaire. Même route que ci-dessus, relue à l'ouverture
 * (cinq minutes de fraîcheur), rien n'est conservé dans Iris.
 */
export function useProcedureFiche(organizationId: string, socleProcedureId: string | null) {
  return useQuery({
    queryKey: ["procedure-fiche", organizationId, socleProcedureId],
    enabled: Boolean(organizationId && socleProcedureId),
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<ProcedureFiche | null> => {
      const data = await invokeEdge<{ procedure: unknown }>(
        "socle-proxy/v1/procedures/get",
        { organization_id: organizationId, socle_procedure_id: socleProcedureId },
      );
      return data.procedure ? parseProcedureFiche(data.procedure) : null;
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

/**
 * Modèles de document et de courrier de la démarche (contrat public-api 1.6.0).
 * Même route que la base de connaissances — le Socle sert tout dans la fiche —
 * mais une requête à part : l'écran des documents ne charge rien tant que
 * personne n'ouvre la génération.
 *
 * Le fichier, lui, ne passe JAMAIS par ici : l'edge function de génération le
 * télécharge côté serveur, après avoir confronté l'identifiant à cette même
 * fiche. Le navigateur ne voit que ce qu'il faut pour PROPOSER.
 */
export function useProcedureDocuments(
  organizationId: string,
  socleProcedureId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["procedure-documents", organizationId, socleProcedureId],
    enabled: Boolean(organizationId && socleProcedureId) && enabled,
    // Un paramétrage de documents change au rythme d'un service : cinq minutes
    // de fraîcheur, comme la base de connaissances.
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<ProcedureDocuments> => {
      const data = await invokeEdge<{ procedure: { documents?: unknown } | null }>(
        "socle-proxy/v1/procedures/get",
        { organization_id: organizationId, socle_procedure_id: socleProcedureId },
      );
      if (!data.procedure) return emptyDocuments();
      return parseProcedureDocuments(data.procedure.documents);
    },
  });
}
