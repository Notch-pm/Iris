import { describe, expect, it } from "vitest";
import { parseQuartiers } from "./quartiers";

const CARRE = [[[4.0, 43.0], [4.1, 43.0], [4.1, 43.1], [4.0, 43.1], [4.0, 43.0]]];

describe("parseQuartiers", () => {
  const quartier = (over: Record<string, unknown> = {}) => ({
    id: "q1", name: "Trinquetaille", color: "#00D084",
    geometry: { type: "Polygon", coordinates: CARRE }, ...over,
  });

  it("lit la réponse du proxy", () => {
    const [q] = parseQuartiers({ quartiers: [quartier()] });
    expect(q).toMatchObject({ id: "q1", name: "Trinquetaille", color: "#00D084" });
    expect(q!.rings).toHaveLength(1);
  });

  it("écarte un quartier sans géométrie dessinable, sans échouer sur les autres", () => {
    const parsed = parseQuartiers({
      quartiers: [quartier({ id: "sansGeom", geometry: null }), quartier({ id: "ok" })],
    });
    expect(parsed.map((q) => q.id)).toEqual(["ok"]);
  });

  it("garde la couleur libre du référentiel — hexadécimal ET hsl()", () => {
    // Le tenant ACCM écrit ses quartiers en hsl() : n'accepter que du
    // hexadécimal effacerait toutes les couleurs (constaté le 2026-08-28).
    expect(parseQuartiers({ quartiers: [quartier({ color: "hsl(152 83% 42%)" })] })[0]!.color)
      .toBe("hsl(152 83% 42%)");
    expect(parseQuartiers({ quartiers: [quartier({ color: "#abc" })] })[0]!.color).toBe("#abc");
  });

  it("écarte ce qui n'a rien à faire dans une couleur", () => {
    for (const bad of [null, 42, "", "   ", "red; content: url(x)", "a".repeat(65), "<script>"]) {
      expect(parseQuartiers({ quartiers: [quartier({ color: bad })] })[0]!.color).toBeNull();
    }
  });

  it("rend une liste vide quand le référentiel n'expose pas la route", () => {
    for (const raw of [null, {}, { quartiers: null }, { quartiers: [] }, { error: { code: "not_found" } }]) {
      expect(parseQuartiers(raw)).toEqual([]);
    }
  });
});
