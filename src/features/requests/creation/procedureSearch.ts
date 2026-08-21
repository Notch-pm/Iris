// Sélecteur de démarche (étape 1 du parcours de création) — logique pure.
// Source : le cache léger des démarches Socle du tenant (socle_procedure_cache).
// Aucune donnée de démarche n'est redéfinie ici : on filtre, on regroupe par
// catégorie Socle et on compte le volume observé dans les demandes du tenant.

export interface ProcedureCacheRow {
  socle_id: string;
  name: string;
  category_name: string | null;
  type: string | null;
}

export const ALL_CATEGORIES = "__toutes__";
export const NO_CATEGORY = "__sans_categorie__";

export interface CategoryChip {
  key: string;
  label: string;
}

/** Minuscules, sans accents ni espaces superflus — pour une recherche tolérante. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** « Toutes » + catégories Socle distinctes (ordre alphabétique FR) + « Sans catégorie » si besoin. */
export function procedureCategories(rows: ProcedureCacheRow[]): CategoryChip[] {
  const names = new Set<string>();
  let hasUncategorized = false;
  for (const row of rows) {
    const name = row.category_name?.trim() ?? "";
    if (name === "") hasUncategorized = true;
    else names.add(name);
  }
  const chips: CategoryChip[] = [{ key: ALL_CATEGORIES, label: "Toutes" }];
  for (const name of [...names].sort((a, b) => a.localeCompare(b, "fr"))) {
    chips.push({ key: name, label: name });
  }
  if (hasUncategorized) chips.push({ key: NO_CATEGORY, label: "Sans catégorie" });
  return chips;
}

export interface ProcedureFilter {
  query: string;
  category: string;
}

/** Filtre par catégorie puis par texte (nom, catégorie, type), tri par nom. */
export function filterProcedures(rows: ProcedureCacheRow[], filter: ProcedureFilter): ProcedureCacheRow[] {
  const q = normalizeSearch(filter.query);
  return rows
    .filter((row) => {
      if (filter.category === ALL_CATEGORIES) return true;
      const name = row.category_name?.trim() ?? "";
      if (filter.category === NO_CATEGORY) return name === "";
      return name === filter.category;
    })
    .filter((row) => {
      if (q === "") return true;
      const haystack = normalizeSearch(
        [row.name, row.category_name ?? "", row.type ?? ""].join(" "),
      );
      return haystack.includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Libellé d'un type de démarche Socle (valeur machine → lisible). */
export function procedureTypeLabel(type: string | null): string | null {
  if (!type) return null;
  const cleaned = type.replace(/[_-]+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Premier jour du mois courant (ISO, UTC) — borne du volume « ce mois ». */
export function startOfMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Nombre de demandes par démarche (les demandes sans démarche sont ignorées). */
export function countByProcedure(rows: { socle_procedure_id: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.socle_procedure_id) continue;
    counts[row.socle_procedure_id] = (counts[row.socle_procedure_id] ?? 0) + 1;
  }
  return counts;
}

export function volumeLabel(count: number | undefined): string | null {
  if (count === undefined) return null;
  if (count === 0) return "Aucune demande ce mois";
  return `${count} demande${count > 1 ? "s" : ""} ce mois`;
}
