// Dialogue de qualification d'une pièce : conforme, ou non conforme avec un
// motif pris dans le catalogue fermé et une précision libre facultative.
//
// La précision est écrite POUR L'USAGER — elle est reprise telle quelle dans
// le courriel de signalement. Le libellé du champ le dit, parce qu'un agent
// qui croit écrire une note interne n'écrit pas la même chose.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_COMPLIANCE_NOTE, NONCONFORMITY_MOTIFS,
  type Compliance, type NonConformityMotif, type QualifiableAttachment,
} from "./conformite";

export interface QualificationSubmit {
  compliance: Compliance;
  motif: NonConformityMotif | null;
  note: string | null;
}

interface Props {
  /** La pièce qualifiée ; `null` ferme le dialogue. */
  attachment: QualifiableAttachment | null;
  /** Le libellé de l'exigence à laquelle elle répond, s'il y en a une. */
  requirementLabel?: string | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: QualificationSubmit) => void;
}

export function QualificationDialog({
  attachment, requirementLabel, pending, error, onClose, onSubmit,
}: Props) {
  const [compliance, setCompliance] = React.useState<Compliance>("conforme");
  const [motif, setMotif] = React.useState<NonConformityMotif | "">("");
  const [note, setNote] = React.useState("");

  // Réouverture : on repart du verdict déjà porté par la pièce, s'il y en a un
  // — requalifier, c'est corriger un jugement, pas en repartir de zéro.
  React.useEffect(() => {
    if (!attachment) return;
    setCompliance(attachment.compliance === "non_conforme" ? "non_conforme" : "conforme");
    setMotif((attachment.compliance_motif as NonConformityMotif | null) ?? "");
    setNote(attachment.compliance_note ?? "");
  }, [attachment]);

  const nonConforme = compliance === "non_conforme";

  return (
    <Dialog open={attachment !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        {attachment ? (
          <>
            <DialogHeader>
              <DialogTitle>Qualifier la pièce</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                  compliance,
                  motif: nonConforme && motif !== "" ? motif : null,
                  note: note.trim() === "" ? null : note.trim(),
                });
              }}
            >
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{attachment.file_name}</span>
                {requirementLabel ? <> · {requirementLabel}</> : null}
              </p>

              <Field label="Conformité" htmlFor="qual-verdict" required>
                <Select
                  id="qual-verdict"
                  required
                  value={compliance}
                  onChange={(e) => setCompliance(e.target.value as Compliance)}
                >
                  <option value="conforme">Conforme</option>
                  <option value="non_conforme">Non conforme</option>
                </Select>
              </Field>

              {nonConforme ? (
                <Field label="Motif de non-conformité" htmlFor="qual-motif" required>
                  <Select
                    id="qual-motif"
                    required
                    value={motif}
                    onChange={(e) => setMotif(e.target.value as NonConformityMotif | "")}
                  >
                    <option value="">— Choisir —</option>
                    {NONCONFORMITY_MOTIFS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              <Field
                label="Précision (facultative)"
                htmlFor="qual-note"
                hint={nonConforme
                  ? "Reprise telle quelle dans le courriel envoyé à l'usager : dites-lui ce qui manque, précisément."
                  : "Une remarque à garder au dossier."}
              >
                <Textarea
                  id="qual-note"
                  value={note}
                  maxLength={MAX_COMPLIANCE_NOTE}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>

              {nonConforme ? (
                <p className="rounded-[14px] bg-secondary/30 px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
                  La demande passera « En attente d'information ». Vous pourrez ensuite en
                  avertir l'usager depuis le bouton « Signaler à l'usager ».
                </p>
              ) : null}

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
                <Button type="submit" disabled={pending || (nonConforme && motif === "")}>
                  {pending ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
