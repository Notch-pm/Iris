// Fusion pure des lignes brutes d'un profil de droits (table `permission_profiles`
// + ses deux tables filles + attributions) en une ligne d'affichage, et
// conversions vers/depuis `ProfileDraft` (édition). Aucune requête ici : les
// lignes brutes sont lues par `usePermissions.ts` (RLS = source de vérité) ;
// ce module ne fait que les recomposer, comme `rights.ts` recompose les
// droits effectifs à partir de `MyRights`.

import type { Right } from "@/features/rights/rights";
import { PRESET_LEVELS, rightsForPreset, type PresetLevelId, type ProfileDraft } from "./profileValidation";

export type ProfileStatusRow = "active" | "inactive";

export interface ProfileTableRow {
  id: string;
  name: string;
  description: string | null;
  is_admin: boolean;
  status: string;
  version: number;
  default_view: boolean;
  default_create: boolean;
  default_process: boolean;
  default_close: boolean;
}

export interface ProfileOrgRow {
  profile_id: string;
  socle_org_id: string;
}

export interface ProfileProcedureRow {
  profile_id: string;
  socle_procedure_id: string;
  right_view: boolean;
  right_create: boolean;
  right_process: boolean;
  right_close: boolean;
}

export interface ProfileAssignmentRow {
  profile_id: string;
  user_id: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  description: string;
  isAdmin: boolean;
  status: ProfileStatusRow;
  version: number;
  organizationIds: string[];
  procedures: Record<string, Right[]>;
  defaultRights: Right[];
  assignedUserIds: string[];
}

function rightsFromFlags(view: boolean, create: boolean, process: boolean, close: boolean): Right[] {
  const rights: Right[] = [];
  if (view) rights.push("consultation");
  if (create) rights.push("creation");
  if (process) rights.push("instruction");
  if (close) rights.push("cloture");
  return rights;
}

/** Regroupe les trois tables filles par `profile_id` et fusionne en `ProfileRow[]`. */
export function buildProfileRows(
  profiles: ProfileTableRow[],
  organizations: ProfileOrgRow[],
  procedures: ProfileProcedureRow[],
  assignments: ProfileAssignmentRow[],
): ProfileRow[] {
  const orgsByProfile = new Map<string, string[]>();
  for (const o of organizations) {
    const list = orgsByProfile.get(o.profile_id) ?? [];
    list.push(o.socle_org_id);
    orgsByProfile.set(o.profile_id, list);
  }
  const proceduresByProfile = new Map<string, Record<string, Right[]>>();
  for (const p of procedures) {
    const map = proceduresByProfile.get(p.profile_id) ?? {};
    map[p.socle_procedure_id] = rightsFromFlags(p.right_view, p.right_create, p.right_process, p.right_close);
    proceduresByProfile.set(p.profile_id, map);
  }
  const usersByProfile = new Map<string, string[]>();
  for (const a of assignments) {
    const list = usersByProfile.get(a.profile_id) ?? [];
    list.push(a.user_id);
    usersByProfile.set(a.profile_id, list);
  }

  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    isAdmin: p.is_admin,
    status: p.status === "inactive" ? "inactive" : "active",
    version: p.version,
    organizationIds: orgsByProfile.get(p.id) ?? [],
    procedures: proceduresByProfile.get(p.id) ?? {},
    defaultRights: rightsFromFlags(p.default_view, p.default_create, p.default_process, p.default_close),
    assignedUserIds: usersByProfile.get(p.id) ?? [],
  }));
}

export function emptyDraft(): ProfileDraft {
  return { name: "", description: "", isAdmin: false, defaultRights: [], organizationIds: [], procedures: {} };
}

/** Édition (le profil existant reste inchangé tant que « Enregistrer » n'est pas confirmé). */
export function draftFromProfileRow(row: ProfileRow): ProfileDraft {
  return {
    name: row.name,
    description: row.description,
    isAdmin: row.isAdmin,
    defaultRights: row.defaultRights,
    organizationIds: row.organizationIds,
    procedures: row.procedures,
  };
}

/** Duplication : même contenu, nom distinct, sans identité (crée un nouveau profil). */
export function draftForDuplicate(row: ProfileRow): ProfileDraft {
  return { ...draftFromProfileRow(row), name: `${row.name} (copie)` };
}

export interface ProfileTemplate {
  id: string;
  label: string;
  presetId: PresetLevelId;
}

/**
 * Modèles de la RM-51 : pré-remplissent les droits PAR DÉFAUT du brouillon
 * (aucune donnée créée en base — un simple point de départ que l'agent
 * ajuste ensuite, matrice et périmètre compris).
 */
export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  { id: "guichet", label: "Guichet", presetId: "consultation_creation" },
  { id: "instructeur", label: "Instructeur", presetId: "instruction" },
  { id: "superviseur", label: "Superviseur", presetId: "instruction_cloture" },
  { id: "consultation", label: "Consultation", presetId: "consultation" },
];

/** I11 : le nom du modèle pré-remplit le champ Nom (librement modifiable ensuite). */
export function draftFromTemplate(templateId: string): ProfileDraft {
  const template = PROFILE_TEMPLATES.find((t) => t.id === templateId);
  return {
    ...emptyDraft(),
    name: template?.label ?? "",
    defaultRights: template ? rightsForPreset(template.presetId) : [],
  };
}

/** Résumé lisible de la matrice pour la table des profils (« Défaut : Instruction · 3 démarches personnalisées »). */
export function matrixSummary(row: ProfileRow): string {
  const count = Object.keys(row.procedures).length;
  const presetLabel = PRESET_LEVELS.find((p) =>
    p.rights.length === row.defaultRights.length && p.rights.every((r) => row.defaultRights.includes(r)),
  )?.label ?? "Détaillé";
  const demarcheLabel = count === 0
    ? "aucune démarche personnalisée"
    : `${count} démarche${count > 1 ? "s" : ""} personnalisée${count > 1 ? "s" : ""}`;
  return `Défaut : ${presetLabel} · ${demarcheLabel}`;
}
