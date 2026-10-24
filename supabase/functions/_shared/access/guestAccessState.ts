// L'état de l'accès invité d'une demande, tel que l'agent le lit — LOGIQUE
// PURE, testée, partagée entre l'edge function `request-guest-access` et
// l'écran (`src/features/requests/instruction/guestAccess.ts`).
//
// Lot L4a (projet Sceaux) : l'agent voit si l'usager peut suivre sa demande en
// ligne, et peut couper cet accès ou envoyer un nouveau code. Jamais l'adresse,
// jamais une empreinte : ce qui sort est un état et des dates.

/** Après la clôture, l'accès vaut encore ce temps (migration 20261019150000). */
export const ACCESS_AFTER_CLOSURE_MS = 90 * 24 * 60 * 60 * 1000;

export type GuestAccessState = "actif" | "verrouille" | "coupe" | "expire";

export interface GuestAccessRow {
  created_at: string;
  last_used_at: string | null;
  locked_until: string | null;
  revoked_at: string | null;
  reissued_at: string | null;
}

export interface GuestAccessStatus {
  /** Aucun accès : dépôt sans « suivre ma demande en ligne », ou hors portail. */
  exists: boolean;
  state: GuestAccessState | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  lockedUntil: string | null;
  revokedAt: string | null;
  reissuedAt: string | null;
  /**
   * Un nouveau code peut partir : l'adresse déclarée au dépôt est connue (et
   * c'est bien celle de l'accès), et l'accès n'a pas expiré.
   */
  canReissue: boolean;
  /** Dernier envoi d'un nouveau code : où il en est. */
  lastMail: { status: string; createdAt: string } | null;
}

export function guestAccessState(row: GuestAccessRow, closedAt: string | null, now: number): GuestAccessState {
  if (row.revoked_at !== null) return "coupe";
  if (closedAt !== null && now - Date.parse(closedAt) > ACCESS_AFTER_CLOSURE_MS) return "expire";
  if (row.locked_until !== null && Date.parse(row.locked_until) > now) return "verrouille";
  return "actif";
}

export function guestAccessStatus(
  row: GuestAccessRow | null,
  closedAt: string | null,
  declaredMatches: boolean,
  lastMail: { status: string; created_at: string } | null,
  now: number,
): GuestAccessStatus {
  if (row === null) {
    return {
      exists: false, state: null, createdAt: null, lastUsedAt: null, lockedUntil: null,
      revokedAt: null, reissuedAt: null, canReissue: false, lastMail: null,
    };
  }
  const state = guestAccessState(row, closedAt, now);
  return {
    exists: true,
    state,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lockedUntil: state === "verrouille" ? row.locked_until : null,
    revokedAt: row.revoked_at,
    reissuedAt: row.reissued_at,
    canReissue: declaredMatches && state !== "expire",
    lastMail: lastMail === null ? null : { status: lastMail.status, createdAt: lastMail.created_at },
  };
}
