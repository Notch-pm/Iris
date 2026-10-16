// Demandes liées — groupe d'une demande, recherche des demandes approchantes,
// liaison et retrait. Toute écriture passe par les RPC `link_requests` /
// `unlink_request` (aucune policy d'écriture cliente) ; leurs refus, déjà en
// français, sont affichés tels quels.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useLinkSettings } from "./useLinkSettings";
import type { DraftSimilarityInput, SimilarCandidate } from "./similaires";

/** La démarche est-elle mutualisable dans ce tenant ? `null` tant qu'on ne sait pas. */
export function useProcedureLinkable(orgId: string, procedureId: string | null | undefined): boolean | null {
  const settings = useLinkSettings(orgId);
  if (!procedureId) return false;
  if (!settings.data) return settings.isError ? false : null;
  return settings.data.some((s) => s.socle_procedure_id === procedureId && s.enabled);
}

export interface GroupMember {
  id: string;
  reference: string;
  subject: string;
  status: string;
  procedureLabel: string | null;
  organisme: string | null;
  receivedAt: string;
}

export interface RequestGroup {
  groupId: string;
  /** Les membres que le RLS laisse lire — la demande courante comprise. */
  members: GroupMember[];
}

export function useRequestGroup(requestId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["request-group", requestId],
    enabled: Boolean(requestId) && enabled,
    queryFn: async (): Promise<RequestGroup | null> => {
      const { data: own, error } = await supabase
        .from("request_group_members")
        .select("group_id")
        .eq("request_id", requestId!)
        .maybeSingle();
      if (error) throw error;
      if (!own) return null;
      const { data, error: membersError } = await supabase
        .from("request_group_members")
        .select("request_id, added_at, requests(id, reference, subject, status, socle_procedure_label, socle_organization_label, received_at)")
        .eq("group_id", own.group_id)
        .order("added_at");
      if (membersError) throw membersError;
      const members: GroupMember[] = [];
      for (const row of data ?? []) {
        const r = row.requests;
        if (!r) continue;  // membre dont la demande n'est pas lisible : on n'en dit rien
        members.push({
          id: r.id, reference: r.reference, subject: r.subject, status: r.status,
          procedureLabel: r.socle_procedure_label, organisme: r.socle_organization_label,
          receivedAt: r.received_at,
        });
      }
      return { groupId: own.group_id, members };
    },
  });
}

/** Recherche depuis une demande existante — lancée par l'agent (`enabled`). */
export function useSimilarRequests(requestId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["similar-requests", requestId],
    enabled: Boolean(requestId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SimilarCandidate[]> => {
      const { data, error } = await supabase.rpc("find_similar_requests_for", { p_request_id: requestId! });
      if (error) throw error;
      return (data ?? []) as SimilarCandidate[];
    },
  });
}

/** Recherche depuis une saisie de guichet (rien n'existe encore en base). */
export function useDraftSimilarRequests(
  orgId: string,
  procedureId: string | null,
  input: DraftSimilarityInput,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["similar-requests-draft", orgId, procedureId, input.lat, input.lon, input.address, input.text],
    enabled: Boolean(orgId && procedureId) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SimilarCandidate[]> => {
      const { data, error } = await supabase.rpc("find_similar_requests", {
        p_org_id: orgId,
        p_procedure_id: procedureId!,
        p_lat: input.lat ?? undefined,
        p_lon: input.lon ?? undefined,
        p_address: input.address ?? undefined,
        p_text: input.text ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as SimilarCandidate[];
    },
  });
}

function invalidateLinking(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["request-group"] });
  void qc.invalidateQueries({ queryKey: ["similar-requests"] });
  void qc.invalidateQueries({ queryKey: ["request_events"] });  // journal (useSatellite)
}

export function useLinkToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, targetId }: { requestId: string; targetId: string }) => {
      const { error } = await supabase.rpc("link_requests", { p_a: requestId, p_b: targetId });
      if (error) throw error;
    },
    onSuccess: () => invalidateLinking(qc),
  });
}

export function useUnlinkFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("unlink_request", { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => invalidateLinking(qc),
  });
}
