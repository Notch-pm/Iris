// sync-socle-referentiel — synchronisation, pour tous les tenants Iris, du
// miroir d'organisations Socle, du cache léger des démarches ET du serveur
// d'envoi (SMTP) de l'organisation principale : le Socle en est propriétaire
// (onglet « Emails (SMTP) » de la racine), Iris n'en tient qu'un miroir.
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
  buildActivationRows,
  buildSyncPlan,
  type OrgActivation,
  type SocleCategory,
  type SocleOrg,
  type SocleProcedure,
  type TenantRef,
} from "./_shared/mapping.ts";
import { smtpMirrorArgs, smtpWarning, type SocleSmtpDto } from "./_shared/smtp.ts";

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

/** Lectures `?enabled_for=` menées de front. Une par organisation du sous-arbre. */
const ACTIVATION_BATCH = 4;

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

/** Message lisible d'une erreur — `PostgrestError` n'est pas une instance d'`Error`. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/**
 * Serveur d'envoi d'une organisation principale. À la différence des autres
 * lectures, un statut d'erreur n'est pas une exception : une clé sans le scope
 * `smtp` (403) ou un Socle antérieur à cette route (404) doivent laisser la
 * synchronisation du référentiel réussir, avec un avertissement.
 */
async function fetchSocleSmtp(
  base: string,
  key: string,
  socleOrgId: string,
): Promise<{ status: number; dto: SocleSmtpDto | null }> {
  const res = await fetch(`${base}/v1/organizations/${socleOrgId}/smtp`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { status: res.status, dto: null };
  return { status: res.status, dto: (await res.json()) as SocleSmtpDto };
}

/**
 * Activations d'UNE organisation : `GET /v1/procedures?enabled_for=<org>` rend
 * les démarches du catalogue racine qu'elle propose (`is_enabled = true`).
 *
 * ⚠️ C'est la SEULE lecture possible de l'information : le DTO `Procedure` du
 * Socle ne dit jamais qui a activé quoi, et la route inverse
 * `GET /v1/organization-procedures` n'est branchée sur aucun endpoint. D'où un
 * appel par organisation du sous-arbre — 8 pour une agglomération comme ACCM.
 * Le filtre n'est PAS récursif : interroger la racine ne dit rien des filles.
 *
 * Rend `null` en cas d'échec plutôt que de lever : une organisation muette ne
 * doit pas faire échouer toute la synchronisation, mais elle interdit de
 * conclure « plus rien n'est activé » — l'appelant renonce alors à périmer quoi
 * que ce soit pour ce tenant.
 */
async function fetchActivations(
  base: string,
  key: string,
  socleOrgId: string,
): Promise<OrgActivation | null> {
  try {
    const res = await fetch(`${base}/v1/procedures?enabled_for=${socleOrgId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const rows = await res.json() as { id?: unknown }[] | null;
    if (!Array.isArray(rows)) return null;
    return {
      socleOrgId,
      procedureIds: rows
        .map((r) => (typeof r?.id === "string" ? r.id : null))
        .filter((id): id is string => id !== null),
    };
  } catch {
    return null;
  }
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

    // ---- Activation des démarches par organisation (Socle organization_procedures)
    // Un appel `?enabled_for=` par organisation du sous-arbre : le DTO Socle ne
    // rend l'information dans aucun autre sens. Par lots, pour ne pas ouvrir 8,
    // 20 ou 50 connexions d'un coup au référentiel.
    const activations: OrgActivation[] = [];
    const activationFailures = new Set<string>();  // tenants dont une lecture a échoué
    const orgsToProbe = plan.orgRows.map((o) => ({
      socleOrgId: o.socle_id,
      tenantId: o.organization_id,
    }));
    for (let i = 0; i < orgsToProbe.length; i += ACTIVATION_BATCH) {
      const batch = orgsToProbe.slice(i, i + ACTIVATION_BATCH);
      const results = await Promise.all(
        batch.map((o) => fetchActivations(base, socleKey, o.socleOrgId)),
      );
      results.forEach((result, k) => {
        if (result) activations.push(result);
        else activationFailures.add(batch[k].tenantId);
      });
    }
    const activationRows = buildActivationRows(plan.orgRows, plan.procRows, activations);
    if (activationRows.length > 0) {
      const { error } = await supabase
        .from("socle_procedure_organizations")
        .upsert(
          activationRows.map((r) => ({ ...r, synced_at: now, obsoleted_at: null })),
          { onConflict: "organization_id,socle_procedure_id,socle_org_id" },
        );
      if (error) throw error;
    }

    // ⚠️ Avec une clé Socle LIÉE (non plateforme), seul le sous-arbre de sa
    // racine est visible : les miroirs des autres tenants passeraient en
    // obsolete. On ne marque obsolète que les lignes des tenants dont la racine
    // EST visible dans la réponse Socle (périmètre réellement observé).
    const visibleRoots = new Set(orgs.filter((o) => !o.parent_id).map((o) => o.id));
    const observedTenants = tenants.filter((t) => visibleRoots.has(t.socleOrgId));
    const observedTenantIds = observedTenants.map((t) => t.organizationId);

    let staleOrgCount = 0;
    let staleProcCount = 0;
    let staleActivationCount = 0;
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

      // Activations disparues = démarches DÉSACTIVÉES depuis la dernière
      // synchro. On ne périme que les tenants dont TOUTES les organisations ont
      // répondu : une seule lecture manquée et « rien n'est activé ici » devient
      // indiscernable de « le Socle n'a pas répondu ». Comme la garde t18 refuse
      // ce qui n'est pas au miroir, périmer sur un silence fermerait le guichet.
      const trustedTenantIds = observedTenantIds.filter((id) => !activationFailures.has(id));
      if (trustedTenantIds.length > 0) {
        const kept = new Set(
          activationRows.map((r) => `${r.organization_id}|${r.socle_procedure_id}|${r.socle_org_id}`),
        );
        const { data: existingLinks } = await supabase
          .from("socle_procedure_organizations")
          .select("organization_id, socle_procedure_id, socle_org_id")
          .in("organization_id", trustedTenantIds)
          .is("obsoleted_at", null);
        const stale = (existingLinks ?? []).filter(
          (r) => !kept.has(`${r.organization_id}|${r.socle_procedure_id}|${r.socle_org_id}`),
        );
        staleActivationCount = stale.length;
        for (const row of stale) {
          await supabase
            .from("socle_procedure_organizations")
            .update({ obsoleted_at: now })
            .eq("organization_id", row.organization_id)
            .eq("socle_procedure_id", row.socle_procedure_id)
            .eq("socle_org_id", row.socle_org_id);
        }
      }
    }

    // Rafraîchissement du nom d'affichage des tenants.
    for (const t of plan.tenantNames) {
      await supabase.from("organizations").update({ name: t.name }).eq("id", t.organizationId);
    }

    // Avertissements : ce qui n'a pas pu être fait sans pour autant faire
    // échouer la synchronisation. Journalisés dans `sync_runs.counters`.
    const warnings: string[] = [];

    // Serveur d'envoi (SMTP) — le Socle en est propriétaire, Iris n'en tient
    // qu'un miroir. Seuls les tenants du périmètre RÉELLEMENT observé sont
    // relus : avec une clé Socle liée à une racine (décision PO : clé scopée,
    // pas plateforme), les autres tenants sont hors de portée et n'ont pas à
    // encombrer le journal.
    //
    // Un tenant qui échoue ne fait échouer ni les autres, ni la synchronisation
    // du référentiel : son miroir reste en l'état et un avertissement dit quoi
    // faire. Le mot de passe ne transite que d'ici vers la RPC de service, qui
    // le range au Vault — il n'apparaît dans aucun journal.
    let smtpSynchronises = 0;
    let smtpRetires = 0;
    for (const tenant of observedTenants) {
      try {
        const { status, dto } = await fetchSocleSmtp(base, socleKey, tenant.socleOrgId);
        if (status !== 200) {
          warnings.push(smtpWarning(tenant, status));
          continue;
        }
        const args = smtpMirrorArgs(tenant, dto);
        if (args) {
          const { error } = await supabase.rpc("sync_smtp_settings_from_socle", args);
          if (error) throw error;
          smtpSynchronises++;
        } else {
          // Le Socle ne déclare plus de relais exploitable : le miroir s'efface
          // (l'envoi retombera sur le relais de plateforme), il ne survit pas à
          // sa source.
          const { data: retire, error } = await supabase
            .rpc("clear_smtp_settings_from_socle", { p_org_id: tenant.organizationId });
          if (error) throw error;
          if (retire === true) smtpRetires++;
        }
      } catch (err) {
        const message = errorMessage(err);
        console.error(`sync-socle-referentiel smtp ${tenant.organizationId}:`, message);
        warnings.push(`serveur d'envoi (tenant ${tenant.organizationId}) : ${message}`);
      }
    }

    // Une lecture d'activation manquée laisse le miroir en l'état — il faut le
    // DIRE : la garde t18 s'appuie dessus, et un miroir figé qu'on croit frais
    // se manifesterait plus tard par une démarche désactivée encore proposée.
    if (activationFailures.size > 0) {
      warnings.push(
        `activations non relues pour ${activationFailures.size} tenant(s) : le miroir des `
          + `démarches activées a été laissé en l'état (aucune désactivation appliquée).`,
      );
    }

    // Recalcul du périmètre porteur des droits (profils de droits, ADR-14) :
    // le miroir vient de bouger (nouvelles organisations, reparentages,
    // obsolescences), certaines demandes peuvent devoir changer de
    // socle_scope_org_id. Une erreur ici est journalisée en avertissement,
    // jamais fatale : la sync du référentiel reste réussie.
    let requestsScopeRecalculees = 0;
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
      activations: activationRows.length,
      activations_obsoletes: staleActivationCount,
      requests_scope_recalculees: requestsScopeRecalculees,
      smtp_synchronises: smtpSynchronises,
      smtp_retires: smtpRetires,
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
    const message = errorMessage(err);
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
