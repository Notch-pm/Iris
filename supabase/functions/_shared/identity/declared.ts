// Identité DÉCLARÉE : la table des synonymes de clés, et ce qu'on en fait.
// Module PUR (aucune dépendance Deno, aucun réseau) — testé par vitest.
//
// Une identité arrive dans Iris sous trois écritures différentes : les clés de
// `contacts-api` (fiche Socle relue), celles des publics Iris (`requester_config`,
// saisies au guichet), et tout ce qu'un partenaire décide d'envoyer à l'API
// d'ingestion. `DECLARED_KEYS` est la SEULE table qui sache les rapprocher.
//
// ⚠️ Elle vit ici, et pas dans ses consommateurs, parce que ceux-ci ont des
// métiers différents et qu'on ne veut pas deux vérités :
//   - `requesterIdentity()` (écran) AFFICHE une identité ;
//   - `contactCreatePayload()` (ingestion) l'ÉCRIT dans le Socle.
// Recopier les synonymes dans l'un des deux les ferait diverger au premier
// format partenaire un peu exotique.
//
// Granularité volontairement plus fine que l'affichage : `lastName` (nom de
// naissance) et `usageName` (nom d'usage) sont DEUX champs distincts pour
// contacts-api, là où un écran n'affiche qu'« un nom ».

/** Synonymes acceptés, par champ logique. Ordre = priorité de lecture. */
export const DECLARED_KEYS = {
  civility: ["civility", "civilite"],
  displayName: ["display_name", "name", "full_name"],
  firstName: ["first_name", "prenoms", "prenom", "firstName"],
  lastName: ["last_name", "nom_naissance", "nom", "lastName"],
  usageName: ["usage_name", "nom_usuel"],
  legalName: ["legal_name", "raison_sociale"],
  birthDate: ["birth_date", "date_naissance"],
  siret: ["siret"],
  email: ["email", "courriel", "mail"],
  mobilePhone: ["mobile_phone", "tel_portable", "phone", "telephone", "mobile"],
  landlinePhone: ["landline_phone", "tel_fixe"],
  addressFree: ["adresse", "address"],
  addressLine1: ["address_line1"],
  addressLine2: ["address_line2"],
  postalCode: ["postal_code"],
  city: ["city"],
} as const;

export type DeclaredField = keyof typeof DECLARED_KEYS;

