import { describe, expect, it } from "vitest";
import { buildNewRequestInsert, EMPTY_NEW_REQUEST } from "./newRequest";

const SNAP = { id: "p-1", name: "Signalement voirie", form_schema: { version: 1, content: [] } };
const base = {
  ...EMPTY_NEW_REQUEST,
  subject: "Nid de poule",
  procedureId: "p-1",
  procedureLabel: "Signalement voirie",
  requesterLastName: "Dupont",
};

describe("buildNewRequestInsert — aucune demande libre", () => {
  it("refuse un objet vide et une identité absente non anonyme", () => {
    expect(buildNewRequestInsert({ ...base, subject: "  " }, "org", SNAP)).toMatchObject({ ok: false });
    expect(buildNewRequestInsert({ ...base, requesterLastName: "" }, "org", SNAP)).toMatchObject({ ok: false });
  });

  it("refuse une demande sans démarche Socle", () => {
    const r = buildNewRequestInsert({ ...base, procedureId: null }, "org", SNAP);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("démarche Socle");
  });

  it("refuse un snapshot absent ou incohérent avec la démarche", () => {
    expect(buildNewRequestInsert(base, "org", null)).toMatchObject({ ok: false });
    expect(buildNewRequestInsert(base, "org", { id: "autre" })).toMatchObject({ ok: false });
  });

  it("écrit procedure_snapshot et requester_snapshot (identité figée)", () => {
    const r = buildNewRequestInsert(
      { ...base, requesterEmail: " marie@exemple.fr ", requesterFirstName: "" },
      "org-1",
      SNAP,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.insert.procedure_snapshot).toEqual(SNAP);
      expect(r.insert.requester_snapshot).toEqual({
        declared: { last_name: "Dupont", email: "marie@exemple.fr" },
        socle_contact_id: null,
      });
      expect(r.insert.socle_procedure_id).toBe("p-1");
      expect(r.insert).not.toHaveProperty("snapshot");
      expect(r.insert).not.toHaveProperty("socle_procedure_label");
    }
  });

  it("accepte l'anonymat assumé", () => {
    const r = buildNewRequestInsert({ ...base, requesterLastName: "", anonymous: true }, "org", SNAP);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.insert.identity_status).toBe("anonyme");
      expect(r.insert.requester_snapshot).toEqual({
        declared: { anonymous: true },
        socle_contact_id: null,
      });
    }
  });
});
