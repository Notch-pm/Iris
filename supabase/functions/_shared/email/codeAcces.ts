// Nouveau code d'accès invité — LOGIQUE PURE, testée. Composé par le SERVEUR.
//
// Lot L4a (projet Sceaux) : un code se remplace, il ne se renvoie pas (Iris
// n'en garde que l'empreinte). Ce message part à l'adresse DÉCLARÉE au dépôt,
// après « code perdu » sur le portail ou à l'initiative d'un agent.
//
// Comme l'accusé : le texte composé ici est celui qu'enregistre l'onglet
// Échanges, avec le code MASQUÉ ; `revealAccessCode` y met le clair à l'envoi.
// Il dit que l'ancien code ne vaut plus — sans quoi l'usager essaierait les
// deux — et ce qu'il faut faire si l'usager n'a rien demandé.

import { MASKED_ACCESS_CODE } from "../access/accessCode.ts";
import { quotedSubject } from "./adresse.ts";

/** Objet FIGÉ : l'agent doit reconnaître le message dans l'onglet Échanges. */
export const ACCESS_CODE_SUBJECT = "Votre nouveau code d'accès";

export interface AccessCodeEmailInput {
  reference: string;
  requestSubject: string | null;
  /** Page de suivi du portail qui a déposé ; repli sur la rubrique du portail. */
  trackingUrl: string | null;
  tenantName: string | null;
  /** Qui l'a demandé : l'usager (« code perdu ») ou un agent. */
  reason: "renvoi_usager" | "agent";
}

export function accessCodeEmail(input: AccessCodeEmailInput): { subject: string; body: string } {
  const tenant = (input.tenantName ?? "").trim();
  const lines: string[] = [];
  lines.push("Bonjour,");
  lines.push("");
  lines.push(
    input.reason === "agent"
      ? `Un nouveau code d'accès a été créé pour suivre en ligne votre demande ${quotedSubject(input.requestSubject)}(référence ${input.reference}).`
      : `Vous avez demandé un nouveau code d'accès pour suivre en ligne votre demande ${quotedSubject(input.requestSubject)}(référence ${input.reference}).`,
  );
  lines.push("");
  lines.push(`Votre code d'accès : ${MASKED_ACCESS_CODE}`);
  lines.push("Il remplace le précédent, qui ne fonctionne plus.");
  lines.push("");
  lines.push(
    input.trackingUrl
      ? `Pour suivre votre demande, rendez-vous sur ${input.trackingUrl}`
      : "Pour suivre votre demande, rendez-vous sur le portail, rubrique « Suivre une demande »",
  );
  lines.push("avec votre adresse de courriel, la référence et ce code. Ce code est personnel : ne le communiquez à personne.");
  if (input.reason === "renvoi_usager") {
    lines.push("");
    lines.push("Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : seul ce code permet d'accéder à votre demande.");
  }
  lines.push("");
  lines.push("Cordialement,");
  if (tenant !== "") lines.push(tenant);
  return { subject: ACCESS_CODE_SUBJECT, body: lines.join("\n") };
}
