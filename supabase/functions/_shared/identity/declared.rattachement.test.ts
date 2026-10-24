/**
 * `isSafeIngestMatch` : la règle qui décide, SANS agent, qu'une demande du
 * portail rejoint une fiche existante — donc qu'elle apparaît dans l'espace
 * d'un autre si la règle se trompe. Table de vérité exhaustive sur les raisons
 * du contrat `contacts-api` : on vérifie les INVARIANTS, pas des exemples.
 */
import { describe, expect, it } from "vitest";
import { heldByPortalAccount, isSafeIngestMatch, postalCodesDiffer } from "./declared";

const REASONS = ["email", "phone", "siret", "name_exact", "name_similar", "birth_date"] as const;
const TYPES = ["personne", "entreprise", "association"] as const;

/** Toutes les parties de REASONS. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
}

describe("isSafeIngestMatch — invariants sur toutes les combinaisons", () => {
  const all = subsets(REASONS);

  it("un code postal différent ne rattache jamais, quoi que disent les autres signaux", () => {
    for (const type of TYPES) for (const reasons of all) for (const portalAccount of [false, true]) {
      expect(isSafeIngestMatch(type, reasons, { portalAccount, postalMismatch: true })).toBe(false);
    }
  });

  it("une PERSONNE ne se rattache jamais sans nom identique, ni sur un nom seul, ni sur un SIRET", () => {
    for (const reasons of all) {
      const safe = isSafeIngestMatch("personne", reasons, { portalAccount: false, postalMismatch: false });
      if (!reasons.includes("name_exact")) expect(safe, reasons.join()).toBe(false);
      if (safe) expect(reasons.includes("email") || reasons.includes("phone")).toBe(true);
      if (reasons.length === 1) expect(safe, reasons.join()).toBe(false);
    }
  });

  it("une fiche tenue par un compte ne se rejoint QUE par courriel + nom (jamais par téléphone), pour tout type", () => {
    for (const type of TYPES) for (const reasons of all) {
      const safe = isSafeIngestMatch(type, reasons, { portalAccount: true, postalMismatch: false });
      expect(safe, `${type} ${reasons.join()}`).toBe(reasons.includes("email") && reasons.includes("name_exact"));
    }
  });

  it("le nom « similaire » n'est jamais un nom identique : il ne rattache pas", () => {
    for (const type of TYPES) for (const reasons of all.filter((r) => !r.includes("name_exact") && !r.includes("siret"))) {
      expect(isSafeIngestMatch(type, reasons), `${type} ${reasons.join()}`).toBe(false);
    }
  });

  it("une structure : le SIRET seul suffit, sinon courriel + nom", () => {
    for (const type of ["entreprise", "association"] as const) for (const reasons of all) {
      const safe = isSafeIngestMatch(type, reasons);
      expect(safe, `${type} ${reasons.join()}`).toBe(reasons.includes("siret") || (reasons.includes("email") && reasons.includes("name_exact")));
    }
  });

  it("entrées inattendues : jamais rattaché", () => {
    for (const reasons of [undefined, null, "email", { email: true }, 42, [null], [1, 2], ["EMAIL", "NAME_EXACT"], [["email"], ["name_exact"]]]) {
      expect(isSafeIngestMatch("personne", reasons)).toBe(false);
    }
  });
});

describe("garde-fous annexes", () => {
  it("codes postaux : seuls deux codes renseignés ET différents comptent, espaces ignorés", () => {
    expect(postalCodesDiffer("92330", "92330")).toBe(false);
    expect(postalCodesDiffer("92 330", "92330")).toBe(false);
    expect(postalCodesDiffer("92330", "92160")).toBe(true);
    for (const [a, b] of [[null, "92330"], ["92330", null], ["", "92330"], ["92330", ""], ["92330", undefined], ["  ", "92330"]] as const) {
      expect(postalCodesDiffer(a, b), `${a}/${b}`).toBe(false);
    }
  });

  it("fiche tenue par un compte : une référence portail_citoyen, rien d'autre", () => {
    expect(heldByPortalAccount({ external_references: [{ source: "portail_citoyen", external_id: "x" }] })).toBe(true);
    for (const contact of [null, undefined, {}, { external_references: null }, { external_references: [{ source: "clara" }] }, { external_references: "portail_citoyen" }, "portail_citoyen"]) {
      expect(heldByPortalAccount(contact)).toBe(false);
    }
  });
});
