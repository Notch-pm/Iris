// Étape 0 du parcours de création — « pour quel organisme ? ».
//
// Décision PO du 2026-08-31 (backlog B4) : quand un agent détient le droit de
// création sur PLUSIEURS organisations, il le DIT avant tout le reste, plutôt
// que de se voir imposer en silence l'organisation porteuse de la démarche.
// Ce silence n'était pas théorique : dans une communauté d'agglomération dont
// toutes les démarches pendent de la racine, il faisait atterrir sur la racine
// des demandes qui étaient celles d'une commune.
//
// Module PUR : il ne décide d'aucun droit — l'ensemble des organisations
// admissibles lui est DONNÉ (`rights.ts`, miroir de `permission_pairs_of`), et
// la vérité reste le serveur (`user_has_request_right`, appelé par
// `create-request-from-procedure`). Il ne fait que mettre en forme un choix.

import type { SocleOrganizationOption } from "@/features/socle/useSocleCatalog";

export interface OrganizationChoice {
  value: string;
  label: string;
  /**
   * Chaîne des organisations parentes, de la plus lointaine à la plus proche
   * (« ACCM › Mairie de Saint Martin de Crau »), ou `null` à la racine. Elle
   * situe un service sans lequel « Direction du Cabinet » ne dirait pas de
   * quelle commune il s'agit.
   */
  context: string | null;
}

/** Profondeur de garde : le miroir vient du Socle, un cycle ne doit pas boucler ici. */
const MAX_DEPTH = 16;

/**
 * Ancêtres de `id` dans le catalogue, du plus lointain au plus proche. Les
 * ancêtres ABSENTS du catalogue (obsolètes, hors miroir) interrompent la
 * remontée : on ne nomme que ce qu'on connaît.
 */
function ancestorsOf(byId: Map<string, SocleOrganizationOption>, id: string): SocleOrganizationOption[] {
  const chain: SocleOrganizationOption[] = [];
  const seen = new Set<string>([id]);
  let parentId = byId.get(id)?.parentValue ?? null;
  while (parentId && !seen.has(parentId) && chain.length < MAX_DEPTH) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentValue;
  }
  return chain;
}

function compareFr(a: string, b: string): number {
  return a.localeCompare(b, "fr", { sensitivity: "base" });
}

/**
 * Organisations à proposer : celles de `allowedIds` présentes au catalogue,
 * situées par leurs parents et triées PAR CHEMIN — chaque organisation suit
 * ainsi celle dont elle dépend, au lieu de s'éparpiller dans un alphabet où
 * « Direction du Cabinet » précéderait « Mairie de Saint Martin de Crau ».
 *
 * Le contexte se lit dans le catalogue ENTIER : un parent peut nommer un lieu
 * sans être lui-même un organisme pour lequel l'agent a le droit de créer.
 */
export function organizationChoices(
  catalog: readonly SocleOrganizationOption[],
  allowedIds: ReadonlySet<string>,
): OrganizationChoice[] {
  const byId = new Map(catalog.map((o) => [o.value, o]));
  return catalog
    .filter((o) => allowedIds.has(o.value))
    .map((o) => {
      const ancestors = ancestorsOf(byId, o.value);
      return {
        choice: {
          value: o.value,
          label: o.label,
          context: ancestors.length > 0 ? ancestors.map((a) => a.label).join(" › ") : null,
        },
        path: [...ancestors.map((a) => a.label), o.label],
      };
    })
    .sort((a, b) => {
      const depth = Math.min(a.path.length, b.path.length);
      for (let i = 0; i < depth; i += 1) {
        const cmp = compareFr(a.path[i], b.path[i]);
        if (cmp !== 0) return cmp;
      }
      return a.path.length - b.path.length;
    })
    .map((entry) => entry.choice);
}

/**
 * Faut-il POSER la question ? Un seul organisme admissible ne se choisit pas :
 * il se retient d'office (`soleOrganization`), et l'étape ne s'affiche pas —
 * l'agent d'une commune unique garde le parcours à quatre étapes qu'il connaît.
 */
export function needsOrganizationChoice(choices: readonly OrganizationChoice[]): boolean {
  return choices.length > 1;
}

/** L'unique organisme admissible, ou `null` s'il y a un choix (ou rien). */
export function soleOrganization(choices: readonly OrganizationChoice[]): string | null {
  return choices.length === 1 ? choices[0].value : null;
}
