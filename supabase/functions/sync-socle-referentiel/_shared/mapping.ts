// Correspondance référentiel Socle → miroir Iris. Logique pure, testée par
// vitest. Un tenant Iris = une racine Socle ; on n'extrait que SON sous-arbre.

export interface SocleOrg {
  id: string;
  parent_id: string | null;
  name: string;
  status: string;
}

export interface SocleCategory {
  id: string;
  name: string;
}

export interface SocleProcedure {
  id: string;
  organization_id: string; // racine Socle propriétaire
  category_id: string | null;
  name: string;
  type: string | null;
}

export interface TenantRef {
  organizationId: string; // organizations.id (Iris)
  socleOrgId: string;     // racine Socle du tenant
}

export interface OrgMirrorRow {
  organization_id: string;
  socle_id: string;
  socle_parent_id: string | null;
  name: string;
  status: string;
}

export interface ProcCacheRow {
  socle_id: string;
  organization_id: string;
  socle_root_org_id: string;
  name: string;
  category_socle_id: string | null;
  category_name: string | null;
  type: string | null;
}

/** Sous-arbre d'une racine (racine incluse), protégé des cycles. */
export function subtreeOf(rootId: string, orgs: SocleOrg[]): SocleOrg[] {
  const byParent = new Map<string, SocleOrg[]>();
  for (const org of orgs) {
    if (org.parent_id) {
      const list = byParent.get(org.parent_id) ?? [];
      list.push(org);
      byParent.set(org.parent_id, list);
    }
  }
  const root = orgs.find((o) => o.id === rootId);
  if (!root) return [];
  const out: SocleOrg[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    for (const child of byParent.get(node.id) ?? []) queue.push(child);
  }
  return out;
}

export interface SyncPlan {
  orgRows: OrgMirrorRow[];
  procRows: ProcCacheRow[];
  /** Rafraîchissement du nom d'affichage des tenants (organizations.name). */
  tenantNames: { organizationId: string; name: string }[];
  counters: Record<string, number>;
}

export function buildSyncPlan(
  tenants: TenantRef[],
  orgs: SocleOrg[],
  categories: SocleCategory[],
  procedures: SocleProcedure[],
): SyncPlan {
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const orgRows: OrgMirrorRow[] = [];
  const procRows: ProcCacheRow[] = [];
  const tenantNames: SyncPlan["tenantNames"] = [];

  for (const tenant of tenants) {
    const subtree = subtreeOf(tenant.socleOrgId, orgs);
    for (const org of subtree) {
      orgRows.push({
        organization_id: tenant.organizationId,
        socle_id: org.id,
        // La racine du tenant est neutralisée à NULL (motif Clara) : son parent
        // éventuel est hors périmètre.
        socle_parent_id: org.id === tenant.socleOrgId ? null : org.parent_id,
        name: org.name,
        status: org.status,
      });
      if (org.id === tenant.socleOrgId) {
        tenantNames.push({ organizationId: tenant.organizationId, name: org.name });
      }
    }
    for (const proc of procedures) {
      if (proc.organization_id !== tenant.socleOrgId) continue;
      procRows.push({
        socle_id: proc.id,
        organization_id: tenant.organizationId,
        socle_root_org_id: proc.organization_id,
        name: proc.name,
        category_socle_id: proc.category_id,
        category_name: proc.category_id ? (categoryNames.get(proc.category_id) ?? null) : null,
        type: proc.type,
      });
    }
  }

  return {
    orgRows,
    procRows,
    tenantNames,
    counters: {
      tenants: tenants.length,
      organizations: orgRows.length,
      procedures: procRows.length,
    },
  };
}
