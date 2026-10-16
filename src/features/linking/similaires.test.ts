import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  LIKELY_THRESHOLD, MAX_PROPOSALS, distanceLabel, draftIsSearchable, draftSimilarityInput,
  rankSimilar, scoreSimilar, type SimilarCandidate,
} from "./similaires";

const NOW = new Date("2026-10-16T12:00:00Z");

function cand(over: Partial<SimilarCandidate> = {}): SimilarCandidate {
  return {
    request_id: "r", reference: "DEM-2026-000001", subject: "Nid-de-poule", status: "a_traiter",
    received_at: "2026-10-14T09:00:00Z", closed_at: null, socle_procedure_id: "p1",
    procedure_label: "Signalement voirie", organisme: "Voirie", group_id: null,
    distance_m: null, address_similarity: null, text_similarity: null, same_procedure: true,
    radius_m: 150, ...over,
  };
}

describe("distanceLabel", () => {
  it("arrondit pour être lu, pas mesuré", () => {
    expect(distanceLabel(4)).toBe("même point");
    expect(distanceLabel(43)).toBe("à 45 m");
    expect(distanceLabel(1240)).toBe("à 1,2 km");
  });
});

describe("scoreSimilar", () => {
  it("même point ET description qui converge = même incident probable", () => {
    const s = scoreSimilar(cand({ distance_m: 5, text_similarity: 0.4 }), NOW);
    expect(s.score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
    expect(s.likely).toBe(true);
    expect(s.tone).toBe("haute");
    expect(s.reasons).toContain("même point");
    expect(s.reasons).toContain("déposée il y a 2 j");
  });

  it("la proximité décroît avec la distance, jusqu'au rayon", () => {
    const near = scoreSimilar(cand({ distance_m: 20 }), NOW).score;
    const far = scoreSimilar(cand({ distance_m: 140 }), NOW).score;
    const out = scoreSimilar(cand({ distance_m: 400 }), NOW).score;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(out);
  });

  it("hors rayon, aucune distance n'est annoncée comme raison", () => {
    const s = scoreSimilar(cand({ distance_m: 400, text_similarity: 0.6 }), NOW);
    expect(s.reasons.some((r) => r.startsWith("à "))).toBe(false);
    expect(s.reasons).toContain("description très proche");
  });

  it("l'adresse ne sert qu'à défaut de point, et dès 0,5", () => {
    expect(scoreSimilar(cand({ address_similarity: 0.9 }), NOW).reasons).toContain("même adresse");
    expect(scoreSimilar(cand({ address_similarity: 0.6 }), NOW).reasons).toContain("adresse proche");
    expect(scoreSimilar(cand({ address_similarity: 0.4 }), NOW).reasons.join()).not.toMatch(/adresse/);
  });

  it("le lieu seul ne fait pas un « même incident probable » (recette : gravats ≠ nid-de-poule)", () => {
    const s = scoreSimilar(cand({ address_similarity: 0.87, text_similarity: 0.17 }), NOW);
    expect(s.likely).toBe(false);
    expect(s.score).toBeLessThan(LIKELY_THRESHOLD);
    expect(s.tone).toBe("moyenne");
    expect(s.reasons).toContain("même adresse");
  });

  it("le texte seul ne fait jamais un « même incident probable »", () => {
    const s = scoreSimilar(cand({ text_similarity: 1 }), NOW);
    expect(s.likely).toBe(false);
  });

  it("dit l'autre démarche, la résolution et le groupe existant", () => {
    const s = scoreSimilar(cand({
      distance_m: 10, same_procedure: false, procedure_label: "Éclairage public",
      status: "resolue_positive", group_id: "g1",
    }), NOW);
    expect(s.reasons).toEqual(expect.arrayContaining([
      "autre démarche : Éclairage public", "déjà résolue", "déjà liée à d'autres demandes",
    ]));
  });

  it("borne le score entre 0 et 100", () => {
    const s = scoreSimilar(cand({ distance_m: 0, address_similarity: 1, text_similarity: 1 }), NOW);
    expect(s.score).toBe(100);
  });
});

describe("rankSimilar", () => {
  it("écarte le bruit, trie par score et plafonne", () => {
    const list = [
      cand({ request_id: "faible", same_procedure: false, status: "resolue_negative" }),
      cand({ request_id: "loin", distance_m: 120 }),
      cand({ request_id: "pres", distance_m: 10 }),
      ...Array.from({ length: 15 }, (_, i) => cand({ request_id: `x${i}`, distance_m: 60 })),
    ];
    const ranked = rankSimilar(list, NOW);
    expect(ranked).toHaveLength(MAX_PROPOSALS);
    expect(ranked[0].request_id).toBe("pres");
    expect(ranked.map((r) => r.request_id)).not.toContain("faible");
  });
});

describe("draftSimilarityInput", () => {
  const schema = parseFormSchema({
    version: 1,
    content: [{ id: "f-lieu", key: "intervention_lieu", label: "Lieu", type: "location" }],
  });

  it("lit le point déclaré du champ location (réponses indexées par identifiant)", () => {
    const input = draftSimilarityInput(
      schema,
      { "f-lieu": { address: "12 rue des Lilas 13200 Arles", lat: 43.6767, lon: 4.6278 } },
      "Nid-de-poule", "Devant le 12",
    );
    expect(input).toMatchObject({ lat: 43.6767, lon: 4.6278, text: "Nid-de-poule Devant le 12" });
    expect(input.address).toContain("rue des Lilas");
  });

  it("une adresse sans point reste une adresse — rien n'est géocodé", () => {
    const input = draftSimilarityInput(schema, { "f-lieu": "14 rue des Lilas, Arles" }, "", "");
    expect(input.lat).toBeNull();
    expect(input.address).toContain("14 rue des Lilas");
    expect(input.text).toBeNull();
  });

  it("sans schéma ni texte, rien à chercher", () => {
    const input = draftSimilarityInput(null, {}, " ", "");
    expect(draftIsSearchable(input)).toBe(false);
    expect(draftIsSearchable({ ...input, text: "nid-de-poule" })).toBe(true);
  });
});
