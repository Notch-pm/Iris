import { describe, expect, it } from "vitest";
import {
  batchGeocodeCsv,
  batchGeocodeUrl,
  boundsOf,
  clampZoom,
  COUNTRY_ZOOM,
  DEFAULT_GEOCODE_URL,
  DEFAULT_TILE_URL,
  fitAround,
  fitBounds,
  fitBox,
  geocodeUrl,
  googleMapsDirectionsUrl,
  mapTiles,
  markerPosition,
  MAX_ZOOM,
  MIN_ZOOM,
  openStreetMapUrl,
  panView,
  parseBatchGeocodeCsv,
  TERRITORY_ZOOM,
  parseGeocodeResponse,
  readCartoConfig,
  TILE_SIZE,
  worldPixel,
  worldPixelToLatLon,
  zoomForPrecision,
} from "./carto";

const TEMPLATE = "https://tuiles.test/{z}/{x}/{y}.png";
// 6 rue de la République, 69001 Lyon (réponse réelle de la BAN).
const LAT = 45.766371;
const LON = 4.835843;

describe("readCartoConfig", () => {
  it("retombe sur les services libres par défaut", () => {
    expect(readCartoConfig({})).toEqual({ tileUrl: DEFAULT_TILE_URL, geocodeUrl: DEFAULT_GEOCODE_URL });
    expect(readCartoConfig({ VITE_MAP_TILE_URL: "  ", VITE_GEOCODE_URL: 42 }).tileUrl).toBe(DEFAULT_TILE_URL);
  });
  it("accepte un fournisseur de tuiles ou un géocodeur dédié", () => {
    const config = readCartoConfig({ VITE_MAP_TILE_URL: ` ${TEMPLATE} `, VITE_GEOCODE_URL: "https://geo.test/search/" });
    expect(config).toEqual({ tileUrl: TEMPLATE, geocodeUrl: "https://geo.test/search/" });
  });
});

describe("worldPixel", () => {
  it("projette le méridien et l'équateur au centre du monde", () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
  });
  it("place Lyon dans la tuile OSM attendue au zoom 16", () => {
    const { x, y } = worldPixel(LAT, LON, 16);
    expect(Math.floor(x / TILE_SIZE)).toBe(33648);
    expect(Math.floor(y / TILE_SIZE)).toBe(23376);
  });
  it("borne les latitudes au-delà desquelles Mercator diverge", () => {
    expect(Number.isFinite(worldPixel(90, 0, 3).y)).toBe(true);
    expect(Number.isFinite(worldPixel(-90, 0, 3).y)).toBe(true);
  });
});

describe("planchers de zoom", () => {
  it("laisse l'agent reculer PLUS LOIN que ce que la carte se donne seule", () => {
    // L'intention du 2026-08-31 : une demande hors territoire doit pouvoir
    // entrer dans le champ à la molette, sans que la carte s'ouvre d'elle-même
    // sur l'Europe à l'arrivée d'une épingle lointaine.
    expect(MIN_ZOOM).toBeLessThan(TERRITORY_ZOOM);
    expect(COUNTRY_ZOOM).toBeLessThan(TERRITORY_ZOOM);
  });
});

describe("clampZoom", () => {
  it("borne le zoom et arrondit", () => {
    expect(clampZoom(MIN_ZOOM - 5)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM + 5)).toBe(MAX_ZOOM);
    expect(clampZoom(16.4)).toBe(16);
    expect(clampZoom(Number.NaN)).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});

describe("mapTiles", () => {
  it("couvre le conteneur et centre le point demandé", () => {
    const width = 600;
    const height = 220;
    const tiles = mapTiles({ lat: LAT, lon: LON, zoom: 16, width, height, tileUrl: TEMPLATE });
    expect(tiles.length).toBeGreaterThan(0);
    // Le point est au centre exact : la tuile qui le porte l'encadre.
    const center = worldPixel(LAT, LON, 16);
    const holder = tiles.find((t) => t.key === `16/${Math.floor(center.x / TILE_SIZE)}/${Math.floor(center.y / TILE_SIZE)}`);
    expect(holder).toBeDefined();
    expect(holder!.left).toBeLessThanOrEqual(width / 2);
    expect(holder!.left + TILE_SIZE).toBeGreaterThanOrEqual(width / 2);
    expect(holder!.top).toBeLessThanOrEqual(height / 2);
    expect(holder!.top + TILE_SIZE).toBeGreaterThanOrEqual(height / 2);
    // Aucun trou : la mosaïque déborde du conteneur des deux côtés.
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(width);
  });
  it("remplit le gabarit de tuiles", () => {
    const [tile] = mapTiles({ lat: LAT, lon: LON, zoom: 16, width: 300, height: 200, tileUrl: TEMPLATE });
    expect(tile!.url).toMatch(/^https:\/\/tuiles\.test\/16\/\d+\/\d+\.png$/);
    const withSubdomain = mapTiles({
      lat: LAT, lon: LON, zoom: 16, width: 300, height: 200, tileUrl: "https://{s}.tuiles.test/{z}/{x}/{y}.png",
    });
    expect(withSubdomain[0]!.url).toMatch(/^https:\/\/[abc]\.tuiles\.test\//);
  });
  it("ne produit rien sans conteneur mesuré ni coordonnées valides", () => {
    expect(mapTiles({ lat: LAT, lon: LON, zoom: 16, width: 0, height: 220 })).toEqual([]);
    expect(mapTiles({ lat: Number.NaN, lon: LON, zoom: 16, width: 600, height: 220 })).toEqual([]);
  });
  it("boucle l'axe X à l'antiméridien sans sortir de la grille en Y", () => {
    const tiles = mapTiles({ lat: 0, lon: 179.999, zoom: 12, width: 800, height: 400, tileUrl: TEMPLATE });
    const indices = tiles.map((t) => Number(t.url.split("/")[3]));
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...indices)).toBeLessThan(2 ** 12);
  });
});

