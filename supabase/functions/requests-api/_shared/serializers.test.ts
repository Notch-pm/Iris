import { describe, expect, it } from "vitest";
import { serializeRequest } from "./serializers";

const row = {
  id: "0f0f0f0f-0000-4000-8000-000000000001",
  reference: "DEM-2026-000042",
  status: "a_traiter",
  version: 1,
  source: "portail",
  external_ref: "dossier-42",
  organization_id: "tenant-local",
  socle_root_org_id: "11111111-1111-1111-1111-111111111111",
  socle_organization_id: null,
  socle_procedure_id: null,
  socle_contact_id: null,
  subject: "Nid de poule",
  priority: "normale",
  closure_motif: null,
  closure_text: null,
  received_at: "2026-08-01T10:00:00Z",
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-08-20T09:00:00Z",
  closed_at: null,
  // colonnes internes qui ne doivent JAMAIS sortir :
  ingest_fingerprint: "secret-empreinte",
  idempotency_key: "cle-idem",
  snapshot: { requester_declared: { last_name: "Dupont" } },
  form_data: { champ: "valeur" },
  anomalies: [],
};

describe("serializeRequest — whitelist stricte", () => {
  it("expose external_id et l'URL de consultation", () => {
    const out = serializeRequest(row, "https://iris.exemple.fr/");
    expect(out.external_id).toBe("dossier-42");
    expect(out.url).toBe(`https://iris.exemple.fr/demandes/${row.id}`);
    expect(out.reference).toBe("DEM-2026-000042");
    expect(out.status).toBe("a_traiter");
  });

  it("ne laisse fuir ni empreinte, ni clé d'idempotence, ni snapshot, ni form_data, ni tenant local", () => {
    const out = serializeRequest(row, null) as unknown as Record<string, unknown>;
    for (const forbidden of [
      "ingest_fingerprint", "idempotency_key", "snapshot", "form_data",
      "anomalies", "organization_id", "external_ref",
    ]) {
      expect(out).not.toHaveProperty(forbidden);
    }
    expect(out.url).toBeNull();
  });
});
