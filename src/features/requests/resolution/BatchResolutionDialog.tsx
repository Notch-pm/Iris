// Résolution groupée d'une sélection de la liste (B7 — décision PO du
// 2026-11-04). Un seul geste pour N demandes, liées ou non :
//
//   1. l'agent choisit l'issue (positive / négative), le motif éventuel, le
//      commentaire pour l'usager — repris pour toutes ;
//   2. il lit, demande par demande, ce qui va se passer (passage par
//      l'instruction, affectation, absence d'avis pour Clara) et les refus
//      PRÉVISIBLES, qui ne partent pas au serveur ;
//   3. `resolve_requests` fait une transition par demande (la garde, t17, le RLS
//      s'appliquent à chacune) et rend un résultat PARTIEL quand il l'est ;
//   4. si l'agent l'a coché (décoché par défaut — un courriel ne se reprend
//      pas), l'avis de clôture de chaque demande résolue part par
//      `send-request-email`, qui revérifie le droit et refuse déjà Clara.
//
// Même ordre et mêmes règles que la résolution commune d'un groupe
// (`features/linking/GroupResolution.tsx`).

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import type { EdgeError } from "@/lib/edge";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/features/requests/StatusBadge";
import { MOTIF_LABELS, type ClosureMotif } from "@/features/requests/statuts";
import { useSendClosureEmail } from "@/features/requests/instruction/useSendRequestEmail";
import { closureNoticeApplies } from "@fn/_shared/email/cloture";
import {
  batchForecast, batchNotifiableCount, batchSummary, submittable,
  type BatchItem, type BatchResult, type BatchStatus,
} from "./batch";

function useResolveRequests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ids: string[]; status: BatchStatus; motif?: string; closureText?: string;
    }): Promise<BatchResult[]> => {
      const { data, error } = await supabase.rpc("resolve_requests", {
        p_request_ids: input.ids,
        p_status: input.status,
        p_motif: input.motif,
        p_closure_text: input.closureText,
      });
      if (error) throw error;
      return (data ?? []) as BatchResult[];
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["request-group"] });
      for (const id of vars.ids) {
        void qc.invalidateQueries({ queryKey: ["request", id] });
        void qc.invalidateQueries({ queryKey: ["request_events", id] });
      }
    },
  });
}

/** Motifs d'une résolution négative — ceux qu'accepte la garde depuis l'instruction. */
const NEGATIVE_MOTIFS: ClosureMotif[] = ["irrecevable", "reorientation"];

interface Outcome {
  headline: string;
  failuresTitle: string | null;
  failures: string[];
  notices: string | null;
  noticeFailures: string | null;
}

