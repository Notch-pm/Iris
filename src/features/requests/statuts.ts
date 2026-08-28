// Cycle de vie des demandes — miroir EXACT de la garde SQL
// requests_guard_transition (migration 20260820100100_requests.sql).
// ⚠️ Ce module ne PROTÈGE rien : la vérité est dans le trigger Postgres.
// Il ne sert qu'à refléter dans l'UI ce que le serveur acceptera.
//
// Bascule vers les profils de droits (ADR-07, `requests_guard_write`) :
// `allowedTransitionsFor(status, rr)` est le nouveau miroir, gouverné par les
// droits effectifs sur le couple (organisation porteuse, démarche) plutôt que
// par le rôle. `allowedTransitions(status, role)` et `canWrite(role)` restent
// en place, dépréciés, le temps de basculer les pages (voir CLAUDE.md racine).

import type { Right } from "@/features/rights/rights";

export type RequestStatus =
  | "a_traiter"
  | "en_instruction"
  | "en_attente"
  | "annulee"
  | "resolue_positive"
  | "resolue_negative"
  | "archivee";

// Deux rôles seulement (décision PO 2026-08-20) : l'administrateur voit tout
// (paramètres, réouverture, archivage), l'agent instruit sans les paramètres.
export type MemberRole = "administrateur" | "agent";

export type ClosureMotif =
  | "irrecevable"
  | "abandon"
  | "retrait_usager"
  | "doublon"
  | "reorientation";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  a_traiter: "À traiter",
  en_instruction: "En cours d'instruction",
  en_attente: "En attente d'information",
  annulee: "Annulée",
  resolue_positive: "Résolue positivement",
  resolue_negative: "Résolue négativement",
  archivee: "Archivée",
};

export const MOTIF_LABELS: Record<ClosureMotif, string> = {
  irrecevable: "Irrecevable",
  abandon: "Abandon (sans réponse de l'usager)",
  retrait_usager: "Retrait par l'usager",
  doublon: "Doublon",
  reorientation: "Réorientation hors périmètre",
};

export const PRIORITY_LABELS: Record<string, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

export const IDENTITY_LABELS: Record<string, string> = {
  rapprochee: "Usager rapproché",
  non_rapprochee: "Identité déclarée",
  anonyme: "Anonyme",
};

export const TERMINAL_STATUSES: RequestStatus[] = ["annulee", "resolue_positive", "resolue_negative"];

/**
 * « En cours » = ni close ni archivée. Les deux listes partitionnent les 7
 * statuts du workflow et vivent ICI, avec la matrice de transitions, plutôt
 * qu'au fil des écrans qui s'en servent (carte, tableau).
 */
export const OPEN_STATUSES: readonly RequestStatus[] = ["a_traiter", "en_instruction", "en_attente"];

export const CLOSED_STATUSES: readonly RequestStatus[] = [
  "resolue_positive",
  "resolue_negative",
  "annulee",
  "archivee",
];

export function isFinal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status) || status === "archivee";
}

export interface TransitionSpec {
  to: RequestStatus;
  /** Libellé du bouton d'action. */
  label: string;
  /** Un agent assigné est exigé par la garde SQL. */
  needsAssignee?: boolean;
  /**
   * Le dialogue PROPOSE le texte de clôture destiné à l'usager.
   * ⚠️ Il n'est plus OBLIGATOIRE depuis le 2026-08-28 (décision PO) : la garde
   * SQL ne l'exige plus, et l'avis de clôture envoyé à l'usager se tient sans
   * commentaire (`_shared/email/cloture.ts`). D'où `asks…` et non `needs…`.
   */
  asksClosureText?: boolean;
  /** Motifs acceptés par la garde SQL (undefined = pas de motif ; [] interdit). */
  motifChoices?: ClosureMotif[];
  /** Le motif est-il obligatoire ? */
  motifRequired?: boolean;
}

const WRITER_ROLES: MemberRole[] = ["administrateur", "agent"];

