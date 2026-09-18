import { describe, expect, it } from "vitest";
import { AUDIENCE_LABELS, parseAudiences, readAudiences } from "./audiences";
import { AUDIENCES } from "../../create-request-from-procedure/_shared/procedureForm";

describe("readAudiences", () => {
  it("rend les publics ACTIVÉS, dans l'ordre du contrat", () => {
    expect(readAudiences({
      association: { enabled: true },
      citoyen: { enabled: true, fields: {} },
      entreprise: { enabled: false },
    })).toEqual(["citoyen", "association"]);
  });

  it("aucun public activé, config absente ou abîmée : liste vide, jamais un public supposé", () => {
    expect(readAudiences({ citoyen: { enabled: false } })).toEqual([]);
    expect(readAudiences(null)).toEqual([]);
    expect(readAudiences("x")).toEqual([]);
    expect(readAudiences({ citoyen: { enabled: "true" } })).toEqual([]);
  });
});

describe("parseAudiences", () => {
  it("ne garde que les publics connus, dédoublonnés, et est idempotente", () => {
    const once = parseAudiences(["association", "martien", "citoyen", "citoyen", 3]);
    expect(once).toEqual(["citoyen", "association"]);
    expect(parseAudiences(once)).toEqual(once);
    expect(parseAudiences("citoyen")).toEqual([]);
  });
});

// Un public ne se nomme pas autrement sur une tuile que sur l'écran du demandeur.
describe("AUDIENCE_LABELS", () => {
  it("reprend les libellés de l'identification du demandeur", () => {
    for (const a of AUDIENCES) expect(AUDIENCE_LABELS[a.key]).toBe(a.label);
  });
});
