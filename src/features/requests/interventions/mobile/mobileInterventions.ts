// Interventions — logique PURE de la page MOBILE (sans DOM ni réseau), testée.
//
// Le tableau de bureau (`MesInterventionsPage`) trie et filtre par onglet
// (« À réaliser » / « Réalisées » / « Toutes ») ; la page mobile va plus loin
// et REGROUPE par échéance (« En retard », « Aujourd'hui », « Cette semaine »,
// « Plus tard », « Réalisées »), comme un relevé de tâches du jour. Ce module
// ne fait QUE ce regroupement et les petites présentations qui vont avec —
// la garde qui compte reste `interventions.ts` (`canComplete`, `sortInterventions`…).

import {
  formatDay, isoDay, sortInterventions, type InterventionRow,
} from "../interventions";

export type InterventionBucket = "en_retard" | "aujourdhui" | "cette_semaine" | "plus_tard" | "realisees";

export const BUCKET_LABELS: Record<InterventionBucket, string> = {
  en_retard: "En retard",
  aujourdhui: "Aujourd'hui",
  cette_semaine: "Cette semaine",
  plus_tard: "Plus tard",
  realisees: "Réalisées",
};

const BUCKET_ORDER: InterventionBucket[] = ["en_retard", "aujourdhui", "cette_semaine", "plus_tard", "realisees"];

/** `AAAA-MM-JJ` + `days` jours, en TEXTE — jamais `Date#toISOString` (UTC, décalage possible). */
export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  // Midi local : une addition de jours ne doit jamais glisser sur la veille ou
  // le lendemain à cause d'un changement d'heure (DST).
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/**
 * Case d'une intervention : réalisée d'abord, puis le jour souhaité comparé au
 * jour courant (comparaison TEXTUELLE `AAAA-MM-JJ`, jamais `Date`). « Cette
 * semaine » couvre les SIX jours qui suivent aujourd'hui (bornes incluses) ;
 * au-delà, « Plus tard ».
 */
export function bucketOf(
  row: Pick<InterventionRow, "status" | "requested_for">,
  today: string,
): InterventionBucket {
  if (row.status === "realisee") return "realisees";
  if (row.requested_for < today) return "en_retard";
  if (row.requested_for === today) return "aujourdhui";
  return row.requested_for <= addDays(today, 6) ? "cette_semaine" : "plus_tard";
}

export interface InterventionGroup<T extends InterventionRow = InterventionRow> {
  bucket: InterventionBucket;
  label: string;
  items: T[];
}

/**
 * Regroupe par échéance, dans l'ordre d'affichage de la maquette ; un groupe
 * SANS intervention est omis plutôt que rendu vide. L'ordre DANS un groupe
 * suit `sortInterventions` (le plus urgent d'abord, la plus récente réalisée
 * en tête).
 */
export function groupInterventions<T extends InterventionRow>(rows: T[], today: string): InterventionGroup<T>[] {
  const sorted = sortInterventions(rows);
  const byBucket = new Map<InterventionBucket, T[]>();
  for (const row of sorted) {
    const bucket = bucketOf(row, today);
    const list = byBucket.get(bucket);
    if (list) list.push(row);
    else byBucket.set(bucket, [row]);
  }
  return BUCKET_ORDER
    .filter((bucket) => (byBucket.get(bucket)?.length ?? 0) > 0)
    .map((bucket) => ({ bucket, label: BUCKET_LABELS[bucket], items: byBucket.get(bucket)! }));
}

export type MobileFilter = "a_faire" | "realisees";

/** Puce de filtre active (« À faire » / « Réalisées ») — mémorisée dans `?filtre=`. */
export function filterByStatus<T extends Pick<InterventionRow, "status">>(rows: T[], filter: MobileFilter): T[] {
  return rows.filter((row) => (filter === "a_faire" ? row.status !== "realisee" : row.status === "realisee"));
}

/** Effectifs des deux puces — affichés dessus (« À faire 3 », « Réalisées 12 »). */
export function counts(rows: Pick<InterventionRow, "status">[]): { aFaire: number; realisees: number } {
  return {
    aFaire: rows.filter((row) => row.status !== "realisee").length,
    realisees: rows.filter((row) => row.status === "realisee").length,
  };
}

/**
 * « Sollicitée par … pour … » — la ligne qui dit qui a demandé quoi et pour
 * quand, sous le commentaire de la sollicitation. `nameOf` reste injecté
 * (aucune jointure ici) : la page le construit depuis `memberName`.
 */
export function requestedByLine(
  row: Pick<InterventionRow, "requested_by" | "requested_for">,
  nameOf: (userId: string | null) => string,
  today: string,
): string {
  const name = nameOf(row.requested_by);
  if (row.requested_for === today) return `Sollicitée par ${name} pour aujourd'hui`;
  if (row.requested_for < today) return `Sollicitée par ${name} pour le ${formatDay(row.requested_for)} — en retard`;
  return `Sollicitée par ${name} pour le ${formatDay(row.requested_for)}`;
}

/** Une vignette « image » se prévisualise (`URL.createObjectURL`), un document se distingue par son extension. */
export function isImageFile(file: Pick<File, "type">): boolean {
  return file.type.startsWith("image/");
}

/** « Photo 1 », « Photo 2 »… — nom lisible d'une vignette sans nom de fichier exploitable. */
export function photoLabel(index: number): string {
  return `Photo ${index}`;
}
