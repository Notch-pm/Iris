// sync-socle-referentiel — synchronisation du miroir d'organisations Socle et
// du cache léger des démarches, pour tous les tenants Iris.
// Auth — DEUX modes, motif Clara (sync-socle-referentiel) :
//   - en-tête x-cron-secret === env CRON_SECRET (pg_cron quotidien) ;
//   - JWT d'un ADMIN PLATEFORME (public.users.is_platform_admin), vérifié en
//     code (verify_jwt=false : préflights OPTIONS) — bouton « Synchroniser
//     maintenant » de la zone superadmin.
// La clé plateforme Socle vit en secret d'edge function, jamais ailleurs.
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev), comme admin-users.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildSyncPlan,
  type SocleCategory,
  type SocleOrg,
  type SocleProcedure,
  type TenantRef,
} from "./_shared/mapping.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}

/**
 * Qui déclenche ? `cron` (secret) ou l'id d'un admin plateforme (JWT). Toute
 * autre situation → null (401). Le secret est comparé AVANT toute lecture de
 * base ; le JWT est vérifié via auth.getUser puis public.users (service role).
 */
async function resolveTrigger(req: Request): Promise<string | null> {
  const providedSecret = req.headers.get("x-cron-secret");
  if (providedSecret) {
    const cronSecret = Deno.env.get("CRON_SECRET");
    return cronSecret && providedSecret === cronSecret ? "cron" : null;
  }
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return null;
  const { data: caller } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  return caller?.is_platform_admin ? userData.user.id : null;
}

