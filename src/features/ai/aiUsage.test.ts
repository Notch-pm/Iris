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

  // ai-api 1.3.0 (2026-09-22) : le Socle peut réserver une part du plafond
  // commun à une autre application (`nora`). `limit` est alors NOTRE plafond
  // (le commun moins la part), `used`/`reserved` ce que nous y avons engagé, et
  // `remaining_tokens = limit − used − reserved` est exactement ce que la
  // prochaine réservation laissera passer. La jauge recalcule le même nombre.
  it("un plafond d'Iris inférieur au plafond commun : le reliquat suit limit − used − reserved", () => {
    const commonLimit = 2000000;
    const noraShare = 1400000;
    const socle: AiUsageView & { remaining_tokens: number } = {
      ...usage({
        limit: commonLimit - noraShare,
        used_tokens: 150000,
        reserved_tokens: 50000,
        by_consumer: [
          { consumer: "nora", feature: "assistant-portail", calls: 900, tokens: 1200000 },
          { consumer: "iris", feature: "assistant-instruction", calls: 40, tokens: 150000 },
        ],
      }),
      remaining_tokens: 600000 - 150000 - 50000,
    };
    const s = toSummary(socle);
    expect(s.view.limit).toBe(600000);
    expect(s.view.engaged).toBe(200000);
    expect(s.view.remaining).toBe(socle.remaining_tokens);
    expect(s.view.percent).toBe(33);
    expect(s.view.tone).toBe("ok");
  });

  // `by_consumer` couvre TOUTE la collectivité, parts comprises : sa somme peut
  // dépasser notre plafond sans que rien ne soit dépassé. Le résumé ne les
  // rapproche jamais — ni jauge saturée, ni ton critique.
  it("la somme du journal peut excéder notre plafond sans saturer la jauge", () => {
    const s = toSummary(usage({
      limit: 600000,
      used_tokens: 10000,
      reserved_tokens: 0,
      by_consumer: [
        { consumer: "nora", feature: null, calls: 1000, tokens: 1300000 },
        { consumer: "iris", feature: null, calls: 3, tokens: 10000 },
      ],
    }));
    const journalTotal = s.byConsumer.reduce((sum, r) => sum + r.tokens, 0);
    expect(journalTotal).toBeGreaterThan(s.view.limit ?? 0);
    expect(s.view.engaged).toBe(10000);
    expect(s.view.remaining).toBe(590000);
    expect(s.view.tone).toBe("ok");
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
