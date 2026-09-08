// Sanitisation des réponses Socle avant transmission au navigateur —
// WHITELIST STRICTE (tolérante aux champs inconnus : tout ce qui n'est pas
// listé est ignoré). internal_notes, consentements et relations ne sont
// JAMAIS transmis. Logique pure, testée par vitest.

// deno-lint-ignore-file no-explicit-any

import {
  parseProcedureDocuments,
  type ProcedureDocuments,
} from "../../_shared/document/templates.ts";
import { type AgentKnowledge, parseAgentKnowledge } from "./knowledge.ts";
import {
  parseProcedureStatus,
  parsePublication,
  type ProcedurePublication,
  type ProcedureStatus,
} from "../../_shared/procedures/publication.ts";

/** Champs d'une fiche usager transmis aux agents Iris. */
const CONTACT_FIELDS = [
  "id", "contact_type", "status", "display_name",
  "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone", "preferred_channel",
  "address_line1", "address_line2", "postal_code", "city", "country",
] as const;

export function sanitizeContact(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of CONTACT_FIELDS) {
    out[key] = raw[key] ?? null;
  }
  // Quartier résolu (id, name, color) — seul objet imbriqué conservé.
  const q = raw.quartier;
  out.quartier =
    typeof q === "object" && q !== null && typeof q.id === "string"
      ? { id: q.id, name: q.name ?? null, color: q.color ?? null }
      : null;
  return out;
}

/**
 * Organisation PRINCIPALE du tenant — whitelist MINIMALE : de quoi ancrer une
 * carte sur le siège de la collectivité, et rien de plus.
 *
 * ⚠️ `phone` et `email`, que le contrat Socle sert pourtant sur la même fiche,
 * ne franchissent PAS : aucun écran n'en a l'usage aujourd'hui, et une
 * whitelist ne se justifie que champ par champ. Le jour où un écran en aura
 * besoin, on l'ajoutera pour ce besoin-là.
 *
 * L'adresse d'une mairie est publique — c'est ce qui permet à la route qui
 * l'expose d'être ouverte à tout membre, comme celle des quartiers.
 */
const ORGANIZATION_FIELDS = ["id", "name", "address"] as const;

export function sanitizeOrganization(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of ORGANIZATION_FIELDS) {
    out[key] = raw[key] ?? null;
  }
  return out;
}

/**
 * Quartier du référentiel, AVEC sa géométrie — la seule porte par laquelle
 * elle franchit la frontière.
 *
 * `sanitizeContact` continue de la retirer, et ce n'est pas une incohérence :
 * un polygone par ligne d'annuaire (200 fiches) serait du poids pur, là où une
 * carte a besoin des limites une fois. Une limite de quartier n'est pas une
 * donnée personnelle ; l'architecture validée prévoit d'ailleurs sa lecture à
 * la demande par ce proxy (« géométries de quartiers »).
 *
 * ⚠️ Le champ s'appelle `geometry` — c'est le nom du contrat public-api
 * (`QuartierDto`), du GeoJSON rendu par `ST_AsGeoJSON`. `geom` est le nom de la
 * COLONNE PostGIS, qui ne sort jamais telle quelle (binaire). Les confondre a
 * coûté un aller-retour le 2026-08-28 : la route rendait `geom: null` sur des
 * quartiers qui avaient pourtant tous leur polygone.
 */
const QUARTIER_FIELDS = ["id", "name", "color", "geometry"] as const;

export function sanitizeQuartier(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  const out: Record<string, unknown> = {};
  for (const key of QUARTIER_FIELDS) {
    out[key] = raw[key] ?? null;
  }
  return out;
}

export function sanitizeQuartierList(raw: any): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeQuartier).filter((q): q is Record<string, unknown> => q !== null);
}

export function sanitizeContactList(raw: any): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeContact).filter((c): c is Record<string, unknown> => c !== null);
}

/** Candidats du rapprochement : { contact, score, reasons } — contact sanitizé. */
export function sanitizeMatches(raw: any): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const contact = sanitizeContact(entry.contact);
    if (!contact) continue;
    out.push({
      contact,
      score: typeof entry.score === "number" ? entry.score : 0,
      reasons: Array.isArray(entry.reasons) ? entry.reasons.filter((r: unknown) => typeof r === "string") : [],
    });
  }
  return out;
}

