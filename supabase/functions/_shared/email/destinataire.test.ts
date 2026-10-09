import { describe, expect, it } from "vitest";
import { declaredIdentity, recipientIdentity } from "./destinataire.ts";

describe("declaredIdentity", () => {
  it("préfère le nom d'usage au nom de naissance", () => {
    expect(declaredIdentity({
      first_name: "Marie", last_name: "Martin", usage_name: "Durand",
      email: "marie@exemple.fr", civility: "madame",
    })).toEqual({ email: "marie@exemple.fr", civility: "madame", fullName: "Marie Durand" });
  });
  it("retombe sur la raison sociale", () => {
    expect(declaredIdentity({ legal_name: "Boulangerie Durand" }).fullName).toBe("Boulangerie Durand");
  });
});

describe("recipientIdentity", () => {
  const snapshot = { declared: { first_name: "Marie", last_name: "Durand", email: "marie@exemple.fr" } };

  it("lit l'identité déclarée au dépôt", () => {
    expect(recipientIdentity(snapshot, "declaree").email).toBe("marie@exemple.fr");
  });
  it("n'écrit à personne pour un dépôt anonyme, quel que soit le snapshot", () => {
    expect(recipientIdentity(snapshot, "anonyme").email).toBeNull();
    expect(recipientIdentity({ declared: { anonymous: true, email: "x@y.fr" } }, "declaree").email)
      .toBeNull();
  });
  it("tolère un snapshot inexploitable", () => {
    expect(recipientIdentity(null, "declaree")).toEqual({ email: null, civility: null, fullName: null });
  });
});
