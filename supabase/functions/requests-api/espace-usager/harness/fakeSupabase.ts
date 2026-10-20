/**
 * Un client `@supabase/supabase-js` de test, adossé à PGlite : la chaîne
 * `from().select().eq()…` est traduite en SQL réel sur le schéma réduit
 * (`irisDb.ts`), `rpc()` appelle les vraies fonctions SQL des migrations.
 *
 * Il ne reconnaît que les formes utilisées par `requests-api` pour
 * l'authentification, l'audit et la vue usager. Toute autre est une erreur
 * franche (un test qui sort de ce périmètre doit étendre le harnais, pas être
 * silencieusement faux).
 *
 * Les sélections de colonnes sont transmises telles quelles au SQL : une
 * colonne que le schéma réduit n'a pas fait échouer le test, ce qui garde les
 * constantes `CITIZEN_*_SELECT` honnêtes.
 */
import type { PGlite } from "@electric-sql/pglite";

type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

const IDENT = /^[a-z_][a-z0-9_.]*$/;

function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

class Query implements PromiseLike<Result> {
  private action: "select" | "update" | "insert" = "select";
  private cols = "*";
  private values: Record<string, unknown> = {};
  private filters: { col: string; op: "=" | "<" | ">="; value: unknown }[] = [];
  private orFilter: string | null = null;
  private orders: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private single = false;
  private head = false;

  constructor(
    private db: PGlite,
    private table: string,
  ) {}

