// Comment Iris s'adresse à un usager — LOGIQUE PURE, testée, PARTAGÉE.
//
// ⚠️ Ce module existe pour qu'il n'y ait qu'UNE façon de saluer. Deux courriels
// composés par Iris s'adressent aujourd'hui à l'usager — le signalement de
// non-conformité (écrit dans le navigateur, `conformite.ts`) et l'avis de
// clôture (composé par le serveur, `cloture.ts`) —, et ils doivent le faire
// dans les mêmes termes. Recopier ces six lignes de part et d'autre de la
// frontière navigateur/edge, c'était se garantir qu'un jour l'un dise
// « Bonjour » et l'autre « Madame, Monsieur ».
//
// Il vit côté edge function parce que c'est le seul sens d'import possible :
// le navigateur peut lire `supabase/functions/` (alias `@fn`), l'inverse est
// faux — une edge function Deno n'importe pas `src/`.

import { civilityLabel } from "../identity/declared.ts";

export interface Recipient {
  /** Libellé français : « Madame », « Monsieur », ou la valeur telle quelle. */
  civility?: string | null;
  /** Prénom et nom, ou la raison sociale. */
  fullName?: string | null;
}

/**
 * « Madame Marie Durand » · « Marie Durand » · « Monsieur » ·
 * « Madame, Monsieur » — jamais de trou, jamais un mot d'écran de gestion.
 *
 * L'appelant a la charge de ne PAS transmettre une valeur de repli interne
 * (« Identité déclarée », « Utilisateur ») : ici, tout ce qui arrive est
 * considéré comme dicible à un habitant.
 */
export function salutation(recipient: Recipient): string {
  // ⚠️ La civilité est NORMALISÉE ici : le Socle la stocke en minuscules
  // (« monsieur »), et un avis de clôture qui commence par « monsieur Durand, »
  // est une faute de français adressée à un habitant. L'écran passe déjà une
  // valeur normalisée — l'opération est idempotente.
  const civility = clean(civilityLabel(recipient.civility));
  const name = clean(recipient.fullName);
  if (civility && name) return `${civility} ${name}`;
  if (name) return name;
  if (civility) return civility;
  return "Madame, Monsieur";
}

/**
 * L'objet de la demande entre guillemets, suivi d'une espace — ou RIEN du tout
 * s'il manque, pour que la phrase se referme proprement sur la référence
 * (« à votre demande (référence DEM-…) ») plutôt que sur des guillemets vides.
 */
export function quotedSubject(subject: string | null | undefined): string {
  const text = clean(subject);
  return text ? `« ${text} » ` : "";
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
