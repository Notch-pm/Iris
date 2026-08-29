import { describe, expect, it } from "vitest";
import {
  filterContactCreate,
  filterContactListQuery,
  filterContactUpdate,
  filterMatchRequest,
  sanitizeContact,
  sanitizeMatches,
  sanitizeProcedureFull,
  sanitizeProcedureSummary,
  sanitizeQuartier,
  sanitizeQuartierList,
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
    requester_config: { citoyen: {} },
    knowledge_base: {
      agentHelpText: "Consigne agent", proceduresText: "Étapes",
      agentDocuments: [{ path: "o/p/agent/guide.pdf", name: "Guide.pdf" }],
      trainingDocuments: [{ path: "o/p/training/corpus.md", name: "corpus.md" }],
      agentLinks: [{ url: "https://x", description: "d" }],
      aiSources: [{ url: "https://llm", description: "corpus IA" }],
      faq: [{ question: "q", answer: "r" }], guardrails: ["g"],
    },
    translations: {}, order_index: 1, keywords: ["acte"],
  };

  it("le résumé n'embarque ni formulaire ni base de connaissances", () => {
    const s = sanitizeProcedureSummary(rawProc)!;
    expect(s.name).toBe("Acte de naissance");
    expect(s).not.toHaveProperty("form_schema");
    expect(s).not.toHaveProperty("knowledge_base");
  });

  it("la lecture complète porte le formulaire et la part AGENT de la base de connaissances", () => {
    const f = sanitizeProcedureFull(rawProc)!;
    expect(f.form_schema).toEqual({ version: 1, content: [] });
    expect(f.requester_config).toEqual({ citoyen: {} });
    expect(f).not.toHaveProperty("translations");
    expect(f.knowledge_base).toEqual({
      agentHelpText: "Consigne agent",
      proceduresText: "Étapes",
      agentDocuments: [{ path: "o/p/agent/guide.pdf", name: "Guide.pdf" }],
      agentLinks: [{ url: "https://x", description: "d" }],
      faq: [{ question: "q", answer: "r" }],
      guardrails: ["g"],
    });
  });

  it("la matière de l'assistant IA ne franchit jamais la frontière", () => {
    const f = sanitizeProcedureFull(rawProc)!;
    const serialized = JSON.stringify(f);
    expect(serialized).not.toContain("corpus");
    expect(serialized).not.toContain("llm");
  });

  it("une démarche sans base de connaissances rend une structure vide, jamais null", () => {
    const f = sanitizeProcedureFull({ ...rawProc, knowledge_base: null })!;
    expect(f.knowledge_base).toEqual({
      agentHelpText: "", proceduresText: "", agentDocuments: [], agentLinks: [], faq: [], guardrails: [],
    });
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

describe("filterContactUpdate", () => {
  it("refuse les clés immuables et hors whitelist", () => {
    expect(filterContactUpdate({ contact_type: "personne" }))
      .toMatchObject({ ok: false, message: "contact_type : immuable après la création (Socle)." });
    expect(filterContactUpdate({ status: "archived" })).toMatchObject({ ok: false });
    expect(filterContactUpdate({ internal_notes: "x" })).toMatchObject({ ok: false });
    expect(filterContactUpdate({ consent_email: true })).toMatchObject({ ok: false });
    expect(filterContactUpdate({ role_ids: [] })).toMatchObject({ ok: false });
  });

  it("transmet un patch partiel, null compris (effacement)", () => {
    const ok = filterContactUpdate({ email: "m@x.fr", landline_phone: null });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.payload).toEqual({ email: "m@x.fr", landline_phone: null });
  });

  it("exige une valeur textuelle ou null", () => {
    expect(filterContactUpdate({ postal_code: 44000 })).toMatchObject({ ok: false });
  });

  it("refuse de vider le pays (le Socle l'exige) et un patch vide", () => {
    expect(filterContactUpdate({ country: "" })).toMatchObject({ ok: false });
    expect(filterContactUpdate({ country: null })).toMatchObject({ ok: false });
    expect(filterContactUpdate({})).toMatchObject({ ok: false, message: "contact : aucune modification transmise." });
    expect(filterContactUpdate("Dupont")).toMatchObject({ ok: false });
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

describe("filterContactListQuery", () => {
  it("borne la page et retient « actifs » par défaut", () => {
    expect(filterContactListQuery({})).toEqual({
      ok: true,
      limit: 200,
      params: { status: "active", limit: "200", offset: "0" },
    });
  });

  it("transmet recherche, type et pagination", () => {
    expect(filterContactListQuery({
      search: "  Dupont ", type: "entreprise", status: "archived", limit: 500, offset: 1000,
    })).toEqual({
      ok: true,
      limit: 500,
      params: {
        search: "Dupont", type: "entreprise", status: "archived", limit: "500", offset: "1000",
      },
    });
  });

  it("« all » n'envoie AUCUN status (tous statuts, contrat contacts-api)", () => {
    const out = filterContactListQuery({ status: "all" });
    expect(out).toMatchObject({ ok: true });
    expect(out.ok && "status" in out.params).toBe(false);
  });

  it("refuse ce qui sort du contrat", () => {
    expect(filterContactListQuery({ type: "fournisseur" })).toMatchObject({ ok: false });
    expect(filterContactListQuery({ status: "supprime" })).toMatchObject({ ok: false });
    expect(filterContactListQuery({ limit: 0 })).toMatchObject({ ok: false });
    expect(filterContactListQuery({ limit: 501 })).toMatchObject({ ok: false });
    expect(filterContactListQuery({ offset: -1 })).toMatchObject({ ok: false });
    expect(filterContactListQuery({ search: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(filterContactListQuery("Dupont")).toMatchObject({ ok: false });
  });
});

describe("sanitizeQuartier — la SEULE porte par laquelle `geom` passe", () => {
  const raw = {
    id: "q-1", name: "Trinquetaille", color: "#00D084",
    geometry: { type: "Polygon", coordinates: [] },
    organization_id: "org-socle", internal_notes: "NOTE INTERNE SOCLE", champ_futur: 42,
  };

  it("transmet la géométrie — c'est ce pour quoi la route existe", () => {
    const q = sanitizeQuartier(raw)!;
    expect(q.geometry).toEqual({ type: "Polygon", coordinates: [] });
    expect(q).toEqual({ id: "q-1", name: "Trinquetaille", color: "#00D084", geometry: raw.geometry });
  });

  it("reste une whitelist stricte : rien d'autre ne franchit la frontière", () => {
    const q = sanitizeQuartier(raw)!;
    for (const forbidden of ["organization_id", "internal_notes", "champ_futur"]) {
      expect(q).not.toHaveProperty(forbidden);
    }
  });

  it("refuse une entrée sans identifiant", () => {
    expect(sanitizeQuartier(null)).toBeNull();
    expect(sanitizeQuartier({ name: "Sans id" })).toBeNull();
  });

  it("liste : écarte les entrées illisibles, ne rend jamais autre chose qu'un tableau", () => {
    expect(sanitizeQuartierList([raw, null, { name: "x" }])).toHaveLength(1);
    expect(sanitizeQuartierList(null)).toEqual([]);
    expect(sanitizeQuartierList({ quartiers: [] })).toEqual([]);
  });

  it("le quartier d'une FICHE USAGER, lui, reste sans géométrie", () => {
    const contact = sanitizeContact({
      id: "c-9",
      quartier: { id: "q-1", name: "Trinquetaille", color: "#00D084", geom: "SECRET" },
    })!;
    expect(contact.quartier).toEqual({ id: "q-1", name: "Trinquetaille", color: "#00D084" });
  });
});
