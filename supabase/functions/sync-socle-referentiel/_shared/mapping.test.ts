import { describe, expect, it } from "vitest";
import { buildSyncPlan, subtreeOf, type SocleOrg } from "./mapping";

const orgs: SocleOrg[] = [
  { id: "root-a", parent_id: null, name: "ACCM", status: "active" },
  { id: "child-a1", parent_id: "root-a", name: "Mairie", status: "active" },
  { id: "child-a2", parent_id: "child-a1", name: "Service voirie", status: "obsolete" },
  { id: "root-b", parent_id: null, name: "Autre client", status: "active" },
  { id: "child-b1", parent_id: "root-b", name: "Hors périmètre", status: "active" },
];

describe("subtreeOf", () => {
  it("extrait le sous-arbre de la racine, racine incluse, sans les autres clients", () => {
    const ids = subtreeOf("root-a", orgs).map((o) => o.id);
    expect(ids.sort()).toEqual(["child-a1", "child-a2", "root-a"]);
  });

  it("résiste aux cycles et aux racines inconnues", () => {
    const cyclic: SocleOrg[] = [
      { id: "x", parent_id: "y", name: "X", status: "active" },
      { id: "y", parent_id: "x", name: "Y", status: "active" },
    ];
    expect(subtreeOf("x", cyclic).map((o) => o.id).sort()).toEqual(["x", "y"]);
    expect(subtreeOf("inconnue", orgs)).toEqual([]);
  });
});

describe("buildSyncPlan", () => {
  const tenants = [{ organizationId: "iris-a", socleOrgId: "root-a" }];
  const categories = [{ id: "cat-1", name: "Voirie" }];
  const procedures = [
    { id: "p-1", organization_id: "root-a", category_id: "cat-1", name: "Signalement", type: "externe" },
    { id: "p-2", organization_id: "root-b", category_id: null, name: "Autre client", type: null },
  ];

  it("ne miroite que le sous-arbre du tenant et neutralise le parent de la racine", () => {
    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    expect(plan.orgRows.map((r) => r.socle_id).sort()).toEqual(["child-a1", "child-a2", "root-a"]);
    const root = plan.orgRows.find((r) => r.socle_id === "root-a")!;
    expect(root.socle_parent_id).toBeNull();
    expect(plan.orgRows.find((r) => r.socle_id === "child-a2")!.status).toBe("obsolete");
  });

  it("ne met en cache que les démarches de la racine du tenant, avec la catégorie résolue", () => {
    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    expect(plan.procRows).toHaveLength(1);
    expect(plan.procRows[0]).toMatchObject({
      socle_id: "p-1",
      organization_id: "iris-a",
      category_name: "Voirie",
    });
  });

  it("rafraîchit le nom d'affichage du tenant depuis la racine Socle", () => {
    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    expect(plan.tenantNames).toEqual([{ organizationId: "iris-a", name: "ACCM" }]);
    expect(plan.counters).toEqual({ tenants: 1, organizations: 3, procedures: 1 });
  });
});
