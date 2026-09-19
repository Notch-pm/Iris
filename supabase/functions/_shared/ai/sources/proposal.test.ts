import { describe, expect, it } from "vitest";
import { extractProposal, PROPOSAL_ONLY_ANSWER } from "./proposal";
import type { SourceRef } from "./catalogue";

const offered: SourceRef[] = [
  { id: "s-aaa", kind: "page", origin: "demarche", label: "Règlement", url: "https://www.arles.fr/r" },
  { id: "s-bbb", kind: "document", origin: "demarche", label: "Guide.pdf" },
  { id: "s-ccc", kind: "page", origin: "collectivite", label: "Légifrance", url: "https://www.legifrance.gouv.fr" },
  { id: "s-ddd", kind: "page", origin: "collectivite", label: "Autre", url: "https://ex.fr" },
];

describe("extractProposal", () => {
  it("sans balise : la réponse intacte, aucune proposition", () => {
    const r = extractProposal("- Réponse complète.", offered);
    expect(r).toEqual({ answer: "- Réponse complète.", proposal: null });
  });

  it("retire la balise et rend les sources offertes, dans l'ordre du modèle", () => {
    const r = extractProposal(
      "La base ne précise pas le tarif.\n\n[[CONSULTER: s-bbb, s-aaa]]",
      offered,
    );
    expect(r.answer).toBe("La base ne précise pas le tarif.");
    expect(r.proposal?.map((s) => s.id)).toEqual(["s-bbb", "s-aaa"]);
  });

  it("ignore un identifiant inventé ou non offert", () => {
    const r = extractProposal("Manque.\n[[CONSULTER: s-zzz, s-ccc]]", offered);
    expect(r.proposal?.map((s) => s.id)).toEqual(["s-ccc"]);
    expect(extractProposal("Manque.\n[[CONSULTER: s-zzz]]", offered).proposal).toBeNull();
  });

  it("plafonne à trois sources", () => {
    const r = extractProposal("x\n[[CONSULTER: s-aaa s-bbb;s-ccc,s-ddd]]", offered);
    expect(r.proposal).toHaveLength(3);
  });

  it("tolère casse, espaces et accents graves autour de la balise", () => {
    const r = extractProposal("x\n`[[ consulter :  S-AAA ]]`", offered);
    expect(r.answer).toBe("x");
    expect(r.proposal?.map((s) => s.id)).toEqual(["s-aaa"]);
  });

  it("une balise au milieu du texte est retirée ; la DERNIÈRE fait foi", () => {
    const r = extractProposal("début [[CONSULTER: s-aaa]] suite\n[[CONSULTER: s-ccc]]", offered);
    expect(r.answer).toBe("début  suite");
    expect(r.proposal?.map((s) => s.id)).toEqual(["s-ccc"]);
  });

  it("retire une balise interrompue en fin de réponse, sans proposer", () => {
    const r = extractProposal("Réponse.\n[[CONSULTER: s-a", offered);
    expect(r).toEqual({ answer: "Réponse.", proposal: null });
  });

  it("une réponse faite de la seule balise reçoit un texte de repli", () => {
    const r = extractProposal("[[CONSULTER: s-aaa]]", offered);
    expect(r.answer).toBe(PROPOSAL_ONLY_ANSWER);
    expect(r.proposal).toHaveLength(1);
  });

  it("aucune source offerte : la balise disparaît quand même", () => {
    expect(extractProposal("ok\n[[CONSULTER: s-aaa]]", [])).toEqual({ answer: "ok", proposal: null });
  });
});
