// Plafond et consommation IA — lecture partagée par les deux écrans.
//
// La LECTURE passe par le RLS (`ai_usage_quotas_select` / `..._counters_select`
// : admin plateforme ou administration du tenant). L'ÉCRITURE n'a qu'une porte,
// les RPC `set_ai_usage_quota` / `delete_ai_usage_quota`, dont la garde
// `is_platform_admin()` vit dans la fonction — les tables n'ont AUCUNE policy
// d'écriture cliente (divergence assumée avec Clara, où le navigateur du
// superadmin fait lui-même l'UPSERT).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { periodKey, quotaView, type QuotaView } from "@fn/_shared/ai/quota";

/** Sentinelle du plafond « tous fournisseurs confondus » (jumeau du SQL). */
export const GLOBAL_PROVIDER = "__global__";

export interface AiUsageSummary {
  organizationId: string;
  period: string;
  /** `null` = aucun plafond configuré ⇒ consommation illimitée. */
  limit: number | null;
  isActive: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  view: QuotaView;
}

interface QuotaRow {
  organization_id: string;
  provider: string;
  monthly_limit_tokens: number;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

interface CounterRow {
  organization_id: string;
  provider: string;
  used_tokens: number;
  reserved_tokens: number;
}

/**
 * Rapproche plafonds et compteurs de la période courante. Un plafond
 * désactivé compte comme absent : c'est ce que fait `reserve_ai_usage`, et
 * l'écran doit dire la même chose que le serveur.
 */
export function buildSummaries(
  organizationIds: string[],
  quotas: QuotaRow[],
  counters: CounterRow[],
  period: string,
): AiUsageSummary[] {
  const quotaByOrg = new Map(
    quotas.filter((q) => q.provider === GLOBAL_PROVIDER).map((q) => [q.organization_id, q]),
  );
  const counterByOrg = new Map(
    counters.filter((c) => c.provider === GLOBAL_PROVIDER).map((c) => [c.organization_id, c]),
  );

  return organizationIds.map((organizationId) => {
    const quota = quotaByOrg.get(organizationId) ?? null;
    const counter = counterByOrg.get(organizationId) ?? null;
    const active = quota?.is_active ?? false;
    const limit = quota && active ? quota.monthly_limit_tokens : null;
    return {
      organizationId,
      period,
      limit,
      isActive: active,
      updatedAt: quota?.updated_at ?? null,
      updatedBy: quota?.updated_by ?? null,
      view: quotaView({
        limit,
        used: counter?.used_tokens ?? 0,
        reserved: counter?.reserved_tokens ?? 0,
      }),
    };
  });
}

const QUOTA_SELECT = "organization_id, provider, monthly_limit_tokens, is_active, updated_at, updated_by";
const COUNTER_SELECT = "organization_id, provider, used_tokens, reserved_tokens";

/** Consommation d'UN tenant — panneau Paramètres de l'administrateur. */
export function useAiUsage(orgId: string) {
  return useQuery({
    queryKey: ["ai-usage", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<AiUsageSummary> => {
      const period = periodKey(new Date());
      const [quotas, counters] = await Promise.all([
        supabase.from("ai_usage_quotas").select(QUOTA_SELECT).eq("organization_id", orgId),
        supabase.from("ai_usage_counters").select(COUNTER_SELECT)
          .eq("organization_id", orgId).eq("period", period),
      ]);
      if (quotas.error) throw quotas.error;
      if (counters.error) throw counters.error;
      return buildSummaries([orgId], quotas.data ?? [], counters.data ?? [], period)[0];
    },
  });
}

/** Consommation de TOUS les tenants — écran superadmin. */
export function useAllAiUsage(organizationIds: string[]) {
  const key = [...organizationIds].sort().join(",");
  return useQuery({
    queryKey: ["sa-ai-usage", key],
    enabled: organizationIds.length > 0,
    queryFn: async (): Promise<AiUsageSummary[]> => {
      const period = periodKey(new Date());
      const [quotas, counters] = await Promise.all([
        supabase.from("ai_usage_quotas").select(QUOTA_SELECT),
        supabase.from("ai_usage_counters").select(COUNTER_SELECT).eq("period", period),
      ]);
      if (quotas.error) throw quotas.error;
      if (counters.error) throw counters.error;
      return buildSummaries(organizationIds, quotas.data ?? [], counters.data ?? [], period);
    },
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["sa-ai-usage"] });
  void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
}

/** Pose ou modifie le plafond. Le refus SQL est relayé tel quel à l'écran. */
export function useSetAiQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { organizationId: string; limitTokens: number; isActive?: boolean }) => {
      const { error } = await supabase.rpc("set_ai_usage_quota", {
        p_org_id: vars.organizationId,
        p_monthly_limit_tokens: vars.limitTokens,
        p_is_active: vars.isActive ?? true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(queryClient),
  });
}

/** Retire le plafond (consommation illimitée). Compteurs et journal conservés. */
export function useDeleteAiQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { organizationId: string }) => {
      const { error } = await supabase.rpc("delete_ai_usage_quota", {
        p_org_id: vars.organizationId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(queryClient),
  });
}
