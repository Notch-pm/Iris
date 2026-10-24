// Suivi en ligne SANS COMPTE d'une demande, vu par l'agent — logique pure.
//
// Lot L4a (projet Sceaux). Un usager qui a déposé sur le portail sans compte, et
// accepté le suivi en ligne, ouvre sa demande avec courriel + référence + code
// d'accès. L'agent ayant le droit d'INSTRUCTION voit l'état de cet accès, peut
// le couper, ou envoyer un nouveau code à l'adresse déclarée au dépôt.
//
// ⚠️ Ce module ne PROTÈGE rien : l'autorité est l'edge function
// `request-guest-access` (droit d'instruction revérifié en SQL). Ici on ne
// compose que des libellés. L'état lui-même est calculé par le serveur, avec la
// MÊME logique (`@fn/_shared/access/guestAccessState`).

import type { GuestAccessState, GuestAccessStatus } from "@fn/_shared/access/guestAccessState";

export type { GuestAccessState, GuestAccessStatus };

export type GuestAccessAction = "revoke" | "reissue";

export interface GuestAccessView {
  /** État, en une phrase. */
  stateLabel: string;
  /** Teinte de la pastille : actif, à surveiller, fermé. */
  tone: "ok" | "warn" | "off";
  /** Lignes de détail (création, dernière utilisation, dernier envoi). */
  details: string[];
  /** « Couper l'accès » a un sens (accès encore ouvert). */
  canRevoke: boolean;
  /** « Envoyer un nouveau code » est possible. */
  canReissue: boolean;
  /** Pourquoi il ne l'est pas — affiché sous le bouton désactivé. */
  reissueDisabledReason: string | null;
}

/** Le runtime du navigateur peut être n'importe où ; l'agent, lui, vit à Paris. */
const TZ = "Europe/Paris";

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: TZ }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(iso));
}

function formatDayTime(iso: string): string {
  return `${formatDay(iso)} à ${formatTime(iso)}`;
}

const MAIL_STATUS: Record<string, string> = {
  pending: "en cours d'envoi",
  sending: "en cours d'envoi",
  sent: "envoyé",
  failed: "non envoyé (échec du serveur d'envoi)",
  skipped: "abandonné",
};

function stateLabel(status: GuestAccessStatus): string {
  switch (status.state) {
    case "actif":
      return "L'usager peut suivre cette demande en ligne avec son code";
    case "verrouille":
      return status.lockedUntil
        ? `Accès verrouillé jusqu'à ${formatTime(status.lockedUntil)} (trop d'essais)`
        : "Accès verrouillé (trop d'essais)";
    case "coupe":
      return status.revokedAt ? `Accès coupé le ${formatDayTime(status.revokedAt)}` : "Accès coupé";
    case "expire":
      return "Accès expiré (90 jours après la clôture)";
    default:
      return "État inconnu";
  }
}

const TONES: Record<GuestAccessState, GuestAccessView["tone"]> = {
  actif: "ok",
  verrouille: "warn",
  coupe: "off",
  expire: "off",
};

/** La vue de l'état, ou `null` sans accès : l'encart ne s'affiche pas. */
export function guestAccessView(status: GuestAccessStatus | null | undefined): GuestAccessView | null {
  if (!status || !status.exists || status.state === null) return null;
  const details: string[] = [];
  if (status.createdAt) details.push(`Ouvert au dépôt le ${formatDay(status.createdAt)}`);
  details.push(
    status.lastUsedAt ? `Dernière consultation le ${formatDayTime(status.lastUsedAt)}` : "Jamais consulté en ligne",
  );
  if (status.lastMail) {
    details.push(
      `Dernier nouveau code : ${MAIL_STATUS[status.lastMail.status] ?? status.lastMail.status}, ` +
        `le ${formatDayTime(status.lastMail.createdAt)}`,
    );
  }
  let reissueDisabledReason: string | null = null;
  if (!status.canReissue) {
    reissueDisabledReason = status.state === "expire"
      ? "Le suivi en ligne a expiré : aucun nouveau code ne peut être envoyé."
      : "L'adresse déclarée au dépôt n'est plus lisible : aucun code ne peut partir.";
  }
  return {
    stateLabel: stateLabel(status),
    tone: TONES[status.state],
    details,
    canRevoke: status.state === "actif" || status.state === "verrouille",
    canReissue: status.canReissue,
    reissueDisabledReason,
  };
}

export interface GuestAccessDialog {
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  successMessage: string;
}

export const GUEST_ACCESS_DIALOGS: Record<GuestAccessAction, GuestAccessDialog> = {
  revoke: {
    title: "Couper l'accès en ligne de l'usager ?",
    body:
      "L'usager ne pourra plus ouvrir cette demande avec son code ; les sessions ouvertes sont fermées. " +
      "Vous pourrez envoyer un nouveau code.",
    confirmLabel: "Couper l'accès",
    pendingLabel: "Coupure…",
    successMessage: "Accès en ligne coupé",
  },
  reissue: {
    title: "Envoyer un nouveau code d'accès ?",
    body: "Un nouveau code part à l'adresse déclarée au dépôt ; l'ancien ne fonctionnera plus.",
    confirmLabel: "Envoyer le code",
    pendingLabel: "Envoi…",
    successMessage: "Nouveau code en cours d'envoi à l'usager",
  },
};

export const GUEST_ACCESS_LABELS = {
  title: "Suivi en ligne sans compte",
  revoke: "Couper l'accès",
  reissue: "Envoyer un nouveau code",
} as const;

const ERRORS: Record<string, string> = {
  nothing_to_revoke: "L'accès était déjà coupé.",
  no_access: "Cette demande n'a pas de suivi en ligne sans compte.",
  expired: "Le suivi en ligne a expiré (90 jours après la clôture).",
  no_declared_email: "L'adresse déclarée au dépôt n'est plus lisible : aucun code ne peut partir.",
  not_found: "Vous n'avez pas le droit d'instruction sur cette demande.",
};

/** Message d'erreur à afficher, par code serveur ; repli sur le message reçu. */
export function guestAccessErrorMessage(code: string | undefined, fallback: string | undefined): string {
  return (code && ERRORS[code]) || fallback || "L'opération n'a pas abouti — réessayez.";
}
