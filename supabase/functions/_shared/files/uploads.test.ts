import { describe, expect, it } from "vitest";
import {
  attachmentFingerprint,
  checkUploadRow,
  sortFingerprints,
  type UploadRow,
} from "./uploads";

const ORG = "11111111-1111-1111-1111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const SRC = "44444444-4444-4444-8444-444444444444";
const AGENT = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-08T10:00:00Z");

function row(over: Partial<UploadRow> = {}): UploadRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: ORG,
    scope_request_id: null,
    integration_source_id: SRC,
    uploaded_by: null,
    storage_path: `${ORG}/_staging/33333333-3333-4333-8333-333333333333`,
    file_name: "cni.pdf",
    mime_type: "application/pdf",
    file_size: 1234,
    checksum: "abc",
    expires_at: "2026-09-09T10:00:00Z",
    consumed_at: null,
    discarded_at: null,
    ...over,
  };
}

describe("checkUploadRow — jumeau des refus de consume_attachment_upload", () => {
  const partner = { organizationId: ORG, sourceId: SRC, now: NOW };

  it("accepte une ligne vivante du bon tenant et du bon déposant", () => {
    expect(checkUploadRow(row(), partner)).toEqual({ ok: true });
  });

  it("refuse l'inconnu et l'autre tenant sans distinguer les deux", () => {
    expect(checkUploadRow(null, partner)).toMatchObject({ ok: false, code: "unknown" });
    expect(checkUploadRow(row({ organization_id: REQ }), partner)).toMatchObject({ ok: false, code: "unknown" });
  });

  it("refuse un autre déposant — source ou agent", () => {
    expect(checkUploadRow(row(), { organizationId: ORG, sourceId: REQ, now: NOW })).toMatchObject({ code: "other_depositor" });
    expect(checkUploadRow(row({ integration_source_id: null, uploaded_by: AGENT }), partner)).toMatchObject({ code: "other_depositor" });
    expect(checkUploadRow(row({ integration_source_id: null, uploaded_by: AGENT }), { organizationId: ORG, actorId: AGENT, now: NOW })).toEqual({ ok: true });
  });

  it("refuse retiré, expiré, autre portée", () => {
    expect(checkUploadRow(row({ discarded_at: "2026-09-08T09:00:00Z" }), partner)).toMatchObject({ code: "discarded" });
    expect(checkUploadRow(row({ expires_at: "2026-09-08T09:59:59Z" }), partner)).toMatchObject({ code: "expired" });
    expect(checkUploadRow(row({ scope_request_id: REQ }), { ...partner, requestId: ORG })).toMatchObject({ code: "other_scope" });
    expect(checkUploadRow(row({ scope_request_id: REQ }), { ...partner, requestId: REQ })).toEqual({ ok: true });
  });

  it("une pièce consommée est refusée — sauf pour un rejeu idempotent, qui doit la relire", () => {
    const consumed = row({ consumed_at: "2026-09-08T09:30:00Z", storage_path: `${ORG}/${REQ}/x.pdf` });
    expect(checkUploadRow(consumed, partner)).toMatchObject({ code: "consumed" });
    expect(checkUploadRow(consumed, { ...partner, allowConsumed: true })).toEqual({ ok: true });
    // Consommée ET expirée : le rejeu la relit quand même — l'expiration ne vaut que pour l'attente.
    expect(checkUploadRow(row({ consumed_at: "2026-09-08T09:30:00Z", expires_at: "2026-09-08T09:31:00Z" }),
      { ...partner, allowConsumed: true })).toEqual({ ok: true });
  });
});

describe("empreinte de contenu des pièces", () => {
  it("ne contient que le contenu, jamais l'identifiant de téléversement ni le chemin", () => {
    const fp = attachmentFingerprint(row(), "piece_identite");
    expect(fp).toEqual({
      file_name: "cni.pdf", mime_type: "application/pdf", size_bytes: 1234, checksum: "abc", form_field_key: "piece_identite",
    });
    expect(JSON.stringify(fp)).not.toContain("_staging");
    expect(JSON.stringify(fp)).not.toContain("33333333");
  });

  it("l'ordre d'envoi ne change pas l'empreinte", () => {
    const a = attachmentFingerprint(row({ checksum: "bbb", file_name: "b.pdf" }), "k");
    const b = attachmentFingerprint(row({ checksum: "aaa", file_name: "a.pdf" }), "k");
    expect(sortFingerprints([a, b])).toEqual(sortFingerprints([b, a]));
    expect(sortFingerprints([a, b])[0].checksum).toBe("aaa");
  });
});
