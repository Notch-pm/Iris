import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  catalogueUrls,
  documentLabel,
  MAX_CONSULTED,
  pageLabel,
  parseSourceIds,
  resolveSources,
  sourceId,
  toRef,
} from "./catalogue";
import { emptyAiKnowledge, parseAiKnowledge } from "../knowledge";
import { emptyAgentGuidance, type AgentGuidance } from "../../organizations/agentGuidance";

const kb = parseAiKnowledge({
  aiSources: [
    { url: "https://www.arles.fr/stationnement", description: "Règlement du stationnement" },
    { url: "http://ancien.arles.fr/page", description: "Page en clair" },
    { url: "", description: "Source sans adresse" },
  ],
  trainingDocuments: [
    { path: "org/proc/training/1f0c-guide.pdf", name: "Guide de l'agent.pdf" },
  ],
  agentLinks: [{ url: "https://www.service-public.fr", description: "Service public" }],
  agentDocuments: [{ path: "org/proc/agent/aide.pdf", name: "Aide.pdf" }],
});

const guidance = (over: Partial<AgentGuidance> = {}): AgentGuidance => ({
  ...emptyAgentGuidance(),
  recommendedSources: [
    { url: "https://www.legifrance.gouv.fr", description: "Légifrance" },
    // Déjà déclarée par la démarche : une seule entrée, sous l'origine démarche.
    { url: "https://www.arles.fr/stationnement", description: "Stationnement (collectivité)" },
  ],
  ...over,
});

describe("sourceId", () => {
  it("est stable, opaque et court", () => {
    const a = sourceId("page", "https://www.arles.fr");
    expect(a).toBe(sourceId("page", "https://www.arles.fr"));
    expect(a).toMatch(/^s-[0-9a-z]{1,8}$/);
    expect(a).not.toContain("arles");
  });

  it("distingue la nature et la référence", () => {
    expect(sourceId("page", "x")).not.toBe(sourceId("document", "x"));
    expect(sourceId("page", "x")).not.toBe(sourceId("page", "y"));
  });
});

describe("buildCatalogue", () => {
  it("réunit, dans l'ordre de la préséance, les sources IA, les documents, puis les recommandées", () => {
    const c = buildCatalogue(kb, guidance());
    expect(c.map((e) => [e.kind, e.origin, e.label])).toEqual([
      ["page", "demarche", "Règlement du stationnement"],
      ["document", "demarche", "Guide de l'agent.pdf"],
      ["page", "collectivite", "Légifrance"],
    ]);
  });

  it("ne propose JAMAIS les liens ni les documents destinés à l'agent", () => {
    const c = buildCatalogue(kb, null);
    expect(c.some((e) => e.url === "https://www.service-public.fr")).toBe(false);
    expect(c.some((e) => e.path === "org/proc/agent/aide.pdf")).toBe(false);
  });

  it("écarte une page qu'Iris n'irait pas lire (http, sans adresse)", () => {
    const urls = buildCatalogue(kb, null).map((e) => e.url);
    expect(urls).not.toContain("http://ancien.arles.fr/page");
    expect(urls).not.toContain("");
  });

  it("sans recommandations lisibles, garde les sources de la démarche", () => {
    expect(buildCatalogue(kb, null)).toHaveLength(2);
    expect(buildCatalogue(emptyAiKnowledge(), null)).toEqual([]);
  });

  it("plafonne le catalogue", () => {
    const many = parseAiKnowledge({
      aiSources: Array.from({ length: 60 }, (_, i) => ({ url: `https://ex${i}.fr`, description: `S${i}` })),
    });
    expect(buildCatalogue(many, null)).toHaveLength(40);
  });
});

describe("toRef — ce qui sort du serveur", () => {
  it("ne porte JAMAIS le chemin d'un document", () => {
    const doc = buildCatalogue(kb, null).find((e) => e.kind === "document")!;
    expect(doc.path).toBe("org/proc/training/1f0c-guide.pdf");
    const ref = toRef(doc);
    expect(ref).not.toHaveProperty("path");
    expect(JSON.stringify(ref)).not.toContain("org/proc");
  });

  it("garde l'adresse publique d'une page", () => {
    const page = buildCatalogue(kb, null)[0];
    expect(toRef(page).url).toBe("https://www.arles.fr/stationnement");
  });
});

