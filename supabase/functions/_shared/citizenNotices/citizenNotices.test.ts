import { describe, expect, it } from "vitest";
import { CITIZEN_EVENTS, CITIZEN_STATUS_LABELS, citizenEventFor } from "./events";
import { DEFAULT_SENT_EVENTS, SKIP_REASONS, shouldSend } from "./decision";
import { citizenChannel, spaceRequestUrl, type ChannelInput } from "./channel";
import { UNSUBSCRIBE_PATH, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STATUSES = ["a_traiter", "en_instruction", "en_attente", "annulee", "resolue_positive", "resolue_negative", "archivee"];

describe("citizenEventFor — toutes les paires de statuts", () => {
  const EXPECTED: Record<string, Record<string, string>> = {
    a_traiter: { en_instruction: "prise_en_charge", en_attente: "attente_information", annulee: "annulation", resolue_positive: "resolution", resolue_negative: "resolution", archivee: "archivage" },
    en_instruction: { a_traiter: "renvoi_qualification", en_attente: "attente_information", annulee: "annulation", resolue_positive: "resolution", resolue_negative: "resolution", archivee: "archivage" },
    en_attente: { a_traiter: "renvoi_qualification", en_instruction: "reprise_instruction", annulee: "annulation", resolue_positive: "resolution", resolue_negative: "resolution", archivee: "archivage" },
    annulee: { a_traiter: "reouverture", en_instruction: "reouverture", en_attente: "attente_information", resolue_positive: "resolution", resolue_negative: "resolution", archivee: "archivage" },
    resolue_positive: { a_traiter: "reouverture", en_instruction: "reouverture", en_attente: "attente_information", annulee: "annulation", resolue_negative: "resolution", archivee: "archivage" },
    resolue_negative: { a_traiter: "reouverture", en_instruction: "reouverture", en_attente: "attente_information", annulee: "annulation", resolue_positive: "resolution", archivee: "archivage" },
    archivee: { a_traiter: "reouverture", en_instruction: "reouverture", en_attente: "attente_information", annulee: "annulation", resolue_positive: "resolution", resolue_negative: "resolution" },
  };

  for (const known of STATUSES) {
    for (const current of STATUSES) {
      const expected = known === current ? "aucun_changement" : EXPECTED[known][current];
      it(`${known} → ${current} : ${expected}`, () => expect(citizenEventFor(known, current)).toBe(expected));
    }
  }

  it("jamais notifiée : on part de « Envoyée »", () => {
    expect(citizenEventFor(null, "en_instruction")).toBe("prise_en_charge");
    expect(citizenEventFor(null, "a_traiter")).toBe("aucun_changement");
  });

  it("chaque statut a un libellé usager", () => {
    for (const s of STATUSES) expect(CITIZEN_STATUS_LABELS[s]).toBeTruthy();
  });
});

describe("shouldSend — défaut V1 (tableau Q4)", () => {
  const decide = (event: (typeof CITIZEN_EVENTS)[number]) => shouldSend({ event, organizationId: "o", socleProcedureId: null });

  it("envoie prise en charge, attente, reprise, annulation, réouverture", () => {
    for (const e of ["prise_en_charge", "attente_information", "reprise_instruction", "annulation", "reouverture"] as const) {
      expect(decide(e)).toEqual({ send: true });
    }
  });

  it("la résolution est couverte par l'avis de clôture ; le retour à l'état connu ne dit rien", () => {
    expect(decide("resolution")).toEqual({ send: false, reason: "couvert_par_avis_cloture" });
    expect(decide("aucun_changement")).toEqual({ send: false, reason: "aucun_changement" });
  });

  it("renvoi à qualifier et archivage : non retenus", () => {
    expect(decide("renvoi_qualification")).toEqual({ send: false, reason: "evenement_non_retenu" });
    expect(decide("archivage")).toEqual({ send: false, reason: "evenement_non_retenu" });
  });

  it("chaque événement a une décision, et elles restent dans le catalogue", () => {
    for (const e of CITIZEN_EVENTS) {
      const d = decide(e);
      if (!d.send) expect(SKIP_REASONS).toContain(d.reason);
      else expect(DEFAULT_SENT_EVENTS.has(e)).toBe(true);
    }
  });

  it("le catalogue des raisons est le jumeau exact de la contrainte SQL", () => {
    const sql = readFileSync(join(import.meta.dirname, "..", "..", "..", "migrations", "20261025110000_notifications_usager_file.sql"), "utf8");
    const block = sql.match(/reason in \(([\s\S]*?)\)\)/)?.[1] ?? "";
    const inSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(inSql).toEqual([...SKIP_REASONS]);
  });
});