/**
 * Résumé d'une démarche pour les listes/sélecteurs.
 *
 * `status` et `publication` traversent la frontière : l'agent doit voir si la
 * démarche est proposée aux usagers sur le portail, et entre quelles dates. Le
 * bloc `communication_config` BRUT, lui, ne passe pas — c'est sa lecture
 * effective qui passe (`_shared/procedures/publication.ts`), pour qu'aucun
 * écran n'ait à réappliquer les défauts du contrat ni le commutateur de
 * période.
 */
export function sanitizeProcedureSummary(raw: any): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    organization_id: raw.organization_id ?? null,
    category_id: raw.category_id ?? null,
    name: raw.name ?? null,
    type: raw.type ?? null,
    status: parseProcedureStatus(raw.status) satisfies ProcedureStatus,
    publication: parsePublication(raw.communication_config) satisfies ProcedurePublication,
    short_description: raw.short_description ?? null,
    input_duration_minutes: raw.input_duration_minutes ?? null,
  };
}

/**
 * Démarche complète pour le dépôt et l'instruction : + descriptions,
 * formulaire, et la **part agent** de la base de connaissances.
 *
 * `knowledge_base` a longtemps été exclue par principe (« hors besoin Iris ») ;
 * elle ne l'est plus, parce que le besoin a un nom : l'agent qui saisit ou
 * instruit doit lire les consignes du service sans quitter la demande. Ce qui
 * reste exclu, c'est la matière de l'assistant IA — `trainingDocuments`,
 * `aiSources` —, retirée par `parseAgentKnowledge` : un corpus de prompt n'a
 * rien à faire dans un navigateur, et le jour où l'assistant existera il le
 * lira côté serveur. Voir `_shared/knowledge.ts`.
 */
export function sanitizeProcedureFull(raw: any): Record<string, unknown> | null {
  const base = sanitizeProcedureSummary(raw);
  if (!base) return null;
  return {
    ...base,
    user_description: raw.user_description ?? null,
    agent_description: raw.agent_description ?? null,
    form_schema: raw.form_schema ?? null,
    requester_config: raw.requester_config ?? null,
    knowledge_base: parseAgentKnowledge(raw.knowledge_base) satisfies AgentKnowledge,
    // Modèles de document et de courrier de la démarche (contrat public-api
    // 1.6.0, 2026-09-01). L'écran en a besoin pour PROPOSER ; le fichier, lui,
    // ne transite jamais par le navigateur — l'edge function de génération le
    // télécharge côté serveur. `parseProcedureDocuments` ne recopie que le
    // contrat : un `file_path` inventé par le Socle ne franchirait pas.
    documents: parseProcedureDocuments(raw.documents) satisfies ProcedureDocuments,
  };
}

/** Clés acceptées à la création d'un usager (ContactCreate Socle, minimisé). */
const CONTACT_CREATE_KEYS = [
  "contact_type", "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone", "preferred_channel",
  "address_line1", "address_line2", "postal_code", "city", "country",
] as const;

/** Filtre le payload de création : clé inconnue → refus explicite. */
export function filterContactCreate(
  raw: any,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "contact : objet attendu." };
  }
  const allowed = new Set<string>(CONTACT_CREATE_KEYS);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { ok: false, message: `contact : clés non autorisées (${unknown.join(", ")}).` };
  }
  if (typeof raw.contact_type !== "string") {
    return { ok: false, message: "contact.contact_type : obligatoire." };
  }
  const payload: Record<string, unknown> = {};
  for (const key of CONTACT_CREATE_KEYS) {
    if (raw[key] !== undefined) payload[key] = raw[key];
  }
  return { ok: true, payload };
}

/**
 * Clés acceptées à la MISE À JOUR d'un usager (ContactUpdate Socle, minimisé) :
 * les mêmes qu'à la création, sans `contact_type` (immuable côté Socle). Le
 * PATCH est partiel — seules les clés transmises sont écrites, `null` efface.
 * Restent volontairement hors d'Iris (jamais lus, donc jamais écrits) :
 * internal_notes, consentements, rôles, références externes, relations,
 * coordonnées géographiques et quartier (recalculés par le Socle).
 */
