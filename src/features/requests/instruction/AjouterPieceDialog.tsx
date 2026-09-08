// Ajout d'une pièce sur une exigence non conforme ou manquante.
//
// LE REMPLACEMENT EST ANNONCÉ AVANT L'ENVOI (décision PO 2026-08-28 : « la plus
// récente fait foi »). L'agent lit, noir sur blanc, combien de pièces déjà
// déposées vont sortir du calcul — y compris quand le motif était « la pièce
// est incomplète », cas où l'on pourrait croire que la nouvelle s'ajoute. Rien
// n'est supprimé : les remplacées restent au dossier, marquées.

import * as React from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ACCEPTED_FORMATS_LABEL, acceptAttribute } from "@fn/_shared/files/magic";
import { formatBytes } from "./instruction";
import type { PieceRequirement } from "./conformite";

interface Props {
  /** L'exigence visée ; `null` ferme le dialogue. */
  requirement: PieceRequirement | null;
  /** Formats acceptés déclarés par la démarche (extensions nues, sans point). */
  acceptedFormats: string[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (file: File) => void;
}

export function AjouterPieceDialog({
  requirement, acceptedFormats, pending, error, onClose, onSubmit,
}: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => { if (requirement) setFile(null); }, [requirement]);

  const replaced = requirement?.attachments.length ?? 0;
  // Ce que la démarche demande, croisé avec ce qu'Iris accepte (liste fermée,
  // vérifiée sur le contenu réel côté serveur — l'attribut n'est qu'un confort).
  const accept = acceptAttribute(acceptedFormats);
  const formats = acceptedFormats.length > 0
    ? acceptedFormats.map((f) => f.toUpperCase()).join(", ")
    : ACCEPTED_FORMATS_LABEL;

  return (
    <Dialog open={requirement !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        {requirement ? (
          <>
            <DialogHeader>
              <DialogTitle>Ajouter une pièce</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => { e.preventDefault(); if (file) onSubmit(file); }}
            >
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{requirement.label}</span>
                {requirement.required ? " · pièce obligatoire" : null}
              </p>

              <Field label="Fichier" htmlFor="piece-file" required hint={formats}>
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) setFile(dropped);
                  }}
                  className={cn(
                    "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border px-3.5 py-2 text-left transition-colors",
                    file ? "border-solid border-primary/40 bg-primary/[0.04]"
                      : "border-dashed border-border bg-card hover:bg-secondary/20",
                    dragging && "border-primary bg-primary/[0.06]",
                  )}
                >
                  <Paperclip
                    className={cn("size-4 shrink-0", file ? "text-primary" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                    {file ? file.name : "Déposer un fichier ou parcourir"}
                  </span>
                  {file ? (
                    <span className="text-[11.5px] text-muted-foreground">{formatBytes(file.size)}</span>
                  ) : null}
                  <input
                    id="piece-file"
                    type="file"
                    className="sr-only"
                    accept={accept || undefined}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </Field>

              {replaced > 0 ? (
                <p className="rounded-[14px] border border-secondary/60 bg-secondary/25 px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
                  Cette pièce <strong>remplacera</strong>{" "}
                  {replaced === 1 ? "la pièce déjà déposée" : `les ${replaced} pièces déjà déposées`}{" "}
                  pour cette exigence : {requirement.attachments.map((a) => a.file_name).join(", ")}.
                  {" "}Elles resteront au dossier, marquées « Remplacée », et sortiront du calcul
                  de conformité. La nouvelle pièce sera à qualifier.
                </p>
              ) : (
                <p className="rounded-[14px] bg-secondary/30 px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
                  Aucune pièce n'avait été déposée pour cette exigence. La nouvelle sera à qualifier.
                </p>
              )}

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
                <Button type="submit" disabled={pending || !file}>
                  {pending ? "Dépôt…" : "Ajouter la pièce"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
