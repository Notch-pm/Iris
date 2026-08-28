// Quartiers du référentiel Socle — lecture TOLÉRANTE de la réponse du proxy.
//
// Le quartier est calculé par le SOCLE à partir de l'adresse ; Iris n'en écrit
// jamais. Il en lisait jusqu'ici le seul libellé résolu sur une fiche usager
// (`sanitizeContact` : id / name / color) — la géométrie, elle, était retirée,
// et à raison : un polygone par ligne d'annuaire n'a aucun sens.
//
// Pour la DESSINER il faut une autre porte : `socle-proxy /v1/quartiers/list`,
// prévue par l'architecture validée (« géométries de quartiers », §C).
//
// ⚠️ Le champ est `geometry` (contrat public-api : GeoJSON de `ST_AsGeoJSON`),
// pas `geom` (le nom de la colonne PostGIS, binaire, qui ne sort jamais).
//
// Rien n'est stocké côté Iris : les limites sont relues, mises en cache le
// temps de la session, et jamais persistées — même règle que les points de la
// carte des interventions.
//
// La géométrie elle-même (dessin, appartenance d'un point) vit dans
// `src/lib/quartiers.ts` : elle ne dépend pas du référentiel qui la fournit.

import { geometryRings, type QuartierShape } from "@/lib/quartiers";

export type { QuartierShape };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Couleur libre du référentiel. Le Socle écrit du `hsl(152 83% 42%)` autant que
 * du `#00D084` (vérifié sur le tenant ACCM, 2026-08-28) — la pastille de la
 * fiche usager l'accepte déjà telle quelle : n'imposer ici que du hexadécimal
 * aurait effacé toutes les couleurs du référentiel.
 *
 * On écarte seulement ce qui n'a rien à faire dans une valeur de couleur : les
 * caractères de structure CSS ou HTML, et les valeurs déraisonnablement longues.
 */
function color(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 64) return null;
  return /[<>;{}]/.test(trimmed) ? null : trimmed;
}

/**
 * Lecture TOLÉRANTE de la réponse du proxy. Un quartier sans géométrie
 * exploitable n'est pas une erreur : il n'est simplement pas dessinable, et
 * disparaît de la couche — la carte reste juste.
 */
export function parseQuartiers(raw: unknown): QuartierShape[] {
  const list = isRecord(raw) && Array.isArray(raw.quartiers) ? raw.quartiers : [];
  const out: QuartierShape[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const rings = geometryRings(entry.geometry);
    if (rings.length === 0) continue;
    out.push({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : "",
      color: color(entry.color),
      rings,
    });
  }
  return out;
}
