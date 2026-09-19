/**
 * Recommandations aux agents — ce que la collectivité dit à SES AGENTS pour
 * toutes ses démarches à la fois (contrat public-api 1.27.0, Socle, 2026-09-19 :
 * `GET /v1/organizations/{id}/agent-guidance`, rédigées sur l'organisation
 * principale).
 *
 * UNE whitelist, trois lecteurs : `socle-proxy` (ce qui franchit la frontière
 * du navigateur), l'écran « Base de connaissances », et l'assistant IA
 * (`_shared/ai/condense.ts`, qui en fait un bloc de son contexte).
 *
 * C'est la version GLOBALE de `knowledge_base` : même public (l'agent et son
 * assistant), mêmes formes pour la FAQ et les liens. Les deux ne se fusionnent
 * JAMAIS — à l'écran comme dans le prompt, ce sont deux rubriques — et la
 * consigne d'une démarche l'emporte sur la consigne générale.
 *
 * ⚠️ « Consignes générales » (`guidelines`), jamais « procédures » : le mot
 * désigne déjà les démarches et `knowledge_base.proceduresText`.
 *
 * ⚠️ IDEMPOTENCE : les noms de champs sont ceux du Socle, à la lettre, et la
 * sortie est un sous-ensemble strict de l'entrée : `parse(parse(x))` vaut
 * `parse(x)`. Le proxy whiteliste, puis le navigateur re-parse par défiance —
 * renommer au passage ferait disparaître au second tour ce que le premier
 * avait gardé (vécu le 2026-08-28 sur la base de connaissances).
 *
 * ⚠️ `configured` n'est PAS cru sur parole : il est recalculé depuis le contenu
 * whitelisté. Un bloc que la whitelist a vidé ne s'annonce pas « rempli ».
 *
 * Module PUR (aucune dépendance), testé.
 */

/** Une consigne générale : un titre (parfois vide) et son texte (Markdown). */
export interface AgentGuideline {
  title: string;
  text: string;
}

export interface AgentGuidanceFaqItem {
  question: string;
  answer: string;
}

export interface AgentGuidanceLink {
  url: string;
  description: string;
}

export interface AgentGuidance {
  /** Rôle des agents (Markdown). */
  roleDescription: string;
  /** Spécificités de l'accueil physique (Markdown). */
  physicalReception: string;
  /** Consignes générales, dans l'ordre de lecture. */
  guidelines: AgentGuideline[];
  /** FAQ des agents — ni celle d'une démarche, ni celle des usagers. */
  faq: AgentGuidanceFaqItem[];
  /**
   * Sources recommandées, pour l'agent comme pour l'assistant — qui peut, depuis
   * le 2026-09-19, en lire le contenu sur accord de l'agent (`ai/sources/`).
   */
  recommendedSources: AgentGuidanceLink[];
}

/** Ce que le proxy relaie, et que l'écran relit. */
export interface AgentGuidanceView {
  /** Au moins une rubrique remplie — recalculé, jamais repris de l'entrée. */
  configured: boolean;
  /** Dernier enregistrement dans le Socle (ISO 8601), `null` si rien d'écrit. */
  updated_at: string | null;
  guidance: AgentGuidance;
}

export function emptyAgentGuidance(): AgentGuidance {
  return {
    roleDescription: "",
    physicalReception: "",
    guidelines: [],
    faq: [],
    recommendedSources: [],
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function records(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

/**
 * Whitelist stricte des cinq rubriques. Tolérante à l'inconnu (un champ ajouté
 * demain au Socle est ignoré, jamais relayé) et aux types faux ; les entrées de
 * liste entièrement vides sont écartées. Toujours une structure complète.
 */
export function parseAgentGuidance(raw: unknown): AgentGuidance {
  const stored = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    roleDescription: text(stored.roleDescription),
    physicalReception: text(stored.physicalReception),
    guidelines: records(stored.guidelines)
      .map((item) => ({ title: text(item.title), text: text(item.text) }))
      .filter((item) => item.title !== "" || item.text !== ""),
    faq: records(stored.faq)
      .map((item) => ({ question: text(item.question), answer: text(item.answer) }))
      .filter((item) => item.question !== "" || item.answer !== ""),
    recommendedSources: records(stored.recommendedSources)
      .map((item) => ({ url: text(item.url), description: text(item.description) }))
      .filter((item) => item.url !== "" || item.description !== ""),
  };
}

export function isAgentGuidanceEmpty(guidance: AgentGuidance): boolean {
  return (
    guidance.roleDescription === "" &&
    guidance.physicalReception === "" &&
    guidance.guidelines.length === 0 &&
    guidance.faq.length === 0 &&
    guidance.recommendedSources.length === 0
  );
}

/**
 * Réponse du Socle (ou du proxy) → ce que l'écran affiche. Idempotente : la
 * sortie porte les noms de son entrée. Seuls `configured`, `updated_at` et
 * `guidance` passent — pas les identifiants d'organisation, dont le navigateur
 * n'a pas l'usage.
 */
export function sanitizeAgentGuidanceView(raw: unknown): AgentGuidanceView {
  const body = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const guidance = parseAgentGuidance(body.guidance);
  const configured = !isAgentGuidanceEmpty(guidance);
  const updatedAt = typeof body.updated_at === "string" && body.updated_at.trim() !== ""
    ? body.updated_at
    : null;
  return { configured, updated_at: configured ? updatedAt : null, guidance };
}
