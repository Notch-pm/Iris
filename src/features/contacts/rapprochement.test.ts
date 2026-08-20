import { describe, expect, it } from "vitest";
import {
  audienceContactType,
  buildContactCreatePayload,
  buildMatchIdentity,
  candidateSummary,
  duplicateCheckIdentity,
  EMPTY_NEW_CONTACT,
  isNameOnlyMatch,
  newContactFromDeclared,
  reasonLabel,
  resolutionSummary,
  type SocleContact,
} from "./rapprochement";

const CONTACT: SocleContact = {
  id: "c-1", contact_type: "personne", status: "active",
  display_name: "Dupont Jeanne", civility: "madame",
  first_name: "Jeanne", last_name: "Dupont", usage_name: null, birth_date: "1985-03-12",
  legal_name: null, siret: null,
  email: "jeanne@exemple.fr", mobile_phone: "0612345678", landline_phone: null,
  preferred_channel: null,
  address_line1: "12 rue des Lilas", address_line2: null, postal_code: "13200", city: "Arles",
  country: "France", quartier: { id: "q", name: "Centre", color: null },
};

describe("buildMatchIdentity", () => {
  it("mappe l'identité déclarée citoyen vers les critères Socle", () => {
    const r = buildMatchIdentity("citoyen", {
      nom_naissance: " Dupont ", prenoms: "Jeanne", courriel: "j@e.fr",
      tel_portable: "0612345678", tel_fixe: "",
    }, "1985-03-12");
    expect(r).toEqual({
      ok: true,
      identity: {
        contact_type: "personne", last_name: "Dupont", first_name: "Jeanne",
        email: "j@e.fr", phones: ["0612345678"], birth_date: "1985-03-12",
      },
    });
  });

  it("mappe raison sociale et SIRET pour les organisations", () => {
    const r = buildMatchIdentity("entreprise", { raison_sociale: "Boulangerie X", siret: "123" });
    expect(r).toEqual({
      ok: true,
      identity: { contact_type: "entreprise", legal_name: "Boulangerie X", siret: "123" },
    });
  });

  it("refuse une recherche sans discriminant ou avec date invalide", () => {
    expect(buildMatchIdentity("citoyen", { civilite: "Madame" })).toMatchObject({ ok: false });
    expect(buildMatchIdentity("citoyen", { nom_naissance: "Dupont" }, "12/03/1985"))
      .toMatchObject({ ok: false });
  });
});

describe("présentation des candidats", () => {
  it("candidateSummary ne retient que les informations distinctives", () => {
    const s = candidateSummary(CONTACT);
    expect(s.title).toBe("Dupont Jeanne");
    expect(s.details).toEqual([
      "Né(e) le 12/03/1985", "jeanne@exemple.fr", "0612345678",
      "12 rue des Lilas, 13200 Arles", "Quartier Centre",
    ]);
  });

  it("tolère une fiche minimale et un contact inconnu", () => {
    const minimal = candidateSummary({ ...CONTACT, display_name: null, last_name: null,
      first_name: null, birth_date: null, email: null, mobile_phone: null,
      address_line1: null, postal_code: null, city: null, quartier: null });
    expect(minimal.title).toBe("Usager sans nom");
    expect(minimal.details).toEqual([]);
  });

  it("reasonLabel traduit les raisons connues, relaie les inconnues", () => {
    expect(reasonLabel("name_similar")).toBe("Nom similaire");
    expect(reasonLabel("raison_future_socle")).toBe("raison_future_socle");
  });

  it("isNameOnlyMatch : vrai sur le seul nom — jamais suffisant", () => {
    expect(isNameOnlyMatch(["name_similar"])).toBe(true);
    expect(isNameOnlyMatch(["legal_name_similar"])).toBe(true);
    expect(isNameOnlyMatch(["name_similar", "email_exact"])).toBe(false);
    expect(isNameOnlyMatch([])).toBe(true);
  });
});

describe("création d'un usager", () => {
  it("exige le nom (citoyen) ou la raison sociale (organisation)", () => {
    expect(buildContactCreatePayload("citoyen", EMPTY_NEW_CONTACT)).toMatchObject({ ok: false });
    expect(buildContactCreatePayload("entreprise", EMPTY_NEW_CONTACT)).toMatchObject({ ok: false });
  });

  it("ne produit que des clés whitelisted non vides — jamais d'internal_notes", () => {
    const r = buildContactCreatePayload("citoyen", {
      ...EMPTY_NEW_CONTACT, civilite: "Madame", lastName: " Dupont ", firstName: "Jeanne",
      birthDate: "1985-03-12", email: "j@e.fr",
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        contact_type: "personne", civility: "madame", last_name: "Dupont",
        first_name: "Jeanne", birth_date: "1985-03-12", email: "j@e.fr",
      },
    });
  });

  it("payload organisation : legal_name/siret, pas de champs citoyen", () => {
    const r = buildContactCreatePayload("association", {
      ...EMPTY_NEW_CONTACT, legalName: "Les Amis", siret: "123", lastName: "ignoré",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({ contact_type: "association", legal_name: "Les Amis", siret: "123" });
    }
  });

  it("newContactFromDeclared pré-remplit depuis l'identité déclarée", () => {
    const form = newContactFromDeclared({ nom_naissance: "Dupont", courriel: "j@e.fr" }, "1985-03-12");
    expect(form.lastName).toBe("Dupont");
    expect(form.email).toBe("j@e.fr");
    expect(form.birthDate).toBe("1985-03-12");
  });

  it("duplicateCheckIdentity rejoue les mêmes critères que la recherche", () => {
    const r = duplicateCheckIdentity("citoyen", {
      ...EMPTY_NEW_CONTACT, lastName: "Dupont", email: "j@e.fr", birthDate: "1985-03-12",
    });
    expect(r).toEqual({
      ok: true,
      identity: { contact_type: "personne", last_name: "Dupont", email: "j@e.fr", birth_date: "1985-03-12" },
    });
  });
});

describe("résolution", () => {
  it("résume chaque issue pour le récapitulatif", () => {
    expect(resolutionSummary({ kind: "anonyme" })).toContain("anonyme");
    expect(resolutionSummary({ kind: "contact", audience: "citoyen", contact: CONTACT }))
      .toBe("Dupont Jeanne — usager Socle rapproché");
    expect(resolutionSummary({
      kind: "sans_rapprochement", audience: "citoyen",
      declared: { nom_naissance: "Martin", prenoms: "Paul" },
    })).toBe("Martin Paul — sans rapprochement (assumé)");
  });

  it("audienceContactType mappe citoyen → personne", () => {
    expect(audienceContactType("citoyen")).toBe("personne");
    expect(audienceContactType("entreprise")).toBe("entreprise");
  });
});
