import { describe, expect, it } from "vitest";
import {
  geometryRings,
  quartierAt,
  quartierLabelPoint,
  quartiersBounds,
  ringCentroid,
} from "./quartiers";

const CARRE = [[[4.0, 43.0], [4.1, 43.0], [4.1, 43.1], [4.0, 43.1], [4.0, 43.0]]];

describe("geometryRings", () => {
  it("lit un Polygon, en convertissant [lon, lat] → {lat, lon}", () => {
    const rings = geometryRings({ type: "Polygon", coordinates: CARRE });
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual({ lat: 43.0, lon: 4.0 });
    expect(rings[0]).toHaveLength(5);
  });

  it("lit un MultiPolygon — un anneau extérieur par polygone", () => {
    const rings = geometryRings({ type: "MultiPolygon", coordinates: [CARRE, CARRE] });
    expect(rings).toHaveLength(2);
  });

  it("ignore les anneaux intérieurs : un trou ne se voit pas sur 200 px", () => {
    const troué = [...CARRE, [[4.02, 43.02], [4.03, 43.02], [4.03, 43.03], [4.02, 43.02]]];
    expect(geometryRings({ type: "Polygon", coordinates: troué })).toHaveLength(1);
  });

  it("accepte la géométrie sous forme de chaîne (PostGIS ST_AsGeoJSON)", () => {
    const rings = geometryRings(JSON.stringify({ type: "Polygon", coordinates: CARRE }));
    expect(rings).toHaveLength(1);
  });

  it("descend dans une Feature", () => {
    const rings = geometryRings({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: CARRE },
    });
    expect(rings).toHaveLength(1);
  });

  it("rend une liste vide sur toute forme inattendue — jamais d'exception", () => {
    for (const raw of [
      null, undefined, 42, "pas du json", "{}", {}, { type: "Point", coordinates: [4, 43] },
      { type: "Polygon" }, { type: "Polygon", coordinates: "non" },
      { type: "Polygon", coordinates: [[[4, 43], [4.1, 43]]] }, // 2 points : pas une surface
    ]) {
      expect(geometryRings(raw)).toEqual([]);
    }
  });

  it("écarte les sommets hors du monde plutôt que la géométrie entière", () => {
    const rings = geometryRings({
      type: "Polygon",
      coordinates: [[[4.0, 43.0], [999, 43.0], [4.1, 43.1], [4.0, 43.1], [4.0, 43.0]]],
    });
    expect(rings[0]).toHaveLength(4);
  });
});

describe("quartierAt", () => {
  const carre = (id: string, west: number) => ({
    id, name: id, color: null,
    rings: [[
      { lat: 43.0, lon: west }, { lat: 43.0, lon: west + 0.1 },
      { lat: 43.1, lon: west + 0.1 }, { lat: 43.1, lon: west }, { lat: 43.0, lon: west },
    ]],
  });
  const quartiers = [carre("ouest", 4.0), carre("est", 4.2)];

  it("désigne le quartier qui contient le point", () => {
    expect(quartierAt({ lat: 43.05, lon: 4.05 }, quartiers)?.id).toBe("ouest");
    expect(quartierAt({ lat: 43.05, lon: 4.25 }, quartiers)?.id).toBe("est");
  });

  it("rend null hors de tout quartier — l'entre-deux est une réponse", () => {
    expect(quartierAt({ lat: 43.05, lon: 4.15 }, quartiers)).toBeNull();
    expect(quartierAt({ lat: 48.85, lon: 2.35 }, quartiers)).toBeNull();
  });

  it("rend null quand la couche est absente", () => {
    expect(quartierAt({ lat: 43.05, lon: 4.05 }, [])).toBeNull();
  });
});

