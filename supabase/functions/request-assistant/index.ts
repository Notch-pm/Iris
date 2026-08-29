// request-assistant — l'assistant IA d'instruction.
//
// DEUX MODES, deux habilitations :
//
//   • `{ request_id, messages }` — MODE DEMANDE, depuis la fiche
//     d'instruction. Droit exigé : **INSTRUCTION** sur le couple de la demande
//     (organisation porteuse Socle, démarche). Ce n'est pas une question de
//     confidentialité — un consultant peut déjà lire tout ce qui compose le
//     prompt — mais de BUDGET : chaque question mord sur le plafond du tenant,
//     et la consultation est une lecture stricte, « aucune action ».
//
//   • `{ organization_id, socle_procedure_id, messages }` — MODE DÉMARCHE, au
//     guichet, où AUCUNE demande n'existe encore. L'assistant ne connaît alors
//     que la démarche : ni saisie en cours, ni usager. Droit exigé : membre du
//     tenant ET au moins un droit de création (`has_any_creation_right_for`,
//     la garde que socle-proxy applique déjà à /v1/contacts/*).
//
// ⚠️ CE QUI NE VIENT JAMAIS DU NAVIGATEUR : le prompt système, le contexte de
// la demande, la base de connaissances. Tout est composé ICI. Le client
// n'envoie que des identifiants et sa question — plus l'historique, qui est
// donc une entrée NON FIABLE (la conversation est éphémère, décision PO : rien
// n'est stocké, donc le fil revient du navigateur à chaque tour).
// `parseClientHistory` refuse explicitement un `role: "system"`.
//
// ⚠️ L'IDENTITÉ DE L'USAGER NE SORT PAS. La première défense est le `select` :
// `REQUEST_CONTEXT_COLUMNS` ne demande ni `requester_snapshot`, ni
// `socle_contact_id`, ni `identity_status`. La seconde est `redact.ts`, pour ce
// qui se glisse dans une réponse libre. La promesse est bornée et écrite :
// aucun champ d'identité CONNU ne sort ; un nom en texte libre peut passer.
//
// ⚠️ LE PLAFOND EST RÉSERVÉ AVANT L'APPEL, PAS APRÈS. `reserve_ai_usage` fait
// un UPDATE conditionnel : refusé ⇒ 429, et Mistral n'est jamais appelé. Le
// règlement corrige ensuite avec le `usage` réel. Un échec ne consomme rien.
//
// Sans état chez le fournisseur non plus : `/v1/agents/completions` prend
// `agent_id` + `messages` à chaque appel. `/v1/conversations` stockerait le fil
// chez Mistral — ce serait persister là-bas ce qu'on refuse de garder ici.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { buildRequestContext, REQUEST_CONTEXT_COLUMNS, type RequestContext } from "../_shared/ai/context.ts";
import { condenseKnowledge, KNOWLEDGE_BUDGET_TOKENS } from "../_shared/ai/condense.ts";
import { emptyAiKnowledge, parseAiKnowledge, type AiKnowledge } from "../_shared/ai/knowledge.ts";
import { parseClientHistory, type ChatMessage } from "../_shared/ai/messages.ts";
import { buildAssistantPrompt } from "../_shared/ai/prompt.ts";
import { estimateCall, MAX_OUTPUT_TOKENS } from "../_shared/ai/tokens.ts";
import { quotaExceededMessage } from "../_shared/ai/quota.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROVIDER = "mistral";
const CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const AGENTS_URL = "https://api.mistral.ai/v1/agents/completions";
const CHAT_MODEL = "mistral-large-latest";
const TEMPERATURE = 0.2;

/** Clés acceptées dans le corps. Toute autre ⇒ 400 (motif create-request-from-procedure). */
const ALLOWED_KEYS = new Set([
  "request_id", "organization_id", "socle_procedure_id", "messages",
]);

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

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}

