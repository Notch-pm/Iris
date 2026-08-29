// Paramètres › Assistant IA — la consommation de la collectivité, EN LECTURE
// SEULE.
//
// Le plafond est le levier de maîtrise des coûts côté éditeur, pas un
// paramètre métier délégué aux collectivités : l'écran le dit explicitement
// plutôt que de laisser l'administrateur chercher un bouton qui n'existe pas.
//
// ⚠️ DEPUIS LE 2026-08-29, LE BUDGET N'EST PLUS CELUI D'IRIS. Il appartient à
// la collectivité et vaut pour toute la gamme : Iris, Clara et les suivants
// puisent au même seau. L'écran doit le dire, sans quoi un administrateur
// lirait « il me reste de quoi tenir » en ignorant ce qu'un autre produit
// consomme au même moment. C'est aussi pourquoi la répartition par
// application est affichée : elle est la seule réponse à « qui dépense ? ».

import { Loader2 } from "lucide-react";
import { Surface, SurfaceHead } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { formatTokens, renewalLabel, type QuotaTone } from "@fn/_shared/ai/quota";
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
  const data = usage.data;
  const renewal = data ? renewalLabel(data.renewsAt) : "";

  return (
    <Surface>
      <SurfaceHead
        title="Assistant IA"
        sub={data
          ? `Période ${data.period}${renewal ? ` · renouvellement le ${renewal}` : ""}`
          : undefined}
      />

      {usage.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Lecture de la consommation…
        </p>
      ) : null}

      {usage.isError ? (
        <p className="text-sm text-muted-foreground">
          {usage.error instanceof Error
            ? usage.error.message
            : "La consommation n'a pas pu être lue. Réessayez dans un instant."}
        </p>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-3">
          {data.view.unlimited ? (
            <p className="text-sm text-muted-foreground">
              Aucun plafond configuré pour cette collectivité — consommation illimitée.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Jetons engagés ce mois</span>
                <span className="text-sm font-semibold tabular-nums">
                  <span className={TEXT_TONE[data.view.tone]}>
                    {formatTokens(data.view.engaged)}
                  </span>
                  <span className="text-muted-foreground">
                    {" / "}{formatTokens(data.view.limit ?? 0)}
                  </span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={data.view.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Consommation de jetons IA"
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <span
                  className={cn("block h-full rounded-full transition-[width] duration-200",
                    BAR_TONE[data.view.tone])}
                  style={{ width: `${data.view.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatTokens(data.view.remaining ?? 0)} jetons restants
                {data.view.reserved > 0
                  ? ` · dont ${formatTokens(data.view.reserved)} en cours de traitement`
                  : ""}
              </p>
            </>
          )}

          {/* La consommation reste affichée même sans plafond : elle a bien eu lieu. */}
          {data.view.unlimited && data.view.used > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatTokens(data.view.used)} jetons consommés ce mois.
            </p>
          ) : null}

          {data.byConsumer.length > 0 ? (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Par application
              </p>
              <ul className="flex flex-col gap-1">
                {data.byConsumer.map((row, i) => (
                  <li
                    key={`${row.consumer}-${row.feature ?? i}`}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="truncate">
                      <span className="font-semibold capitalize">{row.consumer}</span>
                      {row.feature ? (
                        <span className="text-muted-foreground"> · {row.feature}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatTokens(row.tokens)} jetons · {row.calls}{" "}
                      {row.calls > 1 ? "appels" : "appel"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Ce budget est celui de la <strong>collectivité</strong>, toutes les applications
            Edilumen confondues. Il est fixé par l'éditeur et ne se règle pas ici. Un
            dépassement ne bloque que l'assistant : l'instruction des demandes continue
            normalement.
          </p>
        </div>
      ) : null}
    </Surface>
  );
}
