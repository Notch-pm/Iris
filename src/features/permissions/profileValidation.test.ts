import { describe, expect, it } from "vitest";
import {
  closureWithoutProcessFindings,
  ERROR_NAME_REQUIRED,
  ERROR_NO_RIGHTS,
  ERROR_ORG_REQUIRED,
  isClosureWithoutProcess,
  normalizeRights,
  presetFor,
  PRESET_LEVELS,
  profileWarnings,
  rightsForPreset,
  toSavePayload,
  validateProfileDraft,
  type ProfileDraft,
} from "./profileValidation";

const MAIRIE = "22222222-2222-2222-2222-222222222222";
const D1 = "55555555-5555-5555-5555-555555555555";
const ORG = "11111111-1111-1111-1111-111111111111";

function draft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    name: "Instruction Voirie",
    description: "",
    isAdmin: false,
    isIntervenant: false,
    knowledgeBase: false,
    defaultRights: [],
    organizationIds: [MAIRIE],
    procedures: { [D1]: ["instruction"] },
    ...overrides,
  };
}

describe("normalizeRights — RM-01 : tout droit d'écriture implique la consultation", () => {
  it("ajoute consultation dès qu'un droit d'écriture est présent", () => {
    expect(normalizeRights(["instruction"])).toEqual(["consultation", "instruction"]);
    expect(normalizeRights(["cloture"])).toEqual(["consultation", "cloture"]);
    expect(normalizeRights(["creation"])).toEqual(["consultation", "creation"]);
  });

  it("consultation seule reste consultation seule ; aucun droit reste vide", () => {
    expect(normalizeRights(["consultation"])).toEqual(["consultation"]);
    expect(normalizeRights([])).toEqual([]);
  });

  it("dédoublonne et ordonne selon ALL_RIGHTS", () => {
    expect(normalizeRights(["cloture", "instruction", "instruction", "consultation"])).toEqual([
      "consultation",
      "instruction",
      "cloture",
    ]);
  });
});

describe("validateProfileDraft — CA-19", () => {
  it("RM-05 — refuse un profil sans aucune organisation", () => {
    const errors = validateProfileDraft(draft({ organizationIds: [] }));
    expect(errors).toContain(ERROR_ORG_REQUIRED);
  });

  it("RM-06 — refuse un profil sans administration, sans matrice et sans droits par défaut", () => {
    const errors = validateProfileDraft(draft({ procedures: {}, defaultRights: [] }));
    expect(errors).toContain(ERROR_NO_RIGHTS);
  });

  it("RM-06 — une ligne de matrice explicitement vide ne suffit pas à accorder un droit", () => {
    const errors = validateProfileDraft(draft({ procedures: { [D1]: [] }, defaultRights: [] }));
    expect(errors).toContain(ERROR_NO_RIGHTS);
  });

  it("un profil d'administration pure (matrice vide, défaut aucun) est valide", () => {
    const errors = validateProfileDraft(draft({ isAdmin: true, procedures: {}, defaultRights: [] }));
    expect(errors).toEqual([]);
  });

  // Même règle que `validate_permission_profile_shape` (2026-09-18) : l'accès à
  // la base de connaissances est un accès réel.
  it("un profil « Base de connaissances » seul est valide", () => {
    const errors = validateProfileDraft(draft({ knowledgeBase: true, procedures: {}, defaultRights: [] }));
    expect(errors).toEqual([]);
  });

  it("le nom est obligatoire", () => {
    expect(validateProfileDraft(draft({ name: "  " }))).toContain(ERROR_NAME_REQUIRED);
  });

  it("un profil correctement rempli ne produit aucune erreur", () => {
    expect(validateProfileDraft(draft())).toEqual([]);
  });
});

describe("profileWarnings — RM-04", () => {
  it("avertit (sans bloquer) quand la clôture est accordée sans instruction", () => {
    const d = draft({ procedures: { [D1]: ["cloture"] } });
    expect(validateProfileDraft(d)).toEqual([]); // valide
    expect(profileWarnings(d)).toContain(
      "Ce profil peut clore des demandes sans pouvoir les prendre en charge.",
    );
  });

  it("aucun avertissement quand clôture s'accompagne d'instruction", () => {
    const d = draft({ procedures: { [D1]: ["instruction", "cloture"] } });
    expect(profileWarnings(d)).toEqual([]);
  });

  it("détecte aussi la clôture portée par le défaut", () => {
    const d = draft({ procedures: {}, defaultRights: ["cloture"], isAdmin: true });
    expect(profileWarnings(d)).toContain(
      "Ce profil peut clore des demandes sans pouvoir les prendre en charge.",
    );
  });
});

