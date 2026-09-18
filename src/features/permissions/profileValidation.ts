// Édition d'un profil de droits côté client — module PUR (sans DOM ni réseau).
// ⚠️ Ne protège rien : les gardes serveur (`save_permission_profile`,
// `assert_profile_within_editor_rights`, `assert_tenant_keeps_root_admin`,
// RM-05/06/38/39/42) revalident tout. Ce module ne sert qu'à guider la saisie
// et à construire le payload de la RPC (miroir du contrat SQL, ADR-02/ADR-03).

import { ALL_RIGHTS, type Right } from "@/features/rights/rights";

/** Modèle d'édition d'un profil de droits — reflète `permission_profiles` + ses deux tables filles. */
export interface ProfileDraft {
  name: string;
  description: string;
  isAdmin: boolean;
  /** Intervenant (2026-09-14) : sollicitable sur le périmètre ; n'accorde aucun droit sur les demandes. */
  isIntervenant: boolean;
  /** Base de connaissances (2026-09-18) : ouvre l'écran du catalogue ; aucune demande. */
  knowledgeBase: boolean;
  /** Droits appliqués à toute démarche non listée, y compris futures (RM-33). */
  defaultRights: Right[];
  /** Périmètre choisi (sémantique sous-arbre implicite, RM-25) — nœuds du miroir Socle du tenant. */
  organizationIds: string[];
  /** Lignes explicites de la matrice, clé = `socle_procedure_id`. Une ligne vide est une EXCEPTION explicite. */
  procedures: Record<string, Right[]>;
}

/** RM-01 : tout droit d'écriture implique la consultation ; dédoublonne et ordonne (`ALL_RIGHTS`). */
export function normalizeRights(rights: readonly Right[]): Right[] {
  const set = new Set<Right>(rights);
  if (set.has("creation") || set.has("instruction") || set.has("cloture")) {
    set.add("consultation");
  }
  return ALL_RIGHTS.filter((r) => set.has(r));
}

function grantsAnyRight(draft: ProfileDraft): boolean {
  if (normalizeRights(draft.defaultRights).length > 0) return true;
  return Object.values(draft.procedures).some((rights) => normalizeRights(rights).length > 0);
}

// Messages exportés (au lieu de littéraux dupliqués) : l'UI (ProfileDialog) a
// besoin de savoir PRÉCISÉMENT quelle erreur relier à quel champ (I2), sans
// dépendre d'une comparaison de chaîne fragile.
export const ERROR_NAME_REQUIRED = "Le nom du profil est obligatoire.";
export const ERROR_ORG_REQUIRED = "Sélectionnez au moins une organisation.";
export const ERROR_NO_RIGHTS = "Ce profil n'accorderait aucun droit.";

/** Messages FR bloquants — refus à l'enregistrement (RM-05, RM-06, nom obligatoire). */
export function validateProfileDraft(draft: ProfileDraft): string[] {
  const errors: string[] = [];
  if (draft.name.trim() === "") {
    errors.push(ERROR_NAME_REQUIRED);
  }
  if (draft.organizationIds.length === 0) {
    errors.push(ERROR_ORG_REQUIRED);
  }
  // Un profil d'administration pure, d'intervenant pur ou d'accès pur à la base
  // de connaissances est valide sans droit sur les demandes (même règle que
  // `validate_permission_profile_shape`).
  if (!draft.isAdmin && !draft.isIntervenant && !draft.knowledgeBase && !grantsAnyRight(draft)) {
    errors.push(ERROR_NO_RIGHTS);
  }
  return errors;
}

/** RM-04 : cet ensemble de droits accorde la clôture sans l'instruction (« clôt mais ne prend pas en charge »). */
export function isClosureWithoutProcess(rights: readonly Right[]): boolean {
  const normalized = normalizeRights(rights);
  return normalized.includes("cloture") && !normalized.includes("instruction");
}

export interface ClosureWithoutProcessFindings {
  /** Les droits PAR DÉFAUT du profil accordent clôture sans instruction. */
  default: boolean;
  /** Ids des démarches dont la ligne EXPLICITE accorde clôture sans instruction. */
  procedureIds: string[];
}

