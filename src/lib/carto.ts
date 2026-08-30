// Cartographie libre — logique PURE (ni DOM ni réseau) : configuration des
// services, projection Web Mercator découpée en tuiles, lecture d'une réponse
// de géocodage, URL d'itinéraire.
//
// Deux services publics, sans clé ni compte (rien de secret dans le bundle) :
//  - **tuiles** : OpenStreetMap. L'affichage DOIT porter l'attribution
//    « © les contributeurs OpenStreetMap » (ODbL). La politique d'usage de
//    l'OSMF réserve ses serveurs aux faibles volumes : `VITE_MAP_TILE_URL`
//    permet de basculer sur un fournisseur de tuiles dédié sans toucher au code.
//  - **géocodage** : Base Adresse Nationale, servie par la Géoplateforme (IGN)
//    depuis le retrait d'`api-adresse.data.gouv.fr` (janvier 2026). Pensée pour
//    les adresses françaises, substituable par `VITE_GEOCODE_URL` (le contrat de
//    réponse attendu reste le GeoJSON BAN).
//
// Ce qui transite vers ces services : une ADRESSE, et rien qui l'accompagne —
// jamais un nom, jamais une référence de demande. Cela vaut pour l'adresse d'un
// lieu d'intervention comme pour celle d'un usager qu'un agent est en train de
// saisir (`src/lib/adresse.ts`) : le fragment part seul.

import { buildCsv, parseCsv } from "./csv";

export interface CartoConfig {
  /** Gabarit de tuiles raster — jetons `{z}` `{x}` `{y}` (et `{s}` facultatif). */
  tileUrl: string;
  /** Point d'entrée de recherche d'adresse (contrat BAN). */
  geocodeUrl: string;
}

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// `api-adresse.data.gouv.fr` a été décommissionné fin janvier 2026 et ne
// répond plus que par proxy : on vise directement la Géoplateforme. La forme
// `<base>/csv/` que compose `batchGeocodeUrl` y fonctionne à l'identique
// (vérifié) — l'endpoint `/geocodage/batch/`, lui, n'existe pas.
export const DEFAULT_GEOCODE_URL = "https://data.geopf.fr/geocodage/search/";

/** Configuration cartographique : défauts libres, surchargeables par l'environnement. */
export function readCartoConfig(env: Record<string, unknown>): CartoConfig {
  const tileUrl = env.VITE_MAP_TILE_URL;
  const geocodeUrl = env.VITE_GEOCODE_URL;
  return {
    tileUrl: typeof tileUrl === "string" && tileUrl.trim() !== "" ? tileUrl.trim() : DEFAULT_TILE_URL,
    geocodeUrl:
      typeof geocodeUrl === "string" && geocodeUrl.trim() !== "" ? geocodeUrl.trim() : DEFAULT_GEOCODE_URL,
  };
}

export const CARTO: CartoConfig = readCartoConfig(
  (import.meta.env ?? {}) as unknown as Record<string, unknown>,
);

// ---- Projection et tuiles ---------------------------------------------------

export const TILE_SIZE = 256;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 19;
export const DEFAULT_ZOOM = 17;

/** Latitude au-delà de laquelle la projection Mercator diverge. */
const MERCATOR_LIMIT = 85.05112878;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/** Position en pixels « monde » (Web Mercator) au niveau de zoom donné. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const rad = (Math.min(MERCATOR_LIMIT, Math.max(-MERCATOR_LIMIT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

export interface MapTile {
  key: string;
  url: string;
  /** Position absolue de la tuile dans le conteneur, en pixels. */
  left: number;
  top: number;
}

const SUBDOMAINS = ["a", "b", "c"] as const;

function tileUrlOf(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{s}", SUBDOMAINS[(x + y) % SUBDOMAINS.length]!)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Vue courante d'une carte : centre géographique, zoom, taille du conteneur. */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
  width: number;
  height: number;
  tileUrl?: string;
}

/**
 * Tuiles couvrant une vue `width`×`height` centrée sur (lat, lon), chacune avec
 * sa position absolue dans le conteneur. Le point demandé tombe au centre exact
 * du conteneur : le marqueur n'a donc aucune position à calculer.
 */
