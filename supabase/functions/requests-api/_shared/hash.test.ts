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
  const base = {
    source_system: "portail",
    external_id: "d-1",
    socle_root_organization_id: "11111111-1111-1111-1111-111111111111",
    subject: "Sujet",
    requester: { last_name: "Dupont" },
    attachments: [{ file_name: "a.pdf", fetch_url: "https://exemple.test/signee-1" }],
  };

  function fp(input: object): string {
    const parsed = validateEnvelope(input);
    if (!parsed.ok) throw new Error(parsed.message);
    return canonicalJson(fingerprintPayload(parsed.value));
  }

  it("ne dépend ni de l'idempotency_key ni des fetch_url (éphémères)", () => {
    const a = fp({ ...base, idempotency_key: "k1" });
    const b = fp({
      ...base,
      idempotency_key: "k2",
      attachments: [{ file_name: "a.pdf", fetch_url: "https://exemple.test/signee-2" }],
    });
    expect(a).toBe(b);
  });

  it("change quand le contenu change", () => {
    expect(fp(base)).not.toBe(fp({ ...base, subject: "Autre sujet" }));
  });
});
