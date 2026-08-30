// Tableau des demandes (kanban) — logique PURE (sans DOM ni réseau), testée :
// quelles colonnes, quelles cartes, quelles facettes, et surtout **quelles
// colonnes acceptent une carte donnée**.
//
// Une colonne = UN statut du workflow, jamais un regroupement : déposer une
// carte, c'est demander une transition précise, et une colonne « Clôturées »
// qui mélangerait résolution positive, négative et annulation ne saurait pas
// laquelle demander. Les 7 statuts sont donc les 7 colonnes.
//
// ⚠️ Rien ici ne protège quoi que ce soit : le RLS borne déjà les demandes
// lues, et `requests_guard_write` reste seul juge de la transition. Ce module
// reflète — via `allowedTransitionsFor` — ce que le serveur acceptera, pour ne
// pas proposer un dépôt qui sera refusé.

import { isAdminOn, rightsFor, type MyRights } from "@/features/rights/rights";
import {
  formatDayMonth, initials, priorityOption, requesterIdentity, type PriorityOption,
} from "../instruction/instruction";
import {
  allowedTransitionsFor, CLOSED_STATUSES, OPEN_STATUSES, STATUS_LABELS,
  type RequestRights, type RequestStatus, type TransitionSpec,
} from "../statuts";

// ---- Colonnes ---------------------------------------------------------------

export interface BoardColumn {
  status: RequestStatus;
  label: string;
  hint: string;
  /**
   * Colonne bornée à une fenêtre récente. Les statuts finaux s'accumulent sans
   * fin : les charger tous ferait une colonne illisible et une requête lourde,
   * pour un tableau dont l'objet est le travail en cours.
   */
  recent: boolean;
}

/** Fenêtre des colonnes finales, en jours (voir `closedSince`). */
export const CLOSED_WINDOW_DAYS = 30;

const HINTS: Record<RequestStatus, string> = {
  a_traiter: "Déposées, en attente de prise en charge",
  en_instruction: "Prises en charge par un agent",
  en_attente: "Pièce ou précision demandée à l'usager",
  resolue_positive: "Clôturées favorablement",
  resolue_negative: "Clôturées défavorablement",
  annulee: "Sans suite (abandon, retrait, irrecevabilité)",
  archivee: "Sorties du courant, conservées au dossier",
};

/** Les 7 statuts dans l'ordre du cycle de vie — l'œil va de gauche à droite. */
export const BOARD_COLUMNS: BoardColumn[] = [...OPEN_STATUSES, ...CLOSED_STATUSES].map((status) => ({
  status,
  label: STATUS_LABELS[status],
  hint: HINTS[status],
  recent: !OPEN_STATUSES.includes(status),
}));

/**
 * Début de journée d'il y a `days` jours, en ISO. Stable sur la journée — donc
 * utilisable tel quel en clé de requête, sans la faire changer à chaque rendu.
 */
export function closedSince(now: Date, days = CLOSED_WINDOW_DAYS): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).toISOString();
}

// ---- Lignes lues ------------------------------------------------------------

/** Plafonds de chargement — la troncature est SIGNALÉE, jamais silencieuse. */
export const BOARD_MAX_OPEN = 400;
export const BOARD_MAX_CLOSED = 200;

export interface BoardRow {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  socle_procedure_id: string | null;
  socle_procedure_label: string | null;
  socle_organization_id: string | null;
  socle_organization_label: string | null;
  /** Organisation PORTEUSE (résolue côté serveur) — la moitié « organisation » du couple de droits. */
  socle_scope_org_id: string;
  assigned_to: string | null;
  received_at: string;
  updated_at: string;
  identity_status: string;
  requester_snapshot: unknown;
}

// ---- Cartes -----------------------------------------------------------------

/** Valeurs de facette des demandes sans agent, sans démarche, sans organisme.
 *  ⚠️ Les CLÉS gardent « destinataire » : elles ne sont pas affichées, elles
 *  circulent (état, URL de la liste). Seuls les LIBELLÉS disent « Organisme ». */
export const NO_AGENT = "__non_affectee__";
export const NO_PROCEDURE = "__sans_demarche__";
export const NO_DESTINATAIRE = "__sans_destinataire__";

export interface BoardCardView {
  id: string;
  reference: string;
  subject: string;
  status: RequestStatus;
  priority: PriorityOption;
  procedureId: string;
  procedureLabel: string;
  /**
   * Afficher la pastille de démarche ? Beaucoup d'objets de demande reprennent
   * mot pour mot le libellé de la démarche : la répéter sous le titre n'ajoute
   * rien et mange une ligne de carte.
   */
  showProcedure: boolean;
  destinataireId: string;
  destinataireLabel: string;
  /** Assigné brut — l'assigné proposé par défaut dans le dialogue de transition. */
  assignedTo: string | null;
  agentId: string;
  agentLabel: string;
  agentInitials: string;
  usager: string;
  usagerInitials: string;
  /** « 21 août 2026 » — date de dépôt. */
  deposited: string;
  receivedAt: string;
  updatedAt: string;
  /** Couple (organisation porteuse, démarche) — clé de résolution des droits. */
  scopeOrgId: string;
  /** Champ de recherche pré-calculé, déjà replié (sans accents, minuscules). */
  search: string;
}

