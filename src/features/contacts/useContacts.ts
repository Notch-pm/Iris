// Accès aux usagers Socle — EXCLUSIVEMENT via socle-proxy (la clé Socle vit
// côté serveur, les réponses sont sanitisées : jamais d'internal_notes).
// Mutations uniquement : Iris ne met en cache ni ne stocke aucun contact.

import { useMutation } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import type { MatchCandidate, MatchIdentity, SocleContact } from "./rapprochement";

/** Rapprochement/homonymes : candidats avec score et raisons (fournis par Socle). */
export function useMatchContacts() {
  return useMutation({
    mutationFn: async (vars: { organizationId: string; identity: MatchIdentity }) => {
      const data = await invokeEdge<{ matches: MatchCandidate[] }>(
        "socle-proxy/v1/contacts/match",
        { organization_id: vars.organizationId, identity: vars.identity },
      );
      return Array.isArray(data.matches) ? data.matches : [];
    },
  });
}

/** Création d'un usager — via contacts-api Socle uniquement (whitelist proxy). */
export function useCreateContact() {
  return useMutation({
    mutationFn: async (vars: { organizationId: string; contact: Record<string, string> }) => {
      const data = await invokeEdge<{ contact: SocleContact }>(
        "socle-proxy/v1/contacts/create",
        { organization_id: vars.organizationId, contact: vars.contact },
      );
      return data.contact;
    },
  });
}
