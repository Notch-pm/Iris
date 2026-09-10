// Écran 4 « Changer le statut » (maquette Claude Design « Iris mobile — v2 »,
// lignes 307-356) — feuille plein écran listant TOUTES les transitions que
// `allowedTransitionsFor` autorise pour le statut courant (le workflow a
// SEPT statuts, la maquette n'en illustrait que trois à titre d'exemple).
//
// Le champ « Note interne » est toujours proposé ; s'il est rempli, la page
// appelante l'enregistre APRÈS la transition réussie (`onSubmit` ne porte que
// la transition — la note est un second geste, volontairement distinct de la
// garde SQL de la transition elle-même).
//
// `runner` est le sous-ensemble `TransitionDialogRunner` partagé avec le
// dialogue de bureau (`TransitionActions.tsx`) : `run`, `pending`, `error`,
// `defaultAssignee`. La fermeture sur succès n'est PAS pilotée ici — c'est
// `onDone` de `useTransitionRunner`, côté page, qui la décide (reprend la
// logique `onTransitionDone` du bureau).

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/layout/mobile/MobilePage";
import { cn } from "@/lib/utils";
import type { TransitionDialogRunner, TransitionInput } from "../TransitionActions";
import {
  MOTIF_LABELS, STATUS_LABELS, type ClosureMotif, type RequestStatus, type TransitionSpec,
} from "../statuts";
import type { TenantMember } from "../useRequests";
import { transitionHint } from "./mobileRequests";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: RequestStatus;
  transitions: TransitionSpec[];
  members: TenantMember[];
  runner: TransitionDialogRunner;
  organizationName: string;
  /** Miroir de la garde t17 (`instruction/conformite.ts`) — `null` = résolution positive ouverte. */
  piecesBlocking: string | null;
  onSubmit: (spec: TransitionSpec, input: TransitionInput, note: string) => void;
}

export function MobileStatusSheet({
  open, onOpenChange, status, transitions, members, runner, organizationName, piecesBlocking, onSubmit,
}: Props) {
  const [selectedTo, setSelectedTo] = React.useState<RequestStatus | "">("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [motif, setMotif] = React.useState<ClosureMotif | "">("");
  const [closureText, setClosureText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSelectedTo("");
      setAssigneeId("");
      setMotif("");
      setClosureText("");
      setNote("");
      setSubmitted(false);
    }
  }, [open]);

  const selectedSpec = transitions.find((t) => t.to === selectedTo) ?? null;
  const blocked = selectedSpec?.to === "resolue_positive" && status === "en_instruction" ? piecesBlocking : null;
  const currentLabel = STATUS_LABELS[status] ?? status;

  function selectTransition(to: RequestStatus) {
    setSelectedTo(to);
    setAssigneeId(runner.defaultAssignee);
    setMotif("");
    setClosureText("");
    setSubmitted(false);
  }

  function trySubmit() {
    setSubmitted(true);
    if (!selectedSpec || blocked || runner.pending) return;
    if (selectedSpec.needsAssignee && !assigneeId) return;
    if (selectedSpec.motifChoices && selectedSpec.motifChoices.length > 0 && selectedSpec.motifRequired && !motif) return;
    onSubmit(
      selectedSpec,
      {
        assigneeId: selectedSpec.needsAssignee ? assigneeId : undefined,
        motif: motif === "" ? undefined : motif,
        closureText: closureText.trim() === "" ? undefined : closureText,
      },
      note,
    );
  }

  const showsClosureHint = selectedSpec ? selectedSpec.to === "resolue_positive" || selectedSpec.to === "resolue_negative" : false;

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => { if (!o && !runner.pending) onOpenChange(false); }}
      title="Changer le statut"
      locked={runner.pending}
      footer={
        <>
          <Button
            type="button"
            size="lg"
            className="h-12 w-full rounded-[14px] text-base"
            disabled={!selectedSpec || Boolean(blocked) || runner.pending}
            onClick={trySubmit}
          >
            {runner.pending ? "Application…" : "Valider le changement"}
          </Button>
          {showsClosureHint ? (
            <p className="text-center text-xs text-muted-foreground">
              L'usager recevra un courriel de {organizationName}.
            </p>
          ) : null}
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Statut actuel : {currentLabel.toLowerCase()}. Le nouveau statut est visible par l'usager.
      </p>

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-border">
        {transitions.map((spec, i) => {
          const active = spec.to === selectedTo;
          return (
            <button
              key={spec.to}
              type="button"
              onClick={() => selectTransition(spec.to)}
              className={cn(
                "flex min-h-[60px] items-center gap-3 px-4 text-left transition-colors",
                i > 0 && "border-t border-border/70",
                active && "bg-primary/[0.06]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full border-2",
                  active ? "border-primary" : "border-border",
                )}
              >
                {active ? <span className="size-[11px] rounded-full bg-primary" /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("text-base leading-tight", active ? "font-bold" : "font-semibold")}>
                  {STATUS_LABELS[spec.to]}
                </span>
                <span className="text-[13px] text-muted-foreground">{transitionHint(spec.to)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {selectedSpec?.needsAssignee ? (
        <Field
          label="Agent assigné"
          htmlFor="mst-assignee"
          required
          error={submitted && !assigneeId ? "Un agent assigné est obligatoire." : undefined}
        >
          <Select id="mst-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">— Choisir —</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </Select>
        </Field>
      ) : null}

      {selectedSpec?.motifChoices && selectedSpec.motifChoices.length > 0 ? (
        <Field
          label="Motif"
          htmlFor="mst-motif"
          required={selectedSpec.motifRequired}
          error={submitted && selectedSpec.motifRequired && !motif ? "Le motif est obligatoire." : undefined}
        >
          <Select id="mst-motif" value={motif} onChange={(e) => setMotif(e.target.value as ClosureMotif | "")}>
            <option value="">— Choisir —</option>
            {selectedSpec.motifChoices.map((m) => <option key={m} value={m}>{MOTIF_LABELS[m]}</option>)}
          </Select>
        </Field>
      ) : null}

      {selectedSpec?.asksClosureText ? (
        <Field
          label="Message à l'usager"
          htmlFor="mst-closure"
          hint="Facultatif — repris dans l'avis de clôture envoyé à l'usager."
        >
          <Textarea id="mst-closure" value={closureText} onChange={(e) => setClosureText(e.target.value)} />
        </Field>
      ) : null}

      <Field label="Note interne" htmlFor="mst-note" hint="Facultatif — non visible par l'usager">
        <Textarea id="mst-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {blocked ? <p role="alert" className="text-sm text-destructive">{blocked}</p> : null}
      {runner.error ? <p role="alert" className="text-sm text-destructive">{runner.error}</p> : null}
    </MobileSheet>
  );
}
