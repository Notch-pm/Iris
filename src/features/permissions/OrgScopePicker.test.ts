import { describe, expect, it } from "vitest";
import { buildSocleOrgTree } from "@/features/superadmin/socleOrgTree";
import { coveredOrganizationIds, filterOrgNodes } from "./OrgScopePicker";

const ROWS = [
  { socle_id: "root", socle_parent_id: null, name: "Mairie", status: "active", obsoleted_at: null },
  { socle_id: "voirie", socle_parent_id: "root", name: "Voirie", status: "active", obsoleted_at: null },
  { socle_id: "ccas", socle_parent_id: "root", name: "CCAS", status: "active", obsoleted_at: null },
  { socle_id: "voirie-nord", socle_parent_id: "voirie", name: "Voirie Nord", status: "active", obsoleted_at: null },
];

describe("filterOrgNodes — I8", () => {
  it("chaîne vide : retourne l'arbre intact", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(filterOrgNodes(tree, "")).toEqual(tree);
  });

  it("conserve les ancêtres d'un descendant qui correspond, sans les frères non concernés", () => {
    const tree = buildSocleOrgTree(ROWS);
    const filtered = filterOrgNodes(tree, "nord");
    expect(filtered.map((n) => n.name)).toEqual(["Mairie"]);
    expect(filtered[0].children.map((n) => n.name)).toEqual(["Voirie"]);
    expect(filtered[0].children[0].children.map((n) => n.name)).toEqual(["Voirie Nord"]);
  });

  it("insensible à la casse ; aucune correspondance ⇒ arbre vide", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(filterOrgNodes(tree, "VOIRIE").map((n) => n.name)).toEqual(["Mairie"]);
    expect(filterOrgNodes(tree, "inconnue")).toEqual([]);
  });
});

describe("coveredOrganizationIds — I8 (compteur « Ce périmètre couvrira N organisations »)", () => {
  it("un nœud coché couvre tout son sous-arbre, même si la recherche le masque", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(coveredOrganizationIds(tree, ["voirie"])).toEqual(new Set(["voirie", "voirie-nord"]));
  });

  it("cocher la racine couvre tout le tenant", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(coveredOrganizationIds(tree, ["root"])).toEqual(
      new Set(["root", "voirie", "voirie-nord", "ccas"]),
    );
  });

  it("aucune sélection ⇒ aucune couverture", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(coveredOrganizationIds(tree, [])).toEqual(new Set());
  });

  it("deux sélections indépendantes s'additionnent sans doublon", () => {
    const tree = buildSocleOrgTree(ROWS);
    expect(coveredOrganizationIds(tree, ["voirie", "ccas"])).toEqual(
      new Set(["voirie", "voirie-nord", "ccas"]),
    );
  });
});
