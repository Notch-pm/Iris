import { describe, expect, it } from "vitest";
import {
  canalOfSource,
  formatDays,
  formatPercent,
  groupBySourceIntoCanal,
  monthLabel,
  positiveResolutionRate,
  sinceFromPeriod,
} from "./stats";

describe("sinceFromPeriod", () => {
  const now = new Date("2026-09-18T10:00:00Z");
  it("recule de 7 jours, 30 jours ou un an", () => {
    expect(sinceFromPeriod("7d", now).toISOString()).toBe("2026-09-11T10:00:00.000Z");
    expect(sinceFromPeriod("30d", now).toISOString()).toBe("2026-08-19T10:00:00.000Z");
    expect(sinceFromPeriod("1y", now).toISOString()).toBe("2025-09-18T10:00:00.000Z");
  });
  it("ne modifie pas la date reçue", () => {
    const before = now.getTime();
    sinceFromPeriod("1y", now);
    expect(now.getTime()).toBe(before);
  });
});

describe("canaux de réception", () => {
  it("classe les sources connues et range le reste chez les partenaires", () => {
    expect(canalOfSource("iris")).toBe("iris");
    expect(canalOfSource("clara")).toBe("clara");
    expect(canalOfSource("portail-citoyen")).toBe("portail");
    expect(canalOfSource("connecteur-x")).toBe("partenaire");
    expect(canalOfSource("")).toBe("partenaire");
  });

  it("rend toujours quatre canaux, dans le même ordre, zéros compris", () => {
    const rows = groupBySourceIntoCanal([
      { source_code: "iris", request_count: 45 },
      { source_code: "clara", request_count: 5 },
      { source_code: "connecteur-x", request_count: 2 },
      { source_code: "connecteur-y", request_count: 3 },
    ]);
    expect(rows.map((r) => r.canal)).toEqual(["portail", "clara", "iris", "partenaire"]);
    expect(rows.map((r) => r.count)).toEqual([0, 5, 45, 5]);
    expect(rows[0].label).toBe("Portail usagers");
  });

  it("tolère un compteur renvoyé en chaîne (bigint PostgREST)", () => {
    const rows = groupBySourceIntoCanal([
      { source_code: "iris", request_count: "7" as unknown as number },
    ]);
    expect(rows[2].count).toBe(7);
  });

  it("sans donnée : quatre zéros", () => {
    expect(groupBySourceIntoCanal([]).map((r) => r.count)).toEqual([0, 0, 0, 0]);
  });
});

describe("positiveResolutionRate", () => {
  it("rapporte les positives aux demandes closes, annulations comprises", () => {
    expect(
      positiveResolutionRate({ positive_count: 6, negative_count: 2, cancelled_count: 2, open_count: 40 }),
    ).toBeCloseTo(0.6);
  });
  it("vaut null tant que rien n'est clos", () => {
    expect(
      positiveResolutionRate({ positive_count: 0, negative_count: 0, cancelled_count: 0, open_count: 12 }),
    ).toBeNull();
  });
});

describe("libellés", () => {
  it("abrège le mois en français", () => {
    expect(monthLabel("2026-09")).toBe("sept. 26");
    expect(monthLabel("2026-01")).toBe("janv. 26");
  });
  it("laisse passer une clé inattendue telle quelle", () => {
    expect(monthLabel("n/a")).toBe("n/a");
  });
  it("formate un pourcentage arrondi ou un tiret", () => {
    expect(formatPercent(0.625)).toBe("63 %");
    expect(formatPercent(null)).toBe("—");
  });
  it("formate des jours à une décimale, virgule française", () => {
    expect(formatDays(3.25)).toBe("3,3 j");
    expect(formatDays(0)).toBe("0 j");
    expect(formatDays(null)).toBe("—");
  });
});
