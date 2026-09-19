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
import type { SourceRef } from "@fn/_shared/ai/sources/catalogue";

/** Une source autorisée que le serveur n'a pas pu lire, et pourquoi. */
export interface UnreadSourceInfo {
  id: string;
  /** Vide quand le référentiel n'a pas permis de l'identifier. */
  label: string;
  reason: string;
}

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
  /**
   * Les sources que l'agent a autorisées, lues ou non (2026-09-19).
   * Facultatif : une fonction déployée avant ne l'envoie pas.
   */
  sources?: { consulted: SourceRef[]; skipped: UnreadSourceInfo[] };
}

export interface AssistantReply {
  answer: string;
  /**
   * L'assistant propose de consulter des sources déclarées pour l'IA — seules
   * celles que le serveur lui avait offertes. Absent d'une fonction ancienne.
   */
  proposal?: { sources: SourceRef[] } | null;
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

/**
 * Le corps envoyé. `sources` n'y figure que si l'agent en a autorisé : une
 * fonction déployée avant le 2026-09-19 refuserait la clé (liste blanche).
 * On n'envoie que des IDENTIFIANTS — le serveur relit le catalogue et refuse
 * ce qui n'y est pas.
 */
export function payloadFor(
  target: AssistantTarget,
  messages: ChatMessage[],
  sources: SourceRef[] = [],
): Record<string, unknown> {
  const base: Record<string, unknown> = target.kind === "request"
    ? { request_id: target.requestId, messages }
    : {
      organization_id: target.organizationId,
      socle_procedure_id: target.socleProcedureId,
      messages,
    };
  if (sources.length > 0) base.sources = sources.map((s) => s.id);
  return base;
}

export function useAssistant() {
  return useMutation({
    mutationFn: async (vars: { target: AssistantTarget; messages: ChatMessage[]; sources?: SourceRef[] }) =>
      // `invokeEdge` relaie déjà le message français de l'enveloppe
      // { error: { code, message } } — y compris le 429 du plafond, qui nomme
      // la date de renouvellement. On ne le réécrit pas.
      await invokeEdge<AssistantReply>(
        "request-assistant",
        payloadFor(vars.target, vars.messages, vars.sources),
      ),
  });
}
