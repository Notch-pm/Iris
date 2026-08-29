/**
 * Le parseur de l'historique de conversation — c'est-à-dire d'une entrée NON
 * FIABLE.
 *
 * La conversation est éphémère (décision PO) : elle vit dans l'onglet et rien
 * n'en est conservé. La conséquence directe, c'est que le multi-tours oblige
 * le NAVIGATEUR à renvoyer les tours précédents à chaque question. Cet
 * historique est donc du texte fourni par le client, au même titre que la
 * question elle-même.
 *
 * Ce que ce module refuse, et pourquoi :
 *   • `role: "system"` — le prompt système est composé par le serveur. Si un
 *     message système du client survivait, n'importe qui pourrait réécrire les
 *     consignes de l'assistant depuis la console du navigateur.
 *   • un rôle inconnu, un `content` non textuel — le fournisseur les
 *     refuserait de toute façon, autant échouer ici avec un message français.
 *   • un dernier tour qui n'est pas de l'agent — une conversation se poursuit
 *     sur une question, pas sur une réponse.
 *
 * Ce qu'il borne : 12 tours, 4 000 caractères par message, 24 000 au total.
 * La troncature garde les tours les plus RÉCENTS — c'est le fil de la
 * discussion en cours qui compte, pas son début.
 *
 * Module PUR, testé.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export const MAX_TURNS = 12;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TOTAL_CHARS = 24000;

export type ParseResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; code: string; message: string };

function fail(code: string, message: string): ParseResult {
  return { ok: false, code, message };
}

export function parseClientHistory(raw: unknown): ParseResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail("invalid_messages", "Conversation invalide : au moins une question est attendue.");
  }

  const parsed: ChatMessage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail("invalid_messages", "Conversation invalide.");
    }
    const { role, content } = entry as Record<string, unknown>;
    if (role === "system") {
      return fail(
        "invalid_role",
        "Un message de conversation ne peut pas porter de consigne système.",
      );
    }
    if (role !== "user" && role !== "assistant") {
      return fail("invalid_messages", "Conversation invalide : rôle inconnu.");
    }
    if (typeof content !== "string" || content.trim() === "") {
      return fail("invalid_messages", "Conversation invalide : message vide.");
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return fail(
        "message_too_long",
        `Votre question est trop longue (${MAX_MESSAGE_CHARS} caractères maximum).`,
      );
    }
    parsed.push({ role, content: content.trim() });
  }

  if (parsed[parsed.length - 1].role !== "user") {
    return fail("invalid_messages", "Conversation invalide : la dernière entrée doit être une question.");
  }

  // On garde les tours les plus RÉCENTS.
  let kept = parsed.slice(-MAX_TURNS);

  // Puis on rogne par la tête tant que le volume total dépasse la borne. Le
  // dernier message (la question) n'est jamais retiré : sans lui il n'y a plus
  // rien à demander — sa longueur est déjà bornée message par message.
  let total = kept.reduce((sum, m) => sum + m.content.length, 0);
  while (kept.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= kept[0].content.length;
    kept = kept.slice(1);
  }

  return { ok: true, messages: kept };
}
