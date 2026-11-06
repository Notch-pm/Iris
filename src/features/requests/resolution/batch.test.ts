import { describe, expect, it } from "vitest";
import {
  BATCH_MAX_SIZE, batchForecast, batchNotifiableCount, batchSummary, pageSelectionState,
  submittable, toggleSelected, togglePage, type BatchItem,
} from "./batch";

const item = (over: Partial<BatchItem> = {}): BatchItem => ({
  id: "r1", reference: "DEM-1", subject: "Lampadaire", status: "en_instruction", source: "iris",
  assignedTo: "u1", canProcess: true, canClose: true, ...over,
});

describe("batchForecast", () => {
  it("en instruction, affectée : rien à signaler", () => {
    expect(batchForecast(item())).toEqual({ blocked: null, notes: [] });
  });
  it("à traiter sans instructeur : passage par l'instruction et affectation dits", () => {
    expect(batchForecast(item({ status: "a_traiter", assignedTo: null })).notes).toEqual([
      "à traiter : mise en instruction puis résolue", "vous en deviendrez l'instructeur",
    ]);
  });
  it("en attente : remise en instruction", () => {
    expect(batchForecast(item({ status: "en_attente" })).notes).toEqual(["en attente : remise en instruction puis résolue"]);
  });
  it("issue de Clara : aucun avis", () => {
    expect(batchForecast(item({ source: "clara" })).notes).toEqual(["issue de Clara : aucun avis"]);
  });
  it("refus prévisibles : close, sans clôture, sans instruction quand il faut instruire", () => {
    expect(batchForecast(item({ status: "resolue_positive" })).blocked).toBe("déjà close");
    expect(batchForecast(item({ status: "archivee" })).blocked).toBe("déjà close");
    expect(batchForecast(item({ canClose: false })).blocked).toMatch(/clôture/);
    expect(batchForecast(item({ status: "a_traiter", canProcess: false })).blocked).toMatch(/instruction/);
    expect(batchForecast(item({ assignedTo: null, canProcess: false })).blocked).toMatch(/instruction/);
  });
  it("sans droit d'instruction, une demande déjà en instruction et affectée se résout", () => {
    expect(batchForecast(item({ canProcess: false })).blocked).toBeNull();
  });
});

describe("submittable / batchNotifiableCount", () => {
  it("écarte les refus prévisibles et ne compte pas d'avis pour Clara", () => {
    const items = [
      item({ id: "a" }), item({ id: "b", source: "clara" }), item({ id: "c", status: "annulee" }),
    ];
    expect(submittable(items).map((i) => i.id)).toEqual(["a", "b"]);
    expect(batchNotifiableCount(items)).toBe(1);
  });
});

describe("sélection", () => {
  it("coche et décoche", () => {
    const { next } = toggleSelected(new Map(), item());
    expect(next.has("r1")).toBe(true);
    expect(toggleSelected(next, item()).next.size).toBe(0);
  });
  it("refuse la coche au-delà du plafond", () => {
    const full = new Map(Array.from({ length: BATCH_MAX_SIZE }, (_, i) => [`x${i}`, item({ id: `x${i}` })]));
    const res = toggleSelected(full, item({ id: "y" }));
    expect(res.full).toBe(true);
    expect(res.next.has("y")).toBe(false);
  });
  it("case de page : vide, partielle, pleine", () => {
    const sel = new Map([["a", item({ id: "a" })]]);
    expect(pageSelectionState(sel, [])).toBe("none");
    expect(pageSelectionState(sel, ["b"])).toBe("none");
    expect(pageSelectionState(sel, ["a", "b"])).toBe("some");
    expect(pageSelectionState(sel, ["a"])).toBe("all");
  });
  it("toute la page : complète, puis décoche la page sans toucher au reste", () => {
    const other = new Map([["z", item({ id: "z" })]]);
    const page = [item({ id: "a" }), item({ id: "b" })];
    const filled = togglePage(other, page).next;
    expect([...filled.keys()].sort()).toEqual(["a", "b", "z"]);
    expect([...togglePage(filled, page).next.keys()]).toEqual(["z"]);
  });
  it("toute la page : s'arrête au plafond et le dit", () => {
    const almost = new Map(Array.from({ length: BATCH_MAX_SIZE - 1 }, (_, i) => [`x${i}`, item({ id: `x${i}` })]));
    const res = togglePage(almost, [item({ id: "a" }), item({ id: "b" })]);
    expect(res.full).toBe(true);
    expect(res.next.size).toBe(BATCH_MAX_SIZE);
  });
});

describe("batchSummary", () => {
  const ok = (id: string) => ({ request_id: id, reference: id, ok: true, error: null, took_over: false, chained: false });
  it("tout résolu", () => {
    expect(batchSummary([ok("a"), ok("b")]).headline).toBe("2 demandes résolues");
    expect(batchSummary([ok("a")]).headline).toBe("1 demande résolue");
    expect(batchSummary([ok("a")]).failuresTitle).toBeNull();
    expect(batchSummary([ok("a")]).failures).toEqual([]);
  });
  it("partiel : refus du serveur ET refus prévisibles comptent ensemble", () => {
    const s = batchSummary(
      [ok("a"), { request_id: "b", reference: "DEM-2", ok: false, error: "pièce manquante", took_over: false, chained: false }],
      [{ reference: "DEM-3", reason: "déjà close" }],
    );
    expect(s.headline).toBe("1 demande résolue sur 3");
    expect(s.failuresTitle).toBe("Non résolues :");
    expect(s.failures).toEqual(["DEM-2 — pièce manquante", "DEM-3 — déjà close"]);
    expect(s.okIds).toEqual(["a"]);
  });
  it("rien", () => {
    expect(batchSummary([]).headline).toBe("Aucune demande à résoudre");
  });
});