/**
 * Catalogue COMPLET des transitions envisageables pour ce statut, indépendant
 * de tout rôle ou droit — c'est la garde (assigné, motifs)
 * qui varie par transition, jamais par qui la déclenche. `allowedTransitions`
 * et `allowedTransitionsFor` filtrent ce catalogue chacun à sa façon.
 * NB : le motif « doublon » exige une demande maître — non proposé par l'UI
 * pour l'instant (le rapprochement de doublons viendra avec son propre geste).
 */
function transitionCatalogFor(status: RequestStatus): TransitionSpec[] {
  switch (status) {
    case "a_traiter":
      return [
        { to: "en_instruction", label: "Prendre en charge", needsAssignee: true },
        {
          to: "resolue_negative",
          label: "Clore (irrecevable / réorientation)",
          asksClosureText: true,
          motifChoices: ["irrecevable", "reorientation"],
          motifRequired: true,
        },
        {
          to: "annulee",
          label: "Annuler",
          motifChoices: ["abandon", "retrait_usager"],
          motifRequired: true,
        },
      ];
    case "en_instruction":
      return [
        {
          to: "en_attente",
          label: "Mettre en attente d'information",
        },
        {
          to: "resolue_positive",
          label: "Résoudre positivement",
          asksClosureText: true,
        },
        {
          to: "resolue_negative",
          label: "Résoudre négativement",
          asksClosureText: true,
          motifChoices: ["irrecevable", "reorientation"],
        },
        {
          to: "annulee",
          label: "Annuler",
          motifChoices: ["abandon", "retrait_usager"],
          motifRequired: true,
        },
        { to: "a_traiter", label: "Renvoyer à qualifier" },
      ];
    case "en_attente":
      return [
        { to: "en_instruction", label: "Reprendre l'instruction" },
        {
          to: "annulee",
          label: "Annuler (abandon)",
          motifChoices: ["abandon", "retrait_usager"],
          motifRequired: true,
        },
      ];
    case "annulee":
    case "resolue_positive":
    case "resolue_negative":
      return [
        { to: "en_instruction", label: "Rouvrir" },
        { to: "archivee", label: "Archiver" },
      ];
    case "archivee":
      return [
        { to: "resolue_positive", label: "Désarchiver (résolue positivement)" },
        { to: "resolue_negative", label: "Désarchiver (résolue négativement)" },
        { to: "annulee", label: "Désarchiver (annulée)" },
      ];
  }
}

/**
 * Droit exigé par la garde SQL pour une transition donnée (`requests_guard_write`,
 * ADR-07) : réouverture / archivage / désarchivage exigent `clôture` ET
 * l'administration sur l'organisation de la demande ; les allers-retours entre
 * `a_traiter`/`en_instruction`/`en_attente` exigent `instruction` ; le reste
 * (résolutions, annulation) exige `clôture`.
 */
function requiredGateFor(from: RequestStatus, to: RequestStatus): { right: Right; needsAdmin: boolean } {
  const isReopen = TERMINAL_STATUSES.includes(from) && to === "en_instruction";
  const isArchive = to === "archivee";
  const isUnarchive = from === "archivee";
  if (isReopen || isArchive || isUnarchive) return { right: "cloture", needsAdmin: true };

  const isInstructionMove =
    (from === "a_traiter" && to === "en_instruction") ||
    (from === "en_instruction" && to === "en_attente") ||
    (from === "en_attente" && to === "en_instruction") ||
    (from === "en_instruction" && to === "a_traiter");
  if (isInstructionMove) return { right: "instruction", needsAdmin: false };

  return { right: "cloture", needsAdmin: false };
}

/**
 * @deprecated Vestige du rôle binaire agent/administrateur (décision PO
 * 2026-08-20), remplacé par les profils de droits. Conservé, wrappé sur
 * `allowedTransitionsFor`, le temps de basculer les pages qui l'appellent
 * encore (voir CLAUDE.md racine, invariant « profils de droits »).
 */
export function allowedTransitions(status: RequestStatus, role: MemberRole): TransitionSpec[] {
  if (!WRITER_ROLES.includes(role)) return [];
  return allowedTransitionsFor(status, { rights: WRITER_RIGHTS, isAdmin: role === "administrateur" });
}

/** Droits effectifs d'un utilisateur sur le couple (organisation porteuse, démarche) d'une demande. */
export interface RequestRights {
  rights: Set<Right>;
  /** Administration sur l'organisation de la demande (RM-20 à RM-24) — n'accorde par elle-même aucun droit. */
  isAdmin: boolean;
}

