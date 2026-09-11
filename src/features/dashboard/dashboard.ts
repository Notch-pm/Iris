// Tableau de bord — LOGIQUE PURE, testée.
//
// Trois grands indicateurs et leur équivalent du mois précédent, lus dans la
// RPC `stats_monthly_flows` (faits insensibles à la purge, bornés par le RLS).
// Ce sont des FLUX datés par leur jalon — reçue, mise en instruction,
// instruite — et non des stocks : un stock « en cours d'instruction » n'a pas
// d'équivalent au mois précédent sans historique.

export interface MonthlyFlow {
  month_key: string;
  received_count: number;
  instruction_count: number;
  resolved_count: number;
}

export interface MonthPair {
  current: MonthlyFlow;
  previous: MonthlyFlow;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `2026-09` pour une date (heure locale du navigateur — la collectivité est en France). */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function previousMonthKey(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 2, 1);
  return monthKeyOf(d);
}

const LONG_MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/** `2026-09` → « septembre 2026 » (sous-titre des cartes, motif Clara). */
export function monthLongLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return LONG_MONTH.format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
}

function emptyFlow(month_key: string): MonthlyFlow {
  return { month_key, received_count: 0, instruction_count: 0, resolved_count: 0 };
}

function normalize(row: MonthlyFlow): MonthlyFlow {
  return {
    month_key: row.month_key,
    received_count: Number(row.received_count),
    instruction_count: Number(row.instruction_count),
    resolved_count: Number(row.resolved_count),
  };
}

/**
 * Le mois courant et le précédent, à zéro s'ils manquent : la RPC rend les
 * mois vides, mais un décalage de fuseau à cheval sur minuit le 1er ne doit
 * pas casser l'écran.
 */
export function pickMonthPair(rows: readonly MonthlyFlow[], now: Date = new Date()): MonthPair {
  const currentKey = monthKeyOf(now);
  const previousKey = previousMonthKey(currentKey);
  const byKey = new Map(rows.map((r) => [r.month_key, normalize(r)]));
  return {
    current: byKey.get(currentKey) ?? emptyFlow(currentKey),
    previous: byKey.get(previousKey) ?? emptyFlow(previousKey),
  };
}

/** Variation relative M / M-1, entre −1 et +∞ ; `null` si rien le mois précédent. */
export function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** « +25 % », « −10 % », « = » quand rien ne bouge, « — » sans base de comparaison. */
export function formatVariation(delta: number | null): string {
  if (delta === null) return "—";
  const pct = Math.round(delta * 100);
  if (pct === 0) return "=";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}
