// Courrier de réponse validé dans Clara — logique pure, testée par vitest.
//
// Quand la démarche le demande (Socle `communication_config.replyLetters`,
// contrat 1.46.0) et que la collectivité est abonnée à Clara, l'agent Iris
// rédige le courrier de réponse mais ne l'envoie pas : `submit-reply-to-clara`
// le dépose dans Clara (porte `iris-reply-courier`) comme COURRIER SORTANT lié à
// la demande, qui reste en instruction (« Réponse en validation »). Clara signale
// ensuite l'envoi ou l'abandon par `requests-api`
// (`POST /v1/requests/{id}/reply-letter/events`).
//
// Ce module tient les deux contrats (dépôt sortant, avis entrant) et leurs
// validations — sans Deno, sans réseau.

export const REPLY_SUBJECT_MAX = 300;
export const REPLY_BODY_MAX = 50_000;
export const REPLY_CLOSURE_TEXT_MAX = 5_000;

export const REPLY_OUTCOMES = ["resolue_positive", "resolue_negative"] as const;
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];

/** Canaux du courrier sortant de Clara. */
export const REPLY_CHANNELS = ["email", "paper"] as const;
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];

/** Libellés des sous-états, tels que l'agent les lit. */
export const REPLY_STATE_LABELS = {
  depot_en_cours: "Dépôt dans Clara en cours",
  en_validation: "Réponse en validation",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 1. Ce que l'agent envoie (navigateur → submit-reply-to-clara)
// ---------------------------------------------------------------------------

export interface ReplySubmission {
  requestId: string;
  submissionId: string;
  outcome: ReplyOutcome;
  motif: string | null;
  closureText: string | null;
  subject: string;
  body: string;
  channel: ReplyChannel;
}

const SUBMISSION_KEYS = new Set([
  "request_id", "submission_id", "outcome", "motif", "closure_text", "subject", "body", "channel",
]);

/** Valide le corps envoyé par l'écran. Toute clé inconnue est refusée. */
export function parseReplySubmission(raw: unknown): ReplySubmission | { error: string } {
  if (!isRecord(raw)) return { error: "Corps JSON attendu." };
  const unknown = Object.keys(raw).filter((k) => !SUBMISSION_KEYS.has(k));
  if (unknown.length > 0) return { error: `Champ(s) inconnu(s) : ${unknown.join(", ")}.` };

  const requestId = typeof raw.request_id === "string" ? raw.request_id : "";
  const submissionId = typeof raw.submission_id === "string" ? raw.submission_id : "";
  if (!UUID_RE.test(requestId)) return { error: "request_id : UUID requis." };
  if (!UUID_RE.test(submissionId)) return { error: "submission_id : UUID requis." };

  if (!REPLY_OUTCOMES.includes(raw.outcome as ReplyOutcome)) {
    return { error: "Issue : résolution positive ou négative." };
  }
  if (!REPLY_CHANNELS.includes(raw.channel as ReplyChannel)) {
    return { error: "Canal : courriel ou papier." };
  }

  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!subject) return { error: "L'objet du courrier est obligatoire." };
  if (subject.length > REPLY_SUBJECT_MAX) return { error: `Objet : ${REPLY_SUBJECT_MAX} caractères au plus.` };
  if (!body) return { error: "Le texte du courrier est obligatoire." };
  if (body.length > REPLY_BODY_MAX) return { error: `Courrier : ${REPLY_BODY_MAX} caractères au plus.` };

  const optional = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  const closureText = optional(raw.closure_text);
  if (closureText && closureText.length > REPLY_CLOSURE_TEXT_MAX) {
    return { error: `Texte de clôture : ${REPLY_CLOSURE_TEXT_MAX} caractères au plus.` };
  }

  return {
    requestId,
    submissionId,
    outcome: raw.outcome as ReplyOutcome,
    motif: optional(raw.motif),
    closureText,
    subject,
    body,
    channel: raw.channel as ReplyChannel,
  };
}

/**
 * Canal proposé par défaut : le courriel quand on connaît une adresse au
 * demandeur, le papier sinon. L'agent peut le changer ; Clara tranche au final.
 */
export function defaultReplyChannel(requesterEmail: string | null | undefined): ReplyChannel {
  return requesterEmail && requesterEmail.includes("@") ? "email" : "paper";
}

// ---------------------------------------------------------------------------
// 2. Le dépôt dans Clara (submit-reply-to-clara → iris-reply-courier)
// ---------------------------------------------------------------------------

export interface ClaraReplyPayload {
  submission_id: string;
  socle_organization_id: string;
  socle_contact_id: string;
  channel: ReplyChannel;
  subject: string;
  body_text: string;
  iris_request: { id: string; reference: string; url: string | null };
  submitted_by: { name: string; email: string | null };
}

/** URL de la fiche Iris d'une demande (`https` seulement), ou `null`. */
export function irisRequestUrl(appUrl: string | null | undefined, requestId: string): string | null {
  const base = (appUrl ?? "").replace(/\/+$/, "");
  return /^https:\/\//.test(base) ? `${base}/demandes/${requestId}` : null;
}

