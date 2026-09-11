// Tableau de bord — données serveur (TanStack Query).
//
// Trois lectures, toutes bornées par le RLS (consultation par couple) :
//   - les flux mensuels, par la RPC `stats_monthly_flows` (faits insensibles
//     à la purge) ;
//   - les demandes EN ATTENTE D'INSTRUCTION (`a_traiter`), les plus récentes ;
//   - les demandes AFFECTÉES à l'utilisateur, encore ouvertes.
// Les deux listes reprennent la projection de la liste des demandes
// (`RequestListItem`) : mêmes colonnes, même fiche à l'arrivée.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OPEN_STATUSES } from "@/features/requests/statuts";
import type { RequestListItem } from "@/features/requests/useRequests";
import { callStats } from "@/features/stats/useStats";
import type { MonthlyFlow } from "./dashboard";

export const DASHBOARD_LIST_LIMIT = 20;

const LIST_SELECT =
  "id, reference, subject, status, priority, source, identity_status, socle_organization_id, socle_organization_label, socle_procedure_id, socle_procedure_label, assigned_to, received_at, due_at, created_at, updated_at";

export interface DashboardList {
  items: RequestListItem[];
  /** Total au-delà des `DASHBOARD_LIST_LIMIT` lignes affichées. */
  total: number;
}

export function useMonthlyFlows(orgId: string) {
  return useQuery({
    queryKey: ["dashboard", "monthly-flows", orgId],
    enabled: Boolean(orgId),
    queryFn: () =>
      callStats<MonthlyFlow>("stats_monthly_flows", { p_org_id: orgId, p_months: 2, p_socle_org_id: null }),
  });
}

/** Demandes « À traiter » visibles par l'utilisateur, les plus anciennes d'abord (elles attendent). */
export function useAwaitingRequests(orgId: string) {
  return useQuery({
    queryKey: ["dashboard", "awaiting", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<DashboardList> => {
      const { data, error, count } = await supabase
        .from("requests")
        .select(LIST_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .eq("status", "a_traiter")
        .order("received_at", { ascending: true })
        .limit(DASHBOARD_LIST_LIMIT);
      if (error) throw error;
      return { items: (data ?? []) as RequestListItem[], total: count ?? 0 };
    },
  });
}

/** Demandes ouvertes affectées à l'utilisateur courant, les plus anciennes d'abord. */
export function useMyAssignedRequests(orgId: string, userId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "mine", orgId, userId],
    enabled: Boolean(orgId && userId),
    queryFn: async (): Promise<DashboardList> => {
      const { data, error, count } = await supabase
        .from("requests")
        .select(LIST_SELECT, { count: "exact" })
        .eq("organization_id", orgId)
        .eq("assigned_to", userId!)
        .in("status", [...OPEN_STATUSES])
        .order("received_at", { ascending: true })
        .limit(DASHBOARD_LIST_LIMIT);
      if (error) throw error;
      return { items: (data ?? []) as RequestListItem[], total: count ?? 0 };
    },
  });
}
