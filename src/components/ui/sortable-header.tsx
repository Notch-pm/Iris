// En-tête de colonne triable (motif Clara `SortableHeader`) : bouton ghost avec
// flèche haut/bas, ou double flèche grisée quand la colonne n'est pas triée.
// Le `<th>` porteur doit exposer `aria-sort={ariaSort(direction)}`.

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** `false` = colonne non triée. */
export type SortDirection = "asc" | "desc" | false;

/** Valeur `aria-sort` du `<th>` : « none » = triable mais non triée (≠ attribut absent = non triable). */
export function ariaSort(direction: SortDirection): "ascending" | "descending" | "none" {
  return direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
}

interface Props {
  title: string;
  direction: SortDirection;
  onToggle: () => void;
  className?: string;
}

export function SortableHeader({ title, direction, onToggle, className }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "-ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold uppercase tracking-wide",
        "transition-colors hover:bg-secondary hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        direction ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span>{title}</span>
      {direction === "asc" ? (
        <ArrowUp className="size-3.5" aria-hidden="true" />
      ) : direction === "desc" ? (
        <ArrowDown className="size-3.5" aria-hidden="true" />
      ) : (
        <ArrowUpDown className="size-3.5 opacity-60" aria-hidden="true" />
      )}
    </button>
  );
}
