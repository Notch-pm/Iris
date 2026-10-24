/**
 * Lot L4a — `20261021090000_acces_invite_renvoi_coupure.sql` sur PGlite :
 * coupure, nouveau code (rotation), « code perdu » (3 / 24 h), file des
 * nouveaux codes (claim / start / settle / skip).
 * Schéma réduit + doublures : voir `harness/irisDb.ts`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { freshIrisDb } from "./harness/irisDb.ts";

let db: PGlite;
// deno-lint-ignore no-explicit-any
const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const setting = (name: string, value: string) => db.exec(`select set_config('${name}', '${value}', false)`);

const ORG = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ORG2 = "aaaaaaaa-0000-4000-8000-0000000000b2";
const AGENT = "99999999-9999-4999-8999-999999999999";
const SOURCE = "portail-citoyen";
const H = (c: string) => c.repeat(64);
const CODE = "ABCD-EFGH-JK";
const NEW_CODE = "WXYZ-WXYZ-WX";

async function insertRequest(org: string, reference: string, extra: { closedAt?: string | null } = {}) {
  await setting("app.service", "1");
  const res = await q<{ id: string }>(
    "insert into requests (organization_id, reference, source, closed_at) values ($1, $2, $3, $4) returning id",
    [org, reference, SOURCE, extra.closedAt ?? null],
  );
  await setting("app.service", "");
  return res[0].id;
}

async function withAccess(ref: string, org = ORG, extra: { closedAt?: string | null } = {}) {
  const id = await insertRequest(org, ref, extra);
  await db.query(
    "insert into request_access_codes (request_id, organization_id, code_hash, email_hash) values ($1, $2, $3, $4)",
    [id, org, H("c"), H("e")],
  );
  return id;
}

const check = (ref: string, email = H("e"), code = H("c"), org = ORG) =>
  q<{ r: string | null }>("select public.check_request_access($1, $2, $3, $4, $5) as r", [org, SOURCE, ref, email, code])
    .then((rows) => rows[0].r);
const rotate = (id: string, codeHash = H("d"), code = NEW_CODE, reason = "agent", by: string | null = AGENT) =>
  q<{ r: boolean }>("select public.rotate_request_access($1, $2, $3, 'usager@example.org', $4, $5) as r", [id, codeHash, code, reason, by])
    .then((rows) => rows[0].r);
const resend = (ref: string, emailHash = H("e"), org = ORG, codeHash = H("d"), code = NEW_CODE) =>
  q("select public.request_access_resend($1, $2, $3, $4, 'usager@example.org', $5, $6)", [org, SOURCE, ref, emailHash, codeHash, code]);
const access = (id: string) =>
  q<{ access_version: number; revoked_at: string | null; revoked_by: string | null; failed_attempts: number; locked_until: string | null; code_hash: string; resend_count: number }>(
    "select access_version, revoked_at, revoked_by, failed_attempts, locked_until, code_hash, resend_count from request_access_codes where request_id = $1",
    [id],
  ).then((rows) => rows[0]);
const mails = (id: string) =>
  q<{ id: string; status: string; to_email: string | null; access_code: string | null; reason: string; error: string | null; email_id: string | null; attempts: number; next_attempt_at: string | null }>(
    "select id, status, to_email, access_code, reason, error, email_id, attempts, next_attempt_at from request_access_mails where request_id = $1 order by created_at, id",
    [id],
  );

beforeEach(async () => {
  db = await freshIrisDb();
  await db.query("insert into organizations (id, socle_org_id, name) values ($1, $1, 'Sceaux'), ($2, $2, 'Antony')", [ORG, ORG2]);
  await db.query("insert into users (id) values ($1)", [AGENT]);
  await setting("app.uid", "");
  await setting("app.right", "");
  await setting("app.service", "");
});

describe("fermeture", () => {
  it("la file des nouveaux codes : RLS activée, aucune politique, aucun droit pour anon/authenticated", async () => {
    const [t] = await q("select relrowsecurity from pg_class where relname = 'request_access_mails'");
    expect(t.relrowsecurity).toBe(true);
    expect(await q("select * from pg_policies where tablename = 'request_access_mails'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      const [p] = await q(
        `select has_table_privilege('${role}', 'public.request_access_mails', 'select') s,
                has_table_privilege('${role}', 'public.request_access_mails', 'insert') i,
                has_table_privilege('${role}', 'public.request_access_mails', 'update') u`,
      );
      expect(p).toEqual({ s: false, i: false, u: false });
    }
  });

  it("les nouvelles RPC : service_role seulement", async () => {
    const fns = [
      "public.rotate_request_access(uuid, text, text, text, text, uuid)",
      "public.request_access_resend(uuid, text, text, text, text, text, text)",
      "public.revoke_request_access(uuid, uuid)",
      "public.claim_request_access_mails(int)",
      "public.start_request_access_mail_email(uuid, text, text)",
      "public.settle_request_access_mail(uuid, boolean, text)",
      "public.skip_request_access_mail(uuid, text)",
      "public.check_request_access(uuid, text, text, text, text)",
    ];
    for (const fn of fns) {
      const [p] = await q(
        `select has_function_privilege('anon', '${fn}', 'execute') a, has_function_privilege('authenticated', '${fn}', 'execute') u,
                has_function_privilege('public', '${fn}', 'execute') p, has_function_privilege('service_role', '${fn}', 'execute') s`,
      );
      expect(p, fn).toEqual({ a: false, u: false, p: false, s: true });
    }
  });

  it("la file n'accepte un code en clair que de la forme XXXX-XXXX-XX, et un motif connu", async () => {
    const id = await withAccess("DEM-1");
    for (const bad of ["abcd-efgh-jk", "ABCDEFGHJK", "<script>"]) {
      await expect(db.query("insert into request_access_mails (request_id, organization_id, reason, access_code) values ($1, $2, 'agent', $3)", [id, ORG, bad])).rejects.toThrow();
    }
    await expect(db.query("insert into request_access_mails (request_id, organization_id, reason) values ($1, $2, 'autre')", [id, ORG])).rejects.toThrow();
  });
});

describe("coupure (revoke_request_access)", () => {
  it("le bon code ne vaut plus ; version +1 ; qui et quand sont tracés", async () => {
    const id = await withAccess("DEM-1");
    expect(await check("DEM-1")).toBe(id);
    expect((await q<{ r: boolean }>("select public.revoke_request_access($1, $2) as r", [id, AGENT]))[0].r).toBe(true);
    expect(await check("DEM-1")).toBeNull();
    const a = await access(id);
    expect(a.access_version).toBe(2);
    expect(a.revoked_at).not.toBeNull();
    expect(a.revoked_by).toBe(AGENT);
  });

  it("couper un accès déjà coupé, ou inexistant : false, rien ne bouge", async () => {
    const id = await withAccess("DEM-1");
    await q("select public.revoke_request_access($1, null)", [id]);
    expect((await q<{ r: boolean }>("select public.revoke_request_access($1, null) as r", [id]))[0].r).toBe(false);
    expect((await access(id)).access_version).toBe(2);
    expect((await q<{ r: boolean }>("select public.revoke_request_access($1, null) as r", [crypto.randomUUID()]))[0].r).toBe(false);
  });

  it("un code en attente d'envoi est abandonné et son clair effacé ; un échange déjà ouvert est clos « échec »", async () => {
    const id = await withAccess("DEM-1");
    await rotate(id);
    const [m] = await mails(id);
    await q("select public.start_request_access_mail_email($1, 'Votre nouveau code d''accès', 'corps')", [m.id]);
    await q("select public.revoke_request_access($1, null)", [id]);
    const [after] = await mails(id);
    expect(after).toMatchObject({ status: "skipped", to_email: null, access_code: null, error: "accès coupé" });
    expect((await q("select status from request_emails where id = $1", [after.email_id]))[0].status).toBe("echec");
  });
});

describe("nouveau code (rotate_request_access)", () => {
  it("l'ancien code est refusé, le nouveau accepté ; version +1 ; verrou levé ; accès rouvert", async () => {
    const id = await withAccess("DEM-1");
    await db.query("update request_access_codes set failed_attempts = 3, locked_until = now() + interval '1 hour' where request_id = $1", [id]);
    await q("select public.revoke_request_access($1, null)", [id]);
    expect(await rotate(id)).toBe(true);
    expect(await check("DEM-1", H("e"), H("c"))).toBeNull();
    expect(await check("DEM-1", H("e"), H("d"))).toBe(id);
    const a = await access(id);
    expect(a).toMatchObject({ access_version: 3, revoked_at: null, revoked_by: null, failed_attempts: 0, locked_until: null, code_hash: H("d") });
  });

  it("enfile l'envoi avec le clair ; les envois précédents en attente sont abandonnés, leur clair effacé", async () => {
    const id = await withAccess("DEM-1");
    await rotate(id, H("d"), "AAAA-AAAA-AA");
    await rotate(id, H("f"), "BBBB-BBBB-BB");
    const rows = await mails(id);
    expect(rows.map((m) => m.status)).toEqual(["skipped", "pending"]);
    expect(rows[0]).toMatchObject({ to_email: null, access_code: null, error: "remplacé par un code plus récent" });
    expect(rows[1]).toMatchObject({ to_email: "usager@example.org", access_code: "BBBB-BBBB-BB", reason: "agent" });
  });

  it("l'accusé de réception encore en attente porte le code en vigueur", async () => {
    const id = await insertRequest(ORG, "DEM-1");
    await q("select public.register_request_access($1, $2, $3, null, $4)", [id, H("c"), H("e"), CODE]);
    await rotate(id);
    expect((await q("select access_code from request_receipts where request_id = $1", [id]))[0].access_code).toBe(NEW_CODE);
  });

  it("une demande sans accès : false, rien n'est enfilé", async () => {
    const id = await insertRequest(ORG, "DEM-1");
    expect(await rotate(id)).toBe(false);
    expect(await mails(id)).toEqual([]);
  });
});

describe("« code perdu » (request_access_resend)", () => {
  it("bons éléments : nouveau code enfilé vers l'adresse saisie, motif renvoi_usager, sans agent", async () => {
    const id = await withAccess("DEM-1");
    await resend("  dem-1 ");
    const [m] = await mails(id);
    expect(m).toMatchObject({ status: "pending", reason: "renvoi_usager", to_email: "usager@example.org", access_code: NEW_CODE });
    expect((await q("select requested_by from request_access_mails where id = $1", [m.id]))[0].requested_by).toBeNull();
    expect(await check("DEM-1", H("e"), H("d"))).toBe(id);
  });

  it("rien pour : adresse fausse, accès coupé, expiré (> 90 j après clôture), autre ville, référence inconnue", async () => {
    const id = await withAccess("DEM-1");
    await resend("DEM-1", H("f"));
    const cut = await withAccess("DEM-2");
    await q("select public.revoke_request_access($1, null)", [cut]);
    await resend("DEM-2");
    const old = await withAccess("DEM-3", ORG, { closedAt: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    await resend("DEM-3");
    await resend("DEM-1", H("e"), ORG2);
    await resend("DEM-999");
    expect(await q("select 1 from request_access_mails")).toEqual([]);
    expect((await access(id)).code_hash).toBe(H("c"));
    expect((await access(old)).access_version).toBe(1);
  });

  it("une demande close depuis moins de 90 jours se renvoie encore", async () => {
    const id = await withAccess("DEM-1", ORG, { closedAt: new Date(Date.now() - 89 * 86_400_000).toISOString() });
    await resend("DEM-1");
    expect((await mails(id)).length).toBe(1);
  });

  it("3 renvois par 24 h ; le 4e ne change rien ; la fenêtre repart après 24 h", async () => {
    const id = await withAccess("DEM-1");
    for (let i = 0; i < 4; i++) await resend("DEM-1", H("e"), ORG, H(String(i)), `AAAA-AAAA-A${i}`);
    expect((await mails(id)).length).toBe(3);
    expect((await access(id)).code_hash).toBe(H("2")); // le 4e n'a PAS remplacé le code
    expect((await access(id)).resend_count).toBe(3);
    await db.query("update request_access_codes set resend_window_start = now() - interval '25 hours' where request_id = $1", [id]);
    await resend("DEM-1", H("e"), ORG, H("9"), "AAAA-AAAA-A9");
    expect((await mails(id)).length).toBe(4);
    expect((await access(id)).resend_count).toBe(1);
    expect((await access(id)).code_hash).toBe(H("9"));
  });

  it("un renvoi lève le verrou (le nouveau code part à l'adresse déclarée)", async () => {
    const id = await withAccess("DEM-1");
    await db.query("update request_access_codes set locked_until = now() + interval '1 hour' where request_id = $1", [id]);
    await resend("DEM-1");
    expect(await check("DEM-1", H("e"), H("d"))).toBe(id);
  });
});

describe("la file des nouveaux codes (claim / start / settle / skip)", () => {
  async function queued() {
    const id = await withAccess("DEM-1");
    await rotate(id);
    return { id, mail: (await mails(id))[0] };
  }

  it("claim : marque 'sending', compte la tentative, rend le clair, la référence et l'organisation", async () => {
    const { id, mail } = await queued();
    const rows = await q("select * from public.claim_request_access_mails(10)");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ mail_id: mail.id, request_id: id, reference: "DEM-1", organization_name: "Sceaux", reason: "agent", to_email: "usager@example.org", access_code: NEW_CODE, attempts: 1 });
    expect((await mails(id))[0].status).toBe("sending");
    // Une seconde réclamation ne reprend pas un envoi en cours (récent).
    expect(await q("select * from public.claim_request_access_mails(10)")).toEqual([]);
  });

  it("claim reprend un envoi figé en 'sending' depuis plus de 15 min", async () => {
    const { id } = await queued();
    await q("select * from public.claim_request_access_mails(10)");
    await db.query("update request_access_mails set attempted_at = now() - interval '16 minutes' where request_id = $1", [id]);
    expect((await q("select * from public.claim_request_access_mails(10)")).length).toBe(1);
  });

  it("start ouvre l'échange UNE fois, au nom de l'agent, à l'adresse de la file", async () => {
    const { id, mail } = await queued();
    const first = (await q<{ r: string }>("select public.start_request_access_mail_email($1, 'Objet', 'Corps ••••') as r", [mail.id]))[0].r;
    const second = (await q<{ r: string }>("select public.start_request_access_mail_email($1, 'Autre', 'Autre') as r", [mail.id]))[0].r;
    expect(second).toBe(first);
    const emails = await q("select to_email, sent_by, subject, status from request_emails where request_id = $1", [id]);
    expect(emails).toEqual([{ to_email: "usager@example.org", sent_by: AGENT, subject: "Objet", status: "en_cours" }]);
  });

  it("settle succès : 'sent', adresse et code effacés, échange 'envoye'", async () => {
    const { id, mail } = await queued();
    await q("select public.start_request_access_mail_email($1, 'Objet', 'Corps')", [mail.id]);
    await q("select public.settle_request_access_mail($1, true, null)", [mail.id]);
    const [m] = await mails(id);
    expect(m).toMatchObject({ status: "sent", to_email: null, access_code: null, error: null });
    expect((await q("select status from request_emails where id = $1", [m.email_id]))[0].status).toBe("envoye");
  });

  it("settle échec : reprise temporisée (clair conservé), puis 'failed' au-delà des tentatives, clair effacé", async () => {
    const { id, mail } = await queued();
    await q("select public.start_request_access_mail_email($1, 'Objet', 'Corps')", [mail.id]);
    for (let i = 1; i <= 4; i++) {
      await db.query("update request_access_mails set attempts = $2 where id = $1", [mail.id, i]);
      await q("select public.settle_request_access_mail($1, false, 'relais muet')", [mail.id]);
      const [m] = await mails(id);
      expect(m).toMatchObject({ status: "pending", to_email: "usager@example.org", access_code: NEW_CODE, error: "relais muet" });
      expect(m.next_attempt_at).not.toBeNull();
    }
    await db.query("update request_access_mails set attempts = 5 where id = $1", [mail.id]);
    await q("select public.settle_request_access_mail($1, false, '')", [mail.id]);
    const [m] = await mails(id);
    expect(m).toMatchObject({ status: "failed", to_email: null, access_code: null, error: "inconnue" });
    expect((await q("select status from request_emails where id = $1", [m.email_id]))[0].status).toBe("echec");
  });

  it("un envoi en reprise n'est pas réclamé avant son heure", async () => {
    const { mail } = await queued();
    await db.query("update request_access_mails set attempts = 1 where id = $1", [mail.id]);
    await q("select public.settle_request_access_mail($1, false, 'x')", [mail.id]);
    expect(await q("select * from public.claim_request_access_mails(10)")).toEqual([]);
  });

  it("skip : 'skipped', clair effacé", async () => {
    const { id, mail } = await queued();
    await q("select public.skip_request_access_mail($1, 'aucun serveur d''envoi configuré')", [mail.id]);
    expect((await mails(id))[0]).toMatchObject({ status: "skipped", to_email: null, access_code: null, error: "aucun serveur d'envoi configuré" });
  });
});
