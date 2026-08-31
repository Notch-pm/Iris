import { describe, expect, it } from "vitest";
import {
  canCreateProcedure,
  canViewProcedure,
  creatableProcedureIds,
  creatableProcedures,
  creatableProceduresOn,
  creationOrganizationIds,
  emptyRights,
  explainRight,
  hasAnyProfile,
  hasRight,
  isAdminOn,
  NIL_PROCEDURE_ID,
  rightsFor,
  viewableProcedures,
  type MyRights,
  type Right,
  type RightsProfile,
} from "./rights";

// Décor commun (spécification § 5) : tenant ACCM, racine Mairie, deux enfants
// frères Voirie / CCAS ; deux démarches actives D1 (nid-de-poule), D2 (aide sociale).
const ORG = "11111111-1111-1111-1111-111111111111"; // organizations.id (tenant Iris)
const MAIRIE = "22222222-2222-2222-2222-222222222222";
const VOIRIE = "33333333-3333-3333-3333-333333333333";
const CCAS = "44444444-4444-4444-4444-444444444444";
const D1 = "55555555-5555-5555-5555-555555555555";
const D2 = "66666666-6666-6666-6666-666666666666";

function profile(overrides: Partial<RightsProfile> & { name: string }): RightsProfile {
  return {
    id: overrides.id ?? overrides.name,
    status: "active",
    is_admin: false,
    scope_organization_ids: [],
    procedures: {},
    default: [],
    ...overrides,
  };
}

function myRights(profiles: RightsProfile[], overrides: Partial<MyRights> = {}): MyRights {
  return {
    ...emptyRights(ORG),
    profiles,
    ...overrides,
  };
}

const setOf = (...rights: Right[]) => new Set<Right>(rights);

describe("rightsFor — combinaison par couple (organisation, démarche)", () => {
  it("CA-03 — le périmètre expansé (sous-arbre) inclut Voirie et CCAS depuis Mairie", () => {
    const my = myRights([
      profile({
        name: "Toute la collectivité",
        scope_organization_ids: [MAIRIE, VOIRIE, CCAS],
        procedures: { [D1]: ["instruction"], [D2]: ["instruction"] },
      }),
    ]);
    expect(hasRight(my, VOIRIE, D1, "instruction")).toBe(true);
    expect(hasRight(my, CCAS, D2, "instruction")).toBe(true);
    expect(hasRight(my, MAIRIE, D1, "instruction")).toBe(true);
  });

  it("CA-04 — combinaison par couple, sans produit cartésien", () => {
    const profilA = profile({ name: "A", scope_organization_ids: [VOIRIE], procedures: { [D1]: ["instruction"] } });
    const profilB = profile({ name: "B", scope_organization_ids: [CCAS], procedures: { [D2]: ["cloture"] } });
    const my = myRights([profilA, profilB]);

    expect(hasRight(my, VOIRIE, D1, "instruction")).toBe(true);
    expect(hasRight(my, CCAS, D2, "cloture")).toBe(true);
    // Aucun profil n'accorde (Voirie, D2) ni (CCAS, D1) : pas de fuite par combinaison.
    expect(rightsFor(my, VOIRIE, D2)).toEqual(setOf());
    expect(rightsFor(my, CCAS, D1)).toEqual(setOf());
  });

  it("CA-05 / CL-04 — un profil plus étroit ajoute un droit sans jamais abaisser un droit plus large", () => {
    const profilC = profile({ name: "C", scope_organization_ids: [MAIRIE, VOIRIE, CCAS], default: ["consultation"] });
    const profilD = profile({ name: "D", scope_organization_ids: [VOIRIE], procedures: { [D1]: ["cloture"] } });
    const my = myRights([profilC, profilD]);

    // Partout où C porte : au moins consultation (via le défaut).
    expect(rightsFor(my, CCAS, D2)).toEqual(setOf("consultation"));
    // Sur (Voirie, D1) : l'union ajoute clôture, sans retirer consultation.
    expect(rightsFor(my, VOIRIE, D1)).toEqual(setOf("consultation", "cloture"));
    expect(rightsFor(my, VOIRIE, D1).has("consultation")).toBe(true);
  });

  it("CA-06 — consultation seule : aucun droit d'écriture n'apparaît", () => {
    const my = myRights([profile({ name: "Lecture", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["consultation"] } })]);
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf("consultation"));
    expect(hasRight(my, MAIRIE, D1, "creation")).toBe(false);
    expect(hasRight(my, MAIRIE, D1, "instruction")).toBe(false);
    expect(hasRight(my, MAIRIE, D1, "cloture")).toBe(false);
  });

  it("CA-07 — création sans instruction (guichet) : le droit n'ouvre que la création", () => {
    const my = myRights([profile({ name: "Guichet", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["creation"] } })]);
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf("consultation", "creation"));
    expect(hasRight(my, MAIRIE, D1, "instruction")).toBe(false);
    expect(canCreateProcedure(my, D1)).toBe(true);
    expect(canCreateProcedure(my, D2)).toBe(false); // non listée, défaut = aucun
  });

  it("CA-10 — l'administration seule n'ouvre aucun droit sur les demandes (RM-22)", () => {
    const my = myRights([profile({ name: "Paramétrage", scope_organization_ids: [MAIRIE], is_admin: true })]);
    expect(isAdminOn(my, MAIRIE)).toBe(true);
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf());
    expect(rightsFor(my, MAIRIE, null)).toEqual(setOf());
  });

  it("CA-11 — procedureId=null résout sur no_procedure_id, pas sur une organisation racine", () => {
    const my = myRights([
      profile({ name: "Historique", scope_organization_ids: [MAIRIE], procedures: { [NIL_PROCEDURE_ID]: ["instruction"] } }),
    ]);
    expect(rightsFor(my, MAIRIE, null)).toEqual(setOf("consultation", "instruction"));
    // D1 n'est pas la pseudo-démarche : aucune ligne, aucun défaut → rien.
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf());
  });

  it("CL-02 — un profil désactivé ne produit aucun droit, même attribué", () => {
    const my = myRights([
      profile({ name: "Inactif", status: "inactive", scope_organization_ids: [MAIRIE], default: ["cloture"] }),
    ]);
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf());
    expect(isAdminOn(my, MAIRIE)).toBe(false);
  });

  it("CL-09 — démarche non listée : relève des droits par défaut du profil", () => {
    const my = myRights([profile({ name: "Défaut instruction", scope_organization_ids: [MAIRIE], default: ["instruction"] })]);
    // D2 n'apparaît dans aucune ligne de matrice → défaut appliqué.
    expect(rightsFor(my, MAIRIE, D2)).toEqual(setOf("consultation", "instruction"));
  });

  it("une ligne explicite VIDE prime sur le défaut (exception « tout sauf cette démarche »)", () => {
    const my = myRights([
      profile({ name: "Sauf D1", scope_organization_ids: [MAIRIE], default: ["instruction"], procedures: { [D1]: [] } }),
    ]);
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf()); // exception explicite : rien, malgré le défaut
    expect(rightsFor(my, MAIRIE, D2)).toEqual(setOf("consultation", "instruction")); // défaut inchangé ailleurs
  });

  it("l'admin plateforme obtient les quatre droits sur n'importe quel couple, sans profil", () => {
    const my = myRights([], { is_platform_admin: true });
    expect(rightsFor(my, MAIRIE, D1)).toEqual(setOf("consultation", "creation", "instruction", "cloture"));
    expect(isAdminOn(my, MAIRIE)).toBe(true);
  });
});

