// Avis automatiques à l'usager (B12) — LOGIQUE PURE, testée. Composés par le
// SERVEUR, jamais par le navigateur.
//
// Un avis n'est pas un message : il dit QU'IL S'EST PASSÉ quelque chose, et où
// le lire. Il porte la référence, le nom de la démarche, le statut tel que
// l'usager le lit, un lien vers sa demande et un lien de désinscription.
// ⚠️ Jamais l'objet saisi par l'usager (il peut porter des données
// personnelles), ni un commentaire, ni un motif, ni le nom d'un agent.
// Seule exception, décidée par le PO (n° 1, 2026-10-24) : l'avis « nouveau
// message » (lot L4c-3) porte un EXTRAIT du message — `messageExcerpt`.

import type { EmailContent } from "./template.ts";
import { CITIZEN_STATUS_LABELS, type CitizenEvent } from "../citizenNotices/events.ts";

/** Les événements qui donnent lieu à un avis (défaut V1, `decision.ts`). */
export type NoticeEvent = Extract<
  CitizenEvent,
  "prise_en_charge" | "attente_information" | "reprise_instruction" | "annulation" | "reouverture"
>;

export interface StatusNoticeInput {
  event: NoticeEvent;
  /** Statut courant de la demande, lu par l'usager via `CITIZEN_STATUS_LABELS`. */
  status: string;
  reference: string;
  procedureName: string | null;
  /** Page de la demande (espace usager ou suivi invité). */
  url: string;
  /** Page de désinscription du portail ; omise si elle n'a pu être construite. */
  unsubscribeUrl: string | null;
  tenantName: string | null;
}

export interface StatusNotice {
  /** Ce qu'enregistre l'onglet Échanges (texte brut, liens compris). */
  subject: string;
  body: string;
  /** Ce qui part : le même texte, avec un bouton. */
  content: EmailContent;
}

const WHAT: Record<NoticeEvent, { subject: (ref: string) => string; line: (demande: string) => string }> = {
  prise_en_charge: {
    subject: (ref) => `Votre demande ${ref} est en cours de traitement`,
    line: (d) => `${d} est désormais prise en charge par nos services.`,
  },
  attente_information: {
    subject: (ref) => `Votre demande ${ref} attend votre réponse`,
    line: (d) => `Nos services ont besoin d'un complément pour poursuivre le traitement de ${d.charAt(0).toLowerCase()}${d.slice(1)}. Consultez-la en ligne pour savoir ce qui vous est demandé.`,
  },
  reprise_instruction: {
    subject: (ref) => `Votre demande ${ref} est de nouveau en cours de traitement`,
    line: (d) => `${d} est de nouveau en cours de traitement.`,
  },
  annulation: {
    subject: (ref) => `Votre demande ${ref} a été annulée`,
    line: (d) => `${d} a été annulée.`,
  },
  reouverture: {
    subject: (ref) => `Votre demande ${ref} a été rouverte`,
    line: (d) => `${d} a été rouverte : elle est de nouveau en cours de traitement.`,
  },
};

const CTA_LABEL = "Voir ma demande";

export function statusNoticeEmail(input: StatusNoticeInput): StatusNotice {
  const procedure = (input.procedureName ?? "").trim();
  const demande = `Votre demande ${procedure !== "" ? `« ${procedure} » ` : ""}(référence ${input.reference})`;
  const what = WHAT[input.event];
  const label = CITIZEN_STATUS_LABELS[input.status];
  const tenant = (input.tenantName ?? "").trim();

  const paragraphs = ["Bonjour,", what.line(demande)];
  if (label) paragraphs.push(`Statut : ${label}.`);
  const closing = tenant !== "" ? `Cordialement,\n${tenant}` : "Cordialement,";
  const footnote = input.unsubscribeUrl
    ? `Vous ne souhaitez plus recevoir ces avis pour cette demande ? ${input.unsubscribeUrl}`
    : undefined;

  const subject = what.subject(input.reference);
  const body = [
    ...paragraphs,
    `Pour la consulter : ${input.url}`,
    closing,
    ...(footnote ? [footnote] : []),
  ].join("\n\n");

  return {
    subject,
    body,
    content: {
      subject,
      heading: subject,
      paragraphs: [...paragraphs, closing],
      cta: { label: CTA_LABEL, url: input.url },
      footnote,
    },
  };
}

