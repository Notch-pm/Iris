import { describe, expect, it } from "vitest";
import {
  buildContactPatch, editableFields, formFromContact, validateUsagerForm, type UsagerForm,
} from "./usagerEdit";
import type { SocleContact } from "./rapprochement";

const CONTACT: SocleContact = {
  id: "c1", contact_type: "personne", status: "active", display_name: "Marie Dupont",
  civility: "madame", first_name: "Marie", last_name: "Martin", usage_name: "Dupont",
  birth_date: "1978-08-21", legal_name: null, siret: null,
  email: "marie@exemple.fr", mobile_phone: "0600000000", landline_phone: null,
  preferred_channel: "email", address_line1: "12 rue des Lilas", address_line2: null,
  postal_code: "44000", city: "Nantes", country: "France",
  quartier: { id: "q1", name: "Bellevue", color: null },
};

const PERSON: UsagerForm = formFromContact(CONTACT);
const STRUCTURE: UsagerForm = {
  ...PERSON,
  civility: "", firstName: "", lastName: "", usageName: "", birthDate: "",
  legalName: "Boulangerie Martin", siret: "12345678900012",
};

describe("formFromContact", () => {
  it("remplace les valeurs nulles par des chaînes vides", () => {
    expect(PERSON.civility).toBe("madame");
    expect(PERSON.landlinePhone).toBe("");
    expect(PERSON.country).toBe("France");
  });
});

describe("editableFields", () => {
  it("n'ouvre pas les champs interdits par le type (CHECK Socle)", () => {
    const person = editableFields("personne");
    expect(person.has("civility")).toBe(true);
    expect(person.has("legalName")).toBe(false);
    expect(person.has("siret")).toBe(false);

    const structure = editableFields("entreprise");
    expect(structure.has("legalName")).toBe(true);
    expect(structure.has("civility")).toBe(false);
    expect(structure.has("birthDate")).toBe(false);
    // Les coordonnées et l'adresse restent communes aux deux.
    expect(structure.has("email")).toBe(true);
    expect(person.has("email")).toBe(true);
  });
});

describe("validateUsagerForm", () => {
  it("accepte une fiche complète", () => {
    expect(validateUsagerForm(PERSON, "personne")).toEqual({});
    expect(validateUsagerForm(STRUCTURE, "entreprise")).toEqual({});
  });

  it("exige la civilité d'un citoyen (invariant Socle)", () => {
    expect(validateUsagerForm({ ...PERSON, civility: "" }, "personne"))
      .toMatchObject({ civility: "Obligatoire pour un citoyen." });
  });

  it("refuse un citoyen sans aucun nom, mais pas l'absence du seul nom de naissance", () => {
    expect(validateUsagerForm({ ...PERSON, lastName: "" }, "personne")).toEqual({});
    expect(validateUsagerForm({ ...PERSON, lastName: "", usageName: "", firstName: "" }, "personne"))
      .toMatchObject({ lastName: "Renseignez au moins un nom : naissance, usage ou prénom." });
  });

  it("exige la raison sociale d'une structure et un SIRET à 14 chiffres", () => {
    expect(validateUsagerForm({ ...STRUCTURE, legalName: "" }, "entreprise"))
      .toMatchObject({ legalName: "La raison sociale est obligatoire." });
    expect(validateUsagerForm({ ...STRUCTURE, siret: "123" }, "entreprise"))
      .toMatchObject({ siret: "SIRET : 14 chiffres attendus." });
    // SIRET vide : autorisé (le Socle ne l'impose pas).
    expect(validateUsagerForm({ ...STRUCTURE, siret: "" }, "entreprise")).toEqual({});
  });

  it("contrôle la date de naissance, le courriel et le pays", () => {
    expect(validateUsagerForm({ ...PERSON, birthDate: "21/08/1978" }, "personne"))
      .toMatchObject({ birthDate: "Date attendue au format AAAA-MM-JJ." });
    expect(validateUsagerForm({ ...PERSON, email: "marie chez exemple" }, "personne"))
      .toMatchObject({ email: "Adresse électronique invalide." });
    expect(validateUsagerForm({ ...PERSON, country: "  " }, "personne"))
      .toMatchObject({ country: "Le pays ne peut pas être vidé." });
  });
});

describe("buildContactPatch", () => {
  it("ne transmet que les champs réellement modifiés", () => {
    const patch = buildContactPatch(PERSON, { ...PERSON, city: "Rezé" }, "personne");
    expect(patch).toEqual({ city: "Rezé" });
  });

  it("efface un champ vidé (null) et ignore les espaces autour", () => {
    expect(buildContactPatch(PERSON, { ...PERSON, mobilePhone: "" }, "personne"))
      .toEqual({ mobile_phone: null });
    expect(buildContactPatch(PERSON, { ...PERSON, city: "  Nantes  " }, "personne")).toEqual({});
  });

  it("normalise le SIRET et ne compare qu'en chiffres", () => {
    expect(buildContactPatch(STRUCTURE, { ...STRUCTURE, siret: "123 456 789 000 12" }, "entreprise"))
      .toEqual({});
    expect(buildContactPatch(STRUCTURE, { ...STRUCTURE, siret: "98765432100019" }, "entreprise"))
      .toEqual({ siret: "98765432100019" });
  });

  it("n'envoie jamais un champ interdit par le type, même modifié", () => {
    expect(buildContactPatch(PERSON, { ...PERSON, legalName: "SARL X", siret: "1" }, "personne"))
      .toEqual({});
    expect(buildContactPatch(STRUCTURE, { ...STRUCTURE, civility: "madame" }, "entreprise"))
      .toEqual({});
  });

  it("rend un patch vide quand rien ne change", () => {
    expect(buildContactPatch(PERSON, PERSON, "personne")).toEqual({});
  });
});
