// « Mes interventions » (`/interventions`) — la vue de l'INTERVENANT : les
// sollicitations qui lui sont adressées dans le tenant courant, à réaliser
// d'abord, et le geste « Déclarer réalisée ». Le RLS borne tout : un
// intervenant pur ne voit que les demandes où on l'a sollicité, et la fiche
// ouverte depuis ici lui montre le résumé, les pièces et les interventions —
// ni les notes internes, ni les échanges.

import * as React from "react";
import { Link } from "react-router-dom";
import { HardHat } from "lucide-react";
import { useWideLayout } from "@/components/layout/shellLayout";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/surface";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import { formatTimeline } from "../instruction/instruction";
import {
  canComplete, formatDay, interventionStatusLabel, interventionTone, isLate, isoDay,
  pendingCount, sortInterventions, type CompletionDraft,
} from "./interventions";
import { ConfirmerInterventionDialog } from "./ConfirmerInterventionDialog";
import { useCompleteIntervention, useMyInterventions, type MyInterventionRow } from "./useInterventions";

type Filter = "a_realiser" | "realisees" | "toutes";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "a_realiser", label: "À réaliser" },
  { key: "realisees", label: "Réalisées" },
  { key: "toutes", label: "Toutes" },
];

export function MesInterventionsPage() {
  useWideLayout();
  const { current } = useTenant();
  const { session } = useAuth();
  const orgId = current?.organizationId ?? "";
  const userId = session?.user.id ?? null;
  const list = useMyInterventions(orgId);
  const complete = useCompleteIntervention();
  const [filter, setFilter] = React.useState<Filter>("a_realiser");
  const [completing, setCompleting] = React.useState<MyInterventionRow | null>(null);
  const [completeError, setCompleteError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const today = isoDay(new Date());

  if (!current) return null;

  const all = sortInterventions(list.data ?? []);
  const pending = pendingCount(all);
  const rows = all.filter((i) =>
    filter === "toutes" ? true : filter === "a_realiser" ? i.status !== "realisee" : i.status === "realisee",
  );

  async function submitCompletion(draft: CompletionDraft) {
    if (!completing) return;
    setCompleteError(null);
    try {
      const result = await complete.mutateAsync({
        interventionId: completing.id,
        requestId: completing.request_id,
        organizationId: completing.organization_id,
        completedOn: draft.completedOn,
        comment: draft.comment,
        files: draft.files,
      });
      setCompleting(null);
      setNotice(result.attachments > 0
        ? `Intervention déclarée réalisée le ${formatDay(draft.completedOn)} — ${result.attachments} justificatif${result.attachments > 1 ? "s" : ""} joint${result.attachments > 1 ? "s" : ""}.`
        : `Intervention déclarée réalisée le ${formatDay(draft.completedOn)}.`);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Enregistrement refusé.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <HardHat className="size-6 text-primary" aria-hidden="true" /> Mes interventions
          </h1>
          <p className="text-sm text-muted-foreground">
            Les demandes sur lesquelles un agent vous a sollicité pour intervenir, dans {current.organizationName}.
            {pending > 0 ? ` ${pending} à réaliser.` : ""}
          </p>
        </div>
        <div role="group" aria-label="Filtrer" className="flex gap-1 rounded-[10px] border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                filter === f.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <p role="status" className="rounded-[14px] bg-primary/[0.06] px-4 py-2.5 text-sm font-semibold text-primary">
          {notice}
        </p>
      ) : null}
      {list.isError ? (
        <p role="alert" className="rounded-[14px] border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          Les interventions n'ont pas pu être lues.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-iris-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Demande</th>
              <th className="px-4 py-2.5">Organisme</th>
              <th className="px-4 py-2.5">Souhaitée le</th>
              <th className="px-4 py-2.5">Ce qui est attendu</th>
              <th className="px-4 py-2.5">État</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {filter === "a_realiser" ? "Aucune intervention à réaliser." : "Aucune intervention."}
                </td>
              </tr>
            ) : (
              rows.map((i) => {
                const tone = interventionTone(i, today);
                return (
                  <tr key={i.id} className="border-b border-border/60 align-top last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      {i.request ? (
                        <div className="flex flex-col gap-1">
                          <Link to={`/demandes/${i.request.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                            {i.request.reference}
                          </Link>
                          <span className="font-medium">{i.request.subject}</span>
                          <StatusBadge status={i.request.status} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Demande inaccessible</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {i.request?.socle_organization_label ?? "—"}
                      {i.request?.socle_procedure_label ? (
                        <span className="block text-xs">{i.request.socle_procedure_label}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn("font-semibold", tone === "error" && "text-destructive")}>
                        {formatDay(i.requested_for)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        sollicitée le {formatTimeline(i.requested_at)}
                      </span>
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <p className="whitespace-pre-wrap">{i.request_comment}</p>
                      {i.status === "realisee" ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Réalisée le {formatDay(i.completed_on)}
                          {i.completion_comment ? ` — ${i.completion_comment}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={tone}>{isLate(i, today) ? "En retard" : interventionStatusLabel(i.status)}</Pill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canComplete(i, userId) ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={complete.isPending}
                          onClick={() => { setCompleteError(null); setNotice(null); setCompleting(i); }}
                        >
                          Déclarer réalisée
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmerInterventionDialog
        intervention={completing}
        requestLabel={completing?.request ? `${completing.request.reference} — ${completing.request.subject}` : null}
        pending={complete.isPending}
        progress={complete.progress}
        error={completeError}
        onClose={() => { setCompleting(null); setCompleteError(null); }}
        onSubmit={(draft) => void submitCompletion(draft)}
      />
    </div>
  );
}
