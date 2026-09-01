// Logique de présentation des notifications — pure, sans DOM ni réseau.
//
// Le serveur ne stocke qu'un `kind` et un `payload` INSTANTANÉ (référence,
// objet, acteur, statuts au moment du geste). Toute la mise en français vit
// ici : la base ne fabrique aucune phrase, et une notification ancienne reste
// lisible même si les libellés changent.

import { PRIORITY_LABELS, STATUS_LABELS } from "@/features/requests/statuts";

export type NotificationKind =
  | "assigned"
  | "unassigned"
  | "status_changed"
  | "note_added"
  | "mentioned"
  | "new_request_in_scope"
  | "transferred_in";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "assigned", "unassigned", "status_changed", "note_added", "mentioned",
  "new_request_in_scope", "transferred_in",
];

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as string[]).includes(value);
}

/** Ce que le trigger fige dans `payload`. Tout est optionnel par prudence : une
 *  notification produite par une version antérieure doit rester affichable. */
export interface NotificationPayload {
  reference?: string | null;
  subject?: string | null;
  actor_name?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  motif?: string | null;
  source?: string | null;
  procedure?: string | null;
  destinataire?: string | null;
  reassigned?: boolean | null;
  /** Transfert : l'organisme QUITTÉ (`destinataire` porte celui d'arrivée). */
  from_destinataire?: string | null;
  /** Transfert : date de dépôt de la demande, figée au moment du geste. */
  received_at?: string | null;
}

export interface NotificationItem {
  id: string;
  kind: string;
  requestId: string;
  createdAt: string;
  readAt: string | null;
  payload: NotificationPayload;
}

/** `payload` arrive en `Json` : on le réduit à un objet plat, jamais à null. */
export function readPayload(value: unknown): NotificationPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as NotificationPayload;
}

const KIND_TITLES: Record<NotificationKind, string> = {
  assigned: "Demande affectée",
  unassigned: "Affectation retirée",
  status_changed: "Changement de statut",
  note_added: "Nouvelle note interne",
  mentioned: "Vous êtes mentionné",
  new_request_in_scope: "Nouvelle demande",
  transferred_in: "Demande transférée",
};

export function notificationTitle(kind: string): string {
  return isNotificationKind(kind) ? KIND_TITLES[kind] : "Notification";
}

function statusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
}

/** L'auteur du geste, ou « le système » quand la demande vient d'une
 *  intégration (ingestion Clara, API partenaire) : le payload n'a pas d'acteur. */
function actor(p: NotificationPayload): string {
  const name = p.actor_name?.trim();
  return name && name.length > 0 ? name : "Le système";
}

/**
 * Phrase affichée sous le titre. Jamais le corps d'une note interne : le
 * serveur ne le transmet pas (invariant), on annonce seulement l'événement.
 */
export function notificationMessage(kind: string, payload: NotificationPayload): string {
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
      // Jamais d'extrait de la note : elle ne quitte pas Iris, même ici.
      return `${who} vous a mentionné dans une note interne.`;
    case "new_request_in_scope": {
      const quoi = payload.procedure?.trim();
      const ou = payload.destinataire?.trim();
      const detail = [quoi, ou].filter(Boolean).join(" — ");
      return detail
        ? `Nouvelle demande dans votre périmètre : ${detail}.`
        : "Nouvelle demande dans votre périmètre.";
    }
    case "transferred_in": {
      const de = payload.from_destinataire?.trim();
      return de
        ? `${who} vous a transféré cette demande depuis ${de}.`
        : `${who} vous a transféré cette demande.`;
    }
    default:
      return "Cette demande a évolué.";
  }
}

/** Titre de la demande concernée : « ACCM-2026-0042 · Nid-de-poule… ». */
export function notificationSubtitle(payload: NotificationPayload): string {
  return [payload.reference, payload.subject].filter(Boolean).join(" · ");
}

export function unreadCount(items: NotificationItem[]): number {
  return items.filter((n) => n.readAt === null).length;
}

/** Pastille du rail : au-delà du seuil, on ne compte plus, on dit « 9+ ». */
export function badgeLabel(count: number, max = 9): string {
  if (count <= 0) return "";
  return count > max ? `${max}+` : String(count);
}

// ---------------------------------------------------------------------------
// Âge relatif — « à l'instant », « il y a 5 min », « hier », puis la date.
// `now` est injecté : la fonction reste pure et testable.
// ---------------------------------------------------------------------------

export function relativeAge(iso: string, now: Date): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  return then.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Regroupement du volet par tranche de date (motif des listes Clara).
// ---------------------------------------------------------------------------

export type NotificationGroupKey = "today" | "yesterday" | "week" | "older";

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroupKey, string> = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  week: "Cette semaine",
  older: "Plus ancien",
};

export interface NotificationGroup {
  key: NotificationGroupKey;
  label: string;
  items: NotificationItem[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function groupKeyFor(iso: string, now: Date): NotificationGroupKey {
  const today = startOfDay(now);
  const day = startOfDay(new Date(iso));
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "older";
}

/**
 * Groupes NON VIDES uniquement, dans l'ordre du plus récent au plus ancien.
 * L'ordre des éléments à l'intérieur d'un groupe est celui reçu (le serveur
 * trie déjà par `created_at desc`).
 */
export function groupNotifications(items: NotificationItem[], now: Date): NotificationGroup[] {
  const order: NotificationGroupKey[] = ["today", "yesterday", "week", "older"];
  const buckets = new Map<NotificationGroupKey, NotificationItem[]>();
  for (const item of items) {
    const key = groupKeyFor(item.createdAt, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({ key, label: NOTIFICATION_GROUP_LABELS[key], items: buckets.get(key)! }));
}

/** Priorité éventuellement portée par le payload — réexport de confort pour
 *  que le volet n'ait pas à connaître le module `statuts`. */
export function priorityLabel(value: string | null | undefined): string {
  if (!value) return "";
  return PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] ?? value;
}
