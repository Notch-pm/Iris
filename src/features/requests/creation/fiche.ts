// « Fiche de la demande » du rail latéral : progression et complétude de la
// saisie — logique pure, dérivée du moteur partagé (visibilité, exigences).
// Confort d'affichage uniquement : la validation d'autorité reste côté serveur.

import {
  attachmentIsRequired,
  fieldIsVisible,
  flatFields,
  type FlatField,
  type FormSchema,
  type FormValues,
} from "@fn/create-request-from-procedure/_shared/procedureForm";

/** Nombre de fichiers choisis par id de champ pièce. */
export type FileCounts = Record<string, number>;

export function activeFields(schema: FormSchema | null, values: FormValues): FlatField[] {
  if (!schema) return [];
  return flatFields(schema).filter((entry) => fieldIsVisible(entry, values));
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function fieldIsFilled(entry: FlatField, values: FormValues, fileCounts: FileCounts): boolean {
  if (entry.field.type === "attachment") return (fileCounts[entry.field.id] ?? 0) > 0;
  return !isEmptyValue(values[entry.field.id]);
}

export function fieldIsRequired(entry: FlatField, values: FormValues): boolean {
  if (entry.field.type === "attachment") return attachmentIsRequired(entry.field, values);
  return entry.field.required === true;
}

/** Champs visibles obligatoires encore vides (pièces comprises). */
export function missingRequiredFields(
  schema: FormSchema | null,
  values: FormValues,
  fileCounts: FileCounts,
): FlatField[] {
  return activeFields(schema, values)
    .filter((entry) => fieldIsRequired(entry, values) && !fieldIsFilled(entry, values, fileCounts));
}

export interface AttachmentStats {
  provided: number;
  total: number;
}

/** Pièces visibles : combien en ont au moins un fichier, sur combien attendues. */
export function attachmentStats(
  schema: FormSchema | null,
  values: FormValues,
  fileCounts: FileCounts,
): AttachmentStats {
  const pieces = activeFields(schema, values).filter((e) => e.field.type === "attachment");
  return {
    provided: pieces.filter((e) => (fileCounts[e.field.id] ?? 0) > 0).length,
    total: pieces.length,
  };
}

export interface ProgressInput {
  hasProcedure: boolean;
  hasRequester: boolean;
  subjectFilled: boolean;
  schema: FormSchema | null;
  values: FormValues;
  fileCounts: FileCounts;
}

/**
 * Progression 0-100 : 6 % sans démarche, 12 % avec, 24 % avec usager, puis le
 * reste au prorata des champs actifs renseignés (objet compris).
 */
export function creationProgress(input: ProgressInput): number {
  if (!input.hasProcedure) return 6;
  const base = input.hasRequester ? 24 : 12;
  const fields = activeFields(input.schema, input.values);
  const total = fields.length + 1; // + objet de la demande
  const done = fields.filter((e) => fieldIsFilled(e, input.values, input.fileCounts)).length
    + (input.subjectFilled ? 1 : 0);
  return Math.min(100, Math.round(base + (100 - base) * (done / total)));
}

export function fileCountsFrom(files: Record<string, { length: number }>): FileCounts {
  const out: FileCounts = {};
  for (const [key, list] of Object.entries(files)) out[key] = list.length;
  return out;
}

/** RM-29/RM-59 : l'organisation destinataire est obligatoire à la création dans Iris. */
export function destinationMissing(destinationId: string): boolean {
  return destinationId.trim() === "";
}
