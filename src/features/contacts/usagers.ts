// Liste des usagers — recherche, filtres, tri et export : LOGIQUE PURE (sans
// DOM ni réseau), au motif des listes de Clara et de la liste des demandes
// (`features/requests/listing.ts`).
//
// Différence essentielle avec la liste des demandes : ici le tri et les filtres
// sont CLIENT. La liste vient de deux sources qu'aucun serveur ne peut joindre
// — le référentiel d'usagers du Socle (aucun miroir dans Iris, invariant) et
// les compteurs de demandes d'Iris (RPC `contact_request_counts`, bornée par le
// RLS). Aucune base ne peut donc trier « les usagers par nombre de demandes » :
// le rapprochement se fait dans le navigateur, sur l'ensemble rapatrié.

import { csvFilename, type CsvColumn } from "@/lib/csv";
import { consentStatement } from "@fn/_shared/consents/catalog";
import type { SocleContact } from "./rapprochement";
import { contactName, contactStatusLabel, contactTypeLabel } from "./usager";

/** Une ligne = une fiche du Socle + les compteurs Iris du périmètre du lecteur. */
export interface UsagerRow {
  contact: SocleContact;
  /** Demandes de cet usager VISIBLES par le lecteur (RLS) — jamais un total absolu. */
  total: number;
  /** Parmi elles, celles encore ouvertes (statut non final). */
  open: number;
}

/** Assemble les fiches Socle et les compteurs Iris (usager sans demande = 0/0). */
export function buildRows(
  contacts: readonly SocleContact[],
  counts: ReadonlyMap<string, { total: number; open: number }>,
): UsagerRow[] {
  return contacts.map((contact) => {
    const c = counts.get(contact.id);
    return { contact, total: c?.total ?? 0, open: c?.open ?? 0 };
  });
}

/** Téléphone affiché : mobile d'abord, fixe à défaut. */
export function contactPhone(contact: SocleContact): string {
  return contact.mobile_phone?.trim() || contact.landline_phone?.trim() || "";
}

// ---- Consentement au partage -------------------------------------------------

/**
 * Consentement « partage » d'une fiche (partage aux services de l'organisme
 * principal, question posée à chaque dépôt depuis le 2026-09-20).
 *
 * ⚠️ TROIS états, pas deux — même doctrine que la fiche usager (`consentViews`) :
 * une fiche jamais passée par un dépôt porte `consent_partage: false` sans que
 * personne ne lui ait rien demandé. C'est la DATE qui tranche : sans date,
 * « jamais demandé », jamais « refusé ».
 */
export type PartageState = "accepte" | "refuse" | "jamais_demande";

export function partageState(contact: SocleContact): PartageState {
  if (!contact.consent_partage_at) return "jamais_demande";
  return contact.consent_partage === true ? "accepte" : "refuse";
}

export const PARTAGE_LABELS: Record<PartageState, string> = {
  accepte: "Accepté",
  refuse: "Refusé",
  jamais_demande: "Jamais demandé",
};

/** Ordre de lecture (tri, regroupement) : opt-in, opt-out, puis les fiches jamais interrogées. */
const PARTAGE_ORDER: readonly PartageState[] = ["accepte", "refuse", "jamais_demande"];

export const PARTAGE_OPTIONS: { value: PartageState; label: string }[] = [
  { value: "accepte", label: "Accepté (opt-in)" },
  { value: "refuse", label: "Refusé (opt-out)" },
  { value: "jamais_demande", label: "Jamais demandé" },
];

/** La phrase posée à l'usager, pour que l'agent sache ce que le filtre désigne. */
export function partageStatement(organismName?: string | null): string {
  return consentStatement("partage", organismName);
}

// ---- Recherche par mot-clé --------------------------------------------------

/** Minuscules sans accents — la recherche ne dépend jamais de la saisie des diacritiques. */
export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const NUMERIC_TOKEN = /^[\d\s.\-+()]+$/;

/** Texte cherché d'une ligne : identité, coordonnées, adresse, quartier, SIRET. */
function haystack(row: UsagerRow): { text: string; digits: string } {
  const c = row.contact;
  const parts = [
    contactName(c), c.first_name, c.last_name, c.usage_name, c.legal_name,
    c.email, c.mobile_phone, c.landline_phone,
    c.address_line1, c.address_line2, c.postal_code, c.city,
    c.siret, c.quartier?.name,
  ].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const text = normalize(parts.join(" "));
  return { text, digits: text.replace(/\D/g, "") };
}

