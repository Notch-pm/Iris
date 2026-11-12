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
import {
  SYSTEM_KEYS,
  bodyParagraphs,
  composeFromTemplate,
  presentValues,
  type SocleSystemTemplate,
} from "./socleTemplates.ts";

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

// ---------------------------------------------------------------------------
// Textes du SOCLE (courriels système, 2026-11-12)
//
// Le Socle fournit l'objet et le texte ; Iris garde ce qui relève de
// l'habillage et de la mécanique : le bouton (« Voir ma demande »), la ligne
// « Pour la consulter : <lien> » de la version texte, le lien de
// désinscription. Sans modèle, l'appelant garde `statusNoticeEmail` /
// `messageNoticeEmail`.
// ---------------------------------------------------------------------------

/**
 * La version texte (celle qu'enregistre l'onglet Échanges) : la ligne du lien
 * se glisse AVANT la signature — le dernier paragraphe, par convention des
 * textes du Socle —, comme dans les textes d'origine ; le pied vient après.
 */
function textBody(paragraphs: string[], linkLine: string, footnote: string | undefined): string {
  const head = paragraphs.slice(0, -1);
  const closing = paragraphs.slice(-1);
  return [...head, linkLine, ...closing, ...(footnote ? [footnote] : [])].join("\n\n");
}

/** Le courriel système du Socle qui porte chaque événement. */
export const NOTICE_TEMPLATE_KEYS: Record<NoticeEvent, string> = {
  prise_en_charge: SYSTEM_KEYS.debutInstruction,
  attente_information: SYSTEM_KEYS.attenteInformation,
  reprise_instruction: SYSTEM_KEYS.repriseInstruction,
  annulation: SYSTEM_KEYS.annulation,
  reouverture: SYSTEM_KEYS.reouverture,
};

export function statusNoticeFromTemplate(
  input: StatusNoticeInput,
  template: SocleSystemTemplate,
): StatusNotice {
  const values = presentValues({
    "demande.demarche": input.procedureName,
    "demande.reference": input.reference,
    "demande.statut_usager": CITIZEN_STATUS_LABELS[input.status],
    "demande.lien": input.url,
    "organisation.nom": input.tenantName,
  });
  const { subject, body: rendered } = composeFromTemplate(template, values);
  const footnote = input.unsubscribeUrl
    ? `Vous ne souhaitez plus recevoir ces avis pour cette demande ? ${input.unsubscribeUrl}`
    : undefined;
  const body = textBody(bodyParagraphs(rendered), `Pour la consulter : ${input.url}`, footnote);
  return {
    subject,
    body,
    content: {
      subject,
      heading: subject,
      paragraphs: bodyParagraphs(rendered),
      cta: { label: CTA_LABEL, url: input.url },
      footnote,
    },
  };
}

/**
 * L'avis « nouveau message » depuis le texte du SOCLE. Le texte d'origine du
 * Socle est rédigé pour UN message : quand plusieurs arrivent dans la même
 * fenêtre et que la collectivité n'a pas réécrit ce texte, l'appelant garde
 * `messageNoticeEmail`, qui sait dire « 2 nouveaux messages »
 * (`shouldUseMessageTemplate`). Un statut de la même fenêtre s'annonce dans un
 * paragraphe glissé AVANT la signature (le dernier paragraphe).
 */
export function shouldUseMessageTemplate(messageCount: number, template: SocleSystemTemplate): boolean {
  return messageCount <= 1 || template.isCustomized;
}

export function messageNoticeFromTemplate(
  input: MessageNoticeInput,
  template: SocleSystemTemplate,
): StatusNotice {
  const several = input.messageCount > 1;
  const values = presentValues({
    "demande.demarche": input.procedureName,
    "demande.reference": input.reference,
    "message.extrait": input.excerpt,
    "message.nombre": String(input.messageCount),
    "demande.lien": input.url,
    "organisation.nom": input.tenantName,
  });
  const { subject, body: rendered } = composeFromTemplate(template, values);
  const paragraphs = bodyParagraphs(rendered);
  if (input.statusPart) {
    const label = CITIZEN_STATUS_LABELS[input.statusPart.status];
    if (label) {
      const line = `Votre demande a aussi changé de statut : ${label}.`;
      paragraphs.splice(Math.max(paragraphs.length - 1, 0), 0, line);
    }
  }
  const footnote = input.unsubscribeUrl
    ? `Vous ne souhaitez plus recevoir les avis de changement de statut pour cette demande ? ${input.unsubscribeUrl}`
    : undefined;
  const canReply = !input.closed && input.repliesOpen === true;
  const readLine = several
    ? (canReply ? "Pour les lire en entier et y répondre" : "Pour les lire en entier")
    : (canReply ? "Pour le lire en entier et y répondre" : "Pour le lire en entier");
  const body = textBody(paragraphs, `${readLine} : ${input.url}`, footnote);
  return {
    subject,
    body,
    content: {
      subject,
      heading: subject,
      paragraphs,
      cta: { label: several ? "Lire les messages" : "Lire le message", url: input.url },
      footnote,
    },
  };
}
