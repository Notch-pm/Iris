import { describe, expect, it } from "vitest";
import {
  slugifyFileName,
  validateAttachmentList,
  validateEnvelope,
} from "./validation";

const ROOT = "11111111-1111-1111-1111-111111111111";
const PROC = "22222222-2222-4222-8222-222222222222";
const valid = {
  source_system: "portail",
  external_id: "dossier-42",
  socle_root_organization_id: ROOT,
  socle_procedure_id: PROC,
  subject: "Nid de poule",
  requester: { last_name: "Dupont", first_name: "Marie" },
};

describe("validateEnvelope", () => {
  it("accepte une enveloppe minimale valide", () => {
    const r = validateEnvelope(valid);
    expect(r.ok).toBe(true);
  });

  it("refuse une clé inconnue (whitelist stricte)", () => {
    const r = validateEnvelope({ ...valid, evil: true });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("evil");
  });

  it("exige les champs obligatoires — dont la démarche Socle (aucune demande libre)", () => {
    for (const key of [
      "source_system", "external_id", "socle_root_organization_id",
      "socle_procedure_id", "subject",
    ]) {
      const copy: Record<string, unknown> = { ...valid };
      delete copy[key];
      expect(validateEnvelope(copy).ok).toBe(false);
    }
    const sans = validateEnvelope({ ...valid, socle_procedure_id: undefined });
    if (!sans.ok) expect(sans.message).toContain("démarche Socle");
  });

  it("refuse tout snapshot imposé par l'émetteur (whitelist stricte)", () => {
    expect(validateEnvelope({ ...valid, procedure_snapshot: { id: PROC } }).ok).toBe(false);
    expect(validateEnvelope({ ...valid, requester_snapshot: {} }).ok).toBe(false);
  });

  it("accepte et valide form_field_key sur les pièces", () => {
    const ok = validateEnvelope({
      ...valid,
      attachments: [{ file_name: "cni.pdf", fetch_url: "https://x.test/s", form_field_key: "piece_identite" }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.attachments![0].form_field_key).toBe("piece_identite");
    expect(validateEnvelope({
      ...valid,
      attachments: [{ file_name: "cni.pdf", fetch_url: "https://x.test/s", form_field_key: "  " }],
    }).ok).toBe(false);
  });

  it("refuse un UUID invalide", () => {
    expect(validateEnvelope({ ...valid, socle_root_organization_id: "pas-un-uuid" }).ok).toBe(false);
    expect(validateEnvelope({ ...valid, socle_procedure_id: "42" }).ok).toBe(false);
  });

  it("exige une identité : contact Socle, identité déclarée ou anonymat assumé", () => {
    const sans = { ...valid } as Record<string, unknown>;
    delete sans.requester;
    expect(validateEnvelope(sans).ok).toBe(false);
    expect(validateEnvelope({ ...sans, socle_contact_id: ROOT }).ok).toBe(true);
    expect(validateEnvelope({ ...sans, requester: { anonymous: true } }).ok).toBe(true);
  });

  it("refuse le contenu inline dans les pièces (références signées uniquement)", () => {
    const r = validateEnvelope({
      ...valid,
      attachments: [{ file_name: "a.pdf", fetch_url: "https://x.test/s", data: "AAAA" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("URL signée");
  });

  it("exige des fetch_url en https", () => {
    const r = validateEnvelope({
      ...valid,
      attachments: [{ file_name: "a.pdf", fetch_url: "http://x.test/s" }],
    });
    expect(r.ok).toBe(false);
  });

  it("valide le contexte et les liens", () => {
    const r = validateEnvelope({
      ...valid,
      context: { channel: "courrier", received_at: "2026-08-01T10:00:00Z", external_url: "https://clara.test/c/1" },
      links: [{ type: "courrier", id: "c-1", url: "https://clara.test/c/1" }],
    });
    expect(r.ok).toBe(true);
    expect(validateEnvelope({ ...valid, context: { imprevu: 1 } }).ok).toBe(false);
    expect(validateEnvelope({ ...valid, links: [{ type: "courrier" }] }).ok).toBe(false);
  });
});

describe("validateAttachmentList", () => {
  it("borne la taille du lot et le format", () => {
    expect(validateAttachmentList("x").ok).toBe(false);
    expect(validateAttachmentList([{ file_name: "", fetch_url: "https://x.test/s" }]).ok).toBe(false);
    expect(validateAttachmentList([{ file_name: "a.pdf", fetch_url: "https://x.test/s", size_bytes: -1 }]).ok).toBe(false);
    expect(validateAttachmentList([{ file_name: "a.pdf", fetch_url: "https://x.test/s", size_bytes: 10 }]).ok).toBe(true);
  });
});

describe("slugifyFileName", () => {
  it("neutralise accents, espaces et traversées de chemin", () => {
    expect(slugifyFileName("Pièce jointe n°1.pdf")).toBe("Piece-jointe-n-1.pdf");
    expect(slugifyFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(slugifyFileName("///")).toBe("fichier");
  });
});
