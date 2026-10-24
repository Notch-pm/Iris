/**
 * Suites PO du 2026-10-24 — `20261024100000_reponse_usager_suites_po.sql` sur
 * PGlite :
 *   · B11 : la reprise d'instruction par une réponse de l'usager ne produit
 *     plus de `status_changed` — `citizen_replied` porte `reprise` ;
 *   · B10 : `file_citizen_piece` verse au dossier une pièce reçue en réponse.
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

async function insertRequest(extra: { status?: string; assigned?: string | null } = {}) {
  await setting("app.service", "1");
  const [row] = await q<{ id: string }>(
    "insert into requests (organization_id, reference, status, assigned_to, subject) values ($1, $2, $3, $4, 'Nid-de-poule') returning id",
    [ORG, `DEM-${crypto.randomUUID().slice(0, 8)}`, extra.status ?? "en_instruction", extra.assigned ?? null],
  );
  await setting("app.service", "");
  return row.id;
}

async function upload(requestId: string) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into attachment_uploads (id, organization_id, integration_source_id, storage_path, file_name, mime_type, file_size, checksum)
     values ($1, $2, $3, $4, 'justificatif.pdf', 'application/pdf', 100, 'ck')`,
    [id, ORG, source, `${ORG}/${requestId}/${id}-justificatif.pdf`],
  );
  return id;
}

const record = (requestId: string, items: string[] = []) =>
  q("select public.record_citizen_message($1, $2, $3, 'invite', null, 'Voici la pièce.', $4::jsonb)", [
    requestId, ORG, source, JSON.stringify(items.map((upload_id) => ({ upload_id }))),
  ]);

/** Une réponse de l'usager avec une pièce : rend l'id de la pièce de l'échange. */
async function citizenPiece(requestId: string) {
  await record(requestId, [await upload(requestId)]);
  const [a] = await q<{ id: string }>("select id from request_attachments where citizen_message_id is not null and request_id = $1", [requestId]);
  return a.id;
}

/** Un agent authentifié, avec ou sans droit d'instruction. */
async function asAgent(right: boolean) {
  await setting("app.uid", AGENT);
  await setting("app.right", right ? "1" : "");
}

const file = (attachmentId: string, key: string | null = null, replaces: string | null = null) =>
  q<{ r: { attachment_id: string; remplacees: number } }>(
    "select public.file_citizen_piece($1, $2, $3) as r", [attachmentId, key, replaces],
  ).then((rows) => rows[0].r);

beforeEach(async () => {
  db = await freshIrisDb();
  await db.query("insert into organizations (id, socle_org_id, name) values ($1, $1, 'Sceaux')", [ORG]);
  const [s] = await q<{ id: string }>("insert into integration_sources (code, organization_id) values ('portail-citoyen', null) returning id");
  source = s.id;
  await setting("app.uid", "");
  await setting("app.right", "");
  await setting("app.service", "");
});

describe("B11 — une seule notification pour la réponse de l'usager", () => {
  it("demande en attente : citizen_replied avec reprise, pas de status_changed", async () => {
    const id = await insertRequest({ status: "en_attente", assigned: "agent-assigne" });
    await record(id);
    const notes = await q<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from notifications");
    expect(notes.map((n) => n.kind)).toEqual(["citizen_replied"]);
    expect(notes[0].payload).toMatchObject({ reprise: true, status: "en_attente" });
    expect((await q("select status from requests where id = $1", [id]))[0].status).toBe("en_instruction");
  });

  it("sans affectataire : le fan-out porte aussi reprise", async () => {
    await db.query("insert into organization_members (organization_id, user_id) values ($1, 'instructeur-1')", [ORG]);
    await db.query("insert into stub_instructors (user_id) values ('instructeur-1')");
    const id = await insertRequest({ status: "en_attente" });
    await record(id);
    const notes = await q<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from notifications");
    expect(notes.map((n) => [n.kind, n.payload.reprise])).toEqual([["citizen_replied", true]]);
  });

  it("demande déjà en instruction : reprise false", async () => {
    const id = await insertRequest({ status: "en_instruction", assigned: "agent-assigne" });
    await record(id);
    const notes = await q<{ payload: Record<string, unknown> }>("select payload from notifications");
    expect(notes[0].payload.reprise).toBe(false);
  });

  it("le drapeau ne survit pas : un changement de statut ordinaire notifie toujours", async () => {
    const id = await insertRequest({ status: "en_attente", assigned: "agent-assigne" });
    await record(id);
    await setting("app.service", "1");
    await db.query("update requests set status = 'en_attente' where id = $1", [id]);
    await setting("app.service", "");
    const kinds = (await q<{ kind: string }>("select kind from notifications order by created_at")).map((n) => n.kind);
    expect(kinds).toEqual(["citizen_replied", "status_changed"]);
    expect((await q("select coalesce(current_setting('iris.reprise_usager', true), '') v"))[0].v).toBe("");
  });
});

