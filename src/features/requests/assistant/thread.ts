// Le fil de conversation avec l'assistant — logique pure.
//
// ⚠️ LA CONVERSATION EST ÉPHÉMÈRE (décision PO 2026-08-28) : rien n'est
// enregistré, ni côté Iris, ni chez le fournisseur. Elle vit dans l'état de la
// page et disparaît au rechargement. La conséquence directe, c'est que le
// multi-tours oblige le navigateur à RENVOYER l'historique à chaque question —
// d'où `trimForSend`, qui décide ce qui repart.
//
// Module PUR (aucun DOM, aucun réseau), testé.

import type { ChatMessage } from "@fn/_shared/ai/messages";
import { MAX_CONSULTED, type SourceRef } from "@fn/_shared/ai/sources/catalogue";

/**
 * `proposal` (2026-09-19) : la carte « l'assistant propose de consulter ces
 * sources ». Elle vit dans le fil, à sa place chronologique, mais n'est PAS un
 * tour de conversation — `trimForSend` ne la renvoie jamais.
 */
export type ThreadRole = "user" | "assistant" | "error" | "proposal";

/** Ouverte, acceptée, refusée — ou expirée : une autre question l'a devancée. */
export type ProposalStatus = "open" | "accepted" | "declined" | "expired";

export interface ThreadProposal {
  sources: SourceRef[];
  status: ProposalStatus;
}

export interface ThreadMessage {
  /** Clé de rendu stable. Un compteur, pas un aléa : le fil reste testable. */
  id: number;
  role: ThreadRole;
  content: string;
  /** Rôle `proposal` seulement. */
  proposal?: ThreadProposal;
}

export interface Thread {
  messages: ThreadMessage[];
  nextId: number;
}

export function emptyThread(): Thread {
  return { messages: [], nextId: 1 };
}

function append(thread: Thread, role: ThreadRole, content: string): Thread {
  return {
    messages: [...thread.messages, { id: thread.nextId, role, content }],
    nextId: thread.nextId + 1,
  };
}

export const appendUser = (thread: Thread, content: string) => append(thread, "user", content);
export const appendAssistant = (thread: Thread, content: string) => append(thread, "assistant", content);
export const appendError = (thread: Thread, content: string) => append(thread, "error", content);

/** La carte de proposition, ouverte. Sans source, le fil ne change pas. */
export function appendProposal(thread: Thread, sources: SourceRef[]): Thread {
  if (sources.length === 0) return thread;
  return {
    messages: [
      ...thread.messages,
      { id: thread.nextId, role: "proposal", content: "", proposal: { sources, status: "open" } },
    ],
    nextId: thread.nextId + 1,
  };
}

/** Clore une proposition — seule une proposition OUVERTE change d'état. */
export function resolveProposal(thread: Thread, id: number, status: Exclude<ProposalStatus, "open">): Thread {
  return {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === id && m.proposal?.status === "open" ? { ...m, proposal: { ...m.proposal, status } } : m
    ),
  };
}

/**
 * Une nouvelle question fait EXPIRER les propositions restées ouvertes : les
 * approuver après coup enchaînerait une consultation sur une question qui
 * n'est plus celle en cours.
 */
export function expireOpenProposals(thread: Thread): Thread {
  if (!thread.messages.some((m) => m.proposal?.status === "open")) return thread;
  return {
    ...thread,
    messages: thread.messages.map((m) =>
      m.proposal?.status === "open" ? { ...m, proposal: { ...m.proposal, status: "expired" } } : m
    ),
  };
}

/** Une proposition encore actionnable. */
export function openProposal(thread: Thread, id: number): ThreadProposal | null {
  const message = thread.messages.find((m) => m.id === id);
  return message?.proposal?.status === "open" ? message.proposal : null;
}

/**
 * Le tour que l'agent « dit » en approuvant. Il entre dans la conversation
 * comme une question ordinaire : le modèle sait ainsi, au tour suivant, qu'il
 * a été autorisé — le texte des sources, lui, n'y entre jamais (il est relu
 * par le serveur, `sources` du corps).
 */
export function approvalText(sources: SourceRef[]): string {
  const names = sources.map((s) => `« ${s.label} »`);
  const list = names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
  return `Oui, consulte ${list}.`;
}

/**
 * Les sources autorisées pour la suite de la conversation : celles déjà
 * autorisées, plus les nouvelles, sans doublon. Au-delà du plafond du serveur,
 * les plus ANCIENNES cèdent la place — la dernière approbation est celle qui
 * porte sur la question en cours.
 */
export function mergeConsulted(current: SourceRef[], added: SourceRef[]): SourceRef[] {
  const addedIds = new Set(added.map((s) => s.id));
  const merged = [...current.filter((s) => !addedIds.has(s.id)), ...added];
  return merged.slice(-MAX_CONSULTED);
}

/** Jumeau client du plafond serveur (`MAX_TURNS` de `_shared/ai/messages.ts`). */
export const MAX_TURNS = 12;

/**
 * Ce qui repart au serveur.
 *
 * ⚠️ DEUX RÈGLES, et la première est celle qui compte :
 *
 *  1. **Un tour en erreur n'est JAMAIS renvoyé.** Sans cela, le modèle relit
 *     « Le plafond d'utilisation est atteint » comme si c'était sa propre
 *     réponse, et enchaîne dessus — il s'excuse, promet de réessayer, ou
 *     invente une politique de quota. L'erreur appartient à l'écran, pas à la
 *     conversation.
 *
 *  2. **Une question restée sans réponse est écartée** (sauf la dernière, qui
 *     est justement celle qu'on pose). Deux questions d'affilée sans réponse
 *     entre elles ne racontent rien au modèle ; garder la trace d'un échec
 *     dans l'historique le ferait raisonner sur un tour qui n'a pas eu lieu.
 *
 * ⚠️ LISTE BLANCHE : seuls `user` et `assistant` repartent. Tout autre rôle —
 * erreur, carte de proposition, et tout rôle à venir — reste à l'écran. (La
 * version d'avant convertissait « tout sauf assistant » en `user` : une carte
 * de proposition serait repartie comme une question de l'agent.)
 */
export function trimForSend(thread: Thread, draft: string): ChatMessage[] {
  const clean = thread.messages.filter((m) => m.role === "user" || m.role === "assistant");

  const paired: ThreadMessage[] = [];
  for (let i = 0; i < clean.length; i++) {
    const message = clean[i];
    if (message.role === "user" && clean[i + 1]?.role !== "assistant") continue;
    paired.push(message);
  }

  const history: ChatMessage[] = paired.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  history.push({ role: "user", content: draft.trim() });

  // Les tours les plus RÉCENTS, comme côté serveur.
  return history.slice(-MAX_TURNS);
}

/**
 * La réponse à lire depuis sa PREMIÈRE ligne (retour PO 2026-09-19) : le
 * dernier tour de l'assistant, quand rien ne le suit sinon une carte de
 * proposition — la carte vient APRÈS la réponse, c'est la réponse qu'on lit
 * d'abord. `null` : on suit le bas du fil (question, attente, erreur).
 */
export function readingAnchor(thread: Thread): number | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === "assistant") return message.id;
    if (message.role !== "proposal") return null;
  }
  return null;
}

/** Le bouton d'envoi est-il actionnable ? */
export function canSend(draft: string, pending: boolean): boolean {
  return !pending && draft.trim() !== "";
}

/** Y a-t-il déjà eu un échange ? (l'écran affiche sinon les questions d'amorce) */
export function isFresh(thread: Thread): boolean {
  return thread.messages.length === 0;
}
