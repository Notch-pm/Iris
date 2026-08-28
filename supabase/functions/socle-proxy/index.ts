// socle-proxy — relais serveur vers le Socle pour l'UI Iris. La clé Socle vit
// ICI (secret d'edge function), jamais dans le navigateur.
//
// Auth : JWT utilisateur vérifié EN CODE (verify_jwt=false au déploiement :
// la passerelle bloquerait les préflights OPTIONS sans Authorization).
// Périmètre : chaque appel désigne son tenant Iris (organization_id) —
// l'appelant doit en être MEMBRE, et la racine Socle du tenant doit être dans
// le périmètre réel de la clé Socle (introspecté via /v1/organizations,
// mémoïsé) : une clé liée ne peut jamais servir un autre tenant par erreur.
// Jamais de confiance au payload seul.
//
// Iris ne maintient AUCUN miroir d'usagers : tout passe par contacts-api, et
// les réponses sont SANITISÉES (_shared/sanitize.ts — internal_notes,
// consentements, relations : jamais transmis au navigateur).
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  filterContactCreate,
  filterContactListQuery,
  filterContactUpdate,
  filterMatchRequest,
  sanitizeContact,
  sanitizeContactList,
  sanitizeMatches,
  sanitizeProcedureFull,
  sanitizeProcedureSummary,
  sanitizeQuartierList,
} from "./_shared/sanitize.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
function fail(req: Request, status: number, code: string, message: string): Response {
  return json(req, status, { error: { code, message } });
}

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}
function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return publicApiBase().replace("public-api", "contacts-api");
}

async function socleFetch(
  url: string,
  init: RequestInit & { socleOrgId?: string } = {},
): Promise<Response | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("SOCLE_API_KEY")}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  // Toujours dérivé côté serveur du tenant vérifié — jamais du navigateur.
  if (init.socleOrgId) headers["X-Organization-Id"] = init.socleOrgId;
  return await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
}

// Périmètre réel de la clé Socle (racines visibles), mémoïsé 5 minutes.
let keyRootsCache: { roots: Set<string>; at: number } | null = null;
async function getKeyRoots(): Promise<Set<string> | null> {
  if (keyRootsCache && Date.now() - keyRootsCache.at < 300_000) return keyRootsCache.roots;
  const res = await socleFetch(`${publicApiBase()}/v1/organizations`);
  if (!res?.ok) return null;
  // deno-lint-ignore no-explicit-any
  const orgs = await res.json().catch(() => null) as any[] | null;
  if (!Array.isArray(orgs)) return null;
  const roots = new Set(orgs.filter((o) => !o.parent_id).map((o) => o.id as string));
  keyRootsCache = { roots, at: Date.now() };
  return roots;
}

interface TenantContext {
  organizationId: string;
  socleOrgId: string;
}

/** Membre du tenant demandé + tenant dans le périmètre de la clé Socle. */
async function resolveTenant(
  req: Request,
  userId: string,
  organizationId: unknown,
): Promise<TenantContext | Response> {
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) {
    return fail(req, 400, "bad_request", "organization_id : UUID du tenant Iris requis.");
  }
  const { data } = await supabase
    .from("organization_members")
    .select("organization:organizations(id, socle_org_id)")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const org = (data as any)?.organization;
  if (!org) return fail(req, 404, "not_found", "Ressource introuvable.");
  const roots = await getKeyRoots();
  if (!roots) return fail(req, 502, "socle_unavailable", "Le Socle est injoignable.");
  if (!roots.has(org.socle_org_id)) {
    return fail(req, 403, "forbidden",
      "Ce tenant est hors du périmètre de la clé Socle configurée pour Iris.");
  }
  return { organizationId, socleOrgId: org.socle_org_id };
}

