// Solliciter un intervenant : qui, pour quand, pour quoi faire.
//
// Le dialogue ne s'ouvre que depuis une demande EN COURS D'INSTRUCTION avec le
// droit d'instruction (`solicitGate`) — reflet de confort : la RPC
// `request_intervention` rejoue tout, et son refus s'affiche ici tel quel.
// Le commentaire est FACULTATIF (demande PO 2026-09-24) : quand il est écrit,
// c'est la consigne que l'intervenant lira dans son e-mail.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ERROR_DATE_PAST, ERROR_DATE_REQUIRED, ERROR_INTERVENANT_REQUIRED,
  isoDay, validateSollicitation, type SollicitationDraft,
} from "./interventions";
import type { EligibleIntervenantRow } from "./useInterventions";

interface Props {
  open: boolean;
  intervenants: EligibleIntervenantRow[];
  loadingIntervenants: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: SollicitationDraft) => void;
}

function emptyDraft(): SollicitationDraft {
  return { intervenantId: "", requestedFor: "", comment: "" };
}

export function SolliciterDialog({
  open, intervenants, loadingIntervenants, pending, error, onClose, onSubmit,
}: Props) {
  const [draft, setDraft] = React.useState<SollicitationDraft>(emptyDraft);
  const [submitted, setSubmitted] = React.useState(false);
  const today = isoDay(new Date());

  React.useEffect(() => {
    if (open) { setDraft(emptyDraft()); setSubmitted(false); }
  }, [open]);

  const errors = submitted ? validateSollicitation(draft, today) : [];
  const fieldError = (...codes: string[]) => errors.find((e) => codes.includes(e));
  const noIntervenant = !loadingIntervenants && intervenants.length === 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (validateSollicitation(draft, today).length > 0) return;
    onSubmit({ ...draft, comment: draft.comment.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solliciter un intervenant</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">
            L'intervenant sera prévenu par e-mail et verra cette demande dans « Mes interventions ».
            Il déclarera lui-même l'intervention réalisée.
          </p>

          <Field
            label="Intervenant"
            htmlFor="sol-intervenant"
            required
            error={fieldError(ERROR_INTERVENANT_REQUIRED)}
            hint={noIntervenant
              ? "Aucun intervenant n'est déclaré pour cet organisme : un profil de droits « Intervenant » couvrant cet organisme doit être attribué (Paramètres › Profils de droits)."
              : undefined}
          >
            <Select
              id="sol-intervenant"
              value={draft.intervenantId}
              disabled={loadingIntervenants || noIntervenant}
              onChange={(e) => setDraft((d) => ({ ...d, intervenantId: e.target.value }))}
            >
              <option value="">{loadingIntervenants ? "Chargement…" : "Choisir…"}</option>
              {intervenants.map((i) => (
                <option key={i.user_id} value={i.user_id}>{i.display_name || i.email}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Date d'intervention souhaitée"
            htmlFor="sol-date"
            required
            error={fieldError(ERROR_DATE_REQUIRED, ERROR_DATE_PAST)}
          >
            <Input
              id="sol-date"
              type="date"
              min={today}
              value={draft.requestedFor}
              onChange={(e) => setDraft((d) => ({ ...d, requestedFor: e.target.value }))}
            />
          </Field>

          <Field
            label="Ce qui est attendu"
            htmlFor="sol-comment"
            hint="Facultatif — s'il est renseigné, ce texte figurera dans l'e-mail envoyé à l'intervenant."
          >
            <Textarea
              id="sol-comment"
              rows={4}
              value={draft.comment}
              onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
              placeholder="Ex. : constater l'affaissement de la chaussée et sécuriser la zone."
            />
          </Field>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={pending || noIntervenant}>
              {pending ? "Envoi…" : "Solliciter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
