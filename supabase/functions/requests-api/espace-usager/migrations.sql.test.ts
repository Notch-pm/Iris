/**
 * Les migrations de l'espace usager d'Iris sur PGlite :
 *   · `20261019150000_acces_usager_invite.sql`  — accès invité (code, verrou, accusé) ;
 *   · `20261020150000_espace_usager_mes_demandes.sql` — `citizen_visible`, t13, t14.
 * Schéma réduit + doublures de droits : voir `harness/irisDb.ts`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { freshIrisDb } from "./harness/irisDb.ts";

let db: PGlite;
const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const setting = (name: string, value: string) => db.exec(`select set_config('${name}', '${value}', false)`);

const ORG = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ORG2 = "aaaaaaaa-0000-4000-8000-0000000000b2";
const AGENT = "99999999-9999-4999-8999-999999999999";
const H = (c: string) => c.repeat(64);

async function insertRequest(org: string, reference: string, extra: { source?: string; contact?: string | null; closedAt?: string | null; visible?: boolean } = {}) {
  await setting("app.service", "1");
  const res = await q<{ id: string }>(
    `insert into requests (organization_id, reference, source, socle_contact_id, closed_at${extra.visible === undefined ? "" : ", citizen_visible"})
     values ($1, $2, $3, $4, $5${extra.visible === undefined ? "" : ", $6"}) returning id`,
    [org, reference, extra.source ?? "portail-citoyen", extra.contact ?? null, extra.closedAt ?? null, ...(extra.visible === undefined ? [] : [extra.visible])],
  );
  await setting("app.service", "");
  return res[0].id;
}

beforeEach(async () => {
  db = await freshIrisDb();
  await db.query("insert into organizations (id, socle_org_id, name) values ($1, $1, 'Sceaux'), ($2, $2, 'Antony')", [ORG, ORG2]);
  await setting("app.uid", "");
  await setting("app.right", "");
  await setting("app.service", "");
});

describe("fermeture", () => {
  it("la table des accès : RLS activée, aucune politique, aucun droit pour anon/authenticated", async () => {
    const [t] = await q("select relrowsecurity from pg_class where relname = 'request_access_codes'");
    expect(t.relrowsecurity).toBe(true);
    expect(await q("select * from pg_policies where tablename = 'request_access_codes'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      const [p] = await q(`select has_table_privilege('${role}', 'public.request_access_codes', 'select') s, has_table_privilege('${role}', 'public.request_access_codes', 'insert') i`);
      expect(p).toEqual({ s: false, i: false });
    }
  });

  it("les RPC d'accès : service_role seulement", async () => {
    const fns = ["public.register_request_access(uuid, text, text, text, text)", "public.check_request_access(uuid, text, text, text, text)", "public.claim_request_receipts(int)", "public.settle_request_receipt(uuid, boolean, text)", "public.skip_request_receipt(uuid, text)"];
    for (const fn of fns) {
      const [p] = await q(
        `select has_function_privilege('anon', '${fn}', 'execute') a, has_function_privilege('authenticated', '${fn}', 'execute') u,
                has_function_privilege('public', '${fn}', 'execute') p, has_function_privilege('service_role', '${fn}', 'execute') s`,
      );
      expect(p, fn).toEqual({ a: false, u: false, p: false, s: true });
    }
  });

  it("la garde t14 n'est exécutable par personne en direct", async () => {
    const [p] = await q(`select has_function_privilege('authenticated', 'public.requests_guard_citizen_visibility()', 'execute') u, has_function_privilege('anon', 'public.requests_guard_citizen_visibility()', 'execute') a`);
    expect(p).toEqual({ u: false, a: false });
  });
});

describe("citizen_visible — t13 (naissance) et t14 (garde)", () => {
  it("une demande du portail naît visible, une demande issue de Clara naît masquée — même si l'insertion demandait le contraire", async () => {
    const portal = await insertRequest(ORG, "DEM-1");
    const clara = await insertRequest(ORG, "DEM-2", { source: "clara" });
    const claraForced = await insertRequest(ORG, "DEM-3", { source: "clara", visible: true });
    const rows = await q<{ id: string; citizen_visible: boolean }>("select id, citizen_visible from requests");
    const visible = (id: string) => rows.find((r) => r.id === id)!.citizen_visible;
    expect([visible(portal), visible(clara), visible(claraForced)]).toEqual([true, false, false]);
  });

  it("les autres sources restent visibles par défaut (guichet, téléphone…)", async () => {
    const id = await insertRequest(ORG, "DEM-4", { source: "guichet" });
    expect((await q("select citizen_visible from requests where id = $1", [id]))[0].citizen_visible).toBe(true);
  });

  it("t14 : sans le droit d'instruction ni le contexte service, changer la visibilité est refusé", async () => {
    const id = await insertRequest(ORG, "DEM-5", { source: "clara" });
    await setting("app.uid", AGENT);
    await expect(db.exec(`update requests set citizen_visible = true where id = '${id}'`)).rejects.toThrow(/droit d'instruction/);
    await expect(db.exec(`update requests set citizen_visible = false where id = '${await insertRequest(ORG, "DEM-6")}'`)).rejects.toThrow(/droit d'instruction/);
    expect((await q("select citizen_visible from requests where id = $1", [id]))[0].citizen_visible).toBe(false);
  });

  it("t14 : un agent AYANT le droit d'instruction rend visible une demande Clara, ou en soustrait une autre", async () => {
    const clara = await insertRequest(ORG, "DEM-7", { source: "clara" });
    const portal = await insertRequest(ORG, "DEM-8");
    await setting("app.uid", AGENT);
    await setting("app.right", "1");
    await db.exec(`update requests set citizen_visible = true where id = '${clara}'`);
    await db.exec(`update requests set citizen_visible = false where id = '${portal}'`);
    const rows = await q<{ id: string; citizen_visible: boolean }>("select id, citizen_visible from requests");
    expect(rows.find((r) => r.id === clara)!.citizen_visible).toBe(true);
    expect(rows.find((r) => r.id === portal)!.citizen_visible).toBe(false);
  });

  it("t14 : le service (edge functions) change la visibilité sans droit utilisateur", async () => {
    const id = await insertRequest(ORG, "DEM-9", { source: "clara" });
    await setting("app.service", "1");
    await db.exec(`update requests set citizen_visible = true where id = '${id}'`);
    expect((await q("select citizen_visible from requests where id = $1", [id]))[0].citizen_visible).toBe(true);
  });

  it("t14 ne gêne pas les autres colonnes : un agent sans droit d'instruction met à jour le statut", async () => {
    const id = await insertRequest(ORG, "DEM-10");
    await setting("app.uid", AGENT);
    await db.exec(`update requests set status = 'en_instruction' where id = '${id}'`);
    await db.exec(`update requests set citizen_visible = true where id = '${id}'`); // même valeur : pas un changement
    expect((await q("select status from requests where id = $1", [id]))[0].status).toBe("en_instruction");
  });

  it("le rattrapage historique a masqué les demandes Clara déjà présentes (et seulement elles)", async () => {
    // Rejoue l'instruction de rattrapage de la migration sur un jeu hétérogène.
    await setting("app.service", "1");
    await db.exec("alter table requests disable trigger user");
    await db.exec(`insert into requests (organization_id, reference, source, citizen_visible) values ('${ORG}', 'OLD-1', 'clara', true), ('${ORG}', 'OLD-2', 'portail-citoyen', true)`);
    await db.exec("update requests set citizen_visible = false where source = 'clara'");
    await db.exec("alter table requests enable trigger user");
    const rows = await q("select reference, citizen_visible from requests where reference like 'OLD-%' order by reference");
    expect(rows).toEqual([{ reference: "OLD-1", citizen_visible: false }, { reference: "OLD-2", citizen_visible: true }]);
  });

  it("l'index de « Mes demandes » est partiel : fiche renseignée ET visible", async () => {
    const [idx] = await q("select indexdef from pg_indexes where indexname = 'requests_org_contact_citizen_idx'");
    expect(idx.indexdef).toMatch(/socle_contact_id IS NOT NULL/i);
    expect(idx.indexdef).toMatch(/citizen_visible/);
    expect(idx.indexdef).toMatch(/received_at DESC, id DESC/);
  });
});

describe("check_request_access", () => {
  const check = (org: string, source: string, ref: string, email: string, code: string) =>
    q<{ r: string | null }>("select public.check_request_access($1, $2, $3, $4, $5) as r", [org, source, ref, email, code]).then((rows) => rows[0].r);

  async function withAccess(ref: string, org = ORG, extra: Parameters<typeof insertRequest>[2] = {}) {
    const id = await insertRequest(org, ref, extra);
    await db.query("insert into request_access_codes (request_id, organization_id, code_hash, email_hash) values ($1, $2, $3, $4)", [id, org, H("c"), H("e")]);
    return id;
  }

  it("bons éléments : la demande ; référence saisie en minuscules et avec espaces", async () => {
    const id = await withAccess("DEM-2026-000001");
    expect(await check(ORG, "portail-citoyen", "DEM-2026-000001", H("e"), H("c"))).toBe(id);
    expect(await check(ORG, "portail-citoyen", "  dem-2026-000001 ", H("e"), H("c"))).toBe(id);
  });

  it("inconnue, autre collectivité, autre source, mauvaise adresse, mauvais code : toujours NULL", async () => {
    await withAccess("DEM-2026-000001");
    const refused = [
      await check(ORG, "portail-citoyen", "DEM-2026-999999", H("e"), H("c")),
      await check(ORG2, "portail-citoyen", "DEM-2026-000001", H("e"), H("c")),
      await check(ORG, "clara", "DEM-2026-000001", H("e"), H("c")),
      await check(ORG, "portail-citoyen", "DEM-2026-000001", H("f"), H("c")),
      await check(ORG, "portail-citoyen", "DEM-2026-000001", H("e"), H("d")),
    ];
    expect(refused).toEqual([null, null, null, null, null]);
  });

  it("la même référence existe dans deux collectivités : chacune ne voit que la sienne", async () => {
    const a = await withAccess("DEM-2026-000001", ORG);
    const b = await withAccess("DEM-2026-000001", ORG2);
    expect(await check(ORG, "portail-citoyen", "DEM-2026-000001", H("e"), H("c"))).toBe(a);
    expect(await check(ORG2, "portail-citoyen", "DEM-2026-000001", H("e"), H("c"))).toBe(b);
  });

  it("5 mauvais codes (bonne adresse) verrouillent une heure ; le compteur repart après le verrou", async () => {
    const id = await withAccess("DEM-1");
    for (let i = 0; i < 5; i++) expect(await check(ORG, "portail-citoyen", "DEM-1", H("e"), H("d"))).toBeNull();
    const [lock] = await q("select failed_attempts, locked_until > now() + interval '59 minutes' as ok from request_access_codes where request_id = $1", [id]);
    expect(lock).toEqual({ failed_attempts: 0, ok: true });
    expect(await check(ORG, "portail-citoyen", "DEM-1", H("e"), H("c"))).toBeNull(); // le bon code, verrouillé
    await db.query("update request_access_codes set locked_until = now() - interval '1 second'");
    expect(await check(ORG, "portail-citoyen", "DEM-1", H("e"), H("c"))).toBe(id);
  });

  it("une adresse fausse n'est jamais comptée (pas de verrouillage de masse par énumération)", async () => {
    const id = await withAccess("DEM-1");
    for (let i = 0; i < 50; i++) await check(ORG, "portail-citoyen", "DEM-1", H("f"), H("d"));
    expect((await q("select failed_attempts from request_access_codes where request_id = $1", [id]))[0].failed_attempts).toBe(0);
  });

  it("l'accès expire 90 jours après la clôture, pas avant", async () => {
    const old = await withAccess("DEM-OLD", ORG, { closedAt: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    const recent = await withAccess("DEM-NEW", ORG, { closedAt: new Date(Date.now() - 89 * 86_400_000).toISOString() });
    expect(await check(ORG, "portail-citoyen", "DEM-OLD", H("e"), H("c"))).toBeNull();
    expect(await check(ORG, "portail-citoyen", "DEM-NEW", H("e"), H("c"))).toBe(recent);
    expect(old).not.toBe(recent);
  });

  it("empreintes : seulement 64 caractères hexadécimaux en base (jamais un code ni une adresse en clair)", async () => {
    const id = await insertRequest(ORG, "DEM-2");
    await expect(db.query("insert into request_access_codes (request_id, organization_id, code_hash, email_hash) values ($1, $2, 'ABCD-EFGH-JK', $3)", [id, ORG, H("e")])).rejects.toThrow();
    await expect(db.query("insert into request_access_codes (request_id, organization_id, code_hash, email_hash) values ($1, $2, $3, 'a@b.fr')", [id, ORG, H("c")])).rejects.toThrow();
  });

  it("l'adresse de suivi est https, sans excès", async () => {
    const id = await insertRequest(ORG, "DEM-3");
    for (const url of ["http://x.fr/suivi", "javascript:alert(1)", "https://" + "a".repeat(500)]) {
      await expect(db.query("insert into request_access_codes (request_id, organization_id, code_hash, email_hash, tracking_url) values ($1, $2, $3, $4, $5)", [id, ORG, H("c"), H("e"), url])).rejects.toThrow();
    }
    await db.query("insert into request_access_codes (request_id, organization_id, code_hash, email_hash, tracking_url) values ($1, $2, $3, $4, 'https://sceaux.edilumen.fr/suivi')", [id, ORG, H("c"), H("e")]);
  });
});

describe("register_request_access et file des accusés", () => {
  it("ouvre l'accès UNE seule fois, enfile l'accusé et lui confie le code en clair (service seul)", async () => {
    const id = await insertRequest(ORG, "DEM-1");
    const first = await q<{ r: boolean }>("select public.register_request_access($1, $2, $3, 'https://sceaux.edilumen.fr/suivi', 'ABCD-EFGH-JK') as r", [id, H("c"), H("e")]);
    expect(first[0].r).toBe(true);
    const second = await q<{ r: boolean }>("select public.register_request_access($1, $2, $3, null, 'WXYZ-WXYZ-WX') as r", [id, H("a"), H("b")]);
    expect(second[0].r).toBe(false);
    expect((await q("select access_code from request_receipts where request_id = $1", [id]))[0].access_code).toBe("ABCD-EFGH-JK");
    expect((await q("select code_hash from request_access_codes where request_id = $1", [id]))[0].code_hash).toBe(H("c"));
    // Une demande inconnue n'ouvre rien.
    expect((await q<{ r: boolean }>("select public.register_request_access($1, $2, $3, null, 'ABCD-EFGH-JK') as r", [crypto.randomUUID(), H("c"), H("e")]))[0].r).toBe(false);
  });

  it("le code en clair n'a que la forme XXXX-XXXX-XX", async () => {
    const id = await insertRequest(ORG, "DEM-2");
    await q("select public.enqueue_request_receipt($1)", [id]);
    for (const bad of ["abcd-efgh-jk", "ABCDEFGHJK", "ABCD-EFGH-JK-LM", "<script>"]) {
      await expect(db.query("update request_receipts set access_code = $1", [bad])).rejects.toThrow();
    }
  });

  it("le code en clair est oublié dès que l'accusé est réglé ou abandonné", async () => {
    const id = await insertRequest(ORG, "DEM-3");
    await q("select public.register_request_access($1, $2, $3, null, 'ABCD-EFGH-JK')", [id, H("c"), H("e")]);
    await q("select public.skip_request_receipt($1, 'aucun relais d''envoi')", [id]);
    expect((await q("select status, access_code from request_receipts where request_id = $1", [id]))[0]).toEqual({ status: "skipped", access_code: null });
  });
});
