/**
 * Le « monde » d'un test de la vue usager d'Iris : `requests-api/index.ts` RÉEL
 * (chargé avec un `Deno` minimal), son client Supabase remplacé par
 * `fakeSupabase` (PGlite + vraies migrations), deux collectivités, une clé
 * plateforme de portail.
 *
 * Les tests s'écrivent comme le portail Nora : `world.call("GET", path, { token })`.
 */
import type { PGlite } from "@electric-sql/pglite";
import { vi } from "vitest";
import { accessCodeHash, accessEmailHash, normalizeAccessCode } from "../../../_shared/access/accessCode.ts";
import { sha256Hex } from "../../_shared/hash.ts";
import { signCitizenToken } from "../../_shared/citizenToken.ts";
import { createFakeSupabase } from "./fakeSupabase.ts";
import { freshIrisDb } from "./irisDb.ts";

export const SCEAUX_ROOT = "8f1e0d3a-0000-4000-8000-0000000000a1";
export const ANTONY_ROOT = "8f1e0d3a-0000-4000-8000-0000000000b2";
export const KEY = "irs_test_portail_citoyen_key";
export const PEPPER = "p".repeat(40);
export const TOKEN_SECRET = "t".repeat(48);

export interface Tenant {
  orgId: string;
  root: string;
  name: string;
}

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
  text: string;
}

export interface CallOptions {
  key?: string | null;
  tenant?: string | null;
  token?: string | null;
  json?: unknown;
  body?: string;
}

const ENV: Record<string, string> = {
  SUPABASE_URL: "http://nora.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  IRIS_ACCESS_CODE_PEPPER: PEPPER,
  IRIS_CITIZEN_TOKEN_SECRET: TOKEN_SECRET,
};

type Handler = (request: Request) => Promise<Response>;

export class IrisWorld {
  db!: PGlite;
  sceaux!: Tenant;
  antony!: Tenant;
  env: Record<string, string | undefined> = { ...ENV };
  private handler!: Handler;
  floorWaits: number[] = [];
  private realSetTimeout = globalThis.setTimeout;
  realTime = false;

  static async create(
    envOverrides: Record<string, string | undefined> = {},
    options: { realTime?: boolean } = {},
  ): Promise<IrisWorld> {
    const world = new IrisWorld();
    world.realTime = options.realTime === true;
    world.env = { ...ENV, ...envOverrides };
    world.db = await freshIrisDb();
    await world.seed();
    await world.boot();
    return world;
  }

  private async seed(): Promise<void> {
    this.sceaux = await this.addTenant("Ville de Sceaux", SCEAUX_ROOT);
    this.antony = await this.addTenant("Ville d'Antony", ANTONY_ROOT);
    // La clé PLATEFORME du portail : une source sans collectivité, scope citoyen.
    const platform = await this.db.query<{ id: string }>(
      "insert into integration_sources (code, organization_id) values ('portail-citoyen', null) returning id",
    );
    await this.db.query(
      "insert into integration_credentials (integration_source_id, key_hash, scopes) values ($1, $2, $3)",
      [platform.rows[0].id, await sha256Hex(KEY), ["requests:write", "requests:citizen"]],
    );
  }

  private async addTenant(name: string, root: string): Promise<Tenant> {
    const org = await this.db.query<{ id: string }>("insert into organizations (socle_org_id, name) values ($1, $2) returning id", [root, name]);
    await this.db.query("insert into integration_sources (code, organization_id) values ('portail-citoyen', $1)", [org.rows[0].id]);
    return { orgId: org.rows[0].id, root, name };
  }

  /** Une clé supplémentaire (scopes choisis, état choisi) — pour tester les refus d'authentification. */
  async addKey(key: string, scopes: string[], extra: { revoked?: boolean; expired?: boolean; suspended?: boolean } = {}): Promise<void> {
    const source = await this.db.query<{ id: string }>(
      "insert into integration_sources (code, status, organization_id) values ('portail-citoyen', $1, null) returning id",
      [extra.suspended ? "suspended" : "active"],
    );
    await this.db.query(
      "insert into integration_credentials (integration_source_id, key_hash, scopes, revoked_at, expires_at) values ($1, $2, $3, $4, $5)",
      [
        source.rows[0].id,
        await sha256Hex(key),
        scopes,
        extra.revoked ? new Date().toISOString() : null,
        extra.expired ? new Date(Date.now() - 1000).toISOString() : new Date(Date.now() + 86_400_000).toISOString(),
      ],
    );
  }

