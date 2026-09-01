// Confirmation d'un transfert d'organisme responsable.
//
// `AlertDialog` et non `Dialog` : le geste n'efface rien, mais il est
// IRRÉVERSIBLE POUR SON AUTEUR dès qu'il n'a aucun droit sur l'organisme cible
// — il ne pourra pas revenir en arrière puisqu'il ne verra plus la demande. La
// sortie passe donc par une action explicite, jamais par une croix.
//
// Le dialogue reste OUVERT tant que la mutation n'a pas réussi : un refus de
// la garde SQL (démarche non activée pour la cible, droit d'instruction
// manquant) doit se lire là où le geste a été fait.

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { transferConfirmation, type TransferConfirmationInput } from "./transfert";

interface Props {
  /** La cible visée ; `null` ferme le dialogue. */
  target: (TransferConfirmationInput & { orgId: string }) | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (orgId: string) => void;
}

export function TransfertDialog({ target, pending, error, onClose, onConfirm }: Props) {
  const text = target ? transferConfirmation(target) : null;

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <AlertDialogContent>
        {target && text ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Transférer la demande ?</AlertDialogTitle>
            </AlertDialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{text.lead}</p>

              {text.accessWarning ? (
                <p
                  role="alert"
                  className="rounded-xl bg-destructive/5 p-3 text-sm font-semibold text-destructive"
                >
                  {text.accessWarning}
                </p>
              ) : null}

              {text.assignmentNotice ? (
                <p className="rounded-xl bg-secondary/25 p-3 text-[13px] text-secondary-foreground">
                  {text.assignmentNotice}
                </p>
              ) : null}

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
              <Button type="button" disabled={pending} onClick={() => onConfirm(target.orgId)}>
                {pending ? "Transfert…" : "Transférer"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
