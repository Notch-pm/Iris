import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./hash";
import { fingerprintPayload, validateEnvelope } from "./validation";

describe("canonicalJson", () => {
  it("produit la même chaîne quel que soit l'ordre des clés", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("ignore les valeurs undefined mais conserve null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("préserve l'ordre des tableaux", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
});

describe("sha256Hex", () => {
  it("calcule le vecteur de test connu", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("empreinte d'ingestion", () => {
  const UP1 = "33333333-3333-4333-8333-333333333333";
  const UP2 = "44444444-4444-4444-8444-444444444444";
  const base = {
    source_system: "portail",
    external_id: "d-1",
    socle_root_organization_id: "11111111-1111-1111-1111-111111111111",
    socle_procedure_id: "22222222-2222-4222-8222-222222222222",
    subject: "Sujet",
    requester: { last_name: "Dupont" },
    attachments: [{ upload_id: UP1, form_field_key: "cni" }],
  };
  const piece = { file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10, checksum: "abc", form_field_key: "cni" };

  function fp(input: object, pieces = [piece]): string {
    const parsed = validateEnvelope(input);
    if (!parsed.ok) throw new Error(parsed.message);
    return canonicalJson(fingerprintPayload(parsed.value, pieces));
  }

  it("ne dépend ni de l'idempotency_key ni des upload_id : seul le contenu des pièces compte", () => {
    const a = fp({ ...base, idempotency_key: "k1" });
    const b = fp({ ...base, idempotency_key: "k2", attachments: [{ upload_id: UP2, form_field_key: "cni" }] });
    expect(a).toBe(b);
    expect(a).not.toContain(UP1);
  });

  it("ne dépend pas de l'ordre des pièces, mais de leur contenu", () => {
    const other = { ...piece, checksum: "def", file_name: "b.pdf" };
    expect(fp(base, [piece, other])).toBe(fp(base, [other, piece]));
    expect(fp(base, [piece])).not.toBe(fp(base, [other]));
  });

  it("change quand le contenu change", () => {
    expect(fp(base)).not.toBe(fp({ ...base, subject: "Autre sujet" }));
  });
});
