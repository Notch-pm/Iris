import { describe, expect, it } from "vitest";
import { whitelistProcedureSnapshot } from "./snapshots";

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
