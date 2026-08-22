import { describe, expect, it } from "vitest";
import type { FormSchema } from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  attachmentStats,
  creationProgress,
  destinationMissing,
  fileCountsFrom,
  missingRequiredFields,
} from "./fiche";

const SCHEMA: FormSchema = {
  version: 1,
  content: [
    { id: "f-nom", key: "nom", label: "Nom", type: "text", required: true },
    { id: "f-animaux", key: "animaux", label: "Animaux", type: "boolean" },
    {
      id: "f-consignes", key: "consignes", label: "Consignes", type: "textarea", required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-animaux", operator: "equals", value: "true" }] },
    },
    {
      id: "s1", kind: "section", title: "Pièces", fields: [
        { id: "f-pj", key: "pj", label: "Justificatif", type: "attachment", maxFiles: 1, acceptedFormats: ["pdf"], required: true },
        { id: "f-cni", key: "cni", label: "CNI", type: "attachment", maxFiles: 1, acceptedFormats: [] },
      ],
    },
  ],
};

describe("missingRequiredFields", () => {
  it("ignore les champs masqués par leur condition", () => {
    const missing = missingRequiredFields(SCHEMA, {}, {});
    expect(missing.map((m) => m.field.id)).toEqual(["f-nom", "f-pj"]);
  });

  it("prend en compte un champ conditionnel devenu visible", () => {
    const missing = missingRequiredFields(SCHEMA, { "f-nom": "Durand", "f-animaux": true }, { "f-pj": 1 });
    expect(missing.map((m) => m.field.id)).toEqual(["f-consignes"]);
  });

  it("sans schéma : rien ne manque", () => {
    expect(missingRequiredFields(null, {}, {})).toEqual([]);
  });
});

describe("attachmentStats", () => {
  it("compte les pièces fournies sur les pièces visibles", () => {
    expect(attachmentStats(SCHEMA, {}, { "f-cni": 2 })).toEqual({ provided: 1, total: 2 });
  });
});

describe("creationProgress", () => {
  it("paliers sans démarche, avec démarche, avec usager", () => {
    const base = { schema: null, values: {}, fileCounts: {}, subjectFilled: false };
    expect(creationProgress({ ...base, hasProcedure: false, hasRequester: false })).toBe(6);
    expect(creationProgress({ ...base, hasProcedure: true, hasRequester: false })).toBe(12);
    expect(creationProgress({ ...base, hasProcedure: true, hasRequester: true })).toBe(24);
  });

  it("atteint 100 quand tous les champs actifs et l'objet sont renseignés", () => {
    expect(creationProgress({
      hasProcedure: true, hasRequester: true, subjectFilled: true, schema: SCHEMA,
      values: { "f-nom": "Durand", "f-animaux": false },
      fileCounts: { "f-pj": 1, "f-cni": 1 },
    })).toBe(100);
  });

  it("progresse au prorata des champs renseignés", () => {
    const pct = creationProgress({
      hasProcedure: true, hasRequester: true, subjectFilled: true, schema: SCHEMA,
      values: { "f-nom": "Durand" }, fileCounts: {},
    });
    // 4 champs actifs + objet = 5 ; 2 renseignés → 24 + 76 * 2/5
    expect(pct).toBe(54);
  });
});

describe("fileCountsFrom", () => {
  it("réduit des listes de fichiers à leurs effectifs", () => {
    expect(fileCountsFrom({ a: [{ length: 0 }, { length: 0 }], b: [] })).toEqual({ a: 2, b: 0 });
  });
});

describe("destinationMissing — RM-29/RM-59", () => {
  it("vide ou blanc : manquant", () => {
    expect(destinationMissing("")).toBe(true);
    expect(destinationMissing("   ")).toBe(true);
  });

  it("renseigné : présent", () => {
    expect(destinationMissing("22222222-2222-2222-2222-222222222222")).toBe(false);
  });
});
