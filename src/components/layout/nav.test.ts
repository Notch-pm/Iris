import { describe, expect, it } from "vitest";
import { isNavRouteActive, type NavRoute } from "./nav";

const ACCUEIL: NavRoute = { to: "/", end: true };
const TABLEAU: NavRoute = { to: "/demandes/tableau", end: false };
const DEMANDES: NavRoute = { to: "/demandes", end: false, except: ["/demandes/tableau"] };
const CARTE: NavRoute = { to: "/carte", end: false };

describe("isNavRouteActive", () => {
  it("n'allume l'accueil que sur l'accueil", () => {
    expect(isNavRouteActive(ACCUEIL, "/")).toBe(true);
    expect(isNavRouteActive(ACCUEIL, "/demandes")).toBe(false);
  });

  it("allume une entrée sur tout son sous-arbre d'URL", () => {
    expect(isNavRouteActive(DEMANDES, "/demandes")).toBe(true);
    expect(isNavRouteActive(DEMANDES, "/demandes/nouvelle")).toBe(true);
    expect(isNavRouteActive(DEMANDES, "/demandes/4c2847de-20ba-4d8f-9b7c-0e853de2193c")).toBe(true);
  });

  it("n'allume QU'UNE entrée là où deux se partagent un préfixe", () => {
    expect(isNavRouteActive(TABLEAU, "/demandes/tableau")).toBe(true);
    expect(isNavRouteActive(DEMANDES, "/demandes/tableau")).toBe(false);
  });

  it("laisse le sous-arbre de l'entrée dédiée à celle-ci", () => {
    expect(isNavRouteActive(TABLEAU, "/demandes/tableau/quelque-chose")).toBe(true);
    expect(isNavRouteActive(DEMANDES, "/demandes/tableau/quelque-chose")).toBe(false);
  });

  it("ne confond pas un préfixe de segment avec un segment", () => {
    // « /demandes-archivees » n'est pas sous « /demandes ».
    expect(isNavRouteActive(DEMANDES, "/demandes-archivees")).toBe(false);
    expect(isNavRouteActive(CARTE, "/cartes")).toBe(false);
  });
});
