/**
 * CONTRAT ANTI-FUITE de la vue usager d'Iris (`/v1/citizen/*`, contrat 2.7.0) :
 * un usager ne voit jamais `closure_motif`, `request_messages`, les pièces
 * `instruction_interne`, les noms d'agents, ni les demandes d'un autre compte,
 * d'une autre collectivité, ou masquées (Clara, soustraites par un agent).
 *
 * `requests-api/index.ts` est exécuté pour de bon ; sa base est PGlite avec les
 * vraies migrations (voir `harness/`). Des PHRASES-SENTINELLES portent les
 * données internes : si l'une apparaît dans une réponse — quelle que soit la
 * route —, le test échoue.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANTONY_ROOT, IrisWorld, KEY, SCEAUX_ROOT, TOKEN_SECRET, type Reply } from "./harness/irisWorld.ts";

const ALICE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BOB = "bbbbbbbb-0000-4000-8000-0000000000b1";

const SENTINELLES = [
  "MOTIF INTERNE",
  "NOTE INTERNE",
  "CORPS INTERNE",
  "Agent Martin Dupont",
  "closure_motif",
  "request_messages",
  "assigned_to",
  "instruction_interne",
  "internal_notes",
  "sent_by",
  "to_email",
  "storage_path",
];

let world: IrisWorld;
const replies: Reply[] = [];

/** Une requête, dont la réponse est relue en bloc à la fin du test. */
async function call(...args: Parameters<IrisWorld["call"]>): Promise<Reply> {
  const reply = await world.call(...args);
  replies.push(reply);
  return reply;
}

beforeEach(async () => {
  replies.length = 0;
  world = await IrisWorld.create();
});
afterEach(async () => {
  for (const reply of replies) {
    for (const s of SENTINELLES) expect(reply.text, `sentinelle « ${s} » dans une réponse (${reply.status})`).not.toContain(s);
    for (const secret of [KEY, TOKEN_SECRET, "service-role"]) expect(reply.text).not.toContain(secret);
    // Jamais de CORS sur les routes authentifiées : cette API ne se consomme pas depuis un navigateur.
    expect(reply.headers.get("access-control-allow-origin")).toBeNull();
  }
  await world.close();
});

const asContact = (id: string, email = "usager@example.org") => world.token({ kind: "contact", id, email });
const asGuest = (id: string) => world.token({ kind: "request", id });

describe("authentification et portée de la clé", () => {
  it("sans clé, avec une clé inconnue, révoquée, expirée ou suspendue : jamais de donnée", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const token = await asContact(ALICE);
    await world.addKey("irs_revoked", ["requests:citizen"], { revoked: true });
    await world.addKey("irs_expired", ["requests:citizen"], { expired: true });
    await world.addKey("irs_suspended", ["requests:citizen"], { suspended: true });
    for (const key of [null, "irs_inconnue", "irs_revoked", "irs_expired", "irs_suspended"]) {
      const reply = await call("GET", `/v1/citizen/requests/${r.id}`, { key, token });
      expect([401, 403], String(key)).toContain(reply.status);
    }
  });

  it("une clé sans le scope requests:citizen n'ouvre aucune route usager, même avec un bon jeton", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    await world.addKey("irs_lecture", ["requests:read", "requests:write"]);
    const token = await asContact(ALICE);
    for (const path of [`/v1/citizen/requests/${r.id}`, `/v1/citizen/contacts/${ALICE}/requests`]) {
      expect((await call("GET", path, { key: "irs_lecture", token })).status).toBe(403);
    }
    expect((await call("POST", "/v1/citizen/access", { key: "irs_lecture", json: { reference: r.reference, email: "a@b.fr", code: "ABCD-EFGH-JK" } })).status).toBe(403);
  });

  it("réciproquement, la clé du portail (citoyen) ne lit ni la liste des partenaires ni la chronologie interne", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    expect((await call("GET", "/v1/requests")).status).toBe(403);
    expect((await call("GET", `/v1/requests/${r.id}`)).status).toBe(403);
    expect((await call("GET", `/v1/requests/${r.id}/timeline`)).status).toBe(403);
  });

  it("clé plateforme : la collectivité est exigée, connue, et doit avoir sa source", async () => {
    expect((await call("POST", "/v1/citizen/access", { tenant: null, json: {} })).status).toBe(400);
    expect((await call("POST", "/v1/citizen/access", { tenant: "pas-un-uuid", json: {} })).status).toBe(400);
    expect((await call("POST", "/v1/citizen/access", { tenant: "8f1e0d3a-0000-4000-8000-0000000000ff", json: {} })).status).toBe(403);
    await world.db.exec("update integration_sources set status = 'suspended' where organization_id is not null");
    expect((await call("POST", "/v1/citizen/access", { json: {} })).status).toBe(403);
  });
});

