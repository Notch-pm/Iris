// Liste des usagers — annuaire du référentiel Socle vu depuis Iris, sur le
// gabarit de la liste des demandes (maquette Claude Design « Liste — en-tête
// compacté ») : une barre collante de 56 px (titre, compteur, « Grouper »,
// « Filtres » en popover — recherche en tête —, densité, export), chips des
// critères actifs, en-tête de tableau figé, pied de pagination fixe.
//
// Ce que Clara a et qu'Iris n'a pas : les filtres du fichier domiciliaire
// (anniversaires, mariages) — hors sujet ici. Ce qu'Iris a en plus : le nombre
// de demandes et de demandes ENCORE OUVERTES par usager, seules colonnes qui
// soient des données Iris — bornées par le RLS au périmètre du lecteur —, et le
// consentement au PARTAGE, que le Socle porte et qu'Iris recueille au dépôt.
//
// Deux sources (Socle + Iris) qu'aucun serveur ne joint : tri, filtres,
// regroupement et pagination sont donc CLIENT, sur l'ensemble rapatrié
// (`usagers.ts`, pur).

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2, ChevronDown, ChevronRight, Download, HeartHandshake, Landmark, Layers, Rows3,
  Search, SlidersHorizontal, User, X,
} from "lucide-react";
import { useFullBleedLayout } from "@/components/layout/shellLayout";
import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import {
  CheckList, ChipGroup, IconPill, ListPagination, PILL, PILL_ACTIVE, PILL_IDLE,
} from "@/components/ui/list-toolbar";
import { ariaSort, SortableHeader } from "@/components/ui/sortable-header";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { pageWindow } from "@/features/requests/listing";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  contactName, contactStatusLabel, contactTypeLabel, isDarkColor, isInactive,
} from "./usager";
import type { SocleContact } from "./rapprochement";
import { useCanBrowseUsagers, useContactRequestCounts, useUsagers, USAGERS_MAX } from "./useUsagers";
import {
  activeFilterCount, buildRows, contactPhone, DEFAULT_SORT, EMPTY_FILTERS, filterChips,
  filterUsagers, GROUP_KEYS, GROUP_LABELS, groupUsagers, OPEN_BUCKETS, orderByGroup, PAGE_SIZE,
  pageCount, paginate, PARTAGE_LABELS, PARTAGE_OPTIONS, partageState, partageStatement,
  quartierOptions, removeFilterChip, sortUsagers, STATUS_OPTIONS, toggleMultiFilter,
  toggleSingleFilter, toggleSort, TOTAL_BUCKETS, TYPE_OPTIONS, usagerCsvColumns,
  usagersExportFilename,
  type GroupKey, type MultiFilterKey, type PartageState, type SingleFilterKey, type SortKey,
  type SortState, type UsagerFilters, type UsagerRow,
} from "./usagers";

const DENSITY_STORAGE_KEY = "iris.usagers.liste.dense";

function readDensity(): boolean {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const TYPE_ICONS: Record<string, typeof User> = {
  personne: User,
  entreprise: Building2,
  association: HeartHandshake,
  administration: Landmark,
};

const COLUMNS: { key: SortKey | null; title: string; className: string; align?: "right" }[] = [
  { key: "name", title: "Nom", className: "" },
  { key: "type", title: "Type", className: "w-[136px]" },
  { key: "email", title: "Courriel", className: "w-[22%]" },
  { key: "phone", title: "Téléphone", className: "w-[128px]" },
  { key: "city", title: "Commune", className: "w-[140px]" },
  { key: "quartier", title: "Quartier", className: "w-[150px]" },
  { key: "partage", title: "Partage", className: "w-[136px]" },
  { key: "total", title: "Demandes", className: "w-[96px]", align: "right" },
  { key: "open", title: "En cours", className: "w-[88px]", align: "right" },
];

/** Pastille à la couleur libre du référentiel (texte adapté) — même rendu que la fiche. */
function QuartierPill({ contact }: { contact: SocleContact }) {
  const quartier = contact.quartier;
  const color = quartier?.color ?? null;
  if (!quartier?.name) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
        color === null && "border border-border",
        color !== null && (isDarkColor(color) ? "text-primary-foreground" : "text-foreground"),
      )}
      style={color === null ? undefined : { backgroundColor: color }}
    >
      {quartier.name}
    </span>
  );
}

const PARTAGE_TONES: Record<PartageState, string> = {
  accepte: "bg-primary/10 text-primary",
  refuse: "bg-destructive/10 text-destructive",
  jamais_demande: "bg-muted text-muted-foreground",
};

/** Consentement au partage : accepté, refusé — ou jamais demandé, qui n'est PAS un refus. */
function PartagePill({ contact }: { contact: SocleContact }) {
  const state = partageState(contact);
  const at = contact.consent_partage_at;
  const title = at
    ? `${PARTAGE_LABELS[state]} le ${new Date(at).toLocaleDateString("fr-FR")}`
    : "Question jamais posée à cet usager";
  return (
    <span
      title={title}
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", PARTAGE_TONES[state])}
    >
      {PARTAGE_LABELS[state]}
    </span>
  );
}