/** Un mot doit porter au moins 4 chiffres pour valoir recherche « par chiffres ». */
const MIN_DIGITS_IN_TOKEN = 4;

/**
 * Deux régimes, parce qu'un numéro de téléphone se saisit avec des espaces :
 *
 * - **requête entièrement numérique** (« 06 01 25 91 », « 13 200 ») : elle est
 *   recollée en UN seul nombre et cherchée dans les seuls chiffres de la fiche.
 *   La découper en mots donnerait « 06 » ET « 01 » ET « 25 », qui se retrouvent
 *   dans presque toutes les fiches — vérifié en navigateur le 2026-08-23 : 29
 *   résultats au lieu d'un ;
 * - **sinon**, tous les mots doivent se retrouver dans la ligne (ET), dans
 *   n'importe quel ordre ; un mot d'au moins 4 chiffres est aussi cherché sur
 *   les chiffres de la fiche (« Dupont 0601259121 »).
 */
export function matchesSearch(row: UsagerRow, query: string): boolean {
  const cleaned = normalize(query).trim();
  if (cleaned === "") return true;
  const hay = haystack(row);

  if (NUMERIC_TOKEN.test(cleaned)) {
    const digits = cleaned.replace(/\D/g, "");
    return digits.length >= 2 ? hay.digits.includes(digits) : true;
  }

  return cleaned.split(/\s+/).every((token) => {
    if (hay.text.includes(token)) return true;
    const digits = token.replace(/\D/g, "");
    return digits.length >= MIN_DIGITS_IN_TOKEN && hay.digits.includes(digits);
  });
}

// ---- Filtres ----------------------------------------------------------------

/** Publics du contrat contacts-api (le Socle reste l'autorité sur la valeur). */
export const TYPE_OPTIONS = [
  { value: "personne", label: "Citoyen" },
  { value: "entreprise", label: "Entreprise" },
  { value: "association", label: "Association" },
  { value: "administration", label: "Administration" },
] as const;

export type UsagerStatusFilter = "active" | "archived" | "all";

export const STATUS_OPTIONS: { value: UsagerStatusFilter; label: string }[] = [
  { value: "active", label: "Actifs" },
  { value: "archived", label: "Archivés" },
  { value: "all", label: "Actifs et archivés" },
];

/** Valeur du filtre « quartier » désignant les fiches sans quartier résolu. */
export const NO_QUARTIER = "__aucun__";

/** Paliers de volumétrie — un filtre « au moins N », le tri de colonne faisant le reste. */
export interface CountBucket {
  value: string;
  label: string;
  test: (count: number) => boolean;
}

export const TOTAL_BUCKETS: CountBucket[] = [
  { value: "0", label: "Aucune demande", test: (n) => n === 0 },
  { value: "1", label: "Au moins 1 demande", test: (n) => n >= 1 },
  { value: "2", label: "2 demandes et plus", test: (n) => n >= 2 },
  { value: "5", label: "5 demandes et plus", test: (n) => n >= 5 },
  { value: "10", label: "10 demandes et plus", test: (n) => n >= 10 },
];

export const OPEN_BUCKETS: CountBucket[] = [
  { value: "0", label: "Aucune demande en cours", test: (n) => n === 0 },
  { value: "1", label: "Au moins 1 demande en cours", test: (n) => n >= 1 },
  { value: "2", label: "2 en cours et plus", test: (n) => n >= 2 },
  { value: "5", label: "5 en cours et plus", test: (n) => n >= 5 },
];

export interface UsagerFilters {
  /** Recherche par mot-clé (client). */
  search: string;
  /** Publics retenus — vide = tous. */
  type: string[];
  /** Actifs / archivés / tous — SEUL filtre servi par le Socle (il change la requête). */
  status: UsagerStatusFilter;
  /** Identifiants de quartier (ou `NO_QUARTIER`) — vide = tous. */
  quartier: string[];
  /** États du consentement au partage (`PartageState`) — vide = tous. */
  partage: string[];
  /** Palier `TOTAL_BUCKETS`, ou "" = tous. */
  total: string;
  /** Palier `OPEN_BUCKETS`, ou "" = tous. */
  open: string;
}

export const EMPTY_FILTERS: UsagerFilters = {
  search: "", type: [], status: "active", quartier: [], partage: [], total: "", open: "",
};

