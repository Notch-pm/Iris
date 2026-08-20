// socle-proxy — relais serveur vers le Socle pour l'UI Iris. La clé plateforme
// Socle vit ICI (secret d'edge function), jamais dans le navigateur.
// Auth : JWT utilisateur vérifié EN CODE (verify_jwt=false au déploiement :
// la passerelle bloquerait les préflights OPTIONS sans Authorization) + le
// périmètre est revérifié : la ressource Socle demandée doit appartenir à un
// tenant dont l'appelant est membre — jamais de confiance au payload seul.
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

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
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return fail(req, 401, "unauthorized", "Session invalide.");
  }

  // Périmètre : les racines Socle des tenants de l'appelant — dérivées de son
  // appartenance, jamais du payload.
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization:organizations(socle_org_id)")
    .eq("user_id", userData.user.id);
  const roots = new Set(
    (memberships ?? [])
      // deno-lint-ignore no-explicit-any
      .map((m: any) => m.organization?.socle_org_id)
      .filter(Boolean) as string[],
  );
  if (roots.size === 0) return fail(req, 404, "not_found", "Ressource introuvable.");

  const path = new URL(req.url).pathname.replace(/^\/socle-proxy/, "") || "/";
  if (path !== "/v1/procedure-snapshot") {
    return fail(req, 404, "not_found", "Ressource introuvable.");
  }

  const body = await req.json().catch(() => null) as { socle_procedure_id?: string } | null;
  const procedureId = body?.socle_procedure_id ?? "";
  if (!UUID_RE.test(procedureId)) {
    return fail(req, 400, "bad_request", "socle_procedure_id : UUID requis.");
  }

  const res = await fetch(
    `${socleUrl.replace(/\/+$/, "")}/v1/procedures/${procedureId}`,
    { headers: { Authorization: `Bearer ${socleKey}` }, signal: AbortSignal.timeout(15_000) },
  ).catch(() => null);
  if (!res) return fail(req, 502, "socle_unavailable", "Le Socle est injoignable.");
  if (res.status === 404) return fail(req, 404, "not_found", "Ressource introuvable.");
  if (!res.ok) return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");

  // deno-lint-ignore no-explicit-any
  const proc = await res.json() as any;
  // Hors périmètre de l'appelant = 404 (l'existence n'est jamais révélée).
  if (!roots.has(proc.organization_id)) {
    return fail(req, 404, "not_found", "Ressource introuvable.");
  }

  // Whitelist stricte — knowledge_base (aide agent/IA) volontairement exclue du snapshot.
  return json(req, 200, {
    procedure: {
      id: proc.id,
      name: proc.name,
      type: proc.type ?? null,
      category_id: proc.category_id ?? null,
      form_schema: proc.form_schema ?? null,
      requester_config: proc.requester_config ?? null,
    },
  });
});
