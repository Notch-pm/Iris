import { describe, expect, it } from "vitest";
import {
  audienceContactType,
  contactAudience,
  buildContactCreatePayload,
  buildMatchIdentity,
  candidateSummary,
  declaredFromNewContact,
  duplicateCheckIdentity,
  EMPTY_NEW_CONTACT,
  isNameOnlyMatch,
  isSocleOutage,
  liveSearchIdentity,
  newContactFromDeclared,
  reasonLabel,
  resolutionSummary,
  type SocleContact,
} from "./rapprochement";

describe("liveSearchIdentity", () => {
  it("n'interroge pas le Socle sur une lettre isolée", () => {
    expect(liveSearchIdentity("citoyen", { nom_naissance: "D" })).toBeNull();
    expect(liveSearchIdentity("entreprise", { raison_sociale: "A" })).toBeNull();
  });

  it("déclenche dès deux caractères de nom", () => {
    expect(liveSearchIdentity("citoyen", { nom_naissance: "Du" }))
      .toEqual({ contact_type: "personne", last_name: "Du" });
  });

  it("un identifiant fort suffit seul", () => {
    expect(liveSearchIdentity("citoyen", { courriel: "k@exemple.fr" }))
      .toEqual({ contact_type: "personne", email: "k@exemple.fr" });
    expect(liveSearchIdentity("association", { siret: "12345678900011" }))
      .toEqual({ contact_type: "association", siret: "12345678900011" });
  });

  it("rien sans discriminant ; une clé hors contrat est ignorée", () => {
    expect(liveSearchIdentity("citoyen", { prenoms: "Karim" })).toBeNull();
    expect(liveSearchIdentity("citoyen", { nom_naissance: "Dupont", date_naissance: "1980" }))
      .toEqual({ contact_type: "personne", last_name: "Dupont" });
  });
});

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
    });
    expect(r).toEqual({
      ok: true,
      identity: {
        contact_type: "personne", last_name: "Dupont", first_name: "Jeanne",
        email: "j@e.fr", phones: ["0612345678"],
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

  it("refuse une recherche sans discriminant", () => {
    expect(buildMatchIdentity("citoyen", { civilite: "Madame" })).toMatchObject({ ok: false });
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
      email: "j@e.fr",
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        contact_type: "personne", civility: "madame", last_name: "Dupont",
        first_name: "Jeanne", email: "j@e.fr",
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
    const form = newContactFromDeclared({ nom_naissance: "Dupont", courriel: "j@e.fr" });
    expect(form.lastName).toBe("Dupont");
    expect(form.email).toBe("j@e.fr");
  });

  it("duplicateCheckIdentity rejoue les mêmes critères que la recherche", () => {
    const r = duplicateCheckIdentity("citoyen", {
      ...EMPTY_NEW_CONTACT, lastName: "Dupont", email: "j@e.fr",
    });
    expect(r).toEqual({
      ok: true,
      identity: { contact_type: "personne", last_name: "Dupont", email: "j@e.fr" },
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

  it("contactAudience refait le chemin inverse, sauf pour administration", () => {
    expect(contactAudience("personne")).toBe("citoyen");
    expect(contactAudience("entreprise")).toBe("entreprise");
    expect(contactAudience("association")).toBe("association");
    expect(contactAudience("administration")).toBeNull();
    expect(contactAudience(null)).toBeNull();
  });
});

describe("isSocleOutage — panne AVÉRÉE contre refus métier", () => {
  const withCode = (code: string) => Object.assign(new Error("peu importe"), { code });

  it("reconnaît une panne du Socle", () => {
    expect(isSocleOutage(withCode("socle_unavailable"))).toBe(true);
    expect(isSocleOutage(withCode("socle_auth_failed"))).toBe(true);
    expect(isSocleOutage(withCode("socle_error"))).toBe(true);
  });

  it("traite une erreur SANS code comme une panne (l'edge function n'a pas répondu)", () => {
    expect(isSocleOutage(new Error("Serveur injoignable — réessayez dans un instant."))).toBe(true);
  });

  it("ne prend PAS un refus métier pour une panne — il se corrige au formulaire", () => {
    // C'est le cœur de la règle : un SIRET déjà pris ne doit jamais rouvrir
    // « Poursuivre sans rapprochement », sinon la porte se contourne à volonté.
    expect(isSocleOutage(withCode("conflict"))).toBe(false);
    expect(isSocleOutage(withCode("bad_request"))).toBe(false);
    expect(isSocleOutage(withCode("forbidden"))).toBe(false);
    expect(isSocleOutage(withCode("not_found"))).toBe(false);
  });

  it("ignore ce qui n'est pas une erreur", () => {
    expect(isSocleOutage(null)).toBe(false);
    expect(isSocleOutage("socle_unavailable")).toBe(false);
  });
});

describe("declaredFromNewContact — la saisie de création part en identité déclarée", () => {
  it("retourne les clés du contrat, les vides retirées", () => {
    const declared = declaredFromNewContact({
      ...EMPTY_NEW_CONTACT,
      civilite: "madame", lastName: "Durand", firstName: " Marie ", email: "m@example.fr",
    });
    expect(declared).toEqual({
      civilite: "madame", nom_naissance: "Durand", prenoms: "Marie", courriel: "m@example.fr",
    });
  });

  it("recompose l'adresse : code postal et ville n'ont pas de clé au contrat", () => {
    const declared = declaredFromNewContact({
      ...EMPTY_NEW_CONTACT,
      lastName: "Durand", addressLine1: "10 rue des Lilas", postalCode: "44000", city: "Nantes",
    });
    expect(declared.adresse).toBe("10 rue des Lilas, 44000 Nantes");
  });

  it("n'invente pas d'adresse quand rien n'est saisi", () => {
    const declared = declaredFromNewContact({ ...EMPTY_NEW_CONTACT, legalName: "Boulangerie" });
    expect(declared).toEqual({ raison_sociale: "Boulangerie" });
  });

  it("fait l'aller-retour avec newContactFromDeclared sur les champs partagés", () => {
    const source = { nom_naissance: "Durand", prenoms: "Marie", courriel: "m@example.fr" };
    expect(declaredFromNewContact(newContactFromDeclared(source))).toEqual(source);
  });
});
