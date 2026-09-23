// Fil d'une demande — `GET /v1/requests/{id}/timeline` (contrat 2.5.0).
//
// Route RÉSERVÉE au scope `requests:read_tenant` (applications de la gamme :
// Clara, pour la fiche usager et l'espace élu). Elle sert ce que la liste
// blanche publique (`serializers.ts`) ne sert jamais : le texte de la demande,
// l'activité, les NOTES INTERNES et les interventions. Un partenaire ou le
// portail n'y accède pas (403), et rien n'y est public.
//
// Même discipline que `serializeRequest` : chaque champ sortant est nommé ici.
// Les charges utiles des événements sont réduites à des détails d'affichage
// par type (jamais un payload brut), et les identifiants d'agents sont
// remplacés par des noms — jamais d'e-mail, jamais d'UUID d'utilisateur.

import { type SerializedRequest, serializeRequest } from "./serializers.ts";

/** Colonnes lues pour les notes : le filtre `kind` se fait aussi en requête. */
export const TIMELINE_NOTE_KIND = "note_interne";

export interface TimelineEvent {
  type: string;
  at: string;
  by: string | null;
  /** Détails d'affichage, par type (voir `eventDetail`). */
  detail: Record<string, string | number | null>;
}

export interface TimelineNote {
  body: string;
  at: string;
  by: string | null;
}

export interface TimelineIntervention {
  status: string;
  intervenant: string | null;
  requested_at: string | null;
  requested_for: string | null;
  request_comment: string | null;
  completed_on: string | null;
  completion_comment: string | null;
}

export interface RequestTimeline {
  request: SerializedRequest & { body: string | null };
  events: TimelineEvent[];
  notes: TimelineNote[];
  interventions: TimelineIntervention[];
}

type UserNames = Map<string, string>;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Nom affichable d'un utilisateur Iris — jamais son e-mail ni son id. */
export function userDisplayName(user: { first_name?: string | null; last_name?: string | null }): string | null {
  const name = [user.first_name, user.last_name].filter((p) => !!p && p.trim()).join(" ").trim();
  return name || null;
}

/**
 * Détail d'un événement, par type — liste blanche. Un type inconnu sort sans
 * détail : il reste daté et nommé, sans rien laisser passer de son payload.
 */
export function eventDetail(type: string, payload: Row | null, names: UserNames): TimelineEvent["detail"] {
  const p = payload ?? {};
  switch (type) {
    case "created":
      return { source: str(p.source) };
    case "status_changed":
      return { from: str(p.from), to: str(p.to), motif: str(p.motif) };
    case "assigned":
      return { to: names.get(p.to) ?? null };
    case "transferred":
      return { from: str(p.from_label), to: str(p.to_label) };
    case "intervention_requested":
      return { intervenant: str(p.intervenant_name) ?? names.get(p.intervenant) ?? null, requested_for: str(p.requested_for) };
    case "intervention_completed":
      return { intervenant: str(p.intervenant_name) ?? names.get(p.intervenant) ?? null, completed_on: str(p.completed_on) };
    case "piece_ajoutee":
      return { file_name: str(p.file_name) };
    case "piece_qualifiee":
      return { file_name: str(p.file_name), compliance: str(p.compliance) };
    case "form_data_updated":
      return { count: typeof p.count === "number" ? p.count : null };
    default:
      return {};
  }
}

export function serializeTimeline(input: {
  request: Row;
  events: Row[];
  notes: Row[];
  interventions: Row[];
  names: UserNames;
  appUrl: string | null;
}): RequestTimeline {
  const { names } = input;
  const by = (id: unknown) => (typeof id === "string" ? names.get(id) ?? null : null);
  return {
    request: { ...serializeRequest(input.request, input.appUrl), body: str(input.request.body) },
    events: input.events.map((e) => ({
      type: String(e.event_type),
      at: e.created_at,
      by: by(e.created_by),
      detail: eventDetail(String(e.event_type), e.payload, names),
    })),
    notes: input.notes
      .filter((m) => m.kind === TIMELINE_NOTE_KIND)
      .map((m) => ({ body: String(m.body ?? ""), at: m.created_at, by: by(m.author_id) })),
    interventions: input.interventions.map((i) => ({
      status: String(i.status),
      intervenant: by(i.intervenant_id),
      requested_at: i.requested_at ?? null,
      requested_for: i.requested_for ?? null,
      request_comment: str(i.request_comment),
      completed_on: i.completed_on ?? null,
      completion_comment: str(i.completion_comment),
    })),
  };
}

/** Tous les identifiants d'utilisateurs à nommer dans un fil. */
export function timelineUserIds(events: Row[], notes: Row[], interventions: Row[]): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) ids.add(v);
  };
  for (const e of events) {
    add(e.created_by);
    if (e.event_type === "assigned") add(e.payload?.to);
    if (String(e.event_type).startsWith("intervention_")) add(e.payload?.intervenant);
  }
  for (const m of notes) add(m.author_id);
  for (const i of interventions) add(i.intervenant_id);
  return [...ids];
}