function UsagerTableRow({ row, dense }: { row: UsagerRow; dense: boolean }) {
  const navigate = useNavigate();
  const c = row.contact;
  const href = `/usagers/${c.id}`;
  const Icon = TYPE_ICONS[c.contact_type ?? ""] ?? User;
  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-border/70 bg-card transition-colors hover:bg-muted/50",
        dense ? "h-9" : "h-12",
      )}
      onClick={() => navigate(href)}
    >
      <td className="max-w-0 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={href}
            className="truncate rounded text-[13.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={(e) => e.stopPropagation()}
          >
            {contactName(c)}
          </Link>
          {isInactive(c.status) ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-px text-[11px] font-semibold text-muted-foreground">
              {contactStatusLabel(c.status)}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3">
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{contactTypeLabel(c.contact_type)}</span>
        </span>
      </td>
      <td className="max-w-0 truncate px-3 text-[13px] text-muted-foreground">{c.email ?? "—"}</td>
      <td className="px-3 text-[13px] tabular-nums text-muted-foreground">{contactPhone(c) || "—"}</td>
      <td className="max-w-0 truncate px-3 text-[13px] text-muted-foreground">{c.city ?? "—"}</td>
      <td className="max-w-0 px-3"><QuartierPill contact={c} /></td>
      <td className="px-3"><PartagePill contact={c} /></td>
      <td className="px-3 text-right text-[13px] font-medium tabular-nums">{row.total}</td>
      <td className="pr-4 text-right tabular-nums">
        {row.open > 0 ? (
          <span className="inline-flex min-w-6 justify-center rounded-full bg-secondary px-2 py-0.5 text-[12px] font-bold text-secondary-foreground">
            {row.open}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">0</span>
        )}
      </td>
    </tr>
  );
}

