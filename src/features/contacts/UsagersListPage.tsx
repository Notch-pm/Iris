// Liste des usagers — annuaire du référentiel Socle vu depuis Iris, au motif de
// la liste des contacts de Clara et de la liste des demandes (recherche par
// mot-clé, filtres, tri par colonne, export CSV de toute la sélection filtrée).
//
// Ce que Clara a et qu'Iris n'a pas : les filtres du fichier domiciliaire
// (anniversaires, mariages) — hors sujet ici. Ce qu'Iris a en plus : le nombre
// de demandes et de demandes ENCORE OUVERTES par usager, seules colonnes qui
// soient des données Iris — bornées par le RLS au périmètre du lecteur.
//
// Deux sources (Socle + Iris) qu'aucun serveur ne joint : tri, filtres et
// pagination sont donc CLIENT, sur l'ensemble rapatrié (`usagers.ts`, pur).

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Download, HeartHandshake, Landmark, Search, User } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ariaSort, SortableHeader } from "@/components/ui/sortable-header";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  contactName, contactStatusLabel, contactTypeLabel, isDarkColor, isInactive,
} from "./usager";
import type { SocleContact } from "./rapprochement";
import { useCanBrowseUsagers, useContactRequestCounts, useUsagers, USAGERS_MAX } from "./useUsagers";
import {
  buildRows, contactPhone, DEFAULT_SORT, EMPTY_FILTERS, filterUsagers, OPEN_BUCKETS, PAGE_SIZE,
  pageCount, paginate, quartierOptions, sortUsagers, STATUS_OPTIONS, toggleSort, TOTAL_BUCKETS,
  TYPE_OPTIONS, usagerCsvColumns, usagersExportFilename,
  type SortKey, type SortState, type UsagerFilters, type UsagerRow, type UsagerStatusFilter,
} from "./usagers";

const TYPE_ICONS: Record<string, typeof User> = {
  personne: User,
  entreprise: Building2,
  association: HeartHandshake,
  administration: Landmark,
};

const COLUMNS: { key: SortKey | null; title: string; align?: "right" }[] = [
  { key: "name", title: "Nom" },
  { key: "type", title: "Type" },
  { key: "email", title: "Courriel" },
  { key: "phone", title: "Téléphone" },
  { key: "city", title: "Commune" },
  { key: "quartier", title: "Quartier" },
  { key: "total", title: "Demandes", align: "right" },
  { key: "open", title: "En cours", align: "right" },
];

/** Pastille à la couleur libre du référentiel (texte adapté) — même rendu que la fiche. */
function QuartierPill({ contact }: { contact: SocleContact }) {
  const quartier = contact.quartier;
  const color = quartier?.color ?? null;
  if (!quartier?.name) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
        color === null && "border border-border",
        color !== null && (isDarkColor(color) ? "text-primary-foreground" : "text-foreground"),
      )}
      style={color === null ? undefined : { backgroundColor: color }}
    >
      {quartier.name}
    </span>
  );
}

