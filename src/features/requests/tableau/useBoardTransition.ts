// Transition depuis le tableau des demandes. Même règle que la fiche
// (`useTransitionRunner`), mais la demande visée n'est connue qu'au moment du
// geste : elle change à chaque glisser-déposer, et le dialogue est monté une
// seule fois pour tout le tableau.
//
// La garde SQL reste seule juge : ce hook n'anticipe rien, il applique et
// affiche le refus tel quel.

import * as React from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { needsTransitionDialog, type TransitionSpec } from "../statuts";
import type { TransitionDialogRunner, TransitionInput } from "../TransitionActions";
import { useApplyTransition } from "../useRequests";
import type { BoardCardView } from "./tableau";

export interface BoardTransition {
  /** Demande visée par le geste en cours — sous-titre du dialogue, assignés éligibles. */
  card: BoardCardView | null;
  /** Demande en cours d'application : sa carte reste visible, mais figée. */
  pendingId: string | null;
  /** Refus de la garde, quand aucun dialogue n'est ouvert pour le porter. */
  bannerError: string | null;
  dismissError: () => void;
  runner: TransitionDialogRunner;
  /** Lance la transition : dialogue si des informations manquent, sinon application directe. */
  start: (card: BoardCardView, spec: TransitionSpec) => void;
}

export function useBoardTransition(opts: {
  onDone: (card: BoardCardView, spec: TransitionSpec) => void;
}): BoardTransition {
  const { session } = useAuth();
  const apply = useApplyTransition();
  const { onDone } = opts;
  // `card` porte la demande du geste en cours ; `active` n'est renseigné que
  // lorsqu'un dialogue doit s'ouvrir (une application directe n'en ouvre pas).
  const [card, setCard] = React.useState<BoardCardView | null>(null);
  const [active, setActive] = React.useState<TransitionSpec | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const assigneeFor = React.useCallback(
    (target: BoardCardView) => target.assignedTo ?? session?.user.id ?? "",
    [session],
  );

  const apply_ = apply.mutateAsync;
  const runOn = React.useCallback(
    async (target: BoardCardView, spec: TransitionSpec, input: TransitionInput) => {
      setError(null);
      setPendingId(target.id);
      try {
        await apply_({ requestId: target.id, spec, ...input });
        setActive(null);
        setCard(null);
        onDone(target, spec);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transition refusée.");
      } finally {
        setPendingId(null);
      }
    },
    [apply_, onDone],
  );

  const start = React.useCallback(
    (target: BoardCardView, spec: TransitionSpec) => {
      setError(null);
      setCard(target);
      const defaultAssignee = assigneeFor(target);
      if (needsTransitionDialog(spec, defaultAssignee)) {
        setActive(spec);
        return;
      }
      setActive(null);
      // Prise en charge directe : l'agent courant devient l'assigné si personne ne l'est.
      void runOn(target, spec, { assigneeId: spec.needsAssignee ? defaultAssignee : undefined });
    },
    [assigneeFor, runOn],
  );

  const close = React.useCallback(() => {
    setActive(null);
    setCard(null);
    setError(null);
  }, []);

  // Le dialogue ne connaît que la transition ouverte : la demande visée lui est
  // passée à part (sous-titre), puisqu'il en instruit une différente à chaque fois.
  const run = React.useCallback(
    (spec: TransitionSpec, input: TransitionInput) =>
      card ? runOn(card, spec, input) : Promise.resolve(),
    [card, runOn],
  );

  return {
    card,
    pendingId,
    // Un refus sans dialogue ouvert (transition directe) n'a nulle part où
    // s'afficher : le tableau le remonte alors en bandeau.
    bannerError: active === null ? error : null,
    dismissError: () => setError(null),
    runner: {
      active,
      run,
      close,
      pending: apply.isPending,
      error,
      defaultAssignee: card ? assigneeFor(card) : "",
    },
    start,
  };
}
