// Snapshot de démarche — construit CÔTÉ SERVEUR, jamais accepté d'un payload.
// Whitelist stricte sur la réponse Socle (tolérante aux champs inconnus :
// tout ce qui n'est pas listé est ignoré). Logique pure, testée par vitest.

export interface ProcedureSnapshot {
  id: string;
  name: string;
  type: string | null;
  category_id: string | null;
  form_schema: unknown;
  requester_config: unknown;
  /** true = Socle injoignable au dépôt : snapshot minimal issu du cache. */
  degraded?: true;
}

/** Whitelist du snapshot depuis une réponse Socle GET /v1/procedures/{id}. */
// deno-lint-ignore no-explicit-any
export function whitelistProcedureSnapshot(raw: any): ProcedureSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    id: raw.id,
    name: raw.name,
    type: typeof raw.type === "string" ? raw.type : null,
    category_id: typeof raw.category_id === "string" ? raw.category_id : null,
    form_schema: raw.form_schema ?? null,
    requester_config: raw.requester_config ?? null,
  };
}

export interface ProcedureCacheRow {
  socle_id: string;
  name: string;
  type: string | null;
  category_socle_id: string | null;
}

/**
 * Snapshot dégradé depuis le cache léger quand Socle est injoignable :
 * la demande n'est jamais refusée pour un référentiel indisponible (AC-I10),
 * mais l'anomalie `referentiel_indisponible` est posée par l'appelant.
 */
export function degradedProcedureSnapshot(cache: ProcedureCacheRow): ProcedureSnapshot {
  return {
    id: cache.socle_id,
    name: cache.name,
    type: cache.type,
    category_id: cache.category_socle_id,
    form_schema: null,
    requester_config: null,
    degraded: true,
  };
}