export function BatchResolutionDialog({ open, items, onClose, onResolved }: {
  open: boolean;
  items: BatchItem[];
  onClose: () => void;
  /** Ids résolus — la liste les retire de la sélection. */
  onResolved: (okIds: string[]) => void;
}) {
  const resolve = useResolveRequests();
  const sendClosure = useSendClosureEmail().mutateAsync;
  const [status, setStatus] = React.useState<BatchStatus>("resolue_positive");
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [notify, setNotify] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  // Remise à zéro à chaque ouverture : on ne prévient personne par défaut.
  React.useEffect(() => {
    if (open) {
      setStatus("resolue_positive");
      setMotif("");
      setClosureText("");
      setNotify(false);
      setError(null);
      setOutcome(null);
    }
  }, [open]);

  const toSend = submittable(items);
  const notifiable = batchNotifiableCount(items);
  const busy = resolve.isPending || sending;

  async function submit() {
    setError(null);
    const skipped = items
      .map((i) => ({ reference: i.reference, reason: batchForecast(i).blocked }))
      .filter((s): s is { reference: string; reason: string } => s.reason !== null);
    let results: BatchResult[];
    try {
      results = await resolve.mutateAsync({
        ids: toSend.map((i) => i.id),
        status,
        motif: status === "resolue_negative" && motif !== "" ? motif : undefined,
        closureText: closureText.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "La résolution groupée a échoué.");
      return;
    }
    const summary = batchSummary(results, skipped);
    onResolved(summary.okIds);
    let notices: string | null = null;
    let noticeFailures: string | null = null;
    if (notify) {
      setSending(true);
      const targets = toSend.filter((i) => summary.okIds.includes(i.id) && closureNoticeApplies(i.source));
      let sent = 0; let noAddress = 0; const failed: string[] = [];
      for (const t of targets) {
        try {
          await sendClosure({ requestId: t.id });
          sent++;
        } catch (err) {
          if ((err as EdgeError | null)?.code === "no_recipient") noAddress++;
          else failed.push(t.reference);
        }
      }
      setSending(false);
      notices = `${sent} usager${sent > 1 ? "s" : ""} prévenu${sent > 1 ? "s" : ""}`
        + (noAddress > 0 ? `, ${noAddress} sans adresse` : "");
      if (failed.length > 0) {
        noticeFailures = `Avis non parti${failed.length > 1 ? "s" : ""} (la demande est bien résolue) : ${failed.join(", ")}`;
      }
    }
    setOutcome({
      headline: summary.headline, failuresTitle: summary.failuresTitle, failures: summary.failures,
      notices, noticeFailures,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Résoudre la sélection</DialogTitle>
          <DialogDescription>
            {items.length} demande{items.length > 1 ? "s" : ""} sélectionnée{items.length > 1 ? "s" : ""} —
            résolue{items.length > 1 ? "s" : ""} avec le même motif et le même commentaire. Celles qui
            ne peuvent pas l'être restent ouvertes, et vous le saurez.
          </DialogDescription>
        </DialogHeader>

        {outcome ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-[15px] font-bold">{outcome.headline}</p>
            {outcome.notices ? <p className="text-sm text-muted-foreground">{outcome.notices}</p> : null}
            {outcome.failuresTitle ? (
              <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                <p className="font-semibold">{outcome.failuresTitle}</p>
                <ul className="flex max-h-[260px] flex-col gap-0.5 overflow-auto">
                  {outcome.failures.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            ) : null}
            {outcome.noticeFailures ? <p role="alert" className="text-sm text-destructive">{outcome.noticeFailures}</p> : null}
            <DialogFooter>
              <Button type="button" onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-semibold">Issue</legend>
              {([
                ["resolue_positive", "Résolue positivement"],
                ["resolue_negative", "Résolue négativement"],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2.5 text-[13.5px]">
                  <input
                    type="radio" name="batch-status" value={value}
                    className="size-4 accent-[hsl(var(--primary))]"
                    checked={status === value} onChange={() => setStatus(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            {status === "resolue_negative" ? (
              <Field label="Motif" htmlFor="batch-motif">
                <Select id="batch-motif" value={motif} onChange={(e) => setMotif(e.target.value as ClosureMotif | "")}>
                  <option value="">— Aucun —</option>
                  {NEGATIVE_MOTIFS.map((m) => <option key={m} value={m}>{MOTIF_LABELS[m]}</option>)}
                </Select>
              </Field>
            ) : null}

            <Field
              label="Commentaire pour l'usager (facultatif)"
              htmlFor="batch-closure"
              hint="Repris dans chaque demande. Jamais une note interne : ce texte part à l'usager si vous le prévenez."
            >
              <Textarea id="batch-closure" value={closureText} onChange={(e) => setClosureText(e.target.value)} />
            </Field>

            <ul className="flex max-h-[260px] flex-col gap-1 overflow-auto rounded-xl border border-border bg-muted/30 p-2">
              {items.map((i) => {
                const f = batchForecast(i);
                return (
                  <li key={i.id} className={cn("flex flex-col gap-0.5 rounded-lg px-1.5 py-1", f.blocked && "opacity-60")}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11.5px] font-bold">{i.reference}</span>
                      <span className="min-w-0 truncate text-[13px] font-semibold">{i.subject}</span>
                      <StatusBadge status={i.status} />
                    </span>
                    {f.blocked ? (
                      <span className="text-[11.5px] text-destructive">Ne sera pas résolue : {f.blocked}</span>
                    ) : f.notes.length > 0 ? (
                      <span className="text-[11.5px] text-muted-foreground">{f.notes.join(" · ")}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <label htmlFor="batch-notify" className="flex cursor-pointer items-start gap-2.5">
              <input
                id="batch-notify" type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={notifiable === 0}
              />
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">Prévenir les usagers</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {notifiable === 0
                    ? "Aucun avis possible pour cette sélection."
                    : `${notifiable} avis de clôture ${notifiable > 1 ? "partiront" : "partira"}, avec votre commentaire.`}
                </span>
              </span>
            </label>

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Annuler</Button>
              <Button type="submit" disabled={busy || toSend.length === 0}>
                {resolve.isPending
                  ? "Résolution…"
                  : sending
                    ? "Envoi des avis…"
                    : `Résoudre ${toSend.length} demande${toSend.length > 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
