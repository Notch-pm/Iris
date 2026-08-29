import { describe, expect, it } from "vitest";
import {
  estimateCall,
  estimateMessagesTokens,
  estimateTokens,
  MAX_OUTPUT_TOKENS,
} from "./tokens";

describe("estimateTokens", () => {
  it("rend zéro sur le vide", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("est monotone — ajouter du texte n'abaisse jamais l'estimation", () => {
    let previous = 0;
    let text = "";
    for (let i = 0; i < 40; i++) {
      text += "justificatif de domicile ";
      const current = estimateTokens(text);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  // ⚠️ Le contrat de l'heuristique, pas une vérité de tokenizer. Clara prend
  // `chars / 4`, calibré sur l'anglais ASCII ; le français administratif coûte
  // 15 à 25 % de plus. On vérifie que la marge existe et va dans le BON sens
  // (surestimer, jamais sous-estimer).
  it("estime le français au-dessus de la règle anglaise chars/4", () => {
    const fr = "Le justificatif de domicile de moins de trois mois est obligatoire " +
      "pour toute déclaration préalable de travaux.";
    expect(estimateTokens(fr)).toBeGreaterThan(Math.ceil(fr.length / 4));
    // ...sans exploser pour autant : la marge reste sous 20 %.
    expect(estimateTokens(fr)).toBeLessThan(Math.ceil(fr.length / 4) * 1.2);
  });

  it("compte les accents comme des caractères ordinaires (borne haute assumée)", () => {
    expect(estimateTokens("eeeee")).toBe(estimateTokens("ééééé"));
  });
});

describe("estimateMessagesTokens", () => {
  it("ajoute un coût de structure par message", () => {
    const un = estimateMessagesTokens([{ role: "user", content: "bonjour" }]);
    const deux = estimateMessagesTokens([
      { role: "user", content: "bonjo" },
      { role: "user", content: "ur" },
    ]);
    // Même texte utile, un message de plus ⇒ estimation plus élevée.
    expect(deux).toBeGreaterThan(un);
  });

  it("rend zéro sur une conversation vide", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

describe("estimateCall", () => {
  it("réserve l'entrée PLUS la sortie maximale", () => {
    const estimate = estimateCall({ system: "consigne", messages: [{ role: "user", content: "q" }] });
    expect(estimate).toBeGreaterThan(MAX_OUTPUT_TOKENS);
  });

  it("respecte une sortie maximale explicite", () => {
    const petit = estimateCall({ system: "", messages: [], maxOutput: 10 });
    const grand = estimateCall({ system: "", messages: [], maxOutput: 100 });
    expect(grand - petit).toBe(90);
  });

  it("croît avec le contexte injecté", () => {
    const court = estimateCall({ system: "court", messages: [] });
    const long = estimateCall({ system: "long".repeat(2000), messages: [] });
    expect(long).toBeGreaterThan(court);
  });
});
