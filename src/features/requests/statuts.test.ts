import { describe, expect, it } from "vitest";
import { ALL_RIGHTS, type Right } from "@/features/rights/rights";
import {
  allowedTransitions,
  allowedTransitionsFor,
  buildTransitionUpdate,
  canAdminWith,
  canProcessWith,
  canWrite,
  canWriteWith,
  isFinal,
  STATUS_LABELS,
  type MemberRole,
  type RequestRights,
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
    expect(resolve.asksClosureText).toBe(true);
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

  it("ACCEPTE une résolution sans commentaire — il est facultatif (PO 2026-08-28)", () => {
    const sans = buildTransitionUpdate(resolve, {});
    expect(sans).toMatchObject({ ok: true });
    // Écrit explicitement à null : sur une demande rouverte puis reclose,
    // omettre la colonne y laisserait le commentaire de la clôture précédente.
    if (sans.ok) expect(sans.update).toEqual({ status: "resolue_positive", closure_text: null });
    const vide = buildTransitionUpdate(resolve, { closureText: "   " });
    if (vide.ok) expect(vide.update).toEqual({ status: "resolue_positive", closure_text: null });
  });

  it("normalise le commentaire quand l'agent en écrit un", () => {
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

describe("allowedTransitionsFor — miroir de requests_guard_write (droits effectifs, ADR-07)", () => {
  const rr = (rights: Right[], isAdmin = false): RequestRights => ({ rights: new Set(rights), isAdmin });
  const targetsFor = (status: RequestStatus, rights: RequestRights) =>
    allowedTransitionsFor(status, rights).map((t) => t.to).sort();

  it("CA-05 — combinaison : chaque droit ajouté élargit l'ensemble des transitions, sans jamais en retirer", () => {
    const cloture = rr(["consultation", "cloture"]);
    const instruction = rr(["consultation", "instruction"]);
    const les_deux = rr(["consultation", "instruction", "cloture"]);

    expect(targetsFor("a_traiter", cloture)).toEqual(["annulee", "resolue_negative"]);
    expect(targetsFor("a_traiter", instruction)).toEqual(["en_instruction"]);
    expect(targetsFor("a_traiter", les_deux)).toEqual(
      ["annulee", "en_instruction", "resolue_negative"].sort(),
    );
  });

  it("CA-07 — création sans instruction (guichet) : aucune transition proposée sur ses propres demandes", () => {
    const guichet = rr(["consultation", "creation"]);
    expect(targetsFor("a_traiter", guichet)).toEqual([]);
  });

  it("CA-08 — instruction sans clôture : les allers-retours d'instruction, jamais les résolutions", () => {
    const instructeur = rr(["consultation", "instruction"]);
    expect(targetsFor("en_instruction", instructeur)).toEqual(["a_traiter", "en_attente"].sort());
    const withClosureText = allowedTransitionsFor("en_instruction", instructeur).find(
      (t) => t.to === "resolue_positive",
    );
    expect(withClosureText).toBeUndefined();
  });

  it("CA-09 — réouverture et archivage exigent clôture ET administration", () => {
    // Camille : clôture mais pas administration → refusé.
    const camille: RequestRights = { rights: new Set(["consultation", "cloture"]), isAdmin: false };
    expect(targetsFor("resolue_positive", camille)).toEqual([]);

    // Alex : administration ET clôture (via le défaut) → autorisé.
    const alex: RequestRights = { rights: new Set(["consultation", "cloture"]), isAdmin: true };
    expect(targetsFor("resolue_positive", alex)).toEqual(["archivee", "en_instruction"].sort());

    // Morgane : administration seule, aucun droit de clôture → toujours refusé (RM-22).
    const morgane: RequestRights = { rights: new Set<Right>(), isAdmin: true };
    expect(targetsFor("resolue_positive", morgane)).toEqual([]);
  });

  it("désarchivage : miroir de l'archivage (clôture + administration)", () => {
    const admin: RequestRights = { rights: new Set(["consultation", "cloture"]), isAdmin: true };
    expect(targetsFor("archivee", admin)).toEqual(["annulee", "resolue_negative", "resolue_positive"].sort());
    const nonAdmin: RequestRights = { rights: new Set(["consultation", "cloture"]), isAdmin: false };
    expect(targetsFor("archivee", nonAdmin)).toEqual([]);
  });

  it("consultation seule : aucune transition, quel que soit le statut", () => {
    const lecteur: RequestRights = { rights: new Set(["consultation"]), isAdmin: false };
    for (const status of Object.keys(STATUS_LABELS) as RequestStatus[]) {
      expect(allowedTransitionsFor(status, lecteur)).toEqual([]);
    }
  });
});

describe("allowedTransitions (déprécié) ≡ allowedTransitionsFor avec les 4 droits", () => {
  it("pour chaque statut, le wrapper déprécié égale exactement le miroir des droits effectifs", () => {
    for (const status of Object.keys(STATUS_LABELS) as RequestStatus[]) {
      const agentRr: RequestRights = { rights: new Set<Right>(ALL_RIGHTS), isAdmin: false };
      const adminRr: RequestRights = { rights: new Set<Right>(ALL_RIGHTS), isAdmin: true };
      expect(allowedTransitions(status, "agent")).toEqual(allowedTransitionsFor(status, agentRr));
      expect(allowedTransitions(status, "administrateur")).toEqual(allowedTransitionsFor(status, adminRr));
    }
  });
});

describe("canWriteWith / canProcessWith / canAdminWith", () => {
  it("canWriteWith : au moins un droit d'écriture (création, instruction ou clôture)", () => {
    expect(canWriteWith({ rights: new Set(["consultation"]), isAdmin: false })).toBe(false);
    expect(canWriteWith({ rights: new Set(["consultation", "creation"]), isAdmin: false })).toBe(true);
    expect(canWriteWith({ rights: new Set(["consultation", "instruction"]), isAdmin: false })).toBe(true);
    expect(canWriteWith({ rights: new Set(["consultation", "cloture"]), isAdmin: false })).toBe(true);
  });

  it("canProcessWith : uniquement le droit d'instruction", () => {
    expect(canProcessWith({ rights: new Set(["consultation", "creation"]), isAdmin: false })).toBe(false);
    expect(canProcessWith({ rights: new Set(["consultation", "instruction"]), isAdmin: false })).toBe(true);
  });

  it("canAdminWith : reflète isAdmin, indépendamment des droits sur la demande", () => {
    expect(canAdminWith({ rights: new Set(), isAdmin: true })).toBe(true);
    expect(canAdminWith({ rights: new Set(["consultation", "cloture"]), isAdmin: false })).toBe(false);
  });
});