describe("googleMapsDirectionsUrl", () => {
  it("compose un itinéraire vers l'adresse encodée", () => {
    expect(googleMapsDirectionsUrl("6 Rue de la République, 69001 Lyon")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=6%20Rue%20de%20la%20R%C3%A9publique%2C%2069001%20Lyon",
    );
  });
  it("n'a pas de destination sans adresse", () => {
    expect(googleMapsDirectionsUrl("   ")).toBeNull();
  });
});

describe("openStreetMapUrl", () => {
  it("pointe le marqueur et le niveau de zoom", () => {
    expect(openStreetMapUrl(LAT, LON, 18)).toBe(
      `https://www.openstreetmap.org/?mlat=${LAT}&mlon=${LON}#map=18/${LAT}/${LON}`,
    );
  });
});

describe("geocodeUrl", () => {
  it("interroge le géocodeur avec un seul résultat attendu", () => {
    const url = new URL(geocodeUrl("6 rue de la République, 69001 Lyon", "69001", "https://geo.test/search/")!);
    expect(url.searchParams.get("q")).toBe("6 rue de la République, 69001 Lyon");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("autocomplete")).toBe("0");
    expect(url.searchParams.get("postcode")).toBe("69001");
  });
  it("ignore un code postal qui n'en est pas un, et refuse une adresse trop courte", () => {
    expect(new URL(geocodeUrl("Lyon", "6900", "https://geo.test/search/")!).searchParams.get("postcode")).toBeNull();
    expect(geocodeUrl("  a ", null, "https://geo.test/search/")).toBeNull();
  });
});

describe("parseGeocodeResponse", () => {
  const feature = (properties: Record<string, unknown>, coordinates: unknown = [LON, LAT]) => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates }, properties }],
  });

  it("lit le premier point de la réponse BAN", () => {
    const point = parseGeocodeResponse(
      feature({ label: "6 Rue de la République 69001 Lyon", score: 0.96, type: "housenumber" }),
    );
    expect(point).toEqual({ lat: LAT, lon: LON, label: "6 Rue de la République 69001 Lyon", precision: "adresse", score: 0.96 });
  });
  it("traduit la finesse du résultat", () => {
    expect(parseGeocodeResponse(feature({ type: "street" }))!.precision).toBe("voie");
    expect(parseGeocodeResponse(feature({ type: "locality" }))!.precision).toBe("lieu_dit");
    expect(parseGeocodeResponse(feature({ type: "municipality" }))!.precision).toBe("commune");
    // Type inconnu : prudence, on annonce la maille la plus large.
    expect(parseGeocodeResponse(feature({ type: "galaxie" }))!.precision).toBe("commune");
  });
  it("rend null sur toute réponse inexploitable, sans lever", () => {
    expect(parseGeocodeResponse({ type: "FeatureCollection", features: [] })).toBeNull();
    expect(parseGeocodeResponse(feature({}, ["4.8", "45.7"]))).toBeNull();
    expect(parseGeocodeResponse(feature({}, [500, 45]))).toBeNull();
    expect(parseGeocodeResponse(feature({}, [4.8]))).toBeNull();
    expect(parseGeocodeResponse("pas du geojson")).toBeNull();
    expect(parseGeocodeResponse(null)).toBeNull();
  });
});

describe("zoomForPrecision", () => {
  it("resserre sur le numéro, s'élargit sur la commune", () => {
    expect(zoomForPrecision("adresse")).toBeGreaterThan(zoomForPrecision("voie"));
    expect(zoomForPrecision("voie")).toBeGreaterThan(zoomForPrecision("commune"));
  });
});

