/**
 * Contrat 2.10.0 (B12, lot L4c-2) — ce que le portail pousse pour les avis à
 * l'usager. `requests-api/index.ts` exécuté pour de bon sur PGlite (voir
 * `harness/`) :
 *   · `PUT /v1/citizen/space` — l'adresse de l'espace, par collectivité ;
 *   · `PUT|DELETE /v1/citizen/contacts/{id}/notification-preferences` — la copie
 *     d'un compte, empreinte de l'adresse prise du JETON, jamais du corps ;
 *   · `PUT /v1/citizen/requests/{id}/notification-preferences` — l'invité ;
 *   · `POST /v1/citizen/notifications/unsubscribe` — le lien d'un avis ;
 *   · `notifications` dans la vue invitée.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANTONY_ROOT, IrisWorld, PEPPER, TOKEN_SECRET } from "./harness/irisWorld.ts";
import { accessEmailHash } from "../../_shared/access/accessCode.ts";
import { unsubscribeToken } from "../../_shared/citizenNotices/unsubscribe.ts";

const ALICE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BOB = "bbbbbbbb-0000-4000-8000-0000000000b1";

let world: IrisWorld;
beforeEach(async () => {
  world = await IrisWorld.create();
});
afterEach(async () => {
  await world.close();
});

const asContact = (id: string, email: string | null = "alice@example.org") => world.token({ kind: "contact", id, email });
const asGuest = (id: string) => world.token({ kind: "request", id });
const q = async (sql: string, params: unknown[] = []) => (await world.db.query<Record<string, unknown>>(sql, params)).rows;
const link = async (contactId: string) =>
  (await q("select space_active, channel_prefs, account_email_hash, integration_source_id from citizen_space_links where socle_contact_id = $1", [contactId]))[0];
const notify = async (requestId: string) =>
  (await q("select notify_email from request_access_codes where request_id = $1", [requestId]))[0]?.notify_email;

describe("PUT /v1/citizen/space", () => {
  it("enregistre l'adresse de l'espace sur la source de la collectivité", async () => {
    const reply = await world.call("PUT", "/v1/citizen/space", {
      json: { space_url: "https://demarches.sceaux.fr/mes-demandes", request_url_template: "https://demarches.sceaux.fr/mes-demandes/{request_id}" },
    });
    expect(reply.status).toBe(200);
    const [row] = await q("select citizen_space_url, citizen_request_url_template from integration_sources where organization_id = $1", [world.sceaux.orgId]);
    expect(row).toEqual({
      citizen_space_url: "https://demarches.sceaux.fr/mes-demandes",
      citizen_request_url_template: "https://demarches.sceaux.fr/mes-demandes/{request_id}",
    });
  });

  it("refuse http, une autre origine, un gabarit sans {request_id}, un champ inconnu", async () => {
    for (const json of [
      { space_url: "http://demarches.sceaux.fr" },
      { space_url: "https://demarches.sceaux.fr", request_url_template: "https://ailleurs.fr/{request_id}" },
      { space_url: "https://demarches.sceaux.fr", request_url_template: "https://demarches.sceaux.fr/d" },
      { space_url: "https://demarches.sceaux.fr", couleur: "bleu" },
    ]) {
      expect((await world.call("PUT", "/v1/citizen/space", { json })).status, JSON.stringify(json)).toBe(400);
    }
  });
});

describe("préférences d'un compte", () => {
  const path = `/v1/citizen/contacts/${ALICE}/notification-preferences`;

  it("l'empreinte vient du jeton (e), pas du corps ; idempotent ; la source est celle de la clé", async () => {
    const token = await asContact(ALICE, "Alice@Example.org");
    const reply = await world.call("PUT", path, { token, json: { channels: { email: false } } });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ channels: { email: false }, space_active: true });
    const row = await link(ALICE);
    expect(row.account_email_hash).toBe(await accessEmailHash(PEPPER, "alice@example.org"));
    expect(row.channel_prefs).toEqual({ email: false });
    const [source] = await q("select id from integration_sources where organization_id = $1", [world.sceaux.orgId]);
    expect(row.integration_source_id).toBe(source.id);

    expect((await world.call("PUT", path, { token, json: { channels: { email: true } } })).status).toBe(200);
    expect((await q("select count(*)::int as n from citizen_space_links"))[0].n).toBe(1);
    expect((await link(ALICE)).channel_prefs).toEqual({ email: true });
  });

  it("une adresse glissée dans le corps est refusée, comme un canal inconnu", async () => {
    const token = await asContact(ALICE);
    for (const json of [{ channels: { email: true }, email: "pirate@example.org" }, { channels: { email: true, sms: true } }, { channels: { email: "oui" } }]) {
      expect((await world.call("PUT", path, { token, json })).status, JSON.stringify(json)).toBe(400);
    }
    expect(await link(ALICE)).toBeUndefined();
  });

  it("jeton absent, d'une autre fiche, invité ou sans adresse : refusé", async () => {
    const json = { channels: { email: true } };
    expect((await world.call("PUT", path, { json })).status).toBe(404);
    expect((await world.call("PUT", path, { json, token: await asContact(BOB) })).status).toBe(404);
    const r = await world.addRequest(world.sceaux);
    expect((await world.call("PUT", path, { json, token: await asGuest(r.id) })).status).toBe(404);
    expect((await world.call("PUT", path, { json, token: await asContact(ALICE, null) })).status).toBe(400);
    expect(await link(ALICE)).toBeUndefined();
  });

  it("DELETE ferme l'espace sans effacer la copie", async () => {
    const token = await asContact(ALICE);
    await world.call("PUT", path, { token, json: { channels: { email: true } } });
    const reply = await world.call("DELETE", path, { token });
    expect(reply.status).toBe(200);
    expect((await link(ALICE)).space_active).toBe(false);
  });
});

describe("préférence d'un invité", () => {
  it("vaut pour CETTE demande, se lit dans la vue invitée", async () => {
    const r = await world.addRequest(world.sceaux);
    const other = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r.id, world.sceaux, "invite@example.org");
    await world.openGuestAccess(other.id, world.sceaux, "invite@example.org");
    const token = await asGuest(r.id);
    expect((await world.call("GET", `/v1/citizen/requests/${r.id}`, { token })).body.notifications).toEqual({ email: true });

    const reply = await world.call("PUT", `/v1/citizen/requests/${r.id}/notification-preferences`, { token, json: { channels: { email: false } } });
    expect(reply.status).toBe(200);
    expect(await notify(r.id)).toBe(false);
    expect(await notify(other.id)).toBe(true);
    expect((await world.call("GET", `/v1/citizen/requests/${r.id}`, { token })).body.notifications).toEqual({ email: false });
  });

  it("un compte ne lit pas de préférence d'invité dans sa vue", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const view = await world.call("GET", `/v1/citizen/requests/${r.id}`, { token: await asContact(ALICE) });
    expect(view.status).toBe(200);
    expect(view.body.notifications).toBeUndefined();
  });

  it("jeton d'une autre demande, accès coupé : 404", async () => {
    const r = await world.addRequest(world.sceaux);
    const other = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r.id, world.sceaux, "invite@example.org");
    const json = { channels: { email: false } };
    expect((await world.call("PUT", `/v1/citizen/requests/${r.id}/notification-preferences`, { json, token: await asGuest(other.id) })).status).toBe(404);
    await q("update request_access_codes set revoked_at = now() where request_id = $1", [r.id]);
    expect((await world.call("PUT", `/v1/citizen/requests/${r.id}/notification-preferences`, { json, token: await asGuest(r.id) })).status).toBe(404);
    expect(await notify(r.id)).toBe(true);
  });
});

describe("POST /v1/citizen/notifications/unsubscribe", () => {
  const path = "/v1/citizen/notifications/unsubscribe";

  it("invité : coupe les avis de cette demande seule", async () => {
    const r = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r.id, world.sceaux, "invite@example.org");
    const token = await unsubscribeToken(TOKEN_SECRET, { requestId: r.id, channel: "email", target: { kind: "invite" } });
    const reply = await world.call("POST", path, { json: { token } });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ kind: "invite", request_id: r.id, reference: r.reference });
    expect(await notify(r.id)).toBe(false);
  });

  it("compte : Iris n'écrit rien, il dit quelle fiche", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    await world.call("PUT", `/v1/citizen/contacts/${ALICE}/notification-preferences`, {
      token: await asContact(ALICE), json: { channels: { email: true } },
    });
    const token = await unsubscribeToken(TOKEN_SECRET, { requestId: r.id, channel: "email", target: { kind: "compte", contactId: ALICE } });
    const reply = await world.call("POST", path, { json: { token } });
    expect(reply.body).toEqual({ kind: "compte", contact_id: ALICE, reference: r.reference });
    expect((await link(ALICE)).channel_prefs).toEqual({ email: true });
  });

  it("jeton falsifié, d'un autre secret, d'une autre collectivité, ou demande sans accès : le même 404", async () => {
    const r = await world.addRequest(world.sceaux);
    const noAccess = await world.addRequest(world.sceaux);
    const antony = await world.addRequest(world.antony);
    await world.openGuestAccess(r.id, world.sceaux, "invite@example.org");
    await world.openGuestAccess(antony.id, world.antony, "invite@example.org");
    const mint = (id: string, secret = TOKEN_SECRET) => unsubscribeToken(secret, { requestId: id, channel: "email", target: { kind: "invite" } });
    const bodies: unknown[] = [];
    for (const token of [`${(await mint(r.id)).slice(0, -2)}AA`, await mint(r.id, "z".repeat(48)), await mint(noAccess.id), await mint(antony.id), "n'importe quoi"]) {
      const reply = await world.call("POST", path, { json: { token } });
      expect(reply.status).toBe(404);
      bodies.push(reply.body);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await notify(r.id)).toBe(true);
    // Le même jeton, présenté par la clé de sa propre collectivité, passe.
    expect((await world.call("POST", path, { tenant: ANTONY_ROOT, json: { token: await mint(antony.id) } })).status).toBe(200);
  });
});