const CONTACT_UPDATE_KEYS = [
  "civility", "first_name", "last_name", "usage_name", "birth_date",
  "legal_name", "siret",
  "email", "mobile_phone", "landline_phone", "preferred_channel",
  "address_line1", "address_line2", "postal_code", "city", "country",
] as const;

/** Filtre le patch : clé inconnue, immuable ou valeur non textuelle → refus explicite. */
export function filterContactUpdate(
  raw: any,
): { ok: true; payload: Record<string, string | null> } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "contact : objet attendu." };
  }
  if ("contact_type" in raw) {
    return { ok: false, message: "contact_type : immuable après la création (Socle)." };
  }
  if ("status" in raw) {
    return { ok: false, message: "status : l'archivage d'un usager ne se fait pas depuis Iris." };
  }
  const allowed = new Set<string>(CONTACT_UPDATE_KEYS);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { ok: false, message: `contact : clés non autorisées (${unknown.join(", ")}).` };
  }
  const payload: Record<string, string | null> = {};
  for (const key of CONTACT_UPDATE_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value !== null && typeof value !== "string") {
      return { ok: false, message: `contact.${key} : texte ou null attendu.` };
    }
    // Le Socle refuse un pays vide : on le dit ici, en français, sans aller-retour.
    if (key === "country" && (value === null || value.trim() === "")) {
      return { ok: false, message: "contact.country : le pays ne peut pas être vidé." };
    }
    payload[key] = value;
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, message: "contact : aucune modification transmise." };
  }
  return { ok: true, payload };
}

/** Clés acceptées pour le rapprochement (ContactMatchRequest Socle). */
const MATCH_KEYS = [
  "contact_type", "first_name", "last_name", "usage_name", "legal_name",
  "siret", "birth_date", "email", "phones", "limit",
] as const;

export function filterMatchRequest(
  raw: any,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "identity : objet attendu." };
  }
  const allowed = new Set<string>(MATCH_KEYS);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return { ok: false, message: `identity : clés non autorisées (${unknown.join(", ")}).` };
  }
  const payload: Record<string, unknown> = {};
  for (const key of MATCH_KEYS) {
    if (raw[key] !== undefined) payload[key] = raw[key];
  }
  return { ok: true, payload };
}

/**
 * Paramètres de la LISTE des usagers (`/v1/contacts/list` → contacts-api
 * `GET /v1/contacts`) : whitelist stricte, valeurs bornées. La liste d'Iris
 * pagine côté serveur du Socle ; le tri, les compteurs de demandes et les
 * filtres propres à Iris (quartier, volumétrie) s'appliquent ensuite dans le
 * navigateur sur l'ensemble rapatrié.
 *
 * `status` : « active » par défaut (le référentiel archive, il n'efface pas),
 * « archived », ou « all » — auquel cas le paramètre n'est PAS transmis, ce
 * que le contrat contacts-api interprète comme « tous statuts ».
 */
const CONTACT_TYPES = ["personne", "entreprise", "association", "administration"] as const;
export const CONTACT_LIST_MAX_LIMIT = 500;
export const CONTACT_LIST_DEFAULT_LIMIT = 200;