/** Toutes les clés interprétées, à plat — ce que les consommateurs savent lire. */
export const ALL_DECLARED_KEYS: readonly string[] = Object.values(DECLARED_KEYS).flat();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Première valeur non vide parmi les synonymes du champ. */
export function pickDeclared(declared: unknown, field: DeclaredField): string | null {
  if (!isRecord(declared)) return null;
  for (const key of DECLARED_KEYS[field]) {
    const value = declared[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

export type ContactType = "personne" | "entreprise" | "association";

/**
 * Type de fiche à créer. Une raison sociale ou un SIRET fait une STRUCTURE ;
 * tout le reste est une personne. On ne distingue pas entreprise et
 * association sans que le partenaire le dise : `entreprise` est le défaut le
 * moins engageant, et le type reste corrigeable dans le Socle.
 */
export function declaredContactType(declared: unknown): ContactType {
  const explicit = isRecord(declared) ? declared.contact_type : null;
  if (explicit === "personne" || explicit === "entreprise" || explicit === "association") {
    return explicit;
  }
  const structure = pickDeclared(declared, "legalName") ?? pickDeclared(declared, "siret");
  return structure ? "entreprise" : "personne";
}

export interface MatchIdentityPayload {
  contact_type: ContactType;
  last_name?: string;
  usage_name?: string;
  first_name?: string;
  legal_name?: string;
  siret?: string;
  email?: string;
  phones?: string[];
  limit?: number;
}

/**
 * Critères de rapprochement pour `contacts-api /v1/contacts/match`.
 * `null` sans aucun discriminant : interroger le référentiel avec du vide n'a
 * pas de sens, et créer une fiche anonyme encore moins.
 */
export function matchIdentityFromDeclared(declared: unknown): MatchIdentityPayload | null {
  const type = declaredContactType(declared);
  const out: MatchIdentityPayload = { contact_type: type };

  const last = pickDeclared(declared, "lastName");
  const usage = pickDeclared(declared, "usageName");
  const first = pickDeclared(declared, "firstName");
  const legal = pickDeclared(declared, "legalName");
  const siret = pickDeclared(declared, "siret");
  const email = pickDeclared(declared, "email");
  const phones = [pickDeclared(declared, "mobilePhone"), pickDeclared(declared, "landlinePhone")]
    .filter((p): p is string => p !== null);

  // Un partenaire qui n'envoie qu'un `display_name` ne doit pas être perdu :
  // faute de nom structuré, il sert de nom de famille pour la recherche.
  const fallbackName = last ?? pickDeclared(declared, "displayName");

  if (fallbackName) out.last_name = fallbackName;
  if (usage) out.usage_name = usage;
  if (first) out.first_name = first;
  if (legal) out.legal_name = legal;
  if (siret) out.siret = siret;
  if (email) out.email = email;
  if (phones.length > 0) out.phones = phones;

  const hasDiscriminant = Boolean(
    out.last_name || out.usage_name || out.legal_name || out.siret || out.email || out.phones,
  );
  return hasDiscriminant ? out : null;
}

/**
 * Raisons de rapprochement qui reposent sur un IDENTIFIANT FORT. Jumeau de
 * `STRONG_REASONS` côté écran (RequesterIdentification).
 *
 * ⚠️ Un nom identique ne suffit JAMAIS à réutiliser une fiche. À l'écran, un
 * agent tranche ; à l'ingestion, personne ne tranche — rattacher une demande à
 * l'homonyme d'un habitant serait pire qu'un doublon : c'est une fuite de
 * données d'un usager vers un autre.
 */
const STRONG_MATCH_REASONS = new Set([
  "email_exact",
  "phone_exact",
  "siret_exact",
]);

export function hasStrongMatch(reasons: unknown): boolean {
  if (!Array.isArray(reasons)) return false;
  return reasons.some((r) => typeof r === "string" && STRONG_MATCH_REASONS.has(r));
}

/**
 * Payload de création pour `contacts-api POST /v1/contacts` — whitelist, clés
 * non vides uniquement. `null` s'il n'y a pas de quoi nommer la fiche : le
 * Socle la refuserait, et une fiche sans nom ne sert personne.
 */
export function contactCreatePayload(declared: unknown): Record<string, string> | null {
  const type = declaredContactType(declared);
  const out: Record<string, string> = { contact_type: type };

  const put = (key: string, value: string | null) => {
    if (value !== null && value !== "") out[key] = value;
  };

  if (type === "personne") {
    const last = pickDeclared(declared, "lastName") ?? pickDeclared(declared, "displayName");
    put("last_name", last);
    put("usage_name", pickDeclared(declared, "usageName"));
    put("first_name", pickDeclared(declared, "firstName"));
    put("civility", pickDeclared(declared, "civility"));
    put("birth_date", pickDeclared(declared, "birthDate"));
    if (!out.last_name) return null;
  } else {
    put("legal_name", pickDeclared(declared, "legalName") ?? pickDeclared(declared, "displayName"));
    put("siret", pickDeclared(declared, "siret"));
    if (!out.legal_name) return null;
  }

  put("email", pickDeclared(declared, "email"));
  put("mobile_phone", pickDeclared(declared, "mobilePhone"));
  put("landline_phone", pickDeclared(declared, "landlinePhone"));
  // `address_line1` d'abord ; à défaut l'adresse libre d'un partenaire, qui n'a
  // pas de découpage — le Socle re-géocode et recalcule le quartier de toute façon.
  put("address_line1", pickDeclared(declared, "addressLine1") ?? pickDeclared(declared, "addressFree"));
  put("address_line2", pickDeclared(declared, "addressLine2"));
  put("postal_code", pickDeclared(declared, "postalCode"));
  put("city", pickDeclared(declared, "city"));

  return out;
}

/**
 * Identité retenue AU DÉPÔT pour un usager rapproché : relue depuis la fiche
 * Socle (vérité du référentiel au moment T), whitelist stricte — `internal_notes`,
 * consentements, relations… n'existent pas ici par construction.
 *
 * Les clés sont celles de `contacts-api`, c'est-à-dire le PREMIER synonyme de
 * chaque champ de `DECLARED_KEYS` : ce qui sort d'ici se relit donc avec
 * `pickDeclared`, et s'affiche avec `requesterIdentity`.
 *
 * ⚠️ Vivait dans `create-request-from-procedure/_shared/snapshots.ts` jusqu'au
 * 2026-08-26. Déplacée quand `requests-api` en a eu besoin à son tour : une
 * fonction n'importe pas le module privé d'une autre.
 */
const CONTACT_IDENTITY_KEYS = [
  "display_name", "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone",
  "address_line1", "postal_code", "city",
] as const;

// deno-lint-ignore no-explicit-any
export function contactIdentitySnapshot(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of CONTACT_IDENTITY_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}
