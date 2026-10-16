// Ce qui suit une transition réussie : l'avis de clôture à l'usager.
//
// UNE seule implémentation pour la fiche, la fiche mobile et le tableau des
// demandes (retour PO 2026-10-16 : « les changements d'état doivent avoir le
// même comportement ») — le tableau, qui avait sa propre suite, résolvait sans
// jamais prévenir l'usager alors que son dialogue l'annonçait.
//
// Une résolution PRÉVIENT l'usager (décision PO 2026-08-28) : l'avis part juste
// après, composé par le serveur depuis l'état enregistré — sauf pour une demande
// issue de Clara, qui ne reçoit rien d'Iris (`closureNoticeApplies`).
//
// ⚠️ L'envoi SUIT la transition, il ne la conditionne pas. La demande est
// résolue quoi qu'il arrive ; un échec s'affiche comme tel, sans laisser croire
// que la clôture a échoué. Le cas le plus courant — aucune adresse au dossier —
// n'est pas une erreur : c'est un fait qu'on énonce.

import * as React from "react";
import { closureNoticeApplies, isClosureOutcome } from "@fn/_shared/email/cloture";
import type { EdgeError } from "@/lib/edge";
import { STATUS_LABELS, type RequestStatus } from "./statuts";
import { useSendClosureEmail } from "./instruction/useSendRequestEmail";

export interface ClosureNoticeTarget {
  id: string;
  /** `requests.source` — `clara` n'appelle aucun avis. */
  source: string | null | undefined;
}

export function useClosureNotice(opts: {
  /** Toast de l'écran. */
  flash: (text: string) => void;
  /** Échec de l'avis : la demande est bien close, l'écran le porte en bandeau. */
  onFailure: (message: string) => void;
}) {
  const { flash, onFailure } = opts;
  const send = useSendClosureEmail().mutateAsync;

  /** `done` : le toast de la transition elle-même (chaque écran a le sien). */
  return React.useCallback(
    (target: ClosureNoticeTarget, to: RequestStatus, done: string) => {
      if (!isClosureOutcome(to) || !closureNoticeApplies(target.source)) {
        flash(done);
        return;
      }
      flash(`${done} — envoi de l'avis à l'usager…`);
      send({ requestId: target.id })
        .then(() => flash(`${done} — l'usager a été prévenu par courriel.`))
        .catch((err: unknown) => {
          const code = (err as EdgeError | null)?.code;
          if (code === "no_recipient") {
            flash(`${done} — aucun courriel : la demande ne porte pas d'adresse.`);
            return;
          }
          flash(done);
          onFailure(
            `La demande est bien ${STATUS_LABELS[to].toLowerCase()}, mais l'avis n'a pas pu partir : `
              + (err instanceof Error ? err.message : "envoi impossible."),
          );
        });
    },
    [flash, onFailure, send],
  );
}
