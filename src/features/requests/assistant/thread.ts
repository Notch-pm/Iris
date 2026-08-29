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

export type ThreadRole = "user" | "assistant" | "error";

export interface ThreadMessage {
  /** Clé de rendu stable. Un compteur, pas un aléa : le fil reste testable. */
  id: number;
  role: ThreadRole;
  content: string;
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
 */
export function trimForSend(thread: Thread, draft: string): ChatMessage[] {
  const clean = thread.messages.filter((m) => m.role !== "error");

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

/** Le bouton d'envoi est-il actionnable ? */
export function canSend(draft: string, pending: boolean): boolean {
  return !pending && draft.trim() !== "";
}

/** Y a-t-il déjà eu un échange ? (l'écran affiche sinon les questions d'amorce) */
export function isFresh(thread: Thread): boolean {
  return thread.messages.length === 0;
}
