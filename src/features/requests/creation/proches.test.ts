import { describe, expect, it } from "vitest";
import {
  depositLabel,
  DUPLICATE_THRESHOLD,
  scoreNearbyRequests,
  scoreTone,
  type NearbyCandidate,
} from "./proches";

const NOW = new Date("2026-08-21T12:00:00Z");

function candidate(over: Partial<NearbyCandidate>): NearbyCandidate {
  return {
    id: "r1", reference: "DEM-2026-0001", subject: "Test", status: "a_traiter",
    created_at: "2026-08-19T10:00:00Z", socle_procedure_id: "proc-a", socle_procedure_label: "OTV",
    ...over,
  };
}

describe("scoreNearbyRequests", () => {
  it("même usager, même démarche, en cours et récente → doublon probable (100)", () => {
    const [r] = scoreNearbyRequests([candidate({})], { basis: "contact", procedureId: "proc-a", now: NOW });
    expect(r.score).toBe(100);
    expect(r.likelyDuplicate).toBe(true);
    expect(r.reasons).toEqual(["Même usager", "même démarche", "encore en cours", "déposée ce mois-ci"]);
  });

  it("même usager, même démarche mais traitée il y a longtemps → proche sans être un doublon", () => {
    const [r] = scoreNearbyRequests(
      [candidate({ status: "resolue_positive", created_at: "2025-06-12T10:00:00Z" })],
      { basis: "contact", procedureId: "proc-a", now: NOW },
    );
    expect(r.score).toBe(75);
    expect(r.likelyDuplicate).toBe(false);
  });

  it("même usager, autre démarche en cours → score moyen", () => {
    const [r] = scoreNearbyRequests(
      [candidate({ socle_procedure_id: "proc-b", created_at: "2026-05-03T10:00:00Z" })],
      { basis: "contact", procedureId: "proc-a", now: NOW },
    );
    expect(r.score).toBe(64);
    expect(r.reasons).not.toContain("même démarche");
  });

  it("un nom déclaré seul n'atteint jamais le seuil de doublon", () => {
    const [r] = scoreNearbyRequests([candidate({})], { basis: "nom_declare", procedureId: "proc-a", now: NOW });
    expect(r.score).toBe(80);
    expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(r.likelyDuplicate).toBe(false);
    expect(r.reasons[0]).toBe("Même nom déclaré");
  });

  it("trie par score décroissant puis par date", () => {
    const scored = scoreNearbyRequests([
      candidate({ id: "old", socle_procedure_id: "proc-b", created_at: "2024-01-01T00:00:00Z", status: "annulee" }),
      candidate({ id: "dup" }),
      candidate({ id: "mid", status: "resolue_positive", created_at: "2026-08-01T00:00:00Z" }),
    ], { basis: "contact", procedureId: "proc-a", now: NOW });
    expect(scored.map((s) => s.id)).toEqual(["dup", "mid", "old"]);
  });

  it("une date invalide ne fait pas planter le calcul", () => {
    const [r] = scoreNearbyRequests([candidate({ created_at: "n/a" })], { basis: "contact", procedureId: "x", now: NOW });
    expect(r.score).toBe(60);
  });
});

describe("scoreTone / depositLabel", () => {
  it("tonalités", () => {
    expect(scoreTone(100)).toBe("haute");
    expect(scoreTone(85)).toBe("haute");
    expect(scoreTone(64)).toBe("moyenne");
    expect(scoreTone(40)).toBe("faible");
  });

  it("libellés de dépôt", () => {
    expect(depositLabel("2026-08-21T08:00:00Z", NOW)).toBe("déposée aujourd'hui");
    expect(depositLabel("2026-08-20T08:00:00Z", NOW)).toBe("déposée hier");
    expect(depositLabel("2026-08-10T08:00:00Z", NOW)).toBe("déposée il y a 11 jours");
    expect(depositLabel("2026-05-03T08:00:00Z", NOW)).toMatch(/^déposée le 03\/05\/2026$/);
    expect(depositLabel("n/a", NOW)).toBe("date inconnue");
  });
});
