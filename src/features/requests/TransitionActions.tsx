import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import { MOTIF_LABELS, type ClosureMotif, type TransitionSpec } from "./statuts";
import { useApplyTransition, type TenantMember } from "./useRequests";

// Transitions de statut — reflet de la garde SQL, qui reste la seule autorité.
// Le hook porte l'état (transition en cours, erreur) ; la fiche décide OÙ
// placer les boutons (action principale de l'en-tête et de l'avancement, menu
// des actions secondaires) et monte un seul `TransitionDialog`.

export interface TransitionInput {
  closureText?: string;
  motif?: ClosureMotif;
  assigneeId?: string | null;
}

export interface TransitionRunner {
  /** Transition dont le dialogue (motif / texte / assigné) est ouvert. */
  active: TransitionSpec | null;
  /** Lance la transition : dialogue si des informations manquent, sinon application directe. */
  start: (spec: TransitionSpec) => void;
  run: (spec: TransitionSpec, input: TransitionInput) => Promise<void>;
  close: () => void;
  pending: boolean;
  error: string | null;
  /** Assigné proposé par défaut dans le dialogue (assigné courant, sinon l'agent connecté). */
  defaultAssignee: string;
}

export function useTransitionRunner(opts: {
  requestId: string;
  assignedTo: string | null;
  onDone?: (spec: TransitionSpec) => void;
}): TransitionRunner {
  const { session } = useAuth();
  const apply = useApplyTransition();
  const [active, setActive] = React.useState<TransitionSpec | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { requestId, assignedTo, onDone } = opts;
  const defaultAssignee = assignedTo ?? session?.user.id ?? "";

  const run = React.useCallback(async (spec: TransitionSpec, input: TransitionInput) => {
    setError(null);
    try {
      await apply.mutateAsync({ requestId, spec, ...input });
      setActive(null);
      onDone?.(spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition refusée.");
    }
  }, [apply, requestId, onDone]);

  const start = React.useCallback((spec: TransitionSpec) => {
    setError(null);
    const needsDialog = Boolean(
      spec.needsClosureText
      || (spec.motifChoices && spec.motifChoices.length > 0)
      || (spec.needsAssignee && defaultAssignee === ""),
    );
    if (needsDialog) {
      setActive(spec);
      return;
    }
    // Prise en charge directe : l'agent courant devient l'assigné si personne ne l'est.
    void run(spec, { assigneeId: spec.needsAssignee ? defaultAssignee : undefined });
  }, [defaultAssignee, run]);

  return {
    active,
    start,
    run,
    close: () => { setActive(null); setError(null); },
    pending: apply.isPending,
    error,
    defaultAssignee,
  };
}

interface DialogProps {
  runner: TransitionRunner;
  members: TenantMember[];
}

/** Dialogue motif / texte de clôture / assigné — monté une seule fois par fiche. */
export function TransitionDialog({ runner, members }: DialogProps) {
  const { active } = runner;
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");

  // Remise à zéro à chaque ouverture (l'assigné proposé suit la demande).
  React.useEffect(() => {
    if (active) {
      setMotif("");
      setClosureText("");
      setAssigneeId(runner.defaultAssignee);
    }
  }, [active, runner.defaultAssignee]);

  return (
    <Dialog open={active !== null} onOpenChange={(o) => { if (!o) runner.close(); }}>
      <DialogContent>
        {active ? (
          <>
            <DialogHeader>
              <DialogTitle>{active.label}</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void runner.run(active, {
                  closureText: closureText || undefined,
                  motif: motif === "" ? undefined : motif,
                  assigneeId: active.needsAssignee ? (assigneeId || null) : undefined,
                });
              }}
            >
              {active.needsAssignee ? (
                <Field label="Agent assigné" htmlFor="tr-assignee" required>
                  <Select id="tr-assignee" required value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>{m.displayName}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {active.motifChoices && active.motifChoices.length > 0 ? (
                <Field label="Motif" htmlFor="tr-motif" required={active.motifRequired}>
                  <Select id="tr-motif" required={active.motifRequired} value={motif}
                    onChange={(e) => setMotif(e.target.value as ClosureMotif | "")}>
                    <option value="">— Choisir —</option>
                    {active.motifChoices.map((m) => (
                      <option key={m} value={m}>{MOTIF_LABELS[m]}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {active.needsClosureText ? (
                <Field label="Texte de clôture (destiné à l'usager)" htmlFor="tr-closure" required
                  hint="Jamais une note interne — ce texte pourra être transmis à l'usager.">
                  <Textarea id="tr-closure" required value={closureText}
                    onChange={(e) => setClosureText(e.target.value)} />
                </Field>
              ) : null}
              {runner.error ? <p role="alert" className="text-sm text-destructive">{runner.error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={runner.close}>Annuler</Button>
                <Button type="submit" disabled={runner.pending}>
                  {runner.pending ? "Application…" : "Confirmer"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
