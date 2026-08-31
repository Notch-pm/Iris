import { describe, expect, it } from "vitest";
import { toSummary } from "./aiUsage";
import type { AiUsageView } from "@fn/socle-proxy/_shared/sanitize";

const usage = (over: Partial<AiUsageView> = {}): AiUsageView => ({
  period: "2026-08",
  renews_at: "2026-09-01",
  limit: 2000000,
  used_tokens: 1603,
  reserved_tokens: 0,
  by_consumer: [],
  ...over,
});

describe("toSummary", () => {
  it("dessine la jauge à partir des trois faits du Socle", () => {
    const s = toSummary(usage({ limit: 1000, used_tokens: 400, reserved_tokens: 100 }));
    expect(s.view.engaged).toBe(500);
    expect(s.view.remaining).toBe(500);
    expect(s.view.percent).toBe(50);
    expect(s.view.unlimited).toBe(false);
  });

  // La date n'est plus calculée par Iris : elle vient du Socle, qui possède la
  // période. Le hook ne fait que la transporter jusqu'à l'écran.
  it("transporte la période et la date du Socle sans les recalculer", () => {
    const s = toSummary(usage({ period: "2026-07", renews_at: "2026-08-01" }));
    expect(s.period).toBe("2026-07");
    expect(s.renewsAt).toBe("2026-08-01");
  });

  it("aucun plafond ⇒ illimité, la consommation reste affichable", () => {
    const s = toSummary(usage({ limit: null, used_tokens: 4200 }));
    expect(s.view.unlimited).toBe(true);
    expect(s.view.used).toBe(4200);
    expect(s.view.remaining).toBeNull();
  });

  // « Qui dépense ? » est la question de l'administrateur : les plus gros
  // postes d'abord, sinon il lit l'ordre du serveur.
  it("classe les applications par jetons décroissants", () => {
    const s = toSummary(usage({
      by_consumer: [
        { consumer: "iris", feature: "assistant-instruction", calls: 1, tokens: 1603 },
        { consumer: "clara", feature: null, calls: 9, tokens: 40000 },
      ],
    }));
    expect(s.byConsumer.map((r) => r.consumer)).toEqual(["clara", "iris"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const view = usage({
      by_consumer: [
        { consumer: "iris", feature: null, calls: 1, tokens: 1 },
        { consumer: "clara", feature: null, calls: 1, tokens: 2 },
      ],
    });
    toSummary(view);
    expect(view.by_consumer.map((r) => r.consumer)).toEqual(["iris", "clara"]);
  });
});
