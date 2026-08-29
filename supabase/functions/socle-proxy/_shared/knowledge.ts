/**
 * Base de connaissances d'une démarche — la PART DESTINÉE À L'AGENT.
 *
 * Le schéma est **possédé par le Socle** (`procedures.knowledge_base`, écrit
 * par l'étape « Base de connaissances » de l'éditeur de démarche) ; Iris n'en
 * est que consommateur, et n'en garde AUCUNE copie : la fiche relit le Socle
 * à chaque visite, comme pour l'identité d'un usager. Une consigne corrigée ce
 * matin dans le référentiel doit être celle que l'agent lit cet après-midi —
 * c'est aussi pourquoi la base de connaissances n'entre pas dans le
 * `procedure_snapshot`, qui fige au contraire le formulaire du dépôt.
 *
 * ⚠️ Le bloc Socle mélange DEUX destinataires. Ce module ne retient que le
 * premier :
 *   - **l'agent** — `agentHelpText`, `proceduresText`, `agentDocuments`,
 *     `agentLinks`, `faq`, `guardrails` ;
 *   - **l'assistant IA** — `trainingDocuments`, `aiSources`, qui sont de la
 *     matière à prompt et non de la lecture humaine. Ils ne franchissent pas
 *     la frontière tant que l'assistant n'existe pas, et le jour où il
 *     existera, il les lira **côté serveur** : rien n'oblige à les poser dans
 *     un navigateur.
 *
 * Les garde-fous, eux, s'adressent explicitement « à l'agent ET à l'IA »
 * (libellé du Socle) : ils restent.
 *
 * Module PUR (aucune dépendance Deno ni React) : il sert de whitelist au
 * proxy et de contrat de rendu au navigateur, comme `procedureForm.ts` pour
 * le formulaire.
 */

/** Lien (URL + description courte). */
export interface KnowledgeLink {
  url: string;
  description: string;
}

/** Entrée de FAQ : une question, sa réponse de référence. */
export interface KnowledgeFaqItem {
  question: string;
  answer: string;
}

/** Document d'aide agent stocké dans le bucket Socle `procedure-documents`. */
export interface KnowledgeDocument {
  /** Chemin dans le bucket Socle — jamais une URL : elle se signe à la demande. */
  path: string;
  /** Nom de fichier d'origine, affiché à l'agent. */
  name: string;
}

/**
 * Ce que l'agent voit d'une base de connaissances.
 *
 * ⚠️ Les noms de champs sont ceux du SOCLE, à la lettre : la sortie est un
 * **sous-ensemble strict** de l'entrée, donc `parseAgentKnowledge` est
 * IDEMPOTENTE. Ce n'est pas de la coquetterie — le proxy whiteliste, puis le
 * navigateur re-parse par défiance la réponse qu'il reçoit. Renommer un champ
 * au passage ferait disparaître au second tour ce que le premier avait gardé
 * (vécu le 2026-08-28 : documents et liens évaporés, textes intacts). Le test
 * d'idempotence garde cette porte fermée.
 */
export interface AgentKnowledge {
  /** Texte d'aide pour l'agent (Markdown). */
  agentHelpText: string;
  /** Procédures internes : étapes, règles, circuits de validation (Markdown). */
  proceduresText: string;
  /** Documents d'aide agent (PDF/images), consultables par URL signée. */
  agentDocuments: KnowledgeDocument[];
  /** Liens utiles à l'agent (réglementation, formulaires, annuaires…). */
  agentLinks: KnowledgeLink[];
  /** Questions fréquentes et leurs réponses de référence. */
  faq: KnowledgeFaqItem[];
  /** Ce que l'agent ne doit pas décider ou affirmer ; points d'escalade. */
  guardrails: string[];
}

