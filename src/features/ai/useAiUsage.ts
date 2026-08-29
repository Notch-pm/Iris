// Consommation IA d'un tenant — LUE DANS LE SOCLE, plus dans Iris.
//
// Depuis la centralisation (2026-08-29), le plafond et le compteur vivent dans
// le référentiel : un budget est une affaire de COLLECTIVITÉ, commun à toute
// la gamme, et Iris n'en est qu'un des consommateurs. Il ne tient donc plus de
// comptabilité — il demande la sienne.
//
// ⚠️ CE CHANGEMENT DE SOURCE EST AUSSI UN CHANGEMENT DE GARDE. Tant que la
// lecture visait les tables d'Iris, la policy `is_platform_admin() or
// is_org_admin_anywhere(...)` la gardait toute seule. Passée par `socle-proxy`,
// elle se fait en service_role, pour qui le RLS ne s'applique pas : la règle
// est RÉÉCRITE dans la fonction (`is_org_admin_anywhere_for`). L'écran, lui,
// ne fait toujours que refléter.
//
// Ce que le Socle possède et qu'Iris ne recalcule plus : la période et la date
// de renouvellement. Ce qu'Iris garde : la présentation — `quotaView` dessine
// la jauge à partir des trois faits (plafond, consommé, réservé).

import { useQuery } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";
import { quotaView, type QuotaView } from "@fn/_shared/ai/quota";
import type { AiUsageView } from "@fn/socle-proxy/_shared/sanitize";

/** Ce qu'une application de la gamme a dépensé, et sur quelle fonctionnalité. */
export interface ConsumerUsage {
  consumer: string;
  feature: string | null;
  calls: number;
  tokens: number;
}

export interface AiUsageSummary {
  period: string;
  /** Date ISO rendue par le Socle — Iris ne fait que la mettre en français. */
  renewsAt: string | null;
  view: QuotaView;
  /** Le plafond est commun ; le journal, lui, sait qui a dépensé. */
  byConsumer: ConsumerUsage[];
}

/** Traduit la réponse du proxy en ce que l'écran dessine. Pur, testé. */
export function toSummary(usage: AiUsageView): AiUsageSummary {
  return {
    period: usage.period,
    renewsAt: usage.renews_at,
    view: quotaView({
      limit: usage.limit,
      used: usage.used_tokens,
      reserved: usage.reserved_tokens,
    }),
    // Les plus gros postes d'abord : c'est la question que se pose un
    // administrateur qui ouvre cet écran.
    byConsumer: [...usage.by_consumer].sort((a, b) => b.tokens - a.tokens),
  };
}

/** Consommation du tenant — panneau Paramètres de l'administrateur. */
export function useAiUsage(orgId: string) {
  return useQuery({
    queryKey: ["ai-usage", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<AiUsageSummary> => {
      const { usage } = await invokeEdge<{ usage: AiUsageView }>(
        "socle-proxy/v1/ai/usage",
        { organization_id: orgId },
      );
      return toSummary(usage);
    },
  });
}