  private async boot(): Promise<void> {
    vi.unstubAllGlobals();
    if (!this.realTime) {
      const real = this.realSetTimeout;
      vi.stubGlobal("setTimeout", (fn: () => void, ms?: number, ...args: unknown[]) => {
        if (typeof ms === "number" && ms >= 100) {
          this.floorWaits.push(ms);
          return real(fn, 0, ...args);
        }
        return real(fn, ms, ...args);
      });
    }
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (name: string) => this.env[name] },
      serve: (handler: Handler) => {
        this.handler = handler;
      },
    };
    vi.resetModules();
    vi.doMock("npm:@supabase/supabase-js@2", () => ({ createClient: () => createFakeSupabase(this.db) }));
    const entry = "../../index.ts";
    await import(/* @vite-ignore */ entry);
  }

  async close(): Promise<void> {
    vi.unstubAllGlobals();
    vi.doUnmock("npm:@supabase/supabase-js@2");
    delete (globalThis as Record<string, unknown>).Deno;
  }

  async call(method: string, path: string, options: CallOptions = {}): Promise<Reply> {
    const headers = new Headers();
    const key = options.key === undefined ? KEY : options.key;
    if (key !== null) headers.set("authorization", `Bearer ${key}`);
    const tenant = options.tenant === undefined ? SCEAUX_ROOT : options.tenant;
    if (tenant !== null) headers.set("x-socle-root-organization-id", tenant);
    if (options.token) headers.set("x-citizen-token", options.token);
    if (options.json !== undefined) headers.set("content-type", "application/json");
    const response = await this.handler(
      new Request(`http://iris.test/requests-api${path}`, {
        method,
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      }),
    );
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body, headers: response.headers, text };
  }

  /** Un jeton court, signé comme le portail le fait. */
  token(
    subject: { kind: "contact"; id: string; email?: string | null } | { kind: "request"; id: string },
    overrides: { tenant?: string; ttl?: number; now?: number; secret?: string; v?: number } = {},
  ): Promise<string> {
    const now = overrides.now ?? Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      v: overrides.v ?? 1,
      t: overrides.tenant ?? SCEAUX_ROOT,
      sub: `${subject.kind}:${subject.id}`,
      exp: now + (overrides.ttl ?? 120),
    };
    if (subject.kind === "contact" && subject.email) payload.e = subject.email;
    return signCitizenToken(overrides.secret ?? TOKEN_SECRET, payload);
  }

  // ── Jeux de données ──────────────────────────────────────────────────────

  async addRequest(tenant: Tenant, partial: Record<string, unknown> = {}): Promise<{ id: string; reference: string }> {
    this.counter += 1;
    const row = {
      reference: `DEM-2026-${String(this.counter).padStart(6, "0")}`,
      source: "portail-citoyen",
      subject: "Signaler un problème de voirie",
      procedure_snapshot: JSON.stringify({ name: "Voirie" }),
      body: "CORPS INTERNE DU DOSSIER",
      closure_motif: "MOTIF INTERNE : doublon, usager récidiviste",
      assigned_to: "Agent Martin Dupont",
      received_at: new Date(Date.UTC(2026, 9, 1, 8, 0, this.counter)).toISOString(),
      ...partial,
    };
    const keys = Object.keys(row);
    // `service` : le déclencheur t14 laisse le service poser `citizen_visible` (jeu de test).
    await this.db.exec("select set_config('app.service', '1', false)");
    const res = await this.db.query<{ id: string; reference: string }>(
      `insert into requests (organization_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => "$" + (i + 2)).join(", ")}) returning id, reference`,
      [tenant.orgId, ...keys.map((k) => (row as Record<string, unknown>)[k])],
    );
    await this.db.exec("select set_config('app.service', '', false)");
    return res.rows[0];
  }

  async addEmail(requestId: string, partial: Record<string, unknown> = {}): Promise<string> {
    const row = { to_email: "usager@example.org", subject: "Votre demande", body: "Bonjour", sent_at: new Date().toISOString(), status: "envoye", sent_by: "Agent Martin Dupont", ...partial };
    const keys = Object.keys(row);
    const res = await this.db.query<{ id: string }>(
      `insert into request_emails (request_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => "$" + (i + 2)).join(", ")}) returning id`,
      [requestId, ...keys.map((k) => (row as Record<string, unknown>)[k])],
    );
    return res.rows[0].id;
  }

  async addAttachment(requestId: string, partial: Record<string, unknown> = {}): Promise<string> {
    const row = { file_name: "justificatif.pdf", mime_type: "application/pdf", file_size: 1234, kind: "demande", storage_path: `org/${requestId}/justificatif.pdf`, ...partial };
    const keys = Object.keys(row);
    const res = await this.db.query<{ id: string }>(
      `insert into request_attachments (request_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => "$" + (i + 2)).join(", ")}) returning id`,
      [requestId, ...keys.map((k) => (row as Record<string, unknown>)[k])],
    );
    return res.rows[0].id;
  }

  async addNote(requestId: string, body = "NOTE INTERNE : ne pas communiquer"): Promise<void> {
    await this.db.query("insert into request_messages (request_id, kind, body, author_id) values ($1, 'note', $2, 'Agent Martin Dupont')", [requestId, body]);
  }

  /** Ouvre un accès invité (code + adresse) sur une demande, comme `register_request_access`. */
  async openGuestAccess(requestId: string, tenant: Tenant, email: string, code = "ABCD-EFGH-JK"): Promise<void> {
    const normalized = normalizeAccessCode(code)!;
    await this.db.query(
      "insert into request_access_codes (request_id, organization_id, code_hash, email_hash) values ($1, $2, $3, $4)",
      [requestId, tenant.orgId, await accessCodeHash(PEPPER, normalized), await accessEmailHash(PEPPER, email.trim().toLowerCase())],
    );
  }

  async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(query, params)).rows;
  }

  private counter = 0;
}
