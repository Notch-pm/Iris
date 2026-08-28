// Liste des demandes du tenant — filtres, tri serveur par colonne, « Grouper
// par » (page courante, pré-triée par la clé de groupe côté serveur), export
// CSV de toute la sélection filtrée (motif des listes Clara). Le RLS borne ce
// que l'utilisateur voit ; l'UI ne fait que présenter.

import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Columns3, Download, Map, Plus } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { ariaSort, SortableHeader } from "@/components/ui/sortable-header";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  useSocleOrganizationsCatalog,
  useSocleProceduresCatalog,
} from "@/features/socle/useSocleCatalog";
import { canCreateProcedure, canViewProcedure } from "@/features/rights/rights";
import { buildCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { PRIORITY_LABELS, STATUS_LABELS } from "./statuts";
import {
  DEFAULT_SORT, EXPORT_MAX_ROWS, exportFilename, GROUP_KEYS, GROUP_LABELS, groupRows, isGroupKey,
  requestCsvColumns, toggleSort, type GroupKey, type SortKey, type SortState,
} from "./listing";
import {
  EMPTY_FILTERS, fetchRequestsForExport, PAGE_SIZE, useRequestFacets, useRequestsList,
  useTenantMembers, type RequestFilters, type RequestListItem,
} from "./useRequests";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const COLUMNS: { key: SortKey | null; title: string; align?: "right" }[] = [
  { key: "reference", title: "Référence" },
  { key: "subject", title: "Objet" },
  { key: "status", title: "Statut" },
  { key: "destinataire", title: "Destinataire" },
  { key: "procedure", title: "Démarche" },
  { key: null, title: "Priorité" },
  { key: "source", title: "Source" },
  { key: "received_at", title: "Reçue le" },
];

function RequestRow({ r }: { r: RequestListItem }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/50">
      <td className="px-4 py-3 font-medium">
        <Link to={`/demandes/${r.id}`} className="text-primary hover:underline">
          {r.reference}
        </Link>
      </td>
      <td className="max-w-[280px] truncate px-4 py-3 xl:max-w-[560px]">{r.subject}</td>
      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
      <td className="px-4 py-3">{r.socle_organization_label ?? "—"}</td>
      <td className="px-4 py-3">{r.socle_procedure_label ?? "Demande libre"}</td>
      <td className="px-4 py-3">{PRIORITY_LABELS[r.priority] ?? r.priority}</td>
      <td className="px-4 py-3"><Badge variant="outline">{r.source}</Badge></td>
      <td className="px-4 py-3 text-muted-foreground">{formatDate(r.received_at)}</td>
    </tr>
  );
}

