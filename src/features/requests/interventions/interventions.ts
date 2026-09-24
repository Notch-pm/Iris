// Interventions — logique PURE (sans DOM ni réseau), testée.
//
// Un agent qui instruit une demande SOLLICITE un intervenant (profil de droits
// `is_intervenant`) : date d'intervention souhaitée, commentaire facultatif. L'intervenant
// ne voit que les demandes sur lesquelles on l'a sollicité, et DÉCLARE
// l'intervention réalisée : date de finalisation (proposée au jour courant),
// commentaire facultatif.
//
// ⚠️ Ce module ne protège rien : les gardes vivent dans les RPC
// `request_intervention` / `complete_request_intervention` (statut
// « en cours d'instruction », droit d'instruction, intervenant éligible, dates).
// Il ne sert qu'à ne pas envoyer ce qu'on sait déjà refusé, et à le dire en
// français avant l'aller-retour.

import type { RequestStatus } from "../statuts";

export type InterventionStatus = "demandee" | "realisee";

/** Justificatifs par déclaration, QUATRE au plus (décision PO 2026-09-14) — jumeau de `intervention_max_attachments()`. */
export const MAX_INTERVENTION_FILES = 4;

export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = {
  demandee: "À réaliser",
  realisee: "Réalisée",
};

/** Ligne de `request_interventions` — les colonnes que l'écran lit. */
export interface InterventionRow {
  id: string;
  request_id: string;
  organization_id: string;
  intervenant_id: string;
  requested_by: string | null;
  requested_at: string;
  /** Jour souhaité, `AAAA-MM-JJ`. */
  requested_for: string;
  /** « Ce qui est attendu » — facultatif depuis le 2026-09-24 (NULL = rien d'écrit). */
  request_comment: string | null;
  status: string;
  completed_at: string | null;
  /** Jour déclaré, `AAAA-MM-JJ`. */
  completed_on: string | null;
  completion_comment: string | null;
}

/** `AAAA-MM-JJ` du jour LOCAL (celui de l'agent) — jamais `toISOString`, qui est en UTC. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** « 12/03/2026 » depuis `AAAA-MM-JJ`, sans passer par `Date` (aucun décalage de fuseau). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function isInterventionStatus(value: string): value is InterventionStatus {
  return value === "demandee" || value === "realisee";
}

export function interventionStatusLabel(value: string): string {
  return isInterventionStatus(value) ? INTERVENTION_STATUS_LABELS[value] : value;
}

// ---------------------------------------------------------------------------
// Peut-on solliciter ? — miroir de la garde de `request_intervention`
// ---------------------------------------------------------------------------

export interface SolicitGate {
  ok: boolean;
  /** Pourquoi le bouton est fermé — TOUJOURS écrit, jamais un bouton grisé muet. */
  reason: string | null;
}

