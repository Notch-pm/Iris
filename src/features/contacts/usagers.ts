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
  /** Public — "" = tous. */
  type: string;
  /** Actifs / archivés / tous — SEUL filtre servi par le Socle (il change la requête). */
  status: UsagerStatusFilter;
  /** Identifiant de quartier, `NO_QUARTIER`, ou "" = tous. */
  quartier: string;
  /** Palier `TOTAL_BUCKETS`, ou "" = tous. */
  total: string;
  /** Palier `OPEN_BUCKETS`, ou "" = tous. */
  open: string;
}

export const EMPTY_FILTERS: UsagerFilters = {
  search: "", type: "", status: "active", quartier: "", total: "", open: "",
};

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
    if (filters.type !== "" && row.contact.contact_type !== filters.type) return false;
    if (filters.quartier === NO_QUARTIER) {
      if (row.contact.quartier !== null) return false;
    } else if (filters.quartier !== "" && row.contact.quartier?.id !== filters.quartier) {
      return false;
    }
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
  "name", "type", "email", "phone", "city", "quartier", "total", "open",
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
    { header: "Demandes visibles", accessor: (r) => r.total },
    { header: "Demandes en cours", accessor: (r) => r.open },
    { header: "Identifiant", accessor: (r) => r.contact.id },
  ];
}

/** `usagers-<tenant>-AAAA-MM-JJ.csv`. */
export function usagersExportFilename(tenantName: string, now: Date): string {
  return csvFilename("usagers", tenantName, now);
}
