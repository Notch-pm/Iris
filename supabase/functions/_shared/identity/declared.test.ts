import { describe, expect, it } from "vitest";
import {
  ALL_DECLARED_KEYS,
  contactCreatePayload,
  contactIdentitySnapshot,
  declaredContactType,
  hasDeclaredIdentity,
  hasStrongMatch,
  matchIdentityFromDeclared,
  pickDeclared,
} from "./declared";

describe("pickDeclared — les trois écritures d'une même identité", () => {
  it("lit indifféremment contacts-api, publics Iris et synonymes partenaires", () => {
    expect(pickDeclared({ email: "a@b.fr" }, "email")).toBe("a@b.fr");
    expect(pickDeclared({ courriel: "a@b.fr" }, "email")).toBe("a@b.fr");
    expect(pickDeclared({ mail: "a@b.fr" }, "email")).toBe("a@b.fr");
  });

  it("respecte l'ordre de priorité et ignore les vides", () => {
    expect(pickDeclared({ last_name: "Durand", nom: "Dupont" }, "lastName")).toBe("Durand");
    expect(pickDeclared({ last_name: "   ", nom: "Dupont" }, "lastName")).toBe("Dupont");
  });

  it("tolère tout ce qui n'est pas un objet de chaînes", () => {
    expect(pickDeclared(null, "email")).toBeNull();
    expect(pickDeclared("boom", "email")).toBeNull();
    expect(pickDeclared({ email: 42 }, "email")).toBeNull();
  });

  it("expose toutes les clés à plat, sans doublon", () => {
    expect(ALL_DECLARED_KEYS).toContain("nom_usuel");
    expect(ALL_DECLARED_KEYS).toContain("display_name");
    expect(new Set(ALL_DECLARED_KEYS).size).toBe(ALL_DECLARED_KEYS.length);
  });
});

describe("hasDeclaredIdentity — rien envoyé, ou envoyé mais inexploitable", () => {
  it("reconnaît une identité même impossible à rattacher", () => {
    expect(hasDeclaredIdentity({ prenoms: "Madeleine" })).toBe(true);
    expect(hasDeclaredIdentity({ civilite: "madame" })).toBe(true);
  });

  it("ne voit rien dans le vide ni dans des clés hors catalogue", () => {
    expect(hasDeclaredIdentity(null)).toBe(false);
    expect(hasDeclaredIdentity({})).toBe(false);
    expect(hasDeclaredIdentity({ contact_type: "personne", prenoms: "  " })).toBe(false);
    expect(hasDeclaredIdentity({ anonymous: false, inconnu: "x" })).toBe(false);
  });
});

describe("matchIdentityFromDeclared — un nom d'usage seul se cherche", () => {
  it("cherche sur le nom d'usage et le courriel sans nom de naissance", () => {
    expect(matchIdentityFromDeclared({
      civilite: "madame", prenoms: "Madeleine", nom_usuel: "Lefevre", courriel: "m@b.fr",
    })).toEqual({
      contact_type: "personne",
      usage_name: "Lefevre",
      first_name: "Madeleine",
      email: "m@b.fr",
    });
  });
});

describe("declaredContactType", () => {
  it("fait une structure d'une raison sociale ou d'un SIRET", () => {
    expect(declaredContactType({ raison_sociale: "Boulangerie" })).toBe("entreprise");
    expect(declaredContactType({ siret: "12345678900012" })).toBe("entreprise");
  });
  it("fait une personne de tout le reste", () => {
    expect(declaredContactType({ nom_naissance: "Durand" })).toBe("personne");
    expect(declaredContactType({})).toBe("personne");
  });
  it("respecte un type explicite du partenaire", () => {
    expect(declaredContactType({ contact_type: "association", raison_sociale: "X" })).toBe("association");
  });
});

describe("matchIdentityFromDeclared", () => {
  it("compose les critères depuis n'importe quelle écriture", () => {
    expect(matchIdentityFromDeclared({
      nom_naissance: "Durand", prenoms: "Marie", courriel: "m@b.fr", tel_portable: "0600000000",
    })).toEqual({
      contact_type: "personne",
      last_name: "Durand",
      first_name: "Marie",
      email: "m@b.fr",
      phones: ["0600000000"],
    });
  });

  it("récupère un partenaire qui n'envoie qu'un display_name", () => {
    expect(matchIdentityFromDeclared({ display_name: "Marie Durand" })?.last_name).toBe("Marie Durand");
  });

  it("refuse une recherche sans le moindre discriminant", () => {
    expect(matchIdentityFromDeclared({})).toBeNull();
    expect(matchIdentityFromDeclared({ civilite: "madame" })).toBeNull();
    expect(matchIdentityFromDeclared(null)).toBeNull();
  });
});