describe("ringCentroid / quartierLabelPoint — où poser le nom", () => {
  const carre = [
    { lat: 43.0, lon: 4.0 }, { lat: 43.0, lon: 4.1 },
    { lat: 43.1, lon: 4.1 }, { lat: 43.1, lon: 4.0 }, { lat: 43.0, lon: 4.0 },
  ];

  it("centre un carré en son milieu", () => {
    const c = ringCentroid(carre);
    expect(c.lat).toBeCloseTo(43.05, 6);
    expect(c.lon).toBeCloseTo(4.05, 6);
  });

  it("ne se laisse pas tirer par les sommets serrés d'un côté", () => {
    // Même carré, mais un bord subdivisé : la moyenne des sommets glisse vers
    // lui, le centre de gravité ne bouge pas.
    const subdivise = [
      { lat: 43.0, lon: 4.0 }, { lat: 43.0, lon: 4.025 }, { lat: 43.0, lon: 4.05 },
      { lat: 43.0, lon: 4.075 }, { lat: 43.0, lon: 4.1 },
      { lat: 43.1, lon: 4.1 }, { lat: 43.1, lon: 4.0 }, { lat: 43.0, lon: 4.0 },
    ];
    const moyenne = subdivise.reduce((a, p) => a + p.lat, 0) / subdivise.length;
    expect(moyenne).toBeLessThan(43.04); // la moyenne descend vers le bord subdivisé
    expect(ringCentroid(subdivise).lat).toBeCloseTo(43.05, 6);
  });

  it("assume qu'une forme concave puisse voir son centre tomber dans le creux", () => {
    // Un L : le centre de gravité est dans l'angle rentrant. Documenté et
    // accepté — on place une étiquette, pas un marqueur.
    const enL = [
      { lat: 0, lon: 0 }, { lat: 0, lon: 6 }, { lat: 2, lon: 6 },
      { lat: 2, lon: 2 }, { lat: 6, lon: 2 }, { lat: 6, lon: 0 }, { lat: 0, lon: 0 },
    ];
    const c = ringCentroid(enL);
    expect(c.lat).toBeCloseTo(2.2, 6);
    expect(c.lon).toBeCloseTo(2.2, 6);
  });

  it("ne nomme un quartier en plusieurs morceaux qu'une fois, sur le plus grand", () => {
    // Le petit morceau fait 0,02° de côté, le carré 0,1° : c'est ce dernier qui
    // porte le nom.
    const petit = [
      { lat: 40.0, lon: 1.0 }, { lat: 40.0, lon: 1.02 },
      { lat: 40.02, lon: 1.02 }, { lat: 40.0, lon: 1.0 },
    ];
    const point = quartierLabelPoint({ id: "q", name: "q", color: null, rings: [petit, carre] })!;
    expect(point.lat).toBeCloseTo(43.05, 6);
  });

  it("rend null quand il n'y a rien à nommer", () => {
    expect(quartierLabelPoint({ id: "q", name: "q", color: null, rings: [] })).toBeNull();
  });
});

describe("quartiersBounds", () => {
  const quartier = (id: string, rings: { lat: number; lon: number }[][]) => ({
    id, name: id, color: null, rings,
  });

  it("englobe TOUS les quartiers, y compris ceux en plusieurs morceaux", () => {
    const ouest = [
      { lat: 43.30, lon: 4.30 }, { lat: 43.40, lon: 4.30 }, { lat: 43.40, lon: 4.40 },
    ];
    const morceau = [
      { lat: 43.80, lon: 4.90 }, { lat: 43.70, lon: 4.90 }, { lat: 43.70, lon: 4.80 },
    ];
    const est = [
      { lat: 43.50, lon: 4.60 }, { lat: 43.60, lon: 4.60 }, { lat: 43.60, lon: 4.70 },
    ];
    expect(
      quartiersBounds([quartier("ouest", [ouest, morceau]), quartier("est", [est])]),
    ).toEqual({ south: 43.3, west: 4.3, north: 43.8, east: 4.9 });
  });

  it("rend null quand le référentiel ne publie aucun découpage", () => {
    // Route absente, Socle muet, ou territoire sans quartiers : le cadrage
    // retombe sur le siège puis sur les épingles, il ne casse pas.
    expect(quartiersBounds([])).toBeNull();
    expect(quartiersBounds([quartier("vide", [])])).toBeNull();
  });
});
