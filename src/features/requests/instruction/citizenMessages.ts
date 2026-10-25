// Les messages de l'USAGER dans l'onglet Échanges (lot L4b, projet Sceaux) —
// logique pure, testée.
//
// Jusqu'au 2026-10-21, le fil ne contenait que ce qui PART vers l'usager
// (`request_emails`). L'usager peut désormais répondre en ligne, depuis son
// compte ou depuis le suivi sans compte : `request_citizen_messages`, écrits
// par le serveur seul (RPC `record_citizen_message`). Le fil intercale les
// deux par date ; leurs pièces sont rattachées à leur message
// (`request_attachments.email_id` / `citizen_message_id`) et restent dans
// l'échange, jamais dans l'onglet Documents.

import type { Tables } from "@/types/database.types";

export type RequestCitizenMessage = Tables<"request_citizen_messages">;
type Email = Tables<"request_emails">;
type Attachment = Tables<"request_attachments">;

/** Un avis automatique à l'usager (B12) qui n'est PAS parti — ce que l'onglet en montre. */
export type CitizenNoticeRow = Pick<
  Tables<"citizen_notices">,
  "id" | "status" | "reason" | "error" | "event_sent" | "email_id" | "created_at" | "settled_at"
>;

export type ThreadEntry =
  | { kind: "email"; at: string; mail: Email }
  | { kind: "citizen"; at: string; message: RequestCitizenMessage }
  | { kind: "notice"; at: string; notice: CitizenNoticeRow };

/**
 * Les avis qui n'ont rien envoyé, et seulement eux : un avis parti est déjà un
 * échange du fil (`nature = 'avis'`), et un avis en attente n'a encore rien décidé.
 */
export function unsentNotices(notices: CitizenNoticeRow[]): CitizenNoticeRow[] {
  return notices.filter((n) => n.status === "skipped" || (n.status === "failed" && !n.email_id));
}

/** Le fil chronologique : envois du service, réponses de l'usager, avis non partis. */
export function mergeThread(
  emails: Email[],
  citizenMessages: RequestCitizenMessage[],
  notices: CitizenNoticeRow[] = [],
): ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...emails.map((mail) => ({ kind: "email" as const, at: mail.created_at, mail })),
    ...citizenMessages.map((message) => ({ kind: "citizen" as const, at: message.created_at, message })),
    ...unsentNotices(notices).map((notice) => ({ kind: "notice" as const, at: notice.settled_at ?? notice.created_at, notice })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/** Par où l'usager a écrit — dit à l'agent, qui sait alors à qui il a affaire. */
export function citizenChannelLabel(authorKind: string): string {
  return authorKind === "compte" ? "depuis son compte" : "depuis le suivi en ligne";
}

/** Une pièce jointe à un échange (envoyé OU reçu) : elle reste dans l'échange. */
export function isExchangePiece(a: Pick<Attachment, "email_id" | "citizen_message_id">): boolean {
  return Boolean(a.email_id) || Boolean(a.citizen_message_id);
}

/** Les pièces de chaque échange, par identifiant d'envoi ou de message de l'usager. */
export function piecesByExchange(attachments: Attachment[]): Map<string, Attachment[]> {
  const map = new Map<string, Attachment[]>();
  for (const a of attachments) {
    const key = a.email_id ?? a.citizen_message_id;
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), a]);
  }
  return map;
}