describe("hasAnyProfile", () => {
  it("CL-01 — aucun profil actif ⇒ false", () => {
    expect(hasAnyProfile(emptyRights(ORG))).toBe(false);
    expect(hasAnyProfile(myRights([profile({ name: "X", status: "inactive" })]))).toBe(false);
    expect(hasAnyProfile(myRights([profile({ name: "X" })]))).toBe(true);
  });
});

describe("création — sélecteurs dérivés (RM-58, RM-59)", () => {
  it("creatableProcedureIds / creatableProcedures résolvent lignes explicites ET défaut", () => {
    const explicite = profile({ name: "Explicite", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["creation"] } });
    const parDefaut = profile({ name: "Défaut", scope_organization_ids: [CCAS], default: ["creation"] });
    const my = myRights([explicite, parDefaut]);

    expect(creatableProcedureIds(my)).toEqual(new Set([D1])); // le défaut n'y figure pas (pas de cache)
    expect(creatableProcedures(my, [D1, D2])).toEqual(new Set([D1, D2])); // avec le cache, le défaut résout D2
  });

  it("creationOrganizationIds retourne l'union des périmètres qui accordent création sur la démarche", () => {
    const a = profile({ name: "A", scope_organization_ids: [VOIRIE], procedures: { [D1]: ["creation"] } });
    const b = profile({ name: "B", scope_organization_ids: [CCAS], default: ["creation"] });
    const my = myRights([a, b]);
    expect(creationOrganizationIds(my, D1)).toEqual(new Set([VOIRIE, CCAS]));
    expect(creationOrganizationIds(my, D2)).toEqual(new Set([CCAS])); // A n'a pas de création sur D2
  });

  it("CL-02 — creationOrganizationIds ignore un profil désactivé, même s'il accorderait création", () => {
    const inactif = profile({
      name: "Désactivé", status: "inactive", scope_organization_ids: [VOIRIE],
      procedures: { [D1]: ["creation"] },
    });
    const actif = profile({ name: "Actif", scope_organization_ids: [CCAS], procedures: { [D1]: ["creation"] } });
    const my = myRights([inactif, actif]);
    expect(creationOrganizationIds(my, D1)).toEqual(new Set([CCAS]));
    expect(creationOrganizationIds(my, D1).has(VOIRIE)).toBe(false);
  });
});

