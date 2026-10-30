// sync-socle-users — agents gérés par le Socle (annuaire des agents, lot 3).
//
// Le Socle OUVRE l'accès à Iris (`GET /v1/users`, public-api 1.43.0, scope
// `users` sur SOCLE_API_KEY) ; il ne donne aucun rôle : les profils de droits
// restent attribués dans Iris (décision du 2026-10-30). Pour chaque tenant :
//   - accès ouvert ⇒ compte créé au besoin (lien d'activation par le relais du
//     tenant) et appartenance SANS profil ;
//   - accès retiré ⇒ compte banni s'il n'a plus d'accès nulle part (appartenance
//     et profils conservés), sinon il quitte ce tenant ;
//   - admin plateforme jamais touché. Logique pure : logic.ts.
//
// Modes (corps JSON) : `incremental` (défaut, cron chaque minute, depuis le
// curseur du tenant) ou `full` (cron nocturne, liste complète + agents rattachés
// absents). `organization_id` borne à un tenant ; `dry_run: true` n'écrit rien.
//
// Habilitation : x-cron-secret === CRON_SECRET (pg_cron), ou JWT d'un admin
// plateforme.

import { createClient } from "npm:@supabase/supabase-js@2";

import { resolveSmtp, type SmtpRow } from "../_shared/email/config.ts";
import { authEmailContent, brandFor } from "../_shared/email/messages.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";
import { activeInTenant, missingFromFullList, planAccount, readSocleAgents, type SocleAgent } from "./logic.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = (Deno.env.get("IRIS_APP_URL") ?? "http://localhost:5174").replace(/\/+$/, "");
/** Bannissement « définitif » (≈ 100 ans) : le compte reste, la connexion est refusée. */
const BAN_DURATION = "876000h";
const SOCLE_TIMEOUT_MS = 20_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function authorized(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const expected = Deno.env.get("CRON_SECRET");
    return Boolean(expected) && secret === expected;
  }
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return false;
  const { data: caller } = await supabase.from("users").select("is_platform_admin").eq("id", data.user.id).maybeSingle();
  return caller?.is_platform_admin === true;
}