export function RequestsListPage() {
  useWideLayout();
  const { current, rights } = useTenant();
  // Filtre initial depuis l'URL (fil d'Ariane de la fiche : `/demandes?status=…`).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = React.useState<RequestFilters>(() => {
    const status = searchParams.get("status") ?? "";
    return { ...EMPTY_FILTERS, status: status in STATUS_LABELS ? status : "" };
  });
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [groupKey, setGroupKey] = React.useState<GroupKey | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [exporting, setExporting] = React.useState(false);
  const [exportNote, setExportNote] = React.useState<{ text: string; error: boolean } | null>(null);

  const orgId = current?.organizationId ?? "";
  const list = useRequestsList(orgId, filters, page, sort, groupKey);
  const facets = useRequestFacets(orgId);
  const members = useTenantMembers(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const procCatalog = useSocleProceduresCatalog(orgId);
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
  // « Nouvelle demande » : au moins une démarche du cache créable (RM-58) — reflet
  // de confort, le serveur (create-request-from-procedure) revalide le couple.
  const canCreate =
    rights.is_platform_admin ||
    (procCatalog.data ?? []).some((o) => canCreateProcedure(rights, o.value));

  if (!current) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun tenant accessible — contactez votre administrateur.
      </p>
    );
  }

  const setFilter = (key: keyof RequestFilters) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  // Trier ou regrouper depuis la page 7 laisserait une page vide : retour en page 1.
  const onSort = (key: SortKey) => { setSort((s) => toggleSort(s, key)); setPage(1); };
  const onGroup = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setGroupKey(isGroupKey(v) ? v : null);
    setCollapsed(new Set());
    setPage(1);
  };
  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const memberList = members.data ?? [];
  const nameOf = (userId: string | null) =>
    memberList.find((m) => m.userId === userId)?.displayName ?? "";

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Demandes</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/demandes/tableau">
              <Columns3 />
              Tableau
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/carte">
              <Map />
              Carte
            </Link>
          </Button>
          {canCreate ? (
            <Button asChild>
              <Link to="/demandes/nouvelle">
                <Plus />
                Nouvelle demande
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:max-w-[1240px] md:grid-cols-5" aria-label="Filtres">
        <Select aria-label="Filtrer par statut" value={filters.status} onChange={setFilter("status")}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par destinataire" value={filters.destinataire} onChange={setFilter("destinataire")}>
          <option value="">Tous les destinataires</option>
          {destinataireOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par démarche" value={filters.procedure} onChange={setFilter("procedure")}>
          <option value="">Toutes les démarches</option>
          {procedureOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par priorité" value={filters.priority} onChange={setFilter("priority")}>
          <option value="">Toutes les priorités</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select aria-label="Filtrer par source" value={filters.source} onChange={setFilter("source")}>
          <option value="">Toutes les sources</option>
          {(facets.data?.sources ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Grouper par</span>
          <Select aria-label="Grouper par" className="h-9 w-[180px]" value={groupKey ?? ""} onChange={onGroup}>
            <option value="">Aucun</option>
            {GROUP_KEYS.map((k) => (
              <option key={k} value={k}>{GROUP_LABELS[k]}</option>
            ))}
          </Select>
        </label>
        <div className="flex items-center gap-3">
          {exportNote ? (
            <span role={exportNote.error ? "alert" : "status"}
              className={cn("text-xs", exportNote.error ? "text-destructive" : "text-muted-foreground")}>
              {exportNote.text}
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}
            disabled={exporting || total === 0} aria-busy={exporting}>
            <Download className="size-4" aria-hidden="true" />
            {exporting ? "Export en cours…" : "Exporter en CSV"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-iris-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {COLUMNS.map((c) => (
                <th key={c.title} className="px-4 py-2"
                  aria-sort={c.key ? ariaSort(sort.key === c.key ? sort.dir : false) : undefined}>
                  {c.key ? (
                    <SortableHeader title={c.title} direction={sort.key === c.key ? sort.dir : false}
                      onToggle={() => onSort(c.key!)} />
                  ) : (
                    <span className="inline-flex h-8 items-center">{c.title}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">Aucune demande.</td></tr>
            ) : groupKey ? (
              groups.map((g) => {
                const isCollapsed = collapsed.has(g.id);
                return (
                  <React.Fragment key={g.id}>
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={COLUMNS.length} className="px-3 py-2">
                        <button type="button" onClick={() => toggleGroup(g.id)} aria-expanded={!isCollapsed}
                          className="flex w-full items-center gap-2 text-left">
                          {isCollapsed
                            ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                            : <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />}
                          <span className="text-sm font-semibold">{g.label}</span>
                          <Badge variant="secondary">{g.items.length}</Badge>
                        </button>
                      </td>
                    </tr>
                    {isCollapsed ? null : g.items.map((r) => <RequestRow key={r.id} r={r} />)}
                  </React.Fragment>
                );
              })
            ) : (
              items.map((r) => <RequestRow key={r.id} r={r} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} sur {pageCount}
          {groupKey ? " — regroupement sur la page affichée" : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Précédente
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Suivante
          </Button>
        </div>
      </div>

    </div>
  );
}