describe("jeton court (X-Citizen-Token)", () => {
  it("absent, mal formé, mal signé, expiré, trop long, d'une autre collectivité ou d'un autre secret : 404 uniforme", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const good = await asContact(ALICE);
    const now = Math.floor(Date.now() / 1000);
    const bad: (string | null)[] = [
      null,
      "",
      "x",
      "a.b",
      good.slice(0, -3) + "AAA",
      good.split(".")[0] + "." + good.split(".")[0],
      await world.token({ kind: "contact", id: ALICE }, { now: now - 3600 }),
      await world.token({ kind: "contact", id: ALICE }, { ttl: 181 }),
      await world.token({ kind: "contact", id: ALICE }, { ttl: 86_400 }),
      await world.token({ kind: "contact", id: ALICE }, { tenant: ANTONY_ROOT }),
      await world.token({ kind: "contact", id: ALICE }, { secret: "z".repeat(48) }),
      await world.token({ kind: "contact", id: ALICE }, { v: 2 }),
      "e".repeat(3000),
    ];
    const paths = [`/v1/citizen/requests/${r.id}`, `/v1/citizen/contacts/${ALICE}/requests`];
    const seen: unknown[] = [];
    for (const token of bad) {
      for (const path of paths) {
        const reply = await call("GET", path, { token });
        expect(reply.status, `${path} avec ${String(token).slice(0, 20)}`).toBe(404);
        seen.push(reply.body);
      }
    }
    for (const body of seen) expect(body).toEqual(seen[0]);
    expect((await call("GET", paths[0], { token: good })).status).toBe(200);
  });

  it("le jeton est borné à 3 minutes : 180 s passent, 181 non", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const path = `/v1/citizen/requests/${r.id}`;
    expect((await call("GET", path, { token: await world.token({ kind: "contact", id: ALICE }, { ttl: 180 }) })).status).toBe(200);
    expect((await call("GET", path, { token: await world.token({ kind: "contact", id: ALICE }, { ttl: 181 }) })).status).toBe(404);
    expect((await call("GET", path, { token: await world.token({ kind: "contact", id: ALICE }, { ttl: 0 }) })).status).toBe(404);
    expect((await call("GET", path, { token: await world.token({ kind: "contact", id: ALICE }, { ttl: -5 }) })).status).toBe(404);
  });

  it("un jeton signé pour un sujet qui n'est pas un UUID, ou d'un genre inconnu, n'ouvre rien", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    for (const sub of ["contact:pas-un-uuid", "request:", "admin:" + ALICE, ALICE]) {
      const { signCitizenToken } = await import("../_shared/citizenToken.ts");
      const token = await signCitizenToken(TOKEN_SECRET, { v: 1, t: SCEAUX_ROOT, sub, exp: Math.floor(Date.now() / 1000) + 60 });
      expect((await call("GET", `/v1/citizen/requests/${r.id}`, { token })).status, sub).toBe(404);
    }
  });

  it("sans le secret côté Iris, les lectures de fiche sont FERMÉES (jamais ouvertes par défaut)", async () => {
    await world.close();
    world = await IrisWorld.create({ IRIS_CITIZEN_TOKEN_SECRET: undefined });
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const token = await asContact(ALICE);
    expect((await call("GET", `/v1/citizen/contacts/${ALICE}/requests`, { token })).status).toBe(404);
    expect((await call("GET", `/v1/citizen/requests/${r.id}`, { token })).status).toBe(404);
  });

  // Mode transitoire documenté (contrat 2.7.0) : sans secret, l'ACCÈS INVITÉ reste lisible avec la
  // clé seule. Test de caractérisation — il épingle le risque, il ne le valide pas : tant que
  // IRIS_CITIZEN_TOKEN_SECRET n'est pas posé, la clé plateforme + l'identifiant d'une demande
  // à accès invité suffisent à la lire. En production le secret est posé (03-avancement.md).
  it("sans le secret, une demande à accès invité est lisible par la clé seule (mode transitoire à ne pas laisser en production)", async () => {
    await world.close();
    world = await IrisWorld.create({ IRIS_CITIZEN_TOKEN_SECRET: undefined });
    const r = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r.id, world.sceaux, "usager@example.org");
    expect((await call("GET", `/v1/citizen/requests/${r.id}`)).status).toBe(200);
    const other = await world.addRequest(world.sceaux); // sans accès invité
    expect((await call("GET", `/v1/citizen/requests/${other.id}`)).status).toBe(404);
  });
});

