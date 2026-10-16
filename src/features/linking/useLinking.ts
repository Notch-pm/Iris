// Demandes liées — groupe d'une demande, recherche des demandes approchantes,
// liaison et retrait. Toute écriture passe par les RPC `link_requests` /
// `unlink_request` (aucune policy d'écriture cliente) ; leurs refus, déjà en
// français, sont affichés tels quels.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invokeEdge } from "@/lib/edge";
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
  /** `requests.source` — une demande issue de Clara ne reçoit aucun avis d'Iris. */
  source: string | null;
  assignedTo: string | null;
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
        .select("request_id, added_at, requests(id, reference, subject, status, socle_procedure_label, socle_organization_label, received_at, source, assigned_to)")
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
          receivedAt: r.received_at, source: r.source, assignedTo: r.assigned_to,
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

export interface LinkHint {
  /** Membres VISIBLES du groupe « même incident », la demande comprise ; 0 hors groupe. */
  groupSize: number;
  /** Demandes approchantes « même incident probable », visibles et hors groupe. */
  likelySimilar: number;
}

/**
 * Pastilles de la liste (lot L5) : un appel pour les lignes de la page. C'est
 * ainsi que les demandes arrivées sans agent (portail, partenaires, Clara) sont
 * repérées — à l'affichage, jamais par une notification.
 */
export function useLinkHints(requestIds: string[]) {
  const key = [...requestIds].sort().join(",");
  return useQuery({
    queryKey: ["request-link-hints", key],
    enabled: requestIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, LinkHint>> => {
      const { data, error } = await supabase.rpc("request_link_hints", { p_request_ids: requestIds.slice(0, 50) });
      if (error) throw error;
      return new Map((data ?? []).map((h) => [h.request_id, { groupSize: h.group_size, likelySimilar: h.likely_similar }]));
    },
  });
}

export type AssistantVerdict = "meme" | "different" | "incertain";

export interface AssistantOpinion {
  request_id: string;
  verdict: AssistantVerdict;
  reason: string;
}

/**
 * Avis de l'assistant sur les propositions (lot L4) — sur geste de l'agent
 * seulement, une `useMutation` sans `queryKey` : rien n'est mis en cache, rien
 * n'est stocké. L'assistant annote ; il ne lie jamais.
 */
export function useSimilarityAssistant() {
  return useMutation({
    mutationFn: async (input: { requestId: string; candidateIds: string[] }) =>
      await invokeEdge<{ verdicts: AssistantOpinion[]; unanswered: number }>("request-similarity-assistant", {
        request_id: input.requestId,
        candidate_ids: input.candidateIds,
      }),
  });
}

function invalidateLinking(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["request-group"] });
  void qc.invalidateQueries({ queryKey: ["similar-requests"] });
  void qc.invalidateQueries({ queryKey: ["request-link-hints"] });
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