describe("worldPixelToLatLon", () => {
  it("est l'inverse de worldPixel", () => {
    const { x, y } = worldPixel(LAT, LON, 15);
    const back = worldPixelToLatLon(x, y, 15);
    expect(back.lat).toBeCloseTo(LAT, 6);
    expect(back.lon).toBeCloseTo(LON, 6);
  });
});

describe("markerPosition", () => {
  const view = { lat: LAT, lon: LON, zoom: 15, width: 800, height: 400 };

  it("pose le centre de la vue au milieu du conteneur", () => {
    expect(markerPosition({ lat: LAT, lon: LON }, view)).toEqual({ left: 400, top: 200 });
  });
  it("place l'est à droite et le nord en haut", () => {
    const east = markerPosition({ lat: LAT, lon: LON + 0.01 }, view);
    const north = markerPosition({ lat: LAT + 0.01, lon: LON }, view);
    expect(east.left).toBeGreaterThan(400);
    expect(north.top).toBeLessThan(200);
  });
});

describe("panView", () => {
  it("déplace la vue à l'inverse du geste (glisser vers la droite va vers l'ouest)", () => {
    const view = { lat: LAT, lon: LON, zoom: 15, width: 800, height: 400 };
    const moved = panView(view, 100, 0);
    expect(moved.lon).toBeLessThan(LON);
    expect(moved.lat).toBeCloseTo(LAT, 6);
    // Aller-retour : on retombe sur le centre initial.
    const back = panView({ ...view, ...moved }, -100, 0);
    expect(back.lon).toBeCloseTo(LON, 9);
  });
});

describe("fitBounds", () => {
  const width = 800;
  const height = 400;

  it("cadre tous les points dans le conteneur", () => {
    const points = [
      { lat: 45.766371, lon: 4.835843 },
      { lat: 45.781, lon: 4.879 },
      { lat: 45.744, lon: 4.812 },
    ];
    const fitted = fitBounds(points, width, height);
    const view = { ...fitted, width, height };
    for (const point of points) {
      const { left, top } = markerPosition(point, view);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(width);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(height);
    }
  });
  it("garde un zoom de lecture pour un point unique", () => {
    const fitted = fitBounds([{ lat: LAT, lon: LON }], width, height);
    expect(fitted).toMatchObject({ zoom: 17 });
    expect(fitted.lat).toBeCloseTo(LAT, 6);
  });
  it("retombe sur la France entière sans point", () => {
    expect(fitBounds([], width, height)).toEqual({ lat: 46.6, lon: 2.5, zoom: COUNTRY_ZOOM });
  });

  it("garde le zoom de lecture pour des points CONFONDUS", () => {
    // Deux demandes à la même adresse : il n'y a rien à cadrer, et le zoom
    // maximal poserait la carte sur un trottoir.
    const fitted = fitBounds([{ lat: LAT, lon: LON }, { lat: LAT, lon: LON }], width, height);
    expect(fitted.zoom).toBe(17);
  });

  it("ne recule pas au-delà du territoire pour rattraper une épingle lointaine", () => {
    // Arles et Nantes : rien ne peut cadrer les deux à l'échelle d'un
    // territoire. La carte ne part pas pour autant à l'échelle du continent.
    const fitted = fitBounds(
      [{ lat: 43.6768, lon: 4.6277 }, { lat: 47.218, lon: -1.554 }],
      width,
      height,
    );
    expect(fitted.zoom).toBe(TERRITORY_ZOOM);
  });
});

describe("boundsOf", () => {
  it("rend les quatre bords des points exploitables", () => {
    expect(
      boundsOf([
        { lat: 43.6, lon: 4.5 },
        { lat: 43.8, lon: 4.9 },
        { lat: Number.NaN, lon: 4.7 },
      ]),
    ).toEqual({ south: 43.6, west: 4.5, north: 43.8, east: 4.9 });
  });

  it("rend null quand aucun point n'est exploitable", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: Number.NaN, lon: Number.POSITIVE_INFINITY }])).toBeNull();
  });
});

