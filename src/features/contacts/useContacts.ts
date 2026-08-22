// Accès aux usagers Socle — EXCLUSIVEMENT via socle-proxy (la clé Socle vit
// côté serveur, les réponses sont sanitisées : jamais d'internal_notes).
// Iris ne stocke ni ne met en cache aucun contact : mutations pour le parcours
// de création, et une requête SANS rétention pour la fiche usager.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Relecture d'une fiche usager par identifiant (reprise d'un brouillon : le
 * brouillon ne conserve que l'id, la fiche est toujours relue depuis le Socle).
 */
export function useGetContact() {
  return useMutation({
    mutationFn: async (vars: { organizationId: string; socleContactId: string }) => {
      const data = await invokeEdge<{ contact: SocleContact }>(
        "socle-proxy/v1/contacts/get",
        { organization_id: vars.organizationId, socle_contact_id: vars.socleContactId },
      );
      return data.contact;
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

/**
 * Fiche usager d'une page (relue à CHAQUE visite depuis le Socle) : requête
 * TanStack sans rétention (`gcTime: 0`, `staleTime: 0`) — Iris ne met aucun
 * usager en cache, l'affichage est un miroir instantané du référentiel.
 */
export function useSocleContact(organizationId: string, socleContactId: string | null) {
  return useQuery({
    queryKey: ["socle-contact", organizationId, socleContactId],
    enabled: Boolean(organizationId && socleContactId),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<SocleContact> => {
      const data = await invokeEdge<{ contact: SocleContact }>(
        "socle-proxy/v1/contacts/get",
        { organization_id: organizationId, socle_contact_id: socleContactId },
      );
      return data.contact;
    },
  });
}

/**
 * Modification d'une fiche usager — écrit dans le SOCLE (PATCH partiel via
 * socle-proxy). La fiche affichée est ensuite RELUE depuis le Socle plutôt que
 * remplacée par la réponse : Iris ne garde aucune vérité locale sur l'usager.
 */
export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      organizationId: string;
      socleContactId: string;
      patch: Record<string, string | null>;
    }) => {
      const data = await invokeEdge<{ contact: SocleContact }>(
        "socle-proxy/v1/contacts/update",
        {
          organization_id: vars.organizationId,
          socle_contact_id: vars.socleContactId,
          contact: vars.patch,
        },
      );
      return data.contact;
    },
    onSuccess: (_contact, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["socle-contact", vars.organizationId, vars.socleContactId],
      });
    },
  });
}
