// Ce que l'écran dit des recommandations générales avant de les ouvrir — pur,
// testé. Le contenu, lui, est rendu tel que le Socle le sert.

import { normalizeSearch } from "@/features/requests/creation/procedureSearch";
import type { AgentGuidance } from "@fn/_shared/organizations/agentGuidance";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** Les rubriques remplies, dans l'ordre de la page — carte du catalogue, contexte de l'assistant. */
export function guidanceHighlights(guidance: AgentGuidance): string[] {
  const out: string[] = [];
  if (guidance.roleDescription) out.push("rôle des agents");
  if (guidance.physicalReception) out.push("accueil physique");
  if (guidance.guidelines.length > 0) out.push(plural(guidance.guidelines.length, "consigne", "consignes"));
  if (guidance.faq.length > 0) out.push(plural(guidance.faq.length, "question", "questions"));
  if (guidance.recommendedSources.length > 0) {
    out.push(plural(guidance.recommendedSources.length, "source", "sources"));
  }
  return out;
}

/** Les rubriques de la page « Recommandations générales », dans l'ordre de lecture. */
export type GuidanceTab = "role" | "accueil" | "consignes" | "faq" | "sources";

export const GUIDANCE_TAB_LABELS: Record<GuidanceTab, string> = {
  role: "Rôle des agents",
  accueil: "Accueil physique",
  consignes: "Consignes générales",
  faq: "FAQ des agents",
  sources: "Sources recommandées",
};

export interface GuidanceNavItem {
  tab: GuidanceTab;
  label: string;
  /** Nombre d'entrées, pour les rubriques qui sont des listes. */
  count?: number;
}

/** Une entrée par rubrique NON VIDE — même règle que `internalNav` pour une démarche. */
export function guidanceNav(guidance: AgentGuidance): GuidanceNavItem[] {
  const out: GuidanceNavItem[] = [];
  if (guidance.roleDescription) out.push({ tab: "role", label: GUIDANCE_TAB_LABELS.role });
  if (guidance.physicalReception) out.push({ tab: "accueil", label: GUIDANCE_TAB_LABELS.accueil });
  if (guidance.guidelines.length > 0) {
    out.push({ tab: "consignes", label: GUIDANCE_TAB_LABELS.consignes, count: guidance.guidelines.length });
  }
  if (guidance.faq.length > 0) out.push({ tab: "faq", label: GUIDANCE_TAB_LABELS.faq, count: guidance.faq.length });
  if (guidance.recommendedSources.length > 0) {
    out.push({ tab: "sources", label: GUIDANCE_TAB_LABELS.sources, count: guidance.recommendedSources.length });
  }
  return out;
}

/** La rubrique demandée si elle est remplie, sinon la première qui l'est. */
export function resolveGuidanceTab(requested: GuidanceTab | null, nav: readonly GuidanceNavItem[]): GuidanceTab | null {
  if (requested && nav.some((item) => item.tab === requested)) return requested;
  return nav[0]?.tab ?? null;
}

/**
 * L'entrée « Recommandations générales » du sélecteur de démarche : elle n'est
 * pas une démarche, mais elle se cherche comme elles (mêmes règles que
 * `filterCatalogue` : sans accents ni casse, tous les mots).
 */
export const GUIDANCE_ENTRY_ID = "recommandations";
export const GUIDANCE_ENTRY_LABEL = "Recommandations générales";
export const GUIDANCE_ENTRY_GROUP = "Toutes démarches";

export function guidanceEntryMatches(query: string): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(`${GUIDANCE_ENTRY_LABEL} ${GUIDANCE_ENTRY_GROUP} collectivité agents`);
  return words.every((w) => haystack.includes(w));
}

/**
 * L'adresse d'une source, si elle peut devenir un lien : `http(s)` seulement.
 * Une source `javascript:` (ou sans schéma) reste du TEXTE — le référentiel est
 * saisi par des administrateurs de confiance, mais un lien exécutable n'a
 * aucun usage légitime ici.
 */
export function safeSourceHref(url: string): string | null {
  return /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;
}

/** « 19 septembre 2026 » — `null` pour une date absente ou illisible. */
export function guidanceDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
