// Statistiques — un hook TanStack par RPC `stats_*`.
//
// Toutes les RPC sont SECURITY INVOKER : elles ne rendent que les faits du
// périmètre du lecteur (couples organisme × démarche en consultation). Deux
// agents lisent légitimement deux chiffres différents — c'est la règle, la
// même que pour la liste des demandes.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { OutcomeCounts, SourceCount } from "./stats";

export interface MonthPoint {
  month_key: string;
  request_count: number;
}
export interface OrganizationPoint {
  org_socle_id: string;
  org_name: string;
  request_count: number;
}
export interface ProcessingPoint {
  org_socle_id: string;
  org_name: string;
  avg_days_to_instruction: number | null;
  avg_days_to_resolution: number | null;
  request_count: number;
}
export interface AgentPoint {
  user_id: string;
  user_name: string;
  request_count?: number;
  intervention_count?: number;
}
export interface InterventionCounts {
  requested_count: number;
  completed_count: number;
  avg_days_to_completion: number | null;
}

// Les signatures des RPC arrivent dans `database.types.ts` à la régénération
// qui suit la migration ; ce passage par `string` évite de coupler le hook au
// fichier généré (motif du `rpc<T>` de Clara).
type RpcClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function callStats<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(fn, params);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export interface StatsScope {
  orgId: string;
  /** Organisme porteur Socle filtré, null = tous. */
  socleOrgId: string | null;
  /** Borne basse de la période (ISO). */
  sinceISO: string;
}

function key(name: string, s: StatsScope, ...extra: unknown[]) {
  return ["stats", name, s.orgId, s.socleOrgId, s.sinceISO, ...extra] as const;
}

export function useRequestsByMonth(s: StatsScope, months = 12) {
  return useQuery({
    queryKey: ["stats", "by-month", s.orgId, s.socleOrgId, months] as const,
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<MonthPoint>("stats_requests_by_month", {
        p_org_id: s.orgId,
        p_months: months,
        p_socle_org_id: s.socleOrgId,
      }),
  });
}

export function useRequestsBySource(s: StatsScope) {
  return useQuery({
    queryKey: key("by-source", s),
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<SourceCount>("stats_requests_by_source", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
        p_socle_org_id: s.socleOrgId,
      }),
  });
}

export function useRequestsByOrganization(s: StatsScope) {
  return useQuery({
    queryKey: ["stats", "by-organization", s.orgId, s.sinceISO] as const,
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<OrganizationPoint>("stats_requests_by_organization", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
      }),
  });
}

export function useProcessingTimes(s: StatsScope) {
  return useQuery({
    queryKey: ["stats", "processing-times", s.orgId, s.sinceISO] as const,
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<ProcessingPoint>("stats_processing_times", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
      }),
  });
}

export function useOutcomes(s: StatsScope) {
  return useQuery({
    queryKey: key("outcomes", s),
    enabled: Boolean(s.orgId),
    queryFn: async (): Promise<OutcomeCounts> => {
      const rows = await callStats<OutcomeCounts>("stats_outcomes", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
        p_socle_org_id: s.socleOrgId,
      });
      return rows[0] ?? { positive_count: 0, negative_count: 0, cancelled_count: 0, open_count: 0 };
    },
  });
}

export function useTopResolvers(s: StatsScope, limit = 10) {
  return useQuery({
    queryKey: key("top-resolvers", s, limit),
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<AgentPoint>("stats_top_resolvers", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
        p_socle_org_id: s.socleOrgId,
        p_limit: limit,
      }),
  });
}

export function useInterventionStats(s: StatsScope) {
  return useQuery({
    queryKey: key("interventions", s),
    enabled: Boolean(s.orgId),
    queryFn: async (): Promise<InterventionCounts> => {
      const rows = await callStats<InterventionCounts>("stats_interventions", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
        p_socle_org_id: s.socleOrgId,
      });
      return rows[0] ?? { requested_count: 0, completed_count: 0, avg_days_to_completion: null };
    },
  });
}

export function useTopIntervenants(s: StatsScope, limit = 10) {
  return useQuery({
    queryKey: key("top-intervenants", s, limit),
    enabled: Boolean(s.orgId),
    queryFn: () =>
      callStats<AgentPoint>("stats_top_intervenants", {
        p_org_id: s.orgId,
        p_since: s.sinceISO,
        p_socle_org_id: s.socleOrgId,
        p_limit: limit,
      }),
  });
}