describe("libellés", () => {
  it("un document sans nom d'origine ne montre que son nom de fichier, sans préfixe unique", () => {
    expect(documentLabel({
      path: "org/proc/training/3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f-bareme.pdf",
      name: "org/proc/training/3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f-bareme.pdf",
    })).toBe("bareme.pdf");
    expect(documentLabel({ path: "o/p/training/1726755600000-note.docx", name: "" })).toBe("note.docx");
    // Un nom ordinaire à tirets n'est pas un préfixe.
    expect(documentLabel({ path: "o/p/training/rapport-annuel.pdf", name: "" })).toBe("rapport-annuel.pdf");
  });

  it("une page sans description se nomme par son adresse", () => {
    expect(pageLabel({ url: "https://www.arles.fr/demarches/", description: "" })).toBe("www.arles.fr/demarches/");
    expect(pageLabel({ url: "https://www.arles.fr/", description: "" })).toBe("www.arles.fr");
  });
});

describe("catalogueUrls", () => {
  it("rend les adresses proposées, pas les documents", () => {
    const urls = catalogueUrls(buildCatalogue(kb, guidance()));
    expect([...urls].sort()).toEqual(["https://www.arles.fr/stationnement", "https://www.legifrance.gouv.fr"]);
  });
});

describe("parseSourceIds — entrée du navigateur, NON fiable", () => {
  it("absent = aucune source", () => {
    expect(parseSourceIds(undefined)).toEqual({ ok: true, ids: [] });
    expect(parseSourceIds(null)).toEqual({ ok: true, ids: [] });
  });

  it("refuse une forme inattendue", () => {
    expect(parseSourceIds("s-abc").ok).toBe(false);
    expect(parseSourceIds([42]).ok).toBe(false);
    expect(parseSourceIds(["org/proc/training/guide.pdf"]).ok).toBe(false);
    expect(parseSourceIds(["https://evil.example"]).ok).toBe(false);
  });

  it(`refuse plus de ${MAX_CONSULTED} sources`, () => {
    expect(parseSourceIds(["s-1", "s-2", "s-3", "s-4", "s-5"]).ok).toBe(false);
  });

  it("dédoublonne", () => {
    expect(parseSourceIds(["s-1", "s-1"])).toEqual({ ok: true, ids: ["s-1"] });
  });
});

describe("resolveSources", () => {
  const catalogue = buildCatalogue(kb, guidance());

  it("rend les entrées dans l'ordre du CATALOGUE", () => {
    const [page, doc] = catalogue;
    const r = resolveSources(catalogue, [doc.id, page.id], false);
    expect(r.ok && r.entries.map((e) => e.id)).toEqual([page.id, doc.id]);
  });

  it("refuse un identifiant absent du catalogue", () => {
    const r = resolveSources(catalogue, ["s-zzzz"], false);
    expect(r).toEqual({ ok: false, unknown: ["s-zzzz"] });
  });

  it("référentiel partiellement muet : l'inconnu devient « manquant », pas une erreur", () => {
    const r = resolveSources(catalogue, [catalogue[0].id, "s-zzzz"], true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries.map((e) => e.id)).toEqual([catalogue[0].id]);
      expect(r.missing).toEqual(["s-zzzz"]);
    }
  });
});

describe("buildCatalogue — documents de la collectivité seulement", () => {
  it("écarte un document dont le chemin ne commence pas par la racine du tenant", () => {
    const withForeign = parseAiKnowledge({
      trainingDocuments: [
        { path: "org-a/proc/training/guide.pdf", name: "Guide.pdf" },
        { path: "org-b/proc/training/secret.pdf", name: "Secret.pdf" },
      ],
    });
    const c = buildCatalogue(withForeign, null, { socleOrgId: "org-a" });
    expect(c.map((e) => e.label)).toEqual(["Guide.pdf"]);
    // Le préfixe se termine par « / » : org-ab n'est pas org-a.
    const lookalike = parseAiKnowledge({ trainingDocuments: [{ path: "org-ab/p/t/x.pdf", name: "X.pdf" }] });
    expect(buildCatalogue(lookalike, null, { socleOrgId: "org-a" })).toEqual([]);
  });
});
