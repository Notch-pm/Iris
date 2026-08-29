// Paramètres › Assistant IA — la consommation du tenant, EN LECTURE SEULE.
//
// Le plafond est le levier de maîtrise des coûts côté éditeur, pas un
// paramètre métier délégué aux collectivités : l'écran le dit explicitement
// plutôt que de laisser l'administrateur chercher un bouton qui n'existe pas.
// Le RLS l'impose de toute façon (aucune policy d'écriture cliente) — l'UI ne
// fait que refléter.

import { Loader2 } from "lucide-react";
import { Surface, SurfaceHead } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { formatTokens, nextRenewalLabel, type QuotaTone } from "@fn/_shared/ai/quota";
import { useAiUsage } from "./useAiUsage";

const BAR_TONE: Record<QuotaTone, string> = {
  ok: "bg-primary",
  warn: "bg-secondary-foreground",
  critical: "bg-destructive",
};

const TEXT_TONE: Record<QuotaTone, string> = {
  ok: "text-primary",
  warn: "text-secondary-foreground",
  critical: "text-destructive",
};

export function AiUsagePanel({ orgId }: { orgId: string }) {
  const usage = useAiUsage(orgId);
  const now = new Date();

  return (
    <Surface>
      <SurfaceHead
        title="Assistant IA"
        sub={usage.data ? `Période ${usage.data.period} · renouvellement le ${nextRenewalLabel(now)}` : undefined}
      />

      {usage.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture de la consommation…
        </p>
      ) : null}

      {usage.isError ? (
        <p className="text-sm text-muted-foreground">
          La consommation n'a pas pu être lue. Réessayez dans un instant.
        </p>
      ) : null}

      {usage.data ? (
        <div className="flex flex-col gap-3">
          {usage.data.view.unlimited ? (
            <p className="text-sm text-muted-foreground">
              {usage.data.isActive === false && usage.data.updatedAt
                ? "Plafond désactivé — consommation illimitée."
                : "Aucun plafond configuré pour cette organisation — consommation illimitée."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Jetons engagés ce mois</span>
                <span className="text-sm font-semibold tabular-nums">
                  <span className={TEXT_TONE[usage.data.view.tone]}>
                    {formatTokens(usage.data.view.engaged)}
                  </span>
                  <span className="text-muted-foreground">
                    {" / "}{formatTokens(usage.data.view.limit ?? 0)}
                  </span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={usage.data.view.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Consommation de jetons IA"
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <span
                  className={cn("block h-full rounded-full transition-[width] duration-200",
                    BAR_TONE[usage.data.view.tone])}
                  style={{ width: `${usage.data.view.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatTokens(usage.data.view.remaining ?? 0)} jetons restants
                {usage.data.view.reserved > 0
                  ? ` · dont ${formatTokens(usage.data.view.reserved)} en cours de traitement`
                  : ""}
              </p>
            </>
          )}

          {/* La consommation reste affichée même sans plafond : elle a bien eu lieu. */}
          {usage.data.view.unlimited && usage.data.view.used > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatTokens(usage.data.view.used)} jetons consommés ce mois.
            </p>
          ) : null}

          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Le plafond est fixé par l'éditeur ; il ne se règle pas ici. Un dépassement ne bloque
            que l'assistant : l'instruction des demandes continue normalement.
          </p>
        </div>
      ) : null}
    </Surface>
  );
}
