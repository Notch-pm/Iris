import { describe, expect, it } from "vitest";
import { redactFreeText, redactValue, stripIdentityKeys } from "./redact";

describe("stripIdentityKeys", () => {
  it("retire les clés du catalogue, à toute profondeur", () => {
    const { value, removedKeys } = stripIdentityKeys({
      objet: "Nid-de-poule",
      demandeur: { email: "a@b.fr", nested: { telephone: "0612345678", note: "ok" } },
      liste: [{ nom: "Durand" }, { autre: 1 }],
    });
    expect(value).toEqual({
      objet: "Nid-de-poule",
      demandeur: { nested: { note: "ok" } },
      liste: [{}, { autre: 1 }],
    });
    expect(removedKeys).toEqual(["email", "nom", "telephone"]);
  });

  it("connaît les synonymes du catalogue, pas seulement les noms canoniques", () => {
    const { value } = stripIdentityKeys({
      civilite: "madame", prenoms: "Marie", nom_naissance: "Durand",
      raison_sociale: "ACME", date_naissance: "1981-03-14", courriel: "x@y.fr",
      tel_portable: "0612345678", postal_code: "13200", city: "Arles",
      objet: "conservé",
    });
    expect(value).toEqual({ objet: "conservé" });
  });

  // Le lieu d'intervention RESTE : un lieu n'est pas une personne, et c'est
  // souvent le cœur de la question posée à l'assistant.
  it("préserve le bloc « Lieu d'intervention »", () => {
    const { value, removedKeys } = stripIdentityKeys({
      intervention_voie: "rue des Lilas",
      intervention_ville: "Arles",
      intervention_code_postal: "13200",
      city: "Arles",
      postal_code: "13200",
    });
    expect(value).toEqual({
      intervention_voie: "rue des Lilas",
      intervention_ville: "Arles",
      intervention_code_postal: "13200",
    });
    expect(removedKeys).toEqual(["city", "postal_code"]);
  });

  it("est insensible à la casse des clés", () => {
    expect(stripIdentityKeys({ Email: "a@b.fr", NOM: "x", ok: 1 }).value).toEqual({ ok: 1 });
  });

  it("laisse intacts les scalaires, tableaux et objets sans identité", () => {
    expect(stripIdentityKeys("texte").value).toBe("texte");
    expect(stripIdentityKeys(42).value).toBe(42);
    expect(stripIdentityKeys(null).value).toBeNull();
    expect(stripIdentityKeys([1, "a", { b: 2 }]).value).toEqual([1, "a", { b: 2 }]);
  });
});

describe("redactFreeText", () => {
  it("masque un courriel", () => {
    expect(redactFreeText("écrire à marie.durand@ville.fr svp"))
      .toBe("écrire à [courriel retiré] svp");
  });

  it("masque les trois écritures françaises d'un téléphone", () => {
    expect(redactFreeText("06 12 34 56 78")).toBe("[téléphone retiré]");
    expect(redactFreeText("0612345678")).toBe("[téléphone retiré]");
    expect(redactFreeText("+33 6 12 34 56 78")).toBe("[téléphone retiré]");
    expect(redactFreeText("06.12.34.56.78")).toBe("[téléphone retiré]");
  });

  it("masque un IBAN et un SIRET", () => {
    expect(redactFreeText("IBAN FR76 3000 6000 0112 3456 7890 189"))
      .toBe("IBAN [IBAN retiré]");
    expect(redactFreeText("SIRET 12345678901234")).toBe("SIRET [SIRET retiré]");
  });

  // La limite, écrite noir sur blanc : sans NER, un nom en texte libre passe.
  // Le test l'épingle pour que personne ne croie la promesse plus large.
  it("NE masque PAS les noms — limite assumée et documentée", () => {
    expect(redactFreeText("Madame Durand est passée au guichet"))
      .toBe("Madame Durand est passée au guichet");
  });

  it("ne casse pas un numéro de voie ni une référence de dossier", () => {
    expect(redactFreeText("12 rue des Lilas")).toBe("12 rue des Lilas");
    expect(redactFreeText("DEM-2026-000028")).toBe("DEM-2026-000028");
    expect(redactFreeText("Passage prévu entre 8h et 12h")).toBe("Passage prévu entre 8h et 12h");
  });

  it("rend une chaîne vide sur une entrée non textuelle", () => {
    expect(redactFreeText("")).toBe("");
    expect(redactFreeText(undefined as unknown as string)).toBe("");
  });
});

describe("redactValue", () => {
  it("enchaîne les deux passes sur une réponse de formulaire réelle", () => {
    const formData = {
      type_demandeur: "particulier",
      email: "marie@ville.fr",
      intervention_voie: "rue des Lilas",
      precisions: "Rappeler au 06 12 34 56 78 ou à marie@ville.fr avant le passage.",
    };
    const { value, removedKeys } = redactValue(formData);
    expect(value).toEqual({
      type_demandeur: "particulier",
      intervention_voie: "rue des Lilas",
      precisions: "Rappeler au [téléphone retiré] ou à [courriel retiré] avant le passage.",
    });
    expect(removedKeys).toEqual(["email"]);
  });

  it("ne signale que ce qu'il a réellement retiré", () => {
    expect(redactValue({ objet: "Nid-de-poule" }).removedKeys).toEqual([]);
  });
});

describe("stripIdentityKeys — le lieu d'intervention est copié ENTIER", () => {
  it("ne descend pas sous `intervention_lieu` : son `address` est celle du dépôt, pas d'une personne", () => {
    const { value, removedKeys } = stripIdentityKeys({
      intervention_lieu: { address: "10 Avenue de Frémeur 44000 Nantes", lat: 47.223, lon: -1.573, adjusted: true },
      email: "x@y.fr",
      demandeur: { address: "1 rue Cachée" },
    });
    expect(value).toEqual({
      intervention_lieu: { address: "10 Avenue de Frémeur 44000 Nantes", lat: 47.223, lon: -1.573, adjusted: true },
      demandeur: {},
    });
    expect(removedKeys).toEqual(["address", "email"]);
  });
});
