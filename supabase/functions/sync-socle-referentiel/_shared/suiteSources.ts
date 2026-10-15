// Sources des applications de la gamme, ouvertes d'après les abonnements du
// Socle. Logique pure, testée par vitest.
//
// Le Socle dit, pour chaque organisation, les applications souscrites par sa
// collectivité (`applications`, public-api 1.42.0). Une collectivité abonnée à
// Iris ET à Clara reçoit d'office une source `clara` active : Clara dépose
// alors ses demandes avec sa clé PLATEFORME et l'en-tête
// `X-Socle-Root-Organization-Id`, sans aucune clé par collectivité. Décocher
// Clara dans le Socle suspend la source à la synchronisation suivante.
//
// Prudence : un Socle antérieur à 1.42.0 ne sert pas `applications` — on ne
// touche alors à RIEN (une absence de champ n'est pas un désabonnement).

import type { SocleOrg, TenantRef } from "./mapping.ts";

/** Code de source de Clara (gestion du courrier). */
export const CLARA_SOURCE_CODE = "clara";
export const CLARA_SOURCE_NAME = "Clara — gestion du courrier";

export interface SuiteSourceTarget {
  organizationId: string;
  /** `true` = la source doit être active ; `false` = suspendue (si elle existe). */
  active: boolean;
}

export function planClaraSources(
  tenants: TenantRef[],
  orgs: Array<SocleOrg & { applications?: unknown }>,
): SuiteSourceTarget[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const out: SuiteSourceTarget[] = [];
  for (const t of tenants) {
    const root = byId.get(t.socleOrgId);
    if (!root || !Array.isArray(root.applications)) continue;
    out.push({ organizationId: t.organizationId, active: root.applications.includes(CLARA_SOURCE_CODE) });
  }
  return out;
}

export interface ExistingSource {
  id: string;
  organization_id: string;
  status: string;
}

/** Écritures à faire pour atteindre la cible, sans toucher à ce qui y est déjà. */
export function diffClaraSources(
  targets: SuiteSourceTarget[],
  existing: ExistingSource[],
): { toCreate: string[]; toActivate: string[]; toSuspend: string[] } {
  const byOrg = new Map(existing.map((s) => [s.organization_id, s]));
  const toCreate: string[] = [];
  const toActivate: string[] = [];
  const toSuspend: string[] = [];
  for (const t of targets) {
    const current = byOrg.get(t.organizationId);
    if (t.active) {
      if (!current) toCreate.push(t.organizationId);
      else if (current.status !== "active") toActivate.push(current.id);
    } else if (current && current.status === "active") {
      toSuspend.push(current.id);
    }
  }
  return { toCreate, toActivate, toSuspend };
}
