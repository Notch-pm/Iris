// relay-courrier-clara — « Demande complexe » : un agent saisit une demande
// qu'il ne sait pas rattacher à une démarche (texte collé, fichiers), et Iris la
// RELAIE à Clara pour analyse. Action secondaire du guichet : l'action
// principale reste « Nouvelle demande ».
//
// ⚠️ IRIS NE CONSERVE RIEN. Aucune ligne, aucun octet au bucket des pièces :
// les fichiers sont lus en mémoire, vérifiés, puis transmis. C'est ce qui rend
// le geste compatible avec l'invariant « aucune demande libre » — une demande
// complexe n'est pas une demande d'Iris, c'est un courrier de Clara (canal
// « Relayé agent »).
//
// Ce que le SERVEUR décide, jamais le navigateur :
//   • le droit — création sur au moins un couple pour l'organisme désigné
//     (`user_can_create_on_organization`) ;
//   • l'organisme — connu du miroir du tenant, non obsolète ;
//   • l'identité de l'usager — fiche RELUE dans le Socle (seul l'identifiant
//     vient du navigateur), saisie épurée en secours seulement ;
//   • les consentements — `kind`/`granted` seuls, garde `normalizeConsents`
//     (Clara recompose la phrase avec le nom de SON tenant) ;
//   • les fichiers — la liste FERMÉE de formats d'Iris (`inspectUpload`) :
//     aucune raison qu'un fichier refusé à la porte d'Iris passe par la fenêtre ;
//   • l'agent relais — nommé depuis `users`, jamais depuis le formulaire.
//
// Transport : multipart vers la porte `iris-courrier` de Clara, de serveur à
// serveur, `Authorization: Bearer CLARA_IRIS_INTAKE_KEY` — une clé par appelant,
// le canal se déduit de la porte. Idempotence : `submission_id`, tiré par le
// navigateur à l'ouverture du formulaire et conservé entre deux tentatives.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  agentDisplayName,
  claraOutcome,
  parseRelayRequester,
  relayContentError,
  relayFailure,
  RELAY_MAX_FILE_BYTES,
  RELAY_MAX_FILES,
  senderCategoryOf,
  senderFields,
} from "../_shared/clara/relay.ts";
import { normalizeConsents } from "../_shared/consents/catalog.ts";
import { inspectUpload } from "../_shared/files/inspect.ts";
import { contactIdentitySnapshot } from "../_shared/identity/declared.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG = "relay-courrier-clara";
/** Corps maximal : les fichiers et une marge pour le texte et l'enrobage multipart. */
const MAX_BODY_BYTES = RELAY_MAX_FILES * RELAY_MAX_FILE_BYTES + 1024 * 1024;
const CLARA_TIMEOUT_MS = 30_000;

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

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
function jsonField(form: FormData, key: string): unknown {
  try {
    return JSON.parse(str(form, key));
  } catch {
    return null;
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

  const claraUrl = Deno.env.get("CLARA_IRIS_INTAKE_URL") ?? "";
  const claraKey = Deno.env.get("CLARA_IRIS_INTAKE_KEY") ?? "";
  if (!claraUrl || !claraKey || !Deno.env.get("SOCLE_API_URL") || !Deno.env.get("SOCLE_API_KEY")) {
    console.error(`${LOG}: secrets manquants (CLARA_IRIS_INTAKE_URL/KEY, SOCLE_API_URL/KEY)`);
    return fail(req, 503, "not_configured", "Le relais vers Clara n'est pas configuré sur cet environnement.");
  }

  // ---- Corps multipart -------------------------------------------------------
  if (!/^multipart\/form-data/i.test(req.headers.get("content-type") ?? "")) {
    return fail(req, 400, "bad_request", "Envoi multipart/form-data attendu.");
  }
  const declaredLength = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(req, 413, "payload_too_large", `${RELAY_MAX_FILES} fichiers de 10 Mo au plus.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(req, 400, "bad_request", "Corps multipart illisible.");
  }

  const organizationId = str(form, "organization_id");
  const targetId = str(form, "socle_organization_id");
  const submissionId = str(form, "submission_id");
  const body = str(form, "body").trim();
  if (!UUID_RE.test(organizationId)) return fail(req, 400, "bad_request", "organization_id : UUID requis.");
  if (!UUID_RE.test(targetId)) return fail(req, 400, "bad_request", "Organisme : UUID requis.");
  if (!UUID_RE.test(submissionId)) return fail(req, 400, "bad_request", "submission_id : UUID requis.");

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const contentError = relayContentError(body, files);
  if (contentError) return fail(req, 400, "bad_request", contentError);

  const requester = parseRelayRequester(jsonField(form, "requester"));
  if ("error" in requester) return fail(req, 400, "bad_request", requester.error);

  // ---- Appartenance au tenant (hors périmètre = 404, jamais révélé) ----------
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization:organizations(socle_org_id, name)")
    .eq("user_id", agentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const socleRootId = (membership as any)?.organization?.socle_org_id as string | undefined;
  if (!membership || !socleRootId) return fail(req, 404, "not_found", "Ressource introuvable.");
  // deno-lint-ignore no-explicit-any
  const organismName = (membership as any)?.organization?.name as string | null ?? null;

  // ---- Organisme connu du miroir du tenant -----------------------------------
  const { data: target } = await supabase
    .from("socle_organizations")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("socle_id", targetId)
    .is("obsoleted_at", null)
    .maybeSingle();
  if (!target) return fail(req, 400, "bad_request", "Organisme inconnu du référentiel du tenant.");

  // ---- Droit : création sur au moins un couple de cet organisme --------------
  const { data: canCreate, error: rightError } = await supabase.rpc("user_can_create_on_organization", {
    p_user_id: agentId,
    p_org_id: organizationId,
    p_socle_org_id: targetId,
  });
  if (rightError) {
    console.error(`${LOG} user_can_create_on_organization:`, rightError);
    return fail(req, 500, "internal_error", "Erreur lors de la vérification des droits.");
  }
  if (!canCreate) {
    return fail(req, 403, "forbidden", "Vous n'avez pas le droit de déposer une demande pour cet organisme.");
  }

  // ---- Consentements (garde serveur ; Clara recompose la phrase) -------------
  const consentCheck = normalizeConsents(jsonField(form, "consents"), organismName);
  if (!consentCheck.ok) return fail(req, 400, "bad_request", consentCheck.message);

  // ---- Fichiers : la liste fermée d'Iris, avant tout envoi -------------------
  const checkedFiles: { buffer: ArrayBuffer; name: string; mime: string }[] = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const inspected = inspectUpload({ bytes, fileName: file.name, maxBytes: RELAY_MAX_FILE_BYTES });
    if (!inspected.ok) {
      return fail(req, inspected.code === "payload_too_large" ? 413 : 415, inspected.code,
        `« ${file.name} » : ${inspected.message}`);
    }
    checkedFiles.push({ buffer, name: inspected.fileName, mime: inspected.type.mime });
  }

  // ---- Usager : la fiche du Socle fait foi -----------------------------------
  let sender: Record<string, string>;
  if (requester.kind === "contact") {
    const res = await fetch(`${contactsApiBase()}/v1/contacts/${requester.socle_contact_id}`, {
      headers: {
        Authorization: `Bearer ${Deno.env.get("SOCLE_API_KEY")}`,
        "X-Organization-Id": socleRootId,
      },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (res?.status === 404) return fail(req, 400, "bad_request", "Usager introuvable dans le Référentiel.");
    if (!res?.ok) {
      return fail(req, 502, "socle_unavailable", "Le Référentiel est injoignable — réessayez dans un instant.");
    }
    const raw = await res.json().catch(() => null);
    const declared = contactIdentitySnapshot(raw);
    if (!declared) return fail(req, 502, "socle_error", "Réponse inattendue du Référentiel.");
    sender = senderFields(declared, senderCategoryOf(raw?.contact_type), requester.socle_contact_id);
  } else {
    sender = senderFields(requester.declared, requester.audience, null);
  }

  // ---- Agent relais : nommé par la base, jamais par le formulaire ------------
  const { data: agent } = await supabase
    .from("users")
    .select("first_name, last_name, email")
    .eq("id", agentId)
    .maybeSingle();

  // ---- Relais à Clara ---------------------------------------------------------
  const out = new FormData();
  out.append("socle_organization_id", targetId);
  out.append("submission_id", submissionId);
  if (body) out.append("body", body);
  for (const [key, value] of Object.entries(sender)) out.append(key, value);
  out.append("relayed_by_name", agentDisplayName(agent ?? {}));
  if (agent?.email) out.append("relayed_by_email", agent.email);
  for (const consent of consentCheck.consents) {
    out.append(`consent_${consent.kind}`, consent.granted ? "true" : "false");
  }
  for (const file of checkedFiles) {
    out.append("files", new Blob([file.buffer], { type: file.mime }), file.name);
  }

  const res = await fetch(claraUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${claraKey}` },
    body: out,
    signal: AbortSignal.timeout(CLARA_TIMEOUT_MS),
  }).catch((e) => {
    console.error(`${LOG}: Clara injoignable`, e);
    return null;
  });
  if (!res) {
    const failure = relayFailure({ kind: "failed" });
    return fail(req, failure.status, failure.code, failure.message);
  }
  const outcome = claraOutcome(res.status, await res.json().catch(() => null));
  if (outcome.kind !== "ok") {
    console.error(`${LOG}: refus de Clara`, res.status, outcome);
    const failure = relayFailure(outcome);
    return fail(req, failure.status, failure.code, failure.message);
  }

  return json(req, 200, {
    reference: outcome.reference,
    duplicate: outcome.duplicate,
    organisme: target.name,
  });
});
