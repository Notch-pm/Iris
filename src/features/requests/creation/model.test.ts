import { describe, expect, it } from "vitest";
import { optionValueFor } from "./model";
import type { Field as SchemaField } from "@fn/create-request-from-procedure/_shared/procedureForm";

const BTQ: SchemaField = {
  id: "f2", key: "intervention_btq", label: "BTQ", type: "select",
  options: [
    { value: "bis", label: "Bis" },
    { value: "ter", label: "Ter" },
    { value: "quater", label: "Quater" },
  ],
} as SchemaField;

const TEXTE: SchemaField = { id: "f1", key: "intervention_voie", label: "Voie", type: "text" } as SchemaField;

describe("optionValueFor", () => {
  it("retrouve l'option par sa valeur ou son libellé, sans tenir compte de la casse", () => {
    expect(optionValueFor(BTQ, "bis")).toBe("bis");
    expect(optionValueFor(BTQ, "Bis")).toBe("bis");
    expect(optionValueFor(BTQ, "TER")).toBe("ter");
  });

  it("rend null quand la liste fermée ne sait pas dire ce texte", () => {
    expect(optionValueFor(BTQ, "A")).toBeNull();
    expect(optionValueFor(BTQ, "quinquies")).toBeNull();
  });

  it("accepte le texte tel quel sur un champ libre", () => {
    expect(optionValueFor(TEXTE, "Avenue de Frémeur")).toBe("Avenue de Frémeur");
  });

  it("laisse passer le vide — effacer un champ est légitime", () => {
    expect(optionValueFor(BTQ, "")).toBe("");
    expect(optionValueFor(BTQ, "   ")).toBe("");
  });
});
