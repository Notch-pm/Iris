import { describe, expect, it } from "vitest";
import {
  emptyAgentGuidance,
  isAgentGuidanceEmpty,
  parseAgentGuidance,
  sanitizeAgentGuidanceView,
} from "./agentGuidance";

/** Une réponse telle que `GET /v1/organizations/{id}/agent-guidance` la rend (1.27.0). */
const SOCLE_RESPONSE = {
  organization_id: "5b0c3f0e-0000-4000-8000-000000000001",
  source_organization_id: "5b0c3f0e-0000-4000-8000-000000000001",
  configured: true,
  updated_at: "2026-09-19T08:00:00+00:00",
  guidance: {
    roleDescription: "  Accueillir, **orienter**, instruire.  ",
    physicalReception: "Guichet ouvert de 8 h 30 à 12 h.",
    guidelines: [
      { title: "Confidentialité", text: "Aucun dossier lu à voix haute." },
      { title: " ", text: "" },
      { title: 3, text: "Sans titre" },
      "texte",
    ],
    faq: [{ question: "Q", answer: "R" }, { question: "", answer: "" }],
    recommendedSources: [{ url: "https://www.service-public.fr", description: "Fiches" }, {}],
    champNouveau: "ignoré",
  },
};

describe("parseAgentGuidance", () => {
  it("une structure complète et vide pour tout ce qui n'est pas un objet", () => {
    for (const raw of [null, undefined, "texte", 42, []]) {
      expect(parseAgentGuidance(raw)).toEqual(emptyAgentGuidance());
    }
  });

  it("garde les cinq rubriques du contrat, sous les noms du Socle, et rien d'autre", () => {
    const g = parseAgentGuidance(SOCLE_RESPONSE.guidance);
    expect(Object.keys(g)).toEqual([
      "roleDescription",
      "physicalReception",
      "guidelines",
      "faq",
      "recommendedSources",
    ]);
    expect(g.roleDescription).toBe("Accueillir, **orienter**, instruire.");
    expect(g.guidelines).toEqual([
      { title: "Confidentialité", text: "Aucun dossier lu à voix haute." },
      { title: "", text: "Sans titre" },
    ]);
    expect(g.faq).toEqual([{ question: "Q", answer: "R" }]);
    expect(g.recommendedSources).toEqual([{ url: "https://www.service-public.fr", description: "Fiches" }]);
  });

  it("est idempotente, y compris après un aller-retour JSON — le navigateur re-parse", () => {
    const once = parseAgentGuidance(SOCLE_RESPONSE.guidance);
    expect(parseAgentGuidance(once)).toEqual(once);
    expect(parseAgentGuidance(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe("sanitizeAgentGuidanceView", () => {
  it("relaie contenu et date, sans les identifiants d'organisation", () => {
    const view = sanitizeAgentGuidanceView(SOCLE_RESPONSE);
    expect(view.configured).toBe(true);
    expect(view.updated_at).toBe("2026-09-19T08:00:00+00:00");
    expect(JSON.stringify(view)).not.toContain("5b0c3f0e");
    expect(JSON.stringify(view)).not.toContain("champNouveau");
  });

  it("proxy puis navigateur : le second passage rend exactement le premier", () => {
    const proxied = sanitizeAgentGuidanceView(SOCLE_RESPONSE);
    expect(sanitizeAgentGuidanceView(JSON.parse(JSON.stringify(proxied)))).toEqual(proxied);
  });

  it("ne croit pas `configured` sur parole : un contenu vide n'est pas « rempli »", () => {
    const view = sanitizeAgentGuidanceView({
      configured: true,
      updated_at: "2026-09-19T08:00:00+00:00",
      guidance: { roleDescription: "   ", guidelines: [{ title: "", text: "" }] },
    });
    expect(view.configured).toBe(false);
    expect(view.updated_at).toBeNull();
    expect(isAgentGuidanceEmpty(view.guidance)).toBe(true);
  });

  it("une réponse illisible ne fait pas d'erreur : rien d'écrit", () => {
    expect(sanitizeAgentGuidanceView(null)).toEqual({
      configured: false,
      updated_at: null,
      guidance: emptyAgentGuidance(),
    });
  });
});