/** Repli d'un texte pour la recherche : sans accents, en minuscules. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Vue d'une demande sur le tableau. L'identité affichée est celle FIGÉE AU
 * DÉPÔT (`requester_snapshot`) : le tableau n'ouvre pas 400 fiches Socle pour
 * relire 400 usagers — la fiche de la demande, elle, montre l'identité du jour.
 */
export function boardCard(row: BoardRow, agentName: string | null): BoardCardView {
  const identity = requesterIdentity(row.requester_snapshot, row.identity_status);
  const procedureLabel = row.socle_procedure_label ?? "Sans démarche";
  const destinataireLabel = row.socle_organization_label ?? "Sans organisme";
  const agentLabel = row.assigned_to ? (agentName ?? "Utilisateur") : "Non affectée";
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    status: row.status as RequestStatus,
    priority: priorityOption(row.priority),
    procedureId: row.socle_procedure_id ?? NO_PROCEDURE,
    procedureLabel,
    showProcedure: procedureLabel.trim() !== row.subject.trim(),
    destinataireId: row.socle_organization_id ?? NO_DESTINATAIRE,
    destinataireLabel,
    assignedTo: row.assigned_to,
    agentId: row.assigned_to ?? NO_AGENT,
    agentLabel,
    agentInitials: row.assigned_to ? initials(agentLabel) : "?",
    usager: identity.name,
    usagerInitials: identity.initials,
    deposited: formatDayMonth(row.received_at, true),
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
    scopeOrgId: row.socle_scope_org_id,
    search: fold(
      [row.reference, row.subject, procedureLabel, destinataireLabel, identity.name, agentLabel].join(" "),
    ),
  };
}

export function boardCards(
  rows: BoardRow[],
  nameOf: (userId: string) => string,
): BoardCardView[] {
  return rows.map((row) => boardCard(row, row.assigned_to ? nameOf(row.assigned_to) : null));
}

// ---- Filtres et facettes ----------------------------------------------------

export interface BoardFilters {
  query: string;
  /** Agents retenus (`NO_AGENT` = non affectées) — vide = tous. */
  agents: string[];
  destinataires: string[];
  procedures: string[];
  priorities: string[];
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  query: "",
  agents: [],
  destinataires: [],
  procedures: [],
  priorities: [],
};

/** Nombre de critères posés, recherche comprise — pilote le bouton « Réinitialiser ». */
export function activeFilterCount(filters: BoardFilters): number {
  return (
    (filters.query.trim() === "" ? 0 : 1) +
    filters.agents.length +
    filters.destinataires.length +
    filters.procedures.length +
    filters.priorities.length
  );
}

/**
 * « Mes demandes » est le filtre agent posé sur le seul utilisateur courant :
 * pas un critère de plus. Le raccourci ne s'allume donc que si la sélection
 * d'agents est EXACTEMENT lui — dès qu'un autre agent est coché, ce n'est plus
 * « mes demandes », et le bouton doit le dire.
 */
export function isMineOnly(filters: BoardFilters, userId: string): boolean {
  return userId !== "" && filters.agents.length === 1 && filters.agents[0] === userId;
}

/** Bascule du raccourci : le filtre agent devient exactement moi, ou se vide. */
export function toggleMine(filters: BoardFilters, userId: string): BoardFilters {
  if (userId === "") return filters;
  return { ...filters, agents: isMineOnly(filters, userId) ? [] : [userId] };
}

/** Bascule d'une valeur dans une sélection multiple (menus à cases). */
export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function matchesFilters(card: BoardCardView, filters: BoardFilters): boolean {
  if (filters.agents.length > 0 && !filters.agents.includes(card.agentId)) return false;
  if (filters.destinataires.length > 0 && !filters.destinataires.includes(card.destinataireId)) return false;
  if (filters.procedures.length > 0 && !filters.procedures.includes(card.procedureId)) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(card.priority.key)) return false;
  const query = fold(filters.query.trim());
  return query === "" || card.search.includes(query);
}

export function filterCards(cards: BoardCardView[], filters: BoardFilters): BoardCardView[] {
  return cards.filter((card) => matchesFilters(card, filters));
}

export interface CountedOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Facettes d'une clé (agent, destinataire, démarche), avec leur volume. Les
 * volumes portent sur TOUTES les cartes chargées, jamais sur la sélection
 * filtrée : un compteur qui tombe à zéro dès qu'on coche une case ne dit plus
 * rien de ce qu'on décocherait.
 */
