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
//     avec leurs pièces — l'accusé y figure, son code d'accès masqué. Jamais
//     un AVIS automatique (`nature = 'avis'`, B12) : un avis n'est pas un
//     message de l'espace, il ne fait qu'y renvoyer.

export const CITIZEN_REQUEST_SELECT =
  "id, reference, status, subject, procedure_snapshot, received_at, updated_at, closed_at, closure_text";

// `to_email` sert au filtre « envoyé à l'adresse déclarée » (index.ts) ; il ne sort pas.
export const CITIZEN_EMAIL_SELECT = "id, subject, body, sent_at, status, to_email, nature";

/**
 * Un envoi qui est un MESSAGE de l'espace usager. Un avis automatique (B12,
 * ADR-11) n'en est pas un : l'afficher doublerait chaque message de son avis.
 * Liste blanche : `nature` absente vaut `message` (lignes d'avant la colonne),
 * toute autre valeur est écartée.
 */
export function isCitizenMessageEmail(row: Row): boolean {
  return (row?.nature ?? "message") === "message";
}

export const CITIZEN_ATTACHMENT_SELECT =
  "id, file_name, mime_type, file_size, kind, email_id, citizen_message_id, superseded_by, storage_path, created_at";

/** Les messages de l'usager (L4b, contrat 2.9.0). Le filtre « les siens » se fait dans index.ts. */
export const CITIZEN_OWN_MESSAGE_SELECT = "id, body, created_at, author_kind, socle_contact_id";

export interface CitizenAttachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
}

export interface CitizenMessage {
  id: string;
  /** `agent` : envoyé à l'usager ; `usager` : écrit par lui en ligne (2.9.0). */
  direction: "agent" | "usager";
  /** Objet du courriel ; `null` pour un message de l'usager (il n'en a pas). */
  subject: string | null;
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

/**
 * Une pièce que l'usager peut voir : jamais un document d'instruction interne,
 * jamais sans fichier. Une pièce d'un échange ne se voit qu'avec SON échange :
 * envoyé à son adresse (`email_id`), ou écrit par lui (`citizen_message_id`).
 */
export function isCitizenVisibleAttachment(
  row: Row,
  sentEmailIds: ReadonlySet<string>,
  ownMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  if (!row || typeof row.storage_path !== "string" || row.storage_path === "") return false;
  if (row.kind === "instruction_interne") return false;
  if (row.email_id) return sentEmailIds.has(row.email_id);
  if (row.citizen_message_id) return ownMessageIds.has(row.citizen_message_id);
  return row.kind === "demande" && !row.superseded_by;
}

/**
 * Les messages envoyés à l'adresse DÉCLARÉE au dépôt, et à elle seule.
 * `hashEmail` rend l'empreinte d'une adresse (`null` si illisible) ; on la
 * compare à celle de l'accès. Une demande rattachée à la fiche d'une autre
 * personne lui écrit à SON adresse : ces messages ne sortent pas.
 */
export async function ownEmails(
  emails: Row[],
  declaredHash: string,
  hashEmail: (email: unknown) => Promise<string | null>,
): Promise<Row[]> {
  const own: Row[] = [];
  for (const email of emails) {
    if ((await hashEmail(email?.to_email)) === declaredHash) own.push(email);
  }
  return own;
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

export function serializeCitizenRequest(
  request: Row,
  emails: Row[],
  attachments: Row[],
  ownMessages: Row[] = [],
): CitizenRequest {
  const sent = emails
    .filter((e) => isCitizenMessageEmail(e) && e?.status === "envoye" && typeof e.sent_at === "string")
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const sentIds = new Set<string>(sent.map((e) => e.id));
  const own = ownMessages.filter((m) => typeof m?.id === "string" && typeof m.created_at === "string");
  const ownIds = new Set<string>(own.map((m) => m.id));
  const visible = attachments.filter((a) => isCitizenVisibleAttachment(a, sentIds, ownIds));
  const messages: CitizenMessage[] = [
    ...sent.map((e) => ({
      id: e.id,
      direction: "agent" as const,
      subject: e.subject,
      body: e.body,
      sent_at: e.sent_at,
      attachments: visible.filter((a) => a.email_id === e.id).map(attachment),
    })),
    ...own.map((m) => ({
      id: m.id,
      direction: "usager" as const,
      subject: null,
      body: m.body,
      sent_at: m.created_at,
      attachments: visible.filter((a) => a.citizen_message_id === m.id).map(attachment),
    })),
  ].sort((a, b) => a.sent_at.localeCompare(b.sent_at));

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
    attachments: visible.filter((a) => !a.email_id && !a.citizen_message_id).map(attachment),
    messages,
  };
}

// ---- « Mes demandes » : la liste d'une fiche (contrat 2.7.0) ---------------

export const CITIZEN_LIST_SELECT =
  "id, reference, status, subject, procedure_snapshot, received_at, updated_at, closed_at";

export interface CitizenRequestSummary {
  id: string;
  reference: string;
  subject: string;
  procedure_name: string | null;
  status: string;
  received_at: string;
  updated_at: string;
  closed_at: string | null;
}

/** Une ligne de « Mes demandes » — encore moins que la vue d'une demande. */
export function serializeCitizenRequestSummary(row: Row): CitizenRequestSummary {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    procedure_name: procedureName(row.procedure_snapshot),
    status: row.status,
    received_at: row.received_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at ?? null,
  };
}
