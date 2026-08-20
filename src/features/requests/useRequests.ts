import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database.types";
import { buildRequestFacets, type RequestFacets } from "./facets";
import type { ClosureMotif, TransitionSpec } from "./statuts";
import { buildTransitionUpdate } from "./statuts";

export type RequestRow = Tables<"requests">;
export type RequestEvent = Tables<"request_events">;
export type RequestAttachment = Tables<"request_attachments">;
export type RequestAssignment = Tables<"request_assignments">;
export type RequestMessage = Tables<"request_messages">;
export type RequestLink = Tables<"request_links">;

export const PAGE_SIZE = 20;

export interface RequestFilters {
  status: string;
  destinataire: string;
  procedure: string;
  priority: string;
  source: string;
}

export const EMPTY_FILTERS: RequestFilters = {
  status: "",
  destinataire: "",
  procedure: "",
  priority: "",
  source: "",
};

const LIST_SELECT =
  "id, reference, subject, status, priority, source, identity_status, socle_organization_id, socle_organization_label, socle_procedure_id, socle_procedure_label, assigned_to, received_at, created_at, updated_at";

export interface RequestListItem {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  identity_status: string;
  socle_organization_id: string | null;
  socle_organization_label: string | null;
  socle_procedure_id: string | null;
  socle_procedure_label: string | null;
  assigned_to: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export function useRequestsList(orgId: string, filters: RequestFilters, page: number) {
  return useQuery({
    queryKey: ["requests", orgId, filters, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = supabase
        .from("requests")
        .select(LIST_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.destinataire) query = query.eq("socle_organization_id", filters.destinataire);
      if (filters.procedure) query = query.eq("socle_procedure_id", filters.procedure);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.source) query = query.eq("source", filters.source);
      const { data, error, count } = await query;
      if (error) throw error;
      return { items: (data ?? []) as RequestListItem[], total: count ?? 0 };
    },
  });
}

export function useRequestFacets(orgId: string) {
  return useQuery({
    queryKey: ["request-facets", orgId],
    queryFn: async (): Promise<RequestFacets> => {
      const { data, error } = await supabase
        .from("requests")
        .select(
          "socle_organization_id, socle_organization_label, socle_procedure_id, socle_procedure_label, source",
        )
        .eq("organization_id", orgId)
        .limit(1000);
      if (error) throw error;
      return buildRequestFacets(data ?? []);
    },
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ["request", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<RequestRow | null> => {
      const { data, error } = await supabase.from("requests").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useSatellite<T>(table: string, id: string | undefined, orderColumn = "created_at") {
  return useQuery({
    queryKey: [table, id],
    enabled: Boolean(id),
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await supabase
        .from(table as "request_events")
        .select("*")
        .eq("request_id", id!)
        .order(orderColumn, { ascending: true });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export const useRequestEvents = (id: string | undefined) => useSatellite<RequestEvent>("request_events", id);
export const useRequestAttachments = (id: string | undefined) =>
  useSatellite<RequestAttachment>("request_attachments", id);
export const useRequestAssignments = (id: string | undefined) =>
  useSatellite<RequestAssignment>("request_assignments", id);
export const useRequestMessages = (id: string | undefined) =>
  useSatellite<RequestMessage>("request_messages", id);
export const useRequestLinks = (id: string | undefined) => useSatellite<RequestLink>("request_links", id);

export interface TenantMember {
  userId: string;
  role: string;
  displayName: string;
  email: string;
}

export function useTenantMembers(orgId: string) {
  return useQuery({
    queryKey: ["tenant-members", orgId],
    queryFn: async (): Promise<TenantMember[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("role, user:users(id, email, first_name, last_name)")
        .eq("organization_id", orgId);
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.user)
        .map((row) => {
          const u = row.user!;
          const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
          return {
            userId: u.id,
            role: row.role,
            displayName: name === "" ? u.email : name,
            email: u.email,
          };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
    },
  });
}

function useInvalidateRequest() {
  const queryClient = useQueryClient();
  return (requestId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ["requests"] });
    void queryClient.invalidateQueries({ queryKey: ["request-facets"] });
    if (requestId) {
      void queryClient.invalidateQueries({ queryKey: ["request", requestId] });
      for (const table of [
        "request_events",
        "request_assignments",
        "request_messages",
        "request_attachments",
        "request_links",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [table, requestId] });
      }
    }
  };
}

// La création passe désormais EXCLUSIVEMENT par le parcours guidé
// (creation/useCreateFromProcedure → edge function create-request-from-procedure) :
// plus aucun INSERT direct de demande depuis le navigateur.

export function useApplyTransition() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      spec: TransitionSpec;
      closureText?: string;
      motif?: ClosureMotif;
      assigneeId?: string | null;
    }) => {
      const built = buildTransitionUpdate(input.spec, input);
      if (!built.ok) throw new Error(built.message);
      const { error } = await supabase
        .from("requests")
        .update(built.update as never)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export function useAssignRequest() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: { requestId: string; assigneeId: string | null }) => {
      const { error } = await supabase
        .from("requests")
        .update({ assigned_to: input.assigneeId } as never)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export function useAddMessage() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      organizationId: string;
      authorId: string;
      body: string;
    }) => {
      const { error } = await supabase.from("request_messages").insert({
        request_id: input.requestId,
        organization_id: input.organizationId,
        author_id: input.authorId,
        body: input.body,
      } as never);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export function useDeleteMessage() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: { messageId: string; requestId: string }) => {
      const { error } = await supabase.from("request_messages").delete().eq("id", input.messageId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

/** URL signée temporaire d'une pièce copiée (bucket privé). */
export async function createAttachmentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("request-attachments")
    .createSignedUrl(storagePath, 300);
  if (error) return null;
  return data.signedUrl;
}
