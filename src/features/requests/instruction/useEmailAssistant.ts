// Rédaction assistée des échanges — edge function `request-email-assistant`.
//
// Deux mutations SANS `queryKey` : rien n'est conservé. Le texte revient au
// composeur, l'agent le relit, et c'est `send-request-email` qui envoie.
// Le navigateur n'envoie que l'identifiant de la demande, le type de réponse,
// ses consignes ou son texte : le contexte (dossier, démarche, interventions,
// échanges passés) est composé par le serveur, les notes internes n'en font
// jamais partie. Les refus arrivent en français, 429 compris (`invokeEdge`).

import { useMutation } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";

export type DraftKind = "accuse_reception" | "suivi";

export const DRAFT_KIND_OPTIONS: { value: DraftKind; label: string }[] = [
  { value: "accuse_reception", label: "Accusé de réception" },
  { value: "suivi", label: "Suivi" },
];

export interface DraftReply {
  body: string;
  subject: string;
}

export function useDraftEmail(requestId: string) {
  return useMutation({
    mutationFn: (input: { kind: DraftKind; instructions: string }) =>
      invokeEdge<DraftReply>("request-email-assistant", {
        request_id: requestId,
        mode: "draft",
        kind: input.kind,
        instructions: input.instructions.trim() === "" ? null : input.instructions.trim(),
      }),
  });
}

export function useImproveEmail(requestId: string) {
  return useMutation({
    mutationFn: (text: string) =>
      invokeEdge<{ body: string }>("request-email-assistant", {
        request_id: requestId,
        mode: "improve",
        text,
      }),
  });
}