describe("propriété d'une demande — compte connecté (jeton contact:)", () => {
  it("lit SA demande ; la demande d'un autre, une inexistante, une masquée, une d'une autre ville : le même 404", async () => {
    const mine = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const bobs = await world.addRequest(world.sceaux, { socle_contact_id: BOB });
    const hidden = await world.addRequest(world.sceaux, { socle_contact_id: ALICE, citizen_visible: false });
    const clara = await world.addRequest(world.sceaux, { socle_contact_id: ALICE, source: "clara" });
    const antony = await world.addRequest(world.antony, { socle_contact_id: ALICE });
    const orphan = await world.addRequest(world.sceaux, { socle_contact_id: null });
    const token = await asContact(ALICE);

    expect((await call("GET", `/v1/citizen/requests/${mine.id}`, { token })).status).toBe(200);
    const refused = [];
    for (const id of [bobs.id, hidden.id, clara.id, antony.id, orphan.id, crypto.randomUUID()]) {
      const reply = await call("GET", `/v1/citizen/requests/${id}`, { token });
      expect(reply.status, id).toBe(404);
      refused.push(reply.body);
    }
    for (const body of refused) expect(body).toEqual(refused[0]);
  });

  it("une demande « issue de Clara » naît masquée, et le reste tant qu'un agent ne la rend pas visible", async () => {
    const clara = await world.addRequest(world.sceaux, { socle_contact_id: ALICE, source: "clara", citizen_visible: true });
    const [row] = await world.sql<{ citizen_visible: boolean }>("select citizen_visible from requests where id = $1", [clara.id]);
    expect(row.citizen_visible).toBe(false); // t13 : même si l'insertion demandait true
    const token = await asContact(ALICE);
    expect((await call("GET", `/v1/citizen/requests/${clara.id}`, { token })).status).toBe(404);
    expect((await call("GET", `/v1/citizen/contacts/${ALICE}/requests`, { token })).body.requests).toEqual([]);
    await world.db.exec(`select set_config('app.service','1',false)`);
    await world.db.exec(`update requests set citizen_visible = true where id = '${clara.id}'`);
    await world.db.exec(`select set_config('app.service','',false)`);
    expect((await call("GET", `/v1/citizen/requests/${clara.id}`, { token })).status).toBe(200);
  });

  it("la liste ne contient que les demandes visibles de la fiche du jeton, la plus récente d'abord", async () => {
    const a1 = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const a2 = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    await world.addRequest(world.sceaux, { socle_contact_id: BOB });
    await world.addRequest(world.sceaux, { socle_contact_id: ALICE, citizen_visible: false });
    await world.addRequest(world.antony, { socle_contact_id: ALICE });
    const reply = await call("GET", `/v1/citizen/contacts/${ALICE}/requests`, { token: await asContact(ALICE) });
    expect(reply.status).toBe(200);
    expect(reply.body.requests.map((r: { id: string }) => r.id)).toEqual([a2.id, a1.id]);
    expect(Object.keys(reply.body.requests[0]).sort()).toEqual(["closed_at", "id", "procedure_name", "received_at", "reference", "status", "subject", "updated_at"]);
    expect(reply.body.next_before).toBeNull();
  });

  it("IDOR sur la liste : le jeton d'Alice ne lit pas la liste de Bob, ni via un identifiant forgé", async () => {
    await world.addRequest(world.sceaux, { socle_contact_id: BOB });
    const token = await asContact(ALICE);
    for (const id of [BOB, ALICE.toUpperCase().replace("AAAAAAAA", "aaaaaaaa"), "pas-un-uuid", "00000000-0000-0000-0000-000000000000"]) {
      const reply = await call("GET", `/v1/citizen/contacts/${id}/requests`, { token });
      expect(reply.status, id).toBe(404);
    }
  });

  it("un jeton d'invité (request:) ne lit aucune liste de fiche ; un jeton de fiche ne lit pas une demande d'invité d'un autre", async () => {
    const guestReq = await world.addRequest(world.sceaux);
    await world.openGuestAccess(guestReq.id, world.sceaux, "invite@example.org");
    expect((await call("GET", `/v1/citizen/contacts/${ALICE}/requests`, { token: await asGuest(guestReq.id) })).status).toBe(404);
    expect((await call("GET", `/v1/citizen/requests/${guestReq.id}`, { token: await asContact(ALICE) })).status).toBe(404);
  });

  it("pagination : limite bornée de 1 à 50, curseur sans doublon ni trou, y compris à dates égales", async () => {
    const same = new Date(Date.UTC(2026, 9, 5, 10, 0, 0)).toISOString();
    for (let i = 0; i < 5; i++) await world.addRequest(world.sceaux, { socle_contact_id: ALICE, received_at: same });
    await world.addRequest(world.sceaux, { socle_contact_id: ALICE, received_at: new Date(Date.UTC(2026, 9, 4)).toISOString() });
    const token = await asContact(ALICE);

    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page++) {
      const path: string = `/v1/citizen/contacts/${ALICE}/requests?limit=2` + (before ? `&before=${encodeURIComponent(before)}` : "");
      const reply: Reply = await call("GET", path, { token });
      expect(reply.status).toBe(200);
      expect(reply.body.requests.length).toBeLessThanOrEqual(2);
      seen.push(...reply.body.requests.map((r: { id: string }) => r.id));
      before = reply.body.next_before;
      if (before === null) break;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);

    const huge = await call("GET", `/v1/citizen/contacts/${ALICE}/requests?limit=9999`, { token });
    expect(huge.body.requests.length).toBeLessThanOrEqual(50);
    expect((await call("GET", `/v1/citizen/contacts/${ALICE}/requests?limit=0`, { token })).body.requests).toHaveLength(1);
    expect((await call("GET", `/v1/citizen/contacts/${ALICE}/requests?limit=abc`, { token })).body.requests).toHaveLength(6);
  });

  it("curseur piégé : refusé (400) sans jamais atteindre la base", async () => {
    await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const token = await asContact(ALICE);
    for (const before of ["x", "2026-01-01T00:00:00Z_not-a-uuid", `2026-01-01T00:00:00Z_${crypto.randomUUID()}"),(select 1`, "'; drop table requests;--"]) {
      const reply = await call("GET", `/v1/citizen/contacts/${ALICE}/requests?before=${encodeURIComponent(before)}`, { token });
      expect(reply.status, before).toBe(400);
    }
    expect((await world.sql("select count(*)::int n from requests"))[0]).toEqual({ n: 1 });
  });
});

