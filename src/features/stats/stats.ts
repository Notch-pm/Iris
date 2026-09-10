// Statistiques — LOGIQUE PURE, testée (sans DOM ni réseau).
//
// Les chiffres viennent des RPC `stats_*` (SECURITY INVOKER, bornées par le
// RLS) qui lisent les tables de faits `request_stats` / `intervention_stats`,
// insensibles à la purge RGPD. Ici ne vit que ce qui n'a pas sa place en SQL :
// la période du filtre, le regroupement des sources en CANAUX de réception,
// le taux de résolution positive, les libellés de mois et de durées.

export type StatPeriod = "7d" | "30d" | "1y";

export const PERIODS: readonly StatPeriod[] = ["7d", "30d", "1y"];

export const PERIOD_LABELS: Record<StatPeriod, string> = {
  "7d": "7 jours",
  "30d": "30 jours",
  "1y": "1 an",
};

/** Borne basse de la période, à partir de `now` (injectable pour les tests). */
export function sinceFromPeriod(period: StatPeriod, now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  if (period === "7d") d.setDate(d.getDate() - 7);
  else if (period === "30d") d.setDate(d.getDate() - 30);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

// ─── Canaux de réception ────────────────────────────────────────────────────
//
// La base range une demande par SOURCE (registre dynamique `integration_sources`
// + `iris`). L'écran parle en CANAUX, fixes et au nombre de quatre : le portail
// usagers, la gestion de courrier (Clara), la création directe dans Iris, et
// tout le reste — les partenaires qui déposent par l'API. Les codes `clara` et
// `portail-citoyen` sont ceux documentés dans docs/api-ingestion.md.

export type Canal = "portail" | "clara" | "iris" | "partenaire";

export const CANAL_ORDER: readonly Canal[] = ["portail", "clara", "iris", "partenaire"];

export const CANAL_LABELS: Record<Canal, string> = {
  portail: "Portail usagers",
  clara: "Gestion de courrier (Clara)",
  iris: "Création directe dans Iris",
  partenaire: "Partenaires (API)",
};

export function canalOfSource(source: string): Canal {
  switch (source) {
    case "iris":
      return "iris";
    case "clara":
      return "clara";
    case "portail-citoyen":
      return "portail";
    default:
      return "partenaire";
  }
}

export interface SourceCount {
  source_code: string;
  request_count: number;
}

export interface CanalCount {
  canal: Canal;
  label: string;
  count: number;
}

/** Quatre canaux, ordre fixe, zéros conservés : la légende ne change jamais de forme. */
export function groupBySourceIntoCanal(rows: readonly SourceCount[]): CanalCount[] {
  const totals = new Map<Canal, number>(CANAL_ORDER.map((c) => [c, 0]));
  for (const row of rows) {
    const canal = canalOfSource(row.source_code);
    totals.set(canal, (totals.get(canal) ?? 0) + Number(row.request_count));
  }
  return CANAL_ORDER.map((canal) => ({
    canal,
    label: CANAL_LABELS[canal],
    count: totals.get(canal) ?? 0,
  }));
}

// ─── Issues ─────────────────────────────────────────────────────────────────

export interface OutcomeCounts {
  positive_count: number;
  negative_count: number;
  cancelled_count: number;
  open_count: number;
}

/**
 * Part des résolutions positives parmi les demandes CLOSES (positives,
 * négatives, annulées), entre 0 et 1. `null` tant qu'aucune n'est close : un
 * taux sur rien n'est pas zéro, c'est « pas encore ».
 */
export function positiveResolutionRate(o: OutcomeCounts): number | null {
  const closed = Number(o.positive_count) + Number(o.negative_count) + Number(o.cancelled_count);
  if (closed === 0) return null;
  return Number(o.positive_count) / closed;
}

// ─── Libellés ───────────────────────────────────────────────────────────────

const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" });

/** `2026-09` → « sept. 26 » (même forme que Clara, `MMM yy`). */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return MONTH_FORMAT.format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)} %`;
}

/** Une durée en jours, une décimale, virgule française ; « — » sans mesure. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return "—";
  return `${Number(days).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} j`;
}

export function formatCount(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("fr-FR");
}
