// Échéance de traitement (B16, PO 2026-11-06) — logique PURE partagée par la
// liste, le tableau et la carte des demandes.
//
// L'échéance est CALCULÉE par le serveur au dépôt et immuable (`due_at`,
// trigger t22) ; ce module ne fait que la LIRE, avec les seuils de la pastille
// de la fiche (`dueView`, instruction.ts) : jours restants < 0 = en retard,
// 0 à 3 = échéance proche. Seules les demandes OUVERTES sont en retard ou
// urgentes — une demande close n'est plus en retard de rien.
//
// ⚠️ « Urgentes » se dit ici de l'ÉCHÉANCE ; la PRIORITÉ (dont la valeur
// « Urgente », saisie par un agent) est un autre critère, appelé « Priorité »
// partout depuis le 2026-11-06 (il s'appelait « Urgence » sur la carte, le
// tableau et la fiche). Deux notions, deux libellés.

import { dueView, type DueView } from "./instruction/instruction";
import { OPEN_STATUSES } from "./statuts";

export const DUE_VALUES = ["late", "soon"] as const;
export type DueValue = (typeof DUE_VALUES)[number];

export const DUE_LABELS: Record<DueValue, string> = {
  late: "En retard",
  soon: "Urgentes (3 jours ou moins)",
};

/** Libellés courts, pour une barre de filtres serrée (carte). */
export const DUE_SHORT_LABELS: Record<DueValue, string> = {
  late: "En retard",
  soon: "Échéance ≤ 3 jours",
};

/** Jours de la plage « Urgentes » : aujourd'hui compris, jusqu'à J+3. */
export const DUE_SOON_DAYS = 3;

/** Jetons de la pastille d'échéance — ceux de la fiche (`RequestDetailPage`, `MobileRequestPage`). */
export const DUE_TONE: Record<DueView["tone"], string> = {
  late: "bg-destructive/10 text-destructive",
  soon: "bg-secondary/40 text-secondary-foreground",
  normal: "bg-muted text-muted-foreground",
};

function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** La pastille d'une demande OUVERTE ; `null` pour une demande close ou sans échéance. */
export function openDueView(dueAt: string | null, status: string, now: Date): DueView | null {
  return isOpen(status) ? dueView(dueAt, now) : null;
}

/** « En retard », « Urgente », ou rien. */
export function dueCategory(dueAt: string | null, status: string, now: Date): DueValue | null {
  const view = openDueView(dueAt, status, now);
  if (!view) return null;
  if (view.days < 0) return "late";
  return view.days <= DUE_SOON_DAYS ? "soon" : null;
}

/** Critère « Échéance » : rien coché = tout passe ; sinon la catégorie doit être cochée. */
export function matchesDue(values: readonly string[], dueAt: string | null, status: string, now: Date): boolean {
  if (values.length === 0) return true;
  const category = dueCategory(dueAt, status, now);
  return category !== null && values.includes(category);
}

/** Volumes par catégorie — les compteurs des filtres. */
export function dueCounts(
  items: readonly { dueAt: string | null; status: string }[],
  now: Date,
): Record<DueValue, number> {
  const counts: Record<DueValue, number> = { late: 0, soon: 0 };
  for (const item of items) {
    const category = dueCategory(item.dueAt, item.status, now);
    if (category) counts[category]++;
  }
  return counts;
}

/**
 * Bornes `due_at` du critère, pour un filtre appliqué CÔTÉ SERVEUR (liste
 * paginée) : minuit LOCAL comme `dueView`, `lt` exclusif, `gte` inclusif.
 * Les deux cochées = une seule plage, « avant J+4 » (le retard compris).
 * `null` quand rien n'est coché. Le filtre sur les statuts ouverts est à
 * poser à côté.
 */
export function dueRange(values: readonly string[], now: Date): { gte?: string; lt: string } | null {
  const late = values.includes("late");
  const soon = values.includes("soon");
  if (!late && !soon) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const afterSoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DUE_SOON_DAYS + 1);
  if (late && soon) return { lt: afterSoon.toISOString() };
  if (late) return { lt: today.toISOString() };
  return { gte: today.toISOString(), lt: afterSoon.toISOString() };
}
