// Agents gérés par le Socle — logique pure de `sync-socle-users` (Iris).
//
// Le Socle OUVRE l'accès à Iris (`GET /v1/users`, public-api 1.43.0) ; il ne
// donne aucun rôle (décision du 2026-10-30) : ce qu'un agent voit et fait vient
// de ses profils de droits, attribués dans Iris. D'où, par tenant :
//   - accès ouvert ⇒ appartenance (`organization_members`), sans profil ;
//   - accès retiré ⇒ le compte est BANNI s'il n'a plus d'accès nulle part —
//     appartenance et profils conservés (retirer le membre emporterait ses
//     attributions en cascade) ; s'il garde un accès dans un AUTRE tenant,
//     on ne peut pas le bannir : il quitte alors ce tenant-ci ;
//   - l'admin plateforme n'est jamais touché.
//
// Pur, sans Deno : testé par vitest (logic.test.ts).

export interface SocleAgentAccess {
  organization_id: string;
  is_active: boolean;
}

export interface SocleAgent {
  socle_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: "active" | "suspended";
  /** Statut actif ET au moins un accès actif — calculé par le Socle. */
  is_active: boolean;
  accesses: SocleAgentAccess[];
}

/** Lecture tolérante d'une réponse `GET /v1/users` : un agent mal formé est écarté. */
export function readSocleAgents(body: unknown): { agents: SocleAgent[]; asOf: string | null } {
  const raw = body as { agents?: unknown; as_of?: unknown } | null;
  const asOf = typeof raw?.as_of === "string" ? raw.as_of : null;
  if (!Array.isArray(raw?.agents)) return { agents: [], asOf };
  const agents: SocleAgent[] = [];
  for (const item of raw.agents as Array<Record<string, unknown>>) {
    if (typeof item?.socle_user_id !== "string" || typeof item.email !== "string" || item.email === "") continue;
    const accesses = Array.isArray(item.accesses)
      ? (item.accesses as Array<Record<string, unknown>>)
        .filter((a) => typeof a?.organization_id === "string")
        .map((a) => ({ organization_id: a.organization_id as string, is_active: a.is_active === true }))
      : [];
    agents.push({
      socle_user_id: item.socle_user_id,
      email: item.email.toLowerCase(),
      first_name: typeof item.first_name === "string" ? item.first_name : null,
      last_name: typeof item.last_name === "string" ? item.last_name : null,
      status: item.status === "suspended" ? "suspended" : "active",
      is_active: item.is_active === true,
      accesses,
    });
  }
  return { agents, asOf };
}

/** L'agent a-t-il accès à CE tenant ? (Le Socle ne sert que les accès du tenant demandé.) */
export function activeInTenant(agent: SocleAgent): boolean {
  return agent.status === "active" && agent.is_active && agent.accesses.some((a) => a.is_active);
}

export interface AccountPlan {
  /** Créer l'appartenance au tenant (sans profil). */
  addMembership: boolean;
  /** Retirer l'appartenance — seulement si l'agent garde un accès ailleurs. */
  removeMembership: boolean;
  /** `true` bannir, `false` lever le bannissement, `null` ne rien faire. */
  ban: boolean | null;
}

/**
 * Ce qu'il faut faire du compte d'un agent pour UN tenant.
 * `activeHere` : accès au tenant traité ; `activeElsewhere` : accès actif à au
 * moins un AUTRE tenant d'Iris (d'après `socle_member_access`).
 */
export function planAccount(input: {
  activeHere: boolean;
  activeElsewhere: boolean;
  hasMembership: boolean;
  isPlatformAdmin: boolean;
}): AccountPlan {
  if (input.isPlatformAdmin) return { addMembership: false, removeMembership: false, ban: null };
  const activeAnywhere = input.activeHere || input.activeElsewhere;
  return {
    addMembership: input.activeHere && !input.hasMembership,
    removeMembership: !input.activeHere && input.hasMembership && input.activeElsewhere,
    ban: !activeAnywhere,
  };
}

/** Réconciliation complète : agents rattachés au tenant absents de la liste complète. */
export function missingFromFullList(managedSocleIds: string[], agents: SocleAgent[]): string[] {
  const present = new Set(agents.map((a) => a.socle_user_id));
  return managedSocleIds.filter((id) => !present.has(id));
}
