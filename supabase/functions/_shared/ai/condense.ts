/**
 * Le budget de contexte : faire tenir une base de connaissances entière — y
 * compris des documents d'entraînement — dans une enveloppe de jetons.
 *
 * Clara tronque à plat (800 / 800 / 3 FAQ / 400 caractères) : suffisant pour
 * un pré-remplissage, insuffisant ici, où l'on doit en plus loger des
 * documents de plusieurs dizaines de pages.
 *
 * DEUX PRINCIPES :
 *
 *  1. **Les garde-fous passent en premier et ne sont jamais évincés.** Ce sont
 *     eux qui changent une décision, et le Socle les adresse explicitement
 *     « à l'agent ET à l'IA ». Tout le reste peut être rogné avant eux.
 *
 *  2. **Les documents se partagent le reliquat en TOURNIQUET**, pas au premier
 *     arrivé. Un découpage à plat ferait qu'un PDF de 200 pages évince tous
 *     les autres, silencieusement — et l'agent ne saurait jamais que la
 *     réponse ignore trois documents sur quatre. Chaque document reçoit une
 *     part égale, puis les courts rendent leur surplus aux longs.
 *
 * Toute troncature est ANNONCÉE dans le texte (le modèle doit savoir qu'il ne
 * voit pas tout) et remontée dans `skipped` / `truncated`, jusqu'à l'écran.
 *
 * Sortie DÉTERMINISTE : même entrée, même chaîne. C'est ce qui rendra un cache
 * de prompt possible le jour où on en voudra un.
 *
 * Module PUR, testé.
 */

import { estimateTokens } from "./tokens.ts";
import type { AiKnowledge } from "./knowledge.ts";

/** Enveloppe par défaut laissée à la base de connaissances. */
export const KNOWLEDGE_BUDGET_TOKENS = 20000;

const CHARS_PER_TOKEN = 3.5;

const LIMITS = {
  guardrails: 2000,
  agentHelp: 3000,
  procedures: 3000,
  faqEntries: 8,
  faqQuestion: 200,
  faqAnswer: 600,
} as const;

const TRUNCATION_MARK = " […] (extrait tronqué)";

/**
 * Part minimale sous laquelle un document est ÉCARTÉ plutôt que réduit à une
 * miette. Servir 80 caractères d'un barème n'aide personne : le modèle croit
 * disposer du document, alors qu'il n'en a qu'un fragment sans contexte. Mieux
 * vaut l'annoncer à l'agent (« 3 documents non pris en compte ») et répondre
 * avec ce qu'on a vraiment lu.
 */
const MIN_DOCUMENT_TOKENS = 150;

function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}

/**
 * Tronque sans couper un mot — et surtout **jamais au milieu d'une paire de
 * substituts UTF-16**. Un emoji ou un caractère hors BMP coupé en deux produit
 * un caractère de remplacement dans le prompt ; sur un document scanné, ça
 * arrive plus souvent qu'on ne croit.
 */
export function truncateAtBoundary(text: string, maxChars: number): string {
  if (typeof text !== "string" || text.length <= maxChars) return text ?? "";
  if (maxChars <= 0) return "";

  let cut = maxChars;
  // Ne pas scinder une paire de substituts.
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;

  // Reculer jusqu'à une frontière de ligne, sinon de mot, si elle n'est pas
  // trop loin — au-delà on préfère couper net que perdre 30 % du texte.
  const slice = text.slice(0, cut);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  if (lastBreak > cut * 0.7) cut = lastBreak;

  return text.slice(0, cut).trimEnd() + TRUNCATION_MARK;
}

/** Texte extrait d'un document d'entraînement (vague 4 ; vide avant elle). */
export interface DocumentExtract {
  path: string;
  name: string;
  text: string;
}

export interface CondenseResult {
  /** Le bloc de connaissances prêt à être injecté. Vide si rien à dire. */
  text: string;
  /** Noms des documents effectivement injectés. */
  included: string[];
  /** Documents écartés, avec le motif — remonté jusqu'à l'écran. */
  skipped: { name: string; reason: string }[];
  /** Vrai si au moins un bloc a été rogné. */
  truncated: boolean;
}

function block(title: string, body: string): string {
  return body.trim() === "" ? "" : `### ${title}\n${body.trim()}\n`;
}

