// Avis de clôture à l'usager — LOGIQUE PURE (aucune dépendance Deno ni réseau),
// testée. Composée par le SERVEUR, jamais par le navigateur.
//
// POURQUOI CÔTÉ SERVEUR : l'agent n'écrit ici qu'un commentaire facultatif ; le
// reste du message (objet, phrase d'annonce, référence, signature) est décidé
// par Iris. Si le navigateur pouvait le composer, `send-request-email`
// deviendrait un relais ouvert pour quiconque détient la clôture — alors même
// que ce chemin exige un droit (`cloture`) que le chemin libre n'exige pas
// (`instruction`). Le client n'envoie donc que l'identifiant de la demande ;
// tout le contenu est dérivé de son état enregistré.
//
// ⚠️ LE MOTIF DE CLÔTURE NE SORT PAS. `closure_motif` (« irrecevable »,
// « réorientation », « doublon »…) est un mot d'écran de gestion : il classe le
// dossier pour le service, il n'explique rien à un habitant. Seul le texte
// libre de l'agent, s'il en a écrit un, atteint l'usager — c'est précisément
// ce que la colonne `closure_text` promet depuis l'origine (« texte de clôture
// DESTINÉ À L'USAGER »).
//
// ⚠️ LE COMMENTAIRE EST FACULTATIF (décision PO 2026-08-28) : la garde SQL ne
// l'exige plus. Sans lui, le message reste complet et se tient tout seul.

import { salutation, quotedSubject, type Recipient } from "./adresse.ts";

/** Les deux issues qui préviennent l'usager. L'annulation, elle, ne dit rien. */
export type ClosureOutcome = "resolue_positive" | "resolue_negative";

/** Objets FIGÉS, dictés par le PO (2026-08-28). */
export const CLOSURE_SUBJECTS: Record<ClosureOutcome, string> = {
  resolue_positive: "Votre demande a été résolue positivement",
  resolue_negative: "Nous ne pouvons répondre positivement à votre demande",
};

const ANNOUNCEMENT: Record<ClosureOutcome, (what: string) => string> = {
  resolue_positive: (what) => `Votre demande ${what}a reçu une suite favorable.`,
  resolue_negative: (what) => `Votre demande ${what}n'a pas pu recevoir une suite favorable.`,
};

export function isClosureOutcome(status: string): status is ClosureOutcome {
  return status === "resolue_positive" || status === "resolue_negative";
}

export interface ClosureInput {
  outcome: ClosureOutcome;
  /** Référence de la demande — le seul repère dont dispose l'usager. */
  reference: string;
  /** Objet de la demande ; omis du message s'il manque. */
  requestSubject: string | null;
  /** Commentaire de l'agent (`closure_text`) — FACULTATIF. */
  closureText: string | null;
  recipient: Recipient;
  /** La marque d'un message à l'usager, c'est la collectivité — pas Iris. */
  tenantName: string | null;
}

export interface ClosureEmail {
  subject: string;
  body: string;
}

/**
 * Le message tel qu'il partira. Sobre par construction : ni relance, ni
 * coordonnées, ni invitation à répondre — le pied du gabarit dit déjà
 * « message automatique, merci de ne pas y répondre », et lui promettre une
 * disponibilité qu'Iris n'offre pas serait un mensonge poli.
 */
export function closureEmail(input: ClosureInput): ClosureEmail {
  const what = `${quotedSubject(input.requestSubject)}(référence ${input.reference}) `;
  const comment = (input.closureText ?? "").trim();
  const tenant = (input.tenantName ?? "").trim();

  const lines: string[] = [];
  lines.push(`${salutation(input.recipient)},`);
  lines.push("");
  lines.push(ANNOUNCEMENT[input.outcome](what));
  if (comment !== "") {
    lines.push("");
    lines.push(comment);
  }
  lines.push("");
  lines.push("Cordialement,");
  // Sans nom de collectivité lisible, on s'arrête sur « Cordialement, » plutôt
  // que de signer d'une ligne vide.
  if (tenant !== "") lines.push(tenant);

  return { subject: CLOSURE_SUBJECTS[input.outcome], body: lines.join("\n") };
}
