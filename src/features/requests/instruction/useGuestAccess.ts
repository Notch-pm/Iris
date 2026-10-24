// Suivi en ligne sans compte d'une demande (lot L4a) : état, coupure, nouveau
// code — par l'edge function `request-guest-access`, seule porte (droit
// d'instruction revérifié en SQL ; le code n'est jamais rendu au navigateur).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import type { GuestAccessAction, GuestAccessStatus } from "./guestAccess";

interface GuestAccessReply {
  access: GuestAccessStatus;
}

const key = (requestId: string) => ["request-guest-access", requestId] as const;

/**
 * L'état de l'accès. `enabled` reflète le droit d'instruction : sans lui, on
 * ne demande rien (le serveur répondrait 404) et l'encart ne s'affiche pas.
 */
export function useGuestAccess(requestId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: key(requestId ?? ""),
    enabled: Boolean(requestId) && enabled,
    queryFn: async () =>
      (await invokeEdge<GuestAccessReply>("request-guest-access", { request_id: requestId, action: "status" })).access,
    staleTime: 30_000,
  });
}

export function useGuestAccessAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; action: GuestAccessAction }) =>
      (await invokeEdge<GuestAccessReply>("request-guest-access", {
        request_id: input.requestId,
        action: input.action,
      })).access,
    onSuccess: (access, vars) => {
      queryClient.setQueryData(key(vars.requestId), access);
      // Le nouveau code apparaît dans l'onglet Échanges (code masqué) dès que le
      // facteur l'a pris ; on relit l'onglet tout de suite, puis à la prochaine visite.
      void queryClient.invalidateQueries({ queryKey: ["request_emails", vars.requestId] });
    },
  });
}