/**
 * Base de connaissances COMPLÈTE, lue dans le Socle avec la clé de service.
 * `undefined` = référentiel muet : l'appelant répond quand même, en le disant.
 * Un Socle injoignable ne doit pas faire taire l'assistant.
 */
async function socleKnowledge(
  procedureId: string,
  socleRootId: string,
): Promise<{ kb: AiKnowledge; name: string | null } | undefined> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return undefined;
  const res = await fetch(`${base}/v1/procedures/${procedureId}`, {
    headers: { Authorization: `Bearer ${key}`, "X-Organization-Id": socleRootId },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`request-assistant: démarche ${procedureId} illisible (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const procedure = await res.json().catch(() => null);
  if (!isRecord(procedure)) return undefined;
  // Défense en profondeur : la démarche doit appartenir au tenant demandé.
  if (procedure.organization_id !== socleRootId) {
    console.error("request-assistant: démarche hors du tenant — ignorée");
    return undefined;
  }
  return {
    kb: parseAiKnowledge(procedure.knowledge_base),
    name: typeof procedure.name === "string" ? procedure.name : null,
  };
}

interface MistralReply {
  answer: string;
  totalTokens: number | null;
}

async function askMistral(system: string, messages: ChatMessage[]): Promise<MistralReply | null> {
  const key = Deno.env.get("MISTRAL_API_KEY");
  const agentId = Deno.env.get("MISTRAL_ASSISTANT_AGENT_ID");
  const payload: Record<string, unknown> = {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: MAX_OUTPUT_TOKENS,
  };
  // L'agent porte le ton et les règles générales (console Mistral, versionnées
  // dans docs/assistant-ia.md). Sans agent configuré, le repli embarque les
  // mêmes règles dans le prompt système — d'où `includeBaseRules` en amont.
  if (agentId) payload.agent_id = agentId;
  else {
    payload.model = CHAT_MODEL;
    payload.temperature = TEMPERATURE;
  }

  const res = await fetch(agentId ? AGENTS_URL : CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);

  if (!res?.ok) {
    // L'erreur brute du fournisseur n'est JAMAIS relayée (motif relaySocleError).
    const detail = res ? `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}` : "réseau";
    console.error(`request-assistant: Mistral en échec — ${detail}`);
    return null;
  }
  const data = await res.json().catch(() => null);
  const answer = isRecord(data) &&
      Array.isArray((data as { choices?: unknown }).choices)
    ? ((data as { choices: { message?: { content?: unknown } }[] }).choices[0]?.message?.content)
    : null;
  if (typeof answer !== "string" || answer.trim() === "") {
    console.error("request-assistant: réponse Mistral vide ou inattendue");
    return null;
  }
  const usage = isRecord(data) && isRecord((data as { usage?: unknown }).usage)
    ? (data as { usage: Record<string, unknown> }).usage
    : null;
  const total = usage && typeof usage.total_tokens === "number" ? usage.total_tokens : null;
  return { answer: answer.trim(), totalTokens: total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return fail(req, 405, "method_not_allowed", "POST attendu.");
  }
  // ---- Authentification -----------------------------------------------------
  // AVANT le contrôle de configuration : un appelant non authentifié n'a pas à
  // apprendre si l'instance est équipée d'un assistant. Il reçoit 401, rien de
  // plus.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return fail(req, 401, "unauthorized", "Session invalide.");
  }
  const userId = userData.user.id;

  // ---- Corps, whitelist stricte ---------------------------------------------
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return fail(req, 400, "invalid_request", "Corps JSON attendu.");
  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    return fail(req, 400, "invalid_request", `Clés non autorisées : ${unknown.join(", ")}.`);
  }

  const history = parseClientHistory(body.messages);
  if (!history.ok) return fail(req, 400, history.code, history.message);

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const requestMode = requestId !== "";
  if (requestMode && !UUID_RE.test(requestId)) {
    return fail(req, 400, "invalid_request", "request_id : UUID requis.");
  }

  // Après la validation du corps : une requête malformée est malformée, que
  // l'instance soit équipée d'un assistant ou non. Et avant tout travail en
  // base : inutile de lire une demande pour finir en 503.
  if (!Deno.env.get("MISTRAL_API_KEY")) {
    return fail(req, 503, "not_configured", "L'assistant IA n'est pas configuré sur cette instance.");
  }

  // ---- Périmètre, droits, contexte ------------------------------------------
  let organizationId: string;
  let socleProcedureId: string | null;
  let context: RequestContext | null = null;
  let serviceName: string | null = null;

  if (requestMode) {
    const { data: request } = await supabase
      .from("requests")
      .select(REQUEST_CONTEXT_COLUMNS)
      .eq("id", requestId)
      .maybeSingle();
    if (!request) return fail(req, 404, "not_found", "Demande introuvable.");

    const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
      p_user_id: userId,
      p_org_id: request.organization_id,
      p_socle_org_id: request.socle_scope_org_id,
      p_socle_procedure_id: request.socle_procedure_id,
      p_right: "instruction",
    });
    if (rightError) {
      console.error("request-assistant: request_right_for en échec", rightError);
      return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
    }
    if (allowed !== true) {
      return fail(req, 403, "forbidden",
        "Utiliser l'assistant exige le droit d'instruction sur cette demande.");
    }

    // Journal : les 30 derniers événements, libellés par whitelist.
    const { data: events } = await supabase
      .from("request_events")
      .select("event_type, created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(30);

    organizationId = request.organization_id;
    socleProcedureId = request.socle_procedure_id;
    serviceName = request.socle_organization_label;
    context = buildRequestContext(request, (events ?? []).slice().reverse());
  } else {
    organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    socleProcedureId = typeof body.socle_procedure_id === "string" ? body.socle_procedure_id : null;
    if (!UUID_RE.test(organizationId) || !socleProcedureId || !UUID_RE.test(socleProcedureId)) {
      return fail(req, 400, "invalid_request",
        "organization_id et socle_procedure_id : UUID requis.");
    }
    const { data: membership } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!membership) return fail(req, 404, "not_found", "Ressource introuvable.");

    const { data: canCreate, error: rightError } = await supabase.rpc(
      "has_any_creation_right_for",
      { p_user_id: userId, p_org_id: organizationId },
    );
    if (rightError) {
      console.error("request-assistant: has_any_creation_right_for en échec", rightError);
      return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
    }
    if (canCreate !== true) {
      return fail(req, 403, "forbidden",
        "Utiliser l'assistant au guichet exige un droit de création de demande.");
    }

    // La démarche doit appartenir au tenant : le cache fait foi, même si le
    // Socle est injoignable (motif requests-api).
    const { data: cached } = await supabase
      .from("socle_procedure_cache")
      .select("socle_id")
      .eq("organization_id", organizationId)
      .eq("socle_id", socleProcedureId)
      .is("obsoleted_at", null)
      .maybeSingle();
    if (!cached) return fail(req, 404, "not_found", "Démarche introuvable dans ce tenant.");
  }

  // ---- Pré-contrôle consultatif du plafond ----------------------------------
  // Une LECTURE, qui ne décide rien : deux appels concurrents peuvent la passer
  // tous les deux. Elle évite seulement de composer un prompt et d'interroger
  // le Socle quand le crédit est manifestement épuisé. La vraie porte est la
  // réservation, plus bas.
  const now = new Date();
  {
    const { data: quota } = await supabase
      .from("ai_usage_quotas")
      .select("monthly_limit_tokens, is_active, provider")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const limitRow = (quota ?? []).find((q) => q.provider === PROVIDER) ??
      (quota ?? []).find((q) => q.provider === "__global__");
    if (limitRow) {
      const { data: counter } = await supabase
        .from("ai_usage_counters")
        .select("used_tokens, reserved_tokens")
        .eq("organization_id", organizationId)
        .eq("provider", limitRow.provider)
        .eq("period", `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`)
        .maybeSingle();
      const engaged = (counter?.used_tokens ?? 0) + (counter?.reserved_tokens ?? 0);
      if (engaged >= limitRow.monthly_limit_tokens) {
        return fail(req, 429, "ai_quota_exceeded", quotaExceededMessage(now));
      }
    }
  }

  // ---- Socle : la base de connaissances COMPLÈTE ----------------------------
  const { data: org } = await supabase
    .from("organizations")
    .select("socle_org_id")
    .eq("id", organizationId)
    .maybeSingle();

  let knowledge: AiKnowledge = emptyAiKnowledge();
  let procedureName: string | null = null;
  let knowledgeUnavailable = false;
  if (socleProcedureId && org?.socle_org_id) {
    const read = await socleKnowledge(socleProcedureId, org.socle_org_id);
    if (read) {
      knowledge = read.kb;
      procedureName = read.name;
    } else {
      knowledgeUnavailable = true;
    }
  }
  if (!procedureName && context) procedureName = context.procedure;

  // ---- Composition ----------------------------------------------------------
  // Les documents d'entraînement arrivent en vague 4 : le budget les prévoit,
  // la liste est vide d'ici là.
  const condensed = condenseKnowledge(knowledge, [], KNOWLEDGE_BUDGET_TOKENS);
  const system = buildAssistantPrompt({
    context,
    knowledge: condensed.text,
    procedureName,
    serviceName,
    includeBaseRules: !Deno.env.get("MISTRAL_ASSISTANT_AGENT_ID"),
    skippedDocuments: condensed.skipped.map((s) => s.name),
    truncated: condensed.truncated,
    knowledgeUnavailable,
  });

  // ---- Réservation : LA porte ----------------------------------------------
  const estimate = estimateCall({ system, messages: history.messages });
  const { data: reservation, error: reserveError } = await supabase.rpc("reserve_ai_usage", {
    p_org_id: organizationId,
    p_provider: PROVIDER,
    p_resource_type: Deno.env.get("MISTRAL_ASSISTANT_AGENT_ID") ? "agent" : "chat",
    p_estimated_tokens: estimate,
    p_user_id: userId,
    p_request_id: requestMode ? requestId : null,
    p_socle_procedure_id: socleProcedureId,
  });
  if (reserveError) {
    console.error("request-assistant: reserve_ai_usage en échec", reserveError);
    return fail(req, 500, "quota_unavailable", "Le plafond d'utilisation est indisponible — réessayez.");
  }
  const reserved = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!reserved?.allowed) {
    return fail(req, 429, "ai_quota_exceeded", quotaExceededMessage(now));
  }

  // ---- L'appel --------------------------------------------------------------
  const reply = await askMistral(system, history.messages);
  if (!reply) {
    // Règlement en échec : la réservation est libérée, `used_tokens` intact.
    await supabase.rpc("settle_ai_usage", {
      p_event_id: reserved.event_id, p_actual_tokens: null, p_status: "failed",
    }).catch(() => undefined);
    return fail(req, 502, "ai_unavailable",
      "L'assistant est momentanément indisponible — réessayez dans un instant.");
  }

  const { error: settleError } = await supabase.rpc("settle_ai_usage", {
    p_event_id: reserved.event_id,
    p_actual_tokens: reply.totalTokens,
    p_status: "completed",
  });
  if (settleError) {
    // La réponse EST là : un règlement raté ne doit pas la faire disparaître.
    // Le balayage cron rattrapera la réservation dans les 15 minutes.
    console.error("request-assistant: settle_ai_usage en échec", settleError);
  }

  return json(req, 200, {
    answer: reply.answer,
    context: {
      knowledge: condensed.text !== "",
      knowledgeUnavailable,
      truncated: condensed.truncated,
      documents: { used: condensed.included, skipped: condensed.skipped },
      answers: context?.answers.length ?? 0,
      removedIdentityKeys: context?.removedIdentityKeys ?? [],
    },
  });
});
