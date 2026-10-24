// Accusé de réception à l'usager — LOGIQUE PURE (aucune dépendance Deno ni
// réseau), testée. Composé par le SERVEUR, jamais par le navigateur.
//
// Envoyé à chaque DÉPÔT (décision PO 2026-10-09) : au guichet d'Iris comme par
// l'API d'ingestion (portail Nora, partenaires) — SAUF les demandes issues de
// Clara, qui naissent d'un courrier et non d'un dépôt de l'usager. Cette
// exclusion vit en SQL (`enqueue_request_receipt`), pas ici.
//
// Sobre par construction, comme l'avis de clôture : la référence (le seul repère
// dont dispose l'usager), la date du dépôt, l'organisme qui la traitera. Aucune
// promesse — ni délai, ni « vous serez prévenu » : une annulation ne prévient
// personne, et le pied du gabarit dit déjà « message automatique, merci de ne
// pas y répondre ».
//
// ⚠️ Le contenu du formulaire ne sort pas : l'usager sait ce qu'il a déposé, et
// une réponse peut porter des données personnelles qu'un courriel n'a pas à
// recopier.

import { salutation, quotedSubject, type Recipient } from "./adresse.ts";
import { MASKED_ACCESS_CODE } from "../access/accessCode.ts";

/** Objet FIGÉ : l'agent doit pouvoir reconnaître le message dans l'onglet Échanges. */
export const RECEIPT_SUBJECT = "Nous avons bien reçu votre demande";

/** Le runtime des edge functions est en UTC ; l'usager, lui, vit à Paris. */
const FRANCE_TIME_ZONE = "Europe/Paris";

export interface ReceiptInput {
  /** Référence de la demande — le seul repère dont dispose l'usager. */
  reference: string;
  /** Objet de la demande ; omis du message s'il manque. */
  requestSubject: string | null;
  /** Date de dépôt (`received_at`, ISO) ; omise si illisible. */
  receivedAt: string | null;
  /** Organisme qui traitera la demande (libellé relu dans le miroir) ; omis s'il manque. */
  organisme: string | null;
  recipient: Recipient;
  /** La marque d'un message à l'usager, c'est la collectivité — pas Iris. */
  tenantName: string | null;
  /**
   * Suivi en ligne accepté au dépôt (accès invité) : le message cite le code
   * d'accès — MASQUÉ dans le texte composé ici, qui est celui qu'enregistre
   * l'onglet Échanges ; `revealAccessCode` y substitue le clair au moment
   * d'envoyer. Absent ⇒ rien n'est dit du suivi en ligne.
   */
  access?: { trackingUrl: string | null } | null;
}

export interface ReceiptEmail {
  subject: string;
  body: string;
}

/** « 9 octobre 2026 », au jour de Paris — `null` si la date est illisible. */
export function depositDay(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: FRANCE_TIME_ZONE })
    .format(date);
}

export function receiptEmail(input: ReceiptInput): ReceiptEmail {
  const day = depositDay(input.receivedAt);
  const organisme = (input.organisme ?? "").trim();
  const tenant = (input.tenantName ?? "").trim();

  const lines: string[] = [];
  lines.push(`${salutation(input.recipient)},`);
  lines.push("");
  lines.push(
    `Nous avons bien reçu votre demande ${quotedSubject(input.requestSubject)}` +
      `(référence ${input.reference})${day ? `, déposée le ${day}` : ""}.`,
  );
  if (organisme !== "") {
    lines.push("");
    lines.push(`Elle sera traitée par : ${organisme}.`);
  }
  lines.push("");
  lines.push("Conservez cette référence : elle vous sera demandée pour toute question au sujet de votre demande.");
  if (input.access) {
    lines.push("");
    lines.push(
      input.access.trackingUrl
        ? `Pour suivre votre demande en ligne, rendez-vous sur ${input.access.trackingUrl}`
        : "Pour suivre votre demande en ligne, rendez-vous sur le portail, rubrique « Suivre une demande »",
    );
    lines.push(`avec votre adresse de courriel, cette référence et votre code d'accès : ${MASKED_ACCESS_CODE}`);
    lines.push("Ce code est personnel : ne le communiquez à personne.");
  }
  lines.push("");
  lines.push("Cordialement,");
  // Sans nom de collectivité lisible, on s'arrête sur « Cordialement, » plutôt
  // que de signer d'une ligne vide.
  if (tenant !== "") lines.push(tenant);

  return { subject: RECEIPT_SUBJECT, body: lines.join("\n") };
}

/**
 * Le texte qui PART : le masque remplacé par le code en clair. Sans code, ou
 * sans masque (accusé composé avant le suivi en ligne), le texte est inchangé.
 */
export function revealAccessCode(body: string, code: string | null): string {
  return code ? body.replace(MASKED_ACCESS_CODE, code) : body;
}
