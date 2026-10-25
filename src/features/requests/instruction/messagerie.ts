// Messagerie de l'usager sur SA demande (décision PO du 2026-10-25) : FERMÉE
// par défaut, ouverte quand le service attend une réponse, refermée par la
// réponse — une ouverture = une réponse.
//
// La vérité vit en base (`request_citizen_reply_state`, migration
// 20261025160000) : `set_citizen_replies_open` (le bouton), la qualification
// d'une pièce non conforme, l'envoi avec « Attendre une réponse », la réponse
// de l'usager et la clôture (t42) sont les seules à l'écrire. Ce module ne fait
// que la LIRE et la dire ; ses refus reflètent ceux du serveur.

export type ReplyOpenReason = "non_conformite" | "message" | "agent" | "reprise";
export type ReplyCloseReason = "reponse_usager" | "agent" | "demande_close";

export interface CitizenReplyState {
  is_open: boolean;
  opened_at: string | null;
  opened_reason: string | null;
  closed_at: string | null;
  closed_reason: string | null;
}

/** Pourquoi elle s'est ouverte — complète « Messagerie ouverte … ». */
export const REPLY_OPEN_REASON_LABELS: Record<ReplyOpenReason, string> = {
  non_conformite: "une pièce a été déclarée non conforme",
  message: "un message attend la réponse de l'usager",
  agent: "ouverte par un agent",
  reprise: "la demande attendait une information",
};

/** Pourquoi elle s'est refermée. */
export const REPLY_CLOSE_REASON_LABELS: Record<ReplyCloseReason, string> = {
  reponse_usager: "l'usager a répondu",
  agent: "fermée par un agent",
  demande_close: "la demande a été close",
};

const CLOSED_STATUSES = new Set(["resolue_positive", "resolue_negative", "annulee", "archivee"]);

export interface RepliesView {
  open: boolean;
  /** « Messagerie de l'usager ouverte » / « … fermée ». */
  title: string;
  /** Ce qui l'a mise dans cet état, ou la règle quand rien ne s'est passé. */
  detail: string;
}

/**
 * Ce que l'onglet Échanges dit de la messagerie. Une demande close est dite
 * fermée quoi que porte la ligne : le serveur refuse tout message (P0409).
 */
export function repliesView(state: CitizenReplyState | null | undefined, status: string): RepliesView {
  const open = Boolean(state?.is_open) && !CLOSED_STATUSES.has(status);
  if (open) {
    const reason = REPLY_OPEN_REASON_LABELS[state!.opened_reason as ReplyOpenReason];
    return {
      open,
      title: "Messagerie de l'usager ouverte",
      detail: `L'usager peut répondre une fois en ligne${reason ? ` : ${reason}` : ""}. Sa réponse refermera la messagerie.`,
    };
  }
  const reason = state?.closed_reason ? REPLY_CLOSE_REASON_LABELS[state.closed_reason as ReplyCloseReason] : null;
  return {
    open,
    title: "Messagerie de l'usager fermée",
    detail: reason
      ? `Elle s'est refermée : ${reason}. L'usager ne peut pas écrire tant qu'elle n'est pas rouverte.`
      : "L'usager ne peut pas écrire en ligne : la messagerie s'ouvre quand une pièce est déclarée non conforme, ou quand vous attendez sa réponse.",
  };
}

/**
 * Le bouton « Ouvrir / Fermer » : `null` quand il est permis, sinon la raison.
 * Reflet de `set_citizen_replies_open` (droit d'instruction ; une demande close
 * ne s'ouvre pas, la fermer reste permis).
 */
export function repliesToggleBlocked(input: { open: boolean; status: string; canInstruct: boolean }): string | null {
  if (!input.canInstruct) return "Ouvrir ou fermer la messagerie exige le droit d'instruction sur cette demande.";
  if (!input.open && CLOSED_STATUSES.has(input.status)) return "La demande est close : elle ne reçoit plus de message.";
  return null;
}

/** Libellé du journal (`messagerie_usager_ouverte` / `messagerie_usager_fermee`). */
export function repliesEventLabel(eventType: string, motif: unknown): { label: string; reason: string | null } | null {
  if (eventType === "messagerie_usager_ouverte") {
    return {
      label: "Messagerie de l'usager ouverte",
      reason: REPLY_OPEN_REASON_LABELS[motif as ReplyOpenReason] ?? null,
    };
  }
  if (eventType === "messagerie_usager_fermee") {
    return {
      label: "Messagerie de l'usager fermée",
      reason: REPLY_CLOSE_REASON_LABELS[motif as ReplyCloseReason] ?? null,
    };
  }
  return null;
}