describe("citizenChannel (ADR-4)", () => {
  const REQUEST = "11111111-1111-4111-8111-111111111111";
  const hashEmail = async (email: string) => `h:${email}`;
  const base = (over: Partial<ChannelInput> = {}): ChannelInput => ({
    requestId: REQUEST,
    source: "portail-citoyen",
    citizenVisible: true,
    closedAt: null,
    now: new Date("2026-10-25T10:00:00Z"),
    liveEmail: "Alice@Example.org",
    link: { spaceActive: true, channelPrefs: {}, accountEmailHash: "h:alice@example.org", spaceUrl: "https://demarches.sceaux.fr/mes-demandes", requestUrlTemplate: null },
    guest: { emailHash: "h:invite@example.org", trackingUrl: "https://demarches.sceaux.fr/suivi", revokedAt: null, notifyEmail: true, declaredEmail: " Invite@example.org" },
    hashEmail,
    respectPreference: true,
    ...over,
  });

  it("le compte prime, à l'adresse de la fiche du jour", async () => {
    expect(await citizenChannel(base())).toEqual({ ok: true, target: "compte", to: "alice@example.org", url: "https://demarches.sceaux.fr/mes-demandes" });
  });

  it("le gabarit de page de demande, s'il est publié, sert de lien", () => {
    expect(spaceRequestUrl({ spaceActive: true, channelPrefs: null, accountEmailHash: null, spaceUrl: "https://x.fr/a", requestUrlTemplate: "https://x.fr/d/{request_id}" }, REQUEST))
      .toBe(`https://x.fr/d/${REQUEST}`);
  });

  it("fiche à une autre adresse que le compte : l'invité sert, sinon la raison le dit", async () => {
    expect(await citizenChannel(base({ liveEmail: "autre@example.org" }))).toMatchObject({ ok: true, target: "invite", to: "invite@example.org" });
    expect(await citizenChannel(base({ liveEmail: "autre@example.org", guest: null }))).toEqual({ ok: false, reason: "adresse_compte_differente" });
  });

  it("fiche sans adresse et aucun invité : pas d'adresse", async () => {
    expect(await citizenChannel(base({ liveEmail: null, guest: null }))).toEqual({ ok: false, reason: "pas_d_adresse" });
  });

  it("référentiel muet : on réessaiera, on ne compare pas une adresse périmée", async () => {
    expect(await citizenChannel(base({ liveEmail: undefined }))).toEqual({ ok: false, retry: "référentiel injoignable" });
  });

  it("préférence coupée : non envoyé, sans repli sur l'autre canal ; ignorée pour un avis de message", async () => {
    const off = base({ link: { ...base().link!, channelPrefs: { email: false } } });
    expect(await citizenChannel(off)).toEqual({ ok: false, reason: "preference" });
    expect(await citizenChannel({ ...off, respectPreference: false })).toMatchObject({ ok: true, target: "compte" });
    const guestOff = base({ link: null, guest: { ...base().guest!, notifyEmail: false } });
    expect(await citizenChannel(guestOff)).toEqual({ ok: false, reason: "preference" });
  });

  it("invité : coupé, expiré (90 j après la clôture), sans page de suivi ou adresse déclarée altérée ⇒ aucun accès", async () => {
    const g = base().guest!;
    for (const guest of [{ ...g, revokedAt: "2026-10-01T00:00:00Z" }, { ...g, trackingUrl: null }]) {
      expect(await citizenChannel(base({ link: null, guest }))).toEqual({ ok: false, reason: "aucun_acces_en_ligne" });
    }
    expect(await citizenChannel(base({ link: null, closedAt: "2026-07-01T00:00:00Z" }))).toEqual({ ok: false, reason: "aucun_acces_en_ligne" });
    expect(await citizenChannel(base({ link: null, closedAt: "2026-08-01T00:00:00Z" }))).toMatchObject({ ok: true, target: "invite" });
    expect(await citizenChannel(base({ link: null, guest: { ...g, declaredEmail: "autre@example.org" } }))).toEqual({ ok: false, reason: "pas_d_adresse" });
  });

  it("Clara et demande masquée : jamais, quel que soit le canal", async () => {
    expect(await citizenChannel(base({ source: "clara" }))).toEqual({ ok: false, reason: "clara" });
    expect(await citizenChannel(base({ citizenVisible: false }))).toEqual({ ok: false, reason: "masquee" });
  });

  it("espace inactif, ni invité : aucun accès en ligne ; sans poivre : on réessaiera", async () => {
    expect(await citizenChannel(base({ link: { ...base().link!, spaceActive: false }, guest: null }))).toEqual({ ok: false, reason: "aucun_acces_en_ligne" });
    expect(await citizenChannel(base({ hashEmail: null }))).toEqual({ ok: false, retry: "poivre des accès absent" });
  });
});

describe("jeton de désinscription (ADR-12)", () => {
  const SECRET = "s".repeat(48);
  const claims = { requestId: "11111111-1111-4111-8111-111111111111", channel: "email" as const, target: { kind: "invite" as const } };

  it("aller-retour, invité comme compte", async () => {
    expect(await verifyUnsubscribeToken(SECRET, await unsubscribeToken(SECRET, claims))).toEqual(claims);
    const compte = { ...claims, target: { kind: "compte" as const, contactId: "22222222-2222-4222-8222-222222222222" } };
    expect(await verifyUnsubscribeToken(SECRET, await unsubscribeToken(SECRET, compte))).toEqual(compte);
  });

  it("refuse un jeton falsifié, d'un autre secret, tronqué ou étranger", async () => {
    const token = await unsubscribeToken(SECRET, claims);
    const [p, m] = token.split(".");
    const forged = btoa(`v1|${claims.requestId}|email|compte:22222222-2222-4222-8222-222222222222`).replace(/=+$/, "");
    for (const bad of [`${forged}.${m}`, `${p}.${m.slice(0, -2)}AA`, p, `${token}.x`, "", null, 42, "a".repeat(500)]) {
      expect(await verifyUnsubscribeToken(SECRET, bad)).toBeNull();
    }
    expect(await verifyUnsubscribeToken("z".repeat(48), token)).toBeNull();
  });

  it("la page est celle du portail, sur l'origine du lien de l'avis", () => {
    expect(unsubscribeUrl("https://demarches.sceaux.fr/suivi?x=1", "abc.def")).toBe(`https://demarches.sceaux.fr${UNSUBSCRIBE_PATH}?jeton=abc.def`);
    expect(unsubscribeUrl("pas une url", "t")).toBeNull();
  });
});
