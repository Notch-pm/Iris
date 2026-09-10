import { describe, expect, it } from "vitest";
import { isNavRouteActive } from "../nav";
import { mobileNavItems } from "./mobileNav";

describe("mobileNavItems", () => {
  it("un intervenant qui peut créer voit les quatre onglets, Interventions en tête", () => {
    expect(mobileNavItems({ isIntervenant: true, canCreate: true }).map((i) => i.key))
      .toEqual(["interventions", "demandes", "nouvelle", "compte"]);
  });

  it("un agent sans création n'a que Demandes et Compte", () => {
    expect(mobileNavItems({ isIntervenant: false, canCreate: false }).map((i) => i.key))
      .toEqual(["demandes", "compte"]);
  });

  it("« Demandes » ne s'allume pas sur « Nouvelle », et une fiche allume « Demandes »", () => {
    const items = mobileNavItems({ isIntervenant: true, canCreate: true });
    const demandes = items.find((i) => i.key === "demandes")!;
    const nouvelle = items.find((i) => i.key === "nouvelle")!;
    expect(isNavRouteActive(demandes, "/demandes/nouvelle")).toBe(false);
    expect(isNavRouteActive(nouvelle, "/demandes/nouvelle")).toBe(true);
    expect(isNavRouteActive(demandes, "/demandes/abc")).toBe(true);
    expect(isNavRouteActive(nouvelle, "/demandes/abc")).toBe(false);
  });
});
