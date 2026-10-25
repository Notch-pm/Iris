/**
 * B12, lot L4c-1 — `20261025110000_notifications_usager_file.sql` sur PGlite :
 * l'interrupteur, le trigger t41 (il enfile le fait, il ne décide rien), la
 * fusion des rafales sur l'unique ligne `pending`, le statut connu, et le cycle
 * du facteur (réclamer, reporter, ouvrir l'échange, régler, renoncer).
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
const ROOT = "bbbbbbbb-0000-4000-8000-0000000000b1";
const ADMIN = "dddddddd-0000-4000-8000-000000000001";

async function insertRequest(extra: { status?: string; source?: string } = {}) {
  await setting("app.service", "1");
  const [row] = await q<{ id: string }>(
    "insert into requests (organization_id, reference, status, source, subject) values ($1, $2, $3, $4, 'Nid-de-poule') returning id",
    [ORG, `DEM-${crypto.randomUUID().slice(0, 8)}`, extra.status ?? "a_traiter", extra.source ?? "portail-citoyen"],
  );
  await setting("app.service", "");
  return row.id;
}

async function move(id: string, status: string, flags: Record<string, string> = {}) {
  await setting("app.service", "1");
  await db.transaction(async (tx) => {
    for (const [name, value] of Object.entries(flags)) await tx.query("select set_config($1, $2, true)", [name, value]);
    await tx.query("update requests set status = $2 where id = $1", [id, status]);
  });
  await setting("app.service", "");
}

async function switchOn(enabled = true) {
  await setting("app.uid", ADMIN);
  await setting("app.admin", "1");
  await q("select public.save_citizen_notification_settings($1, $2)", [ORG, enabled]);
  await setting("app.uid", "");
  await setting("app.admin", "");
}

const notices = (id: string) =>
  q<{ id: string; status: string; events: { de: string; vers: string }[]; due_at: Date; created_at: Date; attempts: number; reason: string | null }>(
    "select * from citizen_notices where request_id = $1 order by created_at", [id]);
const known = async (id: string) =>
  (await q<{ known_status: string }>("select known_status from request_citizen_status where request_id = $1", [id]))[0]?.known_status ?? null;
const makeDue = (id: string) => q("update citizen_notices set due_at = now() - interval '1 second' where request_id = $1", [id]);
const claim = () => q<{ notice_id: string; request_id: string; status: string; known_status: string; enabled: boolean; receipt_status: string | null }>(
  "select * from public.claim_citizen_notices(25)");

beforeEach(async () => {
  db = await freshIrisDb();
  await setting("app.service", "1");
  await q("insert into organizations (id, socle_org_id, name) values ($1, $2, 'Ville de Sceaux')", [ORG, ROOT]);
  await q("insert into users (id, email) values ($1, 'admin@sceaux.fr')", [ADMIN]);
  await setting("app.service", "");
});

describe("interrupteur (ADR-7)", () => {
  it("éteint par défaut : un changement de statut n'enfile rien", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction");
    expect(await notices(id)).toEqual([]);
    expect(await known(id)).toBeNull();
  });

  it("ne se règle que par l'administration de l'organisation principale", async () => {
    await expect(q("select public.save_citizen_notification_settings($1, true)", [ORG])).rejects.toThrow(/Authentification/);
    await setting("app.uid", ADMIN);
    await expect(q("select public.save_citizen_notification_settings($1, true)", [ORG])).rejects.toThrow(/administration/);
    await setting("app.admin", "1");
    expect((await q("select public.save_citizen_notification_settings($1, true) as r", [ORG]))[0].r).toEqual({ enabled: true });
    const [row] = await q("select enabled, updated_by from citizen_notification_settings where organization_id = $1", [ORG]);
    expect(row).toEqual({ enabled: true, updated_by: ADMIN });
  });
});

describe("trigger t41 — il enfile le fait", () => {
  beforeEach(() => switchOn());

  it("allumé : une ligne pending, l'événement brut, due_at = +10 min, statut connu = celui d'avant", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction");
    const [n] = await notices(id);
    expect(n.status).toBe("pending");
    expect(n.events.map(({ de, vers }) => ({ de, vers }))).toEqual([{ de: "a_traiter", vers: "en_instruction" }]);
    const delay = (n.due_at.getTime() - n.created_at.getTime()) / 60_000;
    expect(delay).toBeGreaterThan(9.9);
    expect(delay).toBeLessThan(10.1);
    expect(await known(id)).toBe("a_traiter");
  });

  it("une rafale se fusionne sur la ligne pending, sans repousser l'échéance", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction");
    const [first] = await notices(id);
    await move(id, "en_attente");
    await move(id, "en_instruction");
    const all = await notices(id);
    expect(all).toHaveLength(1);
    expect(all[0].events.map((e) => e.vers)).toEqual(["en_instruction", "en_attente", "en_instruction"]);
    expect(all[0].due_at).toEqual(first.due_at);
    expect(await known(id)).toBe("a_traiter");
  });

  it("se tait pour une demande issue de Clara", async () => {
    const id = await insertRequest({ source: "clara" });
    await move(id, "en_instruction");
    expect(await notices(id)).toEqual([]);
  });

  it("se tait sous iris.silence_usager (jeu de démonstration)", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction", { "iris.silence_usager": "on" });
    expect(await notices(id)).toEqual([]);
    // Transactionnel : la transition suivante, hors script, enfile.
    await move(id, "en_attente");
    expect(await notices(id)).toHaveLength(1);
  });

  it("sous iris.reprise_usager (réponse de l'usager) : rien en file, le statut connu suit", async () => {
    const id = await insertRequest({ status: "en_attente" });
    await move(id, "en_instruction", { "iris.reprise_usager": "on" });
    expect(await notices(id)).toEqual([]);
    expect(await known(id)).toBe("en_instruction");
  });

  it("une ligne déjà réclamée n'absorbe pas le nouvel événement : une nouvelle ligne pending", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction");
    await makeDue(id);
    expect(await claim()).toHaveLength(1);
    await move(id, "en_attente");
    expect((await notices(id)).map((n) => n.status)).toEqual(["sending", "pending"]);
  });
});

describe("le facteur", () => {
  beforeEach(() => switchOn());

  async function claimedNotice() {
    const id = await insertRequest();
    await move(id, "en_instruction");
    await makeDue(id);
    const [row] = await claim();
    return { id, notice: row.notice_id };
  }

  it("ne réclame que ce qui est dû, et une seule fois", async () => {
    const id = await insertRequest();
    await move(id, "en_instruction");
    expect(await claim()).toEqual([]);
    await makeDue(id);
    const rows = await claim();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ request_id: id, status: "en_instruction", known_status: "a_traiter", enabled: true });
    expect(await claim()).toEqual([]);
    expect((await notices(id))[0]).toMatchObject({ status: "sending", attempts: 1 });
  });

  it("rend l'état de l'accusé, et le report ne consomme pas de tentative", async () => {
    const { id, notice } = await claimedNotice();
    await setting("app.service", "1");
    await q("insert into request_receipts (request_id) values ($1)", [id]);
    await setting("app.service", "");
    await q("update citizen_notices set status = 'pending', attempts = 0 where id = $1", [notice]);
    const [row] = await claim();
    expect(row.receipt_status).toBe("pending");
    await q("select public.defer_citizen_notice($1)", [notice]);
    const [n] = await q("select status, attempts, next_attempt_at > now() as later from citizen_notices where id = $1", [notice]);
    expect(n).toEqual({ status: "pending", attempts: 0, later: true });
  });

  it("l'échange de l'avis est un avis, sans agent, ouvert une seule fois", async () => {
    const { id, notice } = await claimedNotice();
    const open = () => q<{ e: string }>("select public.start_citizen_notice_email($1, ' a@b.fr ', 'Votre demande', 'Corps') as e", [notice]);
    const [{ e }] = await open();
    expect((await open())[0].e).toBe(e);
    const emails = await q("select nature, sent_by, to_email, status from request_emails where request_id = $1", [id]);
    expect(emails).toEqual([{ nature: "avis", sent_by: null, to_email: "a@b.fr", status: "en_cours" }]);
  });

  it("succès : ligne sent, échange envoyé, statut connu avancé", async () => {
    const { id, notice } = await claimedNotice();
    await q("select public.start_citizen_notice_email($1, 'a@b.fr', 'S', 'B')", [notice]);
    await q("select public.settle_citizen_notice($1, true, null, 'prise_en_charge', 'invite', 'en_instruction')", [notice]);
    expect((await q("select status, event_sent, target from citizen_notices where id = $1", [notice]))[0])
      .toEqual({ status: "sent", event_sent: "prise_en_charge", target: "invite" });
    expect((await q("select status from request_emails where request_id = $1", [id]))[0].status).toBe("envoye");
    expect(await known(id)).toBe("en_instruction");
  });

  it("échec : temporisation, puis abandon franc à la 5e tentative", async () => {
    const { id, notice } = await claimedNotice();
    await q("select public.start_citizen_notice_email($1, 'a@b.fr', 'S', 'B')", [notice]);
    await q("select public.settle_citizen_notice($1, false, 'relais muet')", [notice]);
    expect((await q("select status, error from citizen_notices where id = $1", [notice]))[0]).toEqual({ status: "pending", error: "relais muet" });
    await q("update citizen_notices set attempts = 5 where id = $1", [notice]);
    await q("select public.settle_citizen_notice($1, false, 'relais muet')", [notice]);
    expect((await q("select status from citizen_notices where id = $1", [notice]))[0].status).toBe("failed");
    expect((await q("select status from request_emails where request_id = $1", [id]))[0].status).toBe("echec");
    expect(await known(id)).toBe("a_traiter");
  });

  it("renoncer : raison d'un catalogue fermé, écrite sur la ligne, statut connu inchangé", async () => {
    const { id, notice } = await claimedNotice();
    await expect(q("select public.skip_citizen_notice($1, 'parce que')", [notice])).rejects.toThrow();
    await q("select public.skip_citizen_notice($1, 'aucun_acces_en_ligne', 'prise_en_charge')", [notice]);
    expect((await q("select status, reason, event_sent from citizen_notices where id = $1", [notice]))[0])
      .toEqual({ status: "skipped", reason: "aucun_acces_en_ligne", event_sent: "prise_en_charge" });
    expect(await known(id)).toBe("a_traiter");
  });
});

describe("surface", () => {
  const SERVICE_ONLY = [
    "citizen_notices_enabled(uuid)",
    "note_citizen_known_status(uuid, text)",
    "requests_citizen_notice()",
    "claim_citizen_notices(int)",
    "defer_citizen_notice(uuid)",
    "start_citizen_notice_email(uuid, text, text, text)",
    "settle_citizen_notice(uuid, boolean, text, text, text, text)",
    "skip_citizen_notice(uuid, text, text, text)",
  ];

  it("les fonctions de service ne s'exécutent ni par anon ni par authenticated", async () => {
    for (const fn of SERVICE_ONLY) {
      for (const role of ["anon", "authenticated"]) {
        const [{ ok }] = await q<{ ok: boolean }>(`select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`);
        expect(ok, `${role} → ${fn}`).toBe(false);
      }
    }
    const [{ ok }] = await q<{ ok: boolean }>(
      "select has_function_privilege('authenticated', 'public.save_citizen_notification_settings(uuid, boolean)', 'execute') as ok");
    expect(ok).toBe(true);
  });

  it("aucune policy cliente d'écriture ; lecture seulement de l'interrupteur et de la file", async () => {
    const rows = await q<{ tablename: string; cmd: string; roles: string[] }>(
      `select tablename, cmd, roles::text[] as roles from pg_policies
        where tablename in ('citizen_notification_settings', 'citizen_space_links', 'request_citizen_status', 'citizen_notices')`);
    const client = rows.filter((r) => !r.roles.includes("service_role"));
    expect(client.map((r) => `${r.tablename}:${r.cmd}`).sort()).toEqual([
      "citizen_notices:SELECT",
      "citizen_notification_settings:SELECT",
    ]);
  });
});