describe("isClosureWithoutProcess / closureWithoutProcessFindings — I6 (démarches concernées)", () => {
  it("isClosureWithoutProcess reconnaît clôture sans instruction, normalisation comprise", () => {
    expect(isClosureWithoutProcess(["cloture"])).toBe(true);
    expect(isClosureWithoutProcess(["instruction", "cloture"])).toBe(false);
    expect(isClosureWithoutProcess([])).toBe(false);
    expect(isClosureWithoutProcess(["consultation"])).toBe(false);
  });

  it("localise le défaut ET les démarches explicites concernées séparément", () => {
    const d = draft({
      defaultRights: ["cloture"],
      procedures: { [D1]: ["cloture"], [MAIRIE]: ["instruction", "cloture"] },
    });
    const findings = closureWithoutProcessFindings(d);
    expect(findings.default).toBe(true);
    expect(findings.procedureIds).toEqual([D1]);
  });

  it("aucune trouvaille quand tout est correctement accompagné d'instruction", () => {
    const d = draft({ defaultRights: [], procedures: { [D1]: ["instruction", "cloture"] } });
    expect(closureWithoutProcessFindings(d)).toEqual({ default: false, procedureIds: [] });
  });
});

describe("PRESET_LEVELS / presetFor / rightsForPreset — RM-03", () => {
  it("expose les six niveaux prédéfinis", () => {
    expect(PRESET_LEVELS.map((p) => p.id)).toEqual([
      "aucun",
      "consultation",
      "consultation_creation",
      "instruction",
      "instruction_cloture",
      "tous_droits",
    ]);
  });

  it("presetFor reconnaît un ensemble de droits exactement égal à un préréglage", () => {
    expect(presetFor([])).toBe("aucun");
    expect(presetFor(["consultation"])).toBe("consultation");
    expect(presetFor(["creation", "consultation"])).toBe("consultation_creation");
    expect(presetFor(["consultation", "instruction", "cloture"])).toBe("instruction_cloture");
    expect(presetFor(["consultation", "creation", "instruction", "cloture"])).toBe("tous_droits");
  });

  it("presetFor retourne null pour une combinaison hors préréglages (mode détaillé)", () => {
    expect(presetFor(["consultation", "creation", "cloture"])).toBeNull();
  });

  it("rightsForPreset retourne les droits du préréglage, jamais l'étiquette", () => {
    expect(rightsForPreset("instruction_cloture")).toEqual(["consultation", "instruction", "cloture"]);
    expect(rightsForPreset("aucun")).toEqual([]);
  });
});

describe("toSavePayload — contrat de save_permission_profile(p)", () => {
  it("construit le payload de création (sans profile_id ni expected_version)", () => {
    const payload = toSavePayload(draft(), ORG);
    expect(payload).toEqual({
      organization_id: ORG,
      name: "Instruction Voirie",
      description: "",
      is_admin: false,
      is_intervenant: false,
      knowledge_base_access: false,
      default_rights: [],
      organizations: [MAIRIE],
      procedures: [{ id: D1, rights: ["consultation", "instruction"] }],
    });
    expect(payload.profile_id).toBeUndefined();
    expect(payload.expected_version).toBeUndefined();
  });

  // La clé part TOUJOURS : c'est son absence que le serveur lit comme « conserver ».
  it("porte l'accès à la base de connaissances, coché ou non", () => {
    expect(toSavePayload(draft({ knowledgeBase: true }), ORG).knowledge_base_access).toBe(true);
    expect(toSavePayload(draft(), ORG)).toHaveProperty("knowledge_base_access", false);
  });

  it("inclut profile_id et expected_version pour une mise à jour (verrou optimiste RM-56)", () => {
    const payload = toSavePayload(draft(), ORG, "profil-1", 3);
    expect(payload.profile_id).toBe("profil-1");
    expect(payload.expected_version).toBe(3);
  });

  it("normalise les droits par défaut et de chaque ligne de matrice avant l'envoi", () => {
    const payload = toSavePayload(
      draft({ defaultRights: ["cloture"], procedures: { [D1]: ["creation", "creation"] } }),
      ORG,
    );
    expect(payload.default_rights).toEqual(["consultation", "cloture"]);
    expect(payload.procedures).toEqual([{ id: D1, rights: ["consultation", "creation"] }]);
  });
});
