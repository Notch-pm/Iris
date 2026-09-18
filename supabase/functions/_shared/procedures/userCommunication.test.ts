import { describe, expect, it } from "vitest";
import {
  isUserCommunicationEmpty,
  parseUserCommunication,
  processingTimeLabel,
  processingTimeUnitLabel,
} from "./userCommunication";

/** L'exemple du schéma `UserCommunication` du contrat 1.24.0, à la lettre. */
const contractExample = {
  delays: { processingTimeValue: 3, processingTimeUnit: "semaine" },
  audience: { note: "Réservée aux personnes résidant sur la commune." },
  attachments: {
    items: [{ label: "Justificatif de domicile", description: "De moins de trois mois" }],
  },
  faq: { items: [{ question: "Où retirer l'acte ?", answer: "À l'accueil de la mairie." }] },
};

describe("parseUserCommunication", () => {
  it("relaie l'exemple du contrat à l'identique", () => {
    expect(parseUserCommunication(contractExample)).toEqual(contractExample);
  });

  // Piège n° 6 : `null` veut dire « rien écrit » — pas un objet vide composé.
  it("`null`, absent ou illisible : null", () => {
    expect(parseUserCommunication(null)).toBeNull();
    expect(parseUserCommunication(undefined)).toBeNull();
    expect(parseUserCommunication("texte")).toBeNull();
    expect(parseUserCommunication([1])).toBeNull();
  });

  it("ne relaie que le contrat : un champ inconnu du Socle est ignoré", () => {
    const uc = parseUserCommunication({ ...contractExample, futur: "SECRET", faq: { items: [], x: 1 } });
    expect(JSON.stringify(uc)).not.toContain("SECRET");
    expect(uc).not.toHaveProperty("futur");
    expect(uc!.faq).toEqual({ items: [] });
  });

  // La garde du 2026-08-28 : proxy PUIS navigateur — la whitelist est traversée
  // deux fois, elle doit être un sous-ensemble strict de son entrée.
  it("est idempotente, aller-retour JSON compris", () => {
    const messy = {
      delays: { processingTimeValue: 0, processingTimeUnit: "heure" },
      audience: { note: "  Résidents  " },
      attachments: { items: [{ label: " RIB ", description: 3 }, { label: "", description: "orpheline" }] },
      faq: { items: [{ question: "Q ?", answer: "" }, { question: "Q2 ?", answer: "R2" }] },
    };
    const once = parseUserCommunication(messy);
    expect(parseUserCommunication(once)).toEqual(once);
    expect(parseUserCommunication(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(once).toEqual({
      delays: { processingTimeValue: null, processingTimeUnit: null },
      audience: { note: "Résidents" },
      attachments: { items: [{ label: "RIB", description: "" }] },
      faq: { items: [{ question: "Q2 ?", answer: "R2" }] },
    });
  });

  it("tolère des blocs abîmés sans emporter les voisins", () => {
    const uc = parseUserCommunication({ delays: "3 semaines", audience: [], attachments: { items: "x" }, faq: 7 })!;
    expect(uc.delays).toEqual({ processingTimeValue: null, processingTimeUnit: null });
    expect(uc.audience.note).toBe("");
    expect(uc.attachments.items).toEqual([]);
    expect(uc.faq.items).toEqual([]);
  });
});

// Piège n° 2 : l'unité est toujours dans la donnée, JAMAIS déduite du nombre.
describe("processingTimeLabel", () => {
  const label = (value: unknown, unit?: unknown) =>
    processingTimeLabel(parseUserCommunication({ delays: { processingTimeValue: value, processingTimeUnit: unit } })!.delays);

  it("libelle valeur et unité", () => {
    expect(label(15, "jour_ouvre")).toBe("15 jours ouvrés");
    expect(label(3, "semaine")).toBe("3 semaines");
    expect(label(2, "mois")).toBe("2 mois");
  });

  it("`0` n'est pas un délai — ce serait promettre une réponse immédiate", () => {
    expect(label(0, "jour")).toBeNull();
  });

  it("refuse hors bornes, non entier, et chaîne même numérique", () => {
    expect(label(1000, "jour")).toBeNull();
    expect(label(2.5, "semaine")).toBeNull();
    expect(label("3", "semaine")).toBeNull();
    expect(label(null, "semaine")).toBeNull();
  });

  it("unité absente ou inconnue : le délai se tait plutôt que d'en supposer une", () => {
    expect(label(30)).toBeNull();
    expect(label(30, "heure")).toBeNull();
  });

  it("rien à libeller sans bloc", () => {
    expect(processingTimeLabel(null)).toBeNull();
  });
});

describe("processingTimeUnitLabel", () => {
  it("accorde sur la valeur, et dit « calendaire » pour ne pas confondre avec « ouvré »", () => {
    expect(processingTimeUnitLabel("jour_ouvre", 1)).toBe("jour ouvré");
    expect(processingTimeUnitLabel("jour", 1)).toBe("jour calendaire");
    expect(processingTimeUnitLabel("jour", 10)).toBe("jours calendaires");
    expect(processingTimeUnitLabel("semaine", 1)).toBe("semaine");
    expect(processingTimeUnitLabel("mois", 3)).toBe("mois");
  });
});

describe("isUserCommunicationEmpty", () => {
  it("vrai sans bloc, ou avec un bloc sans rien de publiable", () => {
    expect(isUserCommunicationEmpty(null)).toBe(true);
    expect(isUserCommunicationEmpty(parseUserCommunication({ delays: { processingTimeValue: 3 } }))).toBe(true);
  });

  it("faux dès qu'un seul bloc porte quelque chose", () => {
    expect(isUserCommunicationEmpty(parseUserCommunication(contractExample))).toBe(false);
    expect(isUserCommunicationEmpty(parseUserCommunication({ audience: { note: "x" } }))).toBe(false);
  });
});
