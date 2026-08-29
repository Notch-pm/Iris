import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyAiKnowledge, isAiKnowledgeEmpty, parseAiKnowledge } from "./knowledge";
import { parseAgentKnowledge } from "../../socle-proxy/_shared/knowledge";

const rawKb = {
  agentHelpText: "Consignes agent",
  proceduresText: "Étapes",
  agentDocuments: [{ path: "o/p/agent/guide.pdf", name: "Guide.pdf" }],
  trainingDocuments: [
    { path: "o/p/training/bareme.pdf", name: "Barème 2026.pdf" },
    { path: "o/p/training/corpus.md", name: "corpus.md" },
  ],
  agentLinks: [{ url: "https://x", description: "Fiche" }],
  aiSources: [{ url: "https://interne/llm", description: "Corpus interne" }],
  faq: [{ question: "q", answer: "r" }],
  guardrails: ["- Ne jamais décider seul."],
};

describe("parseAiKnowledge", () => {
  it("voit la matière IA que la vue agent retire", () => {
    const kb = parseAiKnowledge(rawKb);
    expect(kb.trainingDocuments).toHaveLength(2);
    expect(kb.trainingDocuments[0].name).toBe("Barème 2026.pdf");
    expect(kb.aiSources).toEqual([{ url: "https://interne/llm", description: "Corpus interne" }]);
  });

  it("conserve la part agent à l'identique — une seule implémentation", () => {
    const serveur = parseAiKnowledge(rawKb);
    const agent = parseAgentKnowledge(rawKb);
    expect(serveur.agentHelpText).toBe(agent.agentHelpText);
    expect(serveur.proceduresText).toBe(agent.proceduresText);
    expect(serveur.agentDocuments).toEqual(agent.agentDocuments);
    expect(serveur.agentLinks).toEqual(agent.agentLinks);
    expect(serveur.faq).toEqual(agent.faq);
    // Le tiret de liste est retiré par le module partagé : pas de divergence.
    expect(serveur.guardrails).toEqual(["Ne jamais décider seul."]);
  });

  // La garde du 2026-08-28, portée ici aussi : la whitelist est traversée deux
  // fois dans certains chemins, elle doit être un sous-ensemble strict.
  it("est idempotente, aller-retour JSON compris", () => {
    const once = parseAiKnowledge(rawKb);
    expect(parseAiKnowledge(once)).toEqual(once);
    expect(parseAiKnowledge(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("tolère l'absence, l'inconnu et les types faux", () => {
    expect(parseAiKnowledge(null)).toEqual(emptyAiKnowledge());
    expect(parseAiKnowledge("SECRET")).toEqual(emptyAiKnowledge());
    expect(parseAiKnowledge([1, 2])).toEqual(emptyAiKnowledge());
    const kb = parseAiKnowledge({ trainingDocuments: "x", aiSources: [null, 7], futur: 1 });
    expect(kb.trainingDocuments).toEqual([]);
    expect(kb.aiSources).toEqual([]);
    expect(kb).not.toHaveProperty("futur");
  });

  it("écarte un document d'entraînement sans chemin", () => {
    const kb = parseAiKnowledge({ trainingDocuments: [{ name: "sans chemin" }, { path: "a.pdf" }] });
    expect(kb.trainingDocuments).toEqual([{ path: "a.pdf", name: "a.pdf" }]);
  });
});

describe("isAiKnowledgeEmpty", () => {
  it("vrai quand la démarche n'est pas documentée", () => {
    expect(isAiKnowledgeEmpty(emptyAiKnowledge())).toBe(true);
  });

  it("faux dès qu'un seul bloc porte quelque chose", () => {
    expect(isAiKnowledgeEmpty(parseAiKnowledge({ guardrails: ["x"] }))).toBe(false);
    expect(isAiKnowledgeEmpty(parseAiKnowledge({ trainingDocuments: [{ path: "a" }] }))).toBe(false);
    expect(isAiKnowledgeEmpty(parseAiKnowledge(rawKb))).toBe(false);
  });
});

// ⚠️ La garde qui sépare les deux chemins. `socle-proxy` sert le NAVIGATEUR :
// il ne doit jamais importer la vue serveur, sous peine de faire voyager le
// corpus d'entraînement jusqu'au client. Le test lit le source plutôt que de
// faire confiance à une convention.
describe("étanchéité des deux chemins", () => {
  it("socle-proxy n'importe rien de _shared/ai/", () => {
    const source = readFileSync(
      new URL("../../socle-proxy/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/_shared\/ai\//);
  });

  it("la vue navigateur ne porte toujours ni trainingDocuments ni aiSources", () => {
    const agent = parseAgentKnowledge(rawKb);
    const serialized = JSON.stringify(agent);
    expect(serialized).not.toContain("bareme");
    expect(serialized).not.toContain("interne/llm");
    expect(agent).not.toHaveProperty("trainingDocuments");
    expect(agent).not.toHaveProperty("aiSources");
  });
});