describe("ce que la vue montre — liste blanche", () => {
  it("la demande : champs prévus, motif de clôture et notes JAMAIS ; texte de clôture seulement une fois close", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE, closure_text: "Réponse rédigée pour l'usager" });
    await world.addNote(r.id);
    const token = await asContact(ALICE);

    const open = await call("GET", `/v1/citizen/requests/${r.id}`, { token });
    expect(open.status).toBe(200);
    expect(Object.keys(open.body.request).sort()).toEqual([
      "attachments", "closed_at", "closure_text", "id", "messages", "procedure_name", "received_at", "reference", "status", "subject", "updated_at",
    ]);
    expect(open.body.request.closure_text).toBeNull(); // brouillon laissé sur une demande ouverte : pas une réponse

    await world.db.exec("select set_config('app.service','1',false)");
    await world.db.exec(`update requests set closed_at = now(), status = 'resolue_positive' where id = '${r.id}'`);
    await world.db.exec("select set_config('app.service','',false)");
    const closed = await call("GET", `/v1/citizen/requests/${r.id}`, { token });
    expect(closed.body.request.closure_text).toBe("Réponse rédigée pour l'usager");
    expect(closed.body.request.status).toBe("resolue_positive");
  });

  it("pièces : celles de la demande, jamais d'instruction interne, jamais remplacées ; chemin de stockage jamais rendu", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const mine = await world.addAttachment(r.id, { file_name: "mon-justificatif.pdf" });
    await world.addAttachment(r.id, { file_name: "avis-interne.pdf", kind: "instruction_interne" });
    const old = await world.addAttachment(r.id, { file_name: "ancienne-version.pdf" });
    await world.db.query("update request_attachments set superseded_by = $1 where id = $2", [mine, old]);
    await world.addAttachment(r.id, { file_name: "sans-fichier.pdf", storage_path: "" });
    const view = await call("GET", `/v1/citizen/requests/${r.id}`, { token: await asContact(ALICE) });
    expect(view.body.request.attachments.map((a: { file_name: string }) => a.file_name)).toEqual(["mon-justificatif.pdf"]);
    expect(Object.keys(view.body.request.attachments[0]).sort()).toEqual(["file_name", "id", "mime_type", "size"]);
  });

  it("messages : seulement ceux ENVOYÉS, à l'adresse du jeton ; jamais un brouillon, un échec, ni l'envoi destiné à un tiers", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    await world.addEmail(r.id, { to_email: "Alice@Example.org", subject: "Pour Alice", sent_at: "2026-10-02T09:00:00Z" });
    await world.addEmail(r.id, { to_email: "tiers@example.org", subject: "Pour un tiers", body: "Confidentiel tiers" });
    await world.addEmail(r.id, { to_email: "alice@example.org", subject: "Brouillon", status: "brouillon" });
    await world.addEmail(r.id, { to_email: "alice@example.org", subject: "Échec", status: "echec" });
    const token = await asContact(ALICE, "alice@example.org");
    const view = await call("GET", `/v1/citizen/requests/${r.id}`, { token });
    expect(view.body.request.messages.map((m: { subject: string }) => m.subject)).toEqual(["Pour Alice"]);
    expect(view.text).not.toContain("Confidentiel tiers");
    expect(Object.keys(view.body.request.messages[0]).sort()).toEqual(["attachments", "body", "id", "sent_at", "subject"]);
  });

  it("jeton de fiche sans adresse : aucun message (l'adresse filtre, jamais l'inverse)", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    await world.addEmail(r.id, { to_email: "alice@example.org" });
    const token = await world.token({ kind: "contact", id: ALICE });
    expect((await call("GET", `/v1/citizen/requests/${r.id}`, { token })).body.request.messages).toEqual([]);
  });

  it("pièce d'un message : visible si le message est envoyé ET adressé au lecteur, sinon introuvable", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const mine = await world.addEmail(r.id, { to_email: "alice@example.org" });
    const theirs = await world.addEmail(r.id, { to_email: "tiers@example.org" });
    const draft = await world.addEmail(r.id, { to_email: "alice@example.org", status: "brouillon" });
    const a1 = await world.addAttachment(r.id, { email_id: mine, file_name: "reponse.pdf" });
    const a2 = await world.addAttachment(r.id, { email_id: theirs, file_name: "tiers.pdf" });
    const a3 = await world.addAttachment(r.id, { email_id: draft, file_name: "brouillon.pdf" });
    const token = await asContact(ALICE, "alice@example.org");
    expect((await call("GET", `/v1/citizen/requests/${r.id}/attachments/${a1}`, { token })).status).toBe(200);
    for (const id of [a2, a3]) expect((await call("GET", `/v1/citizen/requests/${r.id}/attachments/${id}`, { token })).status, id).toBe(404);
  });

  it("téléchargement : URL signée de 60 s, jamais pour une pièce d'un autre, d'instruction, ou d'une demande masquée", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const other = await world.addRequest(world.sceaux, { socle_contact_id: BOB });
    const hidden = await world.addRequest(world.sceaux, { socle_contact_id: ALICE, citizen_visible: false });
    const ok = await world.addAttachment(r.id, { file_name: "mon justificatif.pdf" });
    const internal = await world.addAttachment(r.id, { kind: "instruction_interne" });
    const bobs = await world.addAttachment(other.id);
    const inHidden = await world.addAttachment(hidden.id);
    const token = await asContact(ALICE);

    const good = await call("GET", `/v1/citizen/requests/${r.id}/attachments/${ok}`, { token });
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ url: expect.stringContaining("exp=60"), expires_in: 60 });
    expect(good.body.url).toContain("dl=mon%20justificatif.pdf");

    const cases: [string, string][] = [[r.id, internal], [other.id, bobs], [r.id, bobs], [hidden.id, inHidden], [r.id, crypto.randomUUID()]];
    for (const [rid, aid] of cases) {
      expect((await call("GET", `/v1/citizen/requests/${rid}/attachments/${aid}`, { token })).status, `${rid}/${aid}`).toBe(404);
    }
  });
});

