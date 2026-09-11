// Liste des demandes du tenant — maquette Claude Design « Liste — en-tête
// compacté » (2026-09-11) : une seule barre collante de 56 px (titre, compteur,
// « Grouper », « Filtres » en popover — recherche par objet en tête —, densité,
// autres vues, export, CTA), chips des critères actifs, en-tête de tableau figé —
// seules les lignes défilent —, pied de pagination fixe. Tri serveur par colonne,
// regroupement de la page courante, export CSV de toute la sélection filtrée
// (motif des listes Clara). Le RLS borne ce que l'utilisateur voit ; l'UI ne
// fait que présenter.

import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Download, Layers, Map, Plus,
  Rows3, Search, SlidersHorizontal, X,
} from "lucide-react";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { ariaSort, SortableHeader } from "@/components/ui/sortable-header";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  useSocleOrganizationsCatalog,
  useSocleProcedureActivations,
  useSocleProceduresCatalog,
} from "@/features/socle/useSocleCatalog";
import { canViewProcedure } from "@/features/rights/rights";
import {
  activationsByOrganisation,
  creatableByOrganisation,
} from "@/features/requests/creation/proposables";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { PRIORITY_LABELS, STATUS_LABELS } from "./statuts";
import {
  activeFilterCount, DEFAULT_SORT, EXPORT_MAX_ROWS, exportFilename, filterChips, GROUP_KEYS,
  GROUP_LABELS, groupRows, pageWindow, removeFilterChip, requestCsvColumns, toggleFilterValue,
  toggleSort, type FilterKey, type GroupKey, type SortKey, type SortState,
} from "./listing";
import {
  EMPTY_FILTERS, fetchRequestsForExport, PAGE_SIZE, useRequestFacets, useRequestsList,
  useTenantMembers, type RequestFilters, type RequestListItem,
} from "./useRequests";

const SEARCH_DEBOUNCE_MS = 300;
const DENSITY_STORAGE_KEY = "iris.demandes.liste.dense";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Valeur retardée (motif `useGlobalSearch`) : une requête par pause de frappe, pas par caractère. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function readDensity(): boolean {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const COLUMNS: { key: SortKey | null; title: string; className: string; align?: "right" }[] = [
  { key: "reference", title: "Référence", className: "w-[132px]" },
  { key: "subject", title: "Objet", className: "" },
  { key: "destinataire", title: "Organisme", className: "w-[180px]" },
  { key: null, title: "Priorité", className: "w-[96px]" },
  { key: "source", title: "Source", className: "w-[104px]" },
  { key: "status", title: "Statut", className: "w-[176px]" },
  { key: "received_at", title: "Reçue le", className: "w-[104px]", align: "right" },
  { key: null, title: "", className: "w-[36px]" },
];

// ---- Barre : boutons ronds ----------------------------------------------------

const PILL =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border text-[13px] font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]";
const PILL_IDLE = "border-border bg-background text-foreground hover:bg-secondary hover:border-secondary";
const PILL_ACTIVE = "border-primary bg-primary/10 text-primary";

/** Bouton rond à icône seule (densité, vues, export) : le libellé passe en info-bulle et en texte caché. */
function IconPill({
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

// ---- Ligne ----------------------------------------------------------------------

function RequestRow({ r, dense }: { r: RequestListItem; dense: boolean }) {
  const navigate = useNavigate();
  const href = `/demandes/${r.id}`;
  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-border/70 bg-card transition-colors hover:bg-muted/50",
        dense ? "h-9" : "h-12",
      )}
      onClick={() => navigate(href)}
    >
      <td className="px-3 font-mono text-xs tabular-nums text-muted-foreground">
        <Link
          to={href}
          className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={(e) => e.stopPropagation()}
        >
          {r.reference}
        </Link>
      </td>
      <td className="max-w-0 px-3">
        <div className="truncate text-[13.5px] font-semibold text-foreground">{r.subject}</div>
        {dense ? null : (
          <div className="truncate text-xs text-muted-foreground">
            {r.socle_procedure_label ?? "Sans démarche"}
          </div>
        )}
      </td>
      <td className="max-w-0 truncate px-3 text-[13px] text-muted-foreground">{r.socle_organization_label ?? "—"}</td>
      <td className="px-3 text-[13px] text-muted-foreground">{PRIORITY_LABELS[r.priority] ?? r.priority}</td>
      <td className="px-3">
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
          {r.source}
        </span>
      </td>
      <td className="px-3"><StatusBadge status={r.status} variant="dot" /></td>
      <td className="px-3 text-right text-[12.5px] font-medium tabular-nums text-muted-foreground">{formatDate(r.received_at)}</td>
      <td className="pr-4 text-right text-muted-foreground">
        <ChevronRight className="ml-auto size-4" aria-hidden="true" />
      </td>
    </tr>
  );
}

