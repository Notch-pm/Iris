// Liste des demandes — tri, regroupement et export : LOGIQUE PURE (sans DOM ni
// réseau), miroir de l'ergonomie des listes de Clara (tri serveur par colonne,
// « Grouper par », export CSV de toute la sélection filtrée).
//
// Tri = SERVEUR (la liste est paginée : trier la page affichée serait faux) ;
// on n'autorise que des colonnes dont le tri PostgREST a un sens. La priorité
// n'est pas triable (ordre alphabétique basse/haute/normale/urgente = faux).
// Regroupement = client, sur la page courante, avec pré-tri serveur sur la clé
// de groupe pour que les groupes restent contigus d'une page à l'autre.

import { csvFilename, type CsvColumn } from "@/lib/csv";
import type { RequestFilters, RequestListItem } from "./useRequests";
import { PRIORITY_LABELS, STATUS_LABELS } from "./statuts";

// ---- Filtres ----------------------------------------------------------------
// Maquette « Liste — en-tête compacté » (2026-09-11) : les critères se posent
// dans un popover et se rappellent en CHIPS supprimables sous la barre. Chaque
// critère est une sélection multiple ; la recherche par objet en est un aussi.

export const EMPTY_FILTERS: RequestFilters = {
  q: "",
  status: [],
  destinataire: [],
  procedure: [],
  priority: [],
  source: [],
};

export const FILTER_KEYS = ["status", "destinataire", "procedure", "priority", "source"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_LABELS: Record<FilterKey, string> = {
  status: "Statut",
  destinataire: "Organisme",
  procedure: "Démarche",
  priority: "Priorité",
  source: "Source",
};

/** Bascule d'une valeur dans un critère (coché ↔ décoché). */
export function toggleFilterValue(filters: RequestFilters, key: FilterKey, value: string): RequestFilters {
  const values = filters[key];
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return { ...filters, [key]: next };
}

/** Nombre de critères posés, recherche comprise — pastille du bouton « Filtres ». */
export function activeFilterCount(filters: RequestFilters): number {
  return (filters.q.trim() === "" ? 0 : 1) + FILTER_KEYS.reduce((n, k) => n + filters[k].length, 0);
}

export interface FilterChip {
  key: FilterKey | "q";
  value: string;
  /** « Statut : À traiter », « Recherche : “élagage” »… */
  label: string;
}

/** Libellé d'une valeur de critère : traduit pour statut/priorité, résolu par catalogue sinon. */
export function filterValueLabel(
  key: FilterKey,
  value: string,
  resolve: (key: FilterKey, value: string) => string | undefined,
): string {
  if (key === "status") return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
  if (key === "priority") return PRIORITY_LABELS[value] ?? value;
  return resolve(key, value) ?? value;
}

/** Chips des critères actifs, dans l'ordre des critères puis des sélections. */
export function filterChips(
  filters: RequestFilters,
  resolve: (key: FilterKey, value: string) => string | undefined,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const q = filters.q.trim();
  if (q !== "") chips.push({ key: "q", value: q, label: `Recherche : « ${q} »` });
  for (const key of FILTER_KEYS) {
    for (const value of filters[key]) {
      chips.push({ key, value, label: `${FILTER_LABELS[key]} : ${filterValueLabel(key, value, resolve)}` });
    }
  }
  return chips;
}

/** Retrait d'une chip : la valeur quitte son critère, la recherche se vide. */
export function removeFilterChip(filters: RequestFilters, chip: FilterChip): RequestFilters {
  if (chip.key === "q") return { ...filters, q: "" };
  return { ...filters, [chip.key]: filters[chip.key].filter((v) => v !== chip.value) };
}

// ---- Recherche --------------------------------------------------------------

/** En deçà, on ne cherche pas : une lettre balaierait tout le tenant pour rien. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Clause PostgREST `or=(…)` de la recherche par objet ET référence, `ilike`
 * serveur. Les jokers LIKE sont neutralisés, la valeur est citée pour que
 * virgules et parenthèses ne cassent pas la grammaire de l'opérateur.
 * ⚠️ Sensible aux accents, contrairement à la recherche globale du header
 * (RPC `search_requests`) : PostgREST ne sait pas appliquer `unaccent` à la
 * valeur cherchée, et un jumeau JavaScript est exclu (voir la migration
 * `20260901130000`). Retourne `null` quand il n'y a rien à chercher.
 */
export function searchClause(raw: string): string | null {
  const q = raw.trim();
  if (q.length < SEARCH_MIN_LENGTH) return null;
  const like = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const quoted = `"%${like.replace(/"/g, '\\"')}%"`;
  return `subject.ilike.${quoted},reference.ilike.${quoted}`;
}

// ---- Pagination -------------------------------------------------------------

/**
 * Pages à afficher dans le pied : la première, la dernière, et une fenêtre
 * autour de la page courante ; `null` marque une ellipse. Jamais plus de
 * 7 entrées, pour que le pied garde sa hauteur.
 */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - 1; p <= page + 1; p++) if (p >= 1 && p <= pageCount) pages.add(p);
  if (page <= 3) for (let p = 2; p <= 5; p++) pages.add(p);
  if (page >= pageCount - 2) for (let p = pageCount - 4; p < pageCount; p++) pages.add(p);
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null);
    out.push(sorted[i]);
  }
  return out;
}

