// Synchronisation manuelle du référentiel Socle (motif Clara « Synchroniser
// maintenant ») : appel SYNCHRONE de l'edge function sync-socle-referentiel
// avec le JWT de l'appelant — la réponse contient les compteurs.
//   - sans organisation : tous les tenants (admin plateforme, zone superadmin) ;
//   - avec organisation : ce seul tenant (administrateur du tenant, Paramètres).
// Le périmètre est REVÉRIFIÉ côté serveur (403/404 sinon) ; l'UI ne fait que
// proposer. Miroirs, caches de démarches et rapports dépendants sont invalidés.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdge } from "@/lib/edge";

export interface SocleSyncResult {
  status: "success";
  counters: Record<string, unknown>;
}

const INVALIDATED_PREFIXES = [
  "sa-last-sync", "sa-tenants", "sa-tenant-tree",
  "socle-organizations", "socle-procedure-rows", "socle-procedures",
  "permission-socle-orgs", "permission-procedures-all", "permission-referentiel",
  "permission-coverage", "request-facets",
];

export function useTriggerSocleSync(organizationId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<SocleSyncResult> =>
      invokeEdge<SocleSyncResult>(
        "sync-socle-referentiel",
        organizationId ? { organization_id: organizationId } : {},
      ),
    onSettled: () => {
      for (const key of INVALIDATED_PREFIXES) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** La mutation partagée entre l'en-tête des Paramètres et la section Référentiel. */
export type SocleSyncMutation = ReturnType<typeof useTriggerSocleSync>;

const COUNTER_LABELS: [string, string][] = [
  ["tenants", "tenant(s)"],
  ["organizations", "organisation(s)"],
  ["procedures", "démarche(s)"],
  ["organizations_obsoleted", "organisation(s) obsolète(s)"],
  ["procedures_obsoleted", "démarche(s) obsolète(s)"],
  ["requests_scope_recalculees", "demande(s) recalculée(s)"],
];

/** Résumé lisible des compteurs renvoyés par la sync (clés inconnues ignorées). */
export function syncSummary(counters: Record<string, unknown>): string {
  const parts = COUNTER_LABELS
    .filter(([key]) => typeof counters[key] === "number")
    .map(([key, label]) => `${counters[key] as number} ${label}`);
  return parts.length > 0 ? parts.join(" · ") : "terminée";
}
