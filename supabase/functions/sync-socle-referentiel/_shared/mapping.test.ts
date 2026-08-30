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
    {
      id: "p-1",
      organization_id: "root-a",
      category_id: "cat-1",
      name: "Signalement",
      type: "externe",
      status: "production",
      communication_config: {
        visibility: {
          portalVisible: true,
          publicationPeriodEnabled: true,
          publicationStart: "2027-01-01",
          publicationEnd: "2027-05-03",
        },
      },
    },
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

  it("miroite la publication effective de la démarche", () => {
    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    expect(plan.procRows[0]).toMatchObject({
      status: "production",
      portal_visible: true,
      publication_start: "2027-01-01",
      publication_end: "2027-05-03",
    });
  });

  // Une démarche que le Socle n'a jamais paramétrée arrive sans `status` ni
  // `communication_config` : brouillon (fail closed) et défauts du contrat.
  it("démarche non paramétrée : brouillon, portail visible, sans période", () => {
    const brute = [{ id: "p-3", organization_id: "root-a", category_id: null, name: "Brute", type: "externe" }];
    const plan = buildSyncPlan(tenants, orgs, categories, brute);
    expect(plan.procRows[0]).toMatchObject({
      status: "brouillon",
      portal_visible: true,
      publication_start: null,
      publication_end: null,
    });
  });

  // Le cache est l'autorité de périmètre du tenant : il garde les brouillons et
  // les démarches internes, que le sélecteur écartera lui-même.
  it("met en cache brouillons et démarches internes sans les écarter", () => {
    const mixtes = [
      { id: "p-4", organization_id: "root-a", category_id: null, name: "Brouillon", type: "externe", status: "brouillon" },
      { id: "p-5", organization_id: "root-a", category_id: null, name: "Interne", type: "interne", status: "production" },
    ];
    const plan = buildSyncPlan(tenants, orgs, categories, mixtes);
    expect(plan.procRows.map((r) => r.socle_id).sort()).toEqual(["p-4", "p-5"]);
  });

  it("rafraîchit le nom d'affichage du tenant depuis la racine Socle", () => {
    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    expect(plan.tenantNames).toEqual([{ organizationId: "iris-a", name: "ACCM" }]);
    expect(plan.counters).toEqual({ tenants: 1, organizations: 3, procedures: 1 });
  });
});
