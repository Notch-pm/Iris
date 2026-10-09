import { describe, expect, it } from "vitest";
import { depositDay, RECEIPT_SUBJECT, receiptEmail } from "./accuse.ts";

describe("depositDay", () => {
  it("rend le jour de PARIS, pas celui d'UTC", () => {
    // 23 h 30 UTC le 8 octobre = 1 h 30 le 9 à Paris.
    expect(depositDay("2026-10-08T23:30:00Z")).toBe("9 octobre 2026");
  });
  it("rend null pour une date absente ou illisible", () => {
    expect(depositDay(null)).toBeNull();
    expect(depositDay("pas une date")).toBeNull();
  });
});

describe("receiptEmail", () => {
  const base = {
    reference: "DEM-2026-000042",
    requestSubject: "Acte de naissance",
    receivedAt: "2026-10-09T08:00:00Z",
    organisme: "Mairie de Saint-Aubin",
    recipient: { civility: "madame", fullName: "Marie Durand" },
    tenantName: "Ville de Saint-Aubin",
  };

  it("porte l'objet FIGÉ", () => {
    expect(receiptEmail(base).subject).toBe(RECEIPT_SUBJECT);
  });

  it("compose le message complet", () => {
    expect(receiptEmail(base).body).toBe([
      "Madame Marie Durand,",
      "",
      "Nous avons bien reçu votre demande « Acte de naissance » (référence DEM-2026-000042), déposée le 9 octobre 2026.",
      "",
      "Elle sera traitée par : Mairie de Saint-Aubin.",
      "",
      "Conservez cette référence : elle vous sera demandée pour toute question au sujet de votre demande.",
      "",
      "Cordialement,",
      "Ville de Saint-Aubin",
    ].join("\n"));
  });

  it("omet ce qui manque sans laisser de trou", () => {
    const body = receiptEmail({
      ...base,
      requestSubject: null,
      receivedAt: null,
      organisme: "  ",
      recipient: {},
      tenantName: null,
    }).body;
    expect(body).toBe([
      "Madame, Monsieur,",
      "",
      "Nous avons bien reçu votre demande (référence DEM-2026-000042).",
      "",
      "Conservez cette référence : elle vous sera demandée pour toute question au sujet de votre demande.",
      "",
      "Cordialement,",
    ].join("\n"));
  });
});
