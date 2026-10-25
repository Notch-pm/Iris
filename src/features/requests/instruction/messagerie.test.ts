import { describe, expect, it } from "vitest";
import { repliesEventLabel, repliesToggleBlocked, repliesView, type CitizenReplyState } from "./messagerie";

const state = (extra: Partial<CitizenReplyState>): CitizenReplyState => ({
  is_open: false, opened_at: null, opened_reason: null, closed_at: null, closed_reason: null, ...extra,
});

describe("repliesView", () => {
  it("aucune ligne = fermée, avec la règle", () => {
    const v = repliesView(null, "en_instruction");
    expect(v.open).toBe(false);
    expect(v.title).toBe("Messagerie de l'usager fermée");
    expect(v.detail).toMatch(/non conforme/);
  });

  it("ouverte : dit pourquoi, et que la réponse la refermera", () => {
    const v = repliesView(state({ is_open: true, opened_reason: "non_conformite" }), "en_attente");
    expect(v.open).toBe(true);
    expect(v.detail).toContain("une pièce a été déclarée non conforme");
    expect(v.detail).toContain("refermera");
  });

  it("refermée : dit par quoi", () => {
    expect(repliesView(state({ closed_reason: "reponse_usager" }), "en_instruction").detail).toContain("l'usager a répondu");
  });

  it("une demande close est fermée quoi que porte la ligne", () => {
    expect(repliesView(state({ is_open: true, opened_reason: "agent" }), "resolue_positive").open).toBe(false);
  });

  it("un motif inconnu ne casse rien", () => {
    expect(repliesView(state({ is_open: true, opened_reason: "autre" }), "en_instruction").detail)
      .toBe("L'usager peut répondre une fois en ligne. Sa réponse refermera la messagerie.");
  });
});

describe("repliesToggleBlocked", () => {
  it("sans droit d'instruction : fermé, avec la raison", () => {
    expect(repliesToggleBlocked({ open: false, status: "en_instruction", canInstruct: false })).toMatch(/droit d'instruction/);
  });
  it("demande close : on ne l'ouvre pas, on peut la fermer", () => {
    expect(repliesToggleBlocked({ open: false, status: "annulee", canInstruct: true })).toMatch(/close/);
    expect(repliesToggleBlocked({ open: true, status: "annulee", canInstruct: true })).toBeNull();
  });
  it("demande en cours : permis", () => {
    expect(repliesToggleBlocked({ open: false, status: "a_traiter", canInstruct: true })).toBeNull();
  });
});

describe("repliesEventLabel", () => {
  it("ouverture et fermeture, motif traduit", () => {
    expect(repliesEventLabel("messagerie_usager_ouverte", "message"))
      .toEqual({ label: "Messagerie de l'usager ouverte", reason: "un message attend la réponse de l'usager" });
    expect(repliesEventLabel("messagerie_usager_fermee", "agent"))
      .toEqual({ label: "Messagerie de l'usager fermée", reason: "fermée par un agent" });
  });
  it("autre événement : null", () => {
    expect(repliesEventLabel("piece_qualifiee", null)).toBeNull();
  });
});
