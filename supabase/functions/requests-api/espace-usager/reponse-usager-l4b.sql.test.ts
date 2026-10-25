/**
 * Lot L4b — `20261021120000_reponse_usager.sql` sur PGlite : la table des
 * messages de l'usager, ses pièces, la RPC `record_citizen_message` (message,
 * pièces consommées, retour en instruction, journal, notifications).
 * Schéma réduit + doublures : voir `harness/irisDb.ts`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { freshIrisDb, openReplies } from "./harness/irisDb.ts";

let db: PGlite;
// deno-lint-ignore no-explicit-any
const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const setting = (name: string, value: string) => db.exec(`select set_config('${name}', '${value}', false)`);

const ORG = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ORG2 = "aaaaaaaa-0000-4000-8000-0000000000b2";
const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const BODY = "TEXTE PRIVÉ DE L'USAGER : voici le justificatif demandé.";
let source: string;

async function insertRequest(extra: { status?: string; assigned?: string | null; org?: string } = {}) {
  await setting("app.service", "1");
  const [row] = await q<{ id: string }>(
    "insert into requests (organization_id, reference, status, assigned_to, subject) values ($1, $2, $3, $4, 'Nid-de-poule') returning id",
    [extra.org ?? ORG, `DEM-${crypto.randomUUID().slice(0, 8)}`, extra.status ?? "en_instruction", extra.assigned === undefined ? null : extra.assigned],
  );
  await setting("app.service", "");
  return row.id;
}

/** Une pièce en attente, DÉJÀ déplacée sous la demande (ce que fait requests-api avant la RPC). */
async function upload(requestId: string, extra: { source?: string | null; org?: string; consumed?: boolean } = {}) {
  const id = crypto.randomUUID();
  const org = extra.org ?? ORG;
  await db.query(
    `insert into attachment_uploads (id, organization_id, integration_source_id, storage_path, file_name, mime_type, file_size, checksum, consumed_at)
     values ($1, $2, $3, $4, 'piece.pdf', 'application/pdf', 100, 'ck', $5)`,
    [id, org, extra.source === undefined ? source : extra.source, `${org}/${requestId}/${id}-piece.pdf`, extra.consumed ? new Date().toISOString() : null],
  );
  return id;
}

// Messagerie fermée par défaut (20261025160000) : chaque appel l'ouvre d'abord.
const record = async (requestId: string, items: string[] = [], extra: { kind?: string; contact?: string | null; org?: string; src?: string | null } = {}) =>
  await openReplies(db, requestId).then(() => q<{ r: string }>(
    "select public.record_citizen_message($1, $2, $3, $4, $5, $6, $7::jsonb) as r",
    [
      requestId,
      extra.org ?? ORG,
      extra.src === undefined ? source : extra.src,
      extra.kind ?? "invite",
      extra.contact ?? null,
      BODY,
      JSON.stringify(items.map((upload_id) => ({ upload_id }))),
    ],
  )).then((rows) => rows[0].r);

const count = async (table: string) => (await q<{ n: number }>(`select count(*)::int n from ${table}`))[0].n;

beforeEach(async () => {
  db = await freshIrisDb();
  await db.query("insert into organizations (id, socle_org_id, name) values ($1, $1, 'Sceaux'), ($2, $2, 'Antony')", [ORG, ORG2]);
  const [s] = await q<{ id: string }>("insert into integration_sources (code, organization_id) values ('portail-citoyen', null) returning id");
  source = s.id;
  await setting("app.uid", "");
  await setting("app.right", "");
  await setting("app.service", "");
});

