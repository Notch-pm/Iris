// Avis à l'usager (B12) — LE canal, par une règle unique (ADR-4). Module PUR, testé.
//
// Partagé par le facteur (avis de statut) et, au lot L4c-3, par
// `send-request-email` (M2). Toutes les entrées sont lues CÔTÉ SERVEUR.
//
// Un avis ne part qu'à une adresse dont le canal VOIT la demande : le canal
// compte ne montre que les messages envoyés à l'adresse DU COMPTE (contrat
// 2.9.0), le canal invité ceux envoyés à l'adresse DÉCLARÉE. D'où :
//   · compte — un espace actif pour la fiche, et l'adresse de la fiche Socle
//     DU JOUR égale (par empreinte) à celle du compte ;
//   · invité — un accès ouvert, non coupé, pas clos depuis plus de 90 jours,
//     une page de suivi connue, et l'adresse déclarée vérifiée contre l'accès.
// Le compte prime. Sans canal, rien ne part, et la raison le dit.

import type { SkipReason } from "./decision.ts";
import { normalizeAccessEmail } from "../access/accessCode.ts";

export const GUEST_ACCESS_DAYS_AFTER_CLOSURE = 90;

export interface SpaceLink {
  spaceActive: boolean;
  /** Préférences par canal, poussées par Nora : `{ email: false }` coupe. Absent = fail open. */
  channelPrefs: Record<string, unknown> | null;
  accountEmailHash: string | null;
  spaceUrl: string | null;
  requestUrlTemplate: string | null;
}

export interface GuestAccess {
  emailHash: string;
  trackingUrl: string | null;
  revokedAt: string | null;
  notifyEmail: boolean | null;
  /** Adresse déclarée au dépôt (snapshot), vérifiée ici contre `emailHash`. */
  declaredEmail: string | null;
}

export interface ChannelInput {
  requestId: string;
  source: string;
  citizenVisible: boolean;
  closedAt: string | null;
  now: Date;
  /** Adresse de la fiche Socle relue : `null` = fiche sans adresse, `undefined` = référentiel muet. */
  liveEmail: string | null | undefined;
  link: SpaceLink | null;
  guest: GuestAccess | null;
  /** Empreinte HMAC d'une adresse NORMALISÉE ; `null` si le poivre manque. */
  hashEmail: ((normalizedEmail: string) => Promise<string>) | null;
  /** Faux pour l'avis de message (M2) : il n'est pas désactivable (décision PO n° 1). */
  respectPreference: boolean;
}

export type ChannelResult =
  | { ok: true; target: "compte" | "invite"; to: string; url: string }
  | { ok: false; reason: SkipReason }
  /** Rien de définitif : le référentiel est muet, ou le poivre manque. On réessaiera. */
  | { ok: false; retry: string };

/** Le lien d'un avis au canal compte : la page de la demande si le portail en publie le gabarit. */
export function spaceRequestUrl(link: SpaceLink, requestId: string): string | null {
  if (link.requestUrlTemplate) return link.requestUrlTemplate.replace("{request_id}", encodeURIComponent(requestId));
  return link.spaceUrl;
}

function guestExpired(closedAt: string | null, now: Date): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  return !Number.isNaN(closed) && now.getTime() - closed > GUEST_ACCESS_DAYS_AFTER_CLOSURE * 86_400_000;
}

export async function citizenChannel(input: ChannelInput): Promise<ChannelResult> {
  if (input.source === "clara") return { ok: false, reason: "clara" };
  if (!input.citizenVisible) return { ok: false, reason: "masquee" };
  if (input.hashEmail === null) return { ok: false, retry: "poivre des accès absent" };
  const hash = input.hashEmail;

  // Ce que le canal compte a vu d'un écart : plus parlant qu'« aucun accès en ligne ».
  let accountReason: SkipReason | null = null;

  const link = input.link;
  if (link?.spaceActive) {
    if (input.liveEmail === undefined) return { ok: false, retry: "référentiel injoignable" };
    const live = normalizeAccessEmail(input.liveEmail);
    const url = spaceRequestUrl(link, input.requestId);
    if (live === null) {
      accountReason = "pas_d_adresse";
    } else if (link.accountEmailHash === null || (await hash(live)) !== link.accountEmailHash) {
      accountReason = "adresse_compte_differente";
    } else if (url !== null) {
      if (input.respectPreference && link.channelPrefs?.email === false) return { ok: false, reason: "preference" };
      return { ok: true, target: "compte", to: live, url };
    }
  }

  const guest = input.guest;
  if (guest && !guest.revokedAt && guest.trackingUrl && !guestExpired(input.closedAt, input.now)) {
    const declared = normalizeAccessEmail(guest.declaredEmail);
    if (declared !== null && (await hash(declared)) === guest.emailHash) {
      if (input.respectPreference && guest.notifyEmail === false) return { ok: false, reason: "preference" };
      return { ok: true, target: "invite", to: declared, url: guest.trackingUrl };
    }
    accountReason ??= "pas_d_adresse";
  }

  return { ok: false, reason: accountReason ?? "aucun_acces_en_ligne" };
}

export type MessageDelivery =
  | { delivery: "espace"; target: "compte" | "invite"; to: string }
  | { delivery: "courriel" };

/**
 * M2 (ADR-10) : le message de l'agent est PUBLIÉ dans l'espace — un avis avec
 * extrait l'annonce — quand l'interrupteur est allumé, qu'un relais existe et
 * qu'un canal valide voit la demande ; sinon il part en entier par courriel,
 * comme avant. La préférence ne compte pas (l'avis de message n'est pas
 * désactivable) : l'appelant passe `respectPreference: false`. Un canal
 * indécidable (référentiel muet) retombe sur le courriel : l'agent attend.
 */
export function messageDelivery(enabled: boolean, hasRelay: boolean, channel: ChannelResult): MessageDelivery {
  if (!enabled || !hasRelay || !channel.ok) return { delivery: "courriel" };
  return { delivery: "espace", target: channel.target, to: channel.to };
}