export function buildClaraReplyPayload(input: {
  submission: ReplySubmission;
  request: { id: string; reference: string; socle_organization_id: string; socle_contact_id: string };
  appUrl: string | null | undefined;
  agent: { name: string; email: string | null };
}): ClaraReplyPayload {
  return {
    submission_id: input.submission.submissionId,
    socle_organization_id: input.request.socle_organization_id,
    socle_contact_id: input.request.socle_contact_id,
    channel: input.submission.channel,
    subject: input.submission.subject,
    body_text: input.submission.body,
    iris_request: {
      id: input.request.id,
      reference: input.request.reference,
      url: irisRequestUrl(input.appUrl, input.request.id),
    },
    submitted_by: input.agent,
  };
}

export type ClaraReplyOutcome =
  | { kind: "ok"; courierId: string; reference: string | null; url: string | null; duplicate: boolean }
  | { kind: "validation"; message: string | null }
  | { kind: "no_reply_workflow" }
  | { kind: "unauthorized" }
  | { kind: "failed" }
  | { kind: "unexpected" };

/** Lecture de la réponse de Clara. */
export function claraReplyOutcome(status: number, body: unknown): ClaraReplyOutcome {
  const b = isRecord(body) ? body : {};
  if (status === 200 || status === 201) {
    if (b.ok !== true || typeof b.courier_id !== "string" || !UUID_RE.test(b.courier_id)) {
      return { kind: "unexpected" };
    }
    return {
      kind: "ok",
      courierId: b.courier_id,
      reference: typeof b.reference === "string" && b.reference !== "" ? b.reference : null,
      url: typeof b.url === "string" && /^https:\/\//.test(b.url) ? b.url : null,
      duplicate: b.duplicate === true,
    };
  }
  if (status === 422 && b.error === "no_reply_workflow") return { kind: "no_reply_workflow" };
  if (status === 400 || status === 422) {
    return { kind: "validation", message: typeof b.message === "string" ? b.message : null };
  }
  if (status === 401 || status === 403) return { kind: "unauthorized" };
  if (status >= 500) return { kind: "failed" };
  return { kind: "unexpected" };
}

/** Le refus rendu à l'agent. Une clé refusée ne se raconte jamais. */
export function claraReplyFailure(outcome: Exclude<ClaraReplyOutcome, { kind: "ok" }>): {
  status: number;
  code: string;
  message: string;
} {
  switch (outcome.kind) {
    case "validation":
      return {
        status: 422,
        code: "clara_rejected",
        message: outcome.message
          ? `Clara a refusé le courrier : ${outcome.message}`
          : "Clara a refusé le courrier.",
      };
    case "no_reply_workflow":
      return {
        status: 422,
        code: "clara_no_reply_workflow",
        message:
          "Clara n'a pas de circuit de réponse configuré pour cet organisme : demandez à un administrateur de Clara de le régler.",
      };
    case "unauthorized":
      return {
        status: 502,
        code: "clara_unavailable",
        message: "Le dépôt vers Clara est mal configuré — prévenez l'administrateur.",
      };
    case "failed":
    case "unexpected":
    default:
      return {
        status: 502,
        code: "clara_unavailable",
        message: "Clara est injoignable — rien n'a changé, réessayez dans un instant.",
      };
  }
}

// ---------------------------------------------------------------------------
// 3. L'avis de Clara (Clara → requests-api)
// ---------------------------------------------------------------------------

export const REPLY_EVENTS = ["sent", "cancelled"] as const;
export type ReplyEventKind = (typeof REPLY_EVENTS)[number];

export interface ReplyEvent {
  courierId: string;
  event: ReplyEventKind;
  occurredAt: string | null;
}

const EVENT_KEYS = new Set(["courier_id", "event", "occurred_at"]);

/** Valide l'avis de Clara. Toute clé inconnue est refusée (contrat §5). */
export function parseReplyEvent(raw: unknown): ReplyEvent | { error: string } {
  if (!isRecord(raw)) return { error: "Corps JSON attendu." };
  const unknown = Object.keys(raw).filter((k) => !EVENT_KEYS.has(k));
  if (unknown.length > 0) return { error: `Champ(s) inconnu(s) : ${unknown.join(", ")}.` };
  if (typeof raw.courier_id !== "string" || !UUID_RE.test(raw.courier_id)) {
    return { error: "courier_id : UUID requis." };
  }
  if (!REPLY_EVENTS.includes(raw.event as ReplyEventKind)) {
    return { error: "event : sent ou cancelled." };
  }
  let occurredAt: string | null = null;
  if (raw.occurred_at !== undefined && raw.occurred_at !== null) {
    if (typeof raw.occurred_at !== "string" || Number.isNaN(Date.parse(raw.occurred_at))) {
      return { error: "occurred_at : date ISO 8601 attendue." };
    }
    occurredAt = new Date(raw.occurred_at).toISOString();
  }
  return { courierId: raw.courier_id, event: raw.event as ReplyEventKind, occurredAt };
}
