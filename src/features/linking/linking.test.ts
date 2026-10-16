import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIUS_M, DEFAULT_WINDOW_DAYS, enabledCount, linkSettingViews, parseRadius, parseWindow,
  type ProcedureRow,
} from "./linking";

const proc = (socle_id: string, name: string, category_name: string | null, obsolete = false): ProcedureRow => ({
  socle_id, name, category_name, obsoleted_at: obsolete ? "2026-10-01T00:00:00Z" : null,
});

describe("linkSettingViews", () => {
  it("une démarche jamais réglée n'est pas mutualisable (fail closed) et porte les défauts", () => {
    const [v] = linkSettingViews([proc("p1", "Voirie", "Cadre de vie")], []);
    expect(v.enabled).toBe(false);
    expect(v.radiusM).toBe(DEFAULT_RADIUS_M);
    expect(v.windowDays).toBe(DEFAULT_WINDOW_DAYS);
  });

  it("reprend le réglage enregistré", () => {
    const [v] = linkSettingViews(
      [proc("p1", "Voirie", null)],
      [{ socle_procedure_id: "p1", enabled: true, radius_m: 300, window_days: 15 }],
    );
    expect(v).toMatchObject({ enabled: true, radiusM: 300, windowDays: 15 });
  });

  it("masque une démarche obsolète, sauf si elle était mutualisable (pour pouvoir l'éteindre)", () => {
    const views = linkSettingViews(
      [proc("p1", "Ancienne", null, true), proc("p2", "Ancienne active", null, true)],
      [{ socle_procedure_id: "p2", enabled: true, radius_m: 150, window_days: 60 }],
    );
    expect(views.map((v) => v.procedureId)).toEqual(["p2"]);
    expect(views[0].obsolete).toBe(true);
  });

  it("trie par catégorie puis par nom, les démarches sans catégorie en dernier", () => {
    const views = linkSettingViews(
      [proc("a", "Zèbre", null), proc("b", "Éclairage", "Cadre de vie"), proc("c", "Aide", "Social"),
        proc("d", "Arbre", "Cadre de vie")],
      [],
    );
    expect(views.map((v) => v.procedureId)).toEqual(["d", "b", "c", "a"]);
  });

  it("compte les démarches mutualisables", () => {
    const views = linkSettingViews(
      [proc("p1", "A", null), proc("p2", "B", null)],
      [{ socle_procedure_id: "p2", enabled: true, radius_m: 150, window_days: 60 }],
    );
    expect(enabledCount(views)).toBe(1);
  });
});

describe("parseRadius / parseWindow — reflet des bornes de la RPC", () => {
  it("accepte les bornes incluses", () => {
    expect(parseRadius("10").value).toBe(10);
    expect(parseRadius("5000").value).toBe(5000);
    expect(parseWindow(" 1 ").value).toBe(1);
    expect(parseWindow("365").value).toBe(365);
  });

  it("refuse hors bornes, décimales et texte, avec un message", () => {
    for (const raw of ["9", "5001", "12.5", "", "abc", "-3"]) {
      const r = parseRadius(raw);
      expect(r.value).toBeNull();
      expect(r.error).toBeTruthy();
    }
    expect(parseWindow("0").error).toMatch(/1 et 365 jours/);
  });
});
