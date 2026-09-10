import { describe, expect, it } from "vitest";
import { PUSH_BODY_MAX, PUSH_TITLES, pushMessage, pushSentence, truncate } from "./message.ts";

const base = { reference: "DEM-2026-000042", subject: "Nid-de-poule rue des Lilas", actor_name: "Alex Dupont" };
const url = { requestId: "abc-123", appUrl: "https://iris.exemple.fr/" };

describe("pushMessage", () => {
  it("titre = motif · référence, corps = phrase — objet, tag par demande, permalien", () => {
    const m = pushMessage({ kind: "assigned", payload: { ...base, status: "a_traiter" }, ...url });
    expect(m.title).toBe("Demande affectée · DEM-2026-000042");
    expect(m.body).toBe("Alex Dupont vous a affecté cette demande (À traiter). — Nid-de-poule rue des Lilas");
    expect(m.url).toBe("https://iris.exemple.fr/demandes/abc-123");
    expect(m.tag).toBe("iris:abc-123");
  });

  it("un titre par motif connu, « Notification » sinon", () => {
    for (const kind of Object.keys(PUSH_TITLES)) {
      expect(pushMessage({ kind, payload: base, ...url }).title.startsWith(PUSH_TITLES[kind])).toBe(true);
    }
    const m = pushMessage({ kind: "futur_motif", payload: base, ...url });
    expect(m.title).toBe("Notification · DEM-2026-000042");
    expect(m.body).toContain("Cette demande a évolué.");
  });

  it("sans référence ni objet : le titre nu, la phrase seule", () => {
    const m = pushMessage({ kind: "note_added", payload: { actor_name: "Alex" }, ...url });
    expect(m.title).toBe("Note interne ajoutée");
    expect(m.body).toBe("Alex a ajouté une note interne.");
  });

  it("tolère un payload absent", () => {
    const m = pushMessage({ kind: "status_changed", payload: null, ...url });
    expect(m.title).toBe("Statut modifié");
    expect(m.body).toBe("Le système a fait passer la demande de « — » à « — ».");
  });

  it("le CORPS d'une note interne ne sort jamais, même glissé dans le payload", () => {
    const piege = { ...base, body: "SECRET usager fragile", text: "SECRET", note: "SECRET" } as Record<string, unknown>;
    for (const kind of ["note_added", "mentioned"]) {
      const m = pushMessage({ kind, payload: piege, ...url });
      expect(JSON.stringify(m)).not.toContain("SECRET");
    }
  });

  it("le commentaire d'une intervention ne sort pas sur un écran verrouillé", () => {
    const m = pushMessage({
      kind: "intervention_requested",
      payload: { ...base, requested_for: "2026-09-20", comment: "Clé sous le paillasson de Mme SECRET" },
      ...url,
    });
    expect(m.body).toBe("Alex Dupont vous sollicite pour une intervention, souhaitée le 20/09/2026. — Nid-de-poule rue des Lilas");
    expect(m.body).not.toContain("SECRET");
  });

  it("intervention réalisée : le nom figé de l'intervenant et le jour déclaré", () => {
    const m = pushMessage({
      kind: "intervention_completed",
      payload: { ...base, intervenant_name: "Sam Ouvrier", completed_on: "2026-09-21" },
      ...url,
    });
    expect(m.body.startsWith("Sam Ouvrier a déclaré l'intervention réalisée le 21/09/2026.")).toBe(true);
  });

  it("tronque un corps trop long avec une ellipse", () => {
    const m = pushMessage({ kind: "assigned", payload: { ...base, subject: "x".repeat(300) }, ...url });
    expect(m.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(m.body.endsWith("…")).toBe(true);
  });
});

describe("pushSentence", () => {
  it("ingestion sans acteur : l'intégration nommée, sinon « Le système »", () => {
    expect(pushSentence("new_request_in_scope", { source: "clara", procedure: "Voirie" }))
      .toBe("Nouvelle demande dans votre périmètre : Voirie.");
    expect(pushSentence("assigned", { source: "clara" })).toMatch(/^L'intégration clara/);
    expect(pushSentence("assigned", {})).toMatch(/^Le système/);
  });

  it("transfert : nomme l'organisme quitté quand on le connaît", () => {
    expect(pushSentence("transferred_in", { actor_name: "Alex", from_destinataire: "Voirie" }))
      .toBe("Alex vous a transféré cette demande depuis Voirie.");
    expect(pushSentence("unassigned", { actor_name: "Alex", reassigned: true }))
      .toBe("Alex a confié cette demande à quelqu'un d'autre.");
  });
});

describe("truncate", () => {
  it("coupe sur un espace quand il en reste un raisonnable", () => {
    expect(truncate("un deux trois quatre", 12)).toBe("un deux…");
  });
  it("ne touche pas un texte court", () => {
    expect(truncate("court", 12)).toBe("court");
  });
});
