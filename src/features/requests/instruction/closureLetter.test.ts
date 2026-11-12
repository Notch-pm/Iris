import { describe, expect, it } from "vitest";
import { closureLetterChoice, closureLetterReady, emptyClosureLetter } from "./ClosureLetterSection";

describe("courrier de réponse papier — état de la modale de clôture", () => {
  it("par défaut : interrupteur coupé, PDF, rien à générer, rien qui bloque", () => {
    const draft = emptyClosureLetter();
    expect(draft).toEqual({ enabled: false, templateId: "", format: "pdf" });
    expect(closureLetterReady(draft)).toBe(true);
    expect(closureLetterChoice(draft)).toBeUndefined();
  });

  it("interrupteur activé sans courrier choisi : la validation attend", () => {
    const draft = { ...emptyClosureLetter(), enabled: true };
    expect(closureLetterReady(draft)).toBe(false);
    expect(closureLetterChoice(draft)).toBeUndefined();
  });

  it("courrier choisi : la soumission porte le modèle et le format", () => {
    const draft = { enabled: true, templateId: "a92b", format: "docx" as const };
    expect(closureLetterReady(draft)).toBe(true);
    expect(closureLetterChoice(draft)).toEqual({ templateId: "a92b", format: "docx" });
  });

  it("interrupteur recoupé : le choix précédent ne part pas", () => {
    expect(closureLetterChoice({ enabled: false, templateId: "a92b", format: "pdf" })).toBeUndefined();
  });
});
