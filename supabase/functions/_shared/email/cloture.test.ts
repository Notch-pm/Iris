import { describe, expect, it } from "vitest";
import { quotedSubject, salutation } from "./adresse.ts";
import { closureEmail, CLOSURE_SUBJECTS, isClosureOutcome } from "./cloture.ts";

describe("salutation", () => {
  it("compose civilité et nom quand les deux sont là", () => {
    expect(salutation({ civility: "Madame", fullName: "Marie Durand" })).toBe("Madame Marie Durand");
  });
  it("se contente de ce qu'elle a", () => {
    expect(salutation({ fullName: "Boulangerie Durand" })).toBe("Boulangerie Durand");
    expect(salutation({ civility: "Monsieur" })).toBe("Monsieur");
  });
  it("NORMALISE la civilité du Socle, stockée en minuscules", () => {
    // Défaut constaté en envoi réel le 2026-08-28 : l'usager lisait
    // « monsieur Laurent Jacquot, » pendant que l'écran affichait « Monsieur ».
    expect(salutation({ civility: "monsieur", fullName: "Marie Durand" }))
      .toBe("Monsieur Marie Durand");
    expect(salutation({ civility: "madame" })).toBe("Madame");
    // Idempotent : l'écran passe déjà une valeur normalisée.
    expect(salutation({ civility: "Madame" })).toBe("Madame");
    // Une civilité hors catalogue passe telle quelle plutôt que d'être effacée.
    expect(salutation({ civility: "Maître", fullName: "Durand" })).toBe("Maître Durand");
  });

  it("retombe sur « Madame, Monsieur » plutôt que sur un trou", () => {
    expect(salutation({})).toBe("Madame, Monsieur");
    expect(salutation({ civility: null, fullName: "   " })).toBe("Madame, Monsieur");
  });
});

describe("quotedSubject", () => {
  it("guillemète et laisse l'espace qui suit", () => {
    expect(quotedSubject("Acte de naissance")).toBe("« Acte de naissance » ");
  });
  it("rend une chaîne VIDE quand l'objet manque — jamais des guillemets vides", () => {
    expect(quotedSubject(null)).toBe("");
    expect(quotedSubject("   ")).toBe("");
  });
});

describe("closureEmail", () => {
  const base = {
    reference: "DEM-2026-000042",
    requestSubject: "Acte de naissance",
    recipient: { civility: "Madame", fullName: "Marie Durand" },
    tenantName: "Ville de Saint-Aubin",
  };

  it("porte les objets FIGÉS dictés par le PO", () => {
    expect(CLOSURE_SUBJECTS.resolue_positive).toBe("Votre demande a été résolue positivement");
    expect(CLOSURE_SUBJECTS.resolue_negative)
      .toBe("Nous ne pouvons répondre positivement à votre demande");
    expect(closureEmail({ ...base, outcome: "resolue_positive", closureText: null }).subject)
      .toBe("Votre demande a été résolue positivement");
    expect(closureEmail({ ...base, outcome: "resolue_negative", closureText: null }).subject)
      .toBe("Nous ne pouvons répondre positivement à votre demande");
  });

  it("intègre le commentaire de l'agent quand il existe", () => {
    const mail = closureEmail({
      ...base,
      outcome: "resolue_positive",
      closureText: "  Le nid-de-poule a été rebouché le 27 août.  ",
    });
    expect(mail.body).toBe([
      "Madame Marie Durand,",
      "",
      "Votre demande « Acte de naissance » (référence DEM-2026-000042) a reçu une suite favorable.",
      "",
      "Le nid-de-poule a été rebouché le 27 août.",
      "",
      "Cordialement,",
      "Ville de Saint-Aubin",
    ].join("\n"));
  });

  it("tient tout seul SANS commentaire — il est facultatif", () => {
    const mail = closureEmail({ ...base, outcome: "resolue_negative", closureText: null });
    expect(mail.body).toBe([
      "Madame Marie Durand,",
      "",
      "Votre demande « Acte de naissance » (référence DEM-2026-000042) n'a pas pu recevoir une suite favorable.",
      "",
      "Cordialement,",
      "Ville de Saint-Aubin",
    ].join("\n"));
    // Pas de ligne vide isolée là où le commentaire aurait dû être.
    expect(mail.body).not.toContain("\n\n\n");
  });

  it("traite un commentaire blanc comme absent", () => {
    const vide = closureEmail({ ...base, outcome: "resolue_positive", closureText: "   \n  " });
    const nul = closureEmail({ ...base, outcome: "resolue_positive", closureText: null });
    expect(vide.body).toBe(nul.body);
  });

  it("conserve les paragraphes du commentaire", () => {
    const mail = closureEmail({
      ...base,
      outcome: "resolue_positive",
      closureText: "Première ligne.\n\nSeconde ligne.",
    });
    expect(mail.body).toContain("Première ligne.\n\nSeconde ligne.");
  });

  it("se referme sur la référence quand l'objet de la demande manque", () => {
    const mail = closureEmail({
      ...base, requestSubject: null, outcome: "resolue_positive", closureText: null,
    });
    expect(mail.body).toContain("Votre demande (référence DEM-2026-000042) a reçu une suite favorable.");
    expect(mail.body).not.toContain("« »");
  });

  it("s'arrête à « Cordialement, » plutôt que de signer d'une ligne vide", () => {
    const mail = closureEmail({
      ...base, tenantName: null, outcome: "resolue_positive", closureText: null,
    });
    expect(mail.body.endsWith("Cordialement,")).toBe(true);
  });

  it("salue sans nom quand l'identité est inconnue, sans laisser de trou", () => {
    const mail = closureEmail({
      ...base, recipient: {}, outcome: "resolue_negative", closureText: null,
    });
    expect(mail.body.startsWith("Madame, Monsieur,\n")).toBe(true);
    expect(mail.body).not.toContain("null");
    expect(mail.body).not.toContain("undefined");
  });

  it("ne fait JAMAIS sortir le motif de clôture — il n'est même pas une entrée", () => {
    const mail = closureEmail({
      ...base, outcome: "resolue_negative", closureText: "Le dossier relève de la préfecture.",
    });
    for (const motif of ["irrecevable", "réorientation", "doublon", "abandon"]) {
      expect(mail.body.toLowerCase()).not.toContain(motif);
    }
  });
});

describe("isClosureOutcome", () => {
  it("ne reconnaît que les deux issues qui préviennent l'usager", () => {
    expect(isClosureOutcome("resolue_positive")).toBe(true);
    expect(isClosureOutcome("resolue_negative")).toBe(true);
    // L'annulation ne dit rien à l'usager : ce n'est pas une réponse à sa demande.
    expect(isClosureOutcome("annulee")).toBe(false);
    expect(isClosureOutcome("en_instruction")).toBe(false);
    expect(isClosureOutcome("archivee")).toBe(false);
  });
});
