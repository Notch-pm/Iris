import { describe, expect, it } from "vitest";
import { activeInTenant, missingFromFullList, planAccount, readSocleAgents, wantsAdmin, type SocleAgent } from "./logic";

function agent(overrides: Partial<SocleAgent> = {}): SocleAgent {
  return {
    socle_user_id: "u-1",
    email: "alice@ville.fr",
    first_name: "Alice",
    last_name: "Martin",
    status: "active",
    is_active: true,
    accesses: [{ organization_id: "racine", is_active: true, role: "acces" }],
    ...overrides,
  };
}

describe("activeInTenant", () => {
  it("accès actif et agent actif", () => {
    expect(activeInTenant(agent())).toBe(true);
  });
  it("suspendu, ou tous les accès retirés ⇒ inactif", () => {
    expect(activeInTenant(agent({ status: "suspended", is_active: false }))).toBe(false);
    expect(activeInTenant(agent({ is_active: false, accesses: [{ organization_id: "racine", is_active: false, role: "acces" }] }))).toBe(false);
  });
});

describe("planAccount", () => {
  const base = { activeHere: true, activeElsewhere: false, hasMembership: false, isPlatformAdmin: false };

  it("accès ouvert : appartenance SANS profil, compte rétabli", () => {
    expect(planAccount(base)).toEqual({ addMembership: true, removeMembership: false, ban: false });
  });

  it("déjà membre : rien à créer", () => {
    expect(planAccount({ ...base, hasMembership: true }).addMembership).toBe(false);
  });

  it("accès retiré partout : banni, appartenance CONSERVÉE (ses profils avec)", () => {
    expect(planAccount({ ...base, activeHere: false, hasMembership: true })).toEqual({
      addMembership: false,
      removeMembership: false,
      ban: true,
    });
  });

  it("accès retiré ici mais actif ailleurs : quitte ce tenant, pas banni", () => {
    expect(planAccount({ ...base, activeHere: false, activeElsewhere: true, hasMembership: true })).toEqual({
      addMembership: false,
      removeMembership: true,
      ban: false,
    });
  });

  it("l'admin plateforme n'est jamais touché", () => {
    expect(planAccount({ ...base, activeHere: false, hasMembership: true, isPlatformAdmin: true })).toEqual({
      addMembership: false,
      removeMembership: false,
      ban: null,
    });
  });
});

describe("readSocleAgents", () => {
  it("lit avec tolérance, e-mail en minuscules, le rôle est ignoré", () => {
    const { agents, asOf } = readSocleAgents({
      as_of: "2026-10-30T10:00:00Z",
      agents: [
        { socle_user_id: "u-1", email: "Alice@Ville.fr", status: "active", is_active: true, accesses: [{ organization_id: "o", role: "acces", is_active: true }] },
        { email: "sans-id@ville.fr" },
      ],
    });
    expect(asOf).toBe("2026-10-30T10:00:00Z");
    expect(agents).toHaveLength(1);
    expect(agents[0].email).toBe("alice@ville.fr");
    expect(agents[0].accesses).toEqual([{ organization_id: "o", is_active: true, role: "acces" }]);
  });

  it("réponse inattendue ⇒ aucun agent", () => {
    expect(readSocleAgents(undefined).agents).toEqual([]);
  });
});

describe("missingFromFullList", () => {
  it("les agents rattachés absents de la liste complète", () => {
    expect(missingFromFullList(["u-1", "u-2"], [agent()])).toEqual(["u-2"]);
  });
});

describe("wantsAdmin", () => {
  it("rôle administrateur actif ⇒ profil système", () => {
    expect(wantsAdmin(agent({ accesses: [{ organization_id: "racine", is_active: true, role: "administrateur" }] }))).toBe(true);
  });
  it("rôle accès seul ⇒ pas de profil système", () => {
    expect(wantsAdmin(agent())).toBe(false);
  });
  it("administrateur retiré, ou agent suspendu ⇒ non", () => {
    expect(
      wantsAdmin(
        agent({
          accesses: [
            { organization_id: "racine", is_active: false, role: "administrateur" },
            { organization_id: "service", is_active: true, role: "acces" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      wantsAdmin(
        agent({
          status: "suspended",
          is_active: false,
          accesses: [{ organization_id: "racine", is_active: true, role: "administrateur" }],
        }),
      ),
    ).toBe(false);
  });
});