/** Critères à plusieurs valeurs (cases à cocher). */
export type MultiFilterKey = "type" | "quartier" | "partage";
/** Critères exclusifs (une valeur au plus ; re-choisir la valeur la retire). */
export type SingleFilterKey = "total" | "open";

export function toggleMultiFilter(filters: UsagerFilters, key: MultiFilterKey, value: string): UsagerFilters {
  const current = filters[key];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...filters, [key]: next };
}

export function toggleSingleFilter(filters: UsagerFilters, key: SingleFilterKey, value: string): UsagerFilters {
  return { ...filters, [key]: filters[key] === value ? "" : value };
}

/** Nombre de critères actifs (pastille du bouton « Filtres ») — le statut par défaut ne compte pas. */
export function activeFilterCount(filters: UsagerFilters): number {
  return (
    filters.type.length + filters.quartier.length + filters.partage.length +
    (filters.total !== "" ? 1 : 0) + (filters.open !== "" ? 1 : 0) +
    (filters.status !== EMPTY_FILTERS.status ? 1 : 0) +
    (filters.search.trim() !== "" ? 1 : 0)
  );
}

export type ChipKey = MultiFilterKey | SingleFilterKey | "status" | "search";
export interface UsagerFilterChip { key: ChipKey; value: string; label: string }

/** Pastilles « Filtres actifs », dans l'ordre du popover. */
export function filterChips(
  filters: UsagerFilters,
  quartierLabel: (id: string) => string | undefined,
): UsagerFilterChip[] {
  const chips: UsagerFilterChip[] = [];
  const search = filters.search.trim();
  if (search !== "") chips.push({ key: "search", value: search, label: `« ${search} »` });
  if (filters.status !== EMPTY_FILTERS.status) {
    const label = STATUS_OPTIONS.find((o) => o.value === filters.status)?.label ?? filters.status;
    chips.push({ key: "status", value: filters.status, label: `Fiches : ${label.toLowerCase()}` });
  }
  for (const v of filters.type) {
    chips.push({ key: "type", value: v, label: TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v });
  }
  for (const v of filters.partage) {
    const label = PARTAGE_LABELS[v as PartageState] ?? v;
    chips.push({ key: "partage", value: v, label: `Partage : ${label.toLowerCase()}` });
  }
  for (const v of filters.quartier) {
    chips.push({ key: "quartier", value: v, label: v === NO_QUARTIER ? "Sans quartier" : quartierLabel(v) ?? "Quartier" });
  }
  if (filters.total !== "") {
    chips.push({ key: "total", value: filters.total, label: TOTAL_BUCKETS.find((b) => b.value === filters.total)?.label ?? filters.total });
  }
  if (filters.open !== "") {
    chips.push({ key: "open", value: filters.open, label: OPEN_BUCKETS.find((b) => b.value === filters.open)?.label ?? filters.open });
  }
  return chips;
}

export function removeFilterChip(filters: UsagerFilters, chip: UsagerFilterChip): UsagerFilters {
  switch (chip.key) {
    case "search": return { ...filters, search: "" };
    case "status": return { ...filters, status: EMPTY_FILTERS.status };
    case "total": case "open": return { ...filters, [chip.key]: "" };
    default: return toggleMultiFilter(filters, chip.key, chip.value);
  }
}

function bucketTest(buckets: CountBucket[], value: string): ((n: number) => boolean) | null {
  if (value === "") return null;
  return buckets.find((b) => b.value === value)?.test ?? null;
}

/**
 * Applique les filtres CLIENT. `status` n'en fait pas partie : il est servi par
 * le Socle (`socle-proxy /v1/contacts/list`), les fiches archivées n'étant pas
 * rapatriées tant qu'on ne les demande pas.
 */
export function filterUsagers(rows: readonly UsagerRow[], filters: UsagerFilters): UsagerRow[] {
  const totalTest = bucketTest(TOTAL_BUCKETS, filters.total);
  const openTest = bucketTest(OPEN_BUCKETS, filters.open);
  return rows.filter((row) => {
    if (filters.type.length > 0 && !filters.type.includes(row.contact.contact_type ?? "")) return false;
    if (filters.quartier.length > 0 && !filters.quartier.includes(row.contact.quartier?.id ?? NO_QUARTIER)) {
      return false;
    }
    if (filters.partage.length > 0 && !filters.partage.includes(partageState(row.contact))) return false;
    if (totalTest && !totalTest(row.total)) return false;
    if (openTest && !openTest(row.open)) return false;
    return matchesSearch(row, filters.search);
  });
}

