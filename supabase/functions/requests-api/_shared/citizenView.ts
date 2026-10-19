// Vue USAGER d'une demande — ce que l'usager lui-même peut lire de SA demande
// (scope `requests:citizen`, portail Nora). WHITELIST STRICTE, distincte de
// `serializeRequest` (vue partenaire) : celle-ci expose `closure_motif`, qui
// ne sort jamais vers l'usager (doctrine des avis de clôture, docs/emails.md).
//
// Ne sortent JAMAIS d'ici : notes internes (`request_messages`), motif de
// clôture, agents (assignation, `sent_by`), journal (`/timeline`), formulaire
// et identité déclarée, chemins de stockage, pièces `instruction_interne`.
//
// Ce qui sort :
//   · la demande : référence, objet, démarche, statut, dates, et le texte de
//     clôture — rédigé POUR l'usager — une fois la demande close ;
//   · ses pièces à elle (`kind = 'demande'`, non remplacées, hors échange) ;
//   · les messages qu'Iris lui a ENVOYÉS (`request_emails.status = 'envoye'`),
//     avec leurs pièces — l'accusé y figure, son code d'accès masqué.

export const CITIZEN_REQUEST_SELECT =
  "id, reference, status, subject, procedure_snapshot, received_at, updated_at, closed_at, closure_text";

export const CITIZEN_EMAIL_SELECT = "id, subject, body, sent_at, status";

export const CITIZEN_ATTACHMENT_SELECT =
  "id, file_name, mime_type, file_size, kind, email_id, superseded_by, storage_path, created_at";

export interface CitizenAttachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
}

export interface CitizenMessage {
  id: string;
  subject: string;
  body: string;
  sent_at: string;
  attachments: CitizenAttachment[];
}

export interface CitizenRequest {
  id: string;
  reference: string;
  subject: string;
  procedure_name: string | null;
  status: string;
  received_at: string;
  updated_at: string;
  closed_at: string | null;
  closure_text: string | null;
  attachments: CitizenAttachment[];
  messages: CitizenMessage[];
}

// deno-lint-ignore no-explicit-any
type Row = any;

/** Une pièce que l'usager peut voir : jamais un document d'instruction interne, jamais sans fichier. */
export function isCitizenVisibleAttachment(row: Row, sentEmailIds: ReadonlySet<string>): boolean {
  if (!row || typeof row.storage_path !== "string" || row.storage_path === "") return false;
  if (row.kind === "instruction_interne") return false;
  if (row.email_id) return sentEmailIds.has(row.email_id);
  return row.kind === "demande" && !row.superseded_by;
}

function attachment(row: Row): CitizenAttachment {
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type ?? null,
    size: typeof row.file_size === "number" ? row.file_size : null,
  };
}

function procedureName(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const name = (snapshot as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

export function serializeCitizenRequest(request: Row, emails: Row[], attachments: Row[]): CitizenRequest {
  const sent = emails
    .filter((e) => e?.status === "envoye" && typeof e.sent_at === "string")
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const sentIds = new Set<string>(sent.map((e) => e.id));
  const visible = attachments.filter((a) => isCitizenVisibleAttachment(a, sentIds));

  return {
    id: request.id,
    reference: request.reference,
    subject: request.subject,
    procedure_name: procedureName(request.procedure_snapshot),
    status: request.status,
    received_at: request.received_at,
    updated_at: request.updated_at,
    closed_at: request.closed_at ?? null,
    // Rédigé pour l'usager, mais seulement une fois la demande close : un
    // brouillon laissé sur une demande rouverte n'est pas une réponse.
    closure_text: request.closed_at ? (request.closure_text ?? null) : null,
    attachments: visible.filter((a) => !a.email_id).map(attachment),
    messages: sent.map((e) => ({
      id: e.id,
      subject: e.subject,
      body: e.body,
      sent_at: e.sent_at,
      attachments: visible.filter((a) => a.email_id === e.id).map(attachment),
    })),
  };
}