describe("B10 — verser au dossier une pièce reçue en réponse", () => {
  it("crée une pièce du dossier liée à l'original ; l'original reste dans l'échange", async () => {
    const id = await insertRequest();
    const original = await citizenPiece(id);
    await asAgent(true);
    const res = await file(original, "justificatif_domicile");
    const rows = await q<Record<string, unknown>>(
      "select id, storage_path, form_field_key, citizen_message_id, source_attachment_id, kind, uploaded_by from request_attachments where request_id = $1 order by created_at, id",
      [id],
    );
    const copy = rows.find((r) => r.id === res.attachment_id)!;
    const src = rows.find((r) => r.id === original)!;
    expect(copy).toMatchObject({
      form_field_key: "justificatif_domicile", citizen_message_id: null,
      source_attachment_id: original, kind: "demande", uploaded_by: null,
      storage_path: src.storage_path,
    });
    expect(src.citizen_message_id).not.toBeNull();
    const [event] = await q<{ payload: Record<string, unknown>; created_by: string }>(
      "select payload, created_by from request_events where event_type = 'piece_ajoutee'",
    );
    expect(event.created_by).toBe(AGENT);
    expect(event.payload).toMatchObject({ origine: "reponse_usager", source_attachment_id: original, remplacees: 0 });
  });

  it("« la plus récente fait foi » sur l'exigence ; jamais une pièce d'échange", async () => {
    const id = await insertRequest();
    await setting("app.service", "1");
    const [old] = await q<{ id: string }>(
      "insert into request_attachments (organization_id, request_id, file_name, form_field_key, storage_path) values ($1, $2, 'ancien.pdf', 'justificatif_domicile', 'x') returning id",
      [ORG, id],
    );
    await setting("app.service", "");
    const original = await citizenPiece(id);
    await asAgent(true);
    const res = await file(original, "justificatif_domicile");
    expect(res.remplacees).toBe(1);
    expect((await q("select superseded_by from request_attachments where id = $1", [old.id]))[0].superseded_by).toBe(res.attachment_id);
    expect((await q("select superseded_by from request_attachments where id = $1", [original]))[0].superseded_by).toBeNull();
  });

  it("une seule fois par pièce", async () => {
    const id = await insertRequest();
    const original = await citizenPiece(id);
    await asAgent(true);
    await file(original);
    const error = await file(original).then(() => null, (e: { code?: string }) => e);
    expect(error?.code).toBe("P0409");
  });

  it("refus : sans droit d'instruction, pièce hors échange, demande close, sans authentification", async () => {
    const id = await insertRequest();
    const original = await citizenPiece(id);

    await expect(file(original)).rejects.toThrow(/authentification/);
    await asAgent(false);
    await expect(file(original)).rejects.toThrow(/droit d'instruction/);

    await asAgent(true);
    const copy = await file(original);
    await expect(file(copy.attachment_id)).rejects.toThrow(/réponse en ligne/);

    const closedId = await insertRequest();
    const closedPiece = await citizenPiece(closedId);
    await setting("app.service", "1");
    await db.query("update requests set status = 'resolue_negative' where id = $1", [closedId]);
    await setting("app.service", "");
    await asAgent(true);
    await expect(file(closedPiece)).rejects.toThrow(/close/);
  });

  it("aucune EXECUTE pour anon", async () => {
    const [g] = await q<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'public.file_citizen_piece(uuid, text, uuid)', 'execute') anon, has_function_privilege('authenticated', 'public.file_citizen_piece(uuid, text, uuid)', 'execute') auth",
    );
    expect(g).toEqual({ anon: false, auth: true });
  });
});