describe("fermeture", () => {
  it("la table : RLS activée, lecture par qui consulte la demande, aucune écriture cliente", async () => {
    const [t] = await q("select relrowsecurity from pg_class where relname = 'request_citizen_messages'");
    expect(t.relrowsecurity).toBe(true);
    const policies = await q<{ policyname: string; cmd: string; roles: string[] }>(
      "select policyname, cmd, roles::text[] as roles from pg_policies where tablename = 'request_citizen_messages' order by policyname",
    );
    expect(policies.map((p) => [p.policyname, p.cmd])).toEqual([
      ["request_citizen_messages_select", "SELECT"],
      ["request_citizen_messages_service", "ALL"],
    ]);
    for (const role of ["anon", "authenticated"]) {
      const [p] = await q(
        `select has_table_privilege('${role}', 'public.request_citizen_messages', 'insert') i,
                has_table_privilege('${role}', 'public.request_citizen_messages', 'update') u,
                has_table_privilege('${role}', 'public.request_citizen_messages', 'delete') d`,
      );
      expect(p, role).toEqual({ i: false, u: false, d: false });
    }
  });

  it("la RPC : service_role seulement", async () => {
    const fn = "public.record_citizen_message(uuid, uuid, uuid, text, uuid, text, jsonb)";
    const [p] = await q(
      `select has_function_privilege('anon', '${fn}', 'execute') a, has_function_privilege('authenticated', '${fn}', 'execute') u,
              has_function_privilege('public', '${fn}', 'execute') p, has_function_privilege('service_role', '${fn}', 'execute') s`,
    );
    expect(p).toEqual({ a: false, u: false, p: false, s: true });
  });

  it("un message ne se réécrit pas", async () => {
    const id = await insertRequest();
    const msg = await record(id);
    await expect(db.query("update request_citizen_messages set body = 'autre' where id = $1", [msg])).rejects.toThrow(/immuable/);
  });

  it("canal et fiche vont ensemble ; corps vide ou trop long refusé", async () => {
    const id = await insertRequest();
    await expect(record(id, [], { kind: "compte", contact: null })).rejects.toThrow();
    await expect(record(id, [], { kind: "invite", contact: CONTACT })).rejects.toThrow();
    await expect(q("select public.record_citizen_message($1, $2, $3, 'invite', null, '   ', '[]'::jsonb)", [id, ORG, source])).rejects.toThrow();
    await expect(q("select public.record_citizen_message($1, $2, $3, 'invite', null, $4, '[]'::jsonb)", [id, ORG, source, "x".repeat(5001)])).rejects.toThrow();
    expect(await count("request_citizen_messages")).toBe(0);
  });

  it("une pièce ne peut pas appartenir à la fois à un envoi et à un message de l'usager", async () => {
    const id = await insertRequest();
    const msg = await record(id);
    await expect(db.query(
      "insert into request_attachments (request_id, file_name, email_id, citizen_message_id) values ($1, 'x.pdf', $2, $3)",
      [id, crypto.randomUUID(), msg],
    )).rejects.toThrow(/one_exchange/);
  });
});

