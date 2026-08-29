import { describe, expect, it } from "vitest";
import { buildSummaries, GLOBAL_PROVIDER } from "./useAiUsage";

const quota = (org: string, limit: number, active = true) => ({
  organization_id: org,
  provider: GLOBAL_PROVIDER,
  monthly_limit_tokens: limit,
  is_active: active,
  updated_at: "2026-08-28T10:00:00Z",
  updated_by: "u-1",
});

const counter = (org: string, used: number, reserved = 0) => ({
  organization_id: org,
  provider: GLOBAL_PROVIDER,
  used_tokens: used,
  reserved_tokens: reserved,
});

describe("buildSummaries", () => {
  it("rapproche plafond et compteur du tenant", () => {
    const [s] = buildSummaries(["a"], [quota("a", 1000)], [counter("a", 400, 100)], "2026-08");
    expect(s.limit).toBe(1000);
    expect(s.view.engaged).toBe(500);
    expect(s.view.remaining).toBe(500);
    expect(s.period).toBe("2026-08");
  });

  // Le serveur traite un plafond désactivé comme absent (`is_active` filtré
  // dans `reserve_ai_usage`). L'écran doit dire la même chose, sinon il
  // annonce un plafond qui ne refuse rien.
  it("un plafond désactivé vaut aucun plafond", () => {
    const [s] = buildSummaries(["a"], [quota("a", 1000, false)], [counter("a", 4000)], "2026-08");
    expect(s.limit).toBeNull();
    expect(s.isActive).toBe(false);
    expect(s.view.unlimited).toBe(true);
    // ...mais la consommation reste affichée : elle a bien eu lieu.
    expect(s.view.used).toBe(4000);
  });

  it("un tenant sans aucune ligne est illimité à zéro", () => {
    const [s] = buildSummaries(["a"], [], [], "2026-08");
    expect(s.limit).toBeNull();
    expect(s.view.used).toBe(0);
    expect(s.updatedAt).toBeNull();
  });

  it("ne mélange jamais deux tenants", () => {
    const rows = buildSummaries(
      ["a", "b"],
      [quota("a", 1000), quota("b", 50)],
      [counter("a", 900), counter("b", 10)],
      "2026-08",
    );
    expect(rows.map((r) => r.view.engaged)).toEqual([900, 10]);
    expect(rows.map((r) => r.limit)).toEqual([1000, 50]);
  });

  it("ignore les lignes d'un fournisseur dédié — l'écran ne montre que le global", () => {
    const dedie = { ...quota("a", 99), provider: "mistral" };
    const [s] = buildSummaries(["a"], [dedie, quota("a", 1000)], [counter("a", 100)], "2026-08");
    expect(s.limit).toBe(1000);
  });

  it("rend une ligne par tenant demandé, dans l'ordre demandé", () => {
    const rows = buildSummaries(["b", "a"], [quota("a", 10)], [], "2026-08");
    expect(rows.map((r) => r.organizationId)).toEqual(["b", "a"]);
    expect(rows[0].limit).toBeNull();
    expect(rows[1].limit).toBe(10);
  });
});
