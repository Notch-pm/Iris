import { describe, expect, it } from "vitest";
import { buildCsv, escapeCsvValue } from "./csv";

describe("csv", () => {
  it("échappe séparateur, guillemets et retours à la ligne (RFC 4180)", () => {
    expect(escapeCsvValue("simple")).toBe("simple");
    expect(escapeCsvValue("a;b")).toBe('"a;b"');
    expect(escapeCsvValue('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(escapeCsvValue("ligne 1\nligne 2")).toBe('"ligne 1\nligne 2"');
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
    expect(escapeCsvValue(42)).toBe("42");
  });

  it("construit en-têtes + lignes en CRLF avec le séparateur Excel FR", () => {
    const rows = [{ ref: "DEM-2026-000001", objet: "Nid de poule ; rue des Lilas" }];
    const csv = buildCsv(rows, [
      { header: "Référence", accessor: (r) => r.ref },
      { header: "Objet", accessor: (r) => r.objet },
    ]);
    expect(csv).toBe('Référence;Objet\r\nDEM-2026-000001;"Nid de poule ; rue des Lilas"');
  });

  it("produit seulement la ligne d'en-tête sans donnée", () => {
    expect(buildCsv([], [{ header: "A", accessor: () => "" }])).toBe("A");
  });
});
