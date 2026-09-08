// Barre de recherche du header — une demande OU un usager, résultats groupés
// par nature. Trois caractères suffisent à lancer la recherche, temporisée le
// temps que la frappe se pose (`SEARCH_DEBOUNCE_MS`).
//
// Elle ne garde AUCUNE porte : ce qu'elle montre est ce que le RLS laisse voir
// (demandes) et ce que `socle-proxy` accepte de servir (usagers). Le clavier
// fait tout — motif éprouvé du champ d'adresse : ↑ ↓ parcourent, Entrée ouvre,
// Échap ferme.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCanBrowseUsagers } from "@/features/contacts/useUsagers";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import {
  flattenResults, isSearchable, MIN_QUERY_LENGTH, moveIndex, normalizeQuery, type SearchResult,
} from "./search";
import { useGlobalSearch } from "./useGlobalSearch";

const LIST_ID = "recherche-globale";

function ResultRow({ result }: { result: SearchResult }) {
  if (result.kind === "usager") {
    return (
      <span className="flex w-full flex-col items-start gap-0.5 text-left">
        <span className="w-full truncate text-[13px] font-semibold">{result.name}</span>
        <span className="w-full truncate text-[11.5px] text-muted-foreground">
          {result.city === "" ? "Ville inconnue" : result.city}
        </span>
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col items-start gap-1 text-left">
      <span className="flex w-full items-center gap-2">
        <span className="shrink-0 text-[12.5px] font-bold text-primary">{result.reference}</span>
        <StatusBadge status={result.status} />
      </span>
      <span className="w-full truncate text-[13px] font-medium">{result.subject}</span>
      <span className="w-full truncate text-[11.5px] text-muted-foreground">
        {result.receivedAt} · {result.organisme} · {result.agent}
      </span>
    </span>
  );
}

export function GlobalSearch() {
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  // Même droit que l'entrée « Usagers » du rail : sans lui, socle-proxy
  // refuserait la recherche d'usagers — la barre ne cherche que des demandes.
  const withUsagers = useCanBrowseUsagers();
  const navigate = useNavigate();

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { groups, isLoading, isStale, usagersUnavailable, requestsFailed, settled } =
    useGlobalSearch(orgId, query, withUsagers);
  const results = flattenResults(groups);
  const typed = normalizeQuery(query);
  const searchable = isSearchable(query);
  const showPanel = open && typed !== "";
  const showList = showPanel && searchable && results.length > 0;

  // Une nouvelle liste se parcourt depuis le haut.
  React.useEffect(() => setIndex(0), [results.length]);

  // Fermeture au clic à côté (motif du menu compte) : le panneau porte des
  // boutons de navigation, un `blur` fermerait avant que le clic n'arrive.
  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(result: SearchResult) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (typed === "") inputRef.current?.blur();
      setOpen(false);
      return;
    }
    if (!showList) {
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => moveIndex(i, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => moveIndex(i, -1, results.length));
    } else if (e.key === "Enter") {
      // Tant que la liste est ouverte, Entrée OUVRE le résultat retenu.
      e.preventDefault();
      const result = results[index];
      if (result) choose(result);
    }
    // Tab n'est pas détourné : il doit continuer de sortir du champ.
  }

  let cursor = -1;
  return (
    <div ref={boxRef} className="relative w-full max-w-[520px]">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="text"
        aria-label="Rechercher une demande ou un usager"
        placeholder="Rechercher une demande ou un usager…"
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${LIST_ID}-${index}` : undefined}
        className="h-9 rounded-full border-transparent bg-muted/70 pl-9 pr-9 text-[13px] focus-visible:border-ring focus-visible:bg-background"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query !== "" ? (
        <button
          type="button"
          title="Effacer la recherche"
          onClick={() => { setQuery(""); setOpen(false); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Effacer la recherche</span>
        </button>
      ) : null}

      {showPanel ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-[70vh] w-[min(560px,90vw)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg">
          {!searchable ? (
            <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
              Saisissez au moins {MIN_QUERY_LENGTH} caractères.
            </p>
          ) : (
            <>
              <div id={LIST_ID} role="listbox" aria-label="Résultats de la recherche">
                {groups.map((group) => (
                  <div key={group.key} role="group" aria-label={group.label}>
                    <p
                      aria-hidden="true"
                      className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                    >
                      {group.label}
                    </p>
                    {group.results.map((result) => {
                      cursor += 1;
                      const i = cursor;
                      const active = i === index;
                      return (
                        <button
                          key={`${result.kind}-${result.id}`}
                          type="button"
                          role="option"
                          id={`${LIST_ID}-${i}`}
                          aria-selected={active}
                          onClick={() => choose(result)}
                          onMouseEnter={() => setIndex(i)}
                          className={cn(
                            "flex w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                            active ? "bg-primary/10" : "hover:bg-muted",
                          )}
                        >
                          <ResultRow result={result} />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {isLoading || isStale ? (
                <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">Recherche…</p>
              ) : results.length === 0 && settled ? (
                <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                  Aucun résultat pour « {typed} ».
                </p>
              ) : null}

              {requestsFailed ? (
                <p className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                  Les demandes n'ont pas pu être interrogées — réessayez dans un instant.
                </p>
              ) : null}
              {usagersUnavailable ? (
                <p className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                  Référentiel des usagers indisponible — seules les demandes sont cherchées.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* Sans cette annonce, la liste n'existe que pour l'œil. */}
      <span role="status" aria-live="polite" className="sr-only">
        {showList ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : ""}
      </span>
    </div>
  );
}
