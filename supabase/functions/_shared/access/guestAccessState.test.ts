import { describe, expect, it } from "vitest";
import { ACCESS_AFTER_CLOSURE_MS, type GuestAccessRow, guestAccessState, guestAccessStatus } from "./guestAccessState.ts";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const row = (partial: Partial<GuestAccessRow> = {}): GuestAccessRow => ({
  created_at: "2026-10-01T08:00:00Z",
  last_used_at: null,
  locked_until: null,
  revoked_at: null,
  reissued_at: null,
  ...partial,
});
const iso = (ms: number) => new Date(ms).toISOString();

describe("guestAccessState", () => {
  it("actif par défaut", () => {
    expect(guestAccessState(row(), null, NOW)).toBe("actif");
  });

  it("verrouillé tant que le verrou court, actif ensuite", () => {
    expect(guestAccessState(row({ locked_until: iso(NOW + 60_000) }), null, NOW)).toBe("verrouille");
    expect(guestAccessState(row({ locked_until: iso(NOW - 1) }), null, NOW)).toBe("actif");
  });

  it("expiré plus de 90 jours après la clôture, pas avant", () => {
    expect(guestAccessState(row(), iso(NOW - ACCESS_AFTER_CLOSURE_MS - 1), NOW)).toBe("expire");
    expect(guestAccessState(row(), iso(NOW - ACCESS_AFTER_CLOSURE_MS + 60_000), NOW)).toBe("actif");
  });

  it("la coupure l'emporte sur tout (même expiré ou verrouillé)", () => {
    const cut = row({ revoked_at: iso(NOW - 1000), locked_until: iso(NOW + 60_000) });
    expect(guestAccessState(cut, iso(NOW - ACCESS_AFTER_CLOSURE_MS - 1), NOW)).toBe("coupe");
  });

  it("l'expiration l'emporte sur le verrou", () => {
    expect(guestAccessState(row({ locked_until: iso(NOW + 60_000) }), iso(NOW - ACCESS_AFTER_CLOSURE_MS - 1), NOW)).toBe("expire");
  });
});

describe("guestAccessStatus", () => {
  it("sans accès : exists false, rien d'autre, aucun nouveau code possible", () => {
    expect(guestAccessStatus(null, null, true, { status: "sent", created_at: "x" }, NOW)).toEqual({
      exists: false, state: null, createdAt: null, lastUsedAt: null, lockedUntil: null,
      revokedAt: null, reissuedAt: null, canReissue: false, lastMail: null,
    });
  });

  it("rend dates et dernier envoi ; le verrou n'est rendu que s'il court", () => {
    const status = guestAccessStatus(
      row({ last_used_at: "2026-10-20T10:00:00Z", locked_until: iso(NOW - 1), reissued_at: "2026-10-19T10:00:00Z" }),
      null, true, { status: "pending", created_at: "2026-10-21T11:59:00Z" }, NOW,
    );
    expect(status).toMatchObject({
      exists: true, state: "actif", lastUsedAt: "2026-10-20T10:00:00Z", lockedUntil: null,
      reissuedAt: "2026-10-19T10:00:00Z", canReissue: true, lastMail: { status: "pending", createdAt: "2026-10-21T11:59:00Z" },
    });
    expect(guestAccessStatus(row({ locked_until: iso(NOW + 1000) }), null, true, null, NOW).lockedUntil).toBe(iso(NOW + 1000));
  });

  it("un nouveau code n'est possible qu'avec l'adresse déclarée reconnue, et hors expiration — un accès coupé se rouvre", () => {
    expect(guestAccessStatus(row(), null, false, null, NOW).canReissue).toBe(false);
    expect(guestAccessStatus(row(), iso(NOW - ACCESS_AFTER_CLOSURE_MS - 1), true, null, NOW).canReissue).toBe(false);
    expect(guestAccessStatus(row({ revoked_at: iso(NOW) }), null, true, null, NOW)).toMatchObject({ state: "coupe", canReissue: true });
  });

  it("ne rend jamais d'adresse ni d'empreinte", () => {
    const status = guestAccessStatus({ ...row(), email_hash: "e".repeat(64), code_hash: "c".repeat(64) } as GuestAccessRow, null, true, null, NOW);
    expect(JSON.stringify(status)).not.toMatch(/e{64}|c{64}|hash|email/);
  });
});