async function fetchAgents(socleOrgId: string, since: string | null): Promise<Response> {
  const url = (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SOCLE_API_KEY")?.trim();
  if (!url || !key) throw new Error("SOCLE_API_URL / SOCLE_API_KEY manquant.");
  const params = new URLSearchParams({ tenant_id: socleOrgId });
  if (since) params.set("updated_since", since);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOCLE_TIMEOUT_MS);
  try {
    return await fetch(`${url}/v1/users?${params}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Lien d'activation au premier accès — même message qu'`admin-users`. */
async function sendInvitation(orgId: string, agent: SocleAgent): Promise<string | null> {
  try {
    const { data: link, error } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: agent.email,
      options: { redirectTo: `${APP_URL}/activer-compte` },
    });
    if (error || !link?.properties?.hashed_token) throw new Error("lien d'activation impossible");
    const { data } = await supabase.rpc("smtp_config_for_org", { p_org_id: orgId });
    const row = ((Array.isArray(data) ? data[0] : null) ?? null) as (SmtpRow & { organization_name?: string | null }) | null;
    const smtp = resolveSmtp(row, Deno.env.toObject());
    if (!smtp) throw new Error("aucun serveur d'envoi");
    const actionUrl = new URL(`${APP_URL}/activer-compte`);
    actionUrl.searchParams.set("token_hash", link.properties.hashed_token);
    actionUrl.searchParams.set("type", "invite");
    const tenantName = row?.organization_name ?? null;
    const content = authEmailContent("invite", {
      tenantName,
      recipientName: [agent.first_name, agent.last_name].filter(Boolean).join(" ") || null,
      actionUrl: actionUrl.toString(),
    });
    await sendBrandedEmail(smtp, agent.email, content, brandFor(tenantName));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Counters {
  agents: number;
  created: number;
  memberships_added: number;
  memberships_removed: number;
  banned: number;
  unbanned: number;
  skipped: string[];
  invitation_errors: string[];
}

interface UserRow {
  id: string;
  email: string;
  is_platform_admin: boolean;
  socle_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
}
const USER_COLUMNS = "id, email, is_platform_admin, socle_user_id, first_name, last_name";

async function findUser(agent: SocleAgent): Promise<UserRow | null> {
  const { data: bySocle } = await supabase.from("users").select(USER_COLUMNS).eq("socle_user_id", agent.socle_user_id).maybeSingle();
  if (bySocle) return bySocle as UserRow;
  const { data: byEmail } = await supabase.from("users").select(USER_COLUMNS).eq("email", agent.email).maybeSingle();
  const row = byEmail as UserRow | null;
  // Déjà rattaché à un AUTRE agent du Socle : on ne le reprend pas.
  if (row?.socle_user_id && row.socle_user_id !== agent.socle_user_id) return null;
  return row;
}

async function syncAgent(orgId: string, agent: SocleAgent, dryRun: boolean, c: Counters, plans: unknown[]): Promise<void> {
  c.agents++;
  const activeHere = activeInTenant(agent);
  let user = await findUser(agent);

  let hasMembership = false;
  let activeElsewhere = false;
  if (user) {
    const { data: m } = await supabase
      .from("organization_members").select("user_id").eq("organization_id", orgId).eq("user_id", user.id).maybeSingle();
    hasMembership = Boolean(m);
    const { count } = await supabase
      .from("socle_member_access").select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("is_active", true).neq("organization_id", orgId);
    activeElsewhere = (count ?? 0) > 0;
  }
  const plan = planAccount({ activeHere, activeElsewhere, hasMembership, isPlatformAdmin: user?.is_platform_admin === true });

  if (dryRun) {
    plans.push({ email: agent.email, socle_user_id: agent.socle_user_id, iris_user_id: user?.id ?? null, activeHere, ...plan });
    return;
  }
  if (!user && !activeHere) return; // jamais créé pour un agent sans accès

  // 1. Le compte.
  let isNew = false;
  if (!user) {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: agent.email,
      email_confirm: false,
      user_metadata: { first_name: agent.first_name, last_name: agent.last_name },
    });
    if (error || !created.user) {
      c.skipped.push(`${agent.email} : ${error?.message ?? "création refusée"}`);
      return;
    }
    // Le trigger handle_new_user a créé le profil : on pose noms et rattachement.
    await supabase.from("users")
      .update({ first_name: agent.first_name, last_name: agent.last_name, socle_user_id: agent.socle_user_id })
      .eq("id", created.user.id);
    user = { id: created.user.id, email: agent.email, is_platform_admin: false, socle_user_id: agent.socle_user_id, first_name: agent.first_name, last_name: agent.last_name };
    isNew = true;
    c.created++;
  } else {
    const patch: Record<string, unknown> = {};
    if (user.socle_user_id !== agent.socle_user_id) patch.socle_user_id = agent.socle_user_id;
    if (agent.first_name && agent.first_name !== user.first_name) patch.first_name = agent.first_name;
    if (agent.last_name && agent.last_name !== user.last_name) patch.last_name = agent.last_name;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("users").update(patch).eq("id", user.id);
      if (error) throw error;
    }
  }

  if (user.is_platform_admin) return;

  // 2. L'état d'accès donné par le Socle (source du bannissement).
  const { error: stateError } = await supabase.from("socle_member_access").upsert({
    organization_id: orgId,
    user_id: user.id,
    is_active: activeHere,
    updated_at: new Date().toISOString(),
  });
  if (stateError) throw stateError;

  // 3. L'appartenance — sans profil (le rôle est dérivé par Iris, `agent`).
  if (plan.addMembership) {
    const { error } = await supabase
      .from("organization_members").insert({ organization_id: orgId, user_id: user.id, role: "agent" });
    if (error) throw error;
    c.memberships_added++;
  }
  if (plan.removeMembership) {
    const { error } = await supabase
      .from("organization_members").delete().eq("organization_id", orgId).eq("user_id", user.id);
    if (error) throw error;
    c.memberships_removed++;
  }

  // 4. Le compte : banni s'il n'a plus d'accès nulle part.
  if (plan.ban === true) {
    await supabase.auth.admin.updateUserById(user.id, { ban_duration: BAN_DURATION });
    c.banned++;
  } else if (plan.ban === false && !isNew) {
    const { data: auth } = await supabase.auth.admin.getUserById(user.id);
    const bannedUntil = (auth.user as { banned_until?: string | null } | null)?.banned_until;
    if (bannedUntil && Date.parse(bannedUntil) > Date.now()) {
      await supabase.auth.admin.updateUserById(user.id, { ban_duration: "none" });
      c.unbanned++;
    }
  }

  // 5. Lien d'activation au premier accès.
  if (isNew) {
    const failure = await sendInvitation(orgId, agent);
    if (failure) c.invitation_errors.push(`${agent.email} : ${failure}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: { code: "method_not_allowed", message: "POST attendu." } });
  if (!(await authorized(req))) return json(401, { error: { code: "unauthorized", message: "Non autorisé." } });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = body.mode === "full" ? "full" : "incremental";
  const dryRun = body.dry_run === true;
  const onlyTenant = typeof body.organization_id === "string" ? body.organization_id : null;

  let query = supabase.from("organizations").select("id, name, socle_org_id").eq("status", "active");
  if (onlyTenant) query = query.eq("id", onlyTenant);
  const { data: tenants, error } = await query;
  if (error) return json(500, { error: { code: "server_error", message: error.message } });

  const report: Record<string, unknown>[] = [];
  for (const tenant of (tenants ?? []) as Array<{ id: string; name: string; socle_org_id: string }>) {
    const c: Counters = {
      agents: 0, created: 0, memberships_added: 0, memberships_removed: 0, banned: 0, unbanned: 0,
      skipped: [], invitation_errors: [],
    };
    const plans: unknown[] = [];
    const now = new Date().toISOString();
    try {
      const { data: state } = await supabase
        .from("socle_user_sync_state").select("cursor").eq("organization_id", tenant.id).maybeSingle();
      const full = mode === "full" || !state?.cursor;
      const response = await fetchAgents(tenant.socle_org_id, full ? null : state!.cursor);
      if (!response.ok) throw new Error(`Socle ${response.status} : ${(await response.text()).slice(0, 200)}`);
      const { agents, asOf } = readSocleAgents(await response.json());

      for (const agent of agents) await syncAgent(tenant.id, agent, dryRun, c, plans);

      // Réconciliation : les agents rattachés au tenant absents de la liste complète.
      if (full) {
        const { data: managed } = await supabase
          .from("organization_members")
          .select("users!inner(socle_user_id, email)")
          .eq("organization_id", tenant.id)
          .not("users.socle_user_id", "is", null);
        const rows = (managed ?? []) as unknown as Array<{ users: { socle_user_id: string; email: string } }>;
        const missing = new Set(missingFromFullList(rows.map((r) => r.users.socle_user_id), agents));
        for (const r of rows.filter((row) => missing.has(row.users.socle_user_id))) {
          await syncAgent(tenant.id, {
            socle_user_id: r.users.socle_user_id,
            email: r.users.email.toLowerCase(),
            first_name: null,
            last_name: null,
            status: "active",
            is_active: false,
            accesses: [],
          }, dryRun, c, plans);
        }
      }

      if (!dryRun) {
        await supabase.from("socle_user_sync_state").upsert({
          organization_id: tenant.id,
          cursor: asOf,
          last_run_at: now,
          ...(full ? { last_full_sync_at: now } : {}),
          last_error: null,
          updated_at: now,
        });
      }
      report.push({ tenant: tenant.name, mode: full ? "full" : "incremental", ...c, ...(dryRun ? { plans } : {}) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`sync-socle-users: ${tenant.name} :`, message);
      if (!dryRun) {
        await supabase.from("socle_user_sync_state").upsert({
          organization_id: tenant.id, last_run_at: now, last_error: message.slice(0, 500), updated_at: now,
        });
      }
      report.push({ tenant: tenant.name, error: message, ...c });
    }
  }
  return json(200, { mode, dry_run: dryRun, tenants: report });
});
