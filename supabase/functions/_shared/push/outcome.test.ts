import { describe, expect, it } from "vitest";
import { decideOutcome, isGone } from "./outcome.ts";

describe("decideOutcome", () => {
  it("tous servis → sent, rien à désactiver", () => {
    expect(decideOutcome([{ subscriptionId: "a", status: 201 }, { subscriptionId: "b", status: 201 }]))
      .toEqual({ settle: "sent", disable: [], error: null });
  });

  it("un servi, un disparu → sent ET l'appareil disparu désactivé", () => {
    expect(decideOutcome([{ subscriptionId: "a", status: 201 }, { subscriptionId: "b", status: 410 }]))
      .toEqual({ settle: "sent", disable: ["b"], error: null });
  });

  it("tous disparus → retry (le prochain claim renoncera : plus d'appareil), tous désactivés", () => {
    const o = decideOutcome([{ subscriptionId: "a", status: 404 }, { subscriptionId: "b", status: 410 }]);
    expect(o.settle).toBe("retry");
    expect(o.disable).toEqual(["a", "b"]);
    expect(o.error).toBe("tous les appareils ont disparu");
  });

  it("429 / 5xx → retry avec le code, sans désactiver", () => {
    const o = decideOutcome([{ subscriptionId: "a", status: 429 }, { subscriptionId: "b", status: 503 }]);
    expect(o).toEqual({ settle: "retry", disable: [], error: "HTTP 429 · HTTP 503" });
  });

  it("401 / 403 → retry avec une erreur qui accuse les clés VAPID", () => {
    expect(decideOutcome([{ subscriptionId: "a", status: 403 }]).error).toBe("HTTP 403 (clés VAPID refusées)");
  });

  it("erreur réseau sans code → retry avec le message, ou « erreur réseau »", () => {
    expect(decideOutcome([{ subscriptionId: "a", status: null, error: "ECONNRESET" }]).error).toBe("ECONNRESET");
    expect(decideOutcome([{ subscriptionId: "a", status: null }]).error).toBe("erreur réseau");
  });

  it("liste vide → retry « aucun appareil »", () => {
    expect(decideOutcome([])).toEqual({ settle: "retry", disable: [], error: "aucun appareil" });
  });

  it("l'erreur ne porte jamais l'endpoint et reste bornée", () => {
    const o = decideOutcome(Array.from({ length: 200 }, (_, i) => ({ subscriptionId: `s${i}`, status: 500 + (i % 3) })));
    expect(o.error).toBe("HTTP 500 · HTTP 501 · HTTP 502");
    expect((o.error ?? "").length).toBeLessThanOrEqual(500);
  });
});

describe("isGone", () => {
  it("404 et 410 seulement", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    expect(isGone(400)).toBe(false);
    expect(isGone(null)).toBe(false);
  });
});
