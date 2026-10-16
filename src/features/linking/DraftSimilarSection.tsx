// Guichet — section « Signalements similaires » du rail de création (lot L2 de
// docs/demandes-liees.md).
//
// Recherche AUTOMATIQUE au récapitulatif (décision PO 2026-10-16), pour une
// démarche mutualisable seulement : la saisie est alors complète (lieu, objet,
// description). La liaison retenue ici se fait APRÈS la création, par
// `link_requests` — un refus est affiché sur l'écran « Demande créée », il ne
// bloque jamais la création.
//
// ⚠️ Distinct des « Demandes proches » juste au-dessus : celles-là rapprochent
// un même USAGER ; celles-ci, des usagers différents pour un même LIEU.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SimilarRow } from "./IncidentGroupCard";
import type { ScoredSimilar } from "./similaires";

export type DraftSimilarState = "idle" | "loading" | "error" | "ready";

interface Props {
  state: DraftSimilarState;
  items: ScoredSimilar[];
  linked: Record<string, string>;
  onToggle: (id: string, reference: string) => void;
}

export function DraftSimilarSection({ state, items, linked, onToggle }: Props) {
  const likely = items.filter((i) => i.likely).length;
  return (
    <section className="flex flex-col gap-2.5" aria-label="Signalements similaires">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold">Signalements similaires</h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-bold",
            likely > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {state === "ready"
            ? items.length > 0 ? `${items.length} trouvé${items.length > 1 ? "s" : ""}` : "aucun"
            : state === "loading" ? "recherche…" : state === "error" ? "indisponible" : "en veille"}
        </span>
      </div>

      {state === "idle" ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
          Au récapitulatif, Iris cherche les demandes signalant le même incident — même lieu,
          description proche — déposées par d'autres usagers.
        </p>
      ) : null}
      {state === "loading" ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Recherche des signalements similaires…
        </p>
      ) : null}
      {state === "error" ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
          Recherche indisponible pour l'instant — la création reste possible.
        </p>
      ) : null}
      {state === "ready" && items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-3.5 text-xs leading-relaxed text-muted-foreground">
          Aucun signalement proche par le lieu ou la description dans votre périmètre.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <SimilarRow
              key={item.request_id}
              item={item}
              canLink
              busy={false}
              linked={Boolean(linked[item.request_id])}
              onLink={() => onToggle(item.request_id, item.reference)}
              compact
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
