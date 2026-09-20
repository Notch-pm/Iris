import { describe, expect, it } from "vitest";
import { emptyAgentGuidance } from "@fn/_shared/organizations/agentGuidance";
import {
  guidanceDate, guidanceEntryMatches, guidanceHighlights, guidanceNav, resolveGuidanceTab, safeSourceHref,
} from "./guidance";

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

describe("guidanceNav", () => {
  it("rien d'écrit, aucune rubrique — et aucune rubrique à ouvrir", () => {
    expect(guidanceNav(emptyAgentGuidance())).toEqual([]);
    expect(resolveGuidanceTab("faq", [])).toBeNull();
  });

  it("une entrée par rubrique remplie, dans l'ordre de lecture, les listes comptées", () => {
    const nav = guidanceNav({
      roleDescription: "Rôle",
      physicalReception: "",
      guidelines: [{ title: "A", text: "" }, { title: "B", text: "" }],
      faq: [],
      recommendedSources: [{ url: "https://a.fr", description: "" }],
    });
    expect(nav).toEqual([
      { tab: "role", label: "Rôle des agents" },
      { tab: "consignes", label: "Consignes générales", count: 2 },
      { tab: "sources", label: "Sources recommandées", count: 1 },
    ]);
    expect(resolveGuidanceTab("consignes", nav)).toBe("consignes");
    // Une rubrique vide (ou rien de demandé) retombe sur la première remplie.
    expect(resolveGuidanceTab("faq", nav)).toBe("role");
    expect(resolveGuidanceTab(null, nav)).toBe("role");
  });
});

describe("guidanceEntryMatches", () => {
  it("se cherche comme une démarche : sans accents ni casse, tous les mots", () => {
    for (const query of ["", "recomm", "GENERALES recommandations", "toutes demarches", "collectivite"]) {
      expect(guidanceEntryMatches(query)).toBe(true);
    }
  });

  it("ne s'invite pas dans une recherche qui ne la concerne pas", () => {
    expect(guidanceEntryMatches("état civil")).toBe(false);
    expect(guidanceEntryMatches("recommandations voirie")).toBe(false);
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
