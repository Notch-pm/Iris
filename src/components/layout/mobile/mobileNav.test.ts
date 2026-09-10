import { describe, expect, it } from "vitest";
import { isNavRouteActive } from "../nav";
import { mobileNavItems } from "./mobileNav";

describe("mobileNavItems", () => {
  it("un intervenant qui peut créer a tout : Demandes, Interventions, Créer au centre, Moi", () => {
    expect(mobileNavItems({ isIntervenant: true, canCreate: true }).map((i) => i.key))
      .toEqual(["demandes", "interventions", "creer", "moi"]);
  });

  it("un agent sans création ni intervention n'a que Demandes et Moi", () => {
    expect(mobileNavItems({ isIntervenant: false, canCreate: false }).map((i) => i.key))
      .toEqual(["demandes", "moi"]);
  });

  it("« Moi » n'est pas une route : il ouvre la feuille du compte sur place", () => {
    const moi = mobileNavItems({ isIntervenant: false, canCreate: false }).find((i) => i.key === "moi")!;
    expect(moi.kind).toBe("account");
    expect("route" in moi).toBe(false);
  });

  it("« Demandes » ne s'allume pas sur « Créer », et une fiche allume « Demandes »", () => {
    const items = mobileNavItems({ isIntervenant: true, canCreate: true });
    const demandes = items.find((i) => i.key === "demandes")!;
    const creer = items.find((i) => i.key === "creer")!;
    if (!("route" in demandes) || !("route" in creer)) throw new Error("route attendue");
    expect(isNavRouteActive(demandes.route, "/demandes/nouvelle")).toBe(false);
    expect(isNavRouteActive(creer.route, "/demandes/nouvelle")).toBe(true);
    expect(isNavRouteActive(demandes.route, "/demandes/abc")).toBe(true);
    expect(isNavRouteActive(creer.route, "/demandes/abc")).toBe(false);
  });
});