/** Les quatre droits, utilisés par le wrapper déprécié `allowedTransitions` pour les deux rôles historiques. */
const WRITER_RIGHTS = new Set<Right>(["consultation", "creation", "instruction", "cloture"]);

/**
 * Transitions que la garde SQL acceptera pour ce statut, compte tenu des
 * droits effectifs `rr` sur le couple (organisation porteuse, démarche) de la
 * demande — miroir EXACT de `requests_guard_write` (ADR-07). Remplace
 * `allowedTransitions(status, role)`.
 */
export function allowedTransitionsFor(status: RequestStatus, rr: RequestRights): TransitionSpec[] {
  return transitionCatalogFor(status).filter((t) => {
    const gate = requiredGateFor(status, t.to);
    if (gate.needsAdmin && !rr.isAdmin) return false;
    return rr.rights.has(gate.right);
  });
}

/**
 * @deprecated Vestige du rôle binaire — voir `allowedTransitions`. Utiliser
 * `canWriteWith(rr)`.
 */
export function canWrite(role: MemberRole): boolean {
  return WRITER_ROLES.includes(role);
}

/** RM-15 : écrire une note interne exige au moins un droit d'écriture (création, instruction ou clôture). */
export function canWriteWith(rr: RequestRights): boolean {
  return rr.rights.has("creation") || rr.rights.has("instruction") || rr.rights.has("cloture");
}

/** RM-13 : affectation, édition du dossier, requalification — exigent le droit d'instruction. */
export function canProcessWith(rr: RequestRights): boolean {
  return rr.rights.has("instruction");
}

/** RM-20 à RM-24 : administration sur l'organisation de la demande (paramètres, réouverture, archivage). */
export function canAdminWith(rr: RequestRights): boolean {
  return rr.isAdmin;
}

/**
 * Une transition demande-t-elle un dialogue avant d'être appliquée ? Vrai dès
 * qu'il manque une information que seul l'agent peut donner : commentaire pour
 * l'usager, motif de clôture, ou assigné quand aucun ne se déduit. Sinon le
 * geste s'applique directement (« Prendre en charge » sur son propre nom).
 *
 * Partagé par la fiche (`useTransitionRunner`) et le tableau des demandes
 * (`tableau/useBoardTransition`) : deux écrans, une seule règle.
 */
export function needsTransitionDialog(spec: TransitionSpec, defaultAssignee: string): boolean {
  if (spec.asksClosureText) return true;
  if (spec.motifChoices && spec.motifChoices.length > 0) return true;
  return Boolean(spec.needsAssignee) && defaultAssignee === "";
}

/** Construit le payload de mise à jour d'une transition (les gardes SQL revalident tout). */
export function buildTransitionUpdate(
  spec: TransitionSpec,
  input: { closureText?: string; motif?: ClosureMotif; assigneeId?: string | null },
): { ok: true; update: Record<string, unknown> } | { ok: false; message: string } {
  const update: Record<string, unknown> = { status: spec.to };
  if (spec.needsAssignee) {
    if (!input.assigneeId) return { ok: false, message: "Un agent assigné est obligatoire." };
    update.assigned_to = input.assigneeId;
  }
  if (spec.asksClosureText) {
    // Facultatif (décision PO 2026-08-28). Écrit EXPLICITEMENT à null quand il
    // est vide plutôt que laissé de côté : sur une demande rouverte puis
    // reclose, omettre la colonne y laisserait le commentaire de la clôture
    // précédente — que l'usager recevrait comme s'il venait d'être écrit.
    const text = (input.closureText ?? "").trim();
    update.closure_text = text === "" ? null : text;
  }
  if (spec.motifChoices && spec.motifChoices.length > 0) {
    if (input.motif && !spec.motifChoices.includes(input.motif)) {
      return { ok: false, message: "Motif non autorisé pour cette transition." };
    }
    if (spec.motifRequired && !input.motif) {
      return { ok: false, message: "Le motif est obligatoire." };
    }
    if (input.motif) update.closure_motif = input.motif;
  }
  return { ok: true, update };
}
