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

/**
 * Identité retenue au dépôt pour un usager RAPPROCHÉ : relue depuis la fiche
 * Socle (vérité référentiel au moment T), whitelist stricte — internal_notes,
 * consentements, relations… n'existent pas ici par construction.
 */
const CONTACT_IDENTITY_KEYS = [
  "display_name", "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone",
  "address_line1", "postal_code", "city",
] as const;

// deno-lint-ignore no-explicit-any
export function contactIdentitySnapshot(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of CONTACT_IDENTITY_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}
