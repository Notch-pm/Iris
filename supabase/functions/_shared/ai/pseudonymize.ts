/**
 * Pseudonymisation RÉVERSIBLE d'un texte avant l'envoi au fournisseur IA.
 *
 * Pourquoi ce module, alors que `redact.ts` existe : « Améliorer mon message »
 * relit le texte que l'AGENT écrit à l'usager — qui contient presque toujours
 * son nom (« Madame Dupont »), parfois son courriel ou son téléphone. Retirer
 * ces valeurs (ce que fait `redact.ts`) rendrait un texte amputé ; les laisser
 * partir enfreindrait la doctrine (aucune identité CONNUE ne sort d'Iris).
 * D'où l'aller-retour : chaque valeur est remplacée par un jeton `⟦P1⟧`, le
 * modèle corrige le texte autour, et le serveur remet les valeurs en place.
 *
 * CE QUI EST MASQUÉ :
 *   - les valeurs d'identité CONNUES du dossier (snapshot du dépôt, relu côté
 *     serveur pour ce seul usage : nom, nom d'usage, prénom, raison sociale,
 *     nom d'affichage, courriel, téléphones, SIRET) ;
 *   - tout courriel, téléphone, IBAN ou SIRET repérable (motifs de `redact.ts`) ;
 *   - les variables de modèle `{{groupe.cle}}` restées telles quelles.
 * Un nom qu'Iris ne connaît pas (un tiers cité par l'agent) peut passer : la
 * promesse reste celle de `redact.ts`, bornée et écrite.
 *
 * CE QUI EST GARANTI AU RETOUR : un texte où chaque jeton envoyé revient, et
 * aucun jeton inventé. Sinon `restore` échoue — on ne rend JAMAIS un texte qui
 * aurait perdu une donnée de l'agent.
 *
 * Masquer « Dupont » masque aussi « rue Marcel Dupont » : sans conséquence ici,
 * puisque tout revient à l'identique.
 *
 * Module PUR, testé.
 */

import { pickDeclared, type DeclaredField } from "../identity/declared.ts";
import { EMAIL_RE, IBAN_RE, PHONE_RE, SIRET_RE } from "./redact.ts";

/** Champs du snapshot dont la valeur est masquée. L'adresse n'en est pas : un lieu n'est pas une personne. */
const MASKED_FIELDS: readonly DeclaredField[] = [
  "displayName", "legalName", "usageName", "lastName", "firstName",
  "email", "mobilePhone", "landlinePhone", "siret",
];

/** En deçà, un « terme » masquerait des syllabes (« Li », « Bo ») plus que des noms. */
const MIN_TERM_LENGTH = 3;

/** Valeurs d'identité connues d'un dossier, les plus longues d'abord (« Dupont-Léger » avant « Dupont »). */
export function identityTerms(snapshot: unknown): string[] {
  const terms = new Set<string>();
  for (const field of MASKED_FIELDS) {
    const value = pickDeclared(snapshot, field);
    if (value && value.length >= MIN_TERM_LENGTH) terms.add(value);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

export interface Pseudonymized {
  text: string;
  /** Jeton → valeur d'origine. */
  tokens: Map<string, string>;
}

const TOKEN_RE = /⟦P\d+⟧/g;
const VARIABLE_RE = /\{\{\s*[\w.]+\s*\}\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fresh(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

export function pseudonymize(text: string, terms: readonly string[]): Pseudonymized {
  const tokens = new Map<string, string>();
  const byValue = new Map<string, string>();
  const tokenFor = (value: string): string => {
    // Même valeur, même jeton — à la casse près : « DUPONT » et « Dupont »
    // restent deux jetons, pour que chacun revienne tel que l'agent l'a écrit.
    const known = byValue.get(value);
    if (known) return known;
    const token = `⟦P${tokens.size + 1}⟧`;
    tokens.set(token, value);
    byValue.set(value, token);
    return token;
  };

  // Un jeton déjà présent dans la saisie (improbable) serait indiscernable des
  // nôtres au retour : il est protégé comme le reste.
  let out = text.replace(TOKEN_RE, (m) => tokenFor(m));
  out = out.replace(VARIABLE_RE, (m) => tokenFor(m));
  // Courriel d'abord (il contient des chiffres qu'un motif de téléphone
  // attraperait), IBAN avant SIRET — même ordre que `redactFreeText`.
  for (const re of [EMAIL_RE, IBAN_RE, PHONE_RE, SIRET_RE]) {
    out = out.replace(fresh(re), (m) => tokenFor(m));
  }
  for (const term of terms) {
    // Bornes de MOT au sens Unicode : « Léa » ne doit pas masquer « Léandre ».
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (m) => tokenFor(m));
  }
  return { text: out, tokens };
}

export type RestoreResult =
  | { ok: true; text: string }
  | { ok: false; missing: string[]; unknown: string[] };

/** Remet les valeurs en place ; échoue si un jeton manque ou si le modèle en a inventé. */
export function restore(text: string, tokens: ReadonlyMap<string, string>): RestoreResult {
  const seen = new Set(text.match(TOKEN_RE) ?? []);
  const missing = [...tokens.keys()].filter((t) => !seen.has(t));
  const unknown = [...seen].filter((t) => !tokens.has(t));
  if (missing.length > 0 || unknown.length > 0) return { ok: false, missing, unknown };
  return { ok: true, text: text.replace(TOKEN_RE, (t) => tokens.get(t)!) };
}

/** Pour les textes qui ne reviennent pas (contexte d'un brouillon) : on masque sans retour. */
export function maskTerms(text: string, terms: readonly string[], replacement = "[usager]"): string {
  let out = text;
  for (const term of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, replacement);
  }
  return out;
}
