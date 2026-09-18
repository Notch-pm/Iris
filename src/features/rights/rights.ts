// Droits effectifs — module PUR, miroir EXACT de la sémantique serveur
// (permission_pairs_of / my_rights, cf. ADR-11 « profils de droits »).
// ⚠️ Ce module ne PROTÈGE rien : la vérité est dans le RLS Postgres. Il ne
// sert qu'à refléter dans l'UI ce que le serveur acceptera (même doctrine
// que src/features/requests/statuts.ts).
//
// Combinaison — RM-01, RM-02 (spécification § 3.A) : les droits effectifs
// d'un utilisateur sur un couple (organisation porteuse, démarche) sont
// l'UNION, sur les profils ACTIFS attribués dont le périmètre (déjà expansé
// en sous-arbre côté serveur) contient l'organisation, des droits de la
// démarche dans ce profil — la ligne explicite de la matrice si elle existe
// (même vide : c'est une exception qui prime), sinon les droits par défaut
// du profil. `création`, `instruction` et `clôture` impliquent chacun
// `consultation` (RM-01) ; l'administration (`is_admin`) n'accorde par
// elle-même AUCUN droit sur les demandes (RM-22).

export type Right = "consultation" | "creation" | "instruction" | "cloture";

export const ALL_RIGHTS: readonly Right[] = ["consultation", "creation", "instruction", "cloture"];

/** Pseudo-démarche des demandes historiques sans démarche (RM-36) — UUID nul. */
export const NIL_PROCEDURE_ID = "00000000-0000-0000-0000-000000000000";

export type ProfileStatus = "active" | "inactive";

export interface RightsProfile {
  id: string;
  name: string;
  status: ProfileStatus;
  /** Administration (RM-20 à RM-24) : attribut du profil, pas un cinquième droit de la matrice. */
  is_admin: boolean;
  /**
   * Intervenant (2026-09-14) : attribut du profil, comme l'administration. Ses
   * titulaires peuvent être SOLLICITÉS pour une intervention sur les demandes
   * du périmètre ; il n'ouvre par lui-même aucune demande — c'est la
   * sollicitation qui ouvre (RLS `requests_select`).
   */
  is_intervenant: boolean;
  /**
   * Base de connaissances (2026-09-18) : attribut marche/arrêt du profil —
   * ouvre l'écran du catalogue des démarches publiées. Aucune demande.
   */
  knowledge_base_access: boolean;
  /** Périmètre DÉJÀ expansé en sous-arbre par le serveur (`permission_profile_scope`). */
  scope_organization_ids: string[];
  /** Lignes explicites de la matrice, clé = `socle_procedure_id` (ou `NIL_PROCEDURE_ID`). */
  procedures: Record<string, Right[]>;
  /** Droits appliqués à toute démarche non listée, y compris futures (RM-33). */
  default: Right[];
}

export interface MyRights {
  organization_id: string;
  is_platform_admin: boolean;
  /** Administration quelque part dans le tenant (ouvre l'entrée « Paramètres », RM-20). */
  is_admin: boolean;
  /** Intervenant quelque part dans le tenant (ouvre l'entrée « Mes interventions »). */
  is_intervenant: boolean;
  /**
   * Accès à la base de connaissances (profil ACTIF, ou admin plateforme) —
   * ouvre l'entrée « Base de connaissances ». Reflet : la garde serveur qui en
   * dépend est celle de l'assistant (`has_knowledge_base_access_for`).
   */
  knowledge_base_access: boolean;
  no_procedure_id: string;
  profiles: RightsProfile[];
}

/** Aucun droit nulle part — état avant chargement ou tenant sans profil. */
export function emptyRights(orgId: string): MyRights {
  return {
    organization_id: orgId,
    is_platform_admin: false,
    is_admin: false,
    is_intervenant: false,
    knowledge_base_access: false,
    no_procedure_id: NIL_PROCEDURE_ID,
    profiles: [],
  };
}

/** RM-01 : tout droit d'écriture implique la consultation. Défensif — le serveur normalise déjà. */
function withImpliedConsultation(rights: readonly Right[]): Set<Right> {
  const set = new Set<Right>(rights);
  if (set.has("creation") || set.has("instruction") || set.has("cloture")) {
    set.add("consultation");
  }
  return set;
}

/** Droits de la démarche `procedureId` dans ce profil : ligne explicite (même vide) sinon défaut. */
function proceduresRightsIn(profile: RightsProfile, procedureId: string): readonly Right[] {
  return Object.prototype.hasOwnProperty.call(profile.procedures, procedureId)
    ? profile.procedures[procedureId]
    : profile.default;
}

function isEligible(profile: RightsProfile, scopeOrgId: string): boolean {
  return profile.status === "active" && profile.scope_organization_ids.includes(scopeOrgId);
}

/**
 * Droits effectifs sur le couple (organisation porteuse, démarche) — `null` désigne
 * la pseudo-démarche « sans démarche » (résolue sur `my.no_procedure_id`, RM-36).
 * `scopeOrgId` est déjà l'organisation porteuse (résolution NULL/inconnue → racine
 * faite côté serveur, cf. `socle_scope_org_id` — ADR-01).
 */
export function rightsFor(my: MyRights, scopeOrgId: string, procedureId: string | null): Set<Right> {
  if (my.is_platform_admin) return new Set<Right>(ALL_RIGHTS);

  const key = procedureId ?? my.no_procedure_id;
  const out = new Set<Right>();
  for (const profile of my.profiles) {
    if (!isEligible(profile, scopeOrgId)) continue;
    for (const right of withImpliedConsultation(proceduresRightsIn(profile, key))) {
      out.add(right);
    }
  }
  return out;
}

