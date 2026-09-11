import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Tables } from "@/types/database.types";
import { buildRequestFacets, type RequestFacets } from "./facets";
import type { ClosureMotif, TransitionSpec } from "./statuts";
import { buildTransitionUpdate } from "./statuts";
import {
  EXPORT_MAX_ROWS, orderClauses, searchClause, type GroupKey, type SortState,
} from "./listing";

export type RequestRow = Tables<"requests">;
export type RequestEvent = Tables<"request_events">;
export type RequestAttachment = Tables<"request_attachments">;
export type RequestAssignment = Tables<"request_assignments">;
export type RequestMessage = Tables<"request_messages">;
export type RequestEmail = Tables<"request_emails">;
export type RequestLink = Tables<"request_links">;

export const PAGE_SIZE = 20;

/**
 * Filtres de la liste (2026-09-11, maquette « Liste — en-tête compacté ») :
 * chaque critère est une SÉLECTION MULTIPLE (vide = tout), posée depuis le
 * popover « Filtres » et rappelée en chips ; `q` est la recherche par objet
 * et référence, appliquée côté serveur.
 */
export interface RequestFilters {
  q: string;
  status: string[];
  destinataire: string[];
  procedure: string[];
  priority: string[];
  source: string[];
}

export const EMPTY_FILTERS: RequestFilters = {
  q: "",
  status: [],
  destinataire: [],
  procedure: [],
  priority: [],
  source: [],
};

const LIST_SELECT =
  "id, reference, subject, status, priority, source, identity_status, socle_organization_id, socle_organization_label, socle_procedure_id, socle_procedure_label, assigned_to, received_at, due_at, created_at, updated_at";

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
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Requête de liste commune (filtres + tri serveur + pré-tri par clé de groupe). */
function listQuery(orgId: string, filters: RequestFilters, sort: SortState, groupKey: GroupKey | null) {
  let query = supabase
    .from("requests")
    .select(LIST_SELECT, { count: "exact" })
    .eq("organization_id", orgId);
  if (filters.status.length > 0) query = query.in("status", filters.status);
  if (filters.destinataire.length > 0) query = query.in("socle_organization_id", filters.destinataire);
  if (filters.procedure.length > 0) query = query.in("socle_procedure_id", filters.procedure);
  if (filters.priority.length > 0) query = query.in("priority", filters.priority);
  if (filters.source.length > 0) query = query.in("source", filters.source);
  const search = searchClause(filters.q);
  if (search) query = query.or(search);
  for (const clause of orderClauses(sort, groupKey)) {
    query = query.order(clause.column, { ascending: clause.ascending, nullsFirst: false });
  }
  return query;
}

export function useRequestsList(
  orgId: string,
  filters: RequestFilters,
  page: number,
  sort: SortState,
  groupKey: GroupKey | null,
) {
  return useQuery({
    queryKey: ["requests", orgId, filters, page, sort, groupKey],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await listQuery(orgId, filters, sort, groupKey)
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (error) throw error;
      return { items: (data ?? []) as RequestListItem[], total: count ?? 0 };
    },
  });
}

const EXPORT_PAGE_SIZE = 1000;

/**
 * Toutes les demandes de la sélection filtrée, dans l'ordre affiché, pour
 * l'export CSV (motif Clara `fetchAllCouriersForExport`) — par lots, bornées à
 * EXPORT_MAX_ROWS (`truncated` le signale). Le RLS borne la visibilité.
 */
export async function fetchRequestsForExport(
  orgId: string,
  filters: RequestFilters,
  sort: SortState,
  groupKey: GroupKey | null,
): Promise<{ rows: RequestListItem[]; truncated: boolean }> {
  const all: RequestListItem[] = [];
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const { data, error } = await listQuery(orgId, filters, sort, groupKey)
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as RequestListItem[];
    all.push(...batch);
    if (batch.length < EXPORT_PAGE_SIZE) return { rows: all, truncated: false };
  }
  return { rows: all, truncated: true };
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
/** Échanges SORTANTS vers l'usager (onglet Échanges). En lecture seule ici :
 *  l'écriture n'a qu'une porte, l'edge function `send-request-email`. */
export const useRequestEmails = (id: string | undefined) =>
  useSatellite<RequestEmail>("request_emails", id);

export interface TenantMember {
  userId: string;
  role: string;
  displayName: string;
  email: string;
}