describe("record_citizen_message", () => {
  it("enregistre le message, consomme ses pièces et les rattache AU message", async () => {
    const id = await insertRequest();
    const u1 = await upload(id);
    const u2 = await upload(id);
    const msg = await record(id, [u1, u2], { kind: "compte", contact: CONTACT });
    const [m] = await q("select request_id, organization_id, author_kind, socle_contact_id, body from request_citizen_messages where id = $1", [msg]);
    expect(m).toEqual({ request_id: id, organization_id: ORG, author_kind: "compte", socle_contact_id: CONTACT, body: BODY });
    const pieces = await q("select citizen_message_id, email_id, kind, copy_status, uploaded_by from request_attachments where request_id = $1", [id]);
    expect(pieces).toHaveLength(2);
    for (const p of pieces) expect(p).toEqual({ citizen_message_id: msg, email_id: null, kind: "demande", copy_status: "copied", uploaded_by: null });
    const ups = await q<{ consumed_at: string | null; request_attachment_id: string | null }>("select consumed_at, request_attachment_id from attachment_uploads");
    expect(ups.every((u) => u.consumed_at !== null && u.request_attachment_id !== null)).toBe(true);
  });

  it("une pièce d'une autre clé, déjà consommée ou d'un autre tenant : tout est annulé", async () => {
    const id = await insertRequest();
    const [other] = await q<{ id: string }>("insert into integration_sources (code, organization_id) values ('partenaire', null) returning id");
    for (const bad of [await upload(id, { source: other.id }), await upload(id, { consumed: true }), await upload(id, { org: ORG2 })]) {
      await expect(record(id, [await upload(id), bad])).rejects.toThrow();
    }
    expect(await count("request_citizen_messages")).toBe(0);
    expect(await count("request_attachments")).toBe(0);
    expect(await count("request_events")).toBe(0);
  });

  it("demande close (résolue, annulée, archivée) : P0409, rien n'est écrit", async () => {
    for (const status of ["resolue_positive", "resolue_negative", "annulee", "archivee"]) {
      const id = await insertRequest({ status });
      const u = await upload(id);
      const error = await record(id, [u]).then(() => null, (e: { code?: string }) => e);
      expect(error?.code, status).toBe("P0409");
    }
    expect(await count("request_citizen_messages")).toBe(0);
    expect(await count("notifications")).toBe(0);
    expect((await q("select count(*)::int n from attachment_uploads where consumed_at is not null"))[0].n).toBe(0);
  });

  it("autre tenant ou sans source : refusé", async () => {
    const id = await insertRequest();
    await expect(record(id, [], { org: ORG2 })).rejects.toThrow(/introuvable/);
    await expect(record(id, [], { src: null })).rejects.toThrow(/source/);
  });

  it("en_attente → en_instruction, journal reprise:true ; les autres statuts ne bougent pas", async () => {
    const waiting = await insertRequest({ status: "en_attente" });
    const u = await upload(waiting);
    const msg = await record(waiting, [u]);
    expect((await q("select status from requests where id = $1", [waiting]))[0].status).toBe("en_instruction");
    const [event] = await q("select event_type, payload, created_by from request_events where request_id = $1", [waiting]);
    expect(event).toEqual({
      event_type: "message_usager_recu",
      payload: { message_id: msg, pieces: 1, canal: "invite", reprise: true },
      created_by: null,
    });
    for (const status of ["a_traiter", "en_instruction"]) {
      const id = await insertRequest({ status });
      await record(id);
      expect((await q("select status from requests where id = $1", [id]))[0].status).toBe(status);
      expect((await q("select payload->>'reprise' r from request_events where request_id = $1", [id]))[0].r).toBe("false");
    }
  });

  it("notification : l'assigné seul s'il y en a un ; jamais le corps", async () => {
    await db.query("insert into organization_members (organization_id, user_id) values ($1, 'instructeur-1')", [ORG]);
    await db.query("insert into stub_instructors (user_id) values ('instructeur-1')");
    const id = await insertRequest({ assigned: "agent-assigne", status: "en_attente" });
    await record(id, [await upload(id)]);
    const notes = await q<{ user_id: string; kind: string; payload: Record<string, unknown> }>("select user_id, kind, payload from notifications");
    expect(notes.map((n) => [n.user_id, n.kind])).toEqual([["agent-assigne", "citizen_replied"]]);
    expect(notes[0].payload).toMatchObject({ pieces: 1, status: "en_attente" });
    expect(JSON.stringify(notes)).not.toContain("TEXTE PRIVÉ");
  });

  it("sans assigné : les membres qui INSTRUISENT le couple, pas les autres ; jamais le corps", async () => {
    await db.query(
      "insert into organization_members (organization_id, user_id) values ($1, 'instructeur-1'), ($1, 'instructeur-2'), ($1, 'lecteur'), ($2, 'autre-ville')",
      [ORG, ORG2],
    );
    await db.query("insert into stub_instructors (user_id) values ('instructeur-1'), ('instructeur-2'), ('autre-ville')");
    const id = await insertRequest();
    await record(id);
    const notes = await q<{ user_id: string; kind: string; payload: Record<string, unknown> }>(
      "select user_id, kind, payload from notifications order by user_id",
    );
    expect(notes.map((n) => n.user_id)).toEqual(["instructeur-1", "instructeur-2"]);
    expect(notes.every((n) => n.kind === "citizen_replied" && n.payload.pieces === 0)).toBe(true);
    expect(JSON.stringify(notes)).not.toContain("TEXTE PRIVÉ");
  });

  it("le motif citizen_replied est admis par les contraintes", async () => {
    await expect(db.query("insert into notifications (user_id, kind) values ('x', 'citizen_replied')")).resolves.toBeDefined();
    await expect(db.query("insert into notifications (user_id, kind) values ('x', 'inconnu')")).rejects.toThrow();
    await expect(db.query("insert into notification_preferences (user_id, kind) values ('x', 'citizen_replied')")).resolves.toBeDefined();
  });
});
