import * as React from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useTenant } from "@/features/tenant/TenantProvider";
import {
  useSocleOrganizationsCatalog,
  useSocleProceduresCatalog,
} from "@/features/socle/useSocleCatalog";
import { StatusBadge } from "./StatusBadge";
import { canWrite, PRIORITY_LABELS, STATUS_LABELS } from "./statuts";
import {
  EMPTY_FILTERS, PAGE_SIZE, useRequestFacets, useRequestsList, type RequestFilters,
} from "./useRequests";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function RequestsListPage() {
  const { current } = useTenant();
  const [filters, setFilters] = React.useState<RequestFilters>(EMPTY_FILTERS);
  const [page, setPage] = React.useState(1);

  const orgId = current?.organizationId ?? "";
  const list = useRequestsList(orgId, filters, page);
  const facets = useRequestFacets(orgId);
  const orgCatalog = useSocleOrganizationsCatalog(orgId);
  const procCatalog = useSocleProceduresCatalog(orgId);
  // Catalogues Socle synchronisés quand disponibles, facettes observées sinon.
  const destinataireOptions =
    (orgCatalog.data?.length ?? 0) > 0 ? orgCatalog.data! : (facets.data?.destinataires ?? []);
  const procedureOptions =
    (procCatalog.data?.length ?? 0) > 0 ? procCatalog.data! : (facets.data?.procedures ?? []);

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

  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Demandes</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        {canWrite(current.role) ? (
          <Button asChild>
            <Link to="/demandes/nouvelle">
              <Plus />
              Nouvelle demande
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Filtres">
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

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-iris-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Référence</th>
              <th className="px-4 py-3">Objet</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Destinataire</th>
              <th className="px-4 py-3">Démarche</th>
              <th className="px-4 py-3">Priorité</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Reçue le</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Aucune demande.</td></tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/demandes/${r.id}`} className="text-primary hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3">{r.subject}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">{r.socle_organization_label ?? "—"}</td>
                  <td className="px-4 py-3">{r.socle_procedure_label ?? "Demande libre"}</td>
                  <td className="px-4 py-3">{PRIORITY_LABELS[r.priority] ?? r.priority}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{r.source}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(r.received_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page} sur {pageCount}</span>
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
