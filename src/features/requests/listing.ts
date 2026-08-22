// Liste des demandes — tri, regroupement et export : LOGIQUE PURE (sans DOM ni
// réseau), miroir de l'ergonomie des listes de Clara (tri serveur par colonne,
// « Grouper par », export CSV de toute la sélection filtrée).
//
// Tri = SERVEUR (la liste est paginée : trier la page affichée serait faux) ;
// on n'autorise que des colonnes dont le tri PostgREST a un sens. La priorité
// n'est pas triable (ordre alphabétique basse/haute/normale/urgente = faux).
// Regroupement = client, sur la page courante, avec pré-tri serveur sur la clé
// de groupe pour que les groupes restent contigus d'une page à l'autre.

import type { CsvColumn } from "@/lib/csv";
import type { RequestListItem } from "./useRequests";
import { PRIORITY_LABELS, STATUS_LABELS } from "./statuts";

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
  destinataire: "Destinataire",
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
      return item.socle_organization_label ?? "Sans destinataire";
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
    { header: "Destinataire", accessor: (r) => r.socle_organization_label ?? "" },
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
  const slug = tenantName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tenant";
  const day = now.toISOString().slice(0, 10);
  return `demandes-${slug}-${day}.csv`;
}
