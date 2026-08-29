/**
 * Plafond d'utilisation IA — ce qu'il en reste dans Iris : L'AFFICHAGE.
 *
 * ⚠️ CE MODULE NE CALCULE PLUS NI PÉRIODE NI DATE DE RENOUVELLEMENT. Depuis la
 * centralisation (2026-08-29), le plafond, le compteur et la période vivent
 * dans le Socle, qui rend `period` et `renews_at` à chaque lecture. Iris ne
 * fait plus que **mettre en français** ce que le serveur a dit et **dessiner la
 * jauge**.
 *
 * C'était le jumeau le plus dangereux du chantier : deux calculs de période
 * qui dérivent ne cassent rien de visible, ils font simplement MENTIR le
 * message (« renouvelé le 1ᵉʳ octobre » quand la période SQL est encore août).
 * `periodKey`, `nextRenewalDate`, `nextRenewalLabel` et `quotaExceededMessage`
 * ont donc été supprimés le 2026-08-29 — ne pas les réintroduire : la réponse
 * du Socle porte déjà l'information, et le message du 429 se relaie mot pour
 * mot.
 *
 * Module PUR (aucun DOM, aucun réseau, aucune dépendance Deno), testé.
 */

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

/**
 * « 1ᵉʳ septembre 2026 » à partir d'une date ISO VENUE DU SOCLE.
 *
 * ⚠️ Depuis la centralisation (2026-08-29), la date de renouvellement n'est
 * plus calculée par Iris : le Socle la possède, avec la période, et la rend
 * dans `renews_at`. Iris ne fait plus que la METTRE EN FRANÇAIS. C'est la
 * suppression du jumeau le plus dangereux du chantier — un calcul dupliqué
 * qui dérive ne se voit pas, il fait simplement mentir le message.
 *
 * Une entrée qui n'est pas une date est rendue telle quelle : mieux vaut
 * afficher ce que le serveur a dit qu'inventer un mois.
 */
export function renewalLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.getUTCDate();
  const prefix = day === 1 ? "1ᵉʳ" : String(day);
  return `${prefix} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
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
