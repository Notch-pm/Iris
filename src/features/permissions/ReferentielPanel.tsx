// Paramètres › Référentiel Socle — état du miroir du tenant (organisations,
// démarches, dernière synchronisation). La mutation de synchro est celle de la
// page Paramètres (même bouton qu'en tête d'accueil, même état « en cours »).
// La synchro lancée ici ne porte QUE sur ce tenant : le périmètre est dérivé de
// l'appelant côté serveur (sync-socle-referentiel).

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { syncSummary, type SocleSyncMutation } from "@/features/socle/useSocleSync";
import { useReferentielStatus } from "./usePermissions";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface ReferentielPanelProps {
  orgId: string;
  sync: SocleSyncMutation;
  onOpenCoverage: () => void;
}

export function ReferentielPanel({ orgId, sync, onOpenCoverage }: ReferentielPanelProps) {
  const status = useReferentielStatus(orgId);
  const s = status.data;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Référentiel du tenant</h2>
            <p className="max-w-[640px] text-sm text-muted-foreground">
              Les organisations et les démarches viennent du Référentiel et sont synchronisées chaque nuit.
              Lancez une synchronisation après une modification dans le Référentiel (nouvelle démarche,
              service créé ou déplacé) pour la voir ici sans attendre. Une démarche ajoutée reste
              invisible tant qu'aucun profil ne la couvre : vérifiez ensuite la{" "}
              <button type="button" onClick={onOpenCoverage} className="font-semibold text-primary hover:underline">
                couverture
              </button>.
            </p>
          </div>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} aria-busy={sync.isPending}>
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} aria-hidden="true" />
            {sync.isPending ? "Synchronisation…" : "Synchroniser maintenant"}
          </Button>
        </div>

        {sync.isError ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {sync.error instanceof Error ? sync.error.message : "Synchronisation en échec."}
          </p>
        ) : sync.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Synchronisation réussie — {syncSummary(sync.data.counters)}.
          </p>
        ) : null}

        {status.isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        ) : s ? (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Organisations actives</dt>
              <dd className="text-xl font-semibold">{s.activeOrganizations}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Démarches actives</dt>
              <dd className="text-xl font-semibold">{s.activeProcedures}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Obsolètes (org. / démarches)</dt>
              <dd className="text-xl font-semibold">{s.obsoleteOrganizations} / {s.obsoleteProcedures}</dd>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">Dernière synchronisation</dt>
              <dd className="text-sm font-semibold">{s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : "jamais"}</dd>
            </div>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
