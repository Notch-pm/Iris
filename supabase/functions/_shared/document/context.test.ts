import { describe, expect, it } from "vitest";
import {
  buildDocumentInput, closureLabel, complianceLabel, documentFileName, frDate, usagerFrom,
} from "./context";
import { adresseComplete, buildMergeContext } from "./variables";

const REQUEST = {
  reference: "DEM-2026-000042",
  subject: "Nid-de-poule rue des Lilas",
  status: "en_instruction",
  priority: "haute",
  received_at: "2026-08-12T09:30:00Z",
  due_at: "2026-08-26T09:30:00Z",
  closed_at: null,
  socle_organization_label: "Direction de la voirie",
  socle_procedure_label: "Demande d'intervention voirie",
  socle_category_label: "Voirie",
};

const ORGANISME = {
  nom: "Mairie d'Arles", adresse: "Place de la République", telephone: null,
  courriel: null, couleurPrincipale: "#1b7a4b", couleurSecondaire: null,
};

describe("dates et libellés", () => {
  it("formate en français, et rend du vide plutôt qu'une date absente", () => {
    expect(frDate("2026-08-12T09:30:00Z")).toBe("12/08/2026");
    expect(frDate(null)).toBe("");
    expect(frDate("pas une date")).toBe("");
  });

  it("une pièce jamais qualifiée se dit « À qualifier »", () => {
    expect(complianceLabel(null)).toBe("À qualifier");
    expect(complianceLabel("conforme")).toBe("Conforme");
    expect(complianceLabel("non_conforme")).toBe("Non conforme");
  });

  it("l'état à la clôture ne parle qu'une fois la demande close", () => {
    expect(closureLabel("resolue_positive")).toBe("Positive");
    expect(closureLabel("resolue_negative")).toBe("Négative");
    expect(closureLabel("en_instruction")).toBe("");
  });
});

describe("identité de l'usager", () => {
  it("lit une fiche Socle", () => {
    const usager = usagerFrom({
      civility: "madame", first_name: "Marie", last_name: "Dupont", usage_name: "Martin",
      address_line1: "12 rue des Lilas", address_line2: "Bât. B",
      postal_code: "13200", city: "Arles", email: "m@exemple.fr", mobile_phone: "0601020304",
    }, "Centre");
    expect(usager).toMatchObject({
      civilite: "madame", prenom: "Marie", nom: "Martin",
      voie: "12 rue des Lilas", complement: "Bât. B",
      code_postal: "13200", ville: "Arles", quartier: "Centre",
    });
  });

  it("lit un dépôt déclaré (synonymes partenaires), adresse libre comprise", () => {
    const usager = usagerFrom({ nom: "Dupont", prenom: "Marie", adresse: "12 rue des Lilas" }, null);
    expect(usager.nom).toBe("Dupont");
    expect(usager.voie).toBe("12 rue des Lilas");
  });

  it("une structure est nommée par sa raison sociale", () => {
    expect(usagerFrom({ legal_name: "Association des Lilas" }, null).nom)
      .toBe("Association des Lilas");
  });

  it("le bloc adresse saute les lignes vides", () => {
    expect(adresseComplete({ voie: "12 rue des Lilas", code_postal: "13200", ville: "Arles" }))
      .toBe("12 rue des Lilas\n13200 Arles");
  });
});

describe("contexte complet", () => {
  const input = buildDocumentInput({
    request: REQUEST,
    agent: { first_name: "Claire", last_name: "Martin", email: "claire@arles.fr" },
    pieces: [
      { file_name: "domicile.pdf", document_type_label: "Justificatif de domicile", compliance: "conforme" },
      { file_name: "photo.jpg", document_type_label: null, compliance: null },
    ],
    identity: { first_name: "Marie", last_name: "Dupont", city: "Arles" },
    quartier: "Centre",
    organisme: ORGANISME,
  });

  it("traduit statut et urgence comme l'écran", () => {
    expect(input.demande.etat_actuel).toBe("En cours d'instruction");
    expect(input.demande.urgence).toBe("Haute");
  });

  it("nomme une pièce par son type, à défaut par son fichier", () => {
    expect(input.demande.pieces).toEqual([
      { libelle: "Justificatif de domicile", statut: "Conforme", fichier: "domicile.pdf" },
      { libelle: "photo.jpg", statut: "À qualifier", fichier: "photo.jpg" },
    ]);
  });

  it("sans agent affecté, les trois variables sont vides — jamais « null »", () => {
    const sansAgent = buildDocumentInput({
      request: REQUEST, agent: null, pieces: [], identity: {}, quartier: null, organisme: ORGANISME,
    });
    const ctx = buildMergeContext(sansAgent);
    expect(ctx.values["demande.agent_nom"]).toBe("");
    expect(ctx.values["demande.agent_courriel"]).toBe("");
  });

  it("toute variable du catalogue existe dans le contexte, même vide", () => {
    const ctx = buildMergeContext(input);
    expect(ctx.values["demande.date_cloture"]).toBe("");
    expect(ctx.values["organisme.couleur_principale"]).toBe("#1b7a4b");
    expect(Object.hasOwn(ctx.values, "usager.batiment")).toBe(true);
  });
});

describe("nom du fichier produit", () => {
  it("dérive du modèle et de la référence, sans accents ni espaces", () => {
    expect(documentFileName("Courrier usager.docx", "DEM-2026-000042", "pdf"))
      .toBe("courrier-usager-DEM-2026-000042.pdf");
    expect(documentFileName("Décision — refus", "DEM-2026-000007", "docx"))
      .toBe("decision-refus-DEM-2026-000007.docx");
  });

  it("un nom vide de toute lettre reste un nom", () => {
    expect(documentFileName("...", "DEM-2026-000001", "pdf")).toBe("document-DEM-2026-000001.pdf");
  });
});
