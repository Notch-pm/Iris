import { describe, expect, it } from "vitest";
import { buildSocleOrgTree, collectIds } from "./socleOrgTree";

const rows = [
  { socle_id: "root", socle_parent_id: null, name: "ACCM", status: "active", obsoleted_at: null },
  { socle_id: "b", socle_parent_id: "root", name: "Saint Martin", status: "active", obsoleted_at: null },
  { socle_id: "a", socle_parent_id: "root", name: "Arles", status: "active", obsoleted_at: null },
  { socle_id: "b1", socle_parent_id: "b", name: "État civil", status: "obsolete", obsoleted_at: null },
  { socle_id: "orphelin", socle_parent_id: "inconnu", name: "Orphelin", status: "active", obsoleted_at: null },
];

describe("buildSocleOrgTree", () => {
  it("construit la hiérarchie triée (fr) et remonte les orphelins en racine", () => {
    const tree = buildSocleOrgTree(rows);
    expect(tree.map((n) => n.name)).toEqual(["ACCM", "Orphelin"]);
    const accm = tree[0];
    expect(accm.children.map((n) => n.name)).toEqual(["Arles", "Saint Martin"]);
    expect(accm.children[1].children[0].name).toBe("État civil");
  });

  it("collectIds parcourt tout l'arbre", () => {
    expect(collectIds(buildSocleOrgTree(rows)).sort()).toEqual(["a", "b", "b1", "orphelin", "root"]);
  });
});
