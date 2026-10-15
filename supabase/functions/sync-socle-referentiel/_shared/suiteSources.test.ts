import { describe, expect, it } from "vitest";

import { diffClaraSources, planClaraSources } from "./suiteSources.ts";
import type { TenantRef } from "./mapping.ts";

const A: TenantRef = { organizationId: "tenant-a", socleOrgId: "root-a" };
const B: TenantRef = { organizationId: "tenant-b", socleOrgId: "root-b" };
const C: TenantRef = { organizationId: "tenant-c", socleOrgId: "root-c" };

const org = (id: string, applications?: unknown) => ({ id, parent_id: null, name: id, status: "active", applications });

describe("planClaraSources", () => {
  it("source active si la collectivité a souscrit Clara, suspendue sinon", () => {
    const plan = planClaraSources([A, B], [org("root-a", ["clara", "iris"]), org("root-b", ["iris"])]);
    expect(plan).toEqual([
      { organizationId: "tenant-a", active: true },
      { organizationId: "tenant-b", active: false },
    ]);
  });

  it("Socle antérieur à 1.42.0 (champ absent) ou racine invisible : on ne touche à rien", () => {
    expect(planClaraSources([A, C], [org("root-a")])).toEqual([]);
  });
});

describe("diffClaraSources", () => {
  it("crée, réactive, suspend — et laisse en paix ce qui est déjà juste", () => {
    const diff = diffClaraSources(
      [
        { organizationId: "tenant-a", active: true },   // absente → créée
        { organizationId: "tenant-b", active: true },   // suspendue → réactivée
        { organizationId: "tenant-c", active: false },  // active → suspendue
        { organizationId: "tenant-d", active: true },   // déjà active
        { organizationId: "tenant-e", active: false },  // absente → rien
      ],
      [
        { id: "s-b", organization_id: "tenant-b", status: "suspended" },
        { id: "s-c", organization_id: "tenant-c", status: "active" },
        { id: "s-d", organization_id: "tenant-d", status: "active" },
      ],
    );
    expect(diff).toEqual({ toCreate: ["tenant-a"], toActivate: ["s-b"], toSuspend: ["s-c"] });
  });
});
