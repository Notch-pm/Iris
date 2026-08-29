/**
 * Base de connaissances d'une démarche — la vue SERVEUR, celle qui voit tout.
 *
 * `socle-proxy/_shared/knowledge.ts` retient la part AGENT et retire
 * délibérément `trainingDocuments` et `aiSources` : ce qui part vers un
 * navigateur n'a pas à porter un corpus de prompt. Ici, on est du côté
 * serveur, où l'assistant compose son contexte — la matière IA est
 * précisément ce qu'on vient chercher.
 *
 * ⚠️ CE MODULE NE DOIT JAMAIS ÊTRE IMPORTÉ PAR `socle-proxy`. C'est la seule
 * règle qui garde les deux chemins séparés, et un test la vérifie en lisant le
 * source de `socle-proxy/index.ts`. Le jour où quelqu'un « factorise », le
 * test tombe.
 *
 * ⚠️ IDEMPOTENCE : les noms de champs sont ceux du Socle, à la lettre, comme
 * dans le module agent. La sortie est un sous-ensemble strict de l'entrée,
 * donc `parse(parse(x)) === parse(x)`. Renommer au passage ferait disparaître
 * au second tour ce que le premier avait gardé — vécu le 2026-08-28.
 *
 * Module PUR (aucune dépendance Deno), testé.
 */

import {
  parseAgentKnowledge,
  parseDocuments,
  parseLinks,
  type AgentKnowledge,
  type KnowledgeDocument,
  type KnowledgeLink,
} from "../../socle-proxy/_shared/knowledge.ts";

export type {
  AgentKnowledge,
  KnowledgeDocument,
  KnowledgeFaqItem,
  KnowledgeLink,
} from "../../socle-proxy/_shared/knowledge.ts";

/** Tout ce que le Socle documente d'une démarche — les deux destinataires. */
export interface AiKnowledge extends AgentKnowledge {
  /** Documents d'entraînement IA : lus côté serveur, jamais servis au navigateur. */
  trainingDocuments: KnowledgeDocument[];
  /** Sources en ligne destinées à l'IA. Citées, jamais suivies (v1). */
  aiSources: KnowledgeLink[];
}

export function emptyAiKnowledge(): AiKnowledge {
  return {
    agentHelpText: "",
    proceduresText: "",
    agentDocuments: [],
    agentLinks: [],
    faq: [],
    guardrails: [],
    trainingDocuments: [],
    aiSources: [],
  };
}

/**
 * Whitelist serveur : la part agent (déléguée au module partagé, une seule
 * implémentation) plus les deux champs destinés à l'assistant.
 */
export function parseAiKnowledge(raw: unknown): AiKnowledge {
  const agent = parseAgentKnowledge(raw);
  const stored = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return {
    ...agent,
    trainingDocuments: parseDocuments(stored.trainingDocuments),
    aiSources: parseLinks(stored.aiSources),
  };
}

/** Y a-t-il quelque chose à donner au modèle ? */
export function isAiKnowledgeEmpty(kb: AiKnowledge): boolean {
  return kb.agentHelpText === "" && kb.proceduresText === "" &&
    kb.faq.length === 0 && kb.guardrails.length === 0 &&
    kb.trainingDocuments.length === 0 && kb.aiSources.length === 0 &&
    kb.agentLinks.length === 0;
}