/** RM-04 : localise précisément où le profil clôt sans instruire — défaut et/ou démarches listées. */
export function closureWithoutProcessFindings(draft: ProfileDraft): ClosureWithoutProcessFindings {
  return {
    default: isClosureWithoutProcess(draft.defaultRights),
    procedureIds: Object.entries(draft.procedures)
      .filter(([, rights]) => isClosureWithoutProcess(rights))
      .map(([id]) => id),
  };
}

/** RM-04 : avertissement non bloquant — clôture accordée sans instruction (« clôt mais ne prend pas en charge »). */
export function profileWarnings(draft: ProfileDraft): string[] {
  const findings = closureWithoutProcessFindings(draft);
  if (!findings.default && findings.procedureIds.length === 0) return [];
  return ["Ce profil peut clore des demandes sans pouvoir les prendre en charge."];
}

/** RM-03 : niveaux prédéfinis proposés par l'UI de la matrice, en plus du mode « détaillé ». */
export type PresetLevelId =
  | "aucun"
  | "consultation"
  | "consultation_creation"
  | "instruction"
  | "instruction_cloture"
  | "tous_droits";

export interface PresetLevel {
  id: PresetLevelId;
  label: string;
  rights: Right[];
}

export const PRESET_LEVELS: PresetLevel[] = [
  { id: "aucun", label: "Aucun", rights: [] },
  { id: "consultation", label: "Consultation", rights: ["consultation"] },
  { id: "consultation_creation", label: "Consultation + Création", rights: ["consultation", "creation"] },
  { id: "instruction", label: "Instruction", rights: ["consultation", "instruction"] },
  {
    id: "instruction_cloture",
    label: "Instruction + Clôture",
    rights: ["consultation", "instruction", "cloture"],
  },
  {
    id: "tous_droits",
    label: "Tous droits",
    rights: ["consultation", "creation", "instruction", "cloture"],
  },
];

/** Préréglage correspondant EXACTEMENT à cet ensemble de droits, ou `null` en mode détaillé (combinaison libre). */
export function presetFor(rights: readonly Right[]): PresetLevelId | null {
  const normalized = normalizeRights(rights);
  const match = PRESET_LEVELS.find((preset) => {
    const presetNormalized = normalizeRights(preset.rights);
    return (
      presetNormalized.length === normalized.length && presetNormalized.every((r) => normalized.includes(r))
    );
  });
  return match?.id ?? null;
}

/** Droits portés par un préréglage — le modèle stocke toujours l'ensemble de droits, jamais l'étiquette. */
export function rightsForPreset(id: PresetLevelId): Right[] {
  return [...(PRESET_LEVELS.find((preset) => preset.id === id)?.rights ?? [])];
}

/** Payload de la RPC `save_permission_profile(p)` (ADR-03) — le serveur revalide tout, y compris RM-05/06/38/39. */
export interface SavePermissionProfilePayload {
  profile_id?: string;
  organization_id: string;
  name: string;
  description: string;
  is_admin: boolean;
  is_intervenant: boolean;
  knowledge_base_access: boolean;
  default_rights: Right[];
  organizations: string[];
  procedures: { id: string; rights: Right[] }[];
  expected_version?: number;
}

export function toSavePayload(
  draft: ProfileDraft,
  organizationId: string,
  profileId?: string,
  expectedVersion?: number,
): SavePermissionProfilePayload {
  const payload: SavePermissionProfilePayload = {
    organization_id: organizationId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    is_admin: draft.isAdmin,
    is_intervenant: draft.isIntervenant,
    knowledge_base_access: draft.knowledgeBase,
    default_rights: normalizeRights(draft.defaultRights),
    organizations: [...draft.organizationIds],
    procedures: Object.entries(draft.procedures).map(([id, rights]) => ({
      id,
      rights: normalizeRights(rights),
    })),
  };
  if (profileId) payload.profile_id = profileId;
  if (expectedVersion !== undefined) payload.expected_version = expectedVersion;
  return payload;
}
