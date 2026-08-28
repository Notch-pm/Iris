import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  MOTIF_LABELS, needsTransitionDialog,
  type ClosureMotif, type RequestStatus, type TransitionSpec,
} from "./statuts";
import { CLOSURE_SUBJECTS } from "@fn/_shared/email/cloture";
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

/**
 * Ce dont le DIALOGUE a besoin, et rien de plus. La fiche le fournit par
 * `useTransitionRunner` (une demande, connue au montage) ; le tableau des
 * demandes par `tableau/useBoardTransition` (la demande visée change à chaque
 * glisser-déposer). Un seul dialogue pour les deux.
 */
export interface TransitionDialogRunner {
  /** Transition dont le dialogue (motif / texte / assigné) est ouvert. */
  active: TransitionSpec | null;
  run: (spec: TransitionSpec, input: TransitionInput) => Promise<void>;
  close: () => void;
  pending: boolean;
  error: string | null;
  /** Assigné proposé par défaut dans le dialogue (assigné courant, sinon l'agent connecté). */
  defaultAssignee: string;
}

export interface TransitionRunner extends TransitionDialogRunner {
  /** Lance la transition : dialogue si des informations manquent, sinon application directe. */
  start: (spec: TransitionSpec) => void;
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
    if (needsTransitionDialog(spec, defaultAssignee)) {
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
  runner: TransitionDialogRunner;
  members: TenantMember[];
  /** Demande visée, quand l'écran en instruit plusieurs (tableau des demandes). */
  subtitle?: React.ReactNode;
}

/**
 * Ce que l'agent doit savoir avant d'écrire : un courriel PARTIRA, avec son
 * commentaire dedans s'il en met un. Les objets sont ceux, figés, que compose
 * le serveur — on les cite plutôt que de les paraphraser, pour que l'agent
 * reconnaisse le message dans l'onglet Échanges.
 */
const CLOSURE_NOTICE: Partial<Record<RequestStatus, string>> = {
  resolue_positive:
    `L'usager recevra « ${CLOSURE_SUBJECTS.resolue_positive} ». Votre commentaire y sera intégré.`,
  resolue_negative:
    `L'usager recevra « ${CLOSURE_SUBJECTS.resolue_negative} ». Votre commentaire y sera intégré.`,
};

/** Dialogue motif / commentaire / assigné — monté une seule fois par fiche. */
export function TransitionDialog({ runner, members, subtitle }: DialogProps) {
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
              {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
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
              {active.asksClosureText ? (
                <Field
                  label="Commentaire pour l'usager (facultatif)"
                  htmlFor="tr-closure"
                  hint={CLOSURE_NOTICE[active.to] ?? "Jamais une note interne — ce texte part à l'usager."}
                >
                  <Textarea id="tr-closure" value={closureText}
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
