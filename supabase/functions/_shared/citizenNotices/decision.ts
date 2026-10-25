// Avis à l'usager (B12) — LA règle de décision. Module PUR, testé.
//
// Seule porte du « faut-il prévenir ? » pour un événement de statut. En V1, un
// DÉFAUT FIXE (tableau Q4 du cadrage, décision PO du 2026-10-24) ; au second
// temps, `settings` portera le réglage par collectivité puis par démarche
// (ADR-8) — d'où `socleProcedureId` dans l'entrée, déjà, sans usage.

import type { CitizenEvent } from "./events.ts";

/** Le catalogue FERMÉ des raisons de non-envoi — jumeau de la contrainte `citizen_notices.reason`. */
export const SKIP_REASONS = [
  "interrupteur",
  "evenement_non_retenu",
  "couvert_par_avis_cloture",
  "aucun_changement",
  "preference",
  "aucun_acces_en_ligne",
  "adresse_compte_differente",
  "masquee",
  "clara",
  "pas_d_adresse",
  "pas_de_relais",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Défaut V1 : ce que l'usager doit savoir ; le reste est interne ou couvert ailleurs. */
export const DEFAULT_SENT_EVENTS: ReadonlySet<CitizenEvent> = new Set([
  "prise_en_charge",
  "attente_information",
  "reprise_instruction",
  "annulation",
  "reouverture",
]);

export interface DecisionInput {
  event: CitizenEvent;
  organizationId: string;
  socleProcedureId: string | null;
  /** Second temps (ADR-8) : réglage par événement. Ignoré en V1. */
  settings?: unknown;
}

export type Decision = { send: true } | { send: false; reason: SkipReason };

export function shouldSend(input: DecisionInput): Decision {
  if (input.event === "aucun_changement") return { send: false, reason: "aucun_changement" };
  // Ne jamais envoyer deux courriels pour une résolution : l'avis de clôture est la réponse.
  if (input.event === "resolution") return { send: false, reason: "couvert_par_avis_cloture" };
  return DEFAULT_SENT_EVENTS.has(input.event) ? { send: true } : { send: false, reason: "evenement_non_retenu" };
}
