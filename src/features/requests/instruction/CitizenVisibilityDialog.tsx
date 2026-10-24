// Confirmation du changement de visibilité d'une demande dans l'espace usager.
//
// `AlertDialog` (focus piégé, Échap = annuler) : le geste retire la demande de
// la vue de l'usager. Le dialogue reste OUVERT tant que l'écriture n'a pas
// réussi : un refus de la garde SQL (`t14`, droit d'instruction manquant) se
// lit là où le geste a été fait.

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CitizenVisibilityView } from "./citizenVisibility";

interface Props {
  /** Vue de l'ÉTAT ACTUEL ; `null` ferme le dialogue. */
  view: CitizenVisibilityView | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function CitizenVisibilityDialog({ view, pending, error, onClose, onConfirm }: Props) {
  return (
    <AlertDialog open={view !== null} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <AlertDialogContent>
        {view ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{view.confirmTitle}</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{view.confirmBody}</p>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
              <Button type="button" disabled={pending} onClick={onConfirm}>
                {pending ? view.pendingLabel : view.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
