import { describe, expect, it } from "vitest";
import {
  hasUserContent,
  inputDurationLabel,
  internalNav,
  parseProcedureFiche,
  resolveTab,
} from "./ficheDemarche";

/** Réponse de `socle-proxy /v1/procedures/get`, déjà whitelistée. */
const proxied = {
  id: "p-1",
  name: "Demande de carte de déchetterie",
  user_description: "Accès **gratuit** aux déchetteries.",
  input_duration_minutes: 10,
  requester_config: { citoyen: { enabled: true } },
  form_schema: { version: 1, content: [{ id: "a", key: "a", label: "A", type: "text" }] },
  knowledge_base: {
    agentHelpText: "Vérifier le domicile.",
    proceduresText: "",
    agentDocuments: [{ path: "o/p/agent/guide.pdf", name: "Guide.pdf" }],
    agentLinks: [{ url: "https://x", description: "Règlement" }],
    faq: [{ question: "q", answer: "r" }],
    guardrails: ["Ne jamais promettre de délai.", "Pas de carte sans justificatif."],
  },
  user_communication: {
    delays: { processingTimeValue: 3, processingTimeUnit: "semaine" },
    audience: { note: "Réservée aux habitants." },
    attachments: { items: [{ label: "Justificatif de domicile", description: "De moins de trois mois" }] },
    faq: { items: [{ question: "Est-ce payant ?", answer: "Non." }] },
  },
};

describe("parseProcedureFiche", () => {
  it("prépare ce que l'écran affiche", () => {
    const f = parseProcedureFiche(proxied);
    expect(f.name).toBe("Demande de carte de déchetterie");
    expect(f.description).toBe("Accès **gratuit** aux déchetteries.");
    expect(f.processingTime).toBe("3 semaines");
    expect(f.inputDurationMinutes).toBe(10);
    expect(f.admittedAudiences).toEqual(["Citoyen"]);
    // Un vrai formulaire sans pièce : « aucune » est un fait, pas une absence.
    expect(f.formPieces).toEqual([]);
    expect(f.userCommunication?.faq.items).toHaveLength(1);
    expect(f.userCommunicationRelayed).toBe(true);
    expect(f.knowledge.guardrails).toHaveLength(2);
  });

  // `null` (rien d'écrit) et ABSENT (passerelle pas encore à jour) ne disent
  // pas la même chose : l'écran ne doit pas affirmer un vide qu'il n'a pas lu.
  it("distingue « rien d'écrit » de « non relayé »", () => {
    const rien = parseProcedureFiche({ ...proxied, user_communication: null });
    expect(rien.userCommunication).toBeNull();
    expect(rien.userCommunicationRelayed).toBe(true);

    const { user_communication: _omis, ...ancien } = proxied;
    const nonRelaye = parseProcedureFiche(ancien);
    expect(nonRelaye.userCommunicationRelayed).toBe(false);
  });

  it("tolère une réponse vide ou abîmée", () => {
    const f = parseProcedureFiche(null);
    expect(f.name).toBe("");
    expect(f.processingTime).toBeNull();
    expect(f.formPieces).toBeNull();
    expect(f.knowledge.guardrails).toEqual([]);
    expect(parseProcedureFiche({ input_duration_minutes: -3 }).inputDurationMinutes).toBeNull();
  });
});

describe("inputDurationLabel", () => {
  it("minutes, heures, et rien sans durée", () => {
    expect(inputDurationLabel(10)).toBe("≈ 10 min");
    expect(inputDurationLabel(60)).toBe("≈ 1 h");
    expect(inputDurationLabel(90)).toBe("≈ 1 h 30");
    expect(inputDurationLabel(null)).toBeNull();
  });
});

describe("hasUserContent", () => {
  it("le descriptif seul suffit ; rien d'écrit, rien à montrer", () => {
    expect(hasUserContent(parseProcedureFiche(proxied))).toBe(true);
    expect(hasUserContent(parseProcedureFiche({ user_description: "Texte", user_communication: null }))).toBe(true);
    expect(hasUserContent(parseProcedureFiche({ user_communication: null }))).toBe(false);
  });
});

describe("internalNav", () => {
  it("ne propose que les rubriques qui ont quelque chose à montrer", () => {
    const nav = internalNav(parseProcedureFiche(proxied).knowledge);
    expect(nav.map((i) => i.tab)).toEqual(["consignes", "vigilance", "faq", "liens"]);
    expect(nav.find((i) => i.tab === "vigilance")?.count).toBe(2);
    // Liens ET documents d'aide se consultent au même endroit.
    expect(nav.find((i) => i.tab === "liens")?.count).toBe(2);
  });

  it("aucune rubrique pour une démarche que le service n'a pas documentée", () => {
    expect(internalNav(parseProcedureFiche({}).knowledge)).toEqual([]);
  });
});

describe("resolveTab", () => {
  const fiche = parseProcedureFiche(proxied);

  it("garde l'onglet demandé quand il existe pour cette démarche", () => {
    expect(resolveTab("vigilance", fiche)).toBe("vigilance");
    expect(resolveTab("assistant", fiche)).toBe("assistant");
  });

  it("retombe sur « Ce que voit l'usager » quand la rubrique n'existe pas ici", () => {
    expect(resolveTab("procedure", fiche)).toBe("usager");
  });

  it("n'arbitre rien tant que la fiche n'est pas lue", () => {
    expect(resolveTab("faq", null)).toBe("faq");
  });
});
