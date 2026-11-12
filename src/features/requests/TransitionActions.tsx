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
import {
  closureLetters, closureOutcome, type ProcedureDocuments,
} from "@fn/_shared/document/templates";
import { useApplyTransition, type TenantMember } from "./useRequests";
import {
  ClosureLetterSection, closureLetterChoice, closureLetterReady, emptyClosureLetter,
  type ClosureLetterDraft,
} from "./instruction/ClosureLetterSection";
import { reserveLetterTab, type ClosureLetterRequest } from "./instruction/useClosureLetter";

// Transitions de statut — reflet de la garde SQL, qui reste la seule autorité.
// Le hook porte l'état (transition en cours, erreur) ; la fiche décide OÙ
// placer les boutons (action principale de l'en-tête et de l'avancement, menu
// des actions secondaires) et monte un seul `TransitionDialog`.

export interface TransitionInput {
  closureText?: string;
  motif?: ClosureMotif;
  assigneeId?: string | null;
  /**
   * Courrier de réponse papier à générer APRÈS une clôture réussie
   * (`useClosureLetter`) — jamais transmis à la transition elle-même.
   */
  letter?: ClosureLetterRequest;
}

/**
 * Les courriers de la démarche, pour la section « courrier de réponse papier »
 * de la modale de clôture. Fournis par l'écran qui les charge (fiche, mobile) ;
 * absent sur le tableau, qui garde une clôture rapide.
 */
export interface ClosureLetterSource {
  documents: ProcedureDocuments | undefined;
  loading: boolean;
  error: boolean;
}

/** La section n'existe que pour une issue positive ou négative. */
export function offersClosureLetter(spec: TransitionSpec | null): boolean {
  return spec !== null && closureOutcome(spec.to) !== null;
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
  /** Après une transition réussie — avec ce que l'agent a saisi (motif, commentaire). */
  onDone?: (spec: TransitionSpec, input: TransitionInput) => void;
}): TransitionRunner {
  const { session } = useAuth();
  const apply = useApplyTransition();
  const [active, setActive] = React.useState<TransitionSpec | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { requestId, assignedTo, onDone } = opts;
  const defaultAssignee = assignedTo ?? session?.user.id ?? "";

  const run = React.useCallback(async (spec: TransitionSpec, input: TransitionInput) => {
    setError(null);
    const { letter, ...transition } = input;
    try {
      await apply.mutateAsync({ requestId, spec, ...transition });
      setActive(null);
      onDone?.(spec, input);
    } catch (err) {
      // La clôture n'a pas eu lieu : l'onglet réservé au courrier se referme.
      letter?.tab?.close();
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
  /** Faux pour une demande issue de Clara : aucun avis ne partira
   *  (`closureNoticeApplies`), le dialogue ne doit pas l'annoncer. */
  closureNotice?: boolean;
  /** Section supplémentaire pour cette transition (résolution commune des demandes liées). */
  extra?: (spec: TransitionSpec) => React.ReactNode;
  /** Courriers de la démarche : présent = section « courrier de réponse papier » à la clôture. */
  letterSource?: ClosureLetterSource;
}

/** Ce que l'agent lit à la place quand aucun avis ne partira. */
export const NO_CLOSURE_NOTICE =
  "Demande issue de Clara : Iris n'envoie aucun courriel à l'usager. Ce commentaire reste au dossier.";

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
export function TransitionDialog({
  runner, members, subtitle, closureNotice = true, extra, letterSource,
}: DialogProps) {
  const { active } = runner;
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [letter, setLetter] = React.useState<ClosureLetterDraft>(emptyClosureLetter);

  // Remise à zéro à chaque ouverture (l'assigné proposé suit la demande).
  React.useEffect(() => {
    if (active) {
      setMotif("");
      setClosureText("");
      setAssigneeId(runner.defaultAssignee);
      setLetter(emptyClosureLetter());
    }
  }, [active, runner.defaultAssignee]);

  const showsLetter = letterSource !== undefined && offersClosureLetter(active);
  const letters = React.useMemo(
    () => (showsLetter && active && letterSource?.documents
      ? closureLetters(letterSource.documents, closureOutcome(active.to))
      : []),
    [showsLetter, active, letterSource?.documents],
  );

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
                if (showsLetter && !closureLetterReady(letter)) return;
                const choice = showsLetter ? closureLetterChoice(letter) : undefined;
                void runner.run(active, {
                  closureText: closureText || undefined,
                  motif: motif === "" ? undefined : motif,
                  assigneeId: active.needsAssignee ? (assigneeId || null) : undefined,
                  // L'onglet d'un PDF se réserve ICI, pendant le clic.
                  letter: choice ? { ...choice, tab: reserveLetterTab(choice.format) } : undefined,
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
                  hint={closureNotice
                    ? (CLOSURE_NOTICE[active.to] ?? "Jamais une note interne — ce texte part à l'usager.")
                    : NO_CLOSURE_NOTICE}
                >
                  <Textarea id="tr-closure" value={closureText}
                    onChange={(e) => setClosureText(e.target.value)} />
                </Field>
              ) : null}
              {showsLetter && letterSource ? (
                <ClosureLetterSection
                  idPrefix="tr"
                  letters={letters}
                  loading={letterSource.loading}
                  error={letterSource.error}
                  value={letter}
                  onChange={setLetter}
                />
              ) : null}
              {extra?.(active)}
              {runner.error ? <p role="alert" className="text-sm text-destructive">{runner.error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={runner.close}>Annuler</Button>
                <Button type="submit" disabled={runner.pending || (showsLetter && !closureLetterReady(letter))}>
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
