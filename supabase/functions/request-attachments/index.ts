// request-attachments — LA porte du navigateur vers le bucket des pièces.
//
// Jusqu'au 2026-09-08, le navigateur écrivait lui-même dans le bucket
// `request-attachments` (policy storage sur le chemin), et rien ne vérifiait
// ce qu'il y mettait : un SVG piégé, un HTML, un exécutable renommé passaient
// et ressortaient par URL signée depuis le domaine du stockage. Désormais tout
// octet d'un agent passe ICI, par la même porte que les partenaires
// (`_shared/files/receive.ts`) : taille, signature binaire contre la liste
// fermée des formats, extension cohérente, sha256 — puis une ligne dans la
// ZONE D'ATTENTE (`attachment_uploads`). Les RPC métier ne reçoivent ensuite
// qu'un `upload_id` et relisent tout le reste en base.
//
// DEUX PORTÉES, selon que la demande existe :
//   · `?organization_id=…` seul — le GUICHET : la demande n'est pas encore
//     créée. Droit exigé : au moins une CRÉATION dans le tenant
//     (`has_any_creation_right_for`). L'objet va sous `{org}/_staging/`,
//     invisible aux policies clientes ; `create-request-from-procedure` le
//     déplacera sous la demande.
//   · `?organization_id=…&request_id=…` — l'INSTRUCTION (ajout de pièce,
//     pièce jointe d'un échange) : la demande existe et est ouverte. Droit
//     exigé : INSTRUCTION sur son couple (`request_right_for`). L'objet est
//     écrit directement sous la demande ; sans ligne `request_attachments`,
//     il reste invisible à l'écran et part à la purge.
//
// Le périmètre est lu dans l'URL et vérifié AVANT de lire le corps : un
// appelant sans droit ne fait pas charger 25 Mo au serveur.
//
// `/discard` : l'agent retire une pièce du composeur avant de l'envoyer — la
// ligne est marquée, l'objet retiré. Propriétaire seul, jamais une pièce déjà
// rattachée.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";
import { httpStatusFor } from "../_shared/files/inspect.ts";
import { readSingleFileForm } from "../_shared/files/multipart.ts";
import { finalPath, stagingPath } from "../_shared/files/names.ts";
import { discardReceived, receiveFile } from "../_shared/files/receive.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const BUCKET = "request-attachments";
/** Jumeau de `file_size_limit` du bucket (25 Mio). */
const MAX_BYTES = 25 * 1_048_576;
/** Une pièce reçue et jamais rattachée est purgée après ce délai (lot 4). */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED_STATUSES = new Set(["annulee", "resolue_positive", "resolue_negative", "archivee"]);

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

async function handleUpload(req: Request, url: URL, actorId: string): Promise<Response> {
  const organizationId = (url.searchParams.get("organization_id") ?? "").toLowerCase();
  const requestId = (url.searchParams.get("request_id") ?? "").toLowerCase() || null;
  if (!UUID_RE.test(organizationId)) return fail(req, 400, "bad_request", "organization_id manquant.");
  if (requestId !== null && !UUID_RE.test(requestId)) return fail(req, 400, "bad_request", "request_id invalide.");

  // Appartenance au tenant (hors périmètre = 404, jamais révélé).
  const { data: membership } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!membership) return fail(req, 404, "not_found", "Ressource introuvable.");

  if (requestId !== null) {
    const { data: request } = await supabase
      .from("requests")
      .select("id, organization_id, socle_scope_org_id, socle_procedure_id, status")
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!request) return fail(req, 404, "not_found", "Demande introuvable.");
    if (CLOSED_STATUSES.has(request.status)) {
      return fail(req, 409, "request_closed", "La demande est close : aucune pièce ne peut plus y être déposée.");
    }
    const { data: allowed, error } = await supabase.rpc("request_right_for", {
      p_user_id: actorId,
      p_org_id: organizationId,
      p_socle_org_id: request.socle_scope_org_id,
      p_socle_procedure_id: request.socle_procedure_id,
      p_right: "instruction",
    });
    if (error) return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
    if (allowed !== true) {
      return fail(req, 403, "forbidden", "Déposer une pièce exige le droit d'instruction sur cette demande.");
    }
  } else {
    const { data: allowed, error } = await supabase.rpc("has_any_creation_right_for", {
      p_user_id: actorId,
      p_org_id: organizationId,
    });
    if (error) return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
    if (allowed !== true) {
      return fail(req, 403, "forbidden", "Déposer une pièce exige un droit de création de demande.");
    }
  }

  const form = await readSingleFileForm(req, { maxBytes: MAX_BYTES });
  if (!form.ok) return fail(req, form.code === "payload_too_large" ? 413 : 400, form.code, form.message);

  const uploadId = crypto.randomUUID();
  const path = requestId
    ? finalPath(organizationId, requestId, uploadId, form.file.name)
    : stagingPath(organizationId, uploadId);
  const bucket = supabase.storage.from(BUCKET);
  const received = await receiveFile(bucket, {
    path,
    bytes: form.file.bytes,
    fileName: form.file.name,
    maxBytes: MAX_BYTES,
  });
  if (!received.ok) {
    if (received.code === "storage_failed") {
      console.error("request-attachments: écriture impossible", received.message);
      return fail(req, 502, "storage_failed", "Stockage indisponible : réessayez dans quelques instants.");
    }
    return fail(req, httpStatusFor(received.code), received.code, received.message);
  }

  const { error } = await supabase.from("attachment_uploads").insert({
    id: uploadId,
    organization_id: organizationId,
    scope_request_id: requestId,
    integration_source_id: null,
    uploaded_by: actorId,
    storage_path: path,
    file_name: received.fileName,
    mime_type: received.mime,
    file_size: received.size,
    checksum: received.checksum,
    expires_at: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
  });
  if (error) {
    await discardReceived(bucket, path);
    console.error("request-attachments: ligne d'attente non écrite", error);
    return fail(req, 500, "internal_error", "La pièce n'a pas pu être enregistrée.");
  }
  return json(req, 201, {
    upload_id: uploadId,
    file_name: received.fileName,
    mime_type: received.mime,
    size_bytes: received.size,
    inline: received.inline,
  });
}

async function handleDiscard(req: Request, actorId: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = Array.isArray(body?.upload_ids)
    ? (body!.upload_ids as unknown[]).filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
    : [];
  if (ids.length === 0 || ids.length > 50) {
    return fail(req, 400, "bad_request", "upload_ids : 1 à 50 identifiants attendus.");
  }
  const { data: count, error } = await supabase.rpc("discard_attachment_uploads", {
    p_ids: ids,
    p_actor: actorId,
  });
  if (error) return fail(req, 500, "internal_error", "Erreur serveur.");

  // L'objet part avec la ligne (l'outbox du lot 4 prendra le relais).
  const { data: rows } = await supabase
    .from("attachment_uploads")
    .select("storage_path")
    .in("id", ids)
    .eq("uploaded_by", actorId)
    .not("discarded_at", "is", null);
  const paths = (rows ?? []).map((r) => r.storage_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) console.error("request-attachments: objets non retirés", removeError);
  }
  return json(req, 200, { discarded: typeof count === "number" ? count : paths.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/request-attachments/, "") || "/";

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const actorId = userData.user.id;

  if (path === "/upload") return await handleUpload(req, url, actorId);
  if (path === "/discard") return await handleDiscard(req, actorId);
  return fail(req, 404, "not_found", "Ressource introuvable.");
});