export function emptyKnowledge(): AgentKnowledge {
  return {
    agentHelpText: "",
    proceduresText: "",
    agentDocuments: [],
    agentLinks: [],
    faq: [],
    guardrails: [],
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Exportée pour `_shared/ai/knowledge.ts`, qui lit les `trainingDocuments`
 * (matière de l'assistant, côté SERVEUR seulement) avec exactement les mêmes
 * règles. Exporter la fonction n'élargit rien de ce qui franchit la frontière
 * navigateur : la whitelist de sortie, elle, ne bouge pas.
 */
export function parseDocuments(raw: unknown): KnowledgeDocument[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeDocument[] = [];
  for (const entry of raw) {
    const item = record(entry);
    if (!item) continue;
    const path = text(item.path).trim();
    if (!path) continue;
    out.push({ path, name: text(item.name).trim() || path });
  }
  return out;
}

/** Exportée pour `_shared/ai/knowledge.ts` (`aiSources`) — voir parseDocuments. */
export function parseLinks(raw: unknown): KnowledgeLink[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeLink[] = [];
  for (const entry of raw) {
    const item = record(entry);
    if (!item) continue;
    const link = { url: text(item.url).trim(), description: text(item.description).trim() };
    // Ligne ébauchée puis abandonnée dans l'éditeur Socle : rien à montrer.
    if (link.url || link.description) out.push(link);
  }
  return out;
}

function parseFaq(raw: unknown): KnowledgeFaqItem[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeFaqItem[] = [];
  for (const entry of raw) {
    const item = record(entry);
    if (!item) continue;
    const faq = { question: text(item.question).trim(), answer: text(item.answer).trim() };
    if (faq.question || faq.answer) out.push(faq);
  }
  return out;
}

/**
 * Les garde-fous sont saisis un par ligne dans le Socle, et l'usage y met
 * souvent un tiret de liste en tête (« - Ne jamais… ») — constaté sur les
 * démarches ACCM. Iris les affiche DÉJÀ en liste, avec sa propre puce : le
 * marqueur d'origine ferait doublon. Il est retiré, le texte ne l'est pas.
 */
function parseGuardrails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(text)
    .map((v) => v.trim().replace(/^[-*•]\s+/, "").trim())
    .filter((v) => v !== "");
}

/**
 * Whitelist stricte du bloc Socle → part agent. Tolérante à l'inconnu (un
 * champ ajouté demain au Socle est ignoré, jamais relayé) et aux types faux.
 * Toujours une structure complète en sortie : l'affichage n'a pas à se
 * défendre contre `undefined`.
 */
export function parseAgentKnowledge(raw: unknown): AgentKnowledge {
  const kb = emptyKnowledge();
  const stored = record(raw);
  if (!stored) return kb;
  kb.agentHelpText = text(stored.agentHelpText).trim();
  kb.proceduresText = text(stored.proceduresText).trim();
  kb.agentDocuments = parseDocuments(stored.agentDocuments);
  kb.agentLinks = parseLinks(stored.agentLinks);
  kb.faq = parseFaq(stored.faq);
  kb.guardrails = parseGuardrails(stored.guardrails);
  return kb;
}

/** Volumétrie par bloc — pastille du rail, états vides, ordre d'affichage. */
export interface KnowledgeCounts {
  aide: boolean;
  procedures: boolean;
  documents: number;
  links: number;
  faq: number;
  guardrails: number;
  /** Nombre de blocs non vides — 0 ⇒ la démarche n'a rien documenté. */
  blocks: number;
}

export function knowledgeCounts(kb: AgentKnowledge): KnowledgeCounts {
  const counts: KnowledgeCounts = {
    aide: kb.agentHelpText !== "",
    procedures: kb.proceduresText !== "",
    documents: kb.agentDocuments.length,
    links: kb.agentLinks.length,
    faq: kb.faq.length,
    guardrails: kb.guardrails.length,
    blocks: 0,
  };
  counts.blocks = [
    counts.aide, counts.procedures,
    counts.documents > 0, counts.links > 0, counts.faq > 0, counts.guardrails > 0,
  ].filter(Boolean).length;
  return counts;
}

export function isKnowledgeEmpty(kb: AgentKnowledge): boolean {
  return knowledgeCounts(kb).blocks === 0;
}

/**
 * Un chemin de document est-il celui d'un document d'AIDE AGENT de cette
 * démarche ? C'est la garde de la route de signature : sans elle, le proxy
 * serait un lecteur libre du bucket `procedure-documents` du Socle dans tout
 * le périmètre de la clé — y compris des documents d'entraînement IA, qui ne
 * sont pas destinés aux agents.
 */
export function allowsAgentDocument(kb: AgentKnowledge, path: unknown): boolean {
  if (typeof path !== "string" || path.trim() === "") return false;
  return kb.agentDocuments.some((d) => d.path === path);
}
