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
//     la garde que socle-proxy applique déjà à /v1/contacts/*) — OU l'accès à
//     la base de connaissances (`has_knowledge_base_access_for`, 2026-09-18),
//     dont l'écran porte le même assistant.
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
// ⚠️ IRIS N'APPELLE PLUS MISTRAL. Depuis la centralisation (2026-08-29), la
// clé du fournisseur et la comptabilité vivent dans le SOCLE : Iris compose le
// prompt et le confie à `ai-api`, qui réserve, appelle et solde. Il n'y a donc
// plus ici ni clé fournisseur, ni réservation, ni pré-contrôle de plafond —
// tout cela s'est rapproché de la dépense au lieu de s'en éloigner.
//
// La frontière tombe où il faut : IRIS DÉCIDE CE QUI EST DIT, LE SOCLE DÉCIDE
// SI ÇA PEUT L'ÊTRE ET CE QUE ÇA A COÛTÉ. Le Socle ne sait rien de ce qu'est
// une demande, et n'a pas à le savoir : il ne compose aucun prompt.
//
// ⚠️ CHAÎNE DE DÉLAIS, À NE PAS INVERSER : Mistral 55 s < Socle 60 s < Iris
// 75 s. Inversée, Iris abandonne des appels que le Socle termine et facture —
// et l'agent, en réessayant, paie deux fois.
//
// ⚠️ CONSÉQUENCE ASSUMÉE : un Socle injoignable ÉTEINT l'assistant, là où il
// se contentait de le dégrader (réponse sans base de connaissances). Le
// message le dit, et rappelle que l'instruction des demandes continue.
//
// DEUX TEMPS (2026-09-19) : l'assistant répond d'abord avec ce qui est composé
// ici. Quand la collectivité a déclaré des sources pour l'IA (sources en ligne
// et documents d'entraînement de la démarche, sources recommandées pour toutes
// ses démarches), il peut PROPOSER d'en consulter — une ligne balisée, retirée
// de la réponse et rendue au navigateur sous `proposal`. L'agent approuve ; le
// tour suivant porte `sources: [identifiants]`, et Iris lit ces sources avant
// d'appeler le guichet. Ce n'est PAS un outil : le modèle ne déclenche rien,
// le catalogue est RELU ici à chaque appel et un identifiant qui n'y figure
// pas est refusé. Le texte lu ne revient jamais par l'historique (entrée non
// fiable) : il est relu à chaque tour tant que l'agent maintient l'accord.
// Voir `_shared/ai/sources/` et `docs/assistant-ia.md`.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { buildRequestContext, REQUEST_CONTEXT_COLUMNS, type RequestContext } from "../_shared/ai/context.ts";
import { condenseKnowledge, KNOWLEDGE_BUDGET_TOKENS } from "../_shared/ai/condense.ts";
import {
  emptyAiKnowledge,
  isAiKnowledgeEmpty,
  parseAiKnowledge,
  type AiKnowledge,
} from "../_shared/ai/knowledge.ts";
import { parseClientHistory, type ChatMessage } from "../_shared/ai/messages.ts";
import { buildAssistantPrompt } from "../_shared/ai/prompt.ts";
import { estimateCall, MAX_OUTPUT_TOKENS } from "../_shared/ai/tokens.ts";
import { mapSocleFailure } from "../_shared/ai/socleErrors.ts";
import {
  parseUserCommunicationKnowledge,
  type UserCommunicationKnowledge,
} from "../_shared/ai/userCommunication.ts";
import {
  sanitizeAgentGuidanceView,
  type AgentGuidance,
} from "../_shared/organizations/agentGuidance.ts";
import {
  buildCatalogue,
  catalogueUrls,
  parseSourceIds,
  resolveSources,
  toRef,
} from "../_shared/ai/sources/catalogue.ts";
import { condenseConsulted, EXPLORATION_BUDGET_TOKENS } from "../_shared/ai/sources/consult.ts";
import { extractProposal } from "../_shared/ai/sources/proposal.ts";
import { allowedLinkOrigins, neutralizeLinks } from "../_shared/ai/links.ts";
import { readSources } from "../_shared/ai/sources/read.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alias logique de l'agent : le Socle le résout en identifiant réel. Iris ne
 *  connaît ni le modèle, ni l'agent — c'est ce qui permet d'en changer sans
 *  toucher une seule application. */
const AGENT_ALIAS = "assistant-instruction";
const FEATURE = "assistant-instruction";
/** 75 s : le dernier maillon de la chaîne, plus long que le Socle (60 s). */
const SOCLE_TIMEOUT_MS = 75_000;