describe("fitBox", () => {
  const width = 800;
  const height = 400;
  // Étendue d'ACCM (Arles, Camargue, Crau) : ~60 km d'est en ouest.
  const territoire = { south: 43.33, west: 4.36, north: 43.83, east: 4.92 };

  it("cadre l'étendue entière dans le conteneur", () => {
    const view = { ...fitBox(territoire, width, height, 56, MIN_ZOOM), width, height };
    for (const corner of [
      { lat: territoire.north, lon: territoire.west },
      { lat: territoire.south, lon: territoire.east },
    ]) {
      const { left, top } = markerPosition(corner, view);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(width);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(height);
    }
  });

  it("descend SOUS le zoom d'un territoire quand l'étendue l'exige", () => {
    // Le cas qui a motivé la séparation des deux planchers : une
    // intercommunalité ne tient pas dans un écran au zoom 12.
    expect(fitBox(territoire, width, height, 56, MIN_ZOOM).zoom).toBeLessThan(TERRITORY_ZOOM);
  });

  it("s'arrête au plancher demandé sans jamais le franchir", () => {
    const monde = { south: -60, west: -170, north: 70, east: 170 };
    expect(fitBox(monde, width, height, 56, MIN_ZOOM).zoom).toBe(MIN_ZOOM);
    expect(fitBox(monde, width, height).zoom).toBe(TERRITORY_ZOOM);
  });
});

describe("fitAround", () => {
  const width = 800;
  const height = 400;
  // Siège d'ACCM (Arles), tel que la BAN le résout.
  const siege = { lat: 43.673879, lon: 4.638792 };

  it("garde le centre imposé, quels que soient les points", () => {
    const fitted = fitAround(siege, [
      { lat: 43.63, lon: 4.72 },   // Saint-Martin-de-Crau
      { lat: 43.79, lon: 4.83 },   // Saint-Rémy-de-Provence
    ], width, height);
    expect(fitted.lat).toBeCloseTo(siege.lat, 6);
    expect(fitted.lon).toBeCloseTo(siege.lon, 6);
  });

  it("cadre tous les points AUTOUR de ce centre", () => {
    const points = [
      { lat: 43.63, lon: 4.72 },
      { lat: 43.72, lon: 4.55 },
    ];
    const view = { ...fitAround(siege, points, width, height), width, height };
    for (const point of points) {
      const { left, top } = markerPosition(point, view);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(width);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(height);
    }
  });

  it("reste chez elle quand un point est trop loin pour tenir", () => {
    // Une demande à Nantes : à l'échelle d'un territoire, rien ne peut cadrer
    // les deux. La carte s'ancre sur la collectivité plutôt que sur un
    // barycentre en Corrèze — et ne s'ouvre pas seule sur la France.
    const fitted = fitAround(siege, [siege, { lat: 47.218, lon: -1.554 }], width, height);
    expect(fitted).toEqual({ ...siege, zoom: TERRITORY_ZOOM });
  });

  it("montre le territoire, pas un trottoir, quand il n'y a aucun point", () => {
    expect(fitAround(siege, [], width, height)).toEqual({ ...siege, zoom: TERRITORY_ZOOM });
  });

  it("ne serre JAMAIS plus que le zoom de lecture", () => {
    // Une unique demande au siège même : sans borne, on tomberait au zoom max.
    const fitted = fitAround(siege, [siege], width, height);
    expect(fitted.zoom).toBe(17);
  });
});

describe("géocodage en masse", () => {
  it("dérive l'endpoint CSV de celui de la recherche unitaire", () => {
    expect(batchGeocodeUrl("https://geo.test/search/")).toBe("https://geo.test/search/csv/");
    expect(batchGeocodeUrl("https://geo.test/search")).toBe("https://geo.test/search/csv/");
  });

  it("compose une ligne par adresse, code postal filtré", () => {
    const csv = batchGeocodeCsv([
      { key: "a", query: "6 Rue de la République, 69001 Lyon", postcode: "69001" },
      { key: "b", query: "Place Bellecour", postcode: "sans" },
    ]);
    expect(csv).toBe(
      'cle,adresse,cp\r\na,"6 Rue de la République, 69001 Lyon",69001\r\nb,Place Bellecour,',
    );
  });

  it("relit la réponse CSV de la BAN, y compris les adresses non trouvées", () => {
    const reponse = `cle,adresse,cp,latitude,longitude,result_score,result_type,result_label
a,6 Rue de la Republique,69001,45.766371,4.835843,0.96,housenumber,6 Rue de la République 69001 Lyon
b,Place Bellecour,,45.757597,4.831662,0.96,street,Place Bellecour 69002 Lyon
c,adresse introuvable,,,,,,
`;
    const points = parseBatchGeocodeCsv(reponse);
    expect(points.get("a")).toEqual({
      lat: 45.766371, lon: 4.835843, label: "6 Rue de la République 69001 Lyon",
      precision: "adresse", score: 0.96,
    });
    expect(points.get("b")!.precision).toBe("voie");
    expect(points.get("c")).toBeNull();
    expect(points.size).toBe(3);
  });

  it("rend une table vide sur une réponse illisible", () => {
    expect(parseBatchGeocodeCsv("").size).toBe(0);
    expect(parseBatchGeocodeCsv("une erreur html\n").size).toBe(0);
    expect(parseBatchGeocodeCsv("a,b\r\n1,2\r\n").size).toBe(0);
  });
});