// B4 (décision PO 2026-08-31) — une fois l'organisme arrêté, c'est « créable
// POUR LUI » qu'il faut demander, pas « créable quelque part ».
// ⚠️ Ce module ne répond QUE des droits : le croisement avec l'activation Socle
// (`organization_procedures`) vit dans `creation/proposables.test.ts`.
describe("creatableProceduresOn — les droits, organisme par organisme", () => {
  it("ne retient que les démarches créables POUR cet organisme", () => {
    const my = myRights([
      profile({ name: "Voirie", scope_organization_ids: [VOIRIE], procedures: { [D1]: ["creation"] } }),
      profile({ name: "CCAS", scope_organization_ids: [CCAS], procedures: { [D2]: ["creation"] } }),
    ]);
    expect(creatableProceduresOn(my, VOIRIE, [D1, D2])).toEqual(new Set([D1]));
    expect(creatableProceduresOn(my, CCAS, [D1, D2])).toEqual(new Set([D2]));
    expect(creatableProceduresOn(my, MAIRIE, [D1, D2])).toEqual(new Set()); // hors périmètre
  });

  it("résout le droit par DÉFAUT du profil (RM-33)", () => {
    const my = myRights([
      profile({ name: "Guichet", scope_organization_ids: [MAIRIE, VOIRIE], default: ["creation"] }),
    ]);
    expect(creatableProceduresOn(my, VOIRIE, [D1, D2])).toEqual(new Set([D1, D2]));
  });

  it("une ligne explicite VIDE l'emporte sur un défaut créateur (CL-25)", () => {
    const my = myRights([
      profile({
        name: "Sauf D1", scope_organization_ids: [VOIRIE],
        default: ["creation"], procedures: { [D1]: [] },
      }),
    ]);
    expect(creatableProceduresOn(my, VOIRIE, [D1, D2])).toEqual(new Set([D2]));
  });

  it("un profil désactivé n'ouvre rien (CL-02)", () => {
    const my = myRights([
      profile({
        name: "Désactivé", status: "inactive",
        scope_organization_ids: [VOIRIE], procedures: { [D1]: ["creation"] },
      }),
    ]);
    expect(creatableProceduresOn(my, VOIRIE, [D1])).toEqual(new Set());
  });

  it("l'instruction seule n'ouvre pas la création (RM-01)", () => {
    const my = myRights([
      profile({ name: "Instructeur", scope_organization_ids: [VOIRIE], procedures: { [D1]: ["instruction", "cloture"] } }),
    ]);
    expect(creatableProceduresOn(my, VOIRIE, [D1])).toEqual(new Set());
  });
});

describe("canViewProcedure / viewableProcedures — RM-58 (lecture)", () => {
  it("consultation seule suffit à rendre une démarche consultable", () => {
    const my = myRights([profile({ name: "Lecture", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["consultation"] } })]);
    expect(canViewProcedure(my, D1)).toBe(true);
    expect(canViewProcedure(my, D2)).toBe(false); // non listée, défaut = aucun
  });

  it("un droit d'écriture rend aussi la démarche consultable", () => {
    const my = myRights([profile({ name: "Guichet", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["creation"] } })]);
    expect(canViewProcedure(my, D1)).toBe(true);
  });

  it("un profil sans organisation ne rend rien consultable", () => {
    const my = myRights([profile({ name: "Vide", scope_organization_ids: [], procedures: { [D1]: ["instruction"] } })]);
    expect(canViewProcedure(my, D1)).toBe(false);
  });

  it("viewableProcedures résout aussi le défaut du profil (comme creatableProcedures)", () => {
    const my = myRights([profile({ name: "Défaut", scope_organization_ids: [MAIRIE], default: ["consultation"] })]);
    expect(viewableProcedures(my, [D1, D2])).toEqual(new Set([D1, D2]));
  });

  it("une ligne explicite VIDE exclut la démarche de viewableProcedures malgré le défaut (CL-25)", () => {
    const my = myRights([
      profile({ name: "Sauf D1", scope_organization_ids: [MAIRIE], default: ["consultation"], procedures: { [D1]: [] } }),
    ]);
    expect(canViewProcedure(my, D1)).toBe(false);
    expect(viewableProcedures(my, [D1, D2])).toEqual(new Set([D2]));
  });
});

describe("explainRight — RM-46", () => {
  it("liste les profils qui accordent le droit demandé", () => {
    const a = profile({ name: "Guichet", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["creation"] } });
    const b = profile({ name: "Instruction", scope_organization_ids: [MAIRIE], procedures: { [D1]: ["instruction"] } });
    const my = myRights([a, b]);
    expect(explainRight(my, MAIRIE, D1, "consultation").sort()).toEqual(["Guichet", "Instruction"]);
    expect(explainRight(my, MAIRIE, D1, "instruction")).toEqual(["Instruction"]);
    expect(explainRight(my, MAIRIE, D1, "cloture")).toEqual([]);
  });

  it("l'admin plateforme s'explique lui-même", () => {
    const my = myRights([], { is_platform_admin: true });
    expect(explainRight(my, MAIRIE, D1, "cloture")).toEqual(["Administrateur de la plateforme"]);
  });
});