export function UsagersListPage() {
  useFullBleedLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const canBrowse = useCanBrowseUsagers();
  const searchId = React.useId();

  const [filters, setFilters] = React.useState<UsagerFilters>(EMPTY_FILTERS);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = React.useState(1);
  const [groupKey, setGroupKey] = React.useState<GroupKey | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [dense, setDense] = React.useState(readDensity);
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [exportNote, setExportNote] = React.useState<{ text: string; error: boolean } | null>(null);

  // `status` est le SEUL filtre servi par le Socle : il change ce qui est chargé.
  const usagersQuery = useUsagers(orgId, filters.status, canBrowse);
  const countsQuery = useContactRequestCounts(orgId);

  const rows = React.useMemo(
    () => buildRows(usagersQuery.data?.contacts ?? [], countsQuery.data ?? new Map()),
    [usagersQuery.data, countsQuery.data],
  );
  const quartiers = React.useMemo(() => quartierOptions(rows), [rows]);
  // Filtrer, trier, puis regrouper TOUTE la sélection — la pagination vient après.
  const selection = React.useMemo(
    () => orderByGroup(sortUsagers(filterUsagers(rows, filters), sort), groupKey),
    [rows, filters, sort, groupKey],
  );

  if (!current) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Aucun tenant accessible — contactez votre administrateur.
      </p>
    );
  }

  if (!canBrowse) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <h1 className="text-[17px] font-bold tracking-tight">Usagers</h1>
        <p className="text-sm text-muted-foreground">
          Consulter le référentiel des usagers exige un droit de création de demande sur au
          moins une démarche de ce tenant. Rapprochez-vous de votre administrateur.
        </p>
      </div>
    );
  }

  const update = (next: (f: UsagerFilters) => UsagerFilters) => {
    setFilters(next);
    setPage(1);
  };
  const toggleMulti = (key: MultiFilterKey) => (value: string) => update((f) => toggleMultiFilter(f, key, value));
  const toggleSingle = (key: SingleFilterKey) => (value: string) => update((f) => toggleSingleFilter(f, key, value));
  const resetFilters = () => update(() => EMPTY_FILTERS);
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

  function exportCsv() {
    setExportNote(null);
    try {
      downloadCsv(
        buildCsv(selection, usagerCsvColumns()),
        usagersExportFilename(current!.organizationName, new Date()),
      );
      setExportNote({
        text: `${selection.length} usager${selection.length > 1 ? "s" : ""} exporté${selection.length > 1 ? "s" : ""}.`,
        error: false,
      });
    } catch (err) {
      setExportNote({ text: err instanceof Error ? err.message : "Export impossible.", error: true });
    }
  }

  const loading = usagersQuery.isLoading || countsQuery.isLoading;
  const error = usagersQuery.error ?? countsQuery.error;
  const truncated = usagersQuery.data?.truncated ?? false;
  const total = selection.length;
  const pages = pageCount(total);
  const safePage = Math.min(page, pages);
  const visible = paginate(selection, safePage);
  const groups = groupUsagers(visible, selection, groupKey);
  const chips = filterChips(filters, (id) => quartiers.find((q) => q.value === id)?.label);
  const nFilters = activeFilterCount(filters);
  const nResults = `${total} usager${total > 1 ? "s" : ""}`;
  const first = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const last = Math.min(safePage * PAGE_SIZE, total);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Barre collante : titre, compteur, actions — 56 px. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          <h1 className="whitespace-nowrap text-[17px] font-bold tracking-tight">Usagers</h1>
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
                <span className="hidden max-w-[160px] truncate lg:inline">
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
            ariaLabel="Filtrer les usagers"
            menuClassName="w-[360px] gap-0 p-0"
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
              <span className="text-[13.5px] font-bold">Filtrer les usagers</span>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Fermer</span>
              </button>
            </div>
            <div className="flex max-h-[460px] flex-col gap-3.5 overflow-auto px-3.5 pb-3">
              <div className="flex flex-col">
                <label htmlFor={searchId} className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">
                  Recherche
                </label>
                <div className="relative flex h-9 items-center">
                  <Search className="pointer-events-none absolute left-3 size-[15px] text-muted-foreground" aria-hidden="true" />
                  <input
                    id={searchId}
                    type="search"
                    placeholder="Nom, courriel, téléphone, commune…"
                    autoFocus
                    value={filters.search}
                    onChange={(e) => { const search = e.target.value; update((f) => ({ ...f, search })); }}
                    // Échap ferme le popover ; sans ce preventDefault, Chrome
                    // viderait AUSSI le champ (motif de la liste des demandes).
                    onKeyDown={(e) => { if (e.key === "Escape") e.preventDefault(); }}
                    className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-[13.5px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
              </div>
              <ChipGroup
                label="Partage d'informations"
                hint={`« ${partageStatement(current.organizationName)} »`}
                options={PARTAGE_OPTIONS}
                selected={filters.partage}
                onToggle={toggleMulti("partage")}
              />
              <ChipGroup label="Type" options={TYPE_OPTIONS} selected={filters.type} onToggle={toggleMulti("type")} />
              <ChipGroup
                label="Fiches"
                single
                options={STATUS_OPTIONS}
                selected={[filters.status]}
                onToggle={(value) => update((f) => ({ ...f, status: value as UsagerFilters["status"] }))}
              />
              <ChipGroup label="Demandes" single options={TOTAL_BUCKETS} selected={[filters.total]} onToggle={toggleSingle("total")} />
              <ChipGroup label="Demandes en cours" single options={OPEN_BUCKETS} selected={[filters.open]} onToggle={toggleSingle("open")} />
              <CheckList label="Quartier" options={quartiers} selected={filters.quartier} onToggle={toggleMulti("quartier")} />
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
          <IconPill
            label="Exporter en CSV"
            onClick={exportCsv}
            disabled={loading || total === 0}
            className="disabled:opacity-50"
          >
            <Download className="size-[15px]" aria-hidden="true" />
          </IconPill>
        </div>
      </header>

      {chips.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-5 py-2" aria-label="Filtres actifs">
          <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">Filtres actifs</span>
          {chips.map((c) => (
            <button
              key={`${c.key}:${c.value}`}
              type="button"
              onClick={() => update((f) => removeFilterChip(f, c))}
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

      {truncated ? (
        <div role="status" className="shrink-0 border-b border-border bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
          Référentiel volumineux : seules les {USAGERS_MAX} premières fiches sont chargées —
          affinez la recherche pour atteindre les autres.
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
                  key={c.title}
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
            {loading ? (
              <tr><td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-muted-foreground">Chargement du référentiel…</td></tr>
            ) : error ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-destructive">
                  {error instanceof Error ? error.message : "Référentiel indisponible."}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-[13.5px] text-muted-foreground">
                  {nFilters > 0 ? "Aucun usager ne correspond aux filtres actifs." : "Aucun usager."}
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
                            {g.total} usager{g.total > 1 ? "s" : ""}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isCollapsed ? null : g.items.map((row) => <UsagerTableRow key={row.contact.id} row={row} dense={dense} />)}
                  </React.Fragment>
                );
              })
            ) : (
              visible.map((row) => <UsagerTableRow key={row.contact.id} row={row} dense={dense} />)
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-5 text-[12.5px] text-muted-foreground">
        <span className="truncate tabular-nums">
          {total === 0 ? "Aucun usager" : `${first}–${last} sur ${nResults}`}
          {" — compteurs de demandes limités à votre périmètre"}
        </span>
        <ListPagination page={safePage} pageCount={pages} pages={pageWindow(safePage, pages)} onPage={setPage} />
      </footer>
    </div>
  );
}