export interface MessageNoticeInput {
  reference: string;
  procedureName: string | null;
  /** Extrait du DERNIER message publié (`messageExcerpt`) ; le nombre de messages s'il y en a plusieurs. */
  excerpt: string;
  messageCount: number;
  /** Un changement de statut de la même fenêtre, annoncé dans le même courriel ; `null` sinon. */
  statusPart: { event: NoticeEvent; status: string } | null;
  url: string;
  /**
   * Le lien de désinscription — à ne passer QUE si l'avis porte un statut :
   * l'avis de message n'est pas désactivable (décision PO n° 1), un lien qui
   * ne couperait rien serait trompeur (recette du 2026-10-25).
   */
  unsubscribeUrl: string | null;
  tenantName: string | null;
  /** Demande close : le portail n'y accepte plus de réponse, l'avis ne la propose pas. */
  closed?: boolean;
  /**
   * Messagerie de l'usager OUVERTE (2026-10-25 : fermée par défaut) : sans elle,
   * le portail refuse la réponse, l'avis ne la propose pas. Absente = fermée.
   */
  repliesOpen?: boolean;
}

/**
 * L'avis « nouveau message » (M2) : le message est dans l'espace, le courriel
 * en cite les premiers caractères et y renvoie. Un statut de la même fenêtre y
 * est annoncé aussi — UN courriel, jamais deux (cadrage Q5).
 */
export function messageNoticeEmail(input: MessageNoticeInput): StatusNotice {
  const procedure = (input.procedureName ?? "").trim();
  const demande = `votre demande ${procedure !== "" ? `« ${procedure} » ` : ""}(référence ${input.reference})`;
  const tenant = (input.tenantName ?? "").trim();
  const several = input.messageCount > 1;

  const subject = several
    ? `Nouveaux messages concernant votre demande ${input.reference}`
    : `Nouveau message concernant votre demande ${input.reference}`;
  const paragraphs = [
    "Bonjour,",
    several
      ? `Vous avez reçu ${input.messageCount} nouveaux messages concernant ${demande}. Le dernier commence ainsi :`
      : `Vous avez reçu un nouveau message concernant ${demande} :`,
    `« ${input.excerpt} »`,
  ];
  if (input.statusPart) {
    const label = CITIZEN_STATUS_LABELS[input.statusPart.status];
    if (label) paragraphs.push(`Votre demande a aussi changé de statut : ${label}.`);
  }
  const closing = tenant !== "" ? `Cordialement,\n${tenant}` : "Cordialement,";
  const footnote = input.unsubscribeUrl
    ? `Vous ne souhaitez plus recevoir les avis de changement de statut pour cette demande ? ${input.unsubscribeUrl}`
    : undefined;
  const canReply = !input.closed && input.repliesOpen === true;
  const readLine = several
    ? (canReply ? "Pour les lire en entier et y répondre" : "Pour les lire en entier")
    : (canReply ? "Pour le lire en entier et y répondre" : "Pour le lire en entier");
  const body = [
    ...paragraphs,
    `${readLine} : ${input.url}`,
    closing,
    ...(footnote ? [footnote] : []),
  ].join("\n\n");

  return {
    subject,
    body,
    content: {
      subject,
      heading: subject,
      paragraphs: [...paragraphs, closing],
      cta: { label: several ? "Lire les messages" : "Lire le message", url: input.url },
      footnote,
    },
  };
}

/** Longueur de l'extrait d'un message dans l'avis « nouveau message » (décision PO n° 1). */
export const EXCERPT_LENGTH = 140;

/**
 * Les premiers caractères d'un message, coupés sur un mot, suivis de « … ».
 * Une première ligne de salutation (« Bonjour Madame X, ») est sautée : les
 * caractères portent le fond (architecture, question n° 6). Jamais plus de
 * `EXCERPT_LENGTH` caractères avant l'ellipse.
 */
export function messageExcerpt(body: string, max = EXCERPT_LENGTH): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first >= 0 && /,\s*$/.test(lines[first]) && lines[first].trim().length <= 60
      && lines.slice(first + 1).some((l) => l.trim() !== "")) {
    lines.splice(first, 1);
  }
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > max / 2 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:.!?…-]+$/, "");
  return `${head}…`;
}