describe("accès invité (jeton request:)", () => {
  it("un jeton lie UNE demande : celle-ci s'ouvre, une autre non, même à accès invité", async () => {
    const a = await world.addRequest(world.sceaux);
    const b = await world.addRequest(world.sceaux);
    await world.openGuestAccess(a.id, world.sceaux, "a@example.org");
    await world.openGuestAccess(b.id, world.sceaux, "b@example.org");
    const token = await asGuest(a.id);
    expect((await call("GET", `/v1/citizen/requests/${a.id}`, { token })).status).toBe(200);
    expect((await call("GET", `/v1/citizen/requests/${b.id}`, { token })).status).toBe(404);
  });

  it("sans accès invité (demande sans code), d'une autre source, d'une autre collectivité : introuvable même avec un jeton valable", async () => {
    const noCode = await world.addRequest(world.sceaux);
    const clara = await world.addRequest(world.sceaux, { source: "clara" });
    await world.openGuestAccess(clara.id, world.sceaux, "a@example.org");
    const antony = await world.addRequest(world.antony);
    await world.openGuestAccess(antony.id, world.antony, "a@example.org");
    for (const id of [noCode.id, clara.id, antony.id]) {
      expect((await call("GET", `/v1/citizen/requests/${id}`, { token: await asGuest(id) })).status, id).toBe(404);
    }
  });

  it("les messages de l'invité sont ceux envoyés à l'adresse DÉCLARÉE, casse et espaces ignorés", async () => {
    const r = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r.id, world.sceaux, "Invite@Example.org ");
    await world.addEmail(r.id, { to_email: " invite@example.org", subject: "À l'invité" });
    await world.addEmail(r.id, { to_email: "proche@example.org", subject: "Au proche" });
    const view = await call("GET", `/v1/citizen/requests/${r.id}`, { token: await asGuest(r.id) });
    expect(view.body.request.messages.map((m: { subject: string }) => m.subject)).toEqual(["À l'invité"]);
  });

  it("l'accès cesse 90 jours après la clôture", async () => {
    const r = await world.addRequest(world.sceaux, { closed_at: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    await world.openGuestAccess(r.id, world.sceaux, "a@example.org");
    expect((await call("GET", `/v1/citizen/requests/${r.id}`, { token: await asGuest(r.id) })).status).toBe(404);
    const fresh = await world.addRequest(world.sceaux, { closed_at: new Date(Date.now() - 89 * 86_400_000).toISOString() });
    await world.openGuestAccess(fresh.id, world.sceaux, "a@example.org");
    expect((await call("GET", `/v1/citizen/requests/${fresh.id}`, { token: await asGuest(fresh.id) })).status).toBe(200);
  });
});

describe("POST /v1/citizen/access — courriel + référence + code", () => {
  const CODE = "ABCD-EFGH-JK";
  async function guest(email = "usager@example.org", tenant = world.sceaux) {
    const r = await world.addRequest(tenant);
    await world.openGuestAccess(r.id, tenant, email, CODE);
    return r;
  }
  const attempt = (r: { reference: string }, email: string, code: string, extra: Partial<Parameters<IrisWorld["call"]>[2]> = {}) =>
    call("POST", "/v1/citizen/access", { json: { reference: r.reference, email, code }, ...extra });

  it("les bons éléments ouvrent la demande (rend son identifiant, rien d'autre)", async () => {
    const r = await guest();
    const reply = await attempt(r, "usager@example.org", CODE);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ request_id: r.id });
  });

  it("le code se recopie comme on peut : minuscules, espaces, tirets, O pour 0 (Crockford)", async () => {
    const r = await guest("usager@example.org");
    for (const code of ["abcd-efgh-jk", "ABCDEFGHJK", " abcd efgh jk ", "ABCD–EFGH–JK".replace(/–/g, "-")]) {
      expect((await attempt(r, "usager@example.org", code)).status, code).toBe(200);
    }
    const r2 = await world.addRequest(world.sceaux);
    await world.openGuestAccess(r2.id, world.sceaux, "usager@example.org", "O1IL-0000-00"); // saisi avec O→0, I/L→1
    expect((await attempt(r2, "usager@example.org", "0111-0000-00")).status).toBe(200);
  });

  it("la référence se saisit en minuscules ; l'adresse sans tenir compte de la casse", async () => {
    const r = await guest("Usager@Example.org");
    const reply = await call("POST", "/v1/citizen/access", { json: { reference: ` ${r.reference.toLowerCase()} `, email: " USAGER@example.ORG ", code: CODE } });
    expect(reply.status).toBe(200);
  });

  it("TOUS les refus ont le même corps et le même statut : inconnue, mauvaise adresse, mauvais code, mal formé, autre ville, autre source", async () => {
    const r = await guest();
    const clara = await world.addRequest(world.sceaux, { source: "clara" });
    await world.openGuestAccess(clara.id, world.sceaux, "usager@example.org", CODE);
    const antony = await guest("usager@example.org", world.antony);
    const refusals = [
      await attempt({ reference: "DEM-2026-999999" }, "usager@example.org", CODE),
      await attempt(r, "autre@example.org", CODE),
      await attempt(r, "usager@example.org", "ZZZZ-ZZZZ-ZZ"),
      await attempt(r, "usager@example.org", "trop-court"),
      await attempt(r, "pas-une-adresse", CODE),
      await attempt({ reference: "x".repeat(41) }, "usager@example.org", CODE),
      await attempt(clara, "usager@example.org", CODE),
      await attempt(antony, "usager@example.org", CODE), // référence d'Antony présentée à Sceaux
      await call("POST", "/v1/citizen/access", { json: { reference: 42, email: 1, code: null } }),
    ];
    for (const reply of refusals) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual(refusals[0].body);
    }
  });

  it("corps absent, illisible, tableau ou scalaire : 400 (une erreur d'appelant, pas d'une saisie d'usager)", async () => {
    for (const body of [undefined, "{", "[]", "42", "null"]) {
      const reply = await call("POST", "/v1/citizen/access", { body });
      expect(reply.status, String(body)).toBe(400);
    }
  });

  it("5 mauvais codes avec la BONNE adresse verrouillent la demande une heure — même le bon code est ensuite refusé", async () => {
    const r = await guest();
    for (let i = 0; i < 5; i++) expect((await attempt(r, "usager@example.org", `ZZZZ-ZZZZ-Z${i}`)).status).toBe(404);
    const after = await attempt(r, "usager@example.org", CODE);
    expect(after.status).toBe(404);
    expect(after.body).toEqual((await attempt(r, "usager@example.org", "ZZZZ-ZZZZ-ZZ")).body);
    const [lock] = await world.sql<{ ok: boolean }>("select locked_until > now() + interval '59 minutes' ok from request_access_codes where request_id = $1", [r.id]);
    expect(lock.ok).toBe(true);
    await world.db.query("update request_access_codes set locked_until = now() - interval '1 second' where request_id = $1", [r.id]);
    expect((await attempt(r, "usager@example.org", CODE)).status).toBe(200);
  });

  it("une adresse FAUSSE ne compte pas : on ne verrouille pas une ville en énumérant les références", async () => {
    const r = await guest();
    for (let i = 0; i < 20; i++) await attempt(r, "intrus@example.org", `ZZZZ-ZZZZ-Z${i % 10}`);
    expect((await world.sql("select failed_attempts from request_access_codes where request_id = $1", [r.id]))[0]).toEqual({ failed_attempts: 0 });
    expect((await attempt(r, "usager@example.org", CODE)).status).toBe(200);
  });

  it("un succès remet le compteur d'échecs à zéro", async () => {
    const r = await guest();
    for (let i = 0; i < 4; i++) await attempt(r, "usager@example.org", `ZZZZ-ZZZZ-Z${i}`);
    expect((await attempt(r, "usager@example.org", CODE)).status).toBe(200);
    for (let i = 0; i < 4; i++) await attempt(r, "usager@example.org", `ZZZZ-ZZZZ-Z${i}`);
    expect((await attempt(r, "usager@example.org", CODE)).status).toBe(200);
  });

  it("le verrou d'une demande ne touche pas les autres", async () => {
    const r1 = await guest("a@example.org");
    const r2 = await guest("b@example.org");
    for (let i = 0; i < 6; i++) await attempt(r1, "a@example.org", `ZZZZ-ZZZZ-Z${i}`);
    expect((await attempt(r2, "b@example.org", CODE)).status).toBe(200);
  });

  it("durée plancher de 400 ms sur chaque vérification (connue ou non, juste ou fausse) — attente demandée au minuteur", async () => {
    const r = await guest();
    world.floorWaits.length = 0;
    await attempt(r, "usager@example.org", CODE);
    await attempt({ reference: "DEM-2026-999999" }, "usager@example.org", CODE);
    await attempt(r, "usager@example.org", "ZZZZ-ZZZZ-ZZ");
    await call("POST", "/v1/citizen/access", { body: "{" });
    expect(world.floorWaits).toHaveLength(4);
    for (const wait of world.floorWaits) {
      expect(wait).toBeGreaterThan(250);
      expect(wait).toBeLessThanOrEqual(400);
    }
  });

  it("durée plancher en temps réel : une référence inconnue ne revient pas plus vite qu'une référence connue", async () => {
    await world.close();
    world = await IrisWorld.create({}, { realTime: true });
    const r = await guest();
    for (const reference of [r.reference, "DEM-2026-999999"]) {
      const started = performance.now();
      const reply = await call("POST", "/v1/citizen/access", { json: { reference, email: "usager@example.org", code: "ZZZZ-ZZZZ-ZZ" } });
      const elapsed = performance.now() - started;
      expect(reply.status).toBe(404);
      expect(elapsed).toBeGreaterThanOrEqual(380);
    }
  });

  it("sans poivre, aucun accès ne s'ouvre ni ne se vérifie", async () => {
    await world.close();
    world = await IrisWorld.create({ IRIS_ACCESS_CODE_PEPPER: undefined });
    const r = await world.addRequest(world.sceaux);
    const reply = await call("POST", "/v1/citizen/access", { json: { reference: r.reference, email: "a@b.fr", code: CODE } });
    expect(reply.status).toBe(500);
  });
});

