import { describe, expect, it } from "vitest";
import {
  identityStatus,
  slugifyFileName,
  validateAttachmentList,
  validateEnvelope,
} from "./validation";

const ROOT = "11111111-1111-1111-1111-111111111111";
const valid = {
  source_system: "portail",
  external_id: "dossier-42",
  socle_root_organization_id: ROOT,
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

  it("exige les champs obligatoires", () => {
    for (const key of ["source_system", "external_id", "socle_root_organization_id", "subject"]) {
      const copy: Record<string, unknown> = { ...valid };
      delete copy[key];
      expect(validateEnvelope(copy).ok).toBe(false);
    }
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

describe("identityStatus", () => {
  const parse = (input: object) => {
    const r = validateEnvelope(input);
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };

  it("rapprochee avec un contact Socle, anonyme sur anonymat assumé, non_rapprochee sinon", () => {
    expect(identityStatus(parse({ ...valid, socle_contact_id: ROOT }))).toBe("rapprochee");
    const anon = { ...valid, requester: { anonymous: true } };
    expect(identityStatus(parse(anon))).toBe("anonyme");
    expect(identityStatus(parse(valid))).toBe("non_rapprochee");
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