function relaySocleError(req: Request, res: Response | null): Response {
  if (!res) return fail(req, 502, "socle_unavailable", "Le Socle est injoignable.");
  if (res.status === 401 || res.status === 403) {
    // Jamais relayer l'erreur d'auth brute du Socle (motif Clara).
    return fail(req, 502, "socle_auth_failed", "Authentification Socle en échec — signaler à un administrateur.");
  }
  if (res.status === 404) return fail(req, 404, "not_found", "Ressource introuvable.");
  return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return fail(req, 405, "method_not_allowed", "POST attendu.");
  }

  const socleUrl = Deno.env.get("SOCLE_API_URL");
  const socleKey = Deno.env.get("SOCLE_API_KEY");
  const missing = [
    !socleUrl ? "SOCLE_API_URL" : null,
    !socleKey ? "SOCLE_API_KEY" : null,
  ].filter((n): n is string => n !== null);
  if (missing.length > 0) {
    return fail(req, 503, "not_configured", `Secrets manquants : ${missing.join(", ")}.`);
  }

  // Authentification de l'agent (JWT de session).
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return fail(req, 401, "unauthorized", "Session invalide.");
  }
  const userId = userData.user.id;

  const path = new URL(req.url).pathname.replace(/^\/socle-proxy/, "") || "/";
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail(req, 400, "bad_request", "Corps JSON attendu.");
  }

  // ── Toutes les routes : tenant explicite + périmètre vérifié.
  const tenant = await resolveTenant(req, userId, body.organization_id);
  if (tenant instanceof Response) return tenant;

  // ── Routes /v1/contacts/* uniquement : au moins un droit de CRÉATION dans
  // le tenant (RM-64). Sans cela, interroger le référentiel des usagers du
  // Socle n'a aucune justification métier. /v1/procedures/* restent ouvertes
  // à tout membre (le cache des démarches est déjà lisible par tout membre).
  if (path.startsWith("/v1/contacts/")) {
    const { data: canCreate, error: rightError } = await supabase.rpc("has_any_creation_right_for", {
      p_user_id: userId,
      p_org_id: tenant.organizationId,
    });
    if (rightError) {
      console.error("socle-proxy has_any_creation_right_for:", rightError);
      return fail(req, 500, "internal_error", "Erreur lors de la vérification des droits.");
    }
    if (!canCreate) {
      return fail(req, 403, "forbidden",
        "Le rapprochement d'usagers exige un droit de création de demande dans ce tenant.");
    }
  }

  if (path === "/v1/procedures/list") {
    const res = await socleFetch(`${publicApiBase()}/v1/procedures`);
    if (!res?.ok) return relaySocleError(req, res);
    // deno-lint-ignore no-explicit-any
    const all = await res.json().catch(() => null) as any[] | null;
    const procedures = (Array.isArray(all) ? all : [])
      .filter((p) => p?.organization_id === tenant.socleOrgId)
      .map(sanitizeProcedureSummary)
      .filter((p) => p !== null);
    return json(req, 200, { procedures });
  }

  if (path === "/v1/procedures/get") {
    const procedureId = typeof body.socle_procedure_id === "string" ? body.socle_procedure_id : "";
    if (!UUID_RE.test(procedureId)) {
      return fail(req, 400, "bad_request", "socle_procedure_id : UUID requis.");
    }
    const res = await socleFetch(`${publicApiBase()}/v1/procedures/${procedureId}`);
    if (!res?.ok) return relaySocleError(req, res);
    // deno-lint-ignore no-explicit-any
    const proc = await res.json().catch(() => null) as any;
    if (!proc || proc.organization_id !== tenant.socleOrgId) {
      return fail(req, 404, "not_found", "Ressource introuvable.");
    }
    return json(req, 200, { procedure: sanitizeProcedureFull(proc) });
  }

  // Quartiers du territoire, AVEC leur géométrie — la carte d'un champ
  // d'adresse les superpose pour que l'agent voie tout de suite si l'adresse
  // saisie tombe où il croit. Ouverte à tout membre du tenant, comme
  // /v1/procedures/* : une limite de quartier n'est pas une donnée
  // personnelle, et le référentiel la calcule déjà pour chaque fiche.
  //
  // Le Socle peut ne pas (encore) exposer la route : 404 ⇒ « pas de couche »,
  // pas une erreur. La carte s'affiche sans quartiers, tout le reste marche.
  //
  // DEUX paramètres obligatoires, appris à la mise en service (2026-08-28) :
  //  - `geometry=true` — sans lui, public-api rend les quartiers SANS polygone
  //    (le défaut : la plupart des consommateurs ne veulent que les libellés) ;
  //  - `organization_id` — EXIGÉ des clés PLATEFORME (celle d'Iris) pour les
  //    géométries ; le Socle en prend la racine, et les quartiers n'existent
  //    que sur les organisations principales. `tenant.socleOrgId` EST cette
  //    racine (vérifiée par `resolveTenant`), donc jamais une valeur du client.
  if (path === "/v1/quartiers/list") {
    const params = new URLSearchParams({
      geometry: "true",
      organization_id: tenant.socleOrgId,
    });
    const res = await socleFetch(
      `${publicApiBase()}/v1/quartiers?${params}`,
      { socleOrgId: tenant.socleOrgId },
    );
    if (res?.status === 404) return json(req, 200, { quartiers: [], available: false });
    if (!res?.ok) return relaySocleError(req, res);
    // deno-lint-ignore no-explicit-any
    const all = await res.json().catch(() => null) as any;
    const list = Array.isArray(all) ? all : Array.isArray(all?.quartiers) ? all.quartiers : [];
    // Défense en profondeur : l'en-tête d'organisation borne déjà la réponse,
    // mais un référentiel qui rendrait tout le monde ne doit pas passer.
    const scoped = list.filter(
      // deno-lint-ignore no-explicit-any
      (q: any) => !q?.organization_id || q.organization_id === tenant.socleOrgId,
    );
    return json(req, 200, { quartiers: sanitizeQuartierList(scoped), available: true });
  }

  if (path === "/v1/contacts/search") {
    const params = new URLSearchParams();
    for (const key of ["search", "email", "phone", "type"] as const) {
      const v = body[key];
      if (typeof v === "string" && v.trim() !== "") params.set(key, v.trim());
    }
    params.set("status", "active");
    const limit = typeof body.limit === "number" && body.limit >= 1 && body.limit <= 50
      ? Math.floor(body.limit) : 20;
    params.set("limit", String(limit));
    const res = await socleFetch(
      `${contactsApiBase()}/v1/contacts?${params}`,
      { socleOrgId: tenant.socleOrgId },
    );
    if (!res?.ok) return relaySocleError(req, res);
    return json(req, 200, { contacts: sanitizeContactList(await res.json().catch(() => null)) });
  }

  // Liste paginée du référentiel d'usagers (page « Usagers »). Volontairement
  // distincte de /v1/contacts/search, qui sert le rapprochement : celle-ci
  // pagine (offset) et sait montrer les fiches ARCHIVÉES. Le tri, les
  // compteurs de demandes et les filtres propres à Iris (quartier, volumétrie)
  // s'appliquent ensuite côté navigateur sur l'ensemble rapatrié — rien n'est
  // stocké, la liste est relue à chaque visite comme la fiche usager.
  if (path === "/v1/contacts/list") {
    const filtered = filterContactListQuery(body);
    if (!filtered.ok) return fail(req, 400, "bad_request", filtered.message);
    const params = new URLSearchParams(filtered.params);
    const res = await socleFetch(
      `${contactsApiBase()}/v1/contacts?${params}`,
      { socleOrgId: tenant.socleOrgId },
    );
    if (!res?.ok) return relaySocleError(req, res);
    const raw = await res.json().catch(() => null);
    // `has_more` déduit du BRUT : la sanitisation peut écarter des entrées,
    // ce qui ne dit rien de l'existence d'une page suivante.
    const has_more = Array.isArray(raw) && raw.length >= filtered.limit;
    return json(req, 200, { contacts: sanitizeContactList(raw), has_more });
  }

  if (path === "/v1/contacts/match") {
    const filtered = filterMatchRequest(body.identity);
    if (!filtered.ok) return fail(req, 400, "bad_request", filtered.message);
    const res = await socleFetch(`${contactsApiBase()}/v1/contacts/match`, {
      method: "POST",
      body: JSON.stringify(filtered.payload),
      socleOrgId: tenant.socleOrgId,
    });
    if (!res?.ok) {
      if (res?.status === 400) {
        // deno-lint-ignore no-explicit-any
        const err = await res.json().catch(() => null) as any;
        return fail(req, 400, "bad_request", err?.error?.message ?? "Critères de rapprochement invalides.");
      }
      return relaySocleError(req, res);
    }
    return json(req, 200, { matches: sanitizeMatches(await res.json().catch(() => null)) });
  }

  if (path === "/v1/contacts/get") {
    const contactId = typeof body.socle_contact_id === "string" ? body.socle_contact_id : "";
    if (!UUID_RE.test(contactId)) {
      return fail(req, 400, "bad_request", "socle_contact_id : UUID requis.");
    }
    const res = await socleFetch(
      `${contactsApiBase()}/v1/contacts/${contactId}`,
      { socleOrgId: tenant.socleOrgId },
    );
    if (!res?.ok) return relaySocleError(req, res);
    const contact = sanitizeContact(await res.json().catch(() => null));
    if (!contact) return fail(req, 404, "not_found", "Ressource introuvable.");
    return json(req, 200, { contact });
  }

  if (path === "/v1/contacts/create") {
    const filtered = filterContactCreate(body.contact);
    if (!filtered.ok) return fail(req, 400, "bad_request", filtered.message);
    const res = await socleFetch(`${contactsApiBase()}/v1/contacts`, {
      method: "POST",
      body: JSON.stringify(filtered.payload),
      socleOrgId: tenant.socleOrgId,
    });
    if (!res || (!res.ok && res.status !== 400 && res.status !== 409)) {
      return relaySocleError(req, res);
    }
    if (res.status === 400 || res.status === 409) {
      // deno-lint-ignore no-explicit-any
      const err = await res.json().catch(() => null) as any;
      return fail(req, res.status, res.status === 409 ? "conflict" : "bad_request",
        err?.error?.message ?? "Création refusée par le Socle.");
    }
    const contact = sanitizeContact(await res.json().catch(() => null));
    if (!contact) return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");
    return json(req, 201, { contact });
  }

  // Mise à jour d'une fiche usager du Socle (PATCH partiel : seules les clés
  // transmises sont écrites). Le Socle reste l'arbitre — invariants par type
  // (civilité d'une personne, raison sociale d'une structure), SIRET unique,
  // format de date : ses refus sont relayés tels quels, en français.
  if (path === "/v1/contacts/update") {
    const contactId = typeof body.socle_contact_id === "string" ? body.socle_contact_id : "";
    if (!UUID_RE.test(contactId)) {
      return fail(req, 400, "bad_request", "socle_contact_id : UUID requis.");
    }
    const filtered = filterContactUpdate(body.contact);
    if (!filtered.ok) return fail(req, 400, "bad_request", filtered.message);
    const res = await socleFetch(`${contactsApiBase()}/v1/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(filtered.payload),
      socleOrgId: tenant.socleOrgId,
    });
    if (!res || (!res.ok && res.status !== 400 && res.status !== 409)) {
      return relaySocleError(req, res);
    }
    if (res.status === 400 || res.status === 409) {
      // deno-lint-ignore no-explicit-any
      const err = await res.json().catch(() => null) as any;
      return fail(req, res.status, res.status === 409 ? "conflict" : "bad_request",
        err?.error?.message ?? "Modification refusée par le Socle.");
    }
    const contact = sanitizeContact(await res.json().catch(() => null));
    if (!contact) return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");
    return json(req, 200, { contact });
  }

  return fail(req, 404, "not_found", "Ressource introuvable.");
});
