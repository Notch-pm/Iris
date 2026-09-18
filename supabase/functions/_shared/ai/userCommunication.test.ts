import { describe, expect, it } from "vitest";
import {
  emptyUserCommunication,
  isUserCommunicationEmpty,
  parseUserCommunicationKnowledge,
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

const procedure = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Carte de stationnement",
  user_description: "Pour **stationner** près de chez vous.",
  user_communication: contractExample,
  requester_config: { citoyen: { enabled: true }, entreprise: { enabled: false } },
  form_schema: {
    version: 1,
    content: [
      { id: "motif", key: "motif", label: "Motif", type: "text" },
      {
        id: "domicile", key: "domicile", type: "attachment", label: "Justificatif de domicile",
        required: true, maxFiles: 1, acceptedFormats: ["pdf"],
      },
    ],
  },
  ...over,
});

// La whitelist et les contrepoids ont leurs propres tests
// (`_shared/procedures/*.test.ts`) : ici, on vérifie l'ASSEMBLAGE.
describe("parseUserCommunicationKnowledge", () => {
  it("assemble l'exemple du contrat, le descriptif à côté de l'objet, et les contrepoids", () => {
    expect(parseUserCommunicationKnowledge(procedure())).toEqual({
      description: "Pour **stationner** près de chez vous.",
      processingTime: "3 semaines",
      audienceNote: "Réservée aux personnes résidant sur la commune.",
      announcedPieces: [{ label: "Justificatif de domicile", description: "De moins de trois mois" }],
      faq: [{ question: "Où retirer l'acte ?", answer: "À l'accueil de la mairie." }],
      admittedAudiences: ["Citoyen"],
      formPieces: [{ label: "Justificatif de domicile", requirement: "obligatoire", required: true }],
    });
  });

  // Piège n° 6 : `null` veut dire « rien écrit » — et les défauts sont VIDES.
  it("`user_communication: null` : rien d'annoncé, rien de composé", () => {
    const uc = parseUserCommunicationKnowledge(procedure({ user_communication: null, user_description: null }));
    expect(uc.processingTime).toBeNull();
    expect(uc.audienceNote).toBe("");
    expect(uc.announcedPieces).toEqual([]);
    expect(uc.faq).toEqual([]);
    expect(uc.description).toBe("");
    expect(isUserCommunicationEmpty(uc)).toBe(true);
  });

  it("tolère l'absence, l'inconnu et les types faux", () => {
    expect(parseUserCommunicationKnowledge(null)).toEqual(emptyUserCommunication());
    expect(parseUserCommunicationKnowledge("x")).toEqual(emptyUserCommunication());
    expect(parseUserCommunicationKnowledge([1])).toEqual(emptyUserCommunication());
    expect(parseUserCommunicationKnowledge({
      user_description: 42,
      user_communication: { delays: "3 semaines", audience: [], attachments: { items: "x" }, faq: 7 },
    })).toEqual(emptyUserCommunication());
  });

  it("unité inconnue : aucun délai, jamais une unité supposée", () => {
    const uc = parseUserCommunicationKnowledge(procedure({
      user_communication: { delays: { processingTimeValue: 30, processingTimeUnit: "heure" } },
    }));
    expect(uc.processingTime).toBeNull();
  });
});

describe("isUserCommunicationEmpty", () => {
  it("les contrepoids seuls ne font pas une communication", () => {
    const uc = parseUserCommunicationKnowledge(procedure({ user_communication: null, user_description: "" }));
    expect(uc.formPieces).not.toBeNull();
    expect(uc.admittedAudiences).not.toEqual([]);
    expect(isUserCommunicationEmpty(uc)).toBe(true);
  });

  it("un seul bloc écrit suffit", () => {
    expect(isUserCommunicationEmpty(parseUserCommunicationKnowledge({ user_description: "Texte" }))).toBe(false);
    expect(isUserCommunicationEmpty(parseUserCommunicationKnowledge({
      user_communication: { delays: { processingTimeValue: 2, processingTimeUnit: "mois" } },
    }))).toBe(false);
  });
});
