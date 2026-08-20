// Sérialisation sortante par WHITELIST STRICTE (motif Socle) : aucune colonne
// hors liste ne peut fuir, même sur un select trop large. Jamais de notes
// internes, jamais de snapshot, jamais de form_data dans les réponses externes.

export const REQUEST_SELECT =
  "id, reference, status, version, source, external_ref, organization_id, " +
  "socle_root_org_id, socle_organization_id, socle_procedure_id, socle_contact_id, " +
  "subject, priority, closure_motif, closure_text, " +
  "received_at, created_at, updated_at, closed_at, ingest_fingerprint, idempotency_key";

export interface SerializedRequest {
  id: string;
  reference: string;
  status: string;
  version: number;
  source: string;
  external_id: string | null;
  socle_root_organization_id: string;
  socle_organization_id: string | null;
  socle_procedure_id: string | null;
  socle_contact_id: string | null;
  subject: string;
  priority: string;
  closure_motif: string | null;
  closure_text: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  url: string | null;
}

// deno-lint-ignore no-explicit-any
export function serializeRequest(row: any, appUrl: string | null): SerializedRequest {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    version: row.version,
    source: row.source,
    external_id: row.external_ref ?? null,
    socle_root_organization_id: row.socle_root_org_id,
    socle_organization_id: row.socle_organization_id ?? null,
    socle_procedure_id: row.socle_procedure_id ?? null,
    socle_contact_id: row.socle_contact_id ?? null,
    subject: row.subject,
    priority: row.priority,
    closure_motif: row.closure_motif ?? null,
    closure_text: row.closure_text ?? null,
    received_at: row.received_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at ?? null,
    url: appUrl ? `${appUrl.replace(/\/+$/, "")}/demandes/${row.id}` : null,
  };
}
