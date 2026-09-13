import { describe, expect, it } from "vitest";
import {
  fingerprintPayload,
  slugifyFileName,
  validateAttachmentList,
  validateEnvelope,
} from "./validation";

const ROOT = "11111111-1111-1111-1111-111111111111";
const PROC = "22222222-2222-4222-8222-222222222222";
const UP = "33333333-3333-4333-8333-333333333333";
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
      attachments: [{ upload_id: UP, form_field_key: "piece_identite" }],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.attachments![0].form_field_key).toBe("piece_identite");
    expect(validateEnvelope({
      ...valid,
      attachments: [{ upload_id: UP, form_field_key: "  " }],
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

  it("refuse le contenu inline dans les pièces (upload_id uniquement)", () => {
    const r = validateEnvelope({
      ...valid,
      attachments: [{ upload_id: UP, data: "AAAA" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("/v1/uploads");
  });

  it("refuse le mode URL signée du contrat 1.x en disant quoi faire à la place", () => {
    const r = validateEnvelope({
      ...valid,
      attachments: [{ file_name: "a.pdf", fetch_url: "https://x.test/s" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("fetch_url");
      expect(r.message).toContain("2.0.0");
      expect(r.message).toContain("/v1/uploads");
    }
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
    expect(validateAttachmentList([{ upload_id: "pas-un-uuid" }]).ok).toBe(false);
    expect(validateAttachmentList([{}]).ok).toBe(false);
    expect(validateAttachmentList([{ upload_id: UP }]).ok).toBe(true);
    expect(validateAttachmentList(Array.from({ length: 51 }, () => ({ upload_id: UP }))).ok).toBe(false);
  });

  it("normalise l'identifiant et refuse une pièce référencée deux fois", () => {
    const r = validateAttachmentList([{ upload_id: UP.toUpperCase() }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].upload_id).toBe(UP);
    const twice = validateAttachmentList([{ upload_id: UP }, { upload_id: UP.toUpperCase() }]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.message).toContain("deux fois");
  });
});

describe("slugifyFileName (ré-exporté depuis _shared/files/names)", () => {
  it("reste disponible pour les appelants historiques", () => {
    expect(slugifyFileName("Pièce jointe n°1.pdf")).toBe("Piece-jointe-n-1.pdf");
  });
});

describe("enveloppe — consentements RGPD", () => {
  const consents = [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }];

  it("les accepte, et les accepte tout autant ABSENTS (évolution additive du contrat 2.x)", () => {
    const avec = validateEnvelope({ ...valid, consents });
    expect(avec.ok).toBe(true);
    if (avec.ok) expect(avec.value.consents).toEqual(consents);
    // Une intégration écrite avant la 2.2.0 doit continuer de passer.
    const sans = validateEnvelope(valid);
    expect(sans.ok).toBe(true);
    if (sans.ok) expect(sans.value.consents).toBeUndefined();
  });

  it("entrent dans l'empreinte : rejouer un dépôt en changeant une réponse est un CONFLIT", () => {
    const a = fingerprintPayload({ ...valid, consents } as never);
    const b = fingerprintPayload({
      ...valid,
      consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: true }],
    } as never);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    // Le même dépôt rejoué à l'identique garde la même empreinte.
    expect(JSON.stringify(fingerprintPayload({ ...valid, consents } as never))).toBe(JSON.stringify(a));
  });
});
