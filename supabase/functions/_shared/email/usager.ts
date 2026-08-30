// E-mail de RÉPONSE À L'USAGER — le seul message d'Iris qui sorte du cercle des
// agents. Module PUR (aucune dépendance Deno, aucun réseau) — testé par vitest.
//
// ⚠️ CE QUI SORT D'IRIS, ICI. La doctrine de `notifications.ts` (« jamais
// l'identité de l'usager, la description, les pièces ») a été écrite pour les
// e-mails de NOTIFICATION, qui vont aux AGENTS : elle les empêche de
// transformer la messagerie en second système d'information. Elle ne s'applique
// pas à ce chemin-ci, où le destinataire EST la personne concernée et où le
// texte a été relu et validé par un agent avant de partir.
//
// Ce qui reste vrai, en revanche, et sans exception : **le corps d'une note
// interne ne sort jamais**. Rien ici ne lit `request_messages`.
//
// ⚠️ CE MODULE N'AJOUTE RIEN AU MESSAGE (décision PO 2026-08-26 : « ne pas
// répondre, sans plus »). Pas de rappel de référence, pas de coordonnées, pas
// de bouton. L'agent — ou le modèle qu'il a choisi — écrit tout le texte. La
// seule mention ajoutée est celle du gabarit lui-même, en pied :
// « … — message automatique, merci de ne pas y répondre. »

import { PRODUCT_NAME, type EmailBrand, type EmailContent } from "./template.ts";
import type { EmailCharte } from "./charte.ts";

/**
 * La marque d'un message à l'usager, c'est la COLLECTIVITÉ — pas Iris.
 *
 * `brandLine` rend « Iris · Ville de Saint-Aubin » quand `tenantName` est
 * fourni : parfait pour un agent, absurde pour un habitant, qui n'a aucune
 * raison de connaître le nom du logiciel de sa mairie. On place donc le nom du
 * tenant en `productName` et on laisse `tenantName` vide : le bandeau et le
 * pied portent « Ville de Saint-Aubin », seul.
 *
 * Repli sur `PRODUCT_NAME` si le tenant n'a pas de nom lisible — un bandeau
 * vide serait pire.
 *
 * ⚠️ ET C'EST AUSSI SA CHARTE. Depuis le 2026-08-30, le bandeau prend la
 * couleur principale de la collectivité et porte son logo — celui de
 * l'organisation PORTEUSE de la demande, ou de son ancêtre, l'héritage étant
 * résolu par le Socle (`charte.ts`). Un habitant reconnaît sa mairie ; il n'a
 * toujours aucune raison de connaître le nom du logiciel de sa mairie.
 *
 * `charte` absente ou nulle ⇒ habillage Iris : une collectivité qui n'a pas
 * rempli sa charte reçoit un message correct, pas un message cassé.
 */
export function usagerBrand(
  tenantName?: string | null,
  charte?: EmailCharte | null,
): EmailBrand {
  const name = (tenantName ?? "").trim();
  return {
    productName: name !== "" ? name : PRODUCT_NAME,
    tenantName: null,
    charte: charte ?? null,
  };
}

/**
 * Le texte de l'agent en paragraphes : une ligne vide sépare, un simple retour
 * à la ligne reste dans le paragraphe (le gabarit le rend en `<br />`). C'est
 * ce que quelqu'un qui tape dans une zone de texte attend.
 */
export function bodyParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/[ \t]+$/gm, "").trim())
    .filter((block) => block !== "");
}

/**
 * L'objet sert aussi de titre dans le corps : c'est le seul intitulé dont on
 * dispose, et le répéter en tête de carte est la convention du gabarit
 * (`heading`). Ni `cta`, ni `code`, ni `footnote` — voir l'en-tête.
 */
export function usagerEmailContent(subject: string, body: string): EmailContent {
  const heading = subject.trim();
  return { subject: heading, heading, paragraphs: bodyParagraphs(body) };
}
