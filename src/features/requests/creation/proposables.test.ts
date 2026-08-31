import { describe, expect, it } from "vitest";
import { emptyRights, type MyRights, type RightsProfile } from "@/features/rights/rights";
import { activationsByOrganisation, creatableByOrganisation } from "./proposables";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACCM = "22222222-2222-2222-2222-222222222222";
const ARLES = "33333333-3333-3333-3333-333333333333";
const SMC = "44444444-4444-4444-4444-444444444444";
const VOIRIE = "55555555-5555-5555-5555-555555555555";
const ETAT_CIVIL = "66666666-6666-6666-6666-666666666666";

function profile(o: Partial<RightsProfile> & { name: string }): RightsProfile {
  return {
    id: o.id ?? o.name, status: "active", is_admin: false,
    scope_organization_ids: [], procedures: {}, default: [], ...o,
  };
}
function myRights(profiles: RightsProfile[]): MyRights {
  return { ...emptyRights(TENANT), profiles };
}

const CACHE = [VOIRIE, ETAT_CIVIL];

describe("activationsByOrganisation", () => {
  it("indexe les couples du miroir par organisation", () => {
    const map = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: VOIRIE },
      { socle_org_id: ACCM, socle_procedure_id: ETAT_CIVIL },
      { socle_org_id: SMC, socle_procedure_id: ETAT_CIVIL },
    ]);
    expect(map.get(ACCM)).toEqual(new Set([VOIRIE, ETAT_CIVIL]));
    expect(map.get(SMC)).toEqual(new Set([ETAT_CIVIL]));
    expect(map.has(ARLES)).toBe(false); // opt-in strict : absente = aucune
  });

  it("un miroir vide n'active rien", () => {
    expect(activationsByOrganisation([]).size).toBe(0);
  });
});

describe("creatableByOrganisation", () => {
  const large = myRights([
    profile({ name: "Guichet", scope_organization_ids: [ACCM, ARLES, SMC], default: ["creation"] }),
  ]);

  it("croise activation ET droits", () => {
    const activated = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: VOIRIE },
      { socle_org_id: ACCM, socle_procedure_id: ETAT_CIVIL },
      { socle_org_id: SMC, socle_procedure_id: ETAT_CIVIL },
    ]);
    const map = creatableByOrganisation(large, CACHE, activated);
    expect(map.get(ACCM)).toEqual(new Set([VOIRIE, ETAT_CIVIL]));
    expect(map.get(SMC)).toEqual(new Set([ETAT_CIVIL]));
  });

  it("une organisation sans AUCUNE démarche activée est absente — pas de cul-de-sac", () => {
    const activated = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: VOIRIE },
    ]);
    const map = creatableByOrganisation(large, CACHE, activated);
    expect(map.has(ARLES)).toBe(false);
    expect([...map.keys()]).toEqual([ACCM]);
  });

  it("une organisation activée mais SANS droit de création est absente elle aussi", () => {
    const lecteur = myRights([
      profile({ name: "Lecture", scope_organization_ids: [ACCM, SMC], default: ["consultation"] }),
    ]);
    const activated = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: VOIRIE },
      { socle_org_id: SMC, socle_procedure_id: VOIRIE },
    ]);
    expect(creatableByOrganisation(lecteur, CACHE, activated).size).toBe(0);
  });

  it("l'activation ne CONTOURNE pas les droits : la démarche doit être dans les deux", () => {
    const cible = myRights([
      profile({ name: "Voirie seule", scope_organization_ids: [SMC], procedures: { [VOIRIE]: ["creation"] } }),
    ]);
    const activated = activationsByOrganisation([
      { socle_org_id: SMC, socle_procedure_id: VOIRIE },
      { socle_org_id: SMC, socle_procedure_id: ETAT_CIVIL },
    ]);
    expect(creatableByOrganisation(cible, CACHE, activated).get(SMC)).toEqual(new Set([VOIRIE]));
  });

  it("les droits ne CONTOURNENT pas l'activation : une démarche non activée sort", () => {
    const activated = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: VOIRIE },
    ]);
    // `large` accorde la création sur TOUT le cache, ETAT_CIVIL compris.
    expect(creatableByOrganisation(large, CACHE, activated).get(ACCM)).toEqual(new Set([VOIRIE]));
  });

  it("une activation hors cache du tenant est ignorée (démarche en brouillon, ou hors période)", () => {
    const activated = activationsByOrganisation([
      { socle_org_id: ACCM, socle_procedure_id: "99999999-9999-9999-9999-999999999999" },
    ]);
    expect(creatableByOrganisation(large, CACHE, activated).size).toBe(0);
  });

  it("un miroir vide ne propose aucun organisme (opt-in strict jusqu'au bout)", () => {
    expect(creatableByOrganisation(large, CACHE, new Map()).size).toBe(0);
  });
});