/**
 * Membres du tenant (noms d'affichage). `enabled` permet à un appelant MONTÉ EN
 * PERMANENCE — la recherche du header — de ne charger les noms qu'une fois une
 * recherche lancée, plutôt qu'à chaque page.
 */
export function useTenantMembers(orgId: string, enabled = true) {
  return useQuery({
    queryKey: ["tenant-members", orgId],
    enabled: Boolean(orgId) && enabled,
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

export interface EligibleAssigneeRow {
  user_id: string;
  display_name: string;
  email: string;
}

/** Membres éligibles à l'affectation sur cette demande (RM-16 : instruction sur le couple). */
export function useEligibleAssignees(requestId: string | undefined) {
  return useQuery({
    queryKey: ["eligible-assignees", requestId],
    enabled: Boolean(requestId),
    queryFn: async (): Promise<EligibleAssigneeRow[]> => {
      const { data, error } = await supabase.rpc("eligible_assignees", { p_request_id: requestId! });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** `eligible_assignees` + la photo : le menu de mentions montre un visage. */
export interface MentionableUserRow extends EligibleAssigneeRow {
  avatar_path: string | null;
}

/**
 * Membres pouvant CONSULTER la demande — les seuls mentionnables dans une note
 * interne. Sœur d'`eligible_assignees`, autre droit : on ne propose pas de
 * citer quelqu'un qui ne pourrait pas ouvrir la fiche.
 *
 * ⚠️ La liste INCLUT l'utilisateur courant : elle sert aussi à résoudre les
 * noms et photos des mentions DÉJÀ écrites, les siennes comprises. C'est le
 * menu (`MentionTextarea`) qui ne se propose pas soi-même.
 */
export function useMentionableUsers(requestId: string | undefined) {
  return useQuery({
    queryKey: ["mentionable-users", requestId],
    enabled: Boolean(requestId),
    queryFn: async (): Promise<MentionableUserRow[]> => {
      const { data, error } = await supabase.rpc("mentionable_users", { p_request_id: requestId! });
      if (error) throw error;
      return (data ?? []) as MentionableUserRow[];
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
        "request_emails",
        "request_links",
        "request_interventions",
        "eligible-assignees",
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

/** Priorité (« urgence » de la fiche) — writer du tenant ; gelée sur une demande archivée (garde t10). */
export function useUpdatePriority() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: { requestId: string; priority: string }) => {
      const { error } = await supabase
        .from("requests")
        .update({ priority: input.priority } as never)
        .eq("id", input.requestId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => invalidate(vars.requestId),
  });
}

export interface RequestSummary {
  id: string;
  reference: string;
  subject: string;
  status: string;
  created_at: string;
  socle_procedure_label: string | null;
}

const SUMMARY_SELECT = "id, reference, subject, status, created_at, socle_procedure_label";

/** Résumés des demandes liées (cibles des `request_links`), dans le périmètre RLS du lecteur. */
export function useRequestSummaries(ids: string[]) {
  const key = [...ids].sort();
  return useQuery({
    queryKey: ["request-summaries", key],
    enabled: key.length > 0,
    queryFn: async (): Promise<RequestSummary[]> => {
      const { data, error } = await supabase.from("requests").select(SUMMARY_SELECT).in("id", key);
      if (error) throw error;
      return (data ?? []) as RequestSummary[];
    },
  });
}

/** Autres demandes du même usager Socle rapproché (même tenant), la courante exclue. */
export function useRequesterRequests(orgId: string, socleContactId: string | null, excludeId: string) {
  return useQuery({
    queryKey: ["requester-requests", orgId, socleContactId],
    enabled: Boolean(orgId && socleContactId),
    queryFn: async (): Promise<RequestSummary[]> => {
      const { data, error } = await supabase
        .from("requests")
        .select(SUMMARY_SELECT)
        .eq("organization_id", orgId)
        .eq("socle_contact_id", socleContactId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RequestSummary[];
    },
    select: (rows) => rows.filter((r) => r.id !== excludeId),
  });
}

/**
 * Toutes les demandes d'un usager Socle dans le tenant (fiche usager) — le RLS
 * borne la visibilité au périmètre du lecteur : la fiche peut donc n'en
 * montrer qu'une partie, et c'est la règle.
 */
export function useContactRequests(orgId: string, socleContactId: string | null) {
  return useQuery({
    queryKey: ["contact-requests", orgId, socleContactId],
    enabled: Boolean(orgId && socleContactId),
    queryFn: async (): Promise<RequestListItem[]> => {
      const { data, error } = await supabase
        .from("requests")
        .select(LIST_SELECT)
        .eq("organization_id", orgId)
        .eq("socle_contact_id", socleContactId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as RequestListItem[];
    },
  });
}

/**
 * Les pièces d'un usager (fiche usager) : par la colonne dénormalisée
 * `socle_contact_id` (écrite par trigger, 2026-09-08). Le RLS borne au
 * périmètre du lecteur — comme pour ses demandes. Ni les internes, ni les
 * copies jointes à un échange (l'original est listé).
 */
export function useContactAttachments(orgId: string, socleContactId: string | null) {
  return useQuery({
    queryKey: ["contact-attachments", orgId, socleContactId],
    enabled: Boolean(orgId && socleContactId),
    queryFn: async (): Promise<RequestAttachment[]> => {
      const { data, error } = await supabase
        .from("request_attachments")
        .select("*")
        .eq("organization_id", orgId)
        .eq("socle_contact_id", socleContactId!)
        .neq("kind", "instruction_interne")
        .is("source_attachment_id", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RequestAttachment[];
    },
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

/** Ce que le serveur a VRAIMENT fait — relu après coup, jamais supposé. */
export interface TransferResult {
  changed: boolean;
  /** Libellé de l'organisme d'arrivée, tel que le miroir le nomme. */
  organisme?: string;
  /** L'affectation a été retirée : l'agent ne pouvait pas instruire là-bas. */
  unassigned?: boolean;
}

/**
 * Transfert vers un autre ORGANISME RESPONSABLE (RM-19), par la RPC
 * `transfer_request` — **unique porte**.
 *
 * ⚠️ Un `update` client de `socle_organization_id` NE MARCHE PAS dès que la
 * cible sort du périmètre de l'auteur : le RLS refuse la ligne mise à jour
 * (`42501`), alors que c'est justement le geste — se dessaisir vers un service
 * où l'on n'a rien à faire. Constaté en base le 2026-09-01 ; invisible pour un
 * administrateur de plateforme, qui passe partout. Détail et sondes :
 * migration `20260901110000`.
 *
 * On n'envoie que l'identifiant de la cible : le libellé vient du miroir et le
 * sort de l'affectation est une décision serveur. On les RELIT dans la réponse
 * pour annoncer ce qui s'est passé, pas ce qu'on espérait.
 */
export function useTransferRequest() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: { requestId: string; socleOrganizationId: string }) => {
      const { data, error } = await supabase.rpc("transfer_request", {
        p_request_id: input.requestId,
        p_socle_org_id: input.socleOrganizationId,
      });
      if (error) throw error;
      return (data ?? { changed: false }) as unknown as TransferResult;
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

/**
 * Liaison libre (`liee_a`) entre une demande et des demandes proches, posée
 * dans les deux sens en UNE insertion (visible depuis chaque fiche). Le RLS
 * (writer du tenant) et le trigger de périmètre revalident tout.
 */
export function useLinkRequests() {
  const invalidate = useInvalidateRequest();
  return useMutation({
    mutationFn: async (input: {
      organizationId: string;
      requestId: string;
      targetIds: string[];
      userId: string;
    }) => {
      if (input.targetIds.length === 0) return;
      const rows = input.targetIds.flatMap((targetId) => [
        {
          organization_id: input.organizationId,
          request_id: input.requestId,
          link_type: "liee_a",
          target_request_id: targetId,
          created_by: input.userId,
        },
        {
          organization_id: input.organizationId,
          request_id: targetId,
          link_type: "liee_a",
          target_request_id: input.requestId,
          created_by: input.userId,
        },
      ]);
      const { error } = await supabase.from("request_links").insert(rows as never);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      invalidate(vars.requestId);
      for (const id of vars.targetIds) invalidate(id);
    },
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

/**
 * URL signée temporaire d'une pièce copiée (bucket privé). `download` force
 * l'enregistrement sous le nom d'origine au lieu de l'affichage en ligne.
 */
export async function createAttachmentUrl(
  storagePath: string,
  download?: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("request-attachments")
    .createSignedUrl(storagePath, 300, download ? { download } : undefined);
  if (error) return null;
  return data.signedUrl;
}
