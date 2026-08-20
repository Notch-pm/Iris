import { describe, expect, it } from "vitest";
import {
  filterContactCreate,
  filterMatchRequest,
  sanitizeContact,
  sanitizeMatches,
  sanitizeProcedureFull,
  sanitizeProcedureSummary,
} from "./sanitize";

const rawContact = {
  id: "c-1",
  organization_id: "org-socle",
  contact_type: "personne",
  civility: "madame",
  first_name: "Marie",
  last_name: "Dupont",
  display_name: "Marie Dupont",
  email: "marie@exemple.fr",
  mobile_phone: "0612345678",
  address_line1: "1 rue des Lilas",
  postal_code: "13200",
  city: "Arles",
  country: "France",
  status: "active",
  quartier: { id: "q-1", name: "Centre", color: "#00D084", geom: "SECRET" },
  internal_notes: "NOTE INTERNE SOCLE — ne jamais transmettre",
  consent_email: true,
  consent_sms: false,
  relations: [{ secret: true }],
  external_references: [{ source: "x", external_id: "y" }],
  champ_futur: 42,
};

describe("sanitizeContact — whitelist stricte", () => {
  it("ne transmet jamais internal_notes, consentements, relations ni champs inconnus", () => {
    const c = sanitizeContact(rawContact)!;
    expect(c.display_name).toBe("Marie Dupont");
    expect(c.email).toBe("marie@exemple.fr");
    expect(c.quartier).toEqual({ id: "q-1", name: "Centre", color: "#00D084" });
    for (const forbidden of [
      "internal_notes", "consent_email", "consent_sms", "relations",
      "external_references", "organization_id", "champ_futur",
    ]) {
      expect(c).not.toHaveProperty(forbidden);
    }
  });

  it("tolère les fiches partielles et rejette les réponses invalides", () => {
    expect(sanitizeContact({ id: "c-2", contact_type: "entreprise" })!.legal_name).toBeNull();
    expect(sanitizeContact(null)).toBeNull();
    expect(sanitizeContact({ pas_d_id: true })).toBeNull();
  });
});

describe("sanitizeMatches", () => {
  it("sanitise chaque candidat et conserve score + motifs", () => {
    const out = sanitizeMatches([
      { contact: rawContact, score: 160, reasons: ["email", "name_exact", 42] },
      { contact: null, score: 10, reasons: [] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(160);
    expect(out[0].reasons).toEqual(["email", "name_exact"]);
    expect((out[0].contact as Record<string, unknown>)).not.toHaveProperty("internal_notes");
  });
});

describe("sanitizeProcedure*", () => {
  const rawProc = {
    id: "p-1", organization_id: "root", category_id: "cat", name: "Acte de naissance",
    type: "externe", short_description: "…", user_description: "u", agent_description: "a",
    input_duration_minutes: 5, form_schema: { version: 1, content: [] },
    requester_config: { citoyen: {} }, knowledge_base: { agent_help: "SOCLE" },
    translations: {}, order_index: 1, keywords: ["acte"],
  };

  it("le résumé n'embarque ni formulaire ni base de connaissances", () => {
    const s = sanitizeProcedureSummary(rawProc)!;
    expect(s.name).toBe("Acte de naissance");
    expect(s).not.toHaveProperty("form_schema");
    expect(s).not.toHaveProperty("knowledge_base");
  });

  it("la lecture complète porte le formulaire mais jamais knowledge_base", () => {
    const f = sanitizeProcedureFull(rawProc)!;
    expect(f.form_schema).toEqual({ version: 1, content: [] });
    expect(f.requester_config).toEqual({ citoyen: {} });
    expect(f).not.toHaveProperty("knowledge_base");
    expect(f).not.toHaveProperty("translations");
  });
});

describe("filterContactCreate", () => {
  it("refuse les clés hors whitelist (dont internal_notes et role_ids)", () => {
    expect(filterContactCreate({ contact_type: "personne", internal_notes: "x" }))
      .toMatchObject({ ok: false });
    expect(filterContactCreate({ contact_type: "personne", role_ids: [] }))
      .toMatchObject({ ok: false });
  });

  it("exige contact_type et transmet les clés autorisées", () => {
    expect(filterContactCreate({ first_name: "Marie" })).toMatchObject({ ok: false });
    const ok = filterContactCreate({
      contact_type: "personne", civility: "madame", last_name: "Dupont", email: "m@x.fr",
    });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.payload).toEqual({
      contact_type: "personne", civility: "madame", last_name: "Dupont", email: "m@x.fr",
    });
  });
});

describe("filterMatchRequest", () => {
  it("transmet les critères connus et refuse le reste", () => {
    const ok = filterMatchRequest({ last_name: "Dupont", phones: ["0612345678"], limit: 5 });
    expect(ok).toMatchObject({ ok: true });
    expect(filterMatchRequest({ last_name: "Dupont", exclude_ids: [] })).toMatchObject({ ok: false });
    expect(filterMatchRequest("Dupont")).toMatchObject({ ok: false });
  });
});
