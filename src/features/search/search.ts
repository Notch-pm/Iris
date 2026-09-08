// Recherche globale du header — LOGIQUE PURE (sans DOM ni réseau), testée.
//
// Deux natures, deux sources qu'aucun serveur ne joint (même partage que la
// liste des usagers) : les DEMANDES viennent d'Iris (bornées par le RLS), les
// USAGERS du référentiel Socle via `socle-proxy`. Le regroupement, les libellés
// et le parcours au clavier se décident ici ; le composant ne fait qu'afficher.

import type { SocleContact } from "@/features/contacts/rapprochement";
import { contactName } from "@/features/contacts/usager";
import { STATUS_LABELS, type RequestStatus } from "@/features/requests/statuts";

/** En deçà, on ne cherche pas : trois caractères ramèneraient tout le tenant. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Temporisation de la frappe. Le cache de TanStack Query dédoublonne les
 * préfixes déjà tapés ; ce délai-ci évite d'ÉMETTRE la requête intermédiaire —
 * ce que le cache ne peut pas faire, et qui coûterait au serveur un aller-retour
 * par caractère (motif `useAddressSuggestions`).
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** Ce que la barre montre par nature — au-delà, on affine sa recherche. */
export const RESULTS_PER_KIND = 6;

// ---- Saisie -----------------------------------------------------------------

/** Saisie ramenée à sa forme cherchée : taillée, espaces internes recollés. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

// La saisie part TELLE QUELLE à la RPC `search_requests` : c'est elle qui
// normalise (minuscules sans accents) et échappe les métacaractères de LIKE,
// des deux côtés de la comparaison. Aucun jumeau JavaScript d'`unaccent` ici —
// il aurait divergé du serveur sur « cœur », « ß » ou « ø », et une recherche
// qui ne trouve rien ne dit jamais pourquoi. Voir la migration
// `20260901130000_recherche_insensible_aux_accents.sql`.

// ---- Résultats --------------------------------------------------------------

/**
 * Ligne rendue par `search_requests` — strictement les colonnes affichées.
 * Les noms sont préfixés côté SQL : dans une fonction `language sql`, les
 * colonnes d'un RETURNS TABLE sont des paramètres OUT qui masqueraient celles
 * de `requests`.
 *
 * ⚠️ Le générateur de types Supabase ignore la nullabilité d'un RETURNS TABLE
 * et déclare tout non-nul : `request_assigned_to` et `request_organisme` le
 * sont pourtant (demande non affectée, demande sans organisme).
 */
export interface RequestSearchRow {
  request_id: string;
  request_reference: string;
  request_subject: string;
  request_status: string;
  request_received_at: string;
  request_assigned_to: string | null;
  request_organisme: string | null;
}

export interface RequestResult {
  kind: "demande";
  id: string;
  href: string;
  /** Code de suivi (`DEM-2026-000042`). */
  reference: string;
  /** Libellé de la demande. */
  subject: string;
  status: string;
  statusLabel: string;
  /** Date de dépôt, au format français. */
  receivedAt: string;
  /** Agent instructeur, ou « Non affectée ». */
  agent: string;
  /** Organisme responsable, ou « — » quand la demande n'en porte pas. */
  organisme: string;
}

export interface UsagerResult {
  kind: "usager";
  id: string;
  href: string;
  /** Nom et prénom composés (motif de la fiche usager). */
  name: string;
  /** Ville de l'adresse — vide si le référentiel n'en porte pas. */
  city: string;
}

export type SearchResult = RequestResult | UsagerResult;

export type GroupKey = "demandes" | "usagers";

export interface SearchGroup {
  key: GroupKey;
  label: string;
  results: SearchResult[];
}

/** « 12/08/2026 » — date de dépôt telle qu'elle se lit dans les listes. */
export function frDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Une demande sans instructeur se dit « Non affectée », comme partout ailleurs. */
export function agentLabel(assignedTo: string | null, nameOf: (userId: string) => string): string {
  return assignedTo ? nameOf(assignedTo) : "Non affectée";
}

export function toRequestResult(
  row: RequestSearchRow,
  nameOf: (userId: string) => string,
): RequestResult {
  return {
    kind: "demande",
    id: row.request_id,
    href: `/demandes/${row.request_id}`,
    reference: row.request_reference,
    subject: row.request_subject,
    status: row.request_status,
    statusLabel: STATUS_LABELS[row.request_status as RequestStatus] ?? row.request_status,
    receivedAt: frDateTime(row.request_received_at),
    agent: agentLabel(row.request_assigned_to, nameOf),
    organisme: row.request_organisme?.trim() || "—",
  };
}

export function toUsagerResult(contact: SocleContact): UsagerResult {
  return {
    kind: "usager",
    id: contact.id,
    href: `/usagers/${contact.id}`,
    name: contactName(contact),
    city: contact.city?.trim() ?? "",
  };
}

/**
 * Groupes affichés, dans cet ordre : demandes puis usagers (l'agent cherche
 * d'abord un dossier). Un groupe vide n'apparaît pas — un en-tête sans ligne
 * ferait croire à une recherche en cours.
 */
export function buildGroups(
  requests: readonly RequestSearchRow[],
  contacts: readonly SocleContact[],
  nameOf: (userId: string) => string,
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  if (requests.length > 0) {
    groups.push({
      key: "demandes",
      label: "Demandes",
      results: requests.map((row) => toRequestResult(row, nameOf)),
    });
  }
  if (contacts.length > 0) {
    groups.push({
      key: "usagers",
      label: "Usagers",
      results: contacts.map(toUsagerResult),
    });
  }
  return groups;
}

/** Ordre de parcours au clavier : les groupes mis bout à bout. */
export function flattenResults(groups: readonly SearchGroup[]): SearchResult[] {
  return groups.flatMap((group) => group.results);
}

/** ↑ ↓ circulaires (motif `AddressField`) ; liste vide ⇒ aucun index. */
export function moveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}
