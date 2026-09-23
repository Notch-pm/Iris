import { describe, expect, it } from "vitest";
import { eventDetail, serializeTimeline, timelineUserIds, userDisplayName } from "./timeline";

const AGENT = "656d7ff8-3775-4422-a72a-0b1e8f0f6e68";
const TECH = "146d1292-3c5d-4054-b3aa-aac98f00e862";
const names = new Map([
  [AGENT, "Claire Agent"],
  [TECH, "Dominique Servtech"],
]);

const request = {
  id: "0f0f0f0f-0000-4000-8000-000000000001",
  reference: "DEM-2026-000042",
  status: "en_instruction",
  version: 3,
  source: "portail-citoyen",
  external_ref: null,
  socle_root_org_id: "11111111-1111-1111-1111-111111111111",
  socle_organization_id: null,
  socle_procedure_id: null,
  socle_contact_id: null,
  subject: "Nid de poule",
  body: "Devant le 12 rue Carnot.",
  priority: "normale",
  closure_motif: null,
  closure_text: null,
  received_at: "2026-09-01T10:00:00Z",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-02T10:00:00Z",
  closed_at: null,
  form_data: { secret: "ne sort pas" },
  requester_snapshot: { email: "usager@exemple.fr" },
};

describe("eventDetail — liste blanche par type", () => {
  it("nomme l'agent affecté au lieu de son UUID", () => {
    expect(eventDetail("assigned", { to: AGENT, from: null }, names)).toEqual({ to: "Claire Agent" });
  });

  it("garde les libellés d'un transfert, pas les UUID d'organisations", () => {
    const d = eventDetail("transferred", { from: "a", to: "b", from_label: "Mairie A", to_label: "Mairie B" }, names);
    expect(d).toEqual({ from: "Mairie A", to: "Mairie B" });
  });

  it("un type inconnu sort sans rien de son payload", () => {
    expect(eventDetail("nouveau_type", { email: "x@y.fr", token: "t" }, names)).toEqual({});
  });
});

describe("serializeTimeline", () => {
  const out = serializeTimeline({
    request,
    events: [{ event_type: "status_changed", created_at: "2026-09-02T10:00:00Z", created_by: AGENT, payload: { from: "a_traiter", to: "en_instruction", version: 2 } }],
    notes: [
      { kind: "note_interne", body: "Voir avec la voirie.", created_at: "2026-09-02T11:00:00Z", author_id: AGENT },
      { kind: "autre", body: "ne sort pas", created_at: "2026-09-02T11:00:00Z", author_id: AGENT },
    ],
    interventions: [{ status: "demandee", intervenant_id: TECH, requested_at: "2026-09-02T12:00:00Z", requested_for: "2026-09-25", request_comment: "Reboucher", completed_on: null, completion_comment: null }],
    names,
    appUrl: null,
  });

  it("ajoute le texte de la demande sans rien laisser passer de ses colonnes internes", () => {
    expect(out.request.body).toBe("Devant le 12 rue Carnot.");
    expect(JSON.stringify(out)).not.toContain("ne sort pas");
    expect(JSON.stringify(out)).not.toContain("usager@exemple.fr");
    expect(JSON.stringify(out)).not.toContain(AGENT);
  });

  it("ne sert que les notes internes, auteur nommé", () => {
    expect(out.notes).toEqual([{ body: "Voir avec la voirie.", at: "2026-09-02T11:00:00Z", by: "Claire Agent" }]);
  });

  it("nomme l'intervenant et garde l'état de l'intervention", () => {
    expect(out.interventions[0]).toMatchObject({ status: "demandee", intervenant: "Dominique Servtech", requested_for: "2026-09-25" });
  });

  it("un événement porte son auteur nommé et son détail filtré", () => {
    expect(out.events[0]).toEqual({ type: "status_changed", at: "2026-09-02T10:00:00Z", by: "Claire Agent", detail: { from: "a_traiter", to: "en_instruction", motif: null } });
  });
});

describe("timelineUserIds / userDisplayName", () => {
  it("collecte auteurs, affectés et intervenants", () => {
    const ids = timelineUserIds(
      [{ event_type: "assigned", created_by: null, payload: { to: AGENT } }],
      [],
      [{ intervenant_id: TECH }],
    );
    expect(ids.sort()).toEqual([AGENT, TECH].sort());
  });

  it("un utilisateur sans nom n'est pas remplacé par son e-mail", () => {
    expect(userDisplayName({ first_name: " ", last_name: null })).toBeNull();
  });
});