export interface QuartierOption { value: string; label: string }

/**
 * Quartiers observés dans les fiches rapatriées (le référentiel des quartiers
 * vit dans le Socle et n'est pas mis en cache par Iris), plus « Sans quartier »
 * si au moins une fiche n'en a pas.
 */
export function quartierOptions(rows: readonly UsagerRow[]): QuartierOption[] {
  const byId = new Map<string, string>();
  let hasNone = false;
  for (const row of rows) {
    const q = row.contact.quartier;
    if (!q) { hasNone = true; continue; }
    byId.set(q.id, q.name?.trim() || "Quartier sans nom");
  }
  const options = [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  if (hasNone) options.push({ value: NO_QUARTIER, label: "Sans quartier" });
  return options;
}

// ---- Tri --------------------------------------------------------------------

export const SORT_KEYS = [
  "name", "type", "email", "phone", "city", "quartier", "partage", "total", "open",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface SortState { key: SortKey; dir: SortDir }

export const DEFAULT_SORT: SortState = { key: "name", dir: "asc" };

/** Les volumétries se lisent d'abord du plus grand au plus petit. */
export function sortDescFirst(key: SortKey): boolean {
  return key === "total" || key === "open";
}

export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: sortDescFirst(key) ? "desc" : "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

function textValue(row: UsagerRow, key: SortKey): string {
  const c = row.contact;
  switch (key) {
    case "name": return contactName(c);
    case "type": return contactTypeLabel(c.contact_type);
    case "email": return c.email?.trim() ?? "";
    case "phone": return contactPhone(c);
    case "city": return c.city?.trim() ?? "";
    case "quartier": return c.quartier?.name?.trim() ?? "";
    default: return "";
  }
}

/**
 * Tri stable, cases vides TOUJOURS en fin de liste (dans les deux sens : une
 * colonne triée ne doit jamais commencer par une colonne de tirets), départage
 * par nom puis par identifiant.
 */
export function sortUsagers(rows: readonly UsagerRow[], sort: SortState): UsagerRow[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  const numeric = sort.key === "total" || sort.key === "open";
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (numeric) {
      const va = sort.key === "total" ? a.total : a.open;
      const vb = sort.key === "total" ? b.total : b.open;
      cmp = (va - vb) * factor;
    } else if (sort.key === "partage") {
      cmp = (PARTAGE_ORDER.indexOf(partageState(a.contact)) - PARTAGE_ORDER.indexOf(partageState(b.contact))) * factor;
    } else {
      const va = textValue(a, sort.key);
      const vb = textValue(b, sort.key);
      if (va === "" && vb !== "") return 1;
      if (vb === "" && va !== "") return -1;
      cmp = va.localeCompare(vb, "fr", { sensitivity: "base" }) * factor;
    }
    if (cmp !== 0) return cmp;
    const byName = contactName(a.contact)
      .localeCompare(contactName(b.contact), "fr", { sensitivity: "base" });
    return byName !== 0 ? byName : a.contact.id.localeCompare(b.contact.id);
  });
}

// ---- Regroupement -------------------------------------------------------------

export const GROUP_KEYS = ["type", "quartier", "city", "partage"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, string> = {
  type: "Type",
  quartier: "Quartier",
  city: "Commune",
  partage: "Partage d'informations",
};

export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

interface GroupRef { id: string; label: string; rank: string }

/** Rang placé APRÈS toute valeur : les groupes « non renseigné » ferment la liste. */
const LAST = "￿";

function groupOf(row: UsagerRow, key: GroupKey): GroupRef {
  const c = row.contact;
  switch (key) {
    case "type": {
      const i = TYPE_OPTIONS.findIndex((o) => o.value === c.contact_type);
      return { id: c.contact_type ?? "", label: contactTypeLabel(c.contact_type), rank: i < 0 ? LAST : String(i) };
    }
    case "quartier": {
      if (!c.quartier) return { id: NO_QUARTIER, label: "Sans quartier", rank: LAST };
      const name = c.quartier.name?.trim() || "Quartier sans nom";
      return { id: c.quartier.id, label: name, rank: normalize(name) };
    }
    case "city": {
      const city = c.city?.trim() ?? "";
      if (city === "") return { id: "", label: "Commune non renseignée", rank: LAST };
      return { id: normalize(city), label: city, rank: normalize(city) };
    }
    case "partage": {
      const state = partageState(c);
      return { id: state, label: `Partage ${PARTAGE_LABELS[state].toLowerCase()}`, rank: String(PARTAGE_ORDER.indexOf(state)) };
    }
  }
}

/**
 * Regroupe TOUTE la sélection (le tri est client, à la différence des demandes,
 * qui ne regroupent que la page affichée) : groupes dans leur ordre naturel,
 * « non renseigné » en dernier, et à l'intérieur l'ordre du tri choisi. La
 * pagination vient APRÈS — un groupe reste d'un seul tenant d'une page à l'autre.
 */
export function orderByGroup(rows: readonly UsagerRow[], key: GroupKey | null): UsagerRow[] {
  if (!key) return [...rows];
  const ranked = rows.map((row, index) => ({ row, index, rank: groupOf(row, key).rank }));
  ranked.sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank < b.rank ? -1 : 1));
  return ranked.map((r) => r.row);
}

