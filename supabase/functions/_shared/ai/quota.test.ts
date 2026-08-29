import { describe, expect, it } from "vitest";
import {
  formatTokens,
  nextRenewalDate,
  nextRenewalLabel,
  periodKey,
  quotaExceededMessage,
  quotaView,
  renewalLabel,
} from "./quota";

describe("periodKey", () => {
  it("rend la période au format du CHECK SQL", () => {
    expect(periodKey(new Date("2026-08-28T15:00:00Z"))).toBe("2026-08");
    expect(periodKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(periodKey(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  // Le test qui compte : la période SQL est calculée en UTC
  // (`to_char((now() at time zone 'utc'), 'YYYY-MM')`). Si ce module suivait
  // l'heure locale, le compteur et le message désigneraient deux mois
  // différents pendant deux heures chaque fin de mois.
  it("suit l'UTC, pas l'heure de Paris", () => {
    // 1ᵉʳ septembre 01 h 00 à Paris = 31 août 23 h 00 UTC : encore août.
    expect(periodKey(new Date("2026-08-31T23:00:00Z"))).toBe("2026-08");
    // 31 août 23 h 30 à Paris = 31 août 21 h 30 UTC : août aussi.
    expect(periodKey(new Date("2026-08-31T21:30:00Z"))).toBe("2026-08");
    // 1ᵉʳ septembre 00 h 00 UTC : la bascule.
    expect(periodKey(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09");
  });
});

describe("nextRenewalDate / nextRenewalLabel", () => {
  it("pointe le premier de la période suivante, en UTC", () => {
    expect(nextRenewalDate(new Date("2026-08-28T15:00:00Z")).toISOString())
      .toBe("2026-09-01T00:00:00.000Z");
  });

  it("passe l'année", () => {
    expect(nextRenewalLabel(new Date("2026-12-15T10:00:00Z"))).toBe("1ᵉʳ janvier 2027");
  });

  it("écrit « 1ᵉʳ », jamais « 1 » — le renouvellement tombe toujours un premier", () => {
    expect(nextRenewalLabel(new Date("2026-08-28T15:00:00Z"))).toBe("1ᵉʳ septembre 2026");
    expect(nextRenewalLabel(new Date("2026-07-31T23:59:59Z"))).toBe("1ᵉʳ août 2026");
    expect(nextRenewalLabel(new Date("2026-01-05T08:00:00Z"))).toBe("1ᵉʳ février 2026");
  });

  it("le libellé suit la MÊME borne UTC que la période", () => {
    // 31 août 23 h UTC : période août, donc renouvellement au 1ᵉʳ septembre.
    const veille = new Date("2026-08-31T23:00:00Z");
    expect(periodKey(veille)).toBe("2026-08");
    expect(nextRenewalLabel(veille)).toBe("1ᵉʳ septembre 2026");
  });
});

describe("quotaExceededMessage", () => {
  it("nomme la date de renouvellement — la seule information actionnable", () => {
    expect(quotaExceededMessage(new Date("2026-08-28T15:00:00Z"))).toBe(
      "Le plafond d'utilisation de l'assistant IA est atteint pour ce mois. " +
        "Le crédit sera renouvelé le 1ᵉʳ septembre 2026.",
    );
  });
});

describe("quotaView", () => {
  it("compte le réservé dans l'engagé", () => {
    const v = quotaView({ limit: 1000, used: 600, reserved: 150 });
    expect(v.engaged).toBe(750);
    expect(v.remaining).toBe(250);
    expect(v.percent).toBe(75);
    expect(v.tone).toBe("ok");
    expect(v.unlimited).toBe(false);
  });

  it("passe en beurre à 80 %, en rouge à 100 %", () => {
    expect(quotaView({ limit: 1000, used: 799, reserved: 0 }).tone).toBe("ok");
    expect(quotaView({ limit: 1000, used: 800, reserved: 0 }).tone).toBe("warn");
    expect(quotaView({ limit: 1000, used: 999, reserved: 1 }).tone).toBe("critical");
  });

  // Le ton suit le RATIO, pas le pourcentage affiché : 79,9 % s'arrondit à 80
  // pour la jauge, mais n'a pas encore atteint le seuil d'alerte.
  it("l'arrondi de la jauge ne déclenche pas l'alerte à lui seul", () => {
    const v = quotaView({ limit: 1000, used: 799, reserved: 0 });
    expect(v.percent).toBe(80);
    expect(v.tone).toBe("ok");
  });

  it("borne la jauge à 100 % sans masquer le dépassement dans le ton", () => {
    const v = quotaView({ limit: 100, used: 250, reserved: 0 });
    expect(v.percent).toBe(100);
    expect(v.remaining).toBe(0);
    expect(v.tone).toBe("critical");
  });

  it("aucun plafond ⇒ illimité, jauge à zéro", () => {
    const v = quotaView({ limit: null, used: 4200, reserved: 0 });
    expect(v.unlimited).toBe(true);
    expect(v.remaining).toBeNull();
    expect(v.percent).toBe(0);
    expect(v.tone).toBe("ok");
    expect(v.used).toBe(4200);
  });

  it("un plafond nul ou négatif est traité comme aucun plafond", () => {
    expect(quotaView({ limit: 0, used: 10, reserved: 0 }).unlimited).toBe(true);
    expect(quotaView({ limit: -5, used: 10, reserved: 0 }).unlimited).toBe(true);
  });

  it("des compteurs négatifs ne produisent jamais d'affichage négatif", () => {
    const v = quotaView({ limit: 1000, used: -50, reserved: -10 });
    expect(v.used).toBe(0);
    expect(v.reserved).toBe(0);
    expect(v.engaged).toBe(0);
    expect(v.remaining).toBe(1000);
  });
});

describe("formatTokens", () => {
  it("groupe par milliers avec l'espace fine insécable", () => {
    expect(formatTokens(1250000)).toBe("1 250 000");
    expect(formatTokens(1000)).toBe("1 000");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
  });

  it("arrondit et ne descend jamais sous zéro", () => {
    expect(formatTokens(1234.7)).toBe("1 235");
    expect(formatTokens(-42)).toBe("0");
  });
});

describe("renewalLabel — la date VIENT du Socle, Iris la met en français", () => {
  it("écrit « 1ᵉʳ », jamais « 1 »", () => {
    expect(renewalLabel("2026-09-01")).toBe("1ᵉʳ septembre 2026");
    expect(renewalLabel("2027-01-01")).toBe("1ᵉʳ janvier 2027");
  });

  it("accepte un horodatage complet et reste en UTC", () => {
    expect(renewalLabel("2026-09-01T00:00:00.000Z")).toBe("1ᵉʳ septembre 2026");
  });

  // Le renouvellement tombe toujours un premier, mais rien n'oblige le Socle à
  // le garantir pour toujours : un autre jour doit rester lisible.
  it("un autre jour du mois s'écrit sans l'exposant", () => {
    expect(renewalLabel("2026-09-15")).toBe("15 septembre 2026");
  });

  it("rend l'entrée telle quelle si ce n'est pas une date, et rien si elle est absente", () => {
    expect(renewalLabel("bientôt")).toBe("bientôt");
    expect(renewalLabel(null)).toBe("");
    expect(renewalLabel(undefined)).toBe("");
  });
});
