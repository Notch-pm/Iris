import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORIES,
  countByProcedure,
  filterProcedures,
  NO_CATEGORY,
  normalizeSearch,
  procedureCategories,
  procedureTypeLabel,
  startOfMonthIso,
  volumeLabel,
  type ProcedureCacheRow,
} from "./procedureSearch";

const ROWS: ProcedureCacheRow[] = [
  { socle_id: "p1", name: "Signalement voirie", category_name: "Cadre de vie", type: "signalement" },
  { socle_id: "p2", name: "Acte de naissance", category_name: "État civil", type: "demande" },
  { socle_id: "p3", name: "Attestation d'accueil", category_name: null, type: null },
  { socle_id: "p4", name: "Recensement citoyen", category_name: "État civil", type: "demande" },
];

describe("normalizeSearch", () => {
  it("retire accents, casse et espaces", () => {
    expect(normalizeSearch("  État CIVIL ")).toBe("etat civil");
  });
});

describe("procedureCategories", () => {
  it("commence par « Toutes », trie les catégories et termine par « Sans catégorie »", () => {
    expect(procedureCategories(ROWS)).toEqual([
      { key: ALL_CATEGORIES, label: "Toutes" },
      { key: "Cadre de vie", label: "Cadre de vie" },
      { key: "État civil", label: "État civil" },
      { key: NO_CATEGORY, label: "Sans catégorie" },
    ]);
  });

  it("n'ajoute pas « Sans catégorie » si toutes les démarches sont catégorisées", () => {
    const chips = procedureCategories(ROWS.filter((r) => r.category_name));
    expect(chips.some((c) => c.key === NO_CATEGORY)).toBe(false);
  });
});

describe("filterProcedures", () => {
  it("sans filtre : toutes les démarches triées par nom", () => {
    expect(filterProcedures(ROWS, { query: "", category: ALL_CATEGORIES }).map((r) => r.socle_id))
      .toEqual(["p2", "p3", "p4", "p1"]);
  });

  it("filtre par catégorie exacte", () => {
    expect(filterProcedures(ROWS, { query: "", category: "État civil" }).map((r) => r.socle_id))
      .toEqual(["p2", "p4"]);
  });

  it("filtre les démarches sans catégorie", () => {
    expect(filterProcedures(ROWS, { query: "", category: NO_CATEGORY }).map((r) => r.socle_id))
      .toEqual(["p3"]);
  });

  it("recherche tolérante sur nom, catégorie et type", () => {
    expect(filterProcedures(ROWS, { query: "etat", category: ALL_CATEGORIES }).map((r) => r.socle_id))
      .toEqual(["p2", "p4"]);
    expect(filterProcedures(ROWS, { query: "SIGNAL", category: ALL_CATEGORIES }).map((r) => r.socle_id))
      .toEqual(["p1"]);
    expect(filterProcedures(ROWS, { query: "accueil", category: "État civil" })).toEqual([]);
  });
});

describe("procedureTypeLabel", () => {
  it("rend lisible une valeur machine", () => {
    expect(procedureTypeLabel("demande_acte")).toBe("Demande acte");
    expect(procedureTypeLabel(null)).toBeNull();
    expect(procedureTypeLabel("  ")).toBeNull();
  });
});

describe("volume par démarche", () => {
  it("compte les demandes par démarche en ignorant celles sans démarche", () => {
    expect(countByProcedure([
      { socle_procedure_id: "p1" }, { socle_procedure_id: "p1" },
      { socle_procedure_id: null }, { socle_procedure_id: "p2" },
    ])).toEqual({ p1: 2, p2: 1 });
  });

  it("borne le mois en UTC", () => {
    expect(startOfMonthIso(new Date("2026-08-21T10:00:00Z"))).toBe("2026-08-01T00:00:00.000Z");
  });

  it("libellés de volume", () => {
    expect(volumeLabel(undefined)).toBeNull();
    expect(volumeLabel(0)).toBe("Aucune demande ce mois");
    expect(volumeLabel(1)).toBe("1 demande ce mois");
    expect(volumeLabel(12)).toBe("12 demandes ce mois");
  });
});
