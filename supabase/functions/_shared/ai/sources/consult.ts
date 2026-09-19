/**
 * Ce que l'assistant reçoit des sources que l'agent l'a autorisé à consulter.
 *
 * Une enveloppe PROPRE, distincte de celle de la base de connaissances : les
 * sources consultées ne mordent jamais sur les garde-fous ou les consignes de
 * la démarche, qui l'emportent sur elles. Dans l'enveloppe, le tourniquet de
 * `condense.ts` (`shareBudget`) — un long règlement n'évince pas une courte
 * fiche pratique.
 *
 * Tout ce qui n'est pas servi est NOMMÉ, avec son motif : page injoignable,
 * format non lu, document scanné, budget atteint. L'agent a approuvé une
 * lecture ; il doit savoir laquelle n'a pas eu lieu.
 *
 * ⚠️ BORNE DE L'ENVELOPPE : connaissance (20 000) + sources consultées
 * (18 000) + historique (24 000 caractères) + dossier + règles doivent tenir
 * sous le plafond d'entrée du guichet `ai-api` (60 000 jetons). Un test
 * verrouille la somme.
 *
 * Module PUR, testé.
 */

import { shareBudget } from "../condense.ts";
import { toRef, type CatalogueEntry, type SourceRef } from "./catalogue.ts";

/** Enveloppe des sources consultées, en jetons. */
export const EXPLORATION_BUDGET_TOKENS = 18000;

/** Au-delà, le texte extrait est coupé AVANT tout traitement — bien au-delà de l'enveloppe. */
export const MAX_EXTRACT_CHARS = 120_000;

export interface SourceRead {
  entry: CatalogueEntry;
  /** Le texte extrait ; `null` si la source n'a pas pu être lue. */
  text: string | null;
  /** Pourquoi elle n'a pas été lue — en français, montré à l'agent. */
  reason?: string;
}

export interface ConsultedSource extends SourceRef {
  text: string;
}

export interface UnreadSource {
  id: string;
  /** Vide quand la source n'a pas pu être identifiée (référentiel muet). */
  label: string;
  reason: string;
}

export interface ConsultedResult {
  consulted: ConsultedSource[];
  unread: UnreadSource[];
  truncated: boolean;
}

export function condenseConsulted(
  reads: SourceRead[],
  budgetTokens: number = EXPLORATION_BUDGET_TOKENS,
): ConsultedResult {
  const unread: UnreadSource[] = [];
  const readable: { entry: CatalogueEntry; text: string }[] = [];
  for (const r of reads) {
    if (r.text === null || r.text.trim() === "") {
      unread.push({
        id: r.entry.id,
        label: r.entry.label,
        reason: r.reason ?? "aucun texte lisible",
      });
    } else {
      readable.push({ entry: r.entry, text: r.text });
    }
  }

  const share = shareBudget(readable.map((r) => r.text), budgetTokens);
  const consulted: ConsultedSource[] = [];
  readable.forEach((r, i) => {
    const body = share.bodies[i];
    if (body === null) {
      unread.push({ id: r.entry.id, label: r.entry.label, reason: "budget de contexte atteint" });
    } else {
      consulted.push({ ...toRef(r.entry), text: body });
    }
  });
  return { consulted, unread, truncated: share.truncated };
}
