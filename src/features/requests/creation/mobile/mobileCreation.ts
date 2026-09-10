// Création — logique PURE de la page MOBILE « une page » (sans DOM ni
// réseau), testée. La machine à états (démarche → usager → formulaire, droits,
// brouillon, doublons) reste celle du bureau (`NewRequestPage.tsx` et les
// modules qu'il consomme) : ce module ne fait QUE ce que la page mobile ajoute
// — le bloc photo raccourci, les puces de démarche repliables, la numérotation
// des sections sans trou, et les deux phrases qui n'existent qu'ici (« prête à
// être créée », le rappel du brouillon).

import {
  flatFields,
  type AttachmentField,
  type FormSchema,
  type Section,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import { draftDateLabel, type CreationDraft } from "../draft";

// ---------------------------------------------------------------------------
// Bloc « Photo de la situation »
// ---------------------------------------------------------------------------

/**
 * Un champ pièce du schéma, avec sa section d'origine — même forme qu'un
 * `FlatField` du moteur partagé, mais NARROWÉE au type `attachment` : la page
 * en lit directement `maxFiles`/`acceptedFormats` sans re-caster.
 */
export interface AttachmentEntry {
  field: AttachmentField;
  section: Section | null;
}

/** Le premier champ pièce du schéma, dans l'ordre du formulaire — ou `null`. */
export function firstAttachmentField(schema: FormSchema): AttachmentEntry | null {
  for (const entry of flatFields(schema)) {
    if (entry.field.type === "attachment") return { field: entry.field, section: entry.section };
  }
  return null;
}

export interface PhotoBlockState {
  field: AttachmentEntry;
  /** Fichiers déjà déposés sur CE champ (le même état que `ProcedureFormFields`). */
  count: number;
}

/**
 * État du bloc « Photo de la situation » : `null` quand la démarche n'a
 * AUCUN champ pièce — le bloc ne s'affiche alors pas du tout, une photo ne
 * pouvant viser un champ qui n'existe pas.
 */
export function photoBlockState(
  schema: FormSchema,
  files: Record<string, File[]>,
): PhotoBlockState | null {
  const field = firstAttachmentField(schema);
  if (!field) return null;
  return { field, count: (files[field.field.id] ?? []).length };
}

// ---------------------------------------------------------------------------
// Puces de démarche
// ---------------------------------------------------------------------------

/** Puces affichées avant dépliage — au-delà, le bouton « Autres… » les révèle. */
export const CHIPS_VISIBLE = 8;

export interface ProcedureChipsResult {
  /** Démarches à afficher en puces, triées par nom (FR, accents/casse ignorés). */
  visible: SocleProcedureRow[];
  /** Démarches que la troncature ne montre pas encore. */
  hiddenCount: number;
}

function foldAccents(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Démarches à proposer en puces : triées par nom, puis — sans recherche —
 * limitées à `CHIPS_VISIBLE` (le reste compte dans `hiddenCount`, pour le
 * bouton « Autres… ») ; avec une recherche d'AU MOINS un caractère (accents et
 * casse ignorés), la troncature disparaît — une recherche qui cache son propre
 * résultat serait absurde.
 */
export function procedureChips(
  rows: readonly SocleProcedureRow[],
  query: string,
): ProcedureChipsResult {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  const needle = foldAccents(query);
  if (needle.length === 0) {
    return {
      visible: sorted.slice(0, CHIPS_VISIBLE),
      hiddenCount: Math.max(0, sorted.length - CHIPS_VISIBLE),
    };
  }
  const filtered = sorted.filter((row) => foldAccents(row.name).includes(needle));
  return { visible: filtered, hiddenCount: 0 };
}

// ---------------------------------------------------------------------------
// Numérotation des sections
// ---------------------------------------------------------------------------

export interface CreationSectionTitles {
  /** Absent quand la démarche n'a pas de champ pièce — pas de section 0 fantôme. */
  photo?: string;
  demarche: string;
  usager: string;
  details: string;
}

/**
 * Libellés numérotés des quatre sections, dans l'ordre de la maquette — SANS
 * TROU quand la photo est absente : « Démarche » redevient alors la 1.
 */
export function sectionNumbers(hasPhoto: boolean): CreationSectionTitles {
  const order = hasPhoto
    ? ["Photo de la situation", "Démarche", "Usager", "Précisions"]
    : ["Démarche", "Usager", "Précisions"];
  const numbered = order.map((label, i) => `${i + 1} · ${label}`);
  return hasPhoto
    ? { photo: numbered[0], demarche: numbered[1], usager: numbered[2], details: numbered[3] }
    : { demarche: numbered[0], usager: numbered[1], details: numbered[2] };
}

// ---------------------------------------------------------------------------
// Ligne de préparation (au-dessus du bouton de création)
// ---------------------------------------------------------------------------

export interface ReadinessInput {
  hasProcedure: boolean;
  hasRequester: boolean;
  /** Champs obligatoires visibles encore vides (`fiche.ts` → `missingRequiredFields`). */
  missing: number;
}

/** La seule phrase qui dit, à tout moment, ce qui manque avant de créer. */
export function readinessLine({ hasProcedure, hasRequester, missing }: ReadinessInput): string {
  if (!hasProcedure) return "Choisissez une démarche";
  if (!hasRequester) return "Désignez l'usager";
  if (missing > 0) {
    return `${missing} champ${missing > 1 ? "s" : ""} obligatoire${missing > 1 ? "s" : ""} restant${missing > 1 ? "s" : ""}`;
  }
  return "Prête à être créée";
}

// ---------------------------------------------------------------------------
// Bandeau de reprise de brouillon
// ---------------------------------------------------------------------------

/** « Brouillon du 10/09/2026 14:32 — Acte de mariage » — `procedureName` peut manquer si le cache n'a pas (encore) la démarche. */
export function draftBanner(draft: CreationDraft, procedureName: string | null): string {
  return `Brouillon du ${draftDateLabel(draft.savedAt)} — ${procedureName ?? "démarche à recharger"}`;
}
