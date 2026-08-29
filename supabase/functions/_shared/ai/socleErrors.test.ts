import { describe, expect, it } from "vitest";
import { mapSocleFailure, SOCLE_UNREACHABLE } from "./socleErrors";

const envelope = (code: string, message: string) => ({ error: { code, message } });

describe("mapSocleFailure", () => {
  // Le cas neuf de la centralisation. Avant, un Socle muet dégradait
  // l'assistant (il répondait sans la base de connaissances) ; maintenant il
  // l'éteint — et le message doit le dire sans inquiéter sur le reste.
  it("aucune réponse ⇒ le référentiel ne répond pas, et l'instruction continue", () => {
    const r = mapSocleFailure(null, null);
    expect(r).toEqual(SOCLE_UNREACHABLE);
    expect(r.message).toContain("le référentiel ne répond pas");
    expect(r.message).toContain("n'est pas affectée");
  });

  // ⚠️ La seule phrase relayée mot pour mot : seul le Socle connaît la date de
  // renouvellement. La recomposer ici recréerait le jumeau que la
  // centralisation vient de supprimer.
  it("429 : relaie le message du Socle mot pour mot", () => {
    const phrase = "Le plafond d'utilisation de l'assistant IA est atteint pour ce mois. " +
      "Le crédit sera renouvelé le 1ᵉʳ septembre 2026.";
    const r = mapSocleFailure(429, envelope("ai_quota_exceeded", phrase));
    expect(r.status).toBe(429);
    expect(r.code).toBe("ai_quota_exceeded");
    expect(r.message).toBe(phrase);
  });

  it("429 sans message exploitable : repli sobre, jamais une date inventée", () => {
    for (const body of [null, {}, { error: {} }, { error: { message: "  " } }, "texte"]) {
      const r = mapSocleFailure(429, body);
      expect(r.status).toBe(429);
      expect(r.message).toContain("plafond");
      expect(r.message).not.toMatch(/renouvelé le/);
    }
  });

  // Une panne de configuration n'est pas le problème de l'agent, et le détail
  // ne doit pas lui parvenir (motif relaySocleError).
  it("401 et 403 : jamais l'erreur d'authentification brute", () => {
    for (const status of [401, 403]) {
      const r = mapSocleFailure(status, envelope("forbidden", "Cette clé ne porte pas le scope « ai »."));
      expect(r.status).toBe(502);
      expect(r.code).toBe("socle_auth_failed");
      expect(r.message).toContain("administrateur");
      expect(r.message).not.toContain("scope");
    }
  });

  // Iris compose le payload : un refus de forme est NOTRE bug.
  it("400 et 404 : erreur interne, pas une erreur de l'agent", () => {
    for (const status of [400, 404]) {
      const r = mapSocleFailure(status, envelope("bad_request", "Clés non autorisées : surprise."));
      expect(r.status).toBe(500);
      expect(r.code).toBe("internal_error");
      expect(r.message).not.toContain("surprise");
    }
  });

  it("503 : la plateforme n'est pas équipée", () => {
    const r = mapSocleFailure(503, envelope("not_configured", "…"));
    expect(r.status).toBe(503);
    expect(r.code).toBe("not_configured");
  });

  it("502 et tout le reste : le fournisseur est muet", () => {
    for (const status of [500, 502, 504, 418]) {
      const r = mapSocleFailure(status, null);
      expect(r.status).toBe(502);
      expect(r.code).toBe("ai_unavailable");
      expect(r.message).toContain("momentanément indisponible");
    }
  });

  it("aucun message rendu n'est vide", () => {
    for (const status of [null, 400, 401, 403, 404, 429, 500, 502, 503]) {
      expect(mapSocleFailure(status, null).message.trim()).not.toBe("");
    }
  });
});
