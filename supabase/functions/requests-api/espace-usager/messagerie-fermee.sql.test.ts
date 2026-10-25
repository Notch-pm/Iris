/**
 * Messagerie de l'usager fermée par défaut (décision PO du 2026-10-25) —
 * `20261025160000_messagerie_usager_ouverture.sql` sur PGlite :
 *   · fermée tant que rien ne l'ouvre : `record_citizen_message` refuse (P0423) ;
 *   · ouverte par une pièce non conforme (`qualify_request_attachment`) ou par
 *     l'agent (`set_citizen_replies_open`, droit d'instruction) ;
 *   · refermée par la réponse de l'usager, par l'agent, par la clôture (t42).
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
const AGENT = "dddddddd-0000-4000-8000-000000000001";
let source: string;

async function insertRequest(status = "en_instruction") {
  await setting("app.service", "1");
  const [row] = await q<{ id: string }>(
    "insert into requests (organization_id, reference, status, subject) values ($1, $2, $3, 'Nid-de-poule') returning id",
    [ORG, `DEM-${crypto.randomUUID().slice(0, 8)}`, status],
  );
  await setting("app.service", "");
  return row.id;
}

async function asAgent(right: boolean) {
  await setting("app.uid", AGENT);
  await setting("app.right", right ? "1" : "");
}

const reply = (requestId: string, body = "Voici la pièce.") =>
  q("select public.record_citizen_message($1, $2, $3, 'invite', null, $4, '[]'::jsonb)", [requestId, ORG, source, body]);

const state = async (requestId: string) =>
  (await q<{ is_open: boolean; opened_reason: string | null; closed_reason: string | null; opened_by: string | null }>(
    "select is_open, opened_reason, closed_reason, opened_by from request_citizen_reply_state where request_id = $1", [requestId],
  ))[0] ?? null;

const setOpen = (requestId: string, open: boolean) =>
  q<{ r: { open: boolean; changed: boolean } }>("select public.set_citizen_replies_open($1, $2) as r", [requestId, open])
    .then((rows) => rows[0].r);

const events = (requestId: string) =>
  q<{ event_type: string; payload: Record<string, unknown> }>(
    "select event_type, payload from request_events where request_id = $1 and event_type like 'messagerie%' order by created_at, id",
    [requestId],
  );

async function piece(requestId: string) {
  const [a] = await q<{ id: string }>(
    "insert into request_attachments (request_id, organization_id, file_name, storage_path) values ($1, $2, 'justificatif.pdf', 'x') returning id",
    [requestId, ORG],
  );
  return a.id;
}
const qualify = (attachmentId: string, compliance: string, motif: string | null = null) =>
  q<{ r: Record<string, unknown> }>("select public.qualify_request_attachment($1, $2, $3) as r", [attachmentId, compliance, motif])
    .then((rows) => rows[0].r);

beforeEach(async () => {
  db = await freshIrisDb();
  await db.query("insert into organizations (id, socle_org_id, name) values ($1, $1, 'Sceaux')", [ORG]);
  const [s] = await q<{ id: string }>("insert into integration_sources (code, organization_id) values ('portail-citoyen', null) returning id");
  source = s.id;
  await setting("app.uid", "");
  await setting("app.right", "");
  await setting("app.service", "");
});

describe("fermée par défaut", () => {
  it("aucune ligne = fermée : la réponse est refusée (P0423), rien n'est écrit, le statut ne bouge pas", async () => {
    const id = await insertRequest("en_attente");
    await expect(reply(id)).rejects.toMatchObject({ code: "P0423" });
    expect(await q("select id from request_citizen_messages")).toEqual([]);
    expect((await q<{ status: string }>("select status from requests where id = $1", [id]))[0].status).toBe("en_attente");
  });

  it("une demande close reste refusée comme close (P0409), même messagerie ouverte en base", async () => {
    const id = await insertRequest("en_instruction");
    await asAgent(true);
    await setOpen(id, true);
    await setting("app.service", "1");
    await q("update requests set status = 'resolue_positive' where id = $1", [id]);
    await setting("app.service", "");
    await expect(reply(id)).rejects.toMatchObject({ code: "P0409" });
  });
});

describe("une pièce non conforme ouvre la messagerie", () => {
  it("non conforme : ouverte, motif non_conformite, journalisée, la demande passe en attente", async () => {
    const id = await insertRequest("en_instruction");
    await asAgent(true);
    const r = await qualify(await piece(id), "non_conforme", "illisible");
    expect(r).toMatchObject({ status: "en_attente", status_changed: true, replies_opened: true });
    expect(await state(id)).toEqual({ is_open: true, opened_reason: "non_conformite", closed_reason: null, opened_by: AGENT });
    expect(await events(id)).toEqual([{ event_type: "messagerie_usager_ouverte", payload: { motif: "non_conformite" } }]);
  });

  it("depuis « À traiter » aussi : le statut ne bouge pas, mais l'usager peut renvoyer la pièce", async () => {
    const id = await insertRequest("a_traiter");
    await asAgent(true);
    expect(await qualify(await piece(id), "non_conforme", "illisible")).toMatchObject({ status_changed: false, replies_opened: true });
    expect((await state(id))?.is_open).toBe(true);
  });

  it("conforme : rien ne s'ouvre ; une seconde non-conformité ne rejournalise pas", async () => {
    const id = await insertRequest("en_instruction");
    await asAgent(true);
    expect(await qualify(await piece(id), "conforme")).toMatchObject({ replies_opened: false });
    expect(await state(id)).toBeNull();
    await qualify(await piece(id), "non_conforme", "illisible");
    expect(await qualify(await piece(id), "non_conforme", "incomplete")).toMatchObject({ replies_opened: false });
    expect(await events(id)).toHaveLength(1);
  });
});

describe("une ouverture = une réponse", () => {
  it("la réponse referme (reponse_usager), sans journal propre ; la suivante est refusée", async () => {
    const id = await insertRequest("en_attente");
    await asAgent(true);
    await setOpen(id, true);
    await setting("app.uid", "");
    await reply(id);
    expect(await state(id)).toMatchObject({ is_open: false, closed_reason: "reponse_usager" });
    expect((await q<{ status: string }>("select status from requests where id = $1", [id]))[0].status).toBe("en_instruction");
    expect((await events(id)).map((e) => e.event_type)).toEqual(["messagerie_usager_ouverte"]);
    await expect(reply(id, "Et encore une chose")).rejects.toMatchObject({ code: "P0423" });
    expect(await q("select id from request_citizen_messages")).toHaveLength(1);
  });

  it("rouverte par l'agent, l'usager peut écrire à nouveau", async () => {
    const id = await insertRequest("en_instruction");
    await asAgent(true);
    await setOpen(id, true);
    await reply(id);
    await setOpen(id, true);
    await reply(id, "La seconde pièce.");
    expect(await q("select id from request_citizen_messages")).toHaveLength(2);
  });
});

describe("set_citizen_replies_open — le geste de l'agent", () => {
  it("exige l'authentification et le droit d'instruction", async () => {
    const id = await insertRequest();
    await expect(setOpen(id, true)).rejects.toThrow(/authentification/);
    await asAgent(false);
    await expect(setOpen(id, true)).rejects.toThrow(/droit d'instruction/);
    expect(await state(id)).toBeNull();
  });

  it("ouvre et ferme, journal à chaque changement, rien quand l'état ne change pas", async () => {
    const id = await insertRequest();
    await asAgent(true);
    expect(await setOpen(id, true)).toMatchObject({ open: true, changed: true });
    expect(await setOpen(id, true)).toMatchObject({ open: true, changed: false });
    expect(await setOpen(id, false)).toMatchObject({ open: false, changed: true });
    expect(await setOpen(id, false)).toMatchObject({ open: false, changed: false });
    expect(await state(id)).toMatchObject({ is_open: false, closed_reason: "agent" });
    expect(await events(id)).toEqual([
      { event_type: "messagerie_usager_ouverte", payload: { motif: "agent" } },
      { event_type: "messagerie_usager_fermee", payload: { motif: "agent" } },
    ]);
  });

  it("une demande close ne s'ouvre pas (P0409) ; la fermer reste permis", async () => {
    const id = await insertRequest("annulee");
    await asAgent(true);
    await expect(setOpen(id, true)).rejects.toMatchObject({ code: "P0409" });
    expect(await setOpen(id, false)).toMatchObject({ changed: false });
  });
});

describe("t42 — la clôture ferme la messagerie", () => {
  it("résolue : fermée (demande_close) ; rouverte en instruction : reste fermée", async () => {
    const id = await insertRequest("en_instruction");
    await asAgent(true);
    await setOpen(id, true);
    await setting("app.service", "1");
    await q("update requests set status = 'resolue_negative' where id = $1", [id]);
    expect(await state(id)).toMatchObject({ is_open: false, closed_reason: "demande_close" });
    await q("update requests set status = 'en_instruction' where id = $1", [id]);
    await setting("app.service", "");
    expect((await state(id))?.is_open).toBe(false);
  });
});

describe("fermeture des portes", () => {
  it("aucune écriture cliente ; la porte interne réservée au service", async () => {
    const [p] = await q<{ ins: boolean; upd: boolean; sel: boolean; inner: boolean; outer: boolean; svc: boolean }>(`
      select has_table_privilege('authenticated', 'public.request_citizen_reply_state', 'insert') ins,
             has_table_privilege('authenticated', 'public.request_citizen_reply_state', 'update') upd,
             has_table_privilege('authenticated', 'public.request_citizen_reply_state', 'select') sel,
             has_function_privilege('authenticated', 'public.set_citizen_replies(uuid, boolean, uuid, text)', 'execute') inner,
             has_function_privilege('authenticated', 'public.set_citizen_replies_open(uuid, boolean)', 'execute') outer,
             has_function_privilege('service_role', 'public.set_citizen_replies(uuid, boolean, uuid, text)', 'execute') svc`);
    expect(p).toEqual({ ins: false, upd: false, sel: true, inner: false, outer: true, svc: true });
    const [anon] = await q<{ x: boolean }>(
      "select has_function_privilege('anon', 'public.set_citizen_replies_open(uuid, boolean)', 'execute') x");
    expect(anon.x).toBe(false);
  });
});
