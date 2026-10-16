// Demandes liées — règles pures de la RÉSOLUTION COMMUNE (lot L3 de
// docs/demandes-liees.md).
//
// Le serveur (`resolve_linked_requests`) décide de tout, demande par demande ;
// ce module ne fait que DIRE à l'agent, avant de confirmer, ce qui va se passer
// pour chacune, puis lui rendre compte honnêtement du résultat — y compris
// partiel (« 2 sur 3 »). Décision PO du 2026-10-16 : une demande « À traiter »
// se résout avec le groupe, le serveur la faisant passer lui-même par
// l'instruction ; l'agent qui résout en devient l'instructeur s'il n'y en a pas.

import { closureNoticeApplies } from "@fn/_shared/email/cloture";
import type { GroupMember } from "./useLinking";

const OPEN = new Set(["a_traiter", "en_instruction", "en_attente"]);

/** Ce qui se propage : une RÉSOLUTION, jamais une annulation ni un autre statut. */
export function propagatesToGroup(to: string): to is "resolue_positive" | "resolue_negative" {
  return to === "resolue_positive" || to === "resolue_negative";
}

/** Les autres demandes du groupe qui peuvent encore être résolues. */
export function resolvableMembers(members: GroupMember[], sourceId: string): GroupMember[] {
  return members.filter((m) => m.id !== sourceId && OPEN.has(m.status));
}

/** Ce que la résolution commune fera à cette demande, en plus de la résoudre. */
export function memberNotes(member: GroupMember): string[] {
  const notes: string[] = [];
  if (member.status === "a_traiter") notes.push("à traiter : mise en instruction puis résolue");
  else if (member.status === "en_attente") notes.push("en attente : remise en instruction puis résolue");
  if (member.assignedTo === null) notes.push("vous en deviendrez l'instructeur");
  if (!closureNoticeApplies(member.source)) notes.push("issue de Clara : aucun avis");
  return notes;
}

/** Combien d'avis PARTIRAIENT, si l'agent coche « Prévenir les usagers ». */
export function notifiableCount(members: GroupMember[], selected: ReadonlySet<string>): number {
  return members.filter((m) => selected.has(m.id) && closureNoticeApplies(m.source)).length;
}

/** Une ligne de `resolve_linked_requests`. */
export interface LinkedResolutionResult {
  request_id: string;
  reference: string | null;
  ok: boolean;
  error: string | null;
  took_over: boolean;
  chained: boolean;
}

export interface ResolutionSummary {
  okIds: string[];
  /** « 2 demandes liées résolues sur 3 » — le chiffre honnête, jamais un succès global. */
  headline: string;
  /** Une ligne par refus, motif de la garde compris — `null` s'il n'y en a pas. */
  failures: string | null;
}

export function resolutionSummary(results: LinkedResolutionResult[]): ResolutionSummary {
  const ok = results.filter((r) => r.ok);
  const total = results.length;
  const headline = total === 0
    ? "Aucune demande liée à résoudre"
    : ok.length === total
      ? `${total} demande${total > 1 ? "s" : ""} liée${total > 1 ? "s" : ""} résolue${total > 1 ? "s" : ""} avec elle`
      : `${ok.length} demande${ok.length > 1 ? "s" : ""} liée${ok.length > 1 ? "s" : ""} résolue${ok.length > 1 ? "s" : ""} sur ${total}`;
  const refused = results.filter((r) => !r.ok);
  const failures = refused.length === 0
    ? null
    : `Non résolue${refused.length > 1 ? "s" : ""} : `
      + refused.map((r) => `${r.reference ?? "demande"} — ${r.error ?? "refusée"}`).join(" · ");
  return { okIds: ok.map((r) => r.request_id), headline, failures };
}
