// Carte des interventions — logique PURE (sans DOM ni réseau), testée : quelles
// demandes sont situables, comment dédoublonner leur géocodage, comment les
// filtrer, où poser les épingles et la fiche de survol.
//
// Rien ici ne protège quoi que ce soit : le RLS borne déjà les demandes lues,
// et l'adresse vient du `form_data` de la demande (bloc « Lieu d'intervention »
// de la démarche — voir `instruction/lieu.ts`).

import type { BatchAddress, GeoPrecision } from "@/lib/carto";
import { formatDayMonth, priorityOption, requesterIdentity } from "../instruction/instruction";
import { interventionLocation, type InterventionLocation } from "../instruction/lieu";

// « En cours » = ni clôturée ni archivée. La liste vit avec la matrice de
// transitions (`../statuts`) ; on la re-publie ici pour les appelants de la carte.
export { OPEN_STATUSES } from "../statuts";

/** Plafond de demandes chargées : une carte au-delà n'est plus lisible. */
export const MAP_MAX_ROWS = 500;

export interface MapRequestRow {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  socle_procedure_id: string | null;
  socle_procedure_label: string | null;
  socle_category_label: string | null;
  socle_organization_label: string | null;
  assigned_to: string | null;
  received_at: string;
  identity_status: string;
  requester_snapshot: unknown;
  form_data: unknown;
  /** `procedure_snapshot->form_schema` : seule partie du snapshot utile ici. */
  form_schema: unknown;
}

export interface LocatedRequest {
  row: MapRequestRow;
  lieu: InterventionLocation;
  /** Clé d'adresse : mutualise le géocodage entre demandes d'une même adresse. */
  addressKey: string;
}

export function addressKey(lieu: InterventionLocation): string {
  return `${lieu.query.toLocaleLowerCase("fr")}|${lieu.postcode ?? ""}`;
}

export interface Locatable {
  located: LocatedRequest[];
  /** Demandes en cours sans adresse exploitable (démarche sans bloc, ou non renseignée). */
  withoutAddress: number;
}

/** Partage les demandes en « situables » (adresse postale) et le reste. */
export function locatableRequests(rows: MapRequestRow[]): Locatable {
  const located: LocatedRequest[] = [];
  let withoutAddress = 0;
  for (const row of rows) {
    const lieu = interventionLocation({ form_schema: row.form_schema }, row.form_data);
    if (!lieu || lieu.query === "") {
      withoutAddress++;
      continue;
    }
    located.push({ row, lieu, addressKey: addressKey(lieu) });
  }
  return { located, withoutAddress };
}

/** Adresses distinctes à géocoder (une ligne par adresse, pas par demande). */
export function distinctAddresses(located: LocatedRequest[]): BatchAddress[] {
  const seen = new Map<string, BatchAddress>();
  for (const item of located) {
    if (seen.has(item.addressKey)) continue;
    seen.set(item.addressKey, {
      key: item.addressKey,
      query: item.lieu.query,
      postcode: item.lieu.postcode,
    });
  }
  return [...seen.values()];
}

export interface GeocodeBatchPlan {
  /** Clé de requête du lot — stable, quel que soit l'état du cache. */
  signature: string;
  /** Adresses restant à géocoder. */
  missing: BatchAddress[];
}

/**
 * Ce qu'il reste à géocoder, et sous quelle clé de requête.
 *
 * ⚠️ La signature porte TOUTES les adresses demandées, jamais les seules
 * manquantes : si elle suivait le cache, elle changerait à l'instant où celui-ci
 * se remplit, la réponse arriverait sur une clé abandonnée et les points
 * n'atteindraient jamais le rendu (bug du 2026-08-23 — « aucune adresse
 * localisée » alors que le service avait répondu).
 */
export function geocodeBatchPlan(
  addresses: BatchAddress[],
  isCached: (key: string) => boolean,
): GeocodeBatchPlan {
  return {
    signature: addresses.map((address) => address.key).sort().join("|"),
    missing: addresses.filter((address) => !isCached(address.key)),
  };
}

// ---- Filtres ----------------------------------------------------------------

/** Valeur de facette des demandes historiques sans démarche. */
export const NO_PROCEDURE = "__sans_demarche__";

export interface MapFilters {
  /** Ids de démarches retenus — vide = toutes. */
  procedures: string[];
  /** Urgences retenues — vide = toutes. */
  priorities: string[];
}

export const EMPTY_MAP_FILTERS: MapFilters = { procedures: [], priorities: [] };

export function procedureKey(row: MapRequestRow): string {
  return row.socle_procedure_id ?? NO_PROCEDURE;
}

export function filterRequests(located: LocatedRequest[], filters: MapFilters): LocatedRequest[] {
  const procedures = new Set(filters.procedures);
  const priorities = new Set(filters.priorities);
  return located.filter(
    (item) =>
      (procedures.size === 0 || procedures.has(procedureKey(item.row))) &&
      (priorities.size === 0 || priorities.has(item.row.priority)),
  );
}

export interface CountedOption {
  value: string;
  label: string;
  count: number;
}

