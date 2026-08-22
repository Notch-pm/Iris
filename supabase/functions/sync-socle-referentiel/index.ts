// sync-socle-referentiel — synchronisation du miroir d'organisations Socle et
// du cache léger des démarches, pour tous les tenants Iris.
// Auth — DEUX modes, motif Clara (sync-socle-referentiel) :
//   - en-tête x-cron-secret === env CRON_SECRET (pg_cron quotidien) ;
//   - JWT vérifié en code (verify_jwt=false : préflights OPTIONS) :
//       · ADMIN PLATEFORME (public.users.is_platform_admin) → tous les tenants,
//         ou un seul si `organization_id` est fourni (zone superadmin) ;
//       · ADMINISTRATEUR DE TENANT (organization_members.role dérivé des profils
//         de droits) → UNIQUEMENT son tenant, `organization_id` obligatoire
//         (Paramètres › Référentiel). Le périmètre est dérivé de l'appelant :
//         un tenant demandé hors de ses droits → 403, jamais un repli global.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SyncScope {
  /** `cron` ou l'id de l'utilisateur déclencheur. */
  triggeredBy: string;
  /** null = tous les tenants ; sinon l'id (Iris) du seul tenant synchronisé. */
  organizationId: string | null;
}

/**
 * Qui déclenche, et sur quel périmètre ? Le périmètre est DÉRIVÉ de
 * l'appelant, jamais accepté tel quel du payload :
 *   - secret cron → tous les tenants (ou un seul si demandé) ;
 *   - admin plateforme → idem ;
 *   - administrateur d'un tenant (organization_members.role = administrateur,
 *     colonne dérivée des profils de droits) → ce tenant seulement, qui DOIT
 *     être demandé explicitement.
 * Retourne une Response d'erreur sinon (401/403/404, messages français).
 */
async function resolveScope(req: Request, requestedOrgId: string | null): Promise<SyncScope | Response> {
  const providedSecret = req.headers.get("x-cron-secret");
  if (providedSecret) {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || providedSecret !== cronSecret) {
      return json(req, 401, { error: { code: "unauthorized", message: "Secret invalide." } });
    }
    return { triggeredBy: "cron", organizationId: requestedOrgId };
  }
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return json(req, 401, { error: { code: "unauthorized", message: "Session invalide." } });
  }
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) {
    return json(req, 401, { error: { code: "unauthorized", message: "Session invalide." } });
  }
  const userId = userData.user.id;
  const { data: caller } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", userId)
    .maybeSingle();
  if (caller?.is_platform_admin) {
    return { triggeredBy: userId, organizationId: requestedOrgId };
  }
  if (!requestedOrgId) {
    return json(req, 403, {
      error: { code: "forbidden", message: "La synchronisation globale est réservée aux administrateurs plateforme." },
    });
  }
  // Administrateur du tenant demandé ? Hors périmètre = 404 (jamais révélé).
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", requestedOrgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) {
    return json(req, 404, { error: { code: "not_found", message: "Ressource introuvable." } });
  }
  if (membership.role !== "administrateur") {
    return json(req, 403, {
      error: { code: "forbidden", message: "La synchronisation du référentiel est réservée aux administrateurs du tenant." },
    });
  }
  return { triggeredBy: userId, organizationId: requestedOrgId };
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
  // Corps optionnel : { organization_id?: uuid } (tenant Iris ciblé).
  const body = await req.json().catch(() => null) as { organization_id?: unknown } | null;
  const requestedRaw = body?.organization_id;
  if (requestedRaw !== undefined && requestedRaw !== null
      && (typeof requestedRaw !== "string" || !UUID_RE.test(requestedRaw))) {
    return json(req, 400, { error: { code: "bad_request", message: "organization_id : UUID du tenant attendu." } });
  }
  const requestedOrgId = typeof requestedRaw === "string" ? requestedRaw : null;

  const scope = await resolveScope(req, requestedOrgId);
  if (scope instanceof Response) return scope;
  const { triggeredBy, organizationId: scopeOrgId } = scope;

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({
      kind: "socle-referentiel",
      counters: { triggered_by: triggeredBy, scope: scopeOrgId ?? "all" },
    })
    .select("id")
    .single();

  try {
    let tenantQuery = supabase.from("organizations").select("id, socle_org_id");
    if (scopeOrgId) tenantQuery = tenantQuery.eq("id", scopeOrgId);
    const { data: tenantRows, error: tenantsError } = await tenantQuery;
    if (tenantsError) throw tenantsError;
    if (scopeOrgId && (tenantRows ?? []).length === 0) {
      throw new Error(`Tenant ${scopeOrgId} introuvable.`);
    }
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
      .rpc("refresh_request_scope_org", { p_org_id: scopeOrgId });
    if (scopeError) {
      console.error("sync-socle-referentiel refresh_request_scope_org:", scopeError);
      warnings.push(`refresh_request_scope_org : ${scopeError.message}`);
    } else {
      requestsScopeRecalculees = typeof scopeRecalc === "number" ? scopeRecalc : 0;
    }

    const counters = {
      triggered_by: triggeredBy,
      scope: scopeOrgId ?? "all",
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