export function facetsOf(
  cards: BoardCardView[],
  key: (card: BoardCardView) => { value: string; label: string },
): CountedOption[] {
  const counts = new Map<string, CountedOption>();
  for (const card of cards) {
    const { value, label } = key(card);
    const existing = counts.get(value);
    if (existing) existing.count++;
    else counts.set(value, { value, label, count: 1 });
  }
  // « Non affectée » / « Sans démarche » en tête : c'est la file qui appelle le geste.
  const isSentinel = (value: string) =>
    value === NO_AGENT || value === NO_PROCEDURE || value === NO_DESTINATAIRE;
  return [...counts.values()].sort((a, b) => {
    if (isSentinel(a.value) !== isSentinel(b.value)) return isSentinel(a.value) ? -1 : 1;
    return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
  });
}

export const AGENT_FACET = (c: BoardCardView) => ({ value: c.agentId, label: c.agentLabel });
export const DESTINATAIRE_FACET = (c: BoardCardView) => ({ value: c.destinataireId, label: c.destinataireLabel });
export const PROCEDURE_FACET = (c: BoardCardView) => ({ value: c.procedureId, label: c.procedureLabel });
export const PRIORITY_FACET = (c: BoardCardView) => ({ value: c.priority.key, label: c.priority.label });

// ---- Répartition en colonnes ------------------------------------------------

export type BoardSort = "recent" | "ancien";

export const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  recent: "Plus récentes d'abord",
  ancien: "Plus anciennes d'abord",
};

/**
 * Cartes de chaque colonne, triées par date de dépôt. Une carte dont le statut
 * ne fait pas partie des 7 colonnes (statut inconnu, base en avance sur l'app)
 * n'est pas perdue : `orphans` la signale au lieu de la faire disparaître.
 */
export interface BoardContent {
  columns: { column: BoardColumn; cards: BoardCardView[] }[];
  orphans: BoardCardView[];
}

export function boardContent(cards: BoardCardView[], sort: BoardSort): BoardContent {
  const byStatus = new Map<string, BoardCardView[]>();
  const orphans: BoardCardView[] = [];
  const known = new Set<string>(BOARD_COLUMNS.map((c) => c.status));
  for (const card of cards) {
    if (!known.has(card.status)) {
      orphans.push(card);
      continue;
    }
    const bucket = byStatus.get(card.status);
    if (bucket) bucket.push(card);
    else byStatus.set(card.status, [card]);
  }
  const direction = sort === "recent" ? -1 : 1;
  for (const bucket of byStatus.values()) {
    bucket.sort((a, b) => direction * a.receivedAt.localeCompare(b.receivedAt));
  }
  return {
    columns: BOARD_COLUMNS.map((column) => ({ column, cards: byStatus.get(column.status) ?? [] })),
    orphans,
  };
}

// ---- Droits et cibles de dépôt ----------------------------------------------

/**
 * Droits effectifs sur le couple (organisation porteuse, démarche) d'une carte,
 * mémoïsés par couple : un tableau porte des centaines de cartes pour une
 * poignée de couples distincts, et `rightsFor` parcourt tous les profils.
 */
export function boardRightsResolver(my: MyRights): (card: BoardCardView) => RequestRights {
  const cache = new Map<string, RequestRights>();
  return (card) => {
    const key = `${card.scopeOrgId}|${card.procedureId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const procedureId = card.procedureId === NO_PROCEDURE ? null : card.procedureId;
    const rr: RequestRights = {
      rights: rightsFor(my, card.scopeOrgId, procedureId),
      isAdmin: isAdminOn(my, card.scopeOrgId),
    };
    cache.set(key, rr);
    return rr;
  };
}

/**
 * Colonnes où cette carte peut être déposée : les transitions que
 * `requests_guard_write` acceptera, indexées par statut d'arrivée. Vide = la
 * carte ne bouge pas (droits insuffisants, ou statut sans suite).
 */
export function dropTargets(card: BoardCardView, rr: RequestRights): Map<RequestStatus, TransitionSpec> {
  return new Map(allowedTransitionsFor(card.status, rr).map((spec) => [spec.to, spec]));
}

/** Message affiché sur une colonne qui refuse la carte en cours de déplacement. */
export function refusalHint(card: BoardCardView, to: RequestStatus): string {
  if (card.status === to) return "La demande est déjà dans cette colonne.";
  return `« ${STATUS_LABELS[card.status]} » → « ${STATUS_LABELS[to]} » n'est pas une transition ouverte ici.`;
}

/** « DEM-2026-000005 → En cours d'instruction ». */
export function transitionToast(card: BoardCardView, to: RequestStatus): string {
  return `${card.reference} → ${STATUS_LABELS[to]}`;
}
