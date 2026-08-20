import { describe, expect, it } from "vitest";
import { contactIdentitySnapshot, whitelistProcedureSnapshot } from "./snapshots";

describe("whitelistProcedureSnapshot", () => {
  it("whitelist stricte, jamais de knowledge_base, champs inconnus ignorés", () => {
    const snap = whitelistProcedureSnapshot({
      id: "p1", name: "Voirie", type: "externe", category_id: "c1",
      form_schema: { version: 1, content: [] }, requester_config: { citoyen: {} },
      knowledge_base: "SECRET", futur_champ: 1,
    });
    expect(snap).toEqual({
      id: "p1", name: "Voirie", type: "externe", category_id: "c1",
      form_schema: { version: 1, content: [] }, requester_config: { citoyen: {} },
    });
  });

  it("refuse une réponse sans id/name", () => {
    expect(whitelistProcedureSnapshot(null)).toBeNull();
    expect(whitelistProcedureSnapshot({ id: "p1" })).toBeNull();
  });
});

describe("contactIdentitySnapshot", () => {
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
});
