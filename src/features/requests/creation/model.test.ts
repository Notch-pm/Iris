import { describe, expect, it } from "vitest";
import { optionValueFor, reachableSteps } from "./model";
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

// Atteignabilité des puces du stepper (2026-08-31) : « quand le bouton
// Continuer s'active, la puce suivante s'active aussi ».
describe("reachableSteps", () => {
  const AVEC_ORGANISME = [0, 1, 2, 3, 4];
  const SANS_ORGANISME = [1, 2, 3, 4];

  it("sans franchissement possible : uniquement ce qui a été atteint", () => {
    expect(reachableSteps(SANS_ORGANISME, 2, 2, false)).toEqual(new Set([1, 2]));
  });

  it("ouvre la SUIVANTE quand l'étape courante est franchissable", () => {
    expect(reachableSteps(SANS_ORGANISME, 2, 2, true)).toEqual(new Set([1, 2, 3]));
  });

  it("n'ouvre QUE la suivante — jamais deux d'un coup", () => {
    expect(reachableSteps(SANS_ORGANISME, 1, 1, true)).toEqual(new Set([1, 2]));
    expect(reachableSteps(SANS_ORGANISME, 1, 1, true).has(3)).toBe(false);
  });

  it("le voisinage est POSITIONNEL : depuis l'étape 0, la suivante est 1", () => {
    expect(reachableSteps(AVEC_ORGANISME, 0, 0, true)).toEqual(new Set([0, 1]));
  });

  it("revenir en arrière n'referme rien : maxReached fait foi", () => {
    // L'agent est revenu à l'étape 1 après avoir atteint la 3.
    expect(reachableSteps(SANS_ORGANISME, 1, 3, true)).toEqual(new Set([1, 2, 3]));
  });

  it("la dernière étape n'a pas de suivante à ouvrir", () => {
    expect(reachableSteps(SANS_ORGANISME, 4, 4, true)).toEqual(new Set([1, 2, 3, 4]));
  });

  it("une étape courante hors du tableau n'ouvre rien (écran de confirmation)", () => {
    expect(reachableSteps(SANS_ORGANISME, 5, 0, true)).toEqual(new Set());
  });
});
