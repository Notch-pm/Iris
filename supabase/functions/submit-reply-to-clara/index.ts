// submit-reply-to-clara — Courrier de réponse validé dans Clara (2026-11-12).
//
// La démarche fait valider ses courriers de réponse dans Clara (Socle
// `communication_config.replyLetters`, contrat 1.46.0) : l'agent rédige le
// courrier, mais Iris ne l'envoie pas. Cette fonction le DÉPOSE dans Clara
// comme courrier sortant lié à la demande, qui reste « en instruction » dans le
// sous-état « Réponse en validation ». Clara signale ensuite l'envoi (la demande
// prend l'issue choisie ici par l'agent) ou l'abandon, par `requests-api`.
//
// Ordre, pour qu'aucune panne ne laisse un état faux :
//   1. `reserve_clara_reply` — droit de clôture, démarche concernée, contact
//      Socle, pièces conformes (issue positive) ; pose « dépôt en cours » ;
//   2. dépôt chez Clara, idempotent par `submission_id` ;
//   3. `confirm_clara_reply` — « en validation », lien externe, journal.
//   Échec en 2 → `release_clara_reply` : la demande revient telle quelle.
//   Échec en 3 (rare) → l'agent réessaie avec la MÊME soumission : Clara rend
//   le même courrier (`duplicate`), la confirmation passe.
//
// ⚠️ L'issue (positive / négative) NE PART PAS chez Clara : elle reste dans
// Iris, seule source de vérité du statut. Le texte du courrier, lui, n'est pas
// conservé dans Iris : il vit dans Clara, où il sera visé, signé, envoyé.
//
// Transport : JSON vers la porte `iris-reply-courier` de Clara,
// `Authorization: Bearer CLARA_IRIS_REPLY_KEY` (repli : CLARA_IRIS_INTAKE_KEY).
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { agentDisplayName } from "../_shared/clara/relay.ts";
import {
  buildClaraReplyPayload,
  claraReplyFailure,
  claraReplyOutcome,
  parseReplySubmission,
} from "../_shared/clara/reply.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const LOG = "submit-reply-to-clara";
const CLARA_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 200 * 1024;

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

/** Refus des RPC du circuit → réponse HTTP (le message est déjà en français). */
function rpcFailure(req: Request, error: { code?: string; message?: string }): Response {
  const message = error.message ?? "Erreur inattendue.";
  switch (error.code) {
    case "P0002":
      return fail(req, 404, "not_found", "Demande introuvable.");
    case "42501":
      return fail(req, 403, "forbidden", message);
    case "P0430":
    case "P0432":
      return fail(req, 409, "conflict", message);
    case "P0433":
      return fail(req, 422, "no_socle_contact", message);
    case "22023":
      return fail(req, 400, "bad_request", message);
    case "P0001":  // pièces obligatoires non conformes (même message que t17)
      return fail(req, 409, "pieces_non_conformes", message);
    default:
      console.error(`${LOG} rpc:`, error);
      return fail(req, 500, "internal_error", "Erreur lors de l'enregistrement.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  // ---- Authentification (avant la configuration : un anonyme n'apprend rien) --
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const agentId = userData.user.id;

  const claraUrl = Deno.env.get("CLARA_IRIS_REPLY_URL") ?? "";
  const claraKey = Deno.env.get("CLARA_IRIS_REPLY_KEY") ?? Deno.env.get("CLARA_IRIS_INTAKE_KEY") ?? "";
  if (!claraUrl || !claraKey) {
    console.error(`${LOG}: secrets manquants (CLARA_IRIS_REPLY_URL / CLARA_IRIS_REPLY_KEY)`);
    return fail(req, 503, "not_configured", "Le dépôt des courriers de réponse vers Clara n'est pas configuré sur cet environnement.");
  }

  const declaredLength = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(req, 413, "payload_too_large", "Courrier trop long.");
  }
  const submission = parseReplySubmission(await req.json().catch(() => null));
  if ("error" in submission) return fail(req, 400, "bad_request", submission.error);

  // ---- 1. Réservation (toutes les gardes métier sont en base) ----------------
  const { error: reserveError } = await supabase.rpc("reserve_clara_reply", {
    p_uid: agentId,
    p_request_id: submission.requestId,
    p_submission_id: submission.submissionId,
    p_outcome: submission.outcome,
    p_motif: submission.motif,
    p_closure_text: submission.closureText,
  });
  if (reserveError) return rpcFailure(req, reserveError);

  const release = async () => {
    const { error } = await supabase.rpc("release_clara_reply", {
      p_request_id: submission.requestId,
      p_submission_id: submission.submissionId,
    });
    if (error) console.error(`${LOG} release:`, error);
  };

  const { data: request } = await supabase
    .from("requests")
    .select("id, reference, socle_organization_id, socle_contact_id")
    .eq("id", submission.requestId)
    .maybeSingle();
  if (!request?.socle_organization_id || !request.socle_contact_id) {
    await release();
    return fail(req, 422, "no_socle_contact", "Demande sans organisme ou sans fiche usager du Socle.");
  }
  const { data: agent } = await supabase
    .from("users")
    .select("first_name, last_name, email")
    .eq("id", agentId)
    .maybeSingle();

  // ---- 2. Dépôt chez Clara ----------------------------------------------------
  const payload = buildClaraReplyPayload({
    submission,
    request: {
      id: request.id,
      reference: request.reference,
      socle_organization_id: request.socle_organization_id,
      socle_contact_id: request.socle_contact_id,
    },
    appUrl: Deno.env.get("IRIS_APP_URL"),
    agent: { name: agentDisplayName(agent ?? {}), email: agent?.email ?? null },
  });
  const res = await fetch(claraUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${claraKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CLARA_TIMEOUT_MS),
  }).catch((e) => {
    console.error(`${LOG}: Clara injoignable`, e);
    return null;
  });
  const outcome = res ? claraReplyOutcome(res.status, await res.json().catch(() => null)) : { kind: "failed" as const };
  if (outcome.kind !== "ok") {
    console.error(`${LOG}: dépôt refusé par Clara`, res?.status, outcome);
    await release();
    const failure = claraReplyFailure(outcome);
    return fail(req, failure.status, failure.code, failure.message);
  }

  // ---- 3. Confirmation ----------------------------------------------------------
  const { error: confirmError } = await supabase.rpc("confirm_clara_reply", {
    p_request_id: submission.requestId,
    p_submission_id: submission.submissionId,
    p_courier_id: outcome.courierId,
    p_reference: outcome.reference,
    p_url: outcome.url,
  });
  if (confirmError) {
    // Le courrier existe chez Clara : on NE libère PAS — un nouvel essai avec la
    // même soumission retrouve le même courrier et confirme.
    console.error(`${LOG} confirm:`, confirmError);
    return fail(req, 500, "confirm_failed",
      "Le courrier a été déposé dans Clara mais la demande n'a pas pu être mise à jour : réessayez.");
  }

  return json(req, 200, {
    courier_id: outcome.courierId,
    courier_reference: outcome.reference,
    courier_url: outcome.url,
    duplicate: outcome.duplicate,
  });
});
