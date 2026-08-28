// Modification des réponses au formulaire depuis la fiche d'instruction —
// LOGIQUE PURE (sans DOM ni réseau), testée.
//
// CE QU'ON MODIFIE, ET CE QU'ON NE MODIFIE PAS : les **réponses** de CETTE
// demande (`requests.form_data`), sur le `form_schema` FIGÉ dans son
// `procedure_snapshot`. Jamais la définition de la démarche — elle vit dans le
// Socle, Iris ne la redéfinit pas (invariant), et le snapshot est la pièce du
// dossier : le formulaire qu'on rejoue est celui qui a été présenté au dépôt,
// pas celui d'aujourd'hui.
//
// Le moteur de validation est le MÊME que celui de la création
// (`validateFormSubmission`), utilisé sur la démarche figée plutôt que sur la
// démarche rechargée : rien à revalider auprès du Socle ici, puisque rien de ce
// qui vient du Socle ne change.

import {
  dataKey,
  flatFields,
  validateFormSubmission,
  type AttachmentDeclaration,
  type FormSchema,
  type FormValues,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

export interface AnswerValidation {
  ok: boolean;
  /** Erreurs par id de champ — les champs « pièce » en sont exclus (voir ci-dessous). */
  errors: Record<string, string>;
  /** `form_data` normalisé, prêt pour l'UPDATE : champs invisibles exclus. */
  formData: Record<string, unknown>;
}

/**
 * Valeurs initiales du formulaire, indexées par **id** de champ — c'est ce
 * qu'attendent les conditions et le rendu. `form_data`, lui, est indexé par
 * clé machine (`dataKey`, repli sur l'id) : cette fonction EST le pont, le même
 * que `formAnswers` et `pieceFields` font chacun de leur côté.
 */
export function initialAnswerValues(schema: FormSchema, formData: unknown): FormValues {
  const data = isRecord(formData) ? formData : {};
  const values: FormValues = {};
  for (const entry of flatFields(schema)) {
    values[entry.field.id] = data[dataKey(entry.field)];
  }
  return values;
}

/** Ids des champs « pièce » du schéma — ceux dont l'édition ne relève pas d'ici. */
export function attachmentFieldIds(schema: FormSchema): Set<string> {
  const out = new Set<string>();
  for (const entry of flatFields(schema)) {
    if (entry.field.type === "attachment") out.add(entry.field.id);
  }
  return out;
}

/**
 * Valide les réponses et rend le `form_data` à enregistrer.
 *
 * ⚠️ LES ERREURS DE PIÈCES SONT ÉCARTÉES, délibérément. `validateFormSubmission`
 * refuse une pièce obligatoire absente — c'est juste à la création, où l'agent
 * dépose tout d'un coup. Ici, une pièce manquante est un fait du dossier que
 * l'onglet Documents affiche et que la garde `t17` sanctionne au bon moment (la
 * résolution positive). Bloquer la correction d'une date de naissance parce
 * qu'un justificatif n'est pas encore arrivé serait absurde : ce sont deux
 * gestes indépendants, et les pièces ne s'éditent pas dans cet écran.
 *
 * Le `form_data` rendu reste complet : `validateFormSubmission` le construit
 * dans la même passe, indépendamment des erreurs.
 */
export function validateAnswers(
  schema: FormSchema,
  values: FormValues,
  attachments: AttachmentDeclaration[],
): AnswerValidation {
  const result = validateFormSubmission(schema, values, attachments);
  const pieces = attachmentFieldIds(schema);
  const errors: Record<string, string> = {};
  for (const [fieldId, message] of Object.entries(result.errors)) {
    // `_attachments` (pièce rattachée à un champ devenu invisible) relève lui
    // aussi des pièces, pas des réponses.
    if (fieldId === "_attachments" || pieces.has(fieldId)) continue;
    errors[fieldId] = message;
  }
  return { ok: Object.keys(errors).length === 0, errors, formData: result.formData };
}

/**
 * Clés de `form_data` réellement modifiées — pour n'enregistrer que s'il y a
 * quelque chose à enregistrer, et pour l'annoncer à l'agent. Jumeau du calcul
 * SQL qui alimente l'événement `form_data_updated`.
 */
export function changedAnswerKeys(before: unknown, after: Record<string, unknown>): string[] {
  const previous = isRecord(before) ? before : {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(after)]);
  const out: string[] = [];
  for (const key of keys) {
    if (!sameValue(previous[key], after[key])) out.push(key);
  }
  return out.sort();
}

/** Égalité structurelle suffisante pour des réponses de formulaire (scalaires et tableaux). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue(a[k], b[k]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