export function condenseKnowledge(
  kb: AiKnowledge,
  extracts: DocumentExtract[] = [],
  budgetTokens: number = KNOWLEDGE_BUDGET_TOKENS,
): CondenseResult {
  const parts: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const included: string[] = [];
  let truncated = false;
  let remaining = Math.max(budgetTokens, 0);

  const spend = (text: string, maxTokens: number): string => {
    const allowance = Math.min(maxTokens, remaining);
    if (allowance <= 0 || text.trim() === "") return "";
    const chars = tokensToChars(allowance);
    const out = truncateAtBoundary(text.trim(), chars);
    if (out.length < text.trim().length) truncated = true;
    remaining -= estimateTokens(out);
    return out;
  };

  // 1. Garde-fous — priorité absolue.
  if (kb.guardrails.length > 0) {
    const body = kb.guardrails.map((g) => `- ${g}`).join("\n");
    parts.push(block("Garde-fous (à respecter sans exception)", spend(body, LIMITS.guardrails)));
  }

  // 2. Consignes pour l'agent, 3. Procédure de traitement.
  parts.push(block("Consignes du service", spend(kb.agentHelpText, LIMITS.agentHelp)));
  parts.push(block("Procédure de traitement", spend(kb.proceduresText, LIMITS.procedures)));

  // 4. FAQ — bornée par entrée ET par nombre d'entrées.
  if (kb.faq.length > 0) {
    const entries = kb.faq.slice(0, LIMITS.faqEntries);
    if (kb.faq.length > entries.length) truncated = true;
    const body = entries
      .map((f) => {
        const q = truncateAtBoundary(f.question.trim(), LIMITS.faqQuestion);
        const a = truncateAtBoundary(f.answer.trim(), LIMITS.faqAnswer);
        return `Q. ${q}\nR. ${a}`;
      })
      .join("\n\n");
    parts.push(block("Questions fréquentes", spend(body, remaining)));
  }

  // 5. Documents d'entraînement — le reliquat, EN TOURNIQUET.
  const usable = extracts.filter((e) => e.text.trim() !== "");
  if (usable.length > 0) {
    // On réserve de quoi citer les sources et les liens après.
    const forDocuments = Math.max(0, remaining - 400);
    // Les courts rendent leur surplus : on sert d'abord ceux qui tiennent dans
    // leur part, et le reliquat se redistribue aux longs.
    const sorted = [...usable].sort((a, b) => a.text.length - b.text.length);
    let pool = forDocuments;
    let left = sorted.length;
    const rendered: { name: string; body: string }[] = [];

    for (const doc of sorted) {
      const allowance = left > 0 ? Math.floor(pool / left) : 0;
      if (allowance < MIN_DOCUMENT_TOKENS) {
        skipped.push({ name: doc.name, reason: "budget de contexte atteint" });
        left -= 1;
        continue;
      }
      const body = truncateAtBoundary(doc.text.trim(), tokensToChars(allowance));
      if (body.length < doc.text.trim().length) truncated = true;
      const cost = estimateTokens(body);
      pool -= cost;
      left -= 1;
      rendered.push({ name: doc.name, body });
      included.push(doc.name);
    }

    // Rendu dans l'ordre d'origine (déterminisme lisible), pas dans l'ordre de
    // tri par taille.
    const byName = new Map(rendered.map((r) => [r.name, r.body]));
    const body = usable
      .filter((d) => byName.has(d.name))
      .map((d) => `-- Document « ${d.name} » --\n${byName.get(d.name)}`)
      .join("\n\n");
    if (body !== "") {
      parts.push(block("Documents de référence du service", body));
      remaining = Math.max(0, remaining - estimateTokens(body));
    }
  }

  // 6. Sources et liens — les URL seules, jamais suivies en v1.
  const sources = [...kb.aiSources, ...kb.agentLinks]
    .map((l) => `- ${l.description || l.url}${l.description ? ` (${l.url})` : ""}`)
    .join("\n");
  if (sources !== "") {
    parts.push(block("Sources citées (non consultées par l'assistant)", spend(sources, remaining)));
  }

  return {
    text: parts.filter((p) => p !== "").join("\n").trim(),
    included,
    skipped,
    truncated,
  };
}
