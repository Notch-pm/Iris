/**
 * Plafond d'utilisation IA — la part qui se calcule, pas celle qui se garde.
 *
 * Ce module est importé des DEUX côtés : par l'edge function (qui doit
 * composer le message de refus) et par le navigateur via l'alias `@fn` (qui
 * doit dessiner la jauge et annoncer la même date). Une seule vérité, motif
 * `procedureForm.ts` et `knowledge.ts`.
 *
 * ⚠️ TOUT EST EN UTC, et ce n'est pas un détail. La période vit en base sous
 * la forme `to_char((now() at time zone 'utc'), 'YYYY-MM')` ; si le libellé
 * français était calculé en heure locale, un appel le 1ᵉʳ septembre à 01 h 00
 * à Paris (= 31 août 23 h UTC) annoncerait « renouvelé le 1ᵉʳ octobre » alors
 * que la période SQL est encore août. Le message mentirait d'un mois entier.
 *
 * Module PUR (aucun DOM, aucun réseau, aucune dépendance Deno), testé.
 */

/** Période de comptage : `'2026-08'`, en UTC. Jumeau exact du SQL. */
export function periodKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Premier instant de la période suivante, en UTC — la date à laquelle le
 * crédit repart. Il n'y a pas de job de reset : le passage au mois suivant
 * crée simplement une nouvelle ligne de compteur.
 */
export function nextRenewalDate(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

/**
 * « 1ᵉʳ septembre 2026 ». Composé à la main plutôt que par
 * `Intl.DateTimeFormat` : le renouvellement tombe TOUJOURS un premier du
 * mois, qui s'écrit « 1ᵉʳ » en français et non « 1 » — et une sortie ICU
 * varie d'une version de runtime à l'autre, ce qui rendrait le test fragile
 * sans rien apporter.
 */
export function nextRenewalLabel(now: Date): string {
  const date = nextRenewalDate(now);
  return `1ᵉʳ ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Le message de refus, mot pour mot — edge function et écran le partagent. */
export function quotaExceededMessage(now: Date): string {
  return "Le plafond d'utilisation de l'assistant IA est atteint pour ce mois. " +
    `Le crédit sera renouvelé le ${nextRenewalLabel(now)}.`;
}

export type QuotaTone = "ok" | "warn" | "critical";

export interface QuotaInput {
  /** `null` = aucun plafond configuré ⇒ consommation illimitée. */
  limit: number | null;
  used: number;
  reserved: number;
}

export interface QuotaView {
  unlimited: boolean;
  limit: number | null;
  used: number;
  reserved: number;
  /** Consommé + réservé : ce qui est réellement engagé sur le mois. */
  engaged: number;
  /** Jetons restants, jamais négatif. `null` si illimité. */
  remaining: number | null;
  /** 0 à 100, borné — un dépassement ne fait pas déborder la jauge. */
  percent: number;
  tone: QuotaTone;
}

/** Seuil d'alerte : au-delà, la jauge passe en beurre. */
const WARN_AT = 80;

/**
 * Ce que l'écran affiche. `reserved` est compté dans l'engagé : un appel en
 * cours a déjà mordu sur le plafond, et l'ignorer ferait annoncer un reliquat
 * qui n'existe pas.
 */
export function quotaView({ limit, used, reserved }: QuotaInput): QuotaView {
  const safeUsed = Math.max(used, 0);
  const safeReserved = Math.max(reserved, 0);
  const engaged = safeUsed + safeReserved;

  if (limit === null || limit <= 0) {
    return {
      unlimited: true, limit: null, used: safeUsed, reserved: safeReserved,
      engaged, remaining: null, percent: 0, tone: "ok",
    };
  }

  // Le RATIO est la vérité ; `percent` n'est qu'un affichage (arrondi et
  // borné). Le ton se décide donc sur le ratio, jamais sur `percent` — sinon
  // 799/1000 (79,9 %) s'arrondirait à 80 et déclencherait une alerte que
  // l'engagé réel ne justifie pas, et un dépassement à 150 % serait ramené à
  // 100 puis lu comme un simple avertissement.
  const ratio = engaged / limit;
  return {
    unlimited: false,
    limit,
    used: safeUsed,
    reserved: safeReserved,
    engaged,
    remaining: Math.max(limit - engaged, 0),
    percent: Math.min(100, Math.round(ratio * 100)),
    tone: ratio >= 1 ? "critical" : ratio * 100 >= WARN_AT ? "warn" : "ok",
  };
}

/**
 * « 1 250 000 » — espace fine insécable (U+202F), le séparateur français.
 * Composé à la main pour la même raison que la date : `toLocaleString`
 * change de séparateur selon la version d'ICU (espace insécable ordinaire
 * hier, fine aujourd'hui), et le test se briserait sur un changement de
 * runtime sans qu'aucun comportement n'ait bougé.
 */
export function formatTokens(value: number): string {
  const rounded = Math.round(Math.max(value, 0));
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
