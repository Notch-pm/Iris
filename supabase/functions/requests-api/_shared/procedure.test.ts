import { describe, expect, it } from "vitest";
import { degradedProcedureSnapshot, whitelistProcedureSnapshot } from "./procedure";

describe("whitelistProcedureSnapshot", () => {
  it("ne retient que les champs de la whitelist (tolérant aux champs inconnus)", () => {
    const snap = whitelistProcedureSnapshot({
      id: "p-1",
      name: "Acte de naissance",
      type: "externe",
      category_id: "c-1",
      form_schema: { version: 1, content: [] },
      requester_config: { citoyen: { enabled: true } },
      knowledge_base: { agent_help: "réservé aux agents Socle" },
      internal_notes: "jamais",
      champ_futur_inconnu: 42,
    });
    expect(snap).toEqual({
      id: "p-1",
      name: "Acte de naissance",
      type: "externe",
      category_id: "c-1",
      form_schema: { version: 1, content: [] },
      requester_config: { citoyen: { enabled: true } },
    });
    expect(snap).not.toHaveProperty("knowledge_base");
    expect(snap).not.toHaveProperty("internal_notes");
  });

  it("rejette une réponse sans id ou nom", () => {
    expect(whitelistProcedureSnapshot(null)).toBeNull();
    expect(whitelistProcedureSnapshot({ name: "x" })).toBeNull();
    expect(whitelistProcedureSnapshot({ id: "p" })).toBeNull();
  });
});

describe("degradedProcedureSnapshot", () => {
  it("construit un snapshot minimal marqué degraded depuis le cache", () => {
    const snap = degradedProcedureSnapshot({
      socle_id: "p-1",
      name: "Voirie",
      type: "externe",
      category_socle_id: "c-2",
    });
    expect(snap).toEqual({
      id: "p-1",
      name: "Voirie",
      type: "externe",
      category_id: "c-2",
      form_schema: null,
      requester_config: null,
      degraded: true,
    });
  });
});