describe("méthodes, routes et journal", () => {
  it("méthodes non prévues : 405 ; routes inconnues : 404 ; documentation publique lisible sans clé", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    expect((await call("POST", `/v1/citizen/requests/${r.id}`)).status).toBe(405);
    expect((await call("DELETE", `/v1/citizen/contacts/${ALICE}/requests`)).status).toBe(405);
    expect((await call("GET", "/v1/citizen/access")).status).toBe(405);
    expect((await call("GET", "/v1/citizen/inconnu")).status).toBe(404);
    expect((await call("GET", "/v1/citizen/requests/pas-un-uuid", { token: await asContact(ALICE) })).status).toBe(404);
    const doc = await world.call("GET", "/v1/openapi.json", { key: null, tenant: null });
    expect(doc.status).toBe(200);
    expect(Object.keys(doc.body.paths)).toEqual(expect.arrayContaining(["/v1/citizen/access", "/v1/citizen/requests/{id}", "/v1/citizen/contacts/{id}/requests"]));
  });

  it("le journal d'audit consigne l'appel (route, statut, demande) mais jamais le jeton, l'adresse ni le code", async () => {
    const r = await world.addRequest(world.sceaux, { socle_contact_id: ALICE });
    const token = await asContact(ALICE, "alice@example.org");
    await call("GET", `/v1/citizen/requests/${r.id}`, { token });
    await call("POST", "/v1/citizen/access", { json: { reference: r.reference, email: "alice@example.org", code: "ABCD-EFGH-JK" } });
    const logs = await world.sql<Record<string, unknown>>("select * from integration_api_logs order by id");
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(logs);
    for (const secret of [token, "alice@example.org", "ABCD-EFGH-JK", ALICE]) expect(dump).not.toContain(secret);
    expect(logs.find((l) => l.path === `/v1/citizen/requests/${r.id}`)).toMatchObject({ method: "GET", status: 200, request_id: r.id });
  });
});