/** Démarches présentes parmi les demandes situées, avec leur volume (ordre FR). */
export function procedureFacets(located: LocatedRequest[]): CountedOption[] {
  const counts = new Map<string, CountedOption>();
  for (const item of located) {
    const value = procedureKey(item.row);
    const existing = counts.get(value);
    if (existing) {
      existing.count++;
      continue;
    }
    counts.set(value, {
      value,
      label: item.row.socle_procedure_label ?? "Sans démarche",
      count: 1,
    });
  }
  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
}

/** Volume par urgence parmi les demandes situées (pour la légende filtrante). */
export function priorityCounts(located: LocatedRequest[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of located) {
    counts[item.row.priority] = (counts[item.row.priority] ?? 0) + 1;
  }
  return counts;
}

/** Bascule d'une valeur dans une sélection multiple (filtres à cases). */
export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

// ---- Placement des épingles et de la fiche ----------------------------------

/**
 * Écartement des demandes situées au même point : sans lui, seule la dernière
 * épingle serait cliquable. Anneaux de 8 autour du point exact.
 */
export function spreadOffset(index: number, total: number, radius = 13): { dx: number; dy: number } {
  if (total <= 1 || index === 0) return { dx: 0, dy: 0 };
  const perRing = 8;
  const ring = Math.floor((index - 1) / perRing) + 1;
  const position = (index - 1) % perRing;
  const angle = (2 * Math.PI * position) / perRing - Math.PI / 2;
  return {
    dx: Math.cos(angle) * radius * ring,
    dy: Math.sin(angle) * radius * ring,
  };
}

/** Décalages de chaque demande d'un même point, indexés par id de demande. */
export function spreadByPoint(
  items: { id: string; pointKey: string }[],
  radius = 13,
): Record<string, { dx: number; dy: number }> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const group = groups.get(item.pointKey);
    if (group) group.push(item.id);
    else groups.set(item.pointKey, [item.id]);
  }
  const out: Record<string, { dx: number; dy: number }> = {};
  for (const ids of groups.values()) {
    ids.forEach((id, index) => {
      out[id] = spreadOffset(index, ids.length, radius);
    });
  }
  return out;
}

export interface CardAnchor {
  left: number;
  top: number;
  /** La fiche s'ouvre à gauche de l'épingle (bord droit atteint). */
  flipped: boolean;
}

/**
 * Position de la fiche de survol : à droite de l'épingle par défaut, à gauche
 * si elle sortirait du cadre, et toujours maintenue dans le conteneur.
 */
export function cardAnchor(
  pin: { left: number; top: number },
  container: { width: number; height: number },
  card: { width: number; height: number },
  gap = 16,
): CardAnchor {
  const margin = 8;
  const right = pin.left + gap;
  const flipped = right + card.width > container.width - margin;
  const rawLeft = flipped ? pin.left - gap - card.width : right;
  const maxLeft = Math.max(margin, container.width - card.width - margin);
  const maxTop = Math.max(margin, container.height - card.height - margin);
  return {
    left: Math.min(Math.max(margin, rawLeft), maxLeft),
    top: Math.min(Math.max(margin, pin.top - card.height / 2), maxTop),
    flipped,
  };
}

// ---- Fiche de survol --------------------------------------------------------

/**
 * Le géocodeur rend TOUJOURS son meilleur candidat : une adresse mal saisie
 * ressort avec un score faible sur une voie voisine. L'épingle est donc
 * accompagnée d'une réserve dès que le point n'est pas un numéro sûr — jamais
 * masquée pour autant, l'agent reste juge.
 */
const RELIABLE_SCORE = 0.55;

export function locationHint(point: { precision: GeoPrecision; score: number }): string | null {
  if (point.score < RELIABLE_SCORE) return "Localisation approximative — vérifiez l'adresse";
  switch (point.precision) {
    case "adresse":
      return null;
    case "voie":
      return "Localisée à la voie — numéro non trouvé";
    case "lieu_dit":
      return "Localisée au lieu-dit";
    default:
      return "Localisée à la commune";
  }
}

export interface MapCardRow {
  label: string;
  value: string;
}

export interface MapCard {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priorityKey: string;
  priorityLabel: string;
  usager: string;
  address: string[];
  rows: MapCardRow[];
}

/**
 * Informations essentielles d'une demande pour la fiche de survol : état,
 * usager, date de dépôt, urgence, démarche, catégorie, destinataire et agent
 * instructeur — l'identité est celle figée au dépôt (`requester_snapshot`).
 */
export function mapCard(item: LocatedRequest, agentName: string | null): MapCard {
  const row = item.row;
  const identity = requesterIdentity(row.requester_snapshot, row.identity_status);
  const priority = priorityOption(row.priority);
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status,
    priorityKey: row.priority,
    priorityLabel: priority.label,
    usager: identity.name,
    address: [...item.lieu.lines, ...item.lieu.details.map((d) => `${d.label} : ${d.value}`)],
    rows: [
      { label: "Usager", value: identity.name },
      { label: "Déposée le", value: formatDayMonth(row.received_at, true) },
      { label: "Urgence", value: priority.label },
      { label: "Démarche", value: row.socle_procedure_label ?? "Sans démarche" },
      { label: "Catégorie", value: row.socle_category_label ?? "—" },
      { label: "Destinataire", value: row.socle_organization_label ?? "À affecter" },
      { label: "Agent instructeur", value: agentName ?? "Non affectée" },
    ],
  };
}