  select(cols = "*", options?: { head?: boolean; count?: string }) {
    if (this.action === "select") this.cols = cols;
    this.head = options?.head === true;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.action = "update";
    this.values = values;
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.action = "insert";
    this.values = values;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, op: "=", value });
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push({ col, op: "<", value });
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push({ col, op: ">=", value });
    return this;
  }
  or(expression: string) {
    this.orFilter = expression;
    return this;
  }
  order(col: string, options?: { ascending?: boolean }) {
    this.orders.push({ col, asc: options?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<Result> {
    try {
      if (this.action === "insert") return await this.runInsert();
      if (this.action === "update") return await this.runUpdate();
      return await this.runSelect();
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code } };
    }
  }

  private where(params: unknown[]): string {
    const parts: string[] = [];
    for (const f of this.filters) {
      if (!IDENT.test(f.col)) throw new Error("colonne non prévue : " + f.col);
      params.push(f.value);
      parts.push(`${f.col} ${f.op} $${params.length}`);
    }
    if (this.orFilter !== null) {
      // Seule forme émise par `handleCitizenContactRequests` : received_at.lt."X",and(received_at.eq."X",id.lt.Y)
      const m = this.orFilter.match(/^received_at\.lt\."([^"]+)",and\(received_at\.eq\."\1",id\.lt\.([0-9a-f-]{36})\)$/i);
      if (!m) throw new Error("filtre or() non prévu : " + this.orFilter);
      params.push(m[1], m[2]);
      parts.push(`(received_at < $${params.length - 1} or (received_at = $${params.length - 1} and id < $${params.length}))`);
    }
    return parts.length === 0 ? "" : " where " + parts.join(" and ");
  }

  private async runSelect(): Promise<Result> {
    // Les deux lectures « embarquées » de l'authentification, écrites à la main.
    if (this.table === "integration_credentials" && this.cols.includes("source:integration_sources")) return this.authLookup();
    if (this.table === "organizations" && this.cols.includes("integration_sources(")) return this.tenantLookup();

    const params: unknown[] = [];
    let sql = `select ${this.head ? "count(*)::int as n" : this.cols} from public.${this.table}${this.where(params)}`;
    if (!this.head) {
      if (this.orders.length > 0) sql += " order by " + this.orders.map((o) => `${o.col} ${o.asc ? "asc" : "desc"}`).join(", ");
      if (this.max !== null) sql += ` limit ${Math.floor(this.max)}`;
    }
    const rows = (await this.db.query(sql, params)).rows.map(plain) as Record<string, unknown>[];
    if (this.head) return { data: null, error: null, count: (rows[0]?.n as number) ?? 0 };
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  private async runUpdate(): Promise<Result> {
    const params: unknown[] = [];
    const sets = Object.entries(this.values).map(([k, v]) => {
      if (!IDENT.test(k)) throw new Error("colonne non prévue : " + k);
      params.push(v);
      return `${k} = $${params.length}`;
    });
    await this.db.query(`update public.${this.table} set ${sets.join(", ")}${this.where(params)}`, params);
    return { data: null, error: null };
  }

  private async runInsert(): Promise<Result> {
    const keys = Object.keys(this.values);
    for (const k of keys) if (!IDENT.test(k)) throw new Error("colonne non prévue : " + k);
    await this.db.query(
      `insert into public.${this.table} (${keys.join(", ")}) values (${keys.map((_, i) => "$" + (i + 1)).join(", ")})`,
      keys.map((k) => this.values[k]),
    );
    return { data: null, error: null };
  }

  /** `integration_credentials` + sa source + l'organisation de la source, comme PostgREST les emboîte. */
  private async authLookup(): Promise<Result> {
    const hash = this.filters.find((f) => f.col === "key_hash")?.value;
    const row = (
      await this.db.query(
        `select c.id, c.scopes, c.expires_at, c.revoked_at, s.id as s_id, s.code, s.status, s.organization_id,
                o.id as o_id, o.socle_org_id, o.name
           from public.integration_credentials c
           join public.integration_sources s on s.id = c.integration_source_id
           left join public.organizations o on o.id = s.organization_id
          where c.key_hash = $1`,
        [hash],
      )
    ).rows[0] as Record<string, unknown> | undefined;
    if (!row) return { data: null, error: null };
    const p = plain(row) as Record<string, unknown>;
    return {
      data: {
        id: p.id,
        scopes: p.scopes,
        expires_at: p.expires_at,
        revoked_at: p.revoked_at,
        source: {
          id: p.s_id,
          code: p.code,
          status: p.status,
          organization_id: p.organization_id,
          organization: p.o_id === null ? null : { id: p.o_id, socle_org_id: p.socle_org_id, name: p.name },
        },
      },
      error: null,
    };
  }

  /** L'organisation d'une racine Socle, avec la source de CE code (clé plateforme). */
  private async tenantLookup(): Promise<Result> {
    const root = this.filters.find((f) => f.col === "socle_org_id")?.value;
    const code = this.filters.find((f) => f.col === "integration_sources.code")?.value;
    const org = (await this.db.query("select id, socle_org_id, name from public.organizations where socle_org_id = $1", [root])).rows[0] as
      | Record<string, unknown>
      | undefined;
    if (!org) return { data: null, error: null };
    const sources = (await this.db.query("select id, status from public.integration_sources where organization_id = $1 and code = $2", [org.id, code])).rows;
    return { data: { ...org, integration_sources: sources }, error: null };
  }
}

export function createFakeSupabase(db: PGlite) {
  return {
    from: (table: string) => new Query(db, table),
    async rpc(name: string, params: Record<string, unknown>): Promise<Result> {
      try {
        const keys = Object.keys(params);
        for (const k of keys) if (!IDENT.test(k)) throw new Error("paramètre non prévu : " + k);
        const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
        const res = await db.query<{ r: unknown }>(`select ${call} as r`, keys.map((k) => params[k]));
        return { data: plain(res.rows[0]?.r ?? null), error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
      }
    },
    storage: {
      from: (bucket: string) => ({
        async createSignedUrl(path: string, seconds: number, options?: { download?: string }) {
          return {
            data: { signedUrl: `https://storage.test/${bucket}/${path}?exp=${seconds}&dl=${encodeURIComponent(options?.download ?? "")}` },
            error: null,
          };
        },
      }),
    },
  };
}