export function solicitGate(status: RequestStatus | string, canInstruct: boolean): SolicitGate {
  if (!canInstruct) {
    return { ok: false, reason: "Exige le droit d'instruction sur cette demande" };
  }
  if (status !== "en_instruction") {
    return { ok: false, reason: "Une intervention ne se sollicite que sur une demande en cours d'instruction" };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Validation des deux formulaires
// ---------------------------------------------------------------------------

export interface SollicitationDraft {
  intervenantId: string;
  /** `AAAA-MM-JJ` */
  requestedFor: string;
  comment: string;
}

export const ERROR_INTERVENANT_REQUIRED = "Choisissez un intervenant.";
export const ERROR_DATE_REQUIRED = "Indiquez la date d'intervention souhaitée.";
export const ERROR_DATE_PAST = "La date d'intervention demandée ne peut pas être passée.";
export const ERROR_COMPLETED_REQUIRED = "Indiquez la date de finalisation.";
export const ERROR_COMPLETED_FUTURE = "La date de finalisation ne peut pas être future.";

function isIsoDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Erreurs bloquantes de la sollicitation, `today` injecté (`AAAA-MM-JJ`). */
export function validateSollicitation(draft: SollicitationDraft, today: string): string[] {
  const errors: string[] = [];
  if (draft.intervenantId.trim() === "") errors.push(ERROR_INTERVENANT_REQUIRED);
  if (!isIsoDay(draft.requestedFor)) errors.push(ERROR_DATE_REQUIRED);
  // Comparaison TEXTUELLE : `AAAA-MM-JJ` lexicographique = chronologique.
  else if (draft.requestedFor < today) errors.push(ERROR_DATE_PAST);
  return errors;
}

export interface CompletionDraft {
  /** `AAAA-MM-JJ` */
  completedOn: string;
  comment: string;
  /** Justificatifs (documents ou photos), quatre au plus — reçus par la porte unique avant la RPC. */
  files: File[];
}

/** Brouillon de confirmation : la date est PROPOSÉE au jour courant (demande PO). */
export function defaultCompletion(today: string): CompletionDraft {
  return { completedOn: today, comment: "", files: [] };
}

export const ERROR_TOO_MANY_FILES = `Au plus ${MAX_INTERVENTION_FILES} justificatifs par intervention.`;

export function validateCompletion(draft: CompletionDraft, today: string): string[] {
  const errors: string[] = [];
  if (!isIsoDay(draft.completedOn)) errors.push(ERROR_COMPLETED_REQUIRED);
  else if (draft.completedOn > today) errors.push(ERROR_COMPLETED_FUTURE);
  if (draft.files.length > MAX_INTERVENTION_FILES) errors.push(ERROR_TOO_MANY_FILES);
  return errors;
}

// ---------------------------------------------------------------------------
// Présentation
// ---------------------------------------------------------------------------

export type InterventionTone = "ok" | "pending" | "error";

/** Réalisée → ok ; à réaliser → en attente, ou EN RETARD si le jour souhaité est passé. */
export function interventionTone(row: Pick<InterventionRow, "status" | "requested_for">, today: string): InterventionTone {
  if (row.status === "realisee") return "ok";
  return row.requested_for < today ? "error" : "pending";
}

export function isLate(row: Pick<InterventionRow, "status" | "requested_for">, today: string): boolean {
  return interventionTone(row, today) === "error";
}

/**
 * Ordre d'affichage : les interventions À RÉALISER d'abord, par jour souhaité
 * croissant (la plus urgente en tête), puis les réalisées, la plus récente en tête.
 */
export function sortInterventions<T extends Pick<InterventionRow, "status" | "requested_for" | "completed_at" | "requested_at">>(rows: T[]): T[] {
  const pending = rows.filter((r) => r.status !== "realisee")
    .sort((a, b) => a.requested_for.localeCompare(b.requested_for) || a.requested_at.localeCompare(b.requested_at));
  const done = rows.filter((r) => r.status === "realisee")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return [...pending, ...done];
}

export function pendingCount(rows: Pick<InterventionRow, "status">[]): number {
  return rows.filter((r) => r.status !== "realisee").length;
}

// ---------------------------------------------------------------------------
// Justificatifs — jusqu'à QUATRE fichiers par déclaration (décision PO
// 2026-09-14). Jumeau de `intervention_max_attachments()` côté SQL : la RPC
// refuse au-delà, l'écran ne fait que ne pas proposer.
// ---------------------------------------------------------------------------

export interface AddFilesResult {
  files: File[];
  /** Fichiers laissés de côté parce que le plafond était atteint. */
  refused: number;
}

/** Ajoute à la sélection, dans l'ordre reçu, sans jamais dépasser le plafond. */
export function addFiles(
  current: readonly File[],
  incoming: readonly File[],
  max = MAX_INTERVENTION_FILES,
): AddFilesResult {
  const room = Math.max(0, max - current.length);
  const accepted = incoming.slice(0, room);
  return { files: [...current, ...accepted], refused: incoming.length - accepted.length };
}

/** « 3 fichiers sur 4 » — le compteur qui dit ce qui reste possible. */
export function filesCountLabel(count: number, max = MAX_INTERVENTION_FILES): string {
  return `${count} fichier${count > 1 ? "s" : ""} sur ${max}`;
}

/** Nom de la photo prise avec la caméra : horodaté, extension JPEG (le serveur vérifie le contenu réel). */
export function photoFileName(now: Date, index: number): string {
  const stamp = `${isoDay(now)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `photo-${stamp}-${index}.jpg`;
}

/** L'intervenant sollicité, et lui seul, déclare la réalisation (miroir de la RPC). */
export function canComplete(row: Pick<InterventionRow, "status" | "intervenant_id">, userId: string | null): boolean {
  return row.status === "demandee" && userId !== null && row.intervenant_id === userId;
}
