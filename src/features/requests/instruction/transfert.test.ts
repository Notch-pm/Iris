import { describe, expect, it } from "vitest";
import { transferConfirmation, transferOptions } from "./transfert";

const VOIRIE = "11111111-1111-4111-8111-111111111111";
const CCAS = "22222222-2222-4222-8222-222222222222";
const ETAT_CIVIL = "33333333-3333-4333-8333-333333333333";
const PROC = "44444444-4444-4444-8444-444444444444";
const AUTRE_PROC = "55555555-5555-4555-8555-555555555555";

const ORGS = [
  { value: CCAS, label: "CCAS" },
  { value: VOIRIE, label: "Voirie" },
  { value: ETAT_CIVIL, label: "État civil" },
];

describe("transferOptions", () => {
  it("ne propose que les organismes qui assurent la démarche", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: [
        { socle_org_id: VOIRIE, socle_procedure_id: PROC },
        { socle_org_id: CCAS, socle_procedure_id: PROC },
        { socle_org_id: ETAT_CIVIL, socle_procedure_id: AUTRE_PROC },
      ],
      procedureId: PROC,
      currentOrgId: VOIRIE,
      currentLabel: "Voirie",
    });
    expect(options.map((o) => o.label)).toEqual(["CCAS", "Voirie"]);
  });

  it("est un OPT-IN strict : sans activation, aucun organisme n'est proposé", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: [],
      procedureId: PROC,
      currentOrgId: null,
      currentLabel: null,
    });
    expect(options).toEqual([]);
  });

  it("marque l'organisme actuel, et lui seul", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: [
        { socle_org_id: VOIRIE, socle_procedure_id: PROC },
        { socle_org_id: CCAS, socle_procedure_id: PROC },
      ],
      procedureId: PROC,
      currentOrgId: CCAS,
      currentLabel: "CCAS",
    });
    expect(options.filter((o) => o.current).map((o) => o.value)).toEqual([CCAS]);
  });

  it("garde l'organisme actuel même s'il a perdu l'activation", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: [{ socle_org_id: CCAS, socle_procedure_id: PROC }],
      procedureId: PROC,
      currentOrgId: VOIRIE,
      currentLabel: "Voirie",
    });
    expect(options.map((o) => o.label)).toEqual(["CCAS", "Voirie"]);
    expect(options.find((o) => o.value === VOIRIE)?.current).toBe(true);
  });

  it("garde l'organisme actuel même s'il a quitté le miroir, avec le libellé de la demande", () => {
    const options = transferOptions({
      organizations: [{ value: CCAS, label: "CCAS" }],
      activations: [{ socle_org_id: CCAS, socle_procedure_id: PROC }],
      procedureId: PROC,
      currentOrgId: VOIRIE,
      currentLabel: "Voirie (ancien)",
    });
    expect(options.map((o) => o.label)).toEqual(["CCAS", "Voirie (ancien)"]);
  });

  it("nomme l'organisme actuel disparu sans libellé plutôt que de le taire", () => {
    const options = transferOptions({
      organizations: [],
      activations: [],
      procedureId: PROC,
      currentOrgId: VOIRIE,
      currentLabel: null,
    });
    expect(options).toEqual([{ value: VOIRIE, label: "Organisme inconnu", current: true }]);
  });

  it("ouvre tout le sous-arbre à une demande historique sans démarche", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: [],
      procedureId: null,
      currentOrgId: VOIRIE,
      currentLabel: "Voirie",
    });
    expect(options.map((o) => o.label)).toEqual(["CCAS", "État civil", "Voirie"]);
  });

  it("trie en français (« État civil » avant « Voirie »)", () => {
    const options = transferOptions({
      organizations: ORGS,
      activations: ORGS.map((o) => ({ socle_org_id: o.value, socle_procedure_id: PROC })),
      procedureId: PROC,
      currentOrgId: null,
      currentLabel: null,
    });
    expect(options.map((o) => o.label)).toEqual(["CCAS", "État civil", "Voirie"]);
  });
});

describe("transferConfirmation", () => {
  it("nomme l'organisme quitté et celui qui reçoit", () => {
    const text = transferConfirmation({
      fromLabel: "Voirie", toLabel: "CCAS", losesAccess: false, assignedName: null,
    });
    expect(text.lead).toBe(
      "La demande est actuellement affectée à : Voirie. À la validation, la demande sera transférée à : CCAS.",
    );
    expect(text.accessWarning).toBeNull();
    expect(text.assignmentNotice).toBeNull();
  });

  it("dit clairement la perte d'accès, quand elle aura lieu", () => {
    const text = transferConfirmation({
      fromLabel: "Voirie", toLabel: "CCAS", losesAccess: true, assignedName: null,
    });
    expect(text.accessWarning).toBe(
      "Vous n'avez pas les droits de consultation sur ce type de démarche pour CCAS. "
        + "En conséquence, vous perdrez l'accès à cette demande.",
    );
  });

  it("annonce le sort de l'affectation comme une règle, jamais comme un pronostic", () => {
    const text = transferConfirmation({
      fromLabel: "Voirie", toLabel: "CCAS", losesAccess: false, assignedName: "Claire Martin",
    });
    expect(text.assignmentNotice).toBe(
      "Si Claire Martin n'a pas le droit d'instruction sur cette démarche pour CCAS, "
        + "son affectation sera retirée.",
    );
  });

  it("sait dire qu'aucun organisme ne porte encore la demande", () => {
    const text = transferConfirmation({
      fromLabel: null, toLabel: "CCAS", losesAccess: false, assignedName: null,
    });
    expect(text.lead).toBe(
      "La demande n'est actuellement affectée à aucun organisme. "
        + "À la validation, la demande sera transférée à : CCAS.",
    );
  });

  it("traite un libellé vide comme une absence", () => {
    const text = transferConfirmation({
      fromLabel: "   ", toLabel: "CCAS", losesAccess: false, assignedName: null,
    });
    expect(text.lead.startsWith("La demande n'est actuellement affectée à aucun organisme.")).toBe(true);
  });
});
