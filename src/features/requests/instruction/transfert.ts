// Transfert d'une demande vers un autre ORGANISME RESPONSABLE — logique pure.
//
// Deux questions, deux fonctions :
//   · `transferOptions` — QUI peut recevoir cette demande ? Les organismes du
//     sous-arbre Socle du tenant qui ont la démarche ACTIVÉE, et eux seuls.
//   · `transferConfirmation` — ce que la modale dit avant de valider.
//
// ⚠️ Ce module ne PROTÈGE rien. La vérité est côté serveur :
// `t12_requests_transfer_procedure_active` refuse un organisme qui n'assure
// pas la démarche, `requests_guard_write` exige l'instruction sur le couple
// actuel, et `t08_requests_apply_transfer` retire l'affectation devenue sans
// droit. Ici on ne fait que refléter — et surtout, PRÉVENIR : un transfert est
// un geste qu'on peut faire contre soi-même (perdre la demande de vue), il ne
// doit jamais surprendre.

import type { ActivationPair } from "../creation/proposables";
import { activationsByOrganisation } from "../creation/proposables";

export interface TransferOption {
  /** UUID Socle de l'organisation. */
  value: string;
  label: string;
  /** Organisme qui porte la demande aujourd'hui. */
  current: boolean;
}

export interface TransferOptionsInput {
  /** Miroir du sous-arbre Socle du tenant (`socle_organizations`). */
  organizations: readonly { value: string; label: string }[];
  /** Miroir des activations (`socle_procedure_organizations`). */
  activations: readonly ActivationPair[];
  /** Démarche de la demande — `null` pour une demande historique sans démarche. */
  procedureId: string | null;
  currentOrgId: string | null;
  currentLabel: string | null;
}

/**
 * Les organismes proposés au transfert.
 *
 * Trois règles :
 *  1. **Opt-in strict** — un organisme absent du miroir d'activations n'assure
 *     AUCUNE démarche ; il n'est pas proposé. C'est la règle du 2026-08-31,
 *     appliquée ici au transfert comme elle l'est au dépôt.
 *  2. Une demande **historique sans démarche** n'a rien à croiser : tout le
 *     sous-arbre lui est ouvert (le serveur ne garde rien non plus dans ce cas).
 *  3. L'organisme **actuel** figure toujours dans la liste, même s'il a perdu
 *     l'activation depuis ou a quitté le miroir : sans lui, le menu ne dirait
 *     plus où la demande se trouve. Il est marqué `current`, jamais une cible.
 */
export function transferOptions(input: TransferOptionsInput): TransferOption[] {
  const { organizations, activations, procedureId, currentOrgId, currentLabel } = input;
  const byOrg = activationsByOrganisation(activations);

  const options: TransferOption[] = [];
  for (const org of organizations) {
    const eligible = procedureId === null || (byOrg.get(org.value)?.has(procedureId) ?? false);
    if (!eligible && org.value !== currentOrgId) continue;
    options.push({ value: org.value, label: org.label, current: org.value === currentOrgId });
  }

  // L'organisme actuel a disparu du miroir (sortie du périmètre Socle) : on le
  // nomme quand même, avec le libellé figé sur la demande.
  if (currentOrgId !== null && !options.some((o) => o.value === currentOrgId)) {
    options.push({ value: currentOrgId, label: currentLabel ?? "Organisme inconnu", current: true });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export interface TransferConfirmationInput {
  /** Libellé de l'organisme porteur aujourd'hui (`null` : aucun désigné). */
  fromLabel: string | null;
  toLabel: string;
  /** L'auteur perdra la demande de vue (aucune consultation sur le couple cible). */
  losesAccess: boolean;
  /** Nom de l'agent affecté, s'il y en a un. */
  assignedName: string | null;
}

export interface TransferConfirmation {
  lead: string;
  /** Ce que l'auteur perd — `null` s'il garde l'accès. */
  accessWarning: string | null;
  /** Le sort de l'affectation — `null` si la demande n'est affectée à personne. */
  assignmentNotice: string | null;
}

/**
 * Le texte de la modale de confirmation.
 *
 * L'avertissement d'accès est le cœur du dialogue : transférer vers un
 * organisme où l'on n'a aucun droit est LÉGITIME (RM-19 : se dessaisir), mais
 * c'est irréversible pour son auteur — il ne pourra pas revenir en arrière
 * puisqu'il ne verra plus la demande. On le dit avant, jamais après.
 *
 * Le sort de l'affectation est énoncé comme une RÈGLE, pas comme un pronostic :
 * le navigateur ne connaît pas les droits des autres agents (aucune surface ne
 * les lui expose, et c'est très bien ainsi). C'est le serveur qui tranchera.
 */
export function transferConfirmation(input: TransferConfirmationInput): TransferConfirmation {
  const { fromLabel, toLabel, losesAccess, assignedName } = input;
  const from = fromLabel?.trim();

  const lead = from
    ? `La demande est actuellement affectée à : ${from}. À la validation, la demande sera transférée à : ${toLabel}.`
    : `La demande n'est actuellement affectée à aucun organisme. À la validation, la demande sera transférée à : ${toLabel}.`;

  return {
    lead,
    accessWarning: losesAccess
      ? `Vous n'avez pas les droits de consultation sur ce type de démarche pour ${toLabel}. `
        + "En conséquence, vous perdrez l'accès à cette demande."
      : null,
    assignmentNotice: assignedName
      ? `Si ${assignedName} n'a pas le droit d'instruction sur cette démarche pour ${toLabel}, `
        + "son affectation sera retirée."
      : null,
  };
}
