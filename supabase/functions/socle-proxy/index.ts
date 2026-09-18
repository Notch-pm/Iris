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
//
// La base de connaissances d'une démarche traverse ce proxy amputée de la
// part destinée à l'assistant IA (_shared/knowledge.ts) : l'agent lit ses
// consignes, le corpus de prompt reste au Socle.
//
// ⚠️ ATTENTION AUX GARDES QUAND UNE LECTURE DÉMÉNAGE ICI. Tant qu'un écran
// lisait une table d'Iris, le RLS le gardait tout seul. Passé par ce proxy, la
// lecture se fait en SERVICE ROLE : le RLS ne garde plus rien, et la règle
// doit être RÉÉCRITE dans la fonction. C'est le cas de /v1/ai/usage, qui lisait
// `ai_usage_*` sous la policy `is_org_admin_anywhere` avant que la
// comptabilité ne parte au Socle (2026-08-29).
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";
import { allowsAgentDocument, parseAgentKnowledge } from "./_shared/knowledge.ts";
import {
  FRANCE_TIME_ZONE,
  isoDay,
  isPublishedOn,
  parsePublication,
} from "../_shared/procedures/publication.ts";
import {
  filterContactCreate,
  filterContactListQuery,
  filterContactUpdate,
  filterMatchRequest,
  sanitizeAiUsage,
  sanitizeBranding,
  sanitizeContact,
  sanitizeContactList,
  sanitizeMatches,
  sanitizeOrganization,
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
/** Guichet IA du Socle — porteur du plafond et du journal depuis 2026-08-29. */
function aiApiBase(): string {
  return publicApiBase().replace("public-api", "ai-api");
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
  if (!roots) return fail(req, 502, "socle_unavailable", "Le Référentiel est injoignable.");
  if (!roots.has(org.socle_org_id)) {
    return fail(req, 403, "forbidden",
      "Ce tenant est hors du périmètre de la clé du Référentiel configurée pour Iris.");
  }
  return { organizationId, socleOrgId: org.socle_org_id };
}

function relaySocleError(req: Request, res: Response | null): Response {
  if (!res) return fail(req, 502, "socle_unavailable", "Le Référentiel est injoignable.");
  if (res.status === 401 || res.status === 403) {
    // Jamais relayer l'erreur d'auth brute du Socle (motif Clara).
    return fail(req, 502, "socle_auth_failed", "Authentification au Référentiel en échec — signaler à un administrateur.");
  }
  if (res.status === 404) return fail(req, 404, "not_found", "Ressource introuvable.");
  return fail(req, 502, "socle_error", "Réponse inattendue du Référentiel.");
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

  // Démarches PROPOSABLES du tenant. Trois exclusions, et une seule est
  // définitive :
  //  · `brouillon` — le paramétrage n'est pas fini, le Socle dit qu'une telle
  //    démarche n'est proposée nulle part. Règle de fond.
  //  · `interne` — décision PO du 2026-08-30 : les démarches internes seront
  //    montrées plus tard. Restriction d'affichage, temporaire.
  //  · hors de sa PÉRIODE de publication (décision PO du 2026-08-30) — bornes
  //    incluses, chacune facultative ; le jour de référence est celui de PARIS,
  //    le serveur tournant en UTC.
  // Aucune ne s'applique à /v1/procedures/get : une demande déjà déposée doit
  // rester lisible même si sa démarche repasse en brouillon ou sort de période.
  if (path === "/v1/procedures/list") {
    const res = await socleFetch(`${publicApiBase()}/v1/procedures`);
    if (!res?.ok) return relaySocleError(req, res);
    // deno-lint-ignore no-explicit-any
    const all = await res.json().catch(() => null) as any[] | null;
    const today = isoDay(new Date(), FRANCE_TIME_ZONE);
    const procedures = (Array.isArray(all) ? all : [])
      .filter((p) => p?.organization_id === tenant.socleOrgId)
      .filter((p) => p?.status === "production" && p?.type === "externe")
      .filter((p) => isPublishedOn(parsePublication(p?.communication_config), today))
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

  // Document d'AIDE AGENT de la base de connaissances : URL signée, courte,
  // produite par le Socle (le bucket `procedure-documents` est le sien).
  //
  // Trois gardes, dans cet ordre, et aucune n'est superflue :
  //  1. la démarche appartient bien au tenant (comme /v1/procedures/get) ;
  //  2. le chemin demandé est l'un des `agentDocuments` de CETTE démarche —
  //     sans cela, la route serait un lecteur libre du bucket dans tout le
  //     périmètre de la clé Socle, documents d'entraînement IA compris ;
  //  3. le Socle revérifie de son côté que le préfixe d'organisation du chemin
  //     est dans le périmètre de la clé.
  // Le chemin ne vient donc JAMAIS du navigateur seul : il est confronté à la
  // démarche rechargée à l'instant.
  if (path === "/v1/procedures/document-url") {
    const procedureId = typeof body.socle_procedure_id === "string" ? body.socle_procedure_id : "";
    if (!UUID_RE.test(procedureId)) {
      return fail(req, 400, "bad_request", "socle_procedure_id : UUID requis.");
    }
    const docPath = typeof body.path === "string" ? body.path : "";
    if (docPath === "") return fail(req, 400, "bad_request", "path : chemin du document requis.");

    const procRes = await socleFetch(`${publicApiBase()}/v1/procedures/${procedureId}`);
    if (!procRes?.ok) return relaySocleError(req, procRes);
    // deno-lint-ignore no-explicit-any
    const procedure = await procRes.json().catch(() => null) as any;
    if (!procedure || procedure.organization_id !== tenant.socleOrgId) {
      return fail(req, 404, "not_found", "Ressource introuvable.");
    }
    if (!allowsAgentDocument(parseAgentKnowledge(procedure.knowledge_base), docPath)) {
      return fail(req, 404, "not_found", "Ressource introuvable.");
    }

    const res = await socleFetch(
      `${publicApiBase()}/v1/documents/signed-url?path=${encodeURIComponent(docPath)}`,
      { socleOrgId: tenant.socleOrgId },
    );
    if (!res?.ok) return relaySocleError(req, res);
    // deno-lint-ignore no-explicit-any
    const signed = await res.json().catch(() => null) as any;
    if (typeof signed?.url !== "string") {
      return fail(req, 502, "socle_error", "Réponse inattendue du Référentiel.");
    }
    return json(req, 200, { url: signed.url, expires_at: signed.expires_at ?? null });
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
  // ---- Organisation PRINCIPALE du tenant ------------------------------------
  // Sa fiche, et elle seule. La route ne prend AUCUN identifiant du navigateur :
  // `tenant.socleOrgId` est la racine Socle vérifiée par `resolveTenant`. C'est
  // ce qui l'empêche de devenir un lecteur libre du référentiel d'organisations
  // — un `POST {organization_id}` relayé tel quel en aurait fait un.
  //
  // Ouverte à tout membre, comme `/v1/quartiers/*` : l'adresse d'une mairie est
  // publique, et la whitelist (`id`, `name`, `address`) ne laisse rien d'autre
  // passer.
  //
  // Usage actuel : ancrer la carte des interventions sur le siège de la
  // collectivité plutôt que sur le barycentre de ses demandes.
  if (path === "/v1/organizations/root") {
    const res = await socleFetch(`${publicApiBase()}/v1/organizations/${tenant.socleOrgId}`);
    if (!res?.ok) return relaySocleError(req, res);
    const raw = await res.json().catch(() => null);
    return json(req, 200, { organization: sanitizeOrganization(raw) });
  }

  // ---- Charte graphique du tenant : le logo du client dans le header -------
  // `GET /v1/organizations/{id}/branding` sur la racine du tenant — même
  // règle que `/root` : AUCUN identifiant du navigateur. La route du Socle
  // résout l'héritage elle-même (cf. `_shared/email/charte.ts` : ne JAMAIS
  // reconstituer une charte depuis `/v1/organizations/{id}`).
  //
  // Ouverte à tout membre : le logo d'une collectivité est public. Whitelist
  // réduite au logo couleur (`sanitizeBranding`). DÉCORATIF, DONC JAMAIS UNE
  // ERREUR : Socle muet ou charte hors périmètre ⇒ `branding: null`, le header
  // écrit le nom du client à la place du logo.
  if (path === "/v1/organizations/branding") {
    const res = await socleFetch(
      `${publicApiBase()}/v1/organizations/${tenant.socleOrgId}/branding`,
    );
    if (!res?.ok) {
      if (res?.status !== 404) {
        console.error(`socle-proxy: charte de ${tenant.socleOrgId} illisible (${res?.status ?? "réseau"})`);
      }
      return json(req, 200, { branding: null });
    }
    const raw = await res.json().catch(() => null);
    return json(req, 200, { branding: sanitizeBranding(raw) });
  }

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
        err?.error?.message ?? "Création refusée par le Référentiel.");
    }
    const contact = sanitizeContact(await res.json().catch(() => null));
    if (!contact) return fail(req, 502, "socle_error", "Réponse inattendue du Référentiel.");
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
        err?.error?.message ?? "Modification refusée par le Référentiel.");
    }
    const contact = sanitizeContact(await res.json().catch(() => null));
    if (!contact) return fail(req, 502, "socle_error", "Réponse inattendue du Référentiel.");
    return json(req, 200, { contact });
  }

  // ── Consommation IA de la collectivité — Paramètres › Assistant IA.
  //
  // ⚠️ LA GARDE EST ICI, ET ELLE N'EST PAS UNE PRÉCAUTION : c'est la SEULE.
  // Cet écran lisait `ai_usage_quotas` / `ai_usage_counters` sous la policy
  // `is_platform_admin() or is_org_admin_anywhere(...)`. La comptabilité étant
  // partie au Socle, la lecture passe par ce proxy — donc en service_role,
  // pour qui le RLS ne s'applique pas. Sans la ligne ci-dessous, n'importe
  // quel membre du tenant lirait le budget de sa collectivité.
  //
  // `is_org_admin_anywhere_for` est le jumeau SERVICE de la policy (elle
  // couvre déjà l'admin plateforme) : la règle reste écrite UNE FOIS, en SQL.
  if (path === "/v1/ai/usage") {
    const { data: isAdmin, error: adminError } = await supabase.rpc(
      "is_org_admin_anywhere_for",
      { p_user_id: userId, p_org_id: tenant.organizationId },
    );
    if (adminError) {
      console.error("socle-proxy is_org_admin_anywhere_for:", adminError);
      return fail(req, 500, "internal_error", "Erreur lors de la vérification des droits.");
    }
    if (!isAdmin) {
      return fail(req, 403, "forbidden",
        "La consommation de l'assistant IA est réservée aux administrateurs de l'organisation.");
    }

    // Période : refusée si malformée, jamais corrigée en silence. Afficher un
    // mois pour un autre est pire qu'une erreur — l'administrateur y lirait une
    // consommation qu'il croirait celle du mois en cours.
    const period = body.period;
    if (period !== undefined && period !== null &&
        (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period))) {
      return fail(req, 400, "bad_request", "period : AAAA-MM attendu.");
    }
    const query = typeof period === "string" ? `?period=${period}` : "";

    const res = await socleFetch(`${aiApiBase()}/v1/usage${query}`, {
      socleOrgId: tenant.socleOrgId,
    });
    if (!res?.ok) return relaySocleError(req, res);
    return json(req, 200, { usage: sanitizeAiUsage(await res.json().catch(() => null)) });
  }

  return fail(req, 404, "not_found", "Ressource introuvable.");
});