describe("hasStrongMatch — la garde contre le rattachement à un homonyme", () => {
  it("accepte les identifiants forts", () => {
    expect(hasStrongMatch(["email_exact"])).toBe(true);
    expect(hasStrongMatch(["name_similar", "phone_exact"])).toBe(true);
    expect(hasStrongMatch(["siret_exact"])).toBe(true);
  });

  it("REFUSE tout ce qui repose sur le seul nom", () => {
    // Sans agent pour arbitrer, rattacher la demande d'un habitant à son
    // homonyme lui donnerait accès aux échanges d'un autre : pire qu'un doublon.
    expect(hasStrongMatch(["name_exact"])).toBe(false);
    expect(hasStrongMatch(["name_exact", "name_similar", "usage_name_match"])).toBe(false);
    expect(hasStrongMatch(["legal_name_exact"])).toBe(false);
  });

  it("refuse une entrée absente ou malformée", () => {
    expect(hasStrongMatch(undefined)).toBe(false);
    expect(hasStrongMatch("email_exact")).toBe(false);
    expect(hasStrongMatch([null, 42])).toBe(false);
  });
});

describe("contactCreatePayload", () => {
  it("compose une personne, clés vides retirées", () => {
    expect(contactCreatePayload({
      civilite: "madame", nom_naissance: "Durand", nom_usuel: "Martin",
      prenoms: "Marie", courriel: "m@b.fr", tel_fixe: "",
    })).toEqual({
      contact_type: "personne",
      last_name: "Durand",
      usage_name: "Martin",
      first_name: "Marie",
      civility: "madame",
      email: "m@b.fr",
    });
  });

  it("compose une structure", () => {
    expect(contactCreatePayload({ raison_sociale: "Boulangerie", siret: "12345678900012" })).toEqual({
      contact_type: "entreprise",
      legal_name: "Boulangerie",
      siret: "12345678900012",
    });
  });

  it("crée une personne nommée par son SEUL nom d'usage (dépôt Nora, 2026-09-23)", () => {
    // Le Socle n'exige pas de nom de naissance ; le nom d'usage n'est pas
    // recopié en last_name, ce serait affirmer un nom de naissance.
    expect(contactCreatePayload({
      civilite: "madame", prenoms: "Madeleine", nom_usuel: "Lefevre",
      courriel: "m@b.fr", contact_type: "personne",
    })).toEqual({
      contact_type: "personne",
      usage_name: "Lefevre",
      first_name: "Madeleine",
      civility: "madame",
      email: "m@b.fr",
    });
  });

  it("replie l'adresse libre d'un partenaire sur address_line1", () => {
    const payload = contactCreatePayload({ nom: "Durand", adresse: "10 rue des Lilas" });
    expect(payload?.address_line1).toBe("10 rue des Lilas");
  });

  it("préfère address_line1 quand les deux sont là", () => {
    const payload = contactCreatePayload({
      nom: "Durand", address_line1: "10 rue des Lilas", adresse: "ancienne saisie",
    });
    expect(payload?.address_line1).toBe("10 rue des Lilas");
  });

  it("refuse de créer une fiche que rien ne nomme", () => {
    // Une fiche sans nom ne sert personne, et le Socle la refuserait.
    expect(contactCreatePayload({ courriel: "m@b.fr" })).toBeNull();
    expect(contactCreatePayload({ prenoms: "Madeleine", courriel: "m@b.fr" })).toBeNull();
    expect(contactCreatePayload({ contact_type: "entreprise", siret: "12345678900012" })).toBeNull();
    expect(contactCreatePayload({})).toBeNull();
  });

  it("ne laisse JAMAIS passer une clé hors whitelist", () => {
    const payload = contactCreatePayload({
      nom: "Durand", internal_notes: "confidentiel", status: "archive", id: "usurpé",
    });
    expect(payload).not.toHaveProperty("internal_notes");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("id");
  });
});

describe("contactIdentitySnapshot — l'identité figée au dépôt", () => {
  it("ne retient que l'identité — internal_notes et consentements exclus", () => {
    const snap = contactIdentitySnapshot({
      id: "c1", display_name: "Dupont Jeanne", first_name: "Jeanne", last_name: "Dupont",
      email: "j@e.fr", internal_notes: "FUITE", consents: [{}], relations: [{}],
      quartier: { id: "q" }, mobile_phone: "", city: "Arles",
    });
    expect(snap).toEqual({
      display_name: "Dupont Jeanne", first_name: "Jeanne", last_name: "Dupont",
      email: "j@e.fr", city: "Arles",
    });
    expect(snap).not.toHaveProperty("internal_notes");
  });

  it("refuse une fiche sans id", () => {
    expect(contactIdentitySnapshot({ last_name: "X" })).toBeNull();
    expect(contactIdentitySnapshot(null)).toBeNull();
  });

  it("ne produit que des clés relisibles par pickDeclared", () => {
    // Le contrat implicite entre les deux : ce que le snapshot écrit,
    // `requesterIdentity` doit savoir le relire.
    const snap = contactIdentitySnapshot({ id: "c1", usage_name: "Martin", courriel: "ignoré" })!;
    expect(Object.keys(snap).every((k) => ALL_DECLARED_KEYS.includes(k))).toBe(true);
    expect(snap).toEqual({ usage_name: "Martin" });
  });
});
