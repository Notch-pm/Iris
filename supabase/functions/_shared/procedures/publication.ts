// Publication d'une démarche Socle — lecture du contrat, sans DOM ni réseau.
//
// Le Socle décide DEUX choses distinctes, à ne jamais confondre (son OpenAPI
// le dit noir sur blanc) :
//   - `status` : le PARAMÉTRAGE est-il fini ? `brouillon` = en cours d'écriture,
//     `production` = déclarée prête. Une démarche en brouillon n'est proposée
//     nulle part, quelle que soit sa visibilité.
//   - `communication_config.visibility` : OÙ et QUAND proposer une démarche déjà
//     prête (portail usagers, période de publication).
//
// Deux règles du contrat sont appliquées ICI, une fois pour toutes, à la
// frontière — pour qu'aucun écran n'ait à les redécouvrir :
//   1. `communication_config` absent ou `null` = « jamais paramétrée » et se lit
//      comme les valeurs par DÉFAUT : visible sur le portail, publication non
//      bornée. Surtout pas « invisible ».
//   2. les dates sont CONSERVÉES par le Socle quand `publicationPeriodEnabled`
//      est faux (« le commutateur gouverne l'usage, pas la donnée ») : dans ce
//      cas elles ne s'appliquent pas, donc la fenêtre EFFECTIVE est vide.
//
// Ce que produit ce module est donc la publication *effective*, la seule qu'Iris
// ait à miroiter et à afficher.

/** Cycle de vie du paramétrage côté Socle. */
export type ProcedureStatus = "brouillon" | "production";

/** Publication effective : où, et entre quelles bornes (incluses, AAAA-MM-JJ). */
export interface ProcedurePublication {
  /** La démarche est proposée aux usagers sur le portail en ligne. */
  portalVisible: boolean;
  /** Premier jour de publication (inclus), `null` si pas de borne. */
  publicationStart: string | null;
  /** Dernier jour de publication (inclus), `null` si pas de borne. */
  publicationEnd: string | null;
}

/** Valeurs par défaut du contrat : proposée sur le portail, sans période. */
export const DEFAULT_PUBLICATION: ProcedurePublication = {
  portalVisible: true,
  publicationStart: null,
  publicationEnd: null,
};

/**
 * Statut du paramétrage — *fail closed* : tout ce qui n'est pas explicitement
 * `production` est un brouillon (miroir de `serializeProcedure` côté Socle).
 */
export function parseProcedureStatus(raw: unknown): ProcedureStatus {
  return raw === "production" ? "production" : "brouillon";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(raw: unknown): string | null {
  return typeof raw === "string" && DATE_RE.test(raw) ? raw : null;
}

/**
 * Publication effective depuis le `communication_config` brut du Socle.
 * Tolérante aux blocs inconnus (ignorés) et aux types inattendus.
 */
export function parsePublication(communicationConfig: unknown): ProcedurePublication {
  if (typeof communicationConfig !== "object" || communicationConfig === null) {
    return { ...DEFAULT_PUBLICATION };
  }
  const visibility = (communicationConfig as Record<string, unknown>).visibility;
  if (typeof visibility !== "object" || visibility === null) {
    return { ...DEFAULT_PUBLICATION };
  }
  const v = visibility as Record<string, unknown>;
  const periodEnabled = v.publicationPeriodEnabled === true;
  return {
    // Seul `false` explicite retire la démarche du portail : une clé absente
    // reste la valeur par défaut du contrat.
    portalVisible: v.portalVisible !== false,
    publicationStart: periodEnabled ? parseDate(v.publicationStart) : null,
    publicationEnd: periodEnabled ? parseDate(v.publicationEnd) : null,
  };
}

/**
 * Fuseau des collectivités servies. Le serveur tourne en UTC : sans lui, entre
 * minuit et 2 h du matin heure française, une période qui s'ouvre AUJOURD'HUI
 * serait encore jugée à venir.
 */
export const FRANCE_TIME_ZONE = "Europe/Paris";

/**
 * Jour civil « AAAA-MM-JJ » — dans le calendrier du runtime par défaut (c'est
 * celui de l'agent, dans un navigateur), ou dans `timeZone` si on la précise.
 */
export function isoDay(date: Date, timeZone?: string): string {
  if (timeZone) return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * La démarche est-elle publiée le jour `day` (« AAAA-MM-JJ ») ?
 *
 * Les deux bornes sont **incluses** et indépendantes : une borne absente ne
 * borne rien. Une démarche sans période est donc publiée tous les jours — c'est
 * le cas ordinaire, et le défaut du contrat Socle.
 *
 * La comparaison est TEXTUELLE : sur « AAAA-MM-JJ », l'ordre lexicographique
 * EST l'ordre chronologique. Passer par `new Date(...)` n'apporterait rien
 * qu'un décalage de fuseau (« 2027-01-01 » y vaut minuit UTC).
 */
export function isPublishedOn(publication: ProcedurePublication, day: string): boolean {
  const { publicationStart: start, publicationEnd: end } = publication;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

/** « 2027-01-01 » → « 01/01/2027 ». Pur : aucune conversion de fuseau. */
export function formatPublicationDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Libellé de l'ABSENCE du portail usagers, `null` quand la démarche y est bien
 * proposée (décision PO 2026-08-30).
 *
 * Seul le cas anormal porte une pastille : être sur le portail est la valeur
 * par défaut du contrat Socle, donc le cas ordinaire — l'écrire sur chaque
 * carte ferait du bruit et noierait justement celles qui n'y sont pas.
 */
export function portalAbsenceLabel(publication: ProcedurePublication): string | null {
  return publication.portalVisible ? null : "Non visible portail";
}

/**
 * Libellé de la période de publication, `null` s'il n'y en a pas — les deux
 * bornes sont facultatives et indépendantes.
 */
export function publicationPeriodLabel(publication: ProcedurePublication): string | null {
  const { publicationStart: start, publicationEnd: end } = publication;
  if (start && end) {
    return `Publiée du ${formatPublicationDate(start)} au ${formatPublicationDate(end)}`;
  }
  if (start) return `Publiée à partir du ${formatPublicationDate(start)}`;
  if (end) return `Publiée jusqu'au ${formatPublicationDate(end)}`;
  return null;
}
