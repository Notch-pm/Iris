// Cycle de vie des demandes — miroir EXACT de la garde SQL
// requests_guard_transition (migration 20260820100100_requests.sql).
// ⚠️ Ce module ne PROTÈGE rien : la vérité est dans le trigger Postgres.
// Il ne sert qu'à refléter dans l'UI ce que le serveur acceptera.

export type RequestStatus =
  | "a_traiter"
  | "en_instruction"
  | "en_attente"
  | "annulee"
  | "resolue_positive"
  | "resolue_negative"
  | "archivee";

export type MemberRole = "admin" | "superviseur" | "agent" | "lecteur";

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

export function isFinal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status) || status === "archivee";
}

export interface TransitionSpec {
  to: RequestStatus;
  /** Libellé du bouton d'action. */
  label: string;
  /** Un agent assigné est exigé par la garde SQL. */
  needsAssignee?: boolean;
  /** Le texte de clôture destiné à l'usager est exigé. */
  needsClosureText?: boolean;
  /** Motifs acceptés par la garde SQL (undefined = pas de motif ; [] interdit). */
  motifChoices?: ClosureMotif[];
  /** Le motif est-il obligatoire ? */
  motifRequired?: boolean;
}

const WRITER_ROLES: MemberRole[] = ["admin", "superviseur", "agent"];

/**
 * Transitions que la garde SQL acceptera pour ce statut et ce rôle.
 * NB : le motif « doublon » exige une demande maître — non proposé par l'UI
 * pour l'instant (le rapprochement de doublons viendra avec son propre geste).
 */
export function allowedTransitions(status: RequestStatus, role: MemberRole): TransitionSpec[] {
  if (!WRITER_ROLES.includes(role)) return [];
  const isSupervisor = role === "superviseur" || role === "admin";
  const isAdmin = role === "admin";

  switch (status) {
    case "a_traiter":
      return [
        { to: "en_instruction", label: "Prendre en charge", needsAssignee: true },
        {
          to: "resolue_negative",
          label: "Clore (irrecevable / réorientation)",
          needsClosureText: true,
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
          needsClosureText: true,
        },
        {
          to: "resolue_negative",
          label: "Résoudre négativement",
          needsClosureText: true,
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
    case "resolue_negative": {
      const out: TransitionSpec[] = [];
      if (isSupervisor) out.push({ to: "en_instruction", label: "Rouvrir" });
      if (isAdmin) out.push({ to: "archivee", label: "Archiver" });
      return out;
    }
    case "archivee":
      return isAdmin
        ? [
            { to: "resolue_positive", label: "Désarchiver (résolue positivement)" },
            { to: "resolue_negative", label: "Désarchiver (résolue négativement)" },
            { to: "annulee", label: "Désarchiver (annulée)" },
          ]
        : [];
  }
}

/** Un utilisateur peut-il écrire (créer, affecter, annoter) ? Le lecteur, jamais. */
export function canWrite(role: MemberRole): boolean {
  return WRITER_ROLES.includes(role);
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
  if (spec.needsClosureText) {
    if (!input.closureText || input.closureText.trim() === "") {
      return { ok: false, message: "Le texte de clôture destiné à l'usager est obligatoire." };
    }
    update.closure_text = input.closureText.trim();
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
