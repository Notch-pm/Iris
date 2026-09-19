// Appel de l'assistant — une COMMANDE, pas une ressource.
//
// ⚠️ Volontairement une `useMutation` SANS `queryKey`. Ranger le fil dans le
// cache TanStack Query « pour qu'il survive » serait une porte dérobée de
// persistance, contraire à la décision PO (conversation éphémère), et `gcTime`
// rendrait sa durée de vie accidentelle. Le fil vit dans l'état de la page,
// explicitement (voir `AssistantThreadProvider`).

import { useMutation } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import type { ChatMessage } from "@fn/_shared/ai/messages";

/** Ce que le serveur dit de ce qu'il a réellement lu — affiché à l'agent. */
export interface AssistantContextInfo {
  knowledge: boolean;
  knowledgeUnavailable: boolean;
  truncated: boolean;
  /**
   * Ce que la collectivité publie pour ses usagers (délai, pièces annoncées,
   * FAQ usager…) a été lu. Facultatif : une fonction déployée avant le
   * 2026-09-18 ne l'envoie pas.
   */
  userCommunication?: boolean;
  /**
   * Les recommandations générales de la collectivité à ses agents (Socle
   * 1.27.0) ont été lues. Facultatif : une fonction déployée avant le
   * 2026-09-19 ne l'envoie pas.
   */
  agentGuidance?: boolean;
  documents: { used: string[]; skipped: { name: string; reason: string }[] };
  answers: number;
  removedIdentityKeys: string[];
}

export interface AssistantReply {
  answer: string;
  context: AssistantContextInfo;
}

/**
 * La cible de la question. En mode demande, le serveur en déduit tout le
 * contexte ; en mode démarche (guichet), il n'a que la démarche — et c'est
 * voulu : aucune saisie en cours ne part chez le fournisseur.
 */
export type AssistantTarget =
  | { kind: "request"; requestId: string }
  | { kind: "procedure"; organizationId: string; socleProcedureId: string };

/** Clé d'identité de la cible — le fil se réinitialise quand elle change. */
export function targetKey(target: AssistantTarget | null): string {
  if (!target) return "none";
  return target.kind === "request"
    ? `request:${target.requestId}`
    : `procedure:${target.organizationId}:${target.socleProcedureId}`;
}

function payloadFor(target: AssistantTarget, messages: ChatMessage[]): Record<string, unknown> {
  return target.kind === "request"
    ? { request_id: target.requestId, messages }
    : {
      organization_id: target.organizationId,
      socle_procedure_id: target.socleProcedureId,
      messages,
    };
}

export function useAssistant() {
  return useMutation({
    mutationFn: async (vars: { target: AssistantTarget; messages: ChatMessage[] }) =>
      // `invokeEdge` relaie déjà le message français de l'enveloppe
      // { error: { code, message } } — y compris le 429 du plafond, qui nomme
      // la date de renouvellement. On ne le réécrit pas.
      await invokeEdge<AssistantReply>("request-assistant", payloadFor(vars.target, vars.messages)),
  });
}