/** Clés acceptées dans le corps. Toute autre ⇒ 400 (motif create-request-from-procedure). */
const ALLOWED_KEYS = new Set([
  "request_id", "organization_id", "socle_procedure_id", "messages", "sources",
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
 *
 * La même réponse porte, depuis le contrat 1.24.0, ce que la collectivité
 * publie pour ses usagers (`user_communication`, `user_description`) : aucun
 * second appel, et la même défense de périmètre.
 */
async function socleKnowledge(
  procedureId: string,
  socleRootId: string,
): Promise<
  { kb: AiKnowledge; userCommunication: UserCommunicationKnowledge; name: string | null } | undefined
> {
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
    userCommunication: parseUserCommunicationKnowledge(procedure),
    name: typeof procedure.name === "string" ? procedure.name : null,
  };
}

/**
 * Recommandations générales de la collectivité à ses agents (Socle 1.27.0),
 * lues sur la racine du tenant — elles valent pour TOUTES ses démarches, y
 * compris une demande historique sans démarche. `undefined` = référentiel muet
 * (l'assistant répond quand même, en le disant) ; rien d'écrit = une structure
 * vide, que `condenseKnowledge` ignore.
 */
async function socleAgentGuidance(socleRootId: string): Promise<AgentGuidance | undefined> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return undefined;
  const res = await fetch(`${base}/v1/organizations/${socleRootId}/agent-guidance`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`request-assistant: recommandations générales illisibles (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const body = await res.json().catch(() => null);
  if (!isRecord(body)) return undefined;
  return sanitizeAgentGuidanceView(body).guidance;
}

type SocleOutcome =
  | { ok: true; answer: string }
  | { ok: false; status: number | null; body: unknown };

/**
 * Base de `ai-api`, dérivée de celle du référentiel — les edge functions d'un
 * même projet ne diffèrent que par leur dernier segment.
 */
function aiApiBase(): string {
  const base = publicApiBase();
  return base === "" ? "" : base.replace(/public-api$/, "ai-api");
}

/**
 * L'appel au guichet IA du Socle.
 *
 * Ce qu'Iris envoie : le prompt système QU'IL A COMPOSÉ, la conversation, un
 * alias d'agent, et des références opaques. Ce qu'il n'envoie pas : ni modèle,
 * ni agent réel, ni imputation — l'imputation vient de la clé, et le Socle la
 * refuserait dans le corps.
 *
 * `X-Organization-Id` est TOUJOURS dérivé côté serveur du tenant vérifié.
 */
async function askSocle(
  system: string,
  messages: ChatMessage[],
  ctx: { socleOrgId: string; requestId: string | null; procedureId: string | null; userId: string },
): Promise<SocleOutcome> {
  const base = aiApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) {
    console.error("request-assistant: SOCLE_API_URL ou SOCLE_API_KEY absente");
    return { ok: false, status: 503, body: null };
  }

  const res = await fetch(`${base}/v1/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Organization-Id": ctx.socleOrgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      feature: FEATURE,
      agent: AGENT_ALIAS,
      system,
      messages,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // Indication seulement : le Socle recalcule et retient le maximum.
      estimated_tokens: estimateCall({ system, messages }),
      reference: ctx.requestId
        ? { kind: "request", id: ctx.requestId }
        : ctx.procedureId ? { kind: "procedure", id: ctx.procedureId } : null,
      actor_id: ctx.userId,
    }),
    signal: AbortSignal.timeout(SOCLE_TIMEOUT_MS),
  }).catch(() => null);

  // Pas de réponse : réseau, délai dépassé, Socle à terre. `status: null` est
  // le seul cas où l'agent apprend que le référentiel est en cause — parce que
  // c'est actionnable pour lui.
  if (!res) return { ok: false, status: null, body: null };

  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, body };

  // Le `usage` et le `quota` de la réponse ne sont PAS relus ici : le journal
  // et le compteur du Socle font foi, et une seconde comptabilité côté Iris ne
  // pourrait que diverger. Seule la réponse nous intéresse.
  const answer = isRecord(body) ? (body as { answer?: unknown }).answer : null;
  if (typeof answer !== "string" || answer.trim() === "") {
    console.error("request-assistant: réponse du guichet IA vide ou inattendue");
    return { ok: false, status: 502, body: null };
  }
  return { ok: true, answer: answer.trim() };
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

  // Les sources que l'agent a autorisées : forme contrôlée ici, existence
  // contrôlée une fois le catalogue relu dans le Socle.
  const requestedSources = parseSourceIds(body.sources);
  if (!requestedSources.ok) return fail(req, 400, "invalid_request", requestedSources.message);

  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const requestMode = requestId !== "";
  if (requestMode && !UUID_RE.test(requestId)) {
    return fail(req, 400, "invalid_request", "request_id : UUID requis.");
  }

  // Après la validation du corps : une requête malformée est malformée, que
  // l'instance soit raccordée au guichet IA ou non. Et avant tout travail en
  // base : inutile de lire une demande pour finir en 503.
  //
  // Ce n'est PAS la clé du fournisseur (Iris n'en a plus), c'est la clé Socle
  // d'Iris — celle qui porte le scope « ai » et l'imputation.
  if (aiApiBase() === "" || !Deno.env.get("SOCLE_API_KEY")) {
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

    // Deux portes vers le mode démarche : le GUICHET (un droit de création) et
    // la BASE DE CONNAISSANCES (l'attribut de profil, 2026-09-18). Les deux
    // lisent la même chose — la démarche seule —, et c'est une question de
    // budget, pas de confidentialité : la fiche est déjà lisible par tout membre.
    const [creation, knowledge] = await Promise.all([
      supabase.rpc("has_any_creation_right_for", { p_user_id: userId, p_org_id: organizationId }),
      supabase.rpc("has_knowledge_base_access_for", { p_user_id: userId, p_org_id: organizationId }),
    ]);
    if (creation.error || knowledge.error) {
      console.error("request-assistant: droits du mode démarche en échec", creation.error ?? knowledge.error);
      return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
    }
    if (creation.data !== true && knowledge.data !== true) {
      return fail(req, 403, "forbidden",
        "Utiliser l'assistant sur une démarche exige un droit de création de demande, ou l'accès à la base de connaissances.");
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

  // ⚠️ AUCUN PRÉ-CONTRÔLE DE PLAFOND ICI. Iris ne tient plus de compteur : il
  // n'a donc rien à consulter, et surtout rien qui puisse diverger du seul
  // compteur qui fasse foi. Le refus arrive du Socle, en 429, avec sa date.

  // ---- Socle : la base de connaissances COMPLÈTE ----------------------------
  const { data: org } = await supabase
    .from("organizations")
    .select("socle_org_id")
    .eq("id", organizationId)
    .maybeSingle();

  // Sans rattachement au Socle, il n'y a ni collectivité à débiter ni base de
  // connaissances à lire : le guichet refuserait, autant le dire ici.
  const socleOrgId = org?.socle_org_id ?? null;
  if (!socleOrgId) {
    console.error(`request-assistant: tenant ${organizationId} sans socle_org_id`);
    return fail(req, 503, "not_configured",
      "L'assistant IA n'est pas disponible : cette organisation n'est pas raccordée au référentiel.");
  }

  let knowledge: AiKnowledge = emptyAiKnowledge();
  let userCommunication: UserCommunicationKnowledge | null = null;
  let procedureName: string | null = null;
  let knowledgeUnavailable = false;
  // Les deux lectures sont indépendantes : en parallèle, pour ne pas allonger
  // l'attente de l'agent d'un aller-retour de plus.
  const [read, agentGuidance] = await Promise.all([
    socleProcedureId ? socleKnowledge(socleProcedureId, socleOrgId) : Promise.resolve(null),
    socleAgentGuidance(socleOrgId),
  ]);
  if (socleProcedureId) {
    if (read) {
      knowledge = read.kb;
      userCommunication = read.userCommunication;
      procedureName = read.name;
    } else {
      knowledgeUnavailable = true;
    }
  }
  if (!procedureName && context) procedureName = context.procedure;

  // ---- Sources déclarées pour l'IA : le catalogue, relu à chaque appel -----
  // Construit depuis ce qui vient d'être lu — aucun appel Socle de plus. Une
  // lecture manquée (démarche ou recommandations) le rend PARTIEL : une source
  // approuvée qu'on ne retrouve pas n'est alors pas une faute du navigateur.
  const catalogue = buildCatalogue(knowledge, agentGuidance ?? null, { socleOrgId });
  const resolved = resolveSources(
    catalogue,
    requestedSources.ids,
    knowledgeUnavailable || agentGuidance === undefined,
  );
  if (!resolved.ok) {
    return fail(req, 400, "unknown_source",
      "Une source demandée n'est pas déclarée pour cette démarche. Rechargez la page.");
  }
  const reads = await readSources(resolved.entries, {
    socleApiBase: publicApiBase(),
    socleKey: Deno.env.get("SOCLE_API_KEY") ?? "",
    socleOrgId,
  });
  const exploration = condenseConsulted(reads, EXPLORATION_BUDGET_TOKENS);
  const unreadSources = [
    ...exploration.unread,
    ...resolved.missing.map((id) => ({ id, label: "", reason: "référentiel momentanément illisible" })),
  ];
  // Ce qui peut encore être proposé : tout le catalogue, moins ce que l'agent
  // a déjà autorisé (lu ou non — le reproposer ne servirait à rien).
  const offered = catalogue
    .filter((e) => !requestedSources.ids.includes(e.id))
    .map(toRef);

  // ---- Composition ----------------------------------------------------------
  // Les documents d'entraînement ne sont plus servis d'office : ils sont au
  // catalogue, lus sur approbation de l'agent.
  const condensed = condenseKnowledge(
    knowledge, [], KNOWLEDGE_BUDGET_TOKENS, userCommunication, agentGuidance ?? null,
    { offeredUrls: catalogueUrls(catalogue) },
  );
  const system = buildAssistantPrompt({
    context,
    knowledge: condensed.text,
    procedureName,
    serviceName,
    // ⚠️ TOUJOURS VRAI depuis la centralisation. Iris ne sait plus si le Socle
    // résoudra l'alias vers un agent Mistral (dont la console porterait déjà
    // ces règles) ou vers un modèle nu. Lire cette configuration ici en
    // recréerait un jumeau, qui dériverait le jour où le Socle changerait
    // d'agent — et un prompt SANS règles est une faute, là où un prompt qui
    // les répète ne coûte que quelques centaines de jetons.
    includeBaseRules: true,
    skippedDocuments: condensed.skipped.map((s) => s.name),
    truncated: condensed.truncated,
    knowledgeUnavailable,
    // Le service n'a rien rédigé pour la démarche, mais la base n'est pas vide
    // pour autant : textes publiés aux usagers, recommandations générales.
    noInternalGuidance: (condensed.userCommunication || condensed.agentGuidance) &&
      isAiKnowledgeEmpty(knowledge),
    generalGuidance: condensed.agentGuidance,
    userCommunication: condensed.userCommunication,
    generalGuidanceUnavailable: agentGuidance === undefined,
    consultable: offered,
    consulted: exploration.consulted,
    unreadSources,
    consultedTruncated: exploration.truncated,
  });

  // ---- L'appel : le Socle réserve, appelle et solde -----------------------
  // Le cycle réserver → appeler → solder n'a pas disparu, il a DÉMÉNAGÉ : il
  // vit désormais entier dans une seule fonction du Socle, sans franchir de
  // frontière réseau. C'est plus court qu'avant, pas plus long.
  const outcome = await askSocle(system, history.messages, {
    socleOrgId,
    requestId: requestMode ? requestId : null,
    procedureId: socleProcedureId,
    userId,
  });
  if (!outcome.ok) {
    const mapped = mapSocleFailure(outcome.status, outcome.body);
    console.error(
      `request-assistant: guichet IA en échec (statut ${outcome.status ?? "aucun"}) → ${mapped.code}`,
    );
    return fail(req, mapped.status, mapped.code, mapped.message);
  }
  // La balise de proposition est retirée du texte ; seuls les identifiants
  // OFFERTS à ce tour survivent.
  const extracted = extractProposal(outcome.answer, offered);
  // Politique de liens : une réponse ne garde cliquables que les liens vers
  // une origine DÉCLARÉE dans le référentiel. Sans elle, un texte injecté
  // (réponse d'usager, page consultée) ferait porter le dossier par l'URL d'un
  // lien au libellé honnête. Voir `_shared/ai/links.ts`.
  const declaredOrigins = allowedLinkOrigins([
    ...knowledge.aiSources.map((l) => l.url),
    ...knowledge.agentLinks.map((l) => l.url),
    ...(agentGuidance?.recommendedSources ?? []).map((l) => l.url),
  ]);
  const answer = neutralizeLinks(extracted.answer, declaredOrigins);
  return json(req, 200, {
    answer: answer || "L'assistant n'a pas formulé de réponse — reformulez la question.",
    proposal: extracted.proposal ? { sources: extracted.proposal } : null,
    context: {
      sources: {
        consulted: exploration.consulted.map(({ text: _text, ...ref }) => ref),
        skipped: unreadSources,
      },
      knowledge: condensed.text !== "",
      knowledgeUnavailable,
      truncated: condensed.truncated,
      userCommunication: condensed.userCommunication,
      agentGuidance: condensed.agentGuidance,
      documents: { used: condensed.included, skipped: condensed.skipped },
      answers: context?.answers.length ?? 0,
      removedIdentityKeys: context?.removedIdentityKeys ?? [],
    },
  });
});
