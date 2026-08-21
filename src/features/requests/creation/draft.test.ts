import { describe, expect, it } from "vitest";
import {
  DRAFT_VERSION,
  draftRequesterFromResolution,
  draftStorageKey,
  parseDraft,
  savedAgoLabel,
  serializeDraft,
  type CreationDraft,
} from "./draft";
import type { SocleContact } from "@/features/contacts/rapprochement";

const PROC = "216fe968-f077-47b4-bd3e-8f856749ea13";
const DRAFT_ID = "8b1b2b1e-1b1e-4b1e-8b1e-1b1e1b1e1b1e";
const CONTACT_ID = "5a7a3f2c-2222-4333-8444-555566667777";

const FULL: CreationDraft = {
  v: DRAFT_VERSION,
  savedAt: "2026-08-21T10:00:00.000Z",
  draftId: DRAFT_ID,
  step: 3,
  procedureId: PROC,
  destinationId: "",
  requester: { kind: "contact", audience: "citoyen", socleContactId: CONTACT_ID },
  subject: "Signalement voirie",
  body: "",
  priority: "haute",
  values: { "f-1": "rue des Lilas", "f-2": true },
  linked: [{ id: DRAFT_ID, reference: "DEM-2026-0004" }],
  dupDismissed: true,
};

describe("parseDraft", () => {
  it("aller-retour complet", () => {
    expect(parseDraft(serializeDraft(FULL))).toEqual(FULL);
  });

  it("refuse JSON invalide, version inconnue, démarche ou identifiants manquants", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...FULL, v: 99 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...FULL, procedureId: "" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...FULL, draftId: "pas-un-uuid" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...FULL, savedAt: "hier" }))).toBeNull();
  });

  it("tolère les champs secondaires absents ou invalides", () => {
    const parsed = parseDraft(JSON.stringify({
      v: 1, savedAt: FULL.savedAt, draftId: DRAFT_ID, procedureId: PROC,
      step: 9, requester: { kind: "contact", audience: "martien", socleContactId: CONTACT_ID },
      linked: [{ id: "x" }, { id: DRAFT_ID, reference: "DEM-1" }], values: "nope",
    }));
    expect(parsed).toEqual({
      v: 1, savedAt: FULL.savedAt, draftId: DRAFT_ID, step: 1, procedureId: PROC,
      destinationId: "", requester: null, subject: "", body: "", priority: "normale",
      values: {}, linked: [{ id: DRAFT_ID, reference: "DEM-1" }], dupDismissed: false,
    });
  });

  it("n'accepte qu'un identifiant de contact bien formé (jamais une fiche)", () => {
    const parsed = parseDraft(JSON.stringify({
      ...FULL, requester: { kind: "contact", audience: "citoyen", socleContactId: "42" },
    }));
    expect(parsed?.requester).toBeNull();
  });

  it("épure une identité déclarée aux seules chaînes", () => {
    const parsed = parseDraft(JSON.stringify({
      ...FULL, requester: { kind: "sans_rapprochement", audience: "entreprise", declared: { raison_sociale: "ACME", n: 3 } },
    }));
    expect(parsed?.requester).toEqual({ kind: "sans_rapprochement", audience: "entreprise", declared: { raison_sociale: "ACME" } });
  });
});

describe("draftRequesterFromResolution", () => {
  const contact = { id: CONTACT_ID, display_name: "Durand Marie" } as SocleContact;
  it("ne conserve que l'identifiant d'un contact rapproché", () => {
    expect(draftRequesterFromResolution({ kind: "contact", audience: "citoyen", contact }))
      .toEqual({ kind: "contact", audience: "citoyen", socleContactId: CONTACT_ID });
  });
  it("transporte l'identité déclarée et l'anonymat", () => {
    expect(draftRequesterFromResolution({ kind: "sans_rapprochement", audience: "citoyen", declared: { nom_naissance: "Durand" } }))
      .toEqual({ kind: "sans_rapprochement", audience: "citoyen", declared: { nom_naissance: "Durand" } });
    expect(draftRequesterFromResolution({ kind: "anonyme" })).toEqual({ kind: "anonyme" });
    expect(draftRequesterFromResolution(null)).toBeNull();
  });
});

describe("savedAgoLabel / draftStorageKey", () => {
  const now = new Date("2026-08-21T10:01:00.000Z");
  it("gradue l'ancienneté", () => {
    expect(savedAgoLabel(null, now)).toBe("Brouillon non enregistré");
    expect(savedAgoLabel("2026-08-21T10:00:58.000Z", now)).toBe("Brouillon enregistré à l'instant");
    expect(savedAgoLabel("2026-08-21T10:00:40.000Z", now)).toBe("Brouillon enregistré il y a 20 s");
    expect(savedAgoLabel("2026-08-21T09:58:00.000Z", now)).toBe("Brouillon enregistré il y a 3 min");
    expect(savedAgoLabel("2026-08-21T07:58:00.000Z", now)).toMatch(/^Brouillon enregistré à \d{2}:\d{2}$/);
  });
  it("clé par tenant et utilisateur", () => {
    expect(draftStorageKey("org", "user")).toBe("iris.draft.org.user");
  });
});
