// request-email-assistant — la rédaction assistée des échanges avec l'usager
// (onglet Échanges de la fiche d'instruction). Deux gestes :
//
//   • `{ request_id, mode: "draft", kind, instructions? }` — un BROUILLON
//     d'accusé de réception ou de suivi (ergonomie de l'assistant de réponse
//     de Clara). Il connaît le dossier, la démarche (base de connaissances et
//     textes publiés aux usagers), les interventions et les échanges déjà
//     envoyés — JAMAIS les notes internes : `request_messages` n'est pas lue.
//   • `{ request_id, mode: "improve", text }` — « Améliorer mon message » :
//     fautes, ponctuation, tournures, sans changer le sens.
//
// Droit exigé : INSTRUCTION sur le couple de la demande — celui qu'il faut pour
// ENVOYER (`send-request-email`). Qui ne peut pas envoyer n'a pas à faire
// rédiger, et chaque appel mord sur le plafond IA d'Iris.
//
// ⚠️ L'IDENTITÉ DE L'USAGER NE SORT PAS. Le contexte du brouillon est lu par
// `REQUEST_CONTEXT_COLUMNS` (aucune colonne d'identité). Le snapshot du dépôt
// est relu À PART, pour un seul usage LOCAL : reconnaître le nom, le courriel,
// le téléphone de l'usager dans les textes libres — masqués (« [usager] ») dans
// le contexte d'un brouillon, pseudonymisés de façon réversible (`⟦P1⟧`) dans
// le texte à améliorer, puis remis en place ici. Il n'est jamais envoyé.
//
// Rien n'est stocké : le texte revient au composeur, l'agent le relit et
// l'envoie par `send-request-email`, seule porte d'envoi.
//
// Guichet IA, chaîne de délais et traduction des refus : ceux de
// `request-assistant` (`_shared/ai/socleClient.ts`, `socleErrors.ts`).
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  buildRequestContext,
  REQUEST_CONTEXT_COLUMNS,
  type RequestRow,
} from "../_shared/ai/context.ts";
import { condenseKnowledge } from "../_shared/ai/condense.ts";
import {
  buildDraftSystemPrompt,
  buildDraftUserMessage,
  buildImproveUserMessage,
  cleanDraftOutput,
  cleanImproveOutput,
  DRAFT_KNOWLEDGE_BUDGET_TOKENS,
  DRAFT_OUTPUT_TOKENS,
  draftSubject,
  improveOutputTokens,
  IMPROVE_RULES,
  isDraftKind,
  MAX_IMPROVE_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  type InterventionRow,
  type SentEmailRow,
} from "../_shared/ai/emailDraft.ts";
import { emptyAiKnowledge } from "../_shared/ai/knowledge.ts";
import { identityTerms, pseudonymize, restore } from "../_shared/ai/pseudonymize.ts";
import { aiConfigured, askSocle } from "../_shared/ai/socleClient.ts";
import { mapSocleFailure } from "../_shared/ai/socleErrors.ts";
import { socleAgentGuidance, socleKnowledge } from "../_shared/ai/socleKnowledge.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG = "request-email-assistant";

/** Alias partagé avec l'assistant de réponse de Clara : un seul réglage au Socle. */
const DRAFT_FEATURE = "redaction-reponse";
const IMPROVE_FEATURE = "correction-message";

