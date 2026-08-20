import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  buildTransitionUpdate,
  canWrite,
  isFinal,
  STATUS_LABELS,
  type MemberRole,
  type RequestStatus,
} from "./statuts";

const targets = (status: RequestStatus, role: MemberRole) =>
  allowedTransitions(status, role).map((t) => t.to).sort();

describe("allowedTransitions — miroir de la garde SQL (rôles agent / administrateur)", () => {
  it("les deux rôles écrivent (agent : instruction, administrateur : tout)", () => {
    expect(canWrite("agent")).toBe(true);
    expect(canWrite("administrateur")).toBe(true);
  });

  it("a_traiter : prise en charge, clôture négative, annulation — jamais resolue_positive ni archivee", () => {
    expect(targets("a_traiter", "agent")).toEqual(["annulee", "en_instruction", "resolue_negative"]);
  });

  it("en_instruction : attente, résolutions, annulation, retour à qualifier", () => {
    expect(targets("en_instruction", "agent")).toEqual(
      ["a_traiter", "annulee", "en_attente", "resolue_negative", "resolue_positive"].sort(),
    );
  });

  it("en_attente : reprise ou annulation uniquement", () => {
    expect(targets("en_attente", "agent")).toEqual(["annulee", "en_instruction"]);
  });

  it("réouverture et archivage : refusés à l'agent, réservés à l'administrateur", () => {
    expect(targets("resolue_positive", "agent")).toEqual([]);
    expect(targets("resolue_positive", "administrateur")).toEqual(["archivee", "en_instruction"]);
    expect(targets("annulee", "agent")).toEqual([]);
    expect(targets("annulee", "administrateur")).toContain("archivee");
  });

  it("désarchivage : administrateur uniquement, vers un statut terminal", () => {
    expect(targets("archivee", "agent")).toEqual([]);
    expect(targets("archivee", "administrateur")).toEqual(["annulee", "resolue_negative", "resolue_positive"]);
  });

  it("exigences : agent assigné pour l'instruction, texte pour les résolutions, motif pour l'annulation", () => {
    const take = allowedTransitions("a_traiter", "agent").find((t) => t.to === "en_instruction")!;
    expect(take.needsAssignee).toBe(true);
    const resolve = allowedTransitions("en_instruction", "agent").find((t) => t.to === "resolue_positive")!;
    expect(resolve.needsClosureText).toBe(true);
    const cancel = allowedTransitions("en_instruction", "agent").find((t) => t.to === "annulee")!;
    expect(cancel.motifRequired).toBe(true);
    expect(cancel.motifChoices).toEqual(["abandon", "retrait_usager"]);
  });

  it("le motif doublon n'est jamais proposé (exige une demande maître)", () => {
    for (const status of Object.keys(STATUS_LABELS) as RequestStatus[]) {
      for (const t of allowedTransitions(status, "administrateur")) {
        expect(t.motifChoices ?? []).not.toContain("doublon");
      }
    }
  });
});

describe("buildTransitionUpdate", () => {
  const resolve = allowedTransitions("en_instruction", "agent").find((t) => t.to === "resolue_positive")!;
  const cancel = allowedTransitions("a_traiter", "agent").find((t) => t.to === "annulee")!;

  it("refuse une résolution sans texte de clôture", () => {
    expect(buildTransitionUpdate(resolve, {})).toMatchObject({ ok: false });
    const ok = buildTransitionUpdate(resolve, { closureText: "  Travaux réalisés. " });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.update).toEqual({ status: "resolue_positive", closure_text: "Travaux réalisés." });
  });

  it("refuse une annulation sans motif ou avec un motif hors liste", () => {
    expect(buildTransitionUpdate(cancel, {})).toMatchObject({ ok: false });
    expect(buildTransitionUpdate(cancel, { motif: "irrecevable" })).toMatchObject({ ok: false });
    const ok = buildTransitionUpdate(cancel, { motif: "retrait_usager" });
    if (ok.ok) expect(ok.update).toEqual({ status: "annulee", closure_motif: "retrait_usager" });
  });

  it("exige l'assigné pour la prise en charge", () => {
    const take = allowedTransitions("a_traiter", "agent").find((t) => t.to === "en_instruction")!;
    expect(buildTransitionUpdate(take, {})).toMatchObject({ ok: false });
    const ok = buildTransitionUpdate(take, { assigneeId: "u-1" });
    if (ok.ok) expect(ok.update).toEqual({ status: "en_instruction", assigned_to: "u-1" });
  });
});

describe("isFinal", () => {
  it("terminaux : annulée, résolues, archivée", () => {
    expect(isFinal("annulee")).toBe(true);
    expect(isFinal("archivee")).toBe(true);
    expect(isFinal("en_attente")).toBe(false);
  });
});
