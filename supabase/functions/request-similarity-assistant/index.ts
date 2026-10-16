// request-similarity-assistant — l'assistant de RAPPROCHEMENT des demandes
// liées (lot L4 de docs/demandes-liees.md), appelé sur geste de l'agent
// seulement (« Affiner avec l'assistant », carte « Même incident » de la fiche).
//
//   `{ request_id, candidate_ids: uuid[1..10] }` → `{ verdicts: [{ request_id,
//   verdict: meme|different|incertain, reason }], unanswered }`
//
// Il dit, pour chaque demande approchante que la recherche a trouvée, si elle
// signale le MÊME incident. Il ne LIE rien : l'agent décide, par `link_requests`.
//
// Droit exigé : ÉCRITURE (création, instruction ou clôture) sur la demande —
// celui qu'il faut pour lier. Les candidates sont relues avec le JWT de l'agent,
// donc sous RLS : une demande qu'il ne peut pas lire est refusée (400), jamais
// envoyée au modèle.
//
// ⚠️ L'IDENTITÉ DES USAGERS NE SORT PAS. Contexte lu par `REQUEST_CONTEXT_COLUMNS`
// (aucune colonne d'identité) ; les snapshots de dépôt sont relus À PART, pour
// un seul usage LOCAL : reconnaître noms, courriels et téléphones dans les
// textes libres et les masquer (« [usager] »), dans le prompt comme dans les
// motifs rendus. La promesse est BORNÉE, comme partout : aucun champ d'identité
// connu ne sort ; un nom inconnu écrit en texte libre peut passer.
//
// Le modèle ne voit aucun identifiant : des clés opaques `C1…C10` attribuées ici.
// Rien n'est stocké. Guichet IA, délais et refus : ceux de `request-assistant`.
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { buildRequestContext, REQUEST_CONTEXT_COLUMNS, type RequestRow } from "../_shared/ai/context.ts";
import { contextBlock } from "../_shared/ai/prompt.ts";
import { identityTerms, maskTerms } from "../_shared/ai/pseudonymize.ts";
import {
  buildSimilarityUserMessage, candidateKey, MAX_CANDIDATES, parseVerdicts, SIMILARITY_FEATURE,
  SIMILARITY_OUTPUT_TOKENS, SIMILARITY_RULES,
} from "../_shared/ai/similarity.ts";
import { aiConfigured, askSocle } from "../_shared/ai/socleClient.ts";
import { mapSocleFailure } from "../_shared/ai/socleErrors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG = "request-similarity-assistant";
const ALLOWED_KEYS = new Set(["request_id", "candidate_ids"]);

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ContextRequestRow = RequestRow & {
  id: string;
  organization_id: string;
  socle_scope_org_id: string | null;
  socle_procedure_id: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  // ---- Authentification --------------------------------------------------------
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const userId = userData.user.id;

  // ---- Corps, whitelist stricte ----------------------------------------------------
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return fail(req, 400, "invalid_request", "Corps JSON attendu.");
  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) return fail(req, 400, "invalid_request", `Clés non autorisées : ${unknown.join(", ")}.`);
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (!UUID_RE.test(requestId)) return fail(req, 400, "invalid_request", "request_id : UUID requis.");
  const rawIds = Array.isArray(body.candidate_ids) ? body.candidate_ids : null;
  if (!rawIds || rawIds.length === 0 || rawIds.length > MAX_CANDIDATES
      || !rawIds.every((x) => typeof x === "string" && UUID_RE.test(x))) {
    return fail(req, 400, "invalid_request", `candidate_ids : 1 à ${MAX_CANDIDATES} UUID requis.`);
  }
  const candidateIds = [...new Set(rawIds as string[])].filter((x) => x !== requestId);
  if (candidateIds.length === 0) return fail(req, 400, "invalid_request", "Aucune demande candidate.");

  if (!aiConfigured()) {
    return fail(req, 503, "not_configured", "L'assistant IA n'est pas configuré sur cette instance.");
  }

  // ---- Visibilité : relue avec le JWT de l'agent (RLS) ------------------------------
  const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: visible, error: visibleError } = await asUser
    .from("requests")
    .select("id")
    .in("id", [requestId, ...candidateIds]);
  if (visibleError) {
    console.error(`${LOG}: lecture sous RLS en échec`, visibleError);
    return fail(req, 500, "internal_error", "Lecture des demandes impossible — réessayez.");
  }
  const visibleIds = new Set((visible ?? []).map((r) => r.id as string));
  if (!visibleIds.has(requestId)) return fail(req, 404, "not_found", "Demande introuvable.");
  if (candidateIds.some((id) => !visibleIds.has(id))) {
    return fail(req, 400, "invalid_request", "Une demande candidate est hors de votre périmètre.");
  }

  // ---- Contexte métier (sans identité) -------------------------------------------
  const { data: rowsData } = await supabase
    .from("requests")
    .select(REQUEST_CONTEXT_COLUMNS)
    .in("id", [requestId, ...candidateIds]);
  const rows = (rowsData ?? []) as unknown as ContextRequestRow[];
  const source = rows.find((r) => r.id === requestId);
  if (!source) return fail(req, 404, "not_found", "Demande introuvable.");
  if (rows.some((r) => r.organization_id !== source.organization_id)) {
    return fail(req, 400, "invalid_request", "Une demande candidate est hors de votre périmètre.");
  }

  const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
    p_user_id: userId,
    p_org_id: source.organization_id,
    p_socle_org_id: source.socle_scope_org_id,
    p_socle_procedure_id: source.socle_procedure_id,
    p_right: "ecriture",
  });
  if (rightError) {
    console.error(`${LOG}: request_right_for en échec`, rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  if (allowed !== true) {
    return fail(req, 403, "forbidden", "Rapprocher des demandes exige un droit de création ou d'instruction sur cette demande.");
  }

  const { data: org } = await supabase
    .from("organizations").select("socle_org_id").eq("id", source.organization_id).maybeSingle();
  const socleOrgId = org?.socle_org_id ?? null;
  if (!socleOrgId) {
    return fail(req, 503, "not_configured",
      "L'assistant IA n'est pas disponible : cette organisation n'est pas raccordée au référentiel.");
  }

  // Usage LOCAL seulement : les termes d'identité de TOUS les dépôts, masqués
  // partout (le nom d'un usager peut apparaître dans la description d'un autre).
  const { data: identities } = await supabase
    .from("requests").select("requester_snapshot").in("id", [requestId, ...candidateIds]);
  const terms = [...new Set((identities ?? []).flatMap((r) => identityTerms(r.requester_snapshot ?? null)))];
  const blockOf = (row: ContextRequestRow) => maskTerms(contextBlock(buildRequestContext(row, [])), terms);

  const ordered = candidateIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is ContextRequestRow => Boolean(r));
  const keyed = ordered.map((row, i) => ({ key: candidateKey(i), row }));

  const outcome = await askSocle({
    system: SIMILARITY_RULES,
    messages: [{
      role: "user",
      content: buildSimilarityUserMessage(blockOf(source), keyed.map((k) => ({ key: k.key, context: blockOf(k.row) }))),
    }],
    feature: SIMILARITY_FEATURE,
    agent: SIMILARITY_FEATURE,
    maxOutputTokens: SIMILARITY_OUTPUT_TOKENS,
    socleOrgId,
    reference: { kind: "request", id: requestId },
    userId,
    logLabel: LOG,
  });
  if (!outcome.ok) {
    const mapped = mapSocleFailure(outcome.status, outcome.body);
    console.error(`${LOG}: guichet IA en échec (statut ${outcome.status ?? "aucun"}) → ${mapped.code}`);
    return fail(req, mapped.status, mapped.code, mapped.message);
  }

  const parsed = parseVerdicts(outcome.answer, keyed.map((k) => k.key));
  const verdicts = keyed.flatMap((k) => {
    const v = parsed.get(k.key);
    return v ? [{ request_id: k.row.id, verdict: v.verdict, reason: maskTerms(v.reason, terms) }] : [];
  });
  if (verdicts.length === 0) {
    return fail(req, 502, "ai_unavailable", "L'assistant n'a pas rendu d'avis exploitable — réessayez.");
  }
  return json(req, 200, { verdicts, unanswered: keyed.length - verdicts.length });
});