async function fetchSocle<T>(base: string, key: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Socle ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, 405, { error: { code: "method_not_allowed", message: "POST attendu." } });
  }
  const socleUrl = Deno.env.get("SOCLE_API_URL");
  const socleKey = Deno.env.get("SOCLE_API_KEY");
  const missing = [
    !socleUrl ? "SOCLE_API_URL" : null,
    !socleKey ? "SOCLE_API_KEY" : null,
    req.headers.has("x-cron-secret") && !Deno.env.get("CRON_SECRET") ? "CRON_SECRET" : null,
  ].filter((n): n is string => n !== null);
  if (missing.length > 0) {
    return json(req, 503, {
      error: { code: "not_configured", message: `Secrets manquants : ${missing.join(", ")}.` },
    });
  }
  const triggeredBy = await resolveTrigger(req);
  if (!triggeredBy) {
    return json(req, 401, {
      error: { code: "unauthorized", message: "Réservé au cron ou aux administrateurs plateforme." },
    });
  }

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ kind: "socle-referentiel", counters: { triggered_by: triggeredBy } })
    .select("id")
    .single();

  try {
    const { data: tenantRows, error: tenantsError } = await supabase
      .from("organizations")
      .select("id, socle_org_id");
    if (tenantsError) throw tenantsError;
    const tenants: TenantRef[] = (tenantRows ?? []).map((t) => ({
      organizationId: t.id,
      socleOrgId: t.socle_org_id,
    }));

    const base = socleUrl.replace(/\/+$/, "");
    const [orgs, categories, procedures] = await Promise.all([
      fetchSocle<SocleOrg[]>(base, socleKey, "/v1/organizations"),
      fetchSocle<SocleCategory[]>(base, socleKey, "/v1/categories"),
      fetchSocle<SocleProcedure[]>(base, socleKey, "/v1/procedures"),
    ]);

    const plan = buildSyncPlan(tenants, orgs, categories, procedures);
    const now = new Date().toISOString();

    if (plan.orgRows.length > 0) {
      const { error } = await supabase
        .from("socle_organizations")
        .upsert(
          plan.orgRows.map((r) => ({ ...r, synced_at: now, obsoleted_at: null })),
          { onConflict: "organization_id,socle_id" },
        );
      if (error) throw error;
    }
    if (plan.procRows.length > 0) {
      const { error } = await supabase
        .from("socle_procedure_cache")
        .upsert(
          plan.procRows.map((r) => ({ ...r, synced_at: now, obsoleted_at: null })),
          { onConflict: "socle_id" },
        );
      if (error) throw error;
    }

    // ⚠️ Avec une clé Socle LIÉE (non plateforme), seul le sous-arbre de sa
    // racine est visible : les miroirs des autres tenants passeraient en
    // obsolete. On ne marque obsolète que les lignes des tenants dont la racine
    // EST visible dans la réponse Socle (périmètre réellement observé).
    const visibleRoots = new Set(orgs.filter((o) => !o.parent_id).map((o) => o.id));
    const observedTenantIds = tenants
      .filter((t) => visibleRoots.has(t.socleOrgId))
      .map((t) => t.organizationId);

    let staleOrgCount = 0;
    let staleProcCount = 0;
    if (observedTenantIds.length > 0) {
      const syncedOrgIds = new Set(plan.orgRows.map((r) => r.socle_id));
      const { data: existingOrgs } = await supabase
        .from("socle_organizations")
        .select("id, socle_id")
        .in("organization_id", observedTenantIds)
        .is("obsoleted_at", null);
      const staleOrgIds = (existingOrgs ?? []).filter((r) => !syncedOrgIds.has(r.socle_id)).map((r) => r.id);
      staleOrgCount = staleOrgIds.length;
      if (staleOrgIds.length > 0) {
        await supabase.from("socle_organizations").update({ obsoleted_at: now }).in("id", staleOrgIds);
      }

      const syncedProcIds = new Set(plan.procRows.map((r) => r.socle_id));
      const { data: existingProcs } = await supabase
        .from("socle_procedure_cache")
        .select("socle_id")
        .in("organization_id", observedTenantIds)
        .is("obsoleted_at", null);
      const staleProcIds = (existingProcs ?? [])
        .filter((r) => !syncedProcIds.has(r.socle_id))
        .map((r) => r.socle_id);
      staleProcCount = staleProcIds.length;
      if (staleProcIds.length > 0) {
        await supabase.from("socle_procedure_cache").update({ obsoleted_at: now }).in("socle_id", staleProcIds);
      }
    }

    // Rafraîchissement du nom d'affichage des tenants.
    for (const t of plan.tenantNames) {
      await supabase.from("organizations").update({ name: t.name }).eq("id", t.organizationId);
    }

    // Recalcul du périmètre porteur des droits (profils de droits, ADR-14) :
    // le miroir vient de bouger (nouvelles organisations, reparentages,
    // obsolescences), certaines demandes peuvent devoir changer de
    // socle_scope_org_id. Une erreur ici est journalisée en avertissement,
    // jamais fatale : la sync du référentiel reste réussie.
    let requestsScopeRecalculees = 0;
    const warnings: string[] = [];
    const { data: scopeRecalc, error: scopeError } = await supabase
      .rpc("refresh_request_scope_org", { p_org_id: null });
    if (scopeError) {
      console.error("sync-socle-referentiel refresh_request_scope_org:", scopeError);
      warnings.push(`refresh_request_scope_org : ${scopeError.message}`);
    } else {
      requestsScopeRecalculees = typeof scopeRecalc === "number" ? scopeRecalc : 0;
    }

    const counters = {
      triggered_by: triggeredBy,
      ...plan.counters,
      tenants_observes: observedTenantIds.length,
      organizations_obsoleted: staleOrgCount,
      procedures_obsoleted: staleProcCount,
      requests_scope_recalculees: requestsScopeRecalculees,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    if (run) {
      await supabase
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), status: "success", counters })
        .eq("id", run.id);
    }
    return json(req, 200, { status: "success", counters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await supabase
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), status: "error", error: message })
        .eq("id", run.id);
    }
    console.error("sync-socle-referentiel:", message);
    return json(req, 500, { error: { code: "internal_error", message: "Synchronisation en échec — voir sync_runs." } });
  }
});
