// Correspondance référentiel Socle → miroir Iris. Logique pure, testée par
// vitest. Un tenant Iris = une racine Socle ; on n'extrait que SON sous-arbre.
//
// Le cache des démarches retient aussi, depuis le 2026-08-30, la PUBLICATION :
// statut du paramétrage (brouillon/production) et publication effective
// (portail, période). L'interprétation du contrat Socle — défauts quand rien
// n'est paramétré, dates conservées mais inappliquées quand le commutateur de
// période est éteint — se fait ICI, une fois, via le module pur
// `_shared/procedures/publication.ts`.

import {
  parseProcedureStatus,
  parsePublication,
  type ProcedureStatus,
} from "../../_shared/procedures/publication.ts";

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
  /** `brouillon` | `production` — cycle de vie du paramétrage côté Socle. */
  status?: unknown;
  /** Bloc de communication possédé par le Socle (dont `visibility`). */
  communication_config?: unknown;
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
  status: ProcedureStatus;
  /** Publication EFFECTIVE (défauts du contrat déjà appliqués). */
  portal_visible: boolean;
  publication_start: string | null;
  publication_end: string | null;
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

/**
 * Activation d'une démarche pour UNE organisation, telle que le Socle la rend.
 *
 * ⚠️ Le DTO `Procedure` de l'API publique n'expose PAS qui a activé quoi : la
 * seule lecture possible est le FILTRE `GET /v1/procedures?enabled_for=<org>`,
 * organisation par organisation (il n'est pas récursif). D'où cette forme —
 * un relevé par organisation interrogée — plutôt qu'un champ de la démarche.
 * Le jour où le Socle branchera `GET /v1/organization-procedures` (sérialiseur
 * déjà écrit, route absente), c'est cette structure-ci qu'il remplira en un
 * seul appel, et rien d'autre ne bougera.
 */
export interface OrgActivation {
  socleOrgId: string;
  /** Démarches rendues par `?enabled_for=` — donc `is_enabled = true`, opt-in strict. */
  procedureIds: string[];
}

export interface ProcOrgRow {
  organization_id: string;    // tenant Iris
  socle_procedure_id: string;
  socle_org_id: string;
}

/**
 * Miroir des activations : une ligne par couple (organisation, démarche)
 * réellement proposé.
 *
 * Croisé avec le cache du tenant (`procRows`) — une activation qui désignerait
 * une démarche hors cache n'aurait aucun sens ici : la garde `t16` la
 * refuserait de toute façon à l'insertion d'une demande, et la ligne resterait
 * à pourrir dans le miroir. Croisé aussi avec le miroir d'organisations, qui
 * dit à quel TENANT appartient chaque organisation : les identifiants Socle ne
 * la portent pas.
 */
export function buildActivationRows(
  orgRows: readonly OrgMirrorRow[],
  procRows: readonly ProcCacheRow[],
  activations: readonly OrgActivation[],
): ProcOrgRow[] {
  const tenantOfOrg = new Map(orgRows.map((o) => [o.socle_id, o.organization_id]));
  const cacheOfTenant = new Map<string, Set<string>>();
  for (const proc of procRows) {
    const set = cacheOfTenant.get(proc.organization_id) ?? new Set<string>();
    set.add(proc.socle_id);
    cacheOfTenant.set(proc.organization_id, set);
  }

  const out: ProcOrgRow[] = [];
  const seen = new Set<string>();
  for (const activation of activations) {
    const tenantId = tenantOfOrg.get(activation.socleOrgId);
    if (!tenantId) continue;                       // organisation hors périmètre miroité
    const cache = cacheOfTenant.get(tenantId);
    for (const procedureId of activation.procedureIds) {
      if (!cache?.has(procedureId)) continue;      // démarche hors cache du tenant
      const key = `${tenantId}|${procedureId}|${activation.socleOrgId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        organization_id: tenantId,
        socle_procedure_id: procedureId,
        socle_org_id: activation.socleOrgId,
      });
    }
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
      // Le cache miroite TOUTES les démarches de la racine, brouillons et
      // démarches internes comprises : c'est l'autorité de périmètre du tenant
      // (ingestion, droits, libellés des demandes déjà déposées). C'est le
      // SÉLECTEUR de démarche qui décide ensuite ce qu'il propose.
      const publication = parsePublication(proc.communication_config);
      procRows.push({
        socle_id: proc.id,
        organization_id: tenant.organizationId,
        socle_root_org_id: proc.organization_id,
        name: proc.name,
        category_socle_id: proc.category_id,
        category_name: proc.category_id ? (categoryNames.get(proc.category_id) ?? null) : null,
        type: proc.type,
        status: parseProcedureStatus(proc.status),
        portal_visible: publication.portalVisible,
        publication_start: publication.publicationStart,
        publication_end: publication.publicationEnd,
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
