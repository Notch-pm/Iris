import { describe, expect, it } from "vitest";
import {
  filterContactCreate,
  filterContactListQuery,
  filterContactUpdate,
  filterMatchRequest,
  sanitizeAiUsage,
  sanitizeContact,
  sanitizeMatches,
  sanitizeProcedureFull,
  sanitizeProcedureSummary,
  sanitizeBranding,
  sanitizeOrganization,
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
  it("ne transmet jamais internal_notes, relations, consentements obsolètes ni champs inconnus", () => {
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
    status: "production",
    communication_config: {
      visibility: {
        portalVisible: false,
        publicationPeriodEnabled: true,
        publicationStart: "2027-01-01",
        publicationEnd: "2027-05-03",
      },
    },
  };

  it("le résumé n'embarque ni formulaire ni base de connaissances", () => {
    const s = sanitizeProcedureSummary(rawProc)!;
    expect(s.name).toBe("Acte de naissance");
    expect(s).not.toHaveProperty("form_schema");
    expect(s).not.toHaveProperty("knowledge_base");
  });

  // Le bloc de communication BRUT ne traverse pas : c'est sa lecture effective
  // qui traverse, défauts et commutateur de période déjà appliqués.
  it("transmet le statut et la publication effective, jamais communication_config", () => {
    const s = sanitizeProcedureSummary(rawProc)!;
    expect(s.status).toBe("production");
    expect(s.publication).toEqual({
      portalVisible: false,
      publicationStart: "2027-01-01",
      publicationEnd: "2027-05-03",
    });
    expect(s).not.toHaveProperty("communication_config");
    expect(sanitizeProcedureFull(rawProc)!).not.toHaveProperty("communication_config");
  });

  it("le résumé porte les publics ADMIS, jamais la configuration qui les porte", () => {
    const s = sanitizeProcedureSummary({
      ...rawProc,
      requester_config: { citoyen: { enabled: true, fields: { nom: "obligatoire" } }, entreprise: { enabled: false } },
    })!;
    expect(s.audiences).toEqual(["citoyen"]);
    expect(s).not.toHaveProperty("requester_config");
    expect(sanitizeProcedureSummary({ id: "p-3" })!.audiences).toEqual([]);
  });

  it("démarche sans statut ni communication : brouillon, portail visible", () => {
    const s = sanitizeProcedureSummary({ id: "p-2", name: "Brute" })!;
    expect(s.status).toBe("brouillon");
    expect(s.publication).toEqual({
      portalVisible: true, publicationStart: null, publicationEnd: null,
    });
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

  // Contrat 1.24.0 : ce que la collectivité écrit pour ses usagers est PUBLIC,
  // il traverse — mais seulement le contrat, et `null` reste `null`.
  it("relaie la communication usager, whitelistée", () => {
    const f = sanitizeProcedureFull({
      ...rawProc,
      user_communication: {
        delays: { processingTimeValue: 3, processingTimeUnit: "semaine" },
        audience: { note: "Résidents" },
        attachments: { items: [{ label: "RIB", description: "" }] },
        faq: { items: [{ question: "Q ?", answer: "R" }] },
        futur: "SECRET",
      },
    })!;
    expect(f.user_communication).toEqual({
      delays: { processingTimeValue: 3, processingTimeUnit: "semaine" },
      audience: { note: "Résidents" },
      attachments: { items: [{ label: "RIB", description: "" }] },
      faq: { items: [{ question: "Q ?", answer: "R" }] },
    });
    expect(JSON.stringify(f)).not.toContain("SECRET");
  });

  it("une démarche où la collectivité n'a rien écrit rend `user_communication: null`", () => {
    const f = sanitizeProcedureFull(rawProc)!;
    expect(f).toHaveProperty("user_communication", null);
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

describe("sanitizeOrganization — le siège de la collectivité, rien de plus", () => {
  const raw = {
    id: "org-socle", name: "ACCM", slug: "accm", type: "epci", status: "active",
    address: "5 Rue Yvan Audouard, 13200 Arles",
    phone: "0490000000", email: "contact@accm.fr",
    logo_url: "https://accm.fr/logo.png", metadata: { interne: true },
    email_sender_name: "ACCM", champ_futur: 42,
  };

  it("ne laisse passer que l'identité et l'adresse", () => {
    expect(sanitizeOrganization(raw)).toEqual({
      id: "org-socle", name: "ACCM", address: "5 Rue Yvan Audouard, 13200 Arles",
    });
  });

  it("retient le téléphone, le courriel et le reste — aucun écran n'en a l'usage", () => {
    const org = sanitizeOrganization(raw)!;
    expect(org.phone).toBeUndefined();
    expect(org.email).toBeUndefined();
    expect(org.metadata).toBeUndefined();
    expect(org.email_sender_name).toBeUndefined();
    expect(org.champ_futur).toBeUndefined();
  });

  it("rend null sur une réponse informe, et une adresse absente vaut null", () => {
    expect(sanitizeOrganization(null)).toBeNull();
    expect(sanitizeOrganization({ name: "sans id" })).toBeNull();
    expect(sanitizeOrganization("texte")).toBeNull();
    expect(sanitizeOrganization({ id: "o1", name: "X" })).toEqual({
      id: "o1", name: "X", address: null,
    });
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

describe("sanitizeAiUsage", () => {
  const raw = {
    organization_id: "d5227d25-f327-493a-a9a2-278397531e33",
    period: "2026-08",
    renews_at: "2026-09-01",
    unlimited: false,
    limit: 2000000,
    used_tokens: 1603,
    reserved_tokens: 0,
    remaining_tokens: 1998397,
    by_consumer: [
      { consumer: "iris", feature: "assistant-instruction", calls: 1, tokens: 1603 },
    ],
  };

  it("retient les faits et la date, jamais l'identifiant Socle", () => {
    const out = sanitizeAiUsage(raw);
    expect(out.period).toBe("2026-08");
    expect(out.renews_at).toBe("2026-09-01");
    expect(out.limit).toBe(2000000);
    expect(out.used_tokens).toBe(1603);
    expect(out).not.toHaveProperty("organization_id");
  });

  // Deux nombres pour une même vérité, c'est une occasion de diverger : Iris
  // les recalcule avec `quotaView`, qui dessine aussi la jauge.
  it("n'emporte pas les valeurs dérivées du Socle", () => {
    const out = sanitizeAiUsage(raw);
    expect(out).not.toHaveProperty("unlimited");
    expect(out).not.toHaveProperty("remaining_tokens");
  });

  // Même raison que pour la base de connaissances : le navigateur re-parse par
  // défiance ce qu'il reçoit. Un renommage au passage viderait le second tour.
  it("est idempotente", () => {
    const once = sanitizeAiUsage(raw);
    expect(sanitizeAiUsage(once)).toEqual(once);
    expect(sanitizeAiUsage(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("un plafond nul, négatif ou absent vaut aucun plafond", () => {
    expect(sanitizeAiUsage({ ...raw, limit: 0 }).limit).toBeNull();
    expect(sanitizeAiUsage({ ...raw, limit: -1 }).limit).toBeNull();
    expect(sanitizeAiUsage({ ...raw, limit: null }).limit).toBeNull();
  });

  it("écarte les lignes sans application et normalise les compteurs", () => {
    const out = sanitizeAiUsage({
      ...raw,
      by_consumer: [
        { consumer: "  ", feature: "x", calls: 3, tokens: 9 },
        { consumer: "clara", feature: "  ", calls: "2", tokens: -5 },
      ],
    });
    expect(out.by_consumer).toEqual([
      { consumer: "clara", feature: null, calls: 0, tokens: 0 },
    ]);
  });

  it("rend une structure complète sur une entrée absurde", () => {
    for (const bad of [null, undefined, 42, "texte", []]) {
      const out = sanitizeAiUsage(bad);
      expect(out.by_consumer).toEqual([]);
      expect(out.used_tokens).toBe(0);
      expect(out.limit).toBeNull();
    }
  });
});

describe("sanitizeBranding — le logo du client dans le header, rien de plus", () => {
  const raw = {
    organization_id: "org-socle", source_organization_id: "org-parent", inherited: true,
    configured: true, logo_url: "https://accm.fr/logo.png",
    logo_white_url: "https://accm.fr/logo-blanc.png", primary_color: "#1f8a5b",
  };

  it("ne laisse passer que le logo couleur", () => {
    expect(sanitizeBranding(raw)).toEqual({ logo_url: "https://accm.fr/logo.png" });
  });

  it("filtre une URL qui n'est pas du http(s)", () => {
    expect(sanitizeBranding({ ...raw, logo_url: "javascript:alert(1)" })).toEqual({ logo_url: null });
    expect(sanitizeBranding({ ...raw, logo_url: "" })).toEqual({ logo_url: null });
  });

  it("une charte non configurée n'a pas de logo, même si un champ traîne", () => {
    expect(sanitizeBranding({ ...raw, configured: false })).toEqual({ logo_url: null });
  });

  it("rend null sur une réponse qui n'est pas un objet", () => {
    expect(sanitizeBranding(null)).toBeNull();
    expect(sanitizeBranding("x")).toBeNull();
  });
});

describe("sanitizeContact — consentements RGPD", () => {
  const withConsents = {
    id: "c-3",
    contact_type: "personne",
    consent_traitement: true,
    consent_traitement_at: "2026-09-20T08:00:00Z",
    consent_partage: false,
    consent_partage_at: "2026-09-20T08:00:00Z",
    consents: [
      {
        id: "cc-1", kind: "traitement", granted: true, statement: "J'accepte…",
        source_app: "iris", source_reference: "DOSSIER-INTERNE-4711",
        collected_at: "2026-09-20T08:00:00Z", created_at: "2026-09-20T08:00:01Z",
      },
      { pas_de_kind: true },
    ],
  };

  it("transmet l'état courant et l'historique, sans la référence du dépôt", () => {
    const c = sanitizeContact(withConsents)!;
    expect(c.consent_traitement).toBe(true);
    expect(c.consent_partage).toBe(false);
    expect(c.consent_traitement_at).toBe("2026-09-20T08:00:00Z");
    expect(c.consents).toEqual([{
      kind: "traitement", granted: true, statement: "J'accepte…",
      source_app: "iris", collected_at: "2026-09-20T08:00:00Z",
    }]);
  });

  it("reste idempotente — repasser la sortie dans le filtre ne perd rien", () => {
    const once = sanitizeContact(withConsents)!;
    expect(sanitizeContact(once)).toEqual(once);
  });

  it("rend un état faux et un historique vide sur une fiche qui n'en porte pas", () => {
    const c = sanitizeContact({ id: "c-4", contact_type: "personne" })!;
    expect(c.consent_traitement).toBe(false);
    expect(c.consent_partage).toBe(false);
    expect(c.consents).toEqual([]);
    expect(c.consent_partage_at).toBeNull();
  });
});