const ALLOWED_KEYS = new Set(["request_id", "mode", "kind", "instructions", "text"]);

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
/** La ligne lue par `REQUEST_CONTEXT_COLUMNS` : le contexte, plus le périmètre. */
type ContextRequestRow = RequestRow & {
  organization_id: string;
  socle_scope_org_id: string | null;
  socle_procedure_id: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const userId = userData.user.id;

  // ---- Corps, whitelist stricte ---------------------------------------------
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return fail(req, 400, "invalid_request", "Corps JSON attendu.");
  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    return fail(req, 400, "invalid_request", `Clés non autorisées : ${unknown.join(", ")}.`);
  }
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (!UUID_RE.test(requestId)) return fail(req, 400, "invalid_request", "request_id : UUID requis.");

  const mode = body.mode;
  let kind: "accuse_reception" | "suivi" | null = null;
  let instructions: string | null = null;
  let text = "";
  if (mode === "draft") {
    if (!isDraftKind(body.kind)) {
      return fail(req, 400, "invalid_request", "kind : « accuse_reception » ou « suivi » attendu.");
    }
    kind = body.kind;
    if (body.instructions !== undefined && body.instructions !== null && typeof body.instructions !== "string") {
      return fail(req, 400, "invalid_request", "instructions : texte attendu.");
    }
    instructions = typeof body.instructions === "string" ? body.instructions.trim() : null;
    if (instructions && instructions.length > MAX_INSTRUCTIONS_CHARS) {
      return fail(req, 400, "invalid_request",
        `Les instructions dépassent ${MAX_INSTRUCTIONS_CHARS} caractères.`);
    }
    if (body.text !== undefined) return fail(req, 400, "invalid_request", "text : réservé au mode improve.");
  } else if (mode === "improve") {
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return fail(req, 400, "invalid_request", "Rien à améliorer : le message est vide.");
    }
    text = body.text;
    if (text.length > MAX_IMPROVE_CHARS) {
      return fail(req, 400, "too_long",
        `Le message est trop long pour être amélioré d'un coup (${MAX_IMPROVE_CHARS} caractères au plus).`);
    }
    if (body.kind !== undefined || body.instructions !== undefined) {
      return fail(req, 400, "invalid_request", "kind et instructions : réservés au mode draft.");
    }
  } else {
    return fail(req, 400, "invalid_request", "mode : « draft » ou « improve » attendu.");
  }

  if (!aiConfigured()) {
    return fail(req, 503, "not_configured", "L'assistant IA n'est pas configuré sur cette instance.");
  }

  // ---- Demande et droit d'instruction ---------------------------------------
  // `select` composé à l'exécution : le client ne peut pas en déduire le type.
  const { data: requestData } = await supabase
    .from("requests")
    .select(REQUEST_CONTEXT_COLUMNS)
    .eq("id", requestId)
    .maybeSingle();
  const request = requestData as unknown as ContextRequestRow | null;
  if (!request) return fail(req, 404, "not_found", "Demande introuvable.");

  const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
    p_user_id: userId,
    p_org_id: request.organization_id,
    p_socle_org_id: request.socle_scope_org_id,
    p_socle_procedure_id: request.socle_procedure_id,
    p_right: "instruction",
  });
  if (rightError) {
    console.error(`${LOG}: request_right_for en échec`, rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  if (allowed !== true) {
    return fail(req, 403, "forbidden",
      "Rédiger un échange exige le droit d'instruction sur cette demande.");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("socle_org_id")
    .eq("id", request.organization_id)
    .maybeSingle();
  const socleOrgId = org?.socle_org_id ?? null;
  if (!socleOrgId) {
    console.error(`${LOG}: tenant ${request.organization_id} sans socle_org_id`);
    return fail(req, 503, "not_configured",
      "L'assistant IA n'est pas disponible : cette organisation n'est pas raccordée au référentiel.");
  }

  // Usage LOCAL seulement : reconnaître l'identité dans les textes libres.
  // Jamais placé dans un prompt (voir l'en-tête).
  const { data: identityRow } = await supabase
    .from("requests")
    .select("requester_snapshot")
    .eq("id", requestId)
    .maybeSingle();
  const identity = identityTerms(identityRow?.requester_snapshot ?? null);

  const reference = { kind: "request" as const, id: requestId };

  // ---- « Améliorer mon message » ------------------------------------------------
  if (mode === "improve") {
    const masked = pseudonymize(text, identity);
    const outcome = await askSocle({
      system: IMPROVE_RULES,
      messages: [{ role: "user", content: buildImproveUserMessage(masked.text) }],
      feature: IMPROVE_FEATURE,
      agent: IMPROVE_FEATURE,
      maxOutputTokens: improveOutputTokens(masked.text),
      socleOrgId,
      reference,
      userId,
      logLabel: LOG,
    });
    if (!outcome.ok) {
      const mapped = mapSocleFailure(outcome.status, outcome.body);
      console.error(`${LOG}: guichet IA en échec (statut ${outcome.status ?? "aucun"}) → ${mapped.code}`);
      return fail(req, mapped.status, mapped.code, mapped.message);
    }
    const restored = restore(cleanImproveOutput(outcome.answer), masked.tokens);
    if (!restored.ok || restored.text.trim() === "") {
      // On ne rend JAMAIS un texte qui aurait perdu une donnée de l'agent.
      console.error(`${LOG}: jetons perdus (${restored.ok ? "sortie vide" : restored.missing.length}) ou inventés`);
      return fail(req, 502, "improve_unreliable",
        "L'amélioration proposée n'a pas conservé tout votre texte : elle n'a pas été appliquée. Réessayez.");
    }
    return json(req, 200, { body: restored.text });
  }

  // ---- Brouillon : le dossier, la démarche, les interventions, les échanges --
  const [eventsRes, interventionsRes, emailsRes, read, agentGuidance] = await Promise.all([
    supabase
      .from("request_events")
      .select("event_type, created_at")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(30),
    // Sans `intervenant_id` ni `requested_by` : aucun nom ne doit pouvoir sortir.
    supabase
      .from("request_interventions")
      .select("status, requested_for, request_comment, completed_on, completion_comment")
      .eq("request_id", requestId)
      .order("requested_at", { ascending: true }),
    // Jamais `to_email`. Seuls les échanges réellement partis font foi.
    supabase
      .from("request_emails")
      .select("subject, body, sent_at")
      .eq("request_id", requestId)
      .eq("status", "envoye")
      .order("sent_at", { ascending: false })
      .limit(5),
    request.socle_procedure_id
      ? socleKnowledge(request.socle_procedure_id, socleOrgId, LOG)
      : Promise.resolve(null),
    socleAgentGuidance(socleOrgId, LOG),
  ]);

  const context = buildRequestContext(request, (eventsRes.data ?? []).slice().reverse());
  const knowledgeUnavailable = Boolean(request.socle_procedure_id) && !read;
  const condensed = condenseKnowledge(
    read?.kb ?? emptyAiKnowledge(), [], DRAFT_KNOWLEDGE_BUDGET_TOKENS,
    read?.userCommunication ?? null, agentGuidance ?? null,
  );

  const system = buildDraftSystemPrompt(kind!);
  const user = buildDraftUserMessage({
    kind: kind!,
    instructions,
    context,
    procedureName: read?.name ?? context.procedure,
    knowledge: condensed.text,
    knowledgeUnavailable,
    interventions: (interventionsRes.data ?? []) as InterventionRow[],
    sentEmails: ((emailsRes.data ?? []) as SentEmailRow[]).slice().reverse(),
    identity,
  });

  const outcome = await askSocle({
    system,
    messages: [{ role: "user", content: user }],
    feature: DRAFT_FEATURE,
    agent: DRAFT_FEATURE,
    maxOutputTokens: DRAFT_OUTPUT_TOKENS,
    socleOrgId,
    reference,
    userId,
    logLabel: LOG,
  });
  if (!outcome.ok) {
    const mapped = mapSocleFailure(outcome.status, outcome.body);
    console.error(`${LOG}: guichet IA en échec (statut ${outcome.status ?? "aucun"}) → ${mapped.code}`);
    return fail(req, mapped.status, mapped.code, mapped.message);
  }
  const draft = cleanDraftOutput(outcome.answer);
  if (draft === "") {
    return fail(req, 502, "ai_unavailable", "L'assistant n'a rien rédigé — réessayez.");
  }
  return json(req, 200, {
    body: draft,
    subject: draftSubject(kind!, context.reference),
    context: {
      knowledge: condensed.text !== "",
      knowledgeUnavailable,
      interventions: interventionsRes.data?.length ?? 0,
      emails: emailsRes.data?.length ?? 0,
    },
  });
});
