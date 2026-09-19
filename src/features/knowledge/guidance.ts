// Ce que l'écran dit des recommandations générales avant de les ouvrir — pur,
// testé. Le contenu, lui, est rendu tel que le Socle le sert.

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
