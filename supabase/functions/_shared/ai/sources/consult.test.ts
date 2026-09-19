import { describe, expect, it } from "vitest";
import { condenseConsulted, EXPLORATION_BUDGET_TOKENS, type SourceRead } from "./consult";
import type { CatalogueEntry } from "./catalogue";
import { KNOWLEDGE_BUDGET_TOKENS } from "../condense";
import { MAX_TOTAL_CHARS, MAX_TURNS } from "../messages";
import { estimateTokens, MAX_OUTPUT_TOKENS } from "../tokens";

const page: CatalogueEntry = {
  id: "s-aaa", kind: "page", origin: "demarche", label: "Règlement", url: "https://www.arles.fr/r",
};
const doc: CatalogueEntry = {
  id: "s-bbb", kind: "document", origin: "demarche", label: "Guide.pdf", path: "org/proc/training/guide.pdf",
};
const reco: CatalogueEntry = {
  id: "s-ccc", kind: "page", origin: "collectivite", label: "Légifrance", url: "https://www.legifrance.gouv.fr",
};

describe("condenseConsulted", () => {
  it("sert le texte lu et nomme ce qui ne l'a pas été, avec son motif", () => {
    const reads: SourceRead[] = [
      { entry: page, text: "Le tarif est de 30 €." },
      { entry: doc, text: null, reason: "document scanné — lecture par reconnaissance de caractères non activée" },
      { entry: reco, text: "   " },
    ];
    const r = condenseConsulted(reads);
    expect(r.consulted).toEqual([{ ...page, text: "Le tarif est de 30 €." }]);
    expect(r.unread).toEqual([
      { id: "s-bbb", label: "Guide.pdf", reason: "document scanné — lecture par reconnaissance de caractères non activée" },
      { id: "s-ccc", label: "Légifrance", reason: "aucun texte lisible" },
    ]);
  });

  it("ne transmet JAMAIS le chemin d'un document", () => {
    const r = condenseConsulted([{ entry: doc, text: "Contenu." }]);
    expect(r.consulted[0]).not.toHaveProperty("path");
  });

  it("partage l'enveloppe : un long texte n'évince pas un court", () => {
    const r = condenseConsulted([
      { entry: page, text: "Court. ".repeat(20) },
      { entry: doc, text: "Long règlement. ".repeat(20000) },
    ], 4000);
    expect(r.consulted.map((s) => s.id)).toEqual(["s-aaa", "s-bbb"]);
    expect(r.truncated).toBe(true);
    expect(r.consulted[1].text).toContain("(extrait tronqué)");
  });

  it("nomme une source écartée faute de budget", () => {
    const r = condenseConsulted([
      { entry: page, text: "x ".repeat(5000) },
      { entry: doc, text: "y ".repeat(5000) },
      { entry: reco, text: "z ".repeat(5000) },
    ], 300);
    expect(r.unread.some((u) => u.reason === "budget de contexte atteint")).toBe(true);
    expect(r.consulted.length + r.unread.length).toBe(3);
  });
});

// ⚠️ L'enveloppe d'un appel doit tenir sous le plafond d'ENTRÉE du guichet
// `ai-api` (60 000 jetons, `MAX_INPUT_TOKENS` du Socle), sans quoi le Socle
// répond 413 et l'agent perd sa question. On garde 6 000 jetons de marge pour
// les règles, le dossier et les libellés.
describe("enveloppe d'un appel", () => {
  it("connaissance + sources consultées + historique + réponse tiennent sous 60 000 jetons", () => {
    const history = estimateTokens("x".repeat(MAX_TOTAL_CHARS)) + MAX_TURNS * 4;
    const total = KNOWLEDGE_BUDGET_TOKENS + EXPLORATION_BUDGET_TOKENS + history + MAX_OUTPUT_TOKENS + 6000;
    expect(total).toBeLessThan(60000);
  });
});
