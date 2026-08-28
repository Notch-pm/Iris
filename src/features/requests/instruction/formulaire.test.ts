import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  attachmentFieldIds,
  changedAnswerKeys,
  initialAnswerValues,
  validateAnswers,
} from "./formulaire";

const schema = parseFormSchema({
  version: 1,
  content: [
    { id: "f-prenom", key: "prenom", label: "Prénom de l'enfant", type: "text", required: true },
    { id: "f-date", key: "date_naissance", label: "Date de naissance", type: "date", required: true },
    { id: "f-type", key: "type_demandeur", label: "Type", type: "radio",
      options: [{ value: "pro", label: "Pro" }, { value: "part", label: "Particulier" }] },
    { id: "f-siret", key: "siret", label: "SIRET", type: "text", required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-type", operator: "equals", value: "pro" }] } },
    { id: "f-dom", key: "justificatif_domicile", label: "Justificatif de domicile",
      type: "attachment", required: true },
  ],
});

// Le builder Socle laisse parfois la clé machine vide : `form_data` est alors
// indexé par l'id (cas constaté en production sur les démarches ACCM).
const schemaSansCle = parseFormSchema({
  version: 1,
  content: [{ id: "f-1", key: "", label: "Prénom", type: "text" }],
});

describe("initialAnswerValues", () => {
  it("fait le pont clé machine → id de champ", () => {
    expect(initialAnswerValues(schema, { prenom: "Camille", date_naissance: "2015-07-26" }))
      .toEqual({
        "f-prenom": "Camille",
        "f-date": "2015-07-26",
        "f-type": undefined,
        "f-siret": undefined,
        "f-dom": undefined,
      });
  });

  it("retombe sur l'id quand la clé machine est vide", () => {
    expect(initialAnswerValues(schemaSansCle, { "f-1": "Camille" })).toEqual({ "f-1": "Camille" });
  });

  it("tient sans form_data", () => {
    expect(initialAnswerValues(schemaSansCle, null)).toEqual({ "f-1": undefined });
  });
});

describe("attachmentFieldIds", () => {
  it("ne retient que les champs « pièce »", () => {
    expect([...attachmentFieldIds(schema)]).toEqual(["f-dom"]);
  });
});

describe("validateAnswers", () => {
  const complete = { "f-prenom": "Camille", "f-date": "2015-07-26", "f-type": "part" };

  it("accepte des réponses complètes et rend le form_data normalisé", () => {
    const result = validateAnswers(schema, complete, []);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.formData).toEqual({
      prenom: "Camille", date_naissance: "2015-07-26", type_demandeur: "part",
    });
  });

  it("N'ÉCHOUE PAS sur une pièce obligatoire absente — ce n'est pas l'affaire de cet écran", () => {
    // Aucune déclaration de pièce : à la création, ce serait un refus.
    const result = validateAnswers(schema, complete, []);
    expect(result.ok).toBe(true);
    expect(result.errors["f-dom"]).toBeUndefined();
  });

  it("écarte aussi l'erreur globale « pièce inattendue »", () => {
    const result = validateAnswers(schema, complete, [
      { form_field_key: "cle_disparue", file_name: "x.pdf", storage_path: "o/r/x.pdf" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.errors["_attachments"]).toBeUndefined();
  });

  it("refuse en revanche un champ obligatoire vide", () => {
    const result = validateAnswers(schema, { ...complete, "f-prenom": "" }, []);
    expect(result.ok).toBe(false);
    expect(result.errors["f-prenom"]).toBe("Champ obligatoire.");
  });

  it("refuse une date mal formée", () => {
    const result = validateAnswers(schema, { ...complete, "f-date": "26/07/2015" }, []);
    expect(result.ok).toBe(false);
    expect(result.errors["f-date"]).toBe("Date attendue (AAAA-MM-JJ).");
  });

  it("rejoue les conditions : le SIRET n'est exigé que pour un professionnel", () => {
    expect(validateAnswers(schema, complete, []).ok).toBe(true);
    const pro = validateAnswers(schema, { ...complete, "f-type": "pro" }, []);
    expect(pro.ok).toBe(false);
    expect(pro.errors["f-siret"]).toBe("Champ obligatoire.");
  });

  it("exclut du form_data les réponses d'un champ devenu invisible", () => {
    const result = validateAnswers(schema, { ...complete, "f-siret": "12345678900011" }, []);
    expect(result.formData.siret).toBeUndefined();
  });
});

describe("changedAnswerKeys", () => {
  it("relève les ajouts, les retraits et les modifications, triés", () => {
    expect(changedAnswerKeys(
      { prenom: "Camille", ville: "Nantes" },
      { prenom: "Camille Rose", code: "44000" },
    )).toEqual(["code", "prenom", "ville"]);
  });

  it("ne relève rien quand rien ne bouge, tableaux et objets compris", () => {
    expect(changedAnswerKeys(
      { a: "x", b: ["1", "2"], c: { d: 1 } },
      { a: "x", b: ["1", "2"], c: { d: 1 } },
    )).toEqual([]);
  });

  it("voit un tableau réordonné — l'ordre d'un choix multiple est une réponse", () => {
    expect(changedAnswerKeys({ b: ["1", "2"] }, { b: ["2", "1"] })).toEqual(["b"]);
  });

  it("tient sans état antérieur", () => {
    expect(changedAnswerKeys(null, { a: "x" })).toEqual(["a"]);
  });
});
