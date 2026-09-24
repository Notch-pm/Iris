// Pièces communes des LISTES de l'application — maquette Claude Design « Liste —
// en-tête compacté » (2026-09-11), posée d'abord sur la liste des demandes puis
// reprise par la liste des usagers : boutons ronds de la barre collante, groupes
// de pastilles et listes à cocher du popover « Filtres », pied de pagination.
// Présentation seule : l'état (filtres, page, regroupement) appartient à la page.

import * as React from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const PILL =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border text-[13px] font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]";
export const PILL_IDLE = "border-border bg-background text-foreground hover:bg-secondary hover:border-secondary";
export const PILL_ACTIVE = "border-primary bg-primary/10 text-primary";

/** Bouton rond à icône seule (densité, vues, export) : le libellé passe en info-bulle et en texte caché. */
export function IconPill({
  label, active, className, children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      className={cn(PILL, "w-9 justify-center px-0", active ? PILL_ACTIVE : PILL_IDLE, "text-muted-foreground", active && "text-primary", className)}
      {...props}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

export interface FilterOption { value: string; label: string }

/**
 * Pastilles à cocher. `single` : une valeur au plus (re-cliquer la retire) —
 * pour les critères exclusifs, lus comme des boutons radio.
 */
export function ChipGroup({
  label, hint, options, selected, onToggle, single = false,
}: {
  label: string;
  hint?: string;
  options: readonly FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  single?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">{label}</legend>
      {hint ? <p className="-mt-1 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              onClick={() => onToggle(o.value)}
              className={cn(
                "inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border px-[11px] text-[12.5px] font-semibold transition-colors hover:border-primary/50",
                on ? PILL_ACTIVE : "border-border bg-background text-foreground",
              )}
            >
              {on ? <Check className="size-3" aria-hidden="true" /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Liste à cocher défilante, pour les critères à nombreuses valeurs (organismes, quartiers…). */
export function CheckList({
  label, options, selected, onToggle,
}: { label: string; options: readonly FilterOption[]; selected: readonly string[]; onToggle: (value: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">{label}</legend>
      {options.length === 0 ? (
        <span className="px-2 py-1 text-xs text-muted-foreground">Aucune valeur</span>
      ) : null}
      <div className="flex max-h-[176px] flex-col gap-0.5 overflow-auto">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(o.value)}
              className={cn(
                "flex h-[34px] w-full shrink-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted/70",
                on && "bg-primary/[0.07]",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
                aria-hidden="true"
              >
                {on ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{o.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Pagination du pied : précédente, fenêtre de pages (`null` = ellipse), suivante. */
export function ListPagination({
  page, pageCount, pages, onPage,
}: { page: number; pageCount: number; pages: readonly (number | null)[]; onPage: (page: number) => void }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="flex size-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Page précédente</span>
      </button>
      {pages.map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} className="w-5 text-center" aria-hidden="true">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors",
              p === page ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        className="flex size-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Page suivante</span>
      </button>
    </nav>
  );
}
