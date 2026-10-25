// Ce que l'usager recevra d'un message de l'agent (B12, lot L4c-3, « M2 ») —
// LOGIQUE PURE, testée.
//
// C'est le SERVEUR qui décide (`send-request-email`, ADR-10) : publié dans
// l'espace de l'usager quand la collectivité a allumé ses avis et qu'un canal
// en ligne voit la demande, sinon envoyé en entier par courriel, comme avant.
// L'écran l'ANNONCE avant l'envoi (aperçu) et dit, après, ce qui s'est
// réellement passé — la réponse de l'envoi fait foi si elle diffère.

export type EmailDelivery = "espace" | "courriel" | "aucune";

export interface EmailDeliveryPreview {
  delivery: EmailDelivery;
  /** Le canal qui verra le message publié : compte du portail, ou suivi par code. */
  target: "compte" | "invite" | null;
}

/** Tant que l'aperçu n'est pas revenu : ne rien annoncer de faux (recette du 2026-10-25). */
export const DELIVERY_PENDING_NOTICE = "Vérification de la façon dont l'usager recevra ce message…";

/**
 * La phrase du pied du composeur. `pending` = aperçu en cours : on l'attend
 * plutôt que d'annoncer un courriel complet qui sera peut-être une publication.
 * `undefined` sans `pending` = aperçu en panne : le texte d'avant (le serveur
 * tranchera à l'envoi, et la confirmation dira ce qu'il a fait).
 */
export function deliveryNotice(preview: EmailDeliveryPreview | undefined, usagerName: string, pending = false): string {
  if (pending) return DELIVERY_PENDING_NOTICE;
  if (preview?.delivery === "espace") {
    const where = preview.target === "compte" ? "son espace sur le portail" : "son suivi en ligne";
    return `Le message sera publié dans ${where} : ${usagerName} recevra un courriel avec ses premiers mots et un lien.`;
  }
  return `Variables fusionnées avec la fiche de ${usagerName} — l'usager reçoit le texte affiché, et ne pourra pas y répondre.`;
}

/** La confirmation après l'envoi, d'après ce que le serveur a fait. */
export function sentNotice(result: { delivery?: string; replies_open?: boolean } | undefined): string {
  const sent = result?.delivery === "espace"
    ? "Message publié dans l'espace de l'usager. Il en sera averti par courriel."
    : "Message envoyé à l'usager.";
  // `replies_open` n'est rendu que si l'agent attendait une réponse.
  if (result?.replies_open === true) return `${sent} Sa messagerie est ouverte : il peut répondre une fois en ligne.`;
  if (result?.replies_open === false) return `${sent} ⚠️ La messagerie n'a pas pu être ouverte : ouvrez-la depuis l'onglet Échanges.`;
  return sent;
}

/**
 * Pourquoi un avis n'est pas parti — jumeau, côté écran, du catalogue fermé
 * `SKIP_REASONS` (`supabase/functions/_shared/citizenNotices/decision.ts`).
 */
export const NOTICE_REASON_LABELS: Record<string, string> = {
  interrupteur: "les avis à l'usager de la collectivité sont éteints",
  evenement_non_retenu: "ce changement de statut ne donne pas lieu à un avis",
  couvert_par_avis_cloture: "la résolution est annoncée par l'avis de clôture",
  aucun_changement: "la demande est revenue au statut que l'usager connaissait",
  preference: "l'usager a demandé à ne plus être prévenu",
  aucun_acces_en_ligne: "l'usager ne suit pas sa demande en ligne",
  adresse_compte_differente: "l'adresse de la fiche n'est pas celle de son compte sur le portail",
  masquee: "la demande est masquée à l'usager",
  clara: "la demande est issue de Clara",
  pas_d_adresse: "aucune adresse de courriel",
  pas_de_relais: "aucun serveur d'envoi n'est configuré",
};

export function noticeReasonLabel(notice: { status: string; reason: string | null; error: string | null }): string {
  if (notice.status === "failed") return `échec de l'envoi${notice.error ? ` (${notice.error})` : ""}`;
  return (notice.reason && NOTICE_REASON_LABELS[notice.reason]) ?? "raison inconnue";
}
