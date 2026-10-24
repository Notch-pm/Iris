// request-guest-access — l'accès invité d'une demande, vu et géré par l'agent.
//
// Lot L4a (projet Sceaux). Un usager qui a déposé sans compte et accepté le
// suivi en ligne ouvre sa demande sur le portail avec courriel + référence +
// code d'accès (migration 20261019150000). Depuis la fiche, l'agent :
//
//   · `status`  — voit l'état (actif, verrouillé, coupé, expiré), la dernière
//                 utilisation et le dernier envoi d'un nouveau code ;
//   · `revoke`  — COUPE l'accès : plus aucun code ne vaut, et les sessions déjà
//                 ouvertes ne lisent plus rien (version d'accès +1) ;
//   · `reissue` — envoie un NOUVEAU code à l'adresse DÉCLARÉE au dépôt (lue
//                 dans le snapshot, vérifiée contre l'empreinte de l'accès),
//                 ce qui rouvre un accès coupé.
//
// Habilitation : droit d'INSTRUCTION sur le couple de la demande —
// `request_right_for`, le même moteur que `send-request-email`. Rien du
// destinataire ne vient du navigateur : il n'envoie que l'identifiant.
//
// Le code n'est jamais rendu à l'agent : il part par la file
// `request_access_mails` (notifications-mailer), et l'onglet Échanges n'en
// garde que le masque. Un agent qui pourrait lire le code pourrait ouvrir la
// demande au nom de l'usager.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  accessCodeHash,
  accessEmailHash,
  newAccessCode,
  normalizeAccessCode,
  normalizeAccessEmail,
  pepperFrom,
} from "../_shared/access/accessCode.ts";
import { type GuestAccessRow, guestAccessStatus } from "../_shared/access/guestAccessState.ts";
import { recipientIdentity } from "../_shared/email/destinataire.ts";

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
function fail(req: Request, status: number, code: string, message: string): Response {
  return json(req, status, { error: { code, message } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_SELECT = "created_at, last_used_at, locked_until, revoked_at, reissued_at, email_hash";

interface RequestRow {
  id: string;
  organization_id: string;
  socle_scope_org_id: string | null;
  socle_procedure_id: string | null;
  requester_snapshot: unknown;
  identity_status: string;
  closed_at: string | null;
}

/** L'adresse déclarée au dépôt, si c'est bien celle de l'accès ; `null` sinon. */
async function declaredEmail(request: RequestRow, emailHash: string, pepper: string): Promise<string | null> {
  const email = normalizeAccessEmail(recipientIdentity(request.requester_snapshot, request.identity_status).email);
  if (email === null) return null;
  return (await accessEmailHash(pepper, email)) === emailHash ? email : null;
}

async function status(req: Request, request: RequestRow, pepper: string | null): Promise<Response> {
  const [access, mail] = await Promise.all([
    supabase.from("request_access_codes").select(ACCESS_SELECT).eq("request_id", request.id).maybeSingle(),
    supabase.from("request_access_mails").select("status, created_at").eq("request_id", request.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (access.error || mail.error) return fail(req, 500, "unavailable", "État de l'accès indisponible — réessayez.");
  const row = access.data as (GuestAccessRow & { email_hash: string }) | null;
  const matches = row !== null && pepper !== null && (await declaredEmail(request, row.email_hash, pepper)) !== null;
  return json(req, 200, { access: guestAccessStatus(row, request.closed_at, matches, mail.data ?? null, Date.now()) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const actorId = userData.user.id;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = typeof body?.request_id === "string" ? body.request_id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!UUID_RE.test(requestId)) return fail(req, 400, "invalid_request", "Demande manquante.");
  if (action !== "status" && action !== "revoke" && action !== "reissue") {
    return fail(req, 400, "invalid_action", "Action inconnue.");
  }

  const { data: request } = await supabase
    .from("requests")
    .select("id, organization_id, socle_scope_org_id, socle_procedure_id, requester_snapshot, identity_status, closed_at")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return fail(req, 404, "not_found", "Demande introuvable.");

  const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
    p_user_id: actorId,
    p_org_id: request.organization_id,
    p_socle_org_id: request.socle_scope_org_id,
    p_socle_procedure_id: request.socle_procedure_id,
    p_right: "instruction",
  });
  if (rightError) {
    console.error("request-guest-access: request_right_for en échec", rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  // Même réponse qu'une demande inexistante : sans droit, on ne confirme rien.
  if (allowed !== true) return fail(req, 404, "not_found", "Demande introuvable.");

  const pepper = pepperFrom(Deno.env.get("IRIS_ACCESS_CODE_PEPPER"));
  const row = request as RequestRow;

  if (action === "status") return await status(req, row, pepper);

  if (action === "revoke") {
    const { data, error } = await supabase.rpc("revoke_request_access", { p_request_id: row.id, p_by: actorId });
    if (error) {
      console.error("request-guest-access: coupure en échec", error);
      return fail(req, 500, "revoke_failed", "La coupure n'a pas pu être enregistrée — réessayez.");
    }
    if (data !== true) return fail(req, 409, "nothing_to_revoke", "Aucun accès en ligne actif pour cette demande.");
    return await status(req, row, pepper);
  }

  // reissue
  if (pepper === null) return fail(req, 500, "not_configured", "Accès invité non configuré.");
  const { data: access } = await supabase.from("request_access_codes").select(ACCESS_SELECT)
    .eq("request_id", row.id).maybeSingle();
  if (!access) return fail(req, 409, "no_access", "Cette demande n'a pas de suivi en ligne sans compte.");
  const current = guestAccessStatus(access as GuestAccessRow, row.closed_at, true, null, Date.now());
  if (current.state === "expire") {
    return fail(req, 409, "expired", "Le suivi en ligne a expiré (90 jours après la clôture).");
  }
  const to = await declaredEmail(row, (access as { email_hash: string }).email_hash, pepper);
  if (to === null) {
    return fail(req, 409, "no_declared_email",
      "L'adresse déclarée au dépôt n'est plus lisible : aucun code ne peut partir.");
  }
  const code = newAccessCode();
  const { data: rotated, error: rotateError } = await supabase.rpc("rotate_request_access", {
    p_request_id: row.id,
    p_code_hash: await accessCodeHash(pepper, normalizeAccessCode(code)!),
    p_code: code,
    p_to_email: to,
    p_reason: "agent",
    p_by: actorId,
  });
  if (rotateError || rotated !== true) {
    console.error("request-guest-access: nouveau code en échec", rotateError ?? "aucun accès");
    return fail(req, 500, "reissue_failed", "Le nouveau code n'a pas pu être créé — réessayez.");
  }
  return await status(req, row, pepper);
});
