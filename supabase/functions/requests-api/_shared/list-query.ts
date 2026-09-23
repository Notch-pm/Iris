/**
 * Lecture des paramètres de `GET /v1/requests` — logique pure, testée.
 *
 * Par défaut, une intégration ne voit QUE les demandes de sa source. Le scope
 * `requests:read_tenant` lève ce filtre, et seulement quand l'appel nomme un
 * usager (`socle_contact_id`) : c'est la vue « toutes les demandes de cet
 * usager » d'une autre application de la gamme (Clara), jamais une aspiration
 * du tenant entier. Sans usager nommé, le scope ne change rien.
 */

export const READ_TENANT_SCOPE = "requests:read_tenant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ListQuery {
  limit: number;
  updatedSince: string | null;
  socleContactId: string | null;
  /** Vrai : toutes les sources du tenant (scope + usager nommé). */
  allSources: boolean;
}

export type ListQueryResult = { ok: true; value: ListQuery } | { ok: false; message: string };

export function parseListQuery(params: URLSearchParams, scopes: readonly string[]): ListQueryResult {
  const limit = Number.parseInt(params.get("limit") ?? "100", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return { ok: false, message: "limit : entier entre 1 et 500." };
  }

  const updatedSince = params.get("updated_since");
  if (updatedSince !== null && Number.isNaN(Date.parse(updatedSince))) {
    return { ok: false, message: "updated_since : date ISO 8601 attendue." };
  }

  const contact = params.get("socle_contact_id");
  if (contact !== null && !UUID_RE.test(contact.trim())) {
    return { ok: false, message: "socle_contact_id : UUID Socle attendu." };
  }
  const socleContactId = contact === null ? null : contact.trim().toLowerCase();

  return {
    ok: true,
    value: {
      limit,
      updatedSince,
      socleContactId,
      allSources: socleContactId !== null && scopes.includes(READ_TENANT_SCOPE),
    },
  };
}
