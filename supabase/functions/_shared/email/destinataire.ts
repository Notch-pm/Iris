// À qui écrire, quand Iris écrit à l'usager — LOGIQUE PURE, testée, PARTAGÉE
// par `send-request-email` (message libre, avis de clôture) et
// `notifications-mailer` (accusé de réception au dépôt).
//
// L'adresse n'est JAMAIS acceptée d'un navigateur : elle vient de la fiche Socle
// relue (côté serveur, `socleUsager.ts`) ou, à défaut, du `requester_snapshot`
// figé au dépôt. Ce module ne fait que lire l'une ou l'autre avec les mêmes
// cascades de synonymes que partout (`DECLARED_KEYS`).

import { pickDeclared } from "../identity/declared.ts";

export interface RecipientIdentity {
  email: string | null;
  civility: string | null;
  fullName: string | null;
}

const ANONYMOUS: RecipientIdentity = { email: null, civility: null, fullName: null };

/**
 * L'identité servie à la formule d'adresse. Une fiche contacts-api et un dépôt
 * partenaire s'y lisent de la même façon, et personne ne recopie la table.
 */
export function declaredIdentity(source: unknown): RecipientIdentity {
  // Nom d'USAGE avant nom de naissance : c'est celui sous lequel la personne
  // se reconnaît, et le seul qu'on doive lui écrire.
  const first = pickDeclared(source, "firstName");
  const last = pickDeclared(source, "usageName") ?? pickDeclared(source, "lastName");
  const composed = [first, last].filter(Boolean).join(" ").trim();
  return {
    email: pickDeclared(source, "email"),
    civility: pickDeclared(source, "civility"),
    // Une raison sociale tient lieu de nom pour une entreprise ou une
    // association : c'est ainsi qu'on s'adresse à elle.
    fullName: pickDeclared(source, "displayName")
      ?? (composed !== "" ? composed : null)
      ?? pickDeclared(source, "legalName"),
  };
}

/**
 * L'identité telle qu'elle a été retenue AU DÉPÔT — le repli, quand la demande
 * ne porte aucune fiche Socle à relire (identité déclarée sans rapprochement)
 * ou que le référentiel est muet. Un dépôt anonyme n'a personne à qui écrire.
 */
export function recipientIdentity(snapshot: unknown, identityStatus: string): RecipientIdentity {
  if (identityStatus === "anonyme") return ANONYMOUS;
  const declared = isRecord(snapshot) && isRecord(snapshot.declared) ? snapshot.declared : {};
  if (declared.anonymous === true) return ANONYMOUS;
  return declaredIdentity(declared);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