export function filterContactListQuery(
  raw: any,
): { ok: true; params: Record<string, string>; limit: number } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Corps JSON attendu." };
  }
  const params: Record<string, string> = {};

  const search = raw.search;
  if (search !== undefined && search !== null && search !== "") {
    if (typeof search !== "string") return { ok: false, message: "search : texte attendu." };
    const trimmed = search.trim();
    if (trimmed.length > 200) return { ok: false, message: "search : 200 caractères au plus." };
    if (trimmed !== "") params.search = trimmed;
  }

  const type = raw.type;
  if (type !== undefined && type !== null && type !== "") {
    if (typeof type !== "string" || !(CONTACT_TYPES as readonly string[]).includes(type)) {
      return { ok: false, message: `type : une valeur parmi ${CONTACT_TYPES.join(", ")}.` };
    }
    params.type = type;
  }

  const status = raw.status === undefined || raw.status === null || raw.status === ""
    ? "active"
    : raw.status;
  if (status !== "active" && status !== "archived" && status !== "all") {
    return { ok: false, message: "status : active, archived ou all." };
  }
  if (status !== "all") params.status = status;

  const rawLimit = raw.limit;
  let limit = CONTACT_LIST_DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== null) {
    if (typeof rawLimit !== "number" || !Number.isFinite(rawLimit)) {
      return { ok: false, message: "limit : nombre attendu." };
    }
    limit = Math.floor(rawLimit);
    if (limit < 1 || limit > CONTACT_LIST_MAX_LIMIT) {
      return { ok: false, message: `limit : entre 1 et ${CONTACT_LIST_MAX_LIMIT}.` };
    }
  }
  params.limit = String(limit);

  const rawOffset = raw.offset;
  let offset = 0;
  if (rawOffset !== undefined && rawOffset !== null) {
    if (typeof rawOffset !== "number" || !Number.isFinite(rawOffset) || rawOffset < 0) {
      return { ok: false, message: "offset : entier positif attendu." };
    }
    offset = Math.floor(rawOffset);
  }
  params.offset = String(offset);

  return { ok: true, params, limit };
}

/**
 * Consommation IA d'une collectivité, telle que la rend `ai-api /v1/usage`.
 *
 * ⚠️ LES NOMS DE CHAMPS SONT CEUX DU SOCLE, à la lettre — même règle que
 * `knowledge.ts`, et pour la même raison : la sortie est un sous-ensemble
 * strict de l'entrée, donc la sanitisation est IDEMPOTENTE. Renommer au
 * passage ferait disparaître au second tour ce que le premier avait gardé
 * (vécu le 2026-08-28).
 *
 * Ce qui est délibérément ÉCARTÉ :
 *  - `organization_id` — c'est l'identifiant SOCLE de la collectivité, dérivé
 *    côté serveur du tenant ; le navigateur n'en a aucun usage et n'a pas à
 *    apprendre la correspondance.
 *  - `unlimited` / `remaining_tokens` — DÉRIVÉS de (limit, used, reserved).
 *    Iris les recalcule avec `quotaView`, qui dessine aussi la jauge : les
 *    transmettre offrirait deux sources pour un même nombre, donc une
 *    occasion de diverger. Le Socle possède les FAITS, Iris la présentation.
 *
 * Ce qui est délibérément CONSERVÉ : `renews_at`. La date de renouvellement
 * appartient au Socle, qui possède la période — c'est tout l'objet de la
 * centralisation, et la recomposer ici recréerait le jumeau supprimé.
 */
export interface AiUsageConsumerRow {
  consumer: string;
  feature: string | null;
  calls: number;
  tokens: number;
}

export interface AiUsageView {
  period: string;
  renews_at: string | null;
  limit: number | null;
  used_tokens: number;
  reserved_tokens: number;
  by_consumer: AiUsageConsumerRow[];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function sanitizeAiUsage(raw: any): AiUsageView {
  const empty: AiUsageView = {
    period: "",
    renews_at: null,
    limit: null,
    used_tokens: 0,
    reserved_tokens: 0,
    by_consumer: [],
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty;

  const rows: AiUsageConsumerRow[] = [];
  if (Array.isArray(raw.by_consumer)) {
    for (const entry of raw.by_consumer) {
      if (typeof entry !== "object" || entry === null) continue;
      const consumer = typeof entry.consumer === "string" ? entry.consumer.trim() : "";
      // Sans nom d'application, la ligne n'apprend rien à un administrateur.
      if (consumer === "") continue;
      rows.push({
        consumer,
        feature: typeof entry.feature === "string" && entry.feature.trim() !== ""
          ? entry.feature.trim()
          : null,
        calls: count(entry.calls),
        tokens: count(entry.tokens),
      });
    }
  }

  return {
    period: typeof raw.period === "string" ? raw.period : "",
    renews_at: typeof raw.renews_at === "string" && raw.renews_at !== "" ? raw.renews_at : null,
    // Un plafond nul ou négatif VAUT aucun plafond (`quotaView` en dit autant).
    limit: typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
      ? Math.floor(raw.limit)
      : null,
    used_tokens: count(raw.used_tokens),
    reserved_tokens: count(raw.reserved_tokens),
    by_consumer: rows,
  };
}
