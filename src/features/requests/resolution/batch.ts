// Résolution groupée d'une SÉLECTION LIBRE de demandes, depuis la liste (B7 de
// docs/backlog.md — décision PO du 2026-11-04).
//
// Le serveur (`resolve_requests`) décide de tout, demande par demande ; ce
// module ne fait que DIRE à l'agent, avant de confirmer, ce qui arrivera à
// chacune — y compris les refus PRÉVISIBLES (déjà close, droit manquant) — puis
// lui rendre compte honnêtement du résultat, partiel quand il l'est (« 7 sur
// 9 »). Les refus imprévisibles d'ici (pièce obligatoire non conforme, t17)
// arrivent avec le résultat, motif de la garde compris.
//
// Comme pour un groupe « même incident » (décision du 2026-10-16, étendue le
// 2026-11-04) : une demande « À traiter » ou « En attente » passe par
// l'instruction, FAIT PAR LE SERVEUR, et l'agent en devient l'instructeur s'il
// n'y en a pas.

import { closureNoticeApplies } from "@fn/_shared/email/cloture";

/** Jumeau de `public.request_batch_max_size()` — les avis partent un par un du navigateur. */
export const BATCH_MAX_SIZE = 50;

const OPEN = new Set(["a_traiter", "en_instruction", "en_attente"]);

export type BatchStatus = "resolue_positive" | "resolue_negative";

/** Ce que la liste sait d'une demande sélectionnée — assez pour prévoir, jamais pour décider. */
export interface BatchItem {
  id: string;
  reference: string;
  subject: string;
  status: string;
  source: string;
  assignedTo: string | null;
  /** Droits de l'agent sur le couple de la demande (`rightsFor`) — reflet, pas garde. */
  canProcess: boolean;
  canClose: boolean;
}

export interface BatchForecast {
  /** Refus que l'on sait d'avance — la demande n'est pas envoyée au serveur. */
  blocked: string | null;
  /** Ce que la résolution fera à cette demande, en plus de la résoudre. */
  notes: string[];
}

export function batchForecast(item: BatchItem): BatchForecast {
  if (!OPEN.has(item.status)) return { blocked: "déjà close", notes: [] };
  if (!item.canClose) return { blocked: "vous n'avez pas le droit de clôture", notes: [] };
  const needsChain = item.status !== "en_instruction";
  const needsTakeOver = item.assignedTo === null;
  if ((needsChain || needsTakeOver) && !item.canProcess) {
    return { blocked: "il faut le droit d'instruction pour la mettre en instruction", notes: [] };
  }
  const notes: string[] = [];
  if (item.status === "a_traiter") notes.push("à traiter : mise en instruction puis résolue");
  else if (item.status === "en_attente") notes.push("en attente : remise en instruction puis résolue");
  if (needsTakeOver) notes.push("vous en deviendrez l'instructeur");
  if (!closureNoticeApplies(item.source)) notes.push("issue de Clara : aucun avis");
  return { blocked: null, notes };
}

/** Les demandes que l'on enverra au serveur : ni close, ni sans droit. */
export function submittable(items: readonly BatchItem[]): BatchItem[] {
  return items.filter((i) => batchForecast(i).blocked === null);
}

/** Combien d'avis de clôture PARTIRAIENT, si l'agent coche « Prévenir les usagers ». */
export function batchNotifiableCount(items: readonly BatchItem[]): number {
  return submittable(items).filter((i) => closureNoticeApplies(i.source)).length;
}

// ---- Sélection -----------------------------------------------------------------

/**
 * Coche ou décoche une demande. Au-delà de `BATCH_MAX_SIZE`, la coche est
 * REFUSÉE (et dite) plutôt que de faire échouer le lot au serveur.
 */
export function toggleSelected(
  selected: ReadonlyMap<string, BatchItem>,
  item: BatchItem,
): { next: Map<string, BatchItem>; full: boolean } {
  const next = new Map(selected);
  if (next.has(item.id)) {
    next.delete(item.id);
    return { next, full: false };
  }
  if (next.size >= BATCH_MAX_SIZE) return { next, full: true };
  next.set(item.id, item);
  return { next, full: false };
}

/** État de la case « toute la page » : cochée, partielle ou vide. */
export function pageSelectionState(
  selected: ReadonlyMap<string, BatchItem>,
  pageIds: readonly string[],
): "all" | "some" | "none" {
  if (pageIds.length === 0) return "none";
  const n = pageIds.filter((id) => selected.has(id)).length;
  return n === 0 ? "none" : n === pageIds.length ? "all" : "some";
}

/**
 * Case « toute la page » : décoche la page si elle est entièrement cochée, sinon
 * coche ce qui manque — jusqu'au plafond, `full` dit s'il a été atteint.
 */
export function togglePage(
  selected: ReadonlyMap<string, BatchItem>,
  pageItems: readonly BatchItem[],
): { next: Map<string, BatchItem>; full: boolean } {
  const next = new Map(selected);
  if (pageSelectionState(selected, pageItems.map((i) => i.id)) === "all") {
    for (const i of pageItems) next.delete(i.id);
    return { next, full: false };
  }
  let full = false;
  for (const i of pageItems) {
    if (next.has(i.id)) continue;
    if (next.size >= BATCH_MAX_SIZE) { full = true; break; }
    next.set(i.id, i);
  }
  return { next, full };
}

// ---- Résultat --------------------------------------------------------------------

/** Une ligne de `resolve_requests`. */
export interface BatchResult {
  request_id: string;
  reference: string | null;
  ok: boolean;
  error: string | null;
  took_over: boolean;
  chained: boolean;
}

export interface BatchSummary {
  okIds: string[];
  /** « 7 demandes résolues sur 9 » — le chiffre honnête, jamais un succès global. */
  headline: string;
  /** « Non résolues : » — `null` s'il n'y a aucun refus. */
  failuresTitle: string | null;
  /** Une ligne par refus, « référence — motif » : l'écran les affiche l'une sous l'autre. */
  failures: string[];
}

const plural = (n: number, word: string) => `${word}${n > 1 ? "s" : ""}`;

/**
 * Résumé du lot : les refus du SERVEUR et ceux que l'écran a écartés d'avance
 * (`skipped`) comptent ensemble — l'agent a coché N demandes, il lit N.
 */
export function batchSummary(
  results: readonly BatchResult[],
  skipped: readonly { reference: string; reason: string }[] = [],
): BatchSummary {
  const ok = results.filter((r) => r.ok);
  const total = results.length + skipped.length;
  const headline = total === 0
    ? "Aucune demande à résoudre"
    : ok.length === total
      ? `${total} ${plural(total, "demande")} ${plural(total, "résolue")}`
      : `${ok.length} ${plural(ok.length, "demande")} ${plural(ok.length, "résolue")} sur ${total}`;
  const refused = [
    ...results.filter((r) => !r.ok).map((r) => `${r.reference ?? "demande"} — ${r.error ?? "refusée"}`),
    ...skipped.map((s) => `${s.reference} — ${s.reason}`),
  ];
  const failuresTitle = refused.length === 0 ? null : `Non ${plural(refused.length, "résolue")} :`;
  return { okIds: ok.map((r) => r.request_id), headline, failuresTitle, failures: refused };
}
