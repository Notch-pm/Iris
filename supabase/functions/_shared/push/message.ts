// Composition d'une notification PUSH — module PUR (aucune dépendance Deno,
// aucun réseau), testé par vitest.
//
// ⚠️ CE QUI SORT D'IRIS, version la plus stricte. Un push s'affiche sur un
// écran VERROUILLÉ, lisible par qui tient le téléphone. On y met donc encore
// moins que dans l'e-mail (`../email/notifications.ts`) :
//
//   ✅ le motif, la référence, l'objet de la demande, l'auteur du geste,
//      le statut, l'organisme ; le permalien de la fiche (RLS à l'ouverture).
//   ❌ le CORPS des notes internes (invariant absolu), l'identité de l'usager,
//      le `comment` d'une intervention (consigne écrite pour l'e-mail, pas
//      pour un écran verrouillé), la description, les pièces.
//
// Le texte est court : un titre (motif · référence) et une phrase.

import {
  type NotificationPayload,
  requestPermalink,
  statusLabel,
} from "../email/notifications.ts";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Regroupement côté appareil : une carte par demande, la plus récente remplace. */
  tag: string;
}

export interface PushMessageInput {
  kind: string;
  payload: NotificationPayload | null | undefined;
  requestId: string;
  /** Origine de l'app (`IRIS_APP_URL`). */
  appUrl: string;
}

/** Titres alignés sur `KIND_TITLES` du front (`src/features/notifications/notifications.ts`). */
export const PUSH_TITLES: Record<string, string> = {
  assigned: "Demande affectée",
  unassigned: "Demande retirée",
  status_changed: "Statut modifié",
  note_added: "Note interne ajoutée",
  mentioned: "Vous êtes mentionné",
  new_request_in_scope: "Nouvelle demande",
  transferred_in: "Demande transférée",
  intervention_requested: "Intervention demandée",
  intervention_completed: "Intervention réalisée",
};

/** Longueur maximale du corps : au-delà, les systèmes tronquent eux-mêmes, mal. */
export const PUSH_BODY_MAX = 140;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function actor(payload: NotificationPayload): string {
  const name = text(payload.actor_name);
  if (name) return name;
  const source = text(payload.source);
  return source && source !== "iris" ? `L'intégration ${source}` : "Le système";
}

/** « 12/03/2026 » depuis `AAAA-MM-JJ`, sans `Date` (aucun décalage de fuseau). */
function dayLabel(value: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** La phrase du geste — jamais un extrait de note, jamais un commentaire. */
export function pushSentence(kind: string, payload: NotificationPayload): string {
  const who = actor(payload);
  switch (kind) {
    case "assigned":
      return `${who} vous a affecté cette demande (${statusLabel(payload.status)}).`;
    case "unassigned":
      return payload.reassigned
        ? `${who} a confié cette demande à quelqu'un d'autre.`
        : `${who} vous a retiré cette demande.`;
    case "status_changed":
      return `${who} a fait passer la demande de « ${statusLabel(payload.from)} » à « ${statusLabel(payload.to)} ».`;
    case "note_added":
      return `${who} a ajouté une note interne.`;
    case "mentioned":
      return `${who} vous a mentionné dans une note interne.`;
    case "new_request_in_scope": {
      const detail = [text(payload.procedure), text(payload.destinataire)].filter(Boolean).join(" — ");
      return detail
        ? `Nouvelle demande dans votre périmètre : ${detail}.`
        : "Nouvelle demande dans votre périmètre.";
    }
    case "transferred_in": {
      const from = text(payload.from_destinataire);
      return from
        ? `${who} vous a transféré cette demande depuis ${from}.`
        : `${who} vous a transféré cette demande.`;
    }
    case "intervention_requested": {
      const day = dayLabel(payload.requested_for);
      return day
        ? `${who} vous sollicite pour une intervention, souhaitée le ${day}.`
        : `${who} vous sollicite pour une intervention.`;
    }
    case "intervention_completed": {
      const name = text(payload.intervenant_name) || who;
      const day = dayLabel(payload.completed_on);
      return day
        ? `${name} a déclaré l'intervention réalisée le ${day}.`
        : `${name} a déclaré l'intervention réalisée.`;
    }
    default:
      return "Cette demande a évolué.";
  }
}

/** Tronque proprement sur un espace, avec une ellipse. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function pushMessage(input: PushMessageInput): PushMessage {
  const payload = input.payload ?? {};
  const head = PUSH_TITLES[input.kind] ?? "Notification";
  const reference = text(payload.reference);
  const subject = text(payload.subject);
  const sentence = pushSentence(input.kind, payload);
  return {
    title: reference ? `${head} · ${reference}` : head,
    body: truncate(subject ? `${sentence} — ${subject}` : sentence, PUSH_BODY_MAX),
    url: requestPermalink(input.appUrl, input.requestId),
    tag: `iris:${input.requestId}`,
  };
}