export interface UsagerGroup {
  id: string;
  label: string;
  /** Lignes du groupe sur la page affichée. */
  items: UsagerRow[];
  /** Taille du groupe dans TOUTE la sélection filtrée. */
  total: number;
}

/** Groupes de la page affichée, avec leur taille dans toute la sélection. */
export function groupUsagers(
  page: readonly UsagerRow[],
  selection: readonly UsagerRow[],
  key: GroupKey | null,
): UsagerGroup[] {
  if (!key) return [{ id: "__all__", label: "", items: [...page], total: selection.length }];
  const totals = new Map<string, number>();
  for (const row of selection) {
    const id = groupOf(row, key).id;
    totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  const groups: UsagerGroup[] = [];
  const byId = new Map<string, UsagerGroup>();
  for (const row of page) {
    const ref = groupOf(row, key);
    let group = byId.get(ref.id);
    if (!group) {
      group = { id: `${key}:${ref.id}`, label: ref.label, items: [], total: totals.get(ref.id) ?? 0 };
      byId.set(ref.id, group);
      groups.push(group);
    }
    group.items.push(row);
  }
  return groups;
}

// ---- Pagination -------------------------------------------------------------

export const PAGE_SIZE = 50;

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** Page 1-indexée, ramenée dans les bornes (un filtre peut vider la page courante). */
export function paginate<T>(rows: readonly T[], page: number): T[] {
  const safe = Math.min(Math.max(1, page), pageCount(rows.length));
  const start = (safe - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

// ---- Export CSV -------------------------------------------------------------

/**
 * Colonnes de l'export : les informations de la liste, plus l'adresse complète
 * et l'identifiant Socle. Les compteurs y sont dits « visibles » — l'export ne
 * franchit pas le périmètre du lecteur.
 */
export function usagerCsvColumns(): CsvColumn<UsagerRow>[] {
  return [
    { header: "Type", accessor: (r) => contactTypeLabel(r.contact.contact_type) },
    { header: "Nom", accessor: (r) => contactName(r.contact) },
    { header: "Courriel", accessor: (r) => r.contact.email ?? "" },
    { header: "Téléphone mobile", accessor: (r) => r.contact.mobile_phone ?? "" },
    { header: "Téléphone fixe", accessor: (r) => r.contact.landline_phone ?? "" },
    { header: "Adresse", accessor: (r) => r.contact.address_line1 ?? "" },
    { header: "Complément", accessor: (r) => r.contact.address_line2 ?? "" },
    { header: "Code postal", accessor: (r) => r.contact.postal_code ?? "" },
    { header: "Commune", accessor: (r) => r.contact.city ?? "" },
    { header: "Quartier", accessor: (r) => r.contact.quartier?.name ?? "" },
    { header: "SIRET", accessor: (r) => r.contact.siret ?? "" },
    { header: "Statut", accessor: (r) => contactStatusLabel(r.contact.status) ?? "" },
    { header: "Partage d'informations", accessor: (r) => PARTAGE_LABELS[partageState(r.contact)] },
    { header: "Partage — date du recueil", accessor: (r) => r.contact.consent_partage_at ?? "" },
    { header: "Demandes visibles", accessor: (r) => r.total },
    { header: "Demandes en cours", accessor: (r) => r.open },
    { header: "Identifiant", accessor: (r) => r.contact.id },
  ];
}

/** `usagers-<tenant>-AAAA-MM-JJ.csv`. */
export function usagersExportFilename(tenantName: string, now: Date): string {
  return csvFilename("usagers", tenantName, now);
}
