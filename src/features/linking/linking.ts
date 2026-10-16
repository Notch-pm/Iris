// Demandes liées — règles pures du réglage par démarche (lot L1 de
// docs/demandes-liees.md).
//
// Une démarche est MUTUALISABLE quand plusieurs habitants peuvent y signaler le
// même incident (voirie, éclairage, dépôt sauvage) : leurs demandes se lient et
// se résolvent ensemble. Une carte de déchetterie ne l'est pas. Le réglage vit
// dans Iris (`procedure_link_settings`), écrit par la seule RPC
// `save_procedure_link_settings` — ce module ne fait que REFLÉTER ses bornes,
// la garde est en SQL.

/** Bornes de la RPC (jumelles des CHECK de `procedure_link_settings`). */
export const RADIUS_MIN = 10;
export const RADIUS_MAX = 5000;
export const WINDOW_MIN = 1;
export const WINDOW_MAX = 365;
/** Valeurs par défaut d'une démarche jamais réglée (défauts de la table). */
export const DEFAULT_RADIUS_M = 150;
export const DEFAULT_WINDOW_DAYS = 60;

export interface ProcedureRow {
  socle_id: string;
  name: string;
  category_name: string | null;
  obsoleted_at: string | null;
}

export interface LinkSettingRow {
  socle_procedure_id: string;
  enabled: boolean;
  radius_m: number;
  window_days: number;
}

export interface LinkSettingView {
  procedureId: string;
  name: string;
  category: string | null;
  obsolete: boolean;
  enabled: boolean;
  radiusM: number;
  windowDays: number;
}

/**
 * Une ligne par démarche du cache, avec son réglage — ou les défauts, une
 * démarche absente de la table n'étant PAS mutualisable (*fail closed*).
 * Les démarches obsolètes ne s'affichent que si elles étaient mutualisables :
 * on doit pouvoir éteindre ce qu'on a allumé, pas régler ce qui n'existe plus.
 * Tri : catégorie, puis nom.
 */
export function linkSettingViews(
  procedures: ProcedureRow[],
  settings: LinkSettingRow[],
): LinkSettingView[] {
  const byId = new Map(settings.map((s) => [s.socle_procedure_id, s]));
  return procedures
    .map((p): LinkSettingView => {
      const s = byId.get(p.socle_id);
      return {
        procedureId: p.socle_id,
        name: p.name,
        category: p.category_name,
        obsolete: p.obsoleted_at !== null,
        enabled: s?.enabled ?? false,
        radiusM: s?.radius_m ?? DEFAULT_RADIUS_M,
        windowDays: s?.window_days ?? DEFAULT_WINDOW_DAYS,
      };
    })
    .filter((v) => !v.obsolete || v.enabled)
    .sort((a, b) => {
      if (a.category !== b.category) {
        if (a.category === null) return 1;
        if (b.category === null) return -1;
        const byCategory = a.category.localeCompare(b.category, "fr");
        if (byCategory !== 0) return byCategory;
      }
      return a.name.localeCompare(b.name, "fr");
    });
}

export type BoundError = string | null;

function parseBounded(raw: string, min: number, max: number, unit: string): { value: number | null; error: BoundError } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { value: null, error: `Nombre entier attendu (${min} à ${max} ${unit}).` };
  const n = Number(trimmed);
  if (n < min || n > max) return { value: null, error: `Entre ${min} et ${max.toLocaleString("fr-FR")} ${unit}.` };
  return { value: n, error: null };
}

export function parseRadius(raw: string) {
  return parseBounded(raw, RADIUS_MIN, RADIUS_MAX, "mètres");
}

export function parseWindow(raw: string) {
  return parseBounded(raw, WINDOW_MIN, WINDOW_MAX, "jours");
}

/** Combien de démarches sont mutualisables — résumé de la carte des Paramètres. */
export function enabledCount(views: LinkSettingView[]): number {
  return views.filter((v) => v.enabled).length;
}