export function mapTiles(input: MapView): MapTile[] {
  const { lat, lon, width, height } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!(width > 0) || !(height > 0)) return [];

  const zoom = clampZoom(input.zoom);
  const template = input.tileUrl ?? CARTO.tileUrl;
  const count = 2 ** zoom;
  const center = worldPixel(lat, lon, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;

  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + height) / TILE_SIZE));

  const tiles: MapTile[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      // Antiméridien : l'axe X boucle, l'axe Y non (déjà borné ci-dessus).
      const wrapped = ((x % count) + count) % count;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: tileUrlOf(template, zoom, wrapped, y),
        left: x * TILE_SIZE - originX,
        top: y * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Inverse de `worldPixel` : des pixels « monde » vers les coordonnées. */
export function worldPixelToLatLon(x: number, y: number, zoom: number): LatLon {
  const size = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lon: (x / size) * 360 - 180,
  };
}

/** Position d'un point dans le conteneur (le centre de la vue tombe au milieu). */
export function markerPosition(point: LatLon, view: MapView): { left: number; top: number } {
  const center = worldPixel(view.lat, view.lon, view.zoom);
  const target = worldPixel(point.lat, point.lon, view.zoom);
  return {
    left: target.x - center.x + view.width / 2,
    top: target.y - center.y + view.height / 2,
  };
}

/** Nouveau centre après un déplacement à la souris de (dx, dy) pixels. */
export function panView(view: MapView, dx: number, dy: number): LatLon {
  const center = worldPixel(view.lat, view.lon, view.zoom);
  return worldPixelToLatLon(center.x - dx, center.y - dy, view.zoom);
}

/**
 * Centre et zoom englobant tous les points, marge comprise. Un seul point (ou
 * des points confondus) → zoom de lecture par défaut ; aucun point → centre de
 * la France métropolitaine au zoom le plus large.
 */
export function fitBounds(
  points: LatLon[],
  width: number,
  height: number,
  padding = 56,
): { lat: number; lon: number; zoom: number } {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (usable.length === 0) return { lat: 46.6, lon: 2.5, zoom: MIN_ZOOM };

  const lats = usable.map((p) => p.lat);
  const lons = usable.map((p) => p.lon);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lons);
  const east = Math.max(...lons);

  const innerWidth = Math.max(32, width - 2 * padding);
  const innerHeight = Math.max(32, height - 2 * padding);

  let zoom = MAX_ZOOM;
  for (let candidate = MAX_ZOOM; candidate >= MIN_ZOOM; candidate--) {
    const a = worldPixel(north, west, candidate);
    const b = worldPixel(south, east, candidate);
    if (b.x - a.x <= innerWidth && b.y - a.y <= innerHeight) {
      zoom = candidate;
      break;
    }
    zoom = candidate;
  }
  const topLeft = worldPixel(north, west, zoom);
  const bottomRight = worldPixel(south, east, zoom);
  const center = worldPixelToLatLon(
    (topLeft.x + bottomRight.x) / 2,
    (topLeft.y + bottomRight.y) / 2,
    zoom,
  );
  return { ...center, zoom: usable.length === 1 ? DEFAULT_ZOOM : zoom };
}

/**
 * Même travail que `fitBounds`, mais le CENTRE EST IMPOSÉ : on ne cherche que
 * le zoom, le plus serré qui laisse tous les points visibles AUTOUR de ce
 * centre. Sert à ancrer une carte sur un lieu qui a un sens — le siège de la
 * collectivité — plutôt que sur le barycentre de ce qu'elle affiche.
 *
 * ⚠️ Pourquoi ne pas simplement remplacer le centre calculé par `fitBounds` :
 * son zoom est calculé POUR SON centre. Le déplacer sans retoucher le zoom
 * pousse hors cadre les points du côté opposé. Ici l'étendue est mesurée en
 * symétrique autour du centre imposé, donc rien ne sort par construction —
 * au prix d'un zoom plus large quand un point est loin.
 *
 * Aucun point → le centre au zoom le PLUS LARGE (`MIN_ZOOM`) : on montre le
 * territoire, pas un trottoir. Rien ne rentre, même au plus large → `MIN_ZOOM` :
 * la carte reste chez elle, et les épingles lointaines s'atteignent par
 * « Recadrer ».
 *
 * ⚠️ Le zoom est BORNÉ au zoom de lecture (`DEFAULT_ZOOM`), jamais plus serré :
 * sans cela, une unique demande située au siège même de la collectivité
 * amènerait la carte au zoom maximal, sur un trottoir. Contrairement au cas
 * `fitBounds`, on ne peut PAS traiter « un seul point » en le posant au zoom de
 * lecture sans le vérifier : ici le centre n'est pas ce point, et une demande à
 * trente kilomètres sortirait du cadre.
 */
