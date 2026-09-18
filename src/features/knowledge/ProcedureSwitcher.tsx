// « Changer de démarche » — sélecteur à recherche de la fiche : le catalogue
// publié, par catégorie, filtré à la frappe (mêmes règles que la liste :
// `filterCatalogue`, `groupByCategory`), ouvert sur la démarche courante.
//
// Motif combobox ARIA : le champ garde le focus, ↑ ↓ déplacent l'option
// active (`aria-activedescendant`), Entrée ouvre sa fiche, Échap referme
// (géré par `Dropdown`). Le défilement de la liste suit l'option active en
// réglant SON `scrollTop` — jamais `scrollIntoView`, qui ferait aussi défiler
// les colonnes voisines.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Dropdown } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { filterCatalogue, groupByCategory, type KnowledgeProcedure } from "./catalogue";

interface Props {
  catalogue: readonly KnowledgeProcedure[];
  currentId: string;
}

export function ProcedureSwitcher({ catalogue, currentId }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);
  const baseId = React.useId();

  const groups = React.useMemo(() => groupByCategory(filterCatalogue(catalogue, query)), [catalogue, query]);
  const flat = React.useMemo(() => groups.flatMap((g) => g.procedures), [groups]);

  // À l'ouverture, l'option active est la démarche courante ; à la frappe, la
  // première qui correspond.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const current = flat.findIndex((p) => p.id === currentId);
    setActive(query === "" && current >= 0 ? current : 0);
    // `flat` suit `query` : on ne réagit qu'à la frappe et à l'ouverture, pas
    // à chaque nouvelle référence de tableau.
  }, [open, query]);

  React.useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [active, open]);

  function choose(item: KnowledgeProcedure) {
    setOpen(false);
    if (item.id !== currentId) navigate(`/base-de-connaissances/${item.id}`);
  }

  const optionId = (index: number) => `${baseId}-option-${index}`;
  let index = -1;

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      role="dialog"
      ariaLabel="Changer de démarche"
      align="left"
      className="mt-3"
      menuClassName="w-[min(380px,calc(100vw-24px))] gap-2 p-2"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-bold transition-colors hover:border-primary/40"
        >
          <span>Changer de démarche</span>
          <ChevronsUpDown className="size-[15px] text-muted-foreground" aria-hidden="true" />
        </button>
      )}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
          aria-label="Rechercher une démarche"
          placeholder="Rechercher une démarche…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && flat[active]) {
              e.preventDefault();
              choose(flat[active]);
            }
          }}
          className="h-9 w-full rounded-[10px] border border-input bg-background pl-8 pr-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {flat.length === 0 ? (
        <p className="px-2 py-3 text-[12.5px] text-muted-foreground">Aucune démarche ne correspond.</p>
      ) : (
        <ul
          ref={listRef}
          id={`${baseId}-list`}
          role="listbox"
          aria-label="Démarches"
          className="relative flex max-h-[min(420px,60vh)] flex-col overflow-y-auto"
        >
          {groups.map((group) => (
            <li key={group.label} role="presentation">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-muted-foreground">
                {group.label}
              </p>
              <ul role="group" aria-label={group.label}>
                {group.procedures.map((item) => {
                  index += 1;
                  const i = index;
                  const isActive = i === active;
                  const isCurrent = item.id === currentId;
                  return (
                    <li
                      key={item.id}
                      id={optionId(i)}
                      data-index={i}
                      role="option"
                      aria-selected={isCurrent}
                      onMouseEnter={() => setActive(i)}
                      // `mousedown` et non `click` : le champ perdrait le focus
                      // avant, et le menu se refermerait sous le pointeur.
                      onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-[9px] px-2 py-2 text-[12.5px]",
                        isActive ? "bg-secondary/50" : "",
                        isCurrent ? "font-bold text-primary" : "font-semibold",
                      )}
                    >
                      <span className="min-w-0 flex-1">{item.name}</span>
                      {isCurrent ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}
