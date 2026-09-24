import { describe, expect, it } from "vitest";
import { identityTerms, maskTerms, pseudonymize, restore } from "./pseudonymize";

const snapshot = {
  civility: "Mme", first_name: "Léa", last_name: "Dupont-Léger", email: "lea.dupont@exemple.fr",
  mobile_phone: "06 12 34 56 78",
};

describe("identityTerms", () => {
  it("reprend les valeurs connues du dépôt, les plus longues d'abord, sans la civilité", () => {
    expect(identityTerms(snapshot)).toEqual([
      "lea.dupont@exemple.fr", "06 12 34 56 78", "Dupont-Léger", "Léa",
    ]);
  });

  it("ignore un snapshot absent et les valeurs trop courtes", () => {
    expect(identityTerms(null)).toEqual([]);
    expect(identityTerms({ first_name: "Li" })).toEqual([]);
  });
});

describe("pseudonymize / restore", () => {
  const text = [
    "Bonjour Madame Dupont-Léger,",
    "suite a votre apel du 06.12.34.56.78, Léa, je vous confirme la visite.",
    "Contact : service@mairie.fr — dossier {{demande.reference}}.",
  ].join("\n");

  it("aucune valeur d'identité ne reste dans le texte envoyé", () => {
    const out = pseudonymize(text, identityTerms(snapshot));
    expect(out.text).not.toMatch(/Dupont|Léa|06\.12|service@mairie\.fr|\{\{/);
    expect(out.text).toContain("⟦P");
    expect(out.text).toContain("suite a votre apel");
  });

  it("aller-retour exact quand le modèle garde les jetons", () => {
    const out = pseudonymize(text, identityTerms(snapshot));
    const corrected = out.text.replace("suite a votre apel", "Suite à votre appel");
    const back = restore(corrected, out.tokens);
    expect(back).toEqual({ ok: true, text: text.replace("suite a votre apel", "Suite à votre appel") });
  });

  it("refuse un jeton perdu ou inventé", () => {
    const out = pseudonymize("Bonjour Madame Dupont-Léger", identityTerms(snapshot));
    expect(restore("Bonjour Madame", out.tokens).ok).toBe(false);
    expect(restore(`${out.text} ⟦P9⟧`, out.tokens).ok).toBe(false);
  });

  it("respecte les bornes de mot : « Léa » ne masque pas « Léandre »", () => {
    const out = pseudonymize("Léandre et Léa", ["Léa"]);
    expect(out.text).toBe("Léandre et ⟦P1⟧");
  });

  it("même valeur, même jeton ; casse différente, jeton distinct restitué tel quel", () => {
    const out = pseudonymize("Dupont, DUPONT et Dupont", ["Dupont"]);
    expect(out.text).toBe("⟦P1⟧, ⟦P2⟧ et ⟦P1⟧");
    expect(restore(out.text, out.tokens)).toEqual({ ok: true, text: "Dupont, DUPONT et Dupont" });
  });
});

describe("maskTerms", () => {
  it("remplace sans retour, pour le contexte d'un brouillon", () => {
    expect(maskTerms("Madame Dupont-Léger, merci.", ["Dupont-Léger"])).toBe("Madame [usager], merci.");
  });
});
