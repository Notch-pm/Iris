// sync-socle-referentiel — synchronisation du miroir d'organisations Socle et
// du cache léger des démarches, pour tous les tenants Iris.
// Auth : UN SEUL mode — en-tête x-cron-secret === env CRON_SECRET (503 si non
// configuré). La clé plateforme Socle vit en secret d'edge function, jamais
// ailleurs. Aucun CORS : jamais appelée depuis un navigateur.

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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
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
  if (req.method !== "POST") {
    return json(405, { error: { code: "method_not_allowed", message: "POST attendu." } });
  }
  const cronSecret = Deno.env.get("CRON_SECRET");
  const socleUrl = Deno.env.get("SOCLE_API_URL");
  const socleKey = Deno.env.get("SOCLE_API_KEY");
  if (!cronSecret || !socleUrl || !socleKey) {
    return json(503, {
      error: {
        code: "not_configured",
        message: "Secrets manquants : CRON_SECRET, SOCLE_API_URL et SOCLE_API_KEY sont requis.",
      },
    });
  }
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return json(401, { error: { code: "unauthorized", message: "Secret invalide." } });
  }

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ kind: "socle-referentiel" })
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

    // Soft-delete de ce qui a disparu du périmètre (jamais de DELETE).
    const syncedOrgIds = new Set(plan.orgRows.map((r) => r.socle_id));
    const { data: existingOrgs } = await supabase
      .from("socle_organizations")
      .select("id, socle_id")
      .is("obsoleted_at", null);
    const staleOrgIds = (existingOrgs ?? []).filter((r) => !syncedOrgIds.has(r.socle_id)).map((r) => r.id);
    if (staleOrgIds.length > 0) {
      await supabase.from("socle_organizations").update({ obsoleted_at: now }).in("id", staleOrgIds);
    }

    const syncedProcIds = new Set(plan.procRows.map((r) => r.socle_id));
    const { data: existingProcs } = await supabase
      .from("socle_procedure_cache")
      .select("socle_id")
      .is("obsoleted_at", null);
    const staleProcIds = (existingProcs ?? [])
      .filter((r) => !syncedProcIds.has(r.socle_id))
      .map((r) => r.socle_id);
    if (staleProcIds.length > 0) {
      await supabase.from("socle_procedure_cache").update({ obsoleted_at: now }).in("socle_id", staleProcIds);
    }

    // Rafraîchissement du nom d'affichage des tenants.
    for (const t of plan.tenantNames) {
      await supabase.from("organizations").update({ name: t.name }).eq("id", t.organizationId);
    }

    const counters = {
      ...plan.counters,
      organizations_obsoleted: staleOrgIds.length,
      procedures_obsoleted: staleProcIds.length,
    };
    if (run) {
      await supabase
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), status: "success", counters })
        .eq("id", run.id);
    }
    return json(200, { status: "success", counters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await supabase
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), status: "error", error: message })
        .eq("id", run.id);
    }
    console.error("sync-socle-referentiel:", message);
    return json(500, { error: { code: "internal_error", message: "Synchronisation en échec — voir sync_runs." } });
  }
});
