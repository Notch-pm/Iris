import { describe, expect, it } from "vitest";
import { buildNewRequestInsert, EMPTY_NEW_REQUEST } from "./newRequest";

const base = {
  ...EMPTY_NEW_REQUEST,
  subject: "Nid de poule",
  requesterLastName: "Dupont",
};

describe("buildNewRequestInsert", () => {
  it("refuse un objet vide et une identité absente non anonyme", () => {
    expect(buildNewRequestInsert({ ...base, subject: "  " }, "org")).toMatchObject({ ok: false });
    expect(
      buildNewRequestInsert({ ...base, requesterLastName: "" }, "org"),
    ).toMatchObject({ ok: false });
  });

  it("accepte l'anonymat assumé", () => {
    const r = buildNewRequestInsert({ ...base, requesterLastName: "", anonymous: true }, "org");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.insert.identity_status).toBe("anonyme");
      expect(r.insert.snapshot).toEqual({ requester_declared: { anonymous: true } });
    }
  });

  it("fige l'identité déclarée dans le snapshot, sans champs vides", () => {
    const r = buildNewRequestInsert(
      { ...base, requesterEmail: " marie@exemple.fr ", requesterFirstName: "" },
      "org-1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.insert.snapshot).toEqual({
        requester_declared: { last_name: "Dupont", email: "marie@exemple.fr" },
      });
      expect(r.insert.identity_status).toBe("non_rapprochee");
      expect(r.insert.organization_id).toBe("org-1");
      expect(r.insert.subject).toBe("Nid de poule");
    }
  });

  it("porte la démarche et le destinataire Socle éventuels", () => {
    const r = buildNewRequestInsert(
      { ...base, procedureId: "p-1", procedureLabel: "Signalement voirie", destinationLabel: "Voirie" },
      "org",
    );
    if (r.ok) {
      expect(r.insert.socle_procedure_id).toBe("p-1");
      expect(r.insert.socle_procedure_label).toBe("Signalement voirie");
      expect(r.insert.socle_organization_id).toBeNull();
      expect(r.insert.socle_organization_label).toBe("Voirie");
    }
  });
});
