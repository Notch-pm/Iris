import { describe, expect, it } from "vitest";
import { condenseKnowledge, truncateAtBoundary, type DocumentExtract } from "./condense";
import { emptyAiKnowledge, parseAiKnowledge, type AiKnowledge } from "./knowledge";

const kb = (over: Partial<AiKnowledge> = {}): AiKnowledge => ({
  ...emptyAiKnowledge(),
  agentHelpText: "Vérifier la qualité du demandeur.",
  proceduresText: "1. Accueillir\n2. Contrôler\n3. Délivrer",
  faq: [{ question: "Quelles pièces ?", answer: "Un justificatif de domicile." }],
  guardrails: ["Ne jamais délivrer sans vérifier la qualité du demandeur."],
  ...over,
});

const doc = (name: string, size: number): DocumentExtract => ({
  path: `o/p/training/${name}`,
  name,
  text: `Contenu de ${name}. `.repeat(Math.ceil(size / 20)).slice(0, size),
});

describe("truncateAtBoundary", () => {
  it("laisse un texte court intact", () => {
    expect(truncateAtBoundary("court", 100)).toBe("court");
  });

  it("coupe sur une frontière de mot et annonce la troncature", () => {
    const source = "un deux trois quatre cinq six sept huit";
    const out = truncateAtBoundary(source, 20);
    expect(out).toContain("(extrait tronqué)");
    // Le texte conservé est un préfixe EXACT de la source, terminé sur un mot
    // entier — donc jamais « quatr » ni « quatre c ».
    const kept = out.slice(0, out.indexOf(" […]"));
    expect(source.startsWith(kept)).toBe(true);
    expect(source[kept.length]).toBe(" ");
  });

  // Un caractère hors BMP coupé en deux produit un caractère de remplacement
  // dans le prompt. Sur un document scanné, ça arrive.
  it("ne scinde JAMAIS une paire de substituts UTF-16", () => {
    const text = "a".repeat(9) + "😀" + "b".repeat(40);
    for (let cut = 8; cut <= 14; cut++) {
      const out = truncateAtBoundary(text, cut);
      expect(out).not.toContain("�");
      // Aucun substitut orphelin en fin de chaîne utile.
      for (let i = 0; i < out.length; i++) {
        const c = out.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = out.charCodeAt(i + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
        }
      }
    }
  });

  it("rend une chaîne vide sur un budget nul", () => {
    expect(truncateAtBoundary("texte", 0)).toBe("");
  });
});

describe("condenseKnowledge", () => {
  it("rend un bloc vide quand la démarche n'est pas documentée", () => {
    const r = condenseKnowledge(emptyAiKnowledge());
    expect(r.text).toBe("");
    expect(r.included).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it("compose les blocs dans l'ordre, garde-fous en tête", () => {
    const r = condenseKnowledge(kb());
    expect(r.text.indexOf("Garde-fous")).toBeLessThan(r.text.indexOf("Consignes du service"));
    expect(r.text).toContain("Ne jamais délivrer sans vérifier");
    expect(r.text).toContain("Procédure de traitement");
    expect(r.text).toContain("Questions fréquentes");
  });

  // LA règle du module : les garde-fous sont la dernière chose abandonnée.
  it("garde les garde-fous même sur un budget minuscule", () => {
    const r = condenseKnowledge(kb({ agentHelpText: "x".repeat(50000) }), [], 200);
    expect(r.text).toContain("Garde-fous");
    expect(r.text).toContain("Ne jamais délivrer");
  });

  it("borne la FAQ à 8 entrées et le signale", () => {
    const faq = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}`, answer: `r${i}` }));
    const r = condenseKnowledge(kb({ faq }));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("q7");
    expect(r.text).not.toContain("q8");
  });

  it("partage le reliquat entre les documents — un gros n'évince pas les autres", () => {
    const r = condenseKnowledge(kb(), [doc("petit.pdf", 200), doc("enorme.pdf", 400000)], 8000);
    expect(r.included).toContain("petit.pdf");
    expect(r.included).toContain("enorme.pdf");
    expect(r.text).toContain("Document « petit.pdf »");
    expect(r.text).toContain("Document « enorme.pdf »");
  });

  it("tronque un document unique et énorme plutôt que de l'écarter", () => {
    const r = condenseKnowledge(kb(), [doc("enorme.pdf", 400000)], 6000);
    expect(r.included).toEqual(["enorme.pdf"]);
    expect(r.skipped).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("(extrait tronqué)");
  });

  it("nomme les documents écartés faute de budget", () => {
    const many = Array.from({ length: 10 }, (_, i) => doc(`doc${i}.pdf`, 5000));
    const r = condenseKnowledge(kb(), many, 1200);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped[0].reason).toBe("budget de contexte atteint");
    // Rien n'est perdu en silence : inclus + écartés couvrent tout.
    expect(r.included.length + r.skipped.length).toBe(many.length);
  });

  it("rend les documents dans leur ordre d'origine, pas par taille", () => {
    const r = condenseKnowledge(kb(), [doc("b.pdf", 3000), doc("a.pdf", 100)], 20000);
    expect(r.text.indexOf("« b.pdf »")).toBeLessThan(r.text.indexOf("« a.pdf »"));
  });

  it("cite les sources sans les suivre", () => {
    const r = condenseKnowledge(parseAiKnowledge({
      guardrails: ["g"],
      aiSources: [{ url: "https://interne/llm", description: "Corpus interne" }],
    }));
    expect(r.text).toContain("non consultées par l'assistant");
    expect(r.text).toContain("Corpus interne");
  });

  it("est déterministe — même entrée, même chaîne", () => {
    const docs = [doc("a.pdf", 5000), doc("b.pdf", 900)];
    expect(condenseKnowledge(kb(), docs, 4000).text)
      .toBe(condenseKnowledge(kb(), docs, 4000).text);
  });

  // Une miette de 80 caractères ferait croire au modèle qu'il a le document.
  it("écarte un document plutôt que d'en servir un fragment inexploitable", () => {
    const many = Array.from({ length: 20 }, (_, i) => doc(`doc${i}.pdf`, 5000));
    const r = condenseKnowledge(kb(), many, 1500);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.included.length + r.skipped.length).toBe(many.length);
  });

  it("ignore un document dont l'extraction n'a rien donné", () => {
    const r = condenseKnowledge(kb(), [{ path: "p", name: "vide.pdf", text: "   " }]);
    expect(r.included).toEqual([]);
    expect(r.text).not.toContain("vide.pdf");
  });
});
