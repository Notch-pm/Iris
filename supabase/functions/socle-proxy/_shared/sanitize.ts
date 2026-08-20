// Sanitisation des réponses Socle avant transmission au navigateur —
// WHITELIST STRICTE (tolérante aux champs inconnus : tout ce qui n'est pas
// listé est ignoré). internal_notes, consentements et relations ne sont
// JAMAIS transmis. Logique pure, testée par vitest.

// deno-lint-ignore-file no-explicit-any

/** Champs d'une fiche usager transmis aux agents Iris. */
const CONTACT_FIELDS = [
  "id", "contact_type", "status", "display_name",
  "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone", "preferred_channel",
  "address_line1", "address_line2", "postal_code", "city", "country",
] as const;

export function sanitizeContact(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of CONTACT_FIELDS) {
    out[key] = raw[key] ?? null;
  }
  // Quartier résolu (id, name, color) — seul objet imbriqué conservé.
  const q = raw.quartier;
  out.quartier =
    typeof q === "object" && q !== null && typeof q.id === "string"
      ? { id: q.id, name: q.name ?? null, color: q.color ?? null }
      : null;
  return out;
}

export function sanitizeContactList(raw: any): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeContact).filter((c): c is Record<string, unknown> => c !== null);
}

/** Candidats du rapprochement : { contact, score, reasons } — contact sanitizé. */
export function sanitizeMatches(raw: any): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const contact = sanitizeContact(entry.contact);
    if (!contact) continue;
    out.push({
      contact,
      score: typeof entry.score === "number" ? entry.score : 0,
      reasons: Array.isArray(entry.reasons) ? entry.reasons.filter((r: unknown) => typeof r === "string") : [],
    });
  }
  return out;
}

/** Résumé d'une démarche pour les listes/sélecteurs. */
export function sanitizeProcedureSummary(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    organization_id: raw.organization_id ?? null,
    category_id: raw.category_id ?? null,
    name: raw.name ?? null,
    type: raw.type ?? null,
    short_description: raw.short_description ?? null,
    input_duration_minutes: raw.input_duration_minutes ?? null,
  };
}

/**
 * Démarche complète pour le dépôt : + descriptions et formulaire.
 * knowledge_base volontairement exclue (aide agent Socle, hors besoin Iris).
 */
export function sanitizeProcedureFull(raw: any): Record<string, unknown> | null {
  const base = sanitizeProcedureSummary(raw);
  if (!base) return null;
  return {
    ...base,
    user_description: raw.user_description ?? null,
    agent_description: raw.agent_description ?? null,
    form_schema: raw.form_schema ?? null,
    requester_config: raw.requester_config ?? null,
  };
}

/** Clés acceptées à la création d'un usager (ContactCreate Socle, minimisé). */
const CONTACT_CREATE_KEYS = [
  "contact_type", "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone", "preferred_channel",
  "address_line1", "address_line2", "postal_code", "city", "country",
] as const;

/** Filtre le payload de création : clé inconnue → refus explicite. */
export function filterContactCreate(
  raw: any,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "contact : objet attendu." };
  }
  const allowed = new Set<string>(CONTACT_CREATE_KEYS);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { ok: false, message: `contact : clés non autorisées (${unknown.join(", ")}).` };
  }
  if (typeof raw.contact_type !== "string") {
    return { ok: false, message: "contact.contact_type : obligatoire." };
  }
  const payload: Record<string, unknown> = {};
  for (const key of CONTACT_CREATE_KEYS) {
    if (raw[key] !== undefined) payload[key] = raw[key];
  }
  return { ok: true, payload };
}

/** Clés acceptées pour le rapprochement (ContactMatchRequest Socle). */
const MATCH_KEYS = [
  "contact_type", "first_name", "last_name", "usage_name", "legal_name",
  "siret", "birth_date", "email", "phones", "limit",
] as const;

export function filterMatchRequest(
  raw: any,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "identity : objet attendu." };
  }
  const allowed = new Set<string>(MATCH_KEYS);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { ok: false, message: `identity : clés non autorisées (${unknown.join(", ")}).` };
  }
  const payload: Record<string, unknown> = {};
  for (const key of MATCH_KEYS) {
    if (raw[key] !== undefined) payload[key] = raw[key];
  }
  return { ok: true, payload };
}
