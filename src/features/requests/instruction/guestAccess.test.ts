import { describe, expect, it } from "vitest";
import {
  GUEST_ACCESS_DIALOGS,
  guestAccessErrorMessage,
  guestAccessView,
  type GuestAccessStatus,
} from "./guestAccess";

const base: GuestAccessStatus = {
  exists: true,
  state: "actif",
  createdAt: "2026-10-20T09:00:00Z",
  lastUsedAt: null,
  lockedUntil: null,
  revokedAt: null,
  reissuedAt: null,
  canReissue: true,
  lastMail: null,
};

describe("guestAccessView", () => {
  it("aucun accès : pas d'encart", () => {
    expect(guestAccessView(null)).toBeNull();
    expect(guestAccessView({ ...base, exists: false, state: null })).toBeNull();
  });

  it("actif : coupure et nouveau code possibles, jamais consulté", () => {
    const view = guestAccessView(base)!;
    expect(view.tone).toBe("ok");
    expect(view.stateLabel).toBe("L'usager peut suivre cette demande en ligne avec son code");
    expect(view.details).toEqual(["Ouvert au dépôt le 20 octobre 2026", "Jamais consulté en ligne"]);
    expect(view.canRevoke).toBe(true);
    expect(view.canReissue).toBe(true);
    expect(view.reissueDisabledReason).toBeNull();
  });

  it("verrouillé : l'heure de fin, à Paris", () => {
    const view = guestAccessView({ ...base, state: "verrouille", lockedUntil: "2026-10-20T13:05:00Z" })!;
    expect(view.tone).toBe("warn");
    expect(view.stateLabel).toBe("Accès verrouillé jusqu'à 15:05 (trop d'essais)");
    expect(view.canRevoke).toBe(true);
  });

  it("coupé : la date, plus de coupure, un nouveau code rouvre", () => {
    const view = guestAccessView({ ...base, state: "coupe", revokedAt: "2026-10-21T08:30:00Z" })!;
    expect(view.tone).toBe("off");
    expect(view.stateLabel).toBe("Accès coupé le 21 octobre 2026 à 10:30");
    expect(view.canRevoke).toBe(false);
    expect(view.canReissue).toBe(true);
  });

  it("expiré : ni coupure ni nouveau code, avec la raison", () => {
    const view = guestAccessView({ ...base, state: "expire", canReissue: false })!;
    expect(view.canRevoke).toBe(false);
    expect(view.canReissue).toBe(false);
    expect(view.reissueDisabledReason).toMatch(/expiré/);
  });

  it("adresse déclarée illisible : nouveau code impossible, avec la raison", () => {
    const view = guestAccessView({ ...base, canReissue: false })!;
    expect(view.canReissue).toBe(false);
    expect(view.reissueDisabledReason).toMatch(/adresse déclarée/);
  });

  it("dernière consultation et dernier envoi d'un nouveau code", () => {
    const view = guestAccessView({
      ...base,
      lastUsedAt: "2026-10-20T10:00:00Z",
      lastMail: { status: "failed", createdAt: "2026-10-21T07:00:00Z" },
    })!;
    expect(view.details).toContain("Dernière consultation le 20 octobre 2026 à 12:00");
    expect(view.details).toContain("Dernier nouveau code : non envoyé (échec du serveur d'envoi), le 21 octobre 2026 à 09:00");
  });
});

describe("dialogues et erreurs", () => {
  it("les dialogues disent ce qui arrive à l'usager", () => {
    expect(GUEST_ACCESS_DIALOGS.revoke.body).toContain("les sessions ouvertes sont fermées");
    expect(GUEST_ACCESS_DIALOGS.reissue.body).toContain("l'ancien ne fonctionnera plus");
  });

  it("un code serveur connu donne un message français ; sinon le message reçu", () => {
    expect(guestAccessErrorMessage("nothing_to_revoke", "x")).toBe("L'accès était déjà coupé.");
    expect(guestAccessErrorMessage("reissue_failed", "Le nouveau code n'a pas pu être créé — réessayez."))
      .toBe("Le nouveau code n'a pas pu être créé — réessayez.");
    expect(guestAccessErrorMessage(undefined, undefined)).toBe("L'opération n'a pas abouti — réessayez.");
  });
});
