import { describe, expect, it } from "vitest";
import type { SocleOrganizationOption } from "@/features/socle/useSocleCatalog";
import {
  needsOrganizationChoice,
  organizationChoices,
  soleOrganization,
} from "./organismes";

// Décor : l'arbre réel d'une communauté d'agglomération — une racine, des
// communes, et les services d'une commune.
const ACCM = "d5227d25-0000-0000-0000-000000000001";
const ARLES = "d5227d25-0000-0000-0000-000000000002";
const SMC = "d5227d25-0000-0000-0000-000000000003";
const FONTVIEILLE = "d5227d25-0000-0000-0000-000000000004";
const CABINET = "d5227d25-0000-0000-0000-000000000005";
const ETAT_CIVIL = "d5227d25-0000-0000-0000-000000000006";

const CATALOG: SocleOrganizationOption[] = [
  { value: ACCM, label: "ACCM", parentValue: null },
  { value: CABINET, label: "Direction du Cabinet", parentValue: SMC },
  { value: FONTVIEILLE, label: "Mairie de Fontvieille", parentValue: ACCM },
  { value: SMC, label: "Mairie de Saint Martin de Crau", parentValue: ACCM },
  { value: ARLES, label: "Mairie d'Arles", parentValue: ACCM },
  { value: ETAT_CIVIL, label: "Service Etat Civil", parentValue: SMC },
];

const all = new Set(CATALOG.map((o) => o.value));

describe("organizationChoices", () => {
  it("ne propose que les organisations admissibles", () => {
    const choices = organizationChoices(CATALOG, new Set([ARLES, ETAT_CIVIL]));
    expect(choices.map((c) => c.value)).toEqual([ARLES, ETAT_CIVIL]);
  });

  it("situe chaque organisation par la chaîne de ses parents", () => {
    const choices = organizationChoices(CATALOG, all);
    const byId = new Map(choices.map((c) => [c.value, c]));
    expect(byId.get(ACCM)?.context).toBeNull();
    expect(byId.get(SMC)?.context).toBe("ACCM");
    expect(byId.get(ETAT_CIVIL)?.context).toBe("ACCM › Mairie de Saint Martin de Crau");
  });

  it("trie par chemin : un service suit la commune dont il dépend, pas l'alphabet global", () => {
    const choices = organizationChoices(CATALOG, all);
    expect(choices.map((c) => c.label)).toEqual([
      "ACCM",
      // « Mairie d'Arles » avant « Mairie de Fontvieille » : la collation
      // française ignore l'apostrophe, donc « dArles » < « de F… ».
      "Mairie d'Arles",
      "Mairie de Fontvieille",
      "Mairie de Saint Martin de Crau",
      "Direction du Cabinet",
      "Service Etat Civil",
    ]);
  });

  it("un parent absent du catalogue interrompt la remontée sans faire disparaître l'organisation", () => {
    const orphan: SocleOrganizationOption[] = [
      { value: ETAT_CIVIL, label: "Service Etat Civil", parentValue: SMC },
    ];
    const choices = organizationChoices(orphan, new Set([ETAT_CIVIL]));
    expect(choices).toEqual([{ value: ETAT_CIVIL, label: "Service Etat Civil", context: null }]);
  });

  it("un cycle dans le miroir ne boucle pas", () => {
    const cyclic: SocleOrganizationOption[] = [
      { value: ARLES, label: "A", parentValue: SMC },
      { value: SMC, label: "B", parentValue: ARLES },
    ];
    const choices = organizationChoices(cyclic, new Set([ARLES]));
    expect(choices).toHaveLength(1);
    expect(choices[0].context).toBe("B");
  });

  it("un identifiant admissible inconnu du catalogue n'est pas proposé", () => {
    expect(organizationChoices(CATALOG, new Set(["inconnu"]))).toEqual([]);
  });
});

describe("needsOrganizationChoice / soleOrganization", () => {
  it("un seul organisme se retient d'office, sans poser la question", () => {
    const choices = organizationChoices(CATALOG, new Set([ARLES]));
    expect(needsOrganizationChoice(choices)).toBe(false);
    expect(soleOrganization(choices)).toBe(ARLES);
  });

  it("plusieurs organismes : la question est posée, aucun n'est pré-sélectionné", () => {
    const choices = organizationChoices(CATALOG, new Set([ARLES, SMC]));
    expect(needsOrganizationChoice(choices)).toBe(true);
    expect(soleOrganization(choices)).toBeNull();
  });

  it("aucun organisme : ni question, ni sélection d'office", () => {
    expect(needsOrganizationChoice([])).toBe(false);
    expect(soleOrganization([])).toBeNull();
  });
});
