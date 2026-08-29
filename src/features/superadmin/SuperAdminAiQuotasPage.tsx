// Superadmin › Plafonds IA — le levier de maîtrise des coûts, côté éditeur.
//
// C'est le SEUL écran qui écrit un plafond, et il n'écrit pas dans la table :
// il appelle `set_ai_usage_quota` / `delete_ai_usage_quota`, dont la garde
// `is_platform_admin()` vit dans la fonction. Les trois tables `ai_usage_*`
// n'ont aucune policy d'écriture cliente — un refus revient donc du serveur,
// avec son message français, et s'affiche tel quel.

import * as React from "react";
import { Gauge, Infinity as InfinityIcon, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatTokens, nextRenewalLabel, periodKey, type QuotaTone } from "@fn/_shared/ai/quota";
import {
  useAllAiUsage, useDeleteAiQuota, useSetAiQuota, type AiUsageSummary,
} from "@/features/ai/useAiUsage";
import { useAllTenants, type TenantRow } from "./useSuperAdmin";

const BAR_TONE: Record<QuotaTone, string> = {
  ok: "bg-primary",
  warn: "bg-secondary-foreground",
  critical: "bg-destructive",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

interface EditState {
  tenant: TenantRow;
  summary: AiUsageSummary;
  value: string;
}

export function SuperAdminAiQuotasPage() {
  const tenants = useAllTenants();
  const ids = React.useMemo(() => (tenants.data ?? []).map((t) => t.id), [tenants.data]);
  const usage = useAllAiUsage(ids);
  const setQuota = useSetAiQuota();
  const deleteQuota = useDeleteAiQuota();

  const [edit, setEdit] = React.useState<EditState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const now = new Date();

  const byOrg = React.useMemo(
    () => new Map((usage.data ?? []).map((s) => [s.organizationId, s])),
    [usage.data],
  );

  async function submit() {
    if (!edit) return;
    setError(null);
    const parsed = Number.parseInt(edit.value.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Le plafond doit être un nombre de jetons strictement positif.");
      return;
    }
    try {
      await setQuota.mutateAsync({ organizationId: edit.tenant.id, limitTokens: parsed });
      setEdit(null);
    } catch (err) {
      // Le message vient du serveur (RPC) — on ne le réécrit pas.
      setError(err instanceof Error ? err.message : "Enregistrement refusé.");
    }
  }

  async function removeQuota() {
    if (!edit) return;
    setError(null);
    try {
      await deleteQuota.mutateAsync({ organizationId: edit.tenant.id });
      setEdit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retrait refusé.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plafonds IA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consommation de jetons de l'assistant, par collectivité. Période {periodKey(now)} —
            le crédit repart le {nextRenewalLabel(now)}, sans intervention.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
            Consommation du mois
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tenants.isLoading || usage.isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted" />
          ) : (tenants.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune collectivité.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                    <th className="py-2 pr-4">Collectivité</th>
                    <th className="py-2 pr-4">Plafond</th>
                    <th className="py-2 pr-4">Engagé</th>
                    <th className="py-2 pr-4 w-[180px]">Consommation</th>
                    <th className="py-2 pr-4">Dernière modification</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(tenants.data ?? []).map((tenant) => {
                    const s = byOrg.get(tenant.id);
                    if (!s) return null;
                    return (
                      <tr key={tenant.id} className="border-b border-border last:border-b-0">
                        <td className="py-3 pr-4 font-semibold">{tenant.name}</td>
                        <td className="py-3 pr-4 tabular-nums">
                          {s.view.unlimited ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <InfinityIcon className="size-3.5" aria-hidden="true" />
                              {s.updatedAt && !s.isActive ? "désactivé" : "aucun"}
                            </span>
                          ) : (
                            formatTokens(s.view.limit ?? 0)
                          )}
                        </td>
                        <td className="py-3 pr-4 tabular-nums">
                          {formatTokens(s.view.engaged)}
                          {s.view.reserved > 0 ? (
                            <span className="text-muted-foreground">
                              {" "}(dont {formatTokens(s.view.reserved)} en cours)
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4">
                          {s.view.unlimited ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <span
                                  className={cn("block h-full rounded-full", BAR_TONE[s.view.tone])}
                                  style={{ width: `${s.view.percent}%` }}
                                />
                              </span>
                              <span className="w-9 text-right text-xs font-semibold tabular-nums">
                                {s.view.percent}%
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">
                          {s.updatedAt ? formatDateTime(s.updatedAt) : "—"}
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            type="button" variant="outline" size="sm"
                            onClick={() => {
                              setError(null);
                              setEdit({
                                tenant, summary: s,
                                value: s.view.limit ? String(s.view.limit) : "",
                              });
                            }}
                          >
                            <Pencil /> Modifier
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={edit !== null} onOpenChange={(open) => { if (!open) setEdit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plafond IA — {edit?.tenant.name}</DialogTitle>
            <DialogDescription>
              Nombre de jetons que l'assistant peut consommer sur un mois pour cette
              collectivité. Au-delà, l'assistant refuse poliment ; le reste d'Iris continue
              de fonctionner.
            </DialogDescription>
          </DialogHeader>

          <Field label="Plafond mensuel (jetons)" htmlFor="ai-quota">
            <Input
              id="ai-quota"
              inputMode="numeric"
              value={edit?.value ?? ""}
              placeholder="ex. 2 000 000"
              onChange={(e) => setEdit((s) => (s ? { ...s, value: e.target.value } : s))}
            />
          </Field>

          {edit && !edit.summary.view.unlimited ? (
            <p className="text-xs text-muted-foreground">
              Déjà engagé ce mois : {formatTokens(edit.summary.view.engaged)} jetons. Un
              plafond inférieur bloque l'assistant immédiatement, jusqu'au{" "}
              {nextRenewalLabel(now)}.
            </p>
          ) : null}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter className="sm:justify-between">
            <Button
              type="button" variant="ghost"
              disabled={edit?.summary.view.unlimited || deleteQuota.isPending}
              onClick={() => void removeQuota()}
            >
              {deleteQuota.isPending ? <Loader2 className="animate-spin" /> : null}
              Retirer le plafond
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                Annuler
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={setQuota.isPending}>
                {setQuota.isPending ? <Loader2 className="animate-spin" /> : null}
                Enregistrer
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
