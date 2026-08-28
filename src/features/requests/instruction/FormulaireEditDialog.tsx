// Modification des réponses au formulaire de la démarche, depuis la fiche.
//
// Le formulaire rejoué est celui du `procedure_snapshot` — FIGÉ au dépôt.
// C'est la pièce du dossier : on corrige ce que l'usager a répondu au
// formulaire qui lui a été présenté, pas au formulaire d'aujourd'hui. La
// définition de la démarche, elle, vit dans le Socle et ne se modifie pas
// depuis Iris (invariant).
//
// Les champs « pièce » sont RAPPELÉS mais non déposables : les pièces se gèrent
// dans l'onglet Documents, où elles portent leur qualification et l'historique
// de leurs remplacements.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ProcedureFormFields } from "../creation/ProcedureFormFields";
import type { AttachmentDeclaration, FormSchema, FormValues }
  from "@fn/create-request-from-procedure/_shared/procedureForm";
import { changedAnswerKeys, initialAnswerValues, validateAnswers } from "./formulaire";

interface Props {
  open: boolean;
  /** Schéma FIGÉ de la demande ; `null` = snapshot dégradé, rien à éditer. */
  schema: FormSchema | null;
  formData: unknown;
  /** Pièces ACTIVES de la demande, pour rejouer les conditions à l'identique. */
  attachments: AttachmentDeclaration[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (formData: Record<string, unknown>, changed: string[]) => void;
}

export function FormulaireEditDialog({
  open, schema, formData, attachments, pending, error, onClose, onSubmit,
}: Props) {
  const [values, setValues] = React.useState<FormValues>({});
  const [submitted, setSubmitted] = React.useState(false);

  // Chaque ouverture repart des réponses enregistrées : un dialogue fermé sans
  // enregistrer ne laisse aucune trace de la saisie abandonnée.
  React.useEffect(() => {
    if (!open || !schema) return;
    setValues(initialAnswerValues(schema, formData));
    setSubmitted(false);
  }, [open, schema, formData]);

  const result = schema ? validateAnswers(schema, values, attachments) : null;
  const changed = result ? changedAnswerKeys(formData, result.formData) : [];
  const errors = submitted && result ? result.errors : {};

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Modifier les réponses</DialogTitle>
        </DialogHeader>

        {!schema || schema.content.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Le formulaire de cette démarche n'est pas exploitable dans le dossier
            (snapshot dégradé) : il n'y a rien à modifier ici.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (!result || !result.ok) return;
              onSubmit(result.formData, changed);
            }}
          >
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ProcedureFormFields
                schema={schema}
                values={values}
                onChange={(fieldId, value) => setValues((v) => ({ ...v, [fieldId]: value }))}
                files={{}}
                onFilesChange={() => {}}
                errors={errors}
                attachmentsReadOnly
              />
            </div>

            <p className="text-[12.5px] text-muted-foreground">
              Le formulaire est celui retenu au dépôt de la demande. Modifier une réponse peut
              rendre une pièce obligatoire, ou cesser de l'exiger.
            </p>

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
              <Button type="submit" disabled={pending || changed.length === 0}>
                {pending ? "Enregistrement…"
                  : changed.length === 0 ? "Aucune modification"
                  : `Enregistrer ${changed.length} modification${changed.length > 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