// ---- Popover « Filtres » ---------------------------------------------------------

interface FilterOption { value: string; label: string }

function ChipGroup({
  label, options, selected, onToggle,
}: { label: string; options: FilterOption[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
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

function CheckList({
  label, options, selected, onToggle,
}: { label: string; options: FilterOption[]; selected: string[]; onToggle: (value: string) => void }) {
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

// ---- Page -------------------------------------------------------------------------

export function RequestsListPage() {
  useFullBleedLayout();
  const { current, rights } = useTenant();
  // Filtre initial depuis l'URL (fil d'Ariane de la fiche, tableau, tableau de bord : `/demandes?status=…`).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = React.useState<RequestFilters>(() => {
    const status = searchParams.get("status") ?? "";
    return { ...EMPTY_FILTERS, status: status in STATUS_LABELS ? [status] : [] };
  });
  const [q, setQ] = React.useState("");
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const searchId = React.useId();
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [groupKey, setGroupKey] = React.useState<GroupKey | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [dense, setDense] = React.useState(readDensity);
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportNote, setExportNote] = React.useState<{ text: string; error: boolean } | null>(null);

  // La saisie ne devient un critère qu'après une pause de frappe ; chaque
  // changement de critère ramène en page 1.
  React.useEffect(() => {
    setFilters((f) => (f.q === debouncedQ ? f : { ...f, q: debouncedQ }));
    setPage(1);
  }, [debouncedQ]);

  const orgId = current?.organizationId ?? "";
  const list = useRequestsList(orgId, filters, page, sort, groupKey);
  const facets = useRequestFacets(orgId);
  const members = useTenantMembers(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const procCatalog = useSocleProceduresCatalog(orgId);
  const activations = useSocleProcedureActivations(orgId);
  // Catalogues Socle synchronisés quand disponibles, facettes observées sinon.
  // Restreint au périmètre (union des scope_organization_ids des profils actifs) —
  // admin plateforme : aucune restriction.
  const scopeOrgIds = rights.is_platform_admin
    ? null
    : new Set(
        rights.profiles
          .filter((p) => p.status === "active")
          .flatMap((p) => p.scope_organization_ids),
      );
  const destinataireOptions =
    ((orgCatalog.data?.length ?? 0) > 0 ? orgCatalog.data! : (facets.data?.destinataires ?? []))
      .filter((o) => scopeOrgIds === null || scopeOrgIds.has(o.value));
  // Facette « Démarche » restreinte aux démarches consultables (RM-61, CA-02) ; les
  // facettes observées sont déjà filtrées par le RLS.
  const procedureOptions =
    (procCatalog.data?.length ?? 0) > 0
      ? procCatalog.data!.filter((o) => rights.is_platform_admin || canViewProcedure(rights, o.value))
      : (facets.data?.procedures ?? []);
  const sourceOptions = facets.data?.sources ?? [];
  // « Nouvelle demande » : au moins un couple (organisme, démarche) à la fois
  // ACTIVÉ dans le Socle et dans mes droits (RM-58 + activation, 2026-08-31) —
  // reflet de confort, le serveur revalide le couple et le trigger t18 refuse
  // une démarche non activée. Sans le croisement, le bouton mènerait à un
  // parcours vide.
  const canCreate =
    creatableByOrganisation(
      rights,
      (procCatalog.data ?? []).map((o) => o.value),
      activationsByOrganisation(activations.data ?? []),
    ).size > 0;

  if (!current) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Aucun tenant accessible — contactez votre administrateur.
      </p>
    );
  }

  const toggleFilter = (key: FilterKey) => (value: string) => {
    setFilters((f) => toggleFilterValue(f, key, value));
    setPage(1);
  };
  const resetFilters = () => {
    setQ("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  // Trier ou regrouper depuis la page 7 laisserait une page vide : retour en page 1.
  const onSort = (key: SortKey) => { setSort((s) => toggleSort(s, key)); setPage(1); };
  const onGroup = (key: GroupKey | null) => {
    setGroupKey(key);
    setCollapsed(new Set());
    setPage(1);
    setGroupOpen(false);
  };
  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleDensity = () => {
    setDense((d) => {
      try { window.localStorage.setItem(DENSITY_STORAGE_KEY, d ? "0" : "1"); } catch { /* stockage indisponible : réglage de session */ }
      return !d;
    });
  };

  const memberList = members.data ?? [];
  const nameOf = (userId: string | null) =>
    memberList.find((m) => m.userId === userId)?.displayName ?? "";
  const resolveLabel = (key: FilterKey, value: string): string | undefined => {
    const pool = key === "destinataire" ? destinataireOptions : key === "procedure" ? procedureOptions : key === "source" ? sourceOptions : [];
    return pool.find((o) => o.value === value)?.label;
  };

  async function exportCsv() {
    setExporting(true);
    setExportNote(null);
    try {
      const { rows, truncated } = await fetchRequestsForExport(orgId, filters, sort, groupKey);
      downloadCsv(buildCsv(rows, requestCsvColumns(nameOf)), exportFilename(current!.organizationName, new Date()));
      setExportNote({
        text: truncated
          ? `Export limité aux ${EXPORT_MAX_ROWS} premières demandes — affinez les filtres pour le reste.`
          : `${rows.length} demande${rows.length > 1 ? "s" : ""} exportée${rows.length > 1 ? "s" : ""}.`,
        error: false,
      });
    } catch (err) {
      setExportNote({ text: err instanceof Error ? err.message : "Export impossible.", error: true });
    } finally {
      setExporting(false);
    }
  }

  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = list.data?.items ?? [];
  const groups = groupRows(items, groupKey);
  const chips = filterChips(filters, resolveLabel);
  const nFilters = activeFilterCount(filters);
  const nResults = `${total} demande${total > 1 ? "s" : ""}`;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Barre collante : titre, compteur, recherche, actions — 56 px. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <h1 className="whitespace-nowrap text-[17px] font-bold tracking-tight">Demandes</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
            {total}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Dropdown
            open={groupOpen}
            onOpenChange={setGroupOpen}
            align="right"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                title="Grouper par"
                className={cn(PILL, "px-3", groupKey ? PILL_ACTIVE : PILL_IDLE)}
              >
                <Layers className="size-[15px]" aria-hidden="true" />
                <span className="hidden max-w-[120px] truncate lg:inline">
                  {groupKey ? GROUP_LABELS[groupKey] : "Grouper"}
                </span>
                <ChevronDown className="hidden size-3.5 opacity-60 lg:inline" aria-hidden="true" />
              </button>
            )}
          >
            <DropdownLabel>Grouper par</DropdownLabel>
            <DropdownItem role="menuitemradio" aria-checked={groupKey === null} active={groupKey === null} onClick={() => onGroup(null)}>
              Aucun
            </DropdownItem>
            {GROUP_KEYS.map((k) => (
              <DropdownItem key={k} role="menuitemradio" aria-checked={groupKey === k} active={groupKey === k} onClick={() => onGroup(k)}>
                {GROUP_LABELS[k]}
              </DropdownItem>
            ))}
          </Dropdown>

          <Dropdown
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            align="right"
            role="dialog"
            ariaLabel="Filtrer les demandes"
            menuClassName="w-[340px] gap-0 p-0"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                title="Filtres"
                className={cn(PILL, "px-3", nFilters > 0 ? PILL_ACTIVE : PILL_IDLE)}
              >
                <SlidersHorizontal className="size-[15px]" aria-hidden="true" />
                <span className="hidden lg:inline">Filtres</span>
                {nFilters > 0 ? (
                  <span className="rounded-full bg-primary px-[7px] py-px text-[11px] font-bold tabular-nums text-primary-foreground">
                    {nFilters}
                  </span>
                ) : null}
              </button>
            )}
          >
            <div className="flex items-center justify-between px-3.5 pb-2.5 pt-3">
              <span className="text-[13.5px] font-bold">Filtrer les demandes</span>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Fermer</span>
              </button>
            </div>
            <div className="flex max-h-[420px] flex-col gap-3.5 overflow-auto px-3.5 pb-3">
              <div className="flex flex-col">
                <label htmlFor={searchId} className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">
                  Recherche
                </label>
                <div className="relative flex h-9 items-center">
                  <Search className="pointer-events-none absolute left-3 size-[15px] text-muted-foreground" aria-hidden="true" />
                  <input
                    id={searchId}
                    type="search"
                    placeholder="Objet ou référence…"
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    // Échap ferme le popover (écouteur du Dropdown) ; sans ce
                    // preventDefault, Chrome viderait AUSSI le champ de recherche
                    // — la recherche disparaîtrait au moment où on ferme le
                    // panneau pour lire les résultats.
                    onKeyDown={(e) => { if (e.key === "Escape") e.preventDefault(); }}
                    className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-[13.5px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
              </div>
              <ChipGroup
                label="Statut"
                options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                selected={filters.status}
                onToggle={toggleFilter("status")}
              />
              <ChipGroup
                label="Priorité"
                options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                selected={filters.priority}
                onToggle={toggleFilter("priority")}
              />
              <ChipGroup label="Source" options={sourceOptions} selected={filters.source} onToggle={toggleFilter("source")} />
              <CheckList label="Organisme" options={destinataireOptions} selected={filters.destinataire} onToggle={toggleFilter("destinataire")} />
              <CheckList label="Démarche" options={procedureOptions} selected={filters.procedure} onToggle={toggleFilter("procedure")} />
            </div>
            <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3.5 py-2.5">
              <button
                type="button"
                onClick={resetFilters}
                disabled={nFilters === 0}
                className="text-[12.5px] font-semibold text-muted-foreground underline underline-offset-[3px] disabled:no-underline disabled:opacity-50"
              >
                Tout effacer
              </button>
              <span className="text-[12.5px] font-semibold tabular-nums text-primary">{nResults}</span>
            </div>
          </Dropdown>

          <IconPill label={dense ? "Affichage confortable" : "Affichage compact"} active={dense} onClick={toggleDensity} aria-pressed={dense}>
            <Rows3 className="size-[15px]" aria-hidden="true" />
          </IconPill>
          <Link to="/demandes/tableau" title="Tableau des demandes" className={cn(PILL, PILL_IDLE, "w-9 justify-center px-0 text-muted-foreground")}>
            <Columns3 className="size-[15px]" aria-hidden="true" />
            <span className="sr-only">Tableau des demandes</span>
          </Link>
          <Link to="/carte" title="Carte des interventions" className={cn(PILL, PILL_IDLE, "w-9 justify-center px-0 text-muted-foreground")}>
            <Map className="size-[15px]" aria-hidden="true" />
            <span className="sr-only">Carte des interventions</span>
          </Link>
          <IconPill
            label={exporting ? "Export en cours…" : "Exporter en CSV"}
            onClick={() => void exportCsv()}
            disabled={exporting || total === 0}
            aria-busy={exporting}
            className="disabled:opacity-50"
          >
            <Download className="size-[15px]" aria-hidden="true" />
          </IconPill>

          {canCreate ? (
            <>
              <span className="mx-1 h-[22px] w-px bg-border" aria-hidden="true" />
              <Button asChild size="sm" className="rounded-full px-3.5 text-[13px] font-bold">
                <Link to="/demandes/nouvelle">
                  <Plus />
                  <span className="hidden lg:inline">Nouvelle demande</span>
                  <span className="sr-only lg:hidden">Nouvelle demande</span>
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {chips.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-5 py-2" aria-label="Filtres actifs">
          <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">Filtres actifs</span>
          {chips.map((c) => (
            <button
              key={`${c.key}:${c.value}`}
              type="button"
              onClick={() => {
                if (c.key === "q") setQ("");
                setFilters((f) => removeFilterChip(f, c));
                setPage(1);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 py-1 pl-[11px] pr-[7px] text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/[0.18]"
            >
              {c.label}
              <X className="size-[13px]" aria-hidden="true" />
              <span className="sr-only">Retirer</span>
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="whitespace-nowrap text-[12.5px] font-semibold text-muted-foreground underline underline-offset-[3px]"
          >
            Tout effacer
          </button>
        </div>
      ) : null}

      {exportNote ? (
        <div
          role={exportNote.error ? "alert" : "status"}
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2 text-xs",
            exportNote.error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <span>{exportNote.text}</span>
          <button type="button" onClick={() => setExportNote(null)} className="rounded p-0.5 hover:bg-muted">
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Masquer</span>
          </button>
        </div>
      ) : null}

      {/* En-tête figé, lignes défilantes. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.title || "actions"}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-10 h-[38px] border-b border-border bg-muted/[0.45] px-3 text-left text-xs font-semibold text-muted-foreground backdrop-blur-sm",
                    c.className,
                    c.align === "right" && "text-right",
                  )}
                  aria-sort={c.key ? ariaSort(sort.key === c.key ? sort.dir : false) : undefined}
                >
                  {c.key ? (
                    <SortableHeader
                      title={c.title}
                      direction={sort.key === c.key ? sort.dir : false}
                      onToggle={() => onSort(c.key!)}
                      className={cn("normal-case tracking-normal", c.align === "right" && "-mr-2 ml-0 flex-row-reverse")}
                    />
                  ) : (
                    <span className="inline-flex h-8 items-center">{c.title}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-muted-foreground">Chargement…</td></tr>
            ) : list.isError ? (
              <tr><td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-destructive">Les demandes n'ont pas pu être chargées.</td></tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-muted-foreground">
                  {nFilters > 0 ? "Aucune demande ne correspond aux filtres actifs." : "Aucune demande."}
                </td>
              </tr>
            ) : groupKey ? (
              groups.map((g) => {
                const isCollapsed = collapsed.has(g.id);
                return (
                  <React.Fragment key={g.id}>
                    <tr>
                      <td colSpan={COLUMNS.length} className="sticky top-[38px] z-[5] h-8 border-b border-border bg-muted/[0.75] px-3 backdrop-blur-sm">
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          aria-expanded={!isCollapsed}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          {isCollapsed
                            ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                            : <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />}
                          <span className="text-[12.5px] font-bold">{g.label}</span>
                          <span className="text-[11.5px] tabular-nums text-muted-foreground">
                            {g.items.length} demande{g.items.length > 1 ? "s" : ""}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isCollapsed ? null : g.items.map((r) => <RequestRow key={r.id} r={r} dense={dense} />)}
                  </React.Fragment>
                );
              })
            ) : (
              items.map((r) => <RequestRow key={r.id} r={r} dense={dense} />)
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border bg-card px-5 text-[12.5px] text-muted-foreground">
        <span className="tabular-nums">
          {total === 0 ? "Aucune demande" : `${first}–${last} sur ${nResults}`}
          {groupKey ? " — regroupement sur la page affichée" : ""}
        </span>
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="flex size-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Page précédente</span>
          </button>
          {pageWindow(page, pageCount).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="w-5 text-center" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
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
            onClick={() => setPage((p) => p + 1)}
            className="flex size-7 items-center justify-center rounded-lg border border-border transition-colors hover:bg-secondary disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Page suivante</span>
          </button>
        </nav>
      </footer>
    </div>
  );
}