export function fitAround(
  center: LatLon,
  points: LatLon[],
  width: number,
  height: number,
  padding = 56,
): { lat: number; lon: number; zoom: number } {
  const anchor = { lat: center.lat, lon: center.lon };
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (usable.length === 0) return { ...anchor, zoom: MIN_ZOOM };

  // Demi-fenêtre : l'étendue est mesurée de part et d'autre du centre.
  const halfWidth = Math.max(16, (width - 2 * padding) / 2);
  const halfHeight = Math.max(16, (height - 2 * padding) / 2);

  let zoom = MIN_ZOOM;
  for (let candidate = MAX_ZOOM; candidate >= MIN_ZOOM; candidate--) {
    const c = worldPixel(anchor.lat, anchor.lon, candidate);
    const fits = usable.every((p) => {
      const q = worldPixel(p.lat, p.lon, candidate);
      return Math.abs(q.x - c.x) <= halfWidth && Math.abs(q.y - c.y) <= halfHeight;
    });
    if (fits) {
      zoom = candidate;
      break;
    }
    zoom = candidate;
  }
  return { ...anchor, zoom: Math.min(zoom, DEFAULT_ZOOM) };
}

/** Carte OpenStreetMap complète (marqueur + zoom), pour « ouvrir en grand ». */
export function openStreetMapUrl(lat: number, lon: number, zoom: number): string {
  const z = clampZoom(zoom);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${z}/${lat}/${lon}`;
}

/**
 * Itinéraire Google Maps vers une adresse (schéma d'URL public documenté) : le
 * point de départ est la position de l'agent, le mode de transport reste le
 * sien. `null` si l'adresse est vide — le bouton reste alors inerte.
 */
export function googleMapsDirectionsUrl(destination: string): string | null {
  const query = destination.trim();
  if (query === "") return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

// ---- Géocodage (contrat Base Adresse Nationale) ------------------------------

export type GeoPrecision = "adresse" | "voie" | "lieu_dit" | "commune";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Adresse normalisée telle que le géocodeur l'a comprise. */
  label: string;
  precision: GeoPrecision;
  /** Score BAN : classement RELATIF à la réponse, jamais une probabilité. */
  score: number;
}

/** Requête de géocodage — `null` si l'adresse est trop courte pour être cherchée. */
export function geocodeUrl(query: string, postcode: string | null, base = CARTO.geocodeUrl): string | null {
  const q = query.trim();
  if (q.length < 3) return null;
  const url = new URL(base);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "1");
  url.searchParams.set("autocomplete", "0");
  if (postcode && /^\d{5}$/.test(postcode.trim())) url.searchParams.set("postcode", postcode.trim());
  return url.toString();
}

const PRECISION_BY_TYPE: Record<string, GeoPrecision> = {
  housenumber: "adresse",
  street: "voie",
  locality: "lieu_dit",
  municipality: "commune",
};

/** Type de résultat du géocodeur → finesse annoncée (inconnu : la plus large). */
export function precisionOf(type: string | undefined): GeoPrecision {
  if (!type) return "commune";
  return PRECISION_BY_TYPE[type] ?? "commune";
}

/** Zoom d'affichage adapté à la finesse du point trouvé. */
export function zoomForPrecision(precision: GeoPrecision): number {
  switch (precision) {
    case "adresse":
      return 18;
    case "voie":
      return 17;
    case "lieu_dit":
      return 16;
    default:
      return 13;
  }
}

export const PRECISION_LABELS: Record<GeoPrecision, string> = {
  adresse: "Numéro localisé",
  voie: "Voie localisée — numéro non trouvé",
  lieu_dit: "Lieu-dit localisé",
  commune: "Commune seule — adresse non trouvée",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lecture tolérante d'une réponse GeoJSON BAN : le premier point exploitable,
 * ou `null`. Toute forme inattendue vaut « adresse non localisée » — jamais une
 * exception (la carte est un confort, l'adresse reste affichée).
 */
export function parseGeocodeResponse(raw: unknown): GeoPoint | null {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return null;
  for (const feature of raw.features) {
    if (!isRecord(feature)) continue;
    const geometry = isRecord(feature.geometry) ? feature.geometry : null;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    return {
      lat,
      lon,
      label: typeof properties.label === "string" ? properties.label : "",
      precision: precisionOf(typeof properties.type === "string" ? properties.type : undefined),
      score: typeof properties.score === "number" ? properties.score : 0,
    };
  }
  return null;
}

// ---- Géocodage en masse (endpoint CSV de la BAN) ----------------------------
//
// Une carte porte des dizaines d'adresses : un appel unitaire par demande
// saturerait le service (et le navigateur). L'endpoint CSV géocode tout le lot
// en une requête, et rend les colonnes d'entrée intactes — d'où la colonne
// `cle`, opaque, qui rattache chaque résultat à sa demande.

export interface BatchAddress {
  /** Clé du demandeur, renvoyée telle quelle par le service. */
  key: string;
  query: string;
  postcode: string | null;
}

export const BATCH_KEY_COLUMN = "cle";
export const BATCH_QUERY_COLUMN = "adresse";
export const BATCH_POSTCODE_COLUMN = "cp";
/** Colonnes de résultat demandées (le reste alourdirait la réponse pour rien). */
export const BATCH_RESULT_COLUMNS = [
  "latitude", "longitude", "result_score", "result_type", "result_label",
] as const;

/** Point d'entrée du géocodage en masse, dérivé de celui de la recherche unitaire. */
export function batchGeocodeUrl(base = CARTO.geocodeUrl): string {
  return `${base.replace(/\/?$/, "/")}csv/`;
}

/** CSV d'entrée : une ligne par adresse distincte (séparateur virgule). */
export function batchGeocodeCsv(rows: BatchAddress[]): string {
  return buildCsv(
    rows,
    [
      { header: BATCH_KEY_COLUMN, accessor: (r) => r.key },
      { header: BATCH_QUERY_COLUMN, accessor: (r) => r.query },
      { header: BATCH_POSTCODE_COLUMN, accessor: (r) => (r.postcode && /^\d{5}$/.test(r.postcode) ? r.postcode : "") },
    ],
    ",",
  );
}

/**
 * Réponse CSV → point par clé. Une adresse non localisée vaut `null` (elle est
 * connue et sans point : inutile de la redemander), une clé absente de la table
 * reste absente de la Map. Toute réponse illisible rend une Map vide.
 */
export function parseBatchGeocodeCsv(text: string): Map<string, GeoPoint | null> {
  const out = new Map<string, GeoPoint | null>();
  const table = parseCsv(text, ",");
  if (table.length < 2) return out;
  const header = table[0]!.map((h) => h.trim());
  const column = (name: string) => header.indexOf(name);
  const iKey = column(BATCH_KEY_COLUMN);
  const iLat = column("latitude");
  const iLon = column("longitude");
  if (iKey < 0 || iLat < 0 || iLon < 0) return out;

  for (const row of table.slice(1)) {
    const key = row[iKey];
    if (key === undefined || key === "") continue;
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    const located =
      row[iLat] !== "" && row[iLon] !== "" &&
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!located) {
      out.set(key, null);
      continue;
    }
    const at = (name: string) => {
      const index = column(name);
      return index < 0 ? undefined : row[index];
    };
    out.set(key, {
      lat,
      lon,
      label: at("result_label") ?? "",
      precision: precisionOf(at("result_type")),
      score: Number(at("result_score")) || 0,
    });
  }
  return out;
}
