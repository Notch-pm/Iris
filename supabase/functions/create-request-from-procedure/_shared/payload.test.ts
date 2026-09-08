import { describe, expect, it } from "vitest";
import { parsePayload } from "./payload";

const ORG = "11111111-1111-1111-1111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const PROC = "33333333-3333-4333-8333-333333333333";
const DEST = "44444444-4444-4444-4444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";

const valid = {
  organization_id: ORG,
  request_id: REQ,
  socle_procedure_id: PROC,
  socle_organization_id: DEST,
  subject: "Signalement voirie",
  requester: { kind: "anonyme" },
};

describe("parsePayload", () => {
  it("accepte un payload minimal valide, destinataire compris", () => {
    const r = parsePayload(valid);
    expect(r).not.toHaveProperty("error");
    if (!("error" in r)) {
      expect(r.destinationId).toBe(DEST);
      expect(r.organizationId).toBe(ORG);
      expect(r.priority).toBe("normale");
    }
  });

  it("refuse un corps non objet", () => {
    expect(parsePayload(null)).toHaveProperty("error");
    expect(parsePayload([])).toHaveProperty("error");
    expect(parsePayload("x")).toHaveProperty("error");
  });

  it("refuse une clé inconnue (whitelist stricte, aucun snapshot accepté)", () => {
    const r = parsePayload({ ...valid, procedure_snapshot: { id: PROC } });
    expect(r).toMatchObject({ error: expect.stringContaining("procedure_snapshot") });
  });

  // RM-29 : organisation destinataire obligatoire pour toute demande créée
  // dans Iris — absente, nulle ou mal formée → erreur de forme.
  it("exige socle_organization_id (RM-29) — absent", () => {
    const copy: Record<string, unknown> = { ...valid };
    delete copy.socle_organization_id;
    const r = parsePayload(copy);
    expect(r).toMatchObject({ error: expect.stringContaining("socle_organization_id") });
  });

  it("exige socle_organization_id (RM-29) — null explicite", () => {
    const r = parsePayload({ ...valid, socle_organization_id: null });
    expect(r).toMatchObject({ error: expect.stringContaining("socle_organization_id") });
  });

  it("exige socle_organization_id (RM-29) — UUID mal formé", () => {
    const r = parsePayload({ ...valid, socle_organization_id: "pas-un-uuid" });
    expect(r).toMatchObject({ error: expect.stringContaining("socle_organization_id") });
  });

  it("refuse un UUID invalide pour les identifiants obligatoires", () => {
    expect(parsePayload({ ...valid, organization_id: "42" })).toHaveProperty("error");
    expect(parsePayload({ ...valid, request_id: "42" })).toHaveProperty("error");
    expect(parsePayload({ ...valid, socle_procedure_id: "42" })).toHaveProperty("error");
  });

  it("exige un sujet non vide, borné à 500 caractères", () => {
    expect(parsePayload({ ...valid, subject: "" })).toHaveProperty("error");
    expect(parsePayload({ ...valid, subject: "a".repeat(501) })).toHaveProperty("error");
  });

  it("refuse une priorité inconnue", () => {
    expect(parsePayload({ ...valid, priority: "critique" })).toHaveProperty("error");
  });

  it("valide le demandeur selon son type déclaré", () => {
    expect(parsePayload({
      ...valid,
      requester: { kind: "contact", audience: "citoyen", socle_contact_id: CONTACT },
    })).not.toHaveProperty("error");
    expect(parsePayload({
      ...valid,
      requester: { kind: "sans_rapprochement", audience: "citoyen", declared: { nom_naissance: "Dupont" } },
    })).not.toHaveProperty("error");
    expect(parsePayload({
      ...valid,
      requester: { kind: "contact", audience: "citoyen", socle_contact_id: "pas-un-uuid" },
    })).toHaveProperty("error");
    expect(parsePayload({ ...valid, requester: { kind: "autre_chose" } })).toHaveProperty("error");
  });

  it("les pièces ne sont plus que des upload_id rattachés à une exigence", () => {
    const UP = "33333333-3333-4333-8333-333333333333";
    const ok = parsePayload({
      ...valid,
      attachments: [{ form_field_key: "piece_identite", upload_id: UP.toUpperCase() }],
    });
    expect(ok).not.toHaveProperty("error");
    if (!("error" in ok)) expect(ok.attachments).toEqual([{ upload_id: UP, form_field_key: "piece_identite" }]);

    // Un chemin, un nom ou un type venus du navigateur ne sont plus acceptés.
    const legacy = parsePayload({
      ...valid,
      attachments: [{
        form_field_key: "piece_identite",
        file_name: "cni.pdf",
        storage_path: `${ORG}/${REQ}/piece_identite/cni.pdf`,
      }],
    });
    expect(legacy).toHaveProperty("error");
    expect(parsePayload({ ...valid, attachments: [{ form_field_key: "x", upload_id: "pas-un-uuid" }] }))
      .toHaveProperty("error");
    expect(parsePayload({ ...valid, attachments: [{ upload_id: UP }] })).toHaveProperty("error");
    expect(parsePayload({
      ...valid,
      attachments: [{ form_field_key: "a", upload_id: UP }, { form_field_key: "b", upload_id: UP }],
    })).toHaveProperty("error");
  });
});