// ---- Tri --------------------------------------------------------------------

export const SORT_KEYS = [
  "reference", "subject", "status", "destinataire", "procedure", "source", "received_at",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface SortState { key: SortKey; dir: SortDir }

export const DEFAULT_SORT: SortState = { key: "received_at", dir: "desc" };

export interface OrderClause { column: string; ascending: boolean }

/** Colonnes PostgREST derrière chaque clé de tri (la référence se trie par année puis numéro). */
const SORT_COLUMNS: Record<SortKey, string[]> = {
  reference: ["reference_year", "reference_seq"],
  subject: ["subject"],
  status: ["status"],
  destinataire: ["socle_organization_label"],
  procedure: ["socle_procedure_label"],
  source: ["source"],
  received_at: ["received_at"],
};

/** Les dates se trient d'abord du plus récent au plus ancien (motif Clara `sortDescFirst`). */
export function sortDescFirst(key: SortKey): boolean {
  return key === "received_at";
}

/**
 * Clic sur un en-tête : nouvelle colonne → sens par défaut de la colonne ;
 * même colonne → inversion. Jamais de retour à « non trié » (en tri serveur il
 * n'existe pas d'ordre neutre, seulement un ordre implicite).
 */
export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: sortDescFirst(key) ? "desc" : "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

// ---- Regroupement -----------------------------------------------------------

export const GROUP_KEYS = ["status", "destinataire", "procedure", "priority", "source"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, string> = {
  status: "Statut",
  destinataire: "Organisme",
  procedure: "Démarche",
  priority: "Priorité",
  source: "Source",
};

const GROUP_COLUMNS: Record<GroupKey, string> = {
  status: "status",
  destinataire: "socle_organization_label",
  procedure: "socle_procedure_label",
  priority: "priority",
  source: "source",
};

export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

/**
 * Clauses ORDER BY à envoyer au serveur : la clé de groupe d'abord (groupes
 * contigus), puis le tri demandé, puis la date de création en départage stable.
 */
export function orderClauses(sort: SortState, groupKey: GroupKey | null): OrderClause[] {
  const clauses: OrderClause[] = [];
  if (groupKey) clauses.push({ column: GROUP_COLUMNS[groupKey], ascending: true });
  for (const column of SORT_COLUMNS[sort.key]) {
    clauses.push({ column, ascending: sort.dir === "asc" });
  }
  if (sort.key !== "received_at") clauses.push({ column: "created_at", ascending: false });
  return clauses;
}

/** Libellé d'un groupe pour une ligne (statut/priorité traduits, vides → « — »). */
export function groupLabelOf(item: RequestListItem, key: GroupKey): string {
  switch (key) {
    case "status":
      return STATUS_LABELS[item.status as keyof typeof STATUS_LABELS] ?? item.status;
    case "destinataire":
      return item.socle_organization_label ?? "Sans organisme";
    case "procedure":
      return item.socle_procedure_label ?? "Sans démarche";
    case "priority":
      return PRIORITY_LABELS[item.priority] ?? item.priority;
    case "source":
      return item.source;
  }
}

export interface RequestGroup { id: string; label: string; items: RequestListItem[] }

/** Regroupe dans l'ordre d'apparition (le serveur a déjà trié par clé de groupe). */
export function groupRows(items: RequestListItem[], key: GroupKey | null): RequestGroup[] {
  if (!key) return [{ id: "__all__", label: "", items }];
  const groups: RequestGroup[] = [];
  const byLabel = new Map<string, RequestGroup>();
  for (const item of items) {
    const label = groupLabelOf(item, key);
    let group = byLabel.get(label);
    if (!group) {
      group = { id: `${key}:${label}`, label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

// ---- Export CSV -------------------------------------------------------------

export const EXPORT_MAX_ROWS = 5000;

function frDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Colonnes de l'export : mêmes informations que la liste, libellés FR, dates lisibles. */
export function requestCsvColumns(nameOf: (userId: string | null) => string): CsvColumn<RequestListItem>[] {
  return [
    { header: "Référence", accessor: (r) => r.reference },
    { header: "Objet", accessor: (r) => r.subject },
    { header: "Statut", accessor: (r) => STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] ?? r.status },
    { header: "Priorité", accessor: (r) => PRIORITY_LABELS[r.priority] ?? r.priority },
    { header: "Organisme", accessor: (r) => r.socle_organization_label ?? "" },
    { header: "Démarche", accessor: (r) => r.socle_procedure_label ?? "" },
    { header: "Source", accessor: (r) => r.source },
    { header: "Assignée à", accessor: (r) => (r.assigned_to ? nameOf(r.assigned_to) : "") },
    { header: "Reçue le", accessor: (r) => frDate(r.received_at) },
    { header: "Échéance", accessor: (r) => frDate(r.due_at) },
    { header: "Créée le", accessor: (r) => frDate(r.created_at) },
    { header: "Identifiant", accessor: (r) => r.id },
  ];
}

/** `demandes-<tenant>-AAAA-MM-JJ.csv`, nom de tenant épuré. */
export function exportFilename(tenantName: string, now: Date): string {
  return csvFilename("demandes", tenantName, now);
}