function UsagerTableRow({ row, showStatus }: { row: UsagerRow; showStatus: boolean }) {
  const navigate = useNavigate();
  const c = row.contact;
  const Icon = TYPE_ICONS[c.contact_type ?? ""] ?? User;
  return (
    <tr
      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/50"
      onClick={() => navigate(`/usagers/${c.id}`)}
    >
      <td className="max-w-[260px] truncate px-4 py-3 font-medium xl:max-w-[420px]">
        <Link
          to={`/usagers/${c.id}`}
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {contactName(c)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          <span className="text-xs">{contactTypeLabel(c.contact_type)}</span>
        </span>
      </td>
      <td className="max-w-[220px] truncate px-4 py-3 xl:max-w-[360px]">{c.email ?? "—"}</td>
      <td className="px-4 py-3">{contactPhone(c) || "—"}</td>
      <td className="px-4 py-3">{c.city ?? "—"}</td>
      <td className="px-4 py-3"><QuartierPill contact={c} /></td>
      <td className="px-4 py-3 text-right tabular-nums">{row.total}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {row.open > 0 ? <Badge variant="secondary">{row.open}</Badge> : <span className="text-muted-foreground">0</span>}
      </td>
      {showStatus ? (
        <td className="px-4 py-3">
          {isInactive(c.status)
            ? <Badge variant="outline">{contactStatusLabel(c.status)}</Badge>
            : <Badge variant="muted">Actif</Badge>}
        </td>
      ) : null}
    </tr>
  );
}

export function UsagersListPage() {
  useWideLayout();
  const { current } = useTenant();
  const orgId = current?.organizationId ?? "";
  const canBrowse = useCanBrowseUsagers();

  const [filters, setFilters] = React.useState<UsagerFilters>(EMPTY_FILTERS);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = React.useState(1);
  const [exportNote, setExportNote] = React.useState<{ text: string; error: boolean } | null>(null);

  // `status` est le SEUL filtre servi par le Socle : il change ce qui est chargé.
  const usagersQuery = useUsagers(orgId, filters.status, canBrowse);
  const countsQuery = useContactRequestCounts(orgId);

  const rows = React.useMemo(
    () => buildRows(usagersQuery.data?.contacts ?? [], countsQuery.data ?? new Map()),
    [usagersQuery.data, countsQuery.data],
  );
  const quartiers = React.useMemo(() => quartierOptions(rows), [rows]);
  const selection = React.useMemo(
    () => sortUsagers(filterUsagers(rows, filters), sort),
    [rows, filters, sort],
  );

  const setFilter = <K extends keyof UsagerFilters>(key: K) =>
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setFilters((f) => ({ ...f, [key]: e.target.value as UsagerFilters[K] }));
      setPage(1);
    };
  const onSort = (key: SortKey) => { setSort((s) => toggleSort(s, key)); setPage(1); };

  if (!current) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun tenant accessible — contactez votre administrateur.
      </p>
    );
  }

  if (!canBrowse) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Usagers</h1>
        <p className="text-sm text-muted-foreground">
          Consulter le référentiel des usagers exige un droit de création de demande sur au
          moins une démarche de ce tenant. Rapprochez-vous de votre administrateur.
        </p>
      </div>
    );
  }

  const loading = usagersQuery.isLoading || countsQuery.isLoading;
  const error = usagersQuery.error ?? countsQuery.error;
  const truncated = usagersQuery.data?.truncated ?? false;
  const pages = pageCount(selection.length);
  const visible = paginate(selection, page);
  const showStatus = filters.status !== "active";
  const columnCount = COLUMNS.length + (showStatus ? 1 : 0);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Usagers</h1>
          <Badge variant="muted">{selection.length}</Badge>
        </div>
      </div>

      <p className="max-w-3xl text-sm text-muted-foreground">
        Référentiel d'usagers partagé avec les autres applications de la collectivité. Les
        compteurs de demandes ne portent que sur votre périmètre.
      </p>

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Rechercher un usager"
          placeholder="Nom, courriel, téléphone, commune…"
          className="h-9 pl-9"
          value={filters.search}
          onChange={(e) => { setFilters((f) => ({ ...f, search: e.target.value })); setPage(1); }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 md:max-w-[1240px] md:grid-cols-5" aria-label="Filtres">
        <Select aria-label="Filtrer par type" value={filters.type} onChange={setFilter("type")}>
          <option value="">Tous les types</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select
          aria-label="Filtrer par statut de fiche"
          value={filters.status}
          onChange={(e) => {
            setFilters((f) => ({ ...f, status: e.target.value as UsagerStatusFilter }));
            setPage(1);
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par quartier" value={filters.quartier} onChange={setFilter("quartier")}>
          <option value="">Tous les quartiers</option>
          {quartiers.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par nombre de demandes" value={filters.total} onChange={setFilter("total")}>
          <option value="">Demandes : toutes</option>
          {TOTAL_BUCKETS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par nombre de demandes en cours" value={filters.open} onChange={setFilter("open")}>
          <option value="">En cours : toutes</option>
          {OPEN_BUCKETS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {exportNote ? (
          <span
            role={exportNote.error ? "alert" : "status"}
            className={cn("text-xs", exportNote.error ? "text-destructive" : "text-muted-foreground")}
          >
            {exportNote.text}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={loading || selection.length === 0}
        >
          <Download className="size-4" aria-hidden="true" />
          Exporter en CSV
        </Button>
      </div>

      {truncated ? (
        <p role="status" className="text-xs text-muted-foreground">
          Référentiel volumineux : seules les {USAGERS_MAX} premières fiches sont chargées —
          affinez la recherche pour atteindre les autres.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-iris-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {COLUMNS.map((c) => (
                <th
                  key={c.title}
                  className={cn("whitespace-nowrap px-4 py-2", c.align === "right" && "text-right")}
                  aria-sort={c.key ? ariaSort(sort.key === c.key ? sort.dir : false) : undefined}
                >
                  {c.key ? (
                    <SortableHeader
                      title={c.title}
                      direction={sort.key === c.key ? sort.dir : false}
                      onToggle={() => onSort(c.key!)}
                    />
                  ) : (
                    <span className="inline-flex h-8 items-center">{c.title}</span>
                  )}
                </th>
              ))}
              {showStatus ? <th className="px-4 py-2">Statut</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                  Chargement du référentiel…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-destructive">
                  {error instanceof Error ? error.message : "Référentiel indisponible."}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                  Aucun usager.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <UsagerTableRow key={row.contact.id} row={row} showStatus={showStatus} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {Math.min(page, pages)} sur {pages}
          {selection.length > PAGE_SIZE ? ` — ${selection.length} fiches` : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Précédente
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Suivante
          </Button>
        </div>
      </div>
    </div>
  );
}
