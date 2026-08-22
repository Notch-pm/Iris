import * as React from "react";
import { Building2, ChevronRight, Landmark, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { buildSocleOrgTree, collectIds, type SocleOrgNode } from "./socleOrgTree";
import {
  useAllTenants, useLastSyncRun, useTenantTreeRows, useTriggerSocleSync, type TenantRow,
} from "./useSuperAdmin";

const SYNC_COUNTER_LABELS: [string, string][] = [
  ["tenants", "tenants"],
  ["organizations", "organisations"],
  ["procedures", "démarches"],
  ["organizations_obsoleted", "organisations obsolètes"],
  ["procedures_obsoleted", "démarches obsolètes"],
  ["requests_scope_recalculees", "demandes recalculées"],
];

/** Résumé lisible des compteurs renvoyés par la sync (clés inconnues ignorées). */
function syncSummary(counters: Record<string, unknown>): string {
  const parts = SYNC_COUNTER_LABELS
    .filter(([key]) => typeof counters[key] === "number")
    .map(([key, label]) => `${counters[key] as number} ${label}`);
  return parts.length > 0 ? parts.join(" · ") : "terminée";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Réplique de l'ergonomie Clara (SocleOrganizationTree) : arbre tout déplié,
// chevrons, badge Obsolète. La hiérarchie se gère dans le SOCLE — consultation
// uniquement ici ; Iris y attachera plus tard sa configuration par organisation.
function TreeRow({
  node, depth, expanded, onToggle,
}: {
  node: SocleOrgNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.socle_id);
  const isObsolete = node.status === "obsolete" || node.obsoleted_at !== null;
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border px-2 py-2",
          isObsolete && "opacity-60",
        )}
        style={{ marginLeft: depth * 24 }}
      >
        <button
          type="button"
          aria-label={hasChildren ? (isOpen ? "Réduire" : "Développer") : undefined}
          onClick={() => hasChildren && onToggle(node.socle_id)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground",
            hasChildren ? "hover:bg-muted" : "invisible",
          )}
        >
          <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
        </button>
        <Building2 className="size-5 shrink-0 text-muted-foreground" />
        <span className={cn("truncate font-medium", isObsolete && "line-through")}>{node.name}</span>
        {isObsolete ? <Badge variant="secondary" className="shrink-0">Obsolète</Badge> : null}
      </div>
      {hasChildren && isOpen ? (
        <ul className="mt-1 flex flex-col gap-1">
          {node.children.map((child) => (
            <TreeRow key={child.socle_id} node={child} depth={depth + 1}
              expanded={expanded} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TenantCard({ tenant }: { tenant: TenantRow }) {
  const rows = useTenantTreeRows(tenant.id);
  const nodes = React.useMemo(() => buildSocleOrgTree(rows.data ?? []), [rows.data]);
  // Tout déplié par défaut : la hiérarchie complète est visible d'un coup d'œil.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    setExpanded(new Set(collectIds(nodes)));
  }, [nodes]);
  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Landmark className="size-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{tenant.name}</CardTitle>
            <CardDescription>
              Hiérarchie synchronisée depuis le Socle — consultation uniquement, la gestion se
              fait dans le Socle.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : nodes.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Building2 className="size-8" />
            <p className="text-sm">
              Aucune organisation synchronisée — lancez une synchronisation du référentiel.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {nodes.map((node) => (
              <TreeRow key={node.socle_id} node={node} depth={0}
                expanded={expanded} onToggle={toggle} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SuperAdminOrganisationsPage() {
  const tenants = useAllTenants();
  const lastSync = useLastSyncRun();
  const sync = useTriggerSocleSync();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organisations</h1>
          <p className="text-sm text-muted-foreground">
            Un tenant Iris par organisation racine Socle.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            aria-busy={sync.isPending}
          >
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} aria-hidden="true" />
            {sync.isPending ? "Synchronisation…" : "Synchroniser maintenant"}
          </Button>
          {lastSync.data ? (
            <p className="text-xs text-muted-foreground">
              Dernière synchronisation :{" "}
              {lastSync.data.finished_at ? formatDateTime(lastSync.data.finished_at) : "en cours"} —{" "}
              {lastSync.data.status === "success" ? (
                "réussie"
              ) : lastSync.data.status === "error" ? (
                <span className="text-destructive">en échec</span>
              ) : (
                "en cours"
              )}
            </p>
          ) : null}
        </div>
      </div>

      {sync.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {sync.error instanceof Error ? sync.error.message : "Synchronisation en échec."}
        </p>
      ) : sync.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          Synchronisation réussie — {syncSummary(sync.data.counters)}.
        </p>
      ) : null}

      {tenants.isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : (tenants.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun tenant provisionné.</p>
      ) : (
        (tenants.data ?? []).map((t) => <TenantCard key={t.id} tenant={t} />)
      )}
    </div>
  );
}
