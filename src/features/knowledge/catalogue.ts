// Catalogue de la BASE DE CONNAISSANCES — logique pure (ni React ni réseau).
//
// Source : les démarches PUBLIÉES du cache du tenant (`useSocleProcedureRows` :
// en production, externes, dans leur période de publication — la même liste
// que le guichet propose, parce que « publiée » doit vouloir dire la même
// chose partout dans Iris). Une démarche en brouillon, interne, ou hors de sa
// période n'apparaît donc pas, ici comme ailleurs.
//
// Ce que ce module ajoute à chaque démarche :
//  - les ORGANISMES qui la proposent (miroir `socle_procedure_organizations`,
//    opt-in strict : absente du miroir = proposée par personne) ;
//  - « ouverte temporairement » : la démarche a une période de publication
//    — elle est dedans (sinon elle ne serait pas là), et elle en sortira ;
//  - « non visible sur le portail ».
// Puis il filtre (recherche) et regroupe par CATÉGORIE de démarche.

import type { ActivationPair } from "@/features/requests/creation/proposables";
import { normalizeSearch } from "@/features/requests/creation/procedureSearch";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import { portalAbsenceLabel, publicationPeriodLabel } from "@fn/_shared/procedures/publication";

export const UNCATEGORIZED = "Sans catégorie";

export interface KnowledgeProcedure {
  id: string;
  name: string;
  /** Catégorie Socle, `null` si la démarche n'en a pas. */
  category: string | null;
  type: string | null;
  portalVisible: boolean;
  /** « Non visible portail », `null` quand elle y est (le cas ordinaire). */
  portalAbsence: string | null;
  /** Période de publication libellée — `null` = ouverte sans échéance. */
  temporaryPeriod: string | null;
  /** Organismes qui proposent la démarche, triés. */
  organismes: string[];
}

export interface KnowledgeGroup {
  label: string;
  procedures: KnowledgeProcedure[];
}

const byFrench = (a: string, b: string) => a.localeCompare(b, "fr");

export function buildCatalogue(
  rows: readonly SocleProcedureRow[],
  activations: readonly ActivationPair[],
  organisations: readonly { value: string; label: string }[],
): KnowledgeProcedure[] {
  const nameById = new Map(organisations.map((o) => [o.value, o.label]));
  const organismesByProcedure = new Map<string, Set<string>>();
  for (const pair of activations) {
    const name = nameById.get(pair.socle_org_id);
    // Organisme absent du miroir d'organisations (obsolète) : on ne l'invente pas.
    if (!name) continue;
    const set = organismesByProcedure.get(pair.socle_procedure_id) ?? new Set<string>();
    set.add(name);
    organismesByProcedure.set(pair.socle_procedure_id, set);
  }

  return rows.map((row) => ({
    id: row.socle_id,
    name: row.name,
    category: row.category_name?.trim() ? row.category_name.trim() : null,
    type: row.type,
    portalVisible: row.publication.portalVisible,
    portalAbsence: portalAbsenceLabel(row.publication),
    temporaryPeriod: publicationPeriodLabel(row.publication),
    organismes: [...(organismesByProcedure.get(row.socle_id) ?? [])].sort(byFrench),
  }));
}

/**
 * Recherche tolérante (accents, casse) sur le nom, la catégorie et les
 * organismes. Plusieurs mots : TOUS doivent se trouver quelque part —
 * « carte déchetterie » trouve la démarche sans exiger l'ordre des mots.
 */
export function filterCatalogue(items: readonly KnowledgeProcedure[], query: string): KnowledgeProcedure[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = normalizeSearch([item.name, item.category ?? "", ...item.organismes].join(" "));
    return words.every((w) => haystack.includes(w));
  });
}

/** Regroupe par catégorie (ordre alphabétique, « Sans catégorie » en dernier), démarches triées par nom. */
export function groupByCategory(items: readonly KnowledgeProcedure[]): KnowledgeGroup[] {
  const groups = new Map<string, KnowledgeProcedure[]>();
  for (const item of items) {
    const label = item.category ?? UNCATEGORIZED;
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : byFrench(a, b)))
    .map(([label, procedures]) => ({
      label,
      procedures: [...procedures].sort((a, b) => byFrench(a.name, b.name)),
    }));
}

/** « Voirie, CCAS et 2 autres » — la carte n'a pas la place d'une liste longue. */
export function organismesLabel(organismes: readonly string[], max = 3): string | null {
  if (organismes.length === 0) return null;
  if (organismes.length <= max) return organismes.join(", ");
  const rest = organismes.length - max;
  return `${organismes.slice(0, max).join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}`;
}
