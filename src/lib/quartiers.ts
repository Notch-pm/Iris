// Géométrie des quartiers — PURE (ni DOM ni réseau), testée.
//
// Ce que la carte doit savoir dessiner et interroger, indépendamment de qui
// fournit les limites. Le contrat du référentiel, lui, vit dans
// `src/features/socle/quartiers.ts`.

import { boundsOf, type GeoBounds, type LatLon } from "./carto";

export interface QuartierShape {
  id: string;
  name: string;
  /** Couleur libre du référentiel (`#RRGGBB`), ou `null` — teinte neutre au rendu. */
  color: string | null;
  /** Anneaux extérieurs, en coordonnées géographiques. Vide = rien à dessiner. */
  rings: LatLon[][];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `[lon, lat]` GeoJSON → `{lat, lon}`, ou `null` si le couple n'est pas exploitable. */
function toLatLon(position: unknown): LatLon | null {
  if (!Array.isArray(position) || position.length < 2) return null;
  const [lon, lat] = position;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Un anneau GeoJSON → une suite de points ; trop court pour faire une surface → écarté. */
function toRing(raw: unknown): LatLon[] | null {
  if (!Array.isArray(raw)) return null;
  const ring: LatLon[] = [];
  for (const position of raw) {
    const point = toLatLon(position);
    if (point) ring.push(point);
  }
  return ring.length >= 3 ? ring : null;
}

/**
 * Anneaux EXTÉRIEURS d'une géométrie GeoJSON (`Polygon` ou `MultiPolygon`),
 * telle que PostGIS la rend — objet, ou chaîne à parser.
 *
 * Les anneaux intérieurs (trous) sont volontairement ignorés : sur une carte de
 * 200 px, un trou dans un quartier ne se voit pas, et le dessiner demanderait
 * une règle de remplissage que le tracé simple n'a pas.
 */
export function geometryRings(geom: unknown): LatLon[][] {
  let value = geom;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!isRecord(value)) return [];
  // Une Feature enveloppe sa géométrie ; on descend d'un cran.
  if (value.type === "Feature") return geometryRings(value.geometry);

  const coordinates = value.coordinates;
  if (!Array.isArray(coordinates)) return [];

  if (value.type === "Polygon") {
    const ring = toRing(coordinates[0]);
    return ring ? [ring] : [];
  }
  if (value.type === "MultiPolygon") {
    const rings: LatLon[][] = [];
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = toRing(polygon[0]);
      if (ring) rings.push(ring);
    }
    return rings;
  }
  return [];
}

/**
 * Le point est-il dans cet anneau ? Lancer de rayon, la méthode standard —
 * suffisant ici : on ne fait pas de la géomatique, on répond à « l'adresse
 * tombe-t-elle où je crois ? ».
 */
function insideRing(point: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const x = ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (point.lon < x) inside = !inside;
  }
  return inside;
}

/**
 * Quartier contenant ce point, ou `null`. C'est ce qui donne son sens à la
 * couche : le Socle recalculera le quartier depuis l'adresse enregistrée, et
 * l'agent voit ici, tout de suite, lequel ce sera.
 *
 * Vérifié contre `ST_Contains` du Socle (2026-08-28) : même verdict.
 *
 * ⚠️ Répond à « quel quartier CONTIENT ce point ? », pas à « quel quartier
 * porte cette fiche ? ». Le Socle laisse forcer un rattachement à la main
 * (`quartier_auto = false`), et un contact sans coordonnées n'en a de toute
 * façon aucun de calculé : les deux peuvent donc légitimement différer.
 */
export function quartierAt(point: LatLon, quartiers: QuartierShape[]): QuartierShape | null {
  for (const quartier of quartiers) {
    if (quartier.rings.some((ring) => insideRing(point, ring))) return quartier;
  }
  return null;
}

/**
 * Aire signée d'un anneau (formule du lacet). En degrés² : elle ne sert qu'à
 * COMPARER deux anneaux du même quartier, jamais à mesurer un territoire.
 */
function ringArea(ring: LatLon[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j]!.lon * ring[i]!.lat - ring[i]!.lon * ring[j]!.lat;
  }
  return sum / 2;
}

/**
 * Centre de gravité d'un anneau (formule du lacet), et non la moyenne de ses
 * sommets : celle-ci se laisse tirer par les zones où les sommets sont serrés,
 * et poserait le nom de travers sur un quartier au tracé irrégulier.
 *
 * ⚠️ Ni l'un ni l'autre ne garantit un point À L'INTÉRIEUR : sur une forme
 * franchement concave (un L), le centre de gravité tombe dans le creux. C'est
 * assumé — on place une ÉTIQUETTE, pas un marqueur : le vrai « pôle
 * d'inaccessibilité » coûterait bien plus cher que le défaut qu'il corrige.
 * Repli sur la moyenne quand l'aire est nulle (anneau dégénéré).
 */
export function ringCentroid(ring: LatLon[]): LatLon {
  const area = ringArea(ring);
  if (area === 0) {
    const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 });
    return { lat: sum.lat / ring.length, lon: sum.lon / ring.length };
  }
  let lat = 0;
  let lon = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const cross = a.lon * b.lat - b.lon * a.lat;
    lon += (a.lon + b.lon) * cross;
    lat += (a.lat + b.lat) * cross;
  }
  return { lat: lat / (6 * area), lon: lon / (6 * area) };
}

/**
 * Où poser le NOM d'un quartier : au centre de son plus grand anneau. Un
 * quartier en plusieurs morceaux (« ouest » en a deux sur ACCM) n'est nommé
 * qu'une fois — répéter l'étiquette encombrerait plus qu'elle n'informe.
 */
export function quartierLabelPoint(quartier: QuartierShape): LatLon | null {
  let best: LatLon | null = null;
  let bestArea = -1;
  for (const ring of quartier.rings) {
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ringCentroid(ring);
    }
  }
  return best;
}

/**
 * Étendue du TERRITOIRE : la boîte englobant tous les quartiers publiés, ou
 * `null` quand le référentiel n'en publie aucun (ou n'a pas répondu).
 *
 * C'est le cadrage qui a du SENS pour la carte d'une collectivité : ce qu'un
 * agent vient voir, c'est son territoire — pas le barycentre des demandes du
 * jour, qu'une seule demande lointaine suffit à déplacer, ni le seul siège,
 * qui ne dit rien de l'étendue à couvrir (leçons des 2026-08-23 et 08-30).
 *
 * ⚠️ L'étendue DESSINÉE, pas l'étendue administrative : un quartier absent du
 * découpage manque aussi au cadre. C'est assumé — le Socle fait foi, Iris
 * cadre sur ce qu'il en reçoit.
 */
export function quartiersBounds(quartiers: QuartierShape[]): GeoBounds | null {
  return boundsOf(quartiers.flatMap((quartier) => quartier.rings.flat()));
}
