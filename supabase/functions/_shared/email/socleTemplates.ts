// Modèles de courriels du SOCLE — rendu, LOGIQUE PURE, testée, PARTAGÉE
// (edge functions ET navigateur, par l'alias `@fn`).
//
// Depuis le 2026-11-12, le texte des courriels à l'usager vient du Socle
// (`GET /v1/email-templates`, miroir `socle_email_templates` rafraîchi par
// `sync-socle-referentiel`) :
//   · les courriels SYSTÈME (accusé de réception, avis de statut, clôture,
//     code d'accès, nouveau message) — la collectivité en modifie l'objet et le
//     texte dans le Socle ; Iris garde l'HABILLAGE (charte, bouton, pied, lien
//     de désinscription) et ses textes d'origine en repli ;
//   · les modèles CRÉÉS, proposés aux agents dans l'onglet Échanges.
//
// Syntaxe (contrat Socle) : `{{domaine.cle}}`, et des SECTIONS
// `{{#cle}}…{{/cle}}` (rendue seulement si la variable a une valeur) et
// `{{^cle}}…{{/cle}}` (seulement si elle n'en a pas). Texte brut : une ligne
// vide sépare deux paragraphes.
//
// ⚠️ RÈGLE D'IRIS, inchangée : une valeur absente ⇒ la clé est OMISE de
// `values`, et le jeton devient une chaîne vide. Jamais un mot d'écran de
// gestion dans un message à un habitant.

/** Un courriel système tel que le miroir le porte. */
export interface SocleSystemTemplate {
  subject: string;
  body: string;
  /** La collectivité a modifié le texte d'origine dans le Socle. */
  isCustomized: boolean;
}

/** Les courriels système d'un tenant, par clé (`accuse_reception`…). */
export type SystemTemplates = ReadonlyMap<string, SocleSystemTemplate>;

/** Clés stables des courriels système (contrat Socle, `email_template_defaults.key`). */
export const SYSTEM_KEYS = {
  accuse: "accuse_reception",
  debutInstruction: "debut_instruction",
  attenteInformation: "attente_information",
  repriseInstruction: "reprise_instruction",
  annulation: "annulation",
  reouverture: "reouverture",
  cloturePositive: "cloture_positive",
  clotureNegative: "cloture_negative",
  nouveauMessage: "nouveau_message",
  codeAcces: "code_acces",
} as const;

/**
 * Valeur de `{{demande.lien}}` quand aucune adresse de suivi n'existe : la
 * phrase « rendez-vous sur … » reste juste, comme dans les textes d'origine.
 */
export const PORTAL_TRACKING_FALLBACK = "le portail, rubrique « Suivre une demande »";

const SECTION_RE = /\{\{\s*([#^])\s*([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/;
const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function hasValue(values: Readonly<Record<string, string>>, key: string): boolean {
  return (values[key] ?? "").trim() !== "";
}

/**
 * Rend un texte : sections d'abord (de la plus intérieure à la plus
 * extérieure, la regex non gourmande prenant la première qui se ferme), puis
 * variables. Un jeton orphelin (section mal fermée) disparaît plutôt que
 * d'atteindre l'usager — le Socle refuse déjà de tels textes.
 */
export function renderTemplateText(text: string, values: Readonly<Record<string, string>>): string {
  let out = text;
  for (let guard = 0; guard < 200; guard++) {
    const match = SECTION_RE.exec(out);
    if (!match) break;
    const [whole, sigil, key, inner] = match;
    const keep = sigil === "#" ? hasValue(values, key) : !hasValue(values, key);
    out = out.slice(0, match.index) + (keep ? inner : "") + out.slice(match.index + whole.length);
  }
  out = out.replace(/\{\{\s*[#^/]\s*[a-zA-Z0-9_.]+\s*\}\}/g, "");
  return out.replace(VARIABLE_RE, (_m, key: string) => values[key] ?? "");
}

/** Nettoie un corps rendu : sections retirées ⇒ pas de pavés de lignes vides. */
export function tidyBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Un objet tient sur une ligne. */
export function tidySubject(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Objet et corps d'un modèle, rendus. */
export function composeFromTemplate(
  template: Pick<SocleSystemTemplate, "subject" | "body">,
  values: Readonly<Record<string, string>>,
): { subject: string; body: string } {
  return {
    subject: tidySubject(renderTemplateText(template.subject, values)),
    body: tidyBody(renderTemplateText(template.body, values)),
  };
}

/** Les paragraphes d'un corps rendu (une ligne vide les sépare). */
export function bodyParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Ne garde que les valeurs non vides — la règle « valeur absente ⇒ clé omise ». */
export function presentValues(
  values: Readonly<Record<string, string | null | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

/** Ligne du miroir `socle_email_templates` (colonnes lues par l'envoi). */
export interface SystemTemplateRow {
  system_key: string | null;
  subject: string | null;
  body: string | null;
  is_customized: boolean | null;
}

/** Lignes du miroir → courriels système utilisables (sujet et corps non vides). */
export function systemTemplatesFromRows(rows: readonly SystemTemplateRow[]): SystemTemplates {
  const map = new Map<string, SocleSystemTemplate>();
  for (const row of rows) {
    if (!row.system_key || !row.subject?.trim() || !row.body?.trim()) continue;
    map.set(row.system_key, {
      subject: row.subject,
      body: row.body,
      isCustomized: row.is_customized === true,
    });
  }
  return map;
}