export function hasRight(
  my: MyRights,
  scopeOrgId: string,
  procedureId: string | null,
  right: Right,
): boolean {
  return rightsFor(my, scopeOrgId, procedureId).has(right);
}

/** RM-23 : administration sur cette organisation = un profil actif `is_admin` dont le périmètre la contient. */
export function isAdminOn(my: MyRights, scopeOrgId: string): boolean {
  if (my.is_platform_admin) return true;
  return my.profiles.some((p) => isEligible(p, scopeOrgId) && p.is_admin);
}

/** Au moins un profil actif attribué (CL-01 : sans profil, aucune demande n'est jamais visible). */
export function hasAnyProfile(my: MyRights): boolean {
  return my.profiles.some((p) => p.status === "active");
}

/**
 * Démarches explicitement citées avec `création` dans une ligne de matrice active.
 * Incomplet par construction : les démarches qui obtiennent `création` par le
 * DÉFAUT d'un profil (RM-33) n'y figurent pas tant qu'on ne connaît pas le
 * cache des démarches actives — voir `creatableProcedures`.
 */
export function creatableProcedureIds(my: MyRights): Set<string> {
  const out = new Set<string>();
  for (const profile of my.profiles) {
    if (profile.status !== "active" || profile.scope_organization_ids.length === 0) continue;
    for (const [procedureId, rights] of Object.entries(profile.procedures)) {
      if (rights.includes("creation")) out.add(procedureId);
    }
  }
  return out;
}

/** La démarche `procedureId` (connue) est-elle créable sur au moins une organisation ? */
export function canCreateProcedure(my: MyRights, procedureId: string): boolean {
  return my.profiles.some((profile) => {
    if (profile.status !== "active" || profile.scope_organization_ids.length === 0) return false;
    return proceduresRightsIn(profile, procedureId).includes("creation");
  });
}

/**
 * Démarches créables parmi `cacheIds` (démarches actives du cache du tenant) —
 * résout aussi bien les lignes explicites que les droits par défaut (RM-58).
 */
export function creatableProcedures(my: MyRights, cacheIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const procedureId of cacheIds) {
    if (canCreateProcedure(my, procedureId)) out.add(procedureId);
  }
  return out;
}

/**
 * Démarches créables parmi `cacheIds` **pour une organisation donnée** (RM-59).
 *
 * Sœur de `creatableProcedures`, qui répond « créable QUELQUE PART » : une fois
 * l'organisme arrêté (première étape du parcours de création depuis le
 * 2026-08-31), c'est cette question-ci qu'il faut poser — sans quoi le
 * sélecteur proposerait des démarches que le serveur refuserait pour CET
 * organisme.
 *
 * ⚠️ Elle ne répond QUE des droits. Ce qu'un organisme propose vraiment se
 * croise avec l'activation Socle — `creation/proposables.ts`, seul endroit où
 * les quatre règles se rencontrent.
 */
export function creatableProceduresOn(
  my: MyRights,
  scopeOrgId: string,
  cacheIds: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const procedureId of cacheIds) {
    if (creationOrganizationIds(my, procedureId).has(scopeOrgId)) out.add(procedureId);
  }
  return out;
}

/** La démarche `procedureId` (connue) est-elle consultable sur au moins une organisation ? */
export function canViewProcedure(my: MyRights, procedureId: string): boolean {
  return my.profiles.some((profile) => {
    if (profile.status !== "active" || profile.scope_organization_ids.length === 0) return false;
    return proceduresRightsIn(profile, procedureId).length > 0;
  });
}

/**
 * Démarches consultables parmi `cacheIds` (démarches actives du cache du
 * tenant) — résout lignes explicites et droits par défaut, comme
 * `creatableProcedures`. Utilisé pour filtrer les sélecteurs de démarche en
 * lecture (facettes, filtres) sans dupliquer la logique de combinaison.
 */
export function viewableProcedures(my: MyRights, cacheIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const procedureId of cacheIds) {
    if (canViewProcedure(my, procedureId)) out.add(procedureId);
  }
  return out;
}

/**
 * Organisations (déjà en sous-arbre) où `création` est accordée pour `procedureId`
 * (`null` = pseudo-démarche sans démarche). À intersecter par l'appelant avec le
 * sous-arbre du tenant réellement proposé par la démarche (RM-59).
 */
export function creationOrganizationIds(my: MyRights, procedureId: string | null): Set<string> {
  const key = procedureId ?? my.no_procedure_id;
  const out = new Set<string>();
  for (const profile of my.profiles) {
    if (profile.status !== "active") continue;
    if (proceduresRightsIn(profile, key).includes("creation")) {
      for (const orgId of profile.scope_organization_ids) out.add(orgId);
    }
  }
  return out;
}

/** Noms des profils qui accordent `right` sur ce couple — RM-46 (« pourquoi ne puis-je pas ? »). */
export function explainRight(
  my: MyRights,
  scopeOrgId: string,
  procedureId: string | null,
  right: Right,
): string[] {
  if (my.is_platform_admin) return ["Administrateur de la plateforme"];

  const key = procedureId ?? my.no_procedure_id;
  const names: string[] = [];
  for (const profile of my.profiles) {
    if (!isEligible(profile, scopeOrgId)) continue;
    if (withImpliedConsultation(proceduresRightsIn(profile, key)).has(right)) {
      names.push(profile.name);
    }
  }
  return names;
}

export const RIGHT_LABELS: Record<Right, string> = {
  consultation: "Consultation",
  creation: "Création",
  instruction: "Instruction",
  cloture: "Clôture",
};
