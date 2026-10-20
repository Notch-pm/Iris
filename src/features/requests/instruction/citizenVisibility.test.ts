import { describe, expect, it } from "vitest";
import type { RequestRights } from "../statuts";
import { canChangeCitizenVisibility, citizenHiddenBadge, citizenVisibilityView } from "./citizenVisibility";

const rr = (rights: string[], isAdmin = false) =>
  ({ rights: new Set(rights), isAdmin }) as unknown as RequestRights;

describe("citizenVisibilityView", () => {
  it("sans fiche rattachée, la notion ne s'applique pas", () => {
    expect(citizenVisibilityView(null, true)).toBeNull();
    expect(citizenVisibilityView(undefined, false)).toBeNull();
  });

  it("visible : dit l'état et propose de soustraire", () => {
    const v = citizenVisibilityView("c1", true)!;
    expect(v.visible).toBe(true);
    expect(v.statusLabel).toBe("Visible dans l'espace usager de l'usager");
    expect(v.actionLabel).toBe("Soustraire à l'espace usager");
    expect(v.confirmBody).toBe("L'usager ne verra plus cette demande, ni ses messages, dans son espace en ligne.");
  });

  it("soustraite : dit l'état et propose de rendre visible", () => {
    const v = citizenVisibilityView("c1", false)!;
    expect(v.visible).toBe(false);
    expect(v.statusLabel).toBe("Non visible par l'usager sur son portail");
    expect(v.actionLabel).toBe("Rendre visible à l'usager via son portail");
  });

  it("valeur absente = défaut de la base (visible)", () => {
    expect(citizenVisibilityView("c1", undefined)!.visible).toBe(true);
    expect(citizenVisibilityView("c1", null)!.visible).toBe(true);
  });
});

describe("canChangeCitizenVisibility", () => {
  it("exige le droit d'instruction ET une fiche rattachée", () => {
    expect(canChangeCitizenVisibility(rr(["consultation", "instruction"]), "c1")).toBe(true);
    expect(canChangeCitizenVisibility(rr(["consultation", "instruction"]), null)).toBe(false);
  });
  it("ni la consultation, ni la création, ni l'administration seules n'y suffisent", () => {
    expect(canChangeCitizenVisibility(rr(["consultation"]), "c1")).toBe(false);
    expect(canChangeCitizenVisibility(rr(["consultation", "creation"]), "c1")).toBe(false);
    expect(canChangeCitizenVisibility(rr([], true), "c1")).toBe(false);
  });
});

describe("citizenHiddenBadge", () => {
  it("n'écrit que l'exception", () => {
    expect(citizenHiddenBadge(false)).toBe("Non visible par l'usager sur son portail");
    expect(citizenHiddenBadge(true)).toBeNull();
    expect(citizenHiddenBadge(undefined)).toBeNull();
  });
});
