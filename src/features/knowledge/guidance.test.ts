import { describe, expect, it } from "vitest";
import { emptyAgentGuidance } from "@fn/_shared/organizations/agentGuidance";
import { guidanceDate, guidanceHighlights, safeSourceHref } from "./guidance";

describe("safeSourceHref", () => {
  it("un lien http(s) reste un lien", () => {
    expect(safeSourceHref(" https://www.service-public.fr/particuliers ")).toBe(
      "https://www.service-public.fr/particuliers",
    );
    expect(safeSourceHref("http://intranet.mairie.fr")).toBe("http://intranet.mairie.fr");
  });

  it("tout le reste redevient du texte", () => {
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "www.exemple.fr", "", "data:text/html,x"]) {
      expect(safeSourceHref(url)).toBeNull();
    }
  });
});

describe("guidanceHighlights", () => {
  it("rien d'écrit, rien à dire", () => {
    expect(guidanceHighlights(emptyAgentGuidance())).toEqual([]);
  });

  it("nomme les rubriques remplies dans l'ordre de la page, au singulier comme au pluriel", () => {
    expect(
      guidanceHighlights({
        roleDescription: "Rôle",
        physicalReception: "",
        guidelines: [{ title: "A", text: "" }, { title: "B", text: "" }],
        faq: [{ question: "Q", answer: "R" }],
        recommendedSources: [{ url: "https://a.fr", description: "" }],
      }),
    ).toEqual(["rôle des agents", "2 consignes", "1 question", "1 source"]);
  });
});

describe("guidanceDate", () => {
  it("une date lisible, en toutes lettres", () => {
    expect(guidanceDate("2026-09-19T08:00:00+00:00")).toBe("19 septembre 2026");
  });

  it("rien pour une date absente ou illisible", () => {
    expect(guidanceDate(null)).toBeNull();
    expect(guidanceDate("pas une date")).toBeNull();
  });
});
