// Snapshots construits CÔTÉ SERVEUR — jamais acceptés d'un navigateur.
// Whitelists strictes, tolérantes aux champs Socle inconnus (ignorés).
// Logique pure, testée par vitest.

export interface ProcedureSnapshot {
  id: string;
  name: string;
  type: string | null;
  category_id: string | null;
  form_schema: unknown;
  requester_config: unknown;
}

/** Whitelist du snapshot de démarche depuis GET /v1/procedures/{id} Socle. */
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

// `contactIdentitySnapshot` a DÉMÉNAGÉ le 2026-08-26 vers
// `../../_shared/identity/declared.ts` : `requests-api` en a besoin à son tour,
// et une fonction n'importe pas le module privé d'une autre.
