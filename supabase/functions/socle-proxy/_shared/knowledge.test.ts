import { describe, expect, it } from "vitest";
import {
  allowsAgentDocument,
  isKnowledgeEmpty,
  knowledgeCounts,
  parseAgentKnowledge,
} from "./knowledge";

// Bloc tel que le Socle l'écrit (clés camelCase de `knowledgeBase.ts`),
// avec les DEUX destinataires mélangés.
const rawKb = {
  agentHelpText: "## Points d'attention\nVérifier la période d'absence.",
  proceduresText: "1. Contrôler les pièces\n2. Planifier les passages",
  agentDocuments: [{ path: "org/proc/agent/guide.pdf", name: "Guide OTV.pdf" }],
  trainingDocuments: [{ path: "org/proc/training/corpus.md", name: "corpus.md" }],
  agentLinks: [{ url: "https://service-public.fr/otv", description: "Fiche service-public" }],
  aiSources: [{ url: "https://interne/llm", description: "Corpus interne" }],
  faq: [{ question: "Quelles pièces ?", answer: "Justificatif de domicile." }],
  guardrails: ["Ne jamais valider sans justificatif de domicile."],
};

describe("parseAgentKnowledge", () => {
  it("ne retient que la part destinée à l'agent", () => {
    const kb = parseAgentKnowledge(rawKb);
    expect(kb.agentHelpText).toContain("Points d'attention");
    expect(kb.proceduresText).toContain("Contrôler les pièces");
    expect(kb.agentDocuments).toEqual([{ path: "org/proc/agent/guide.pdf", name: "Guide OTV.pdf" }]);
    expect(kb.agentLinks).toEqual([{ url: "https://service-public.fr/otv", description: "Fiche service-public" }]);
    expect(kb.faq).toHaveLength(1);
    expect(kb.guardrails).toEqual(["Ne jamais valider sans justificatif de domicile."]);
  });

  it("laisse au Socle la matière de l'assistant IA — elle ne franchit pas la frontière", () => {
    const kb = parseAgentKnowledge(rawKb);
    const serialized = JSON.stringify(kb);
    expect(serialized).not.toContain("corpus");
    expect(serialized).not.toContain("interne/llm");
    expect(kb).not.toHaveProperty("trainingDocuments");
    expect(kb).not.toHaveProperty("aiSources");
  });

  it("tolère l'inconnu, les types faux et l'absence totale de bloc", () => {
    expect(parseAgentKnowledge(null)).toEqual(parseAgentKnowledge({}));
    expect(parseAgentKnowledge("SECRET")).toEqual(parseAgentKnowledge(undefined));
    expect(parseAgentKnowledge([1, 2])).toEqual(parseAgentKnowledge({}));
    const kb = parseAgentKnowledge({
      agentHelpText: 42, proceduresText: null, agentDocuments: "x",
      agentLinks: [null, 7], faq: {}, guardrails: [3, ""], champ_futur: "ignoré",
    });
    expect(kb.agentHelpText).toBe("");
    expect(kb.agentDocuments).toEqual([]);
    expect(kb.agentLinks).toEqual([]);
    expect(kb.faq).toEqual([]);
    expect(kb.guardrails).toEqual([]);
    expect(kb).not.toHaveProperty("champ_futur");
  });

  it("écarte les entrées ébauchées puis abandonnées dans l'éditeur Socle", () => {
    const kb = parseAgentKnowledge({
      agentDocuments: [{ path: "  " }, { name: "sans chemin" }, { path: "a/b.pdf" }],
      agentLinks: [{ url: "", description: "" }, { url: "https://x" }],
      faq: [{ question: "", answer: "" }, { answer: "seule la réponse" }],
      guardrails: ["", "   ", "vrai garde-fou"],
    });
    expect(kb.agentDocuments).toEqual([{ path: "a/b.pdf", name: "a/b.pdf" }]);
    expect(kb.agentLinks).toEqual([{ url: "https://x", description: "" }]);
    expect(kb.faq).toEqual([{ question: "", answer: "seule la réponse" }]);
    expect(kb.guardrails).toEqual(["vrai garde-fou"]);
  });

  it("retire le tiret de liste que le Socle garde souvent en tête d'un garde-fou", () => {
    const kb = parseAgentKnowledge({
      guardrails: ["- Ne jamais délivrer sans vérifier.", "* Autre règle", "• Troisième", "-Sans espace"],
    });
    expect(kb.guardrails).toEqual([
      "Ne jamais délivrer sans vérifier.", "Autre règle", "Troisième", "-Sans espace",
    ]);
  });
});

describe("idempotence — la sortie est un sous-ensemble strict de l'entrée", () => {
  // Le proxy whiteliste, PUIS le navigateur re-parse la réponse par défiance.
  // Si un champ était renommé au passage, le second tour l'effacerait — ce qui
  // est exactement arrivé le 2026-08-28 (documents et liens perdus, textes
  // intacts, panneau muet sur deux cartes). Ce test est la garde.
  it("parse(parse(x)) === parse(x)", () => {
    const once = parseAgentKnowledge(rawKb);
    expect(parseAgentKnowledge(once)).toEqual(once);
    expect(parseAgentKnowledge(parseAgentKnowledge(once))).toEqual(once);
  });

  it("survit aussi à un aller-retour JSON (ce que fait vraiment le réseau)", () => {
    const once = parseAgentKnowledge(rawKb);
    expect(parseAgentKnowledge(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe("knowledgeCounts / isKnowledgeEmpty", () => {
  it("compte les blocs non vides", () => {
    const c = knowledgeCounts(parseAgentKnowledge(rawKb));
    expect(c).toEqual({
      aide: true, procedures: true, documents: 1, links: 1, faq: 1, guardrails: 1, blocks: 6,
    });
  });

  it("une démarche non documentée n'a aucun bloc", () => {
    const kb = parseAgentKnowledge({});
    expect(knowledgeCounts(kb).blocks).toBe(0);
    expect(isKnowledgeEmpty(kb)).toBe(true);
  });

  it("un seul texte suffit à ne plus être vide", () => {
    expect(isKnowledgeEmpty(parseAgentKnowledge({ guardrails: ["x"] }))).toBe(false);
  });
});

describe("allowsAgentDocument", () => {
  const kb = parseAgentKnowledge(rawKb);

  it("accepte un document d'aide agent de CETTE démarche", () => {
    expect(allowsAgentDocument(kb, "org/proc/agent/guide.pdf")).toBe(true);
  });

  it("refuse un document d'entraînement IA, un chemin voisin et le vide", () => {
    expect(allowsAgentDocument(kb, "org/proc/training/corpus.md")).toBe(false);
    expect(allowsAgentDocument(kb, "org/proc/agent/guide.pdf/../../autre.pdf")).toBe(false);
    expect(allowsAgentDocument(kb, "org/autre/agent/guide.pdf")).toBe(false);
    expect(allowsAgentDocument(kb, "")).toBe(false);
    expect(allowsAgentDocument(kb, null)).toBe(false);
    expect(allowsAgentDocument(parseAgentKnowledge({}), "org/proc/agent/guide.pdf")).toBe(false);
  });
});
