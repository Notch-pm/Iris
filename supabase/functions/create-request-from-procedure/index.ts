// create-request-from-procedure — création finale du parcours guidé.
// Règle non négociable : AUCUNE demande libre. La démarche est RECHARGÉE
// depuis Socle côté serveur ; le navigateur ne peut ni fournir ni altérer
// procedure_snapshot (il n'envoie que des identifiants, des valeurs de champs
// et des références de pièces déjà déposées dans le bucket).
//
// Auth : JWT agent vérifié EN CODE (verify_jwt=false pour laisser passer les
// préflights OPTIONS) + appartenance au tenant + droit de CRÉATION sur le
// couple (organisation destinataire, démarche) — profils de droits, RM-60.
// Écriture : UNE transaction via la RPC create_request_from_procedure
// (demande + pièces + événement request_created_from_procedure — tout ou rien).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  parseFormSchema,
  sanitizeDeclared,
  validateFormSubmission,
  validateRequesterSubmission,
} from "./_shared/procedureForm.ts";
import { whitelistProcedureSnapshot } from "./_shared/snapshots.ts";
import { contactIdentitySnapshot } from "../_shared/identity/declared.ts";
import { parsePayload } from "./_shared/payload.ts";

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
function fail(req: Request, status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json(req, status, { error: { code, message, ...(extra ?? {}) } });
}

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}
function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return publicApiBase().replace("public-api", "contacts-api");
}

async function socleFetch(url: string, socleOrgId?: string): Promise<Response | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("SOCLE_API_KEY")}`,
  };
  if (socleOrgId) headers["X-Organization-Id"] = socleOrgId;
  return await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  const missing = [
    !Deno.env.get("SOCLE_API_URL") ? "SOCLE_API_URL" : null,
    !Deno.env.get("SOCLE_API_KEY") ? "SOCLE_API_KEY" : null,
  ].filter((n): n is string => n !== null);
  if (missing.length > 0) {
    return fail(req, 503, "not_configured", `Secrets manquants : ${missing.join(", ")}.`);
  }

  // Agent authentifié (JWT de session Iris).
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const agentId = userData.user.id;

  const parsed = parsePayload(await req.json().catch(() => null));
  if ("error" in parsed) return fail(req, 400, "bad_request", parsed.error);
  const p = parsed;

  // Appartenance au tenant (hors périmètre = 404, jamais révélé).
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization:organizations(socle_org_id)")
    .eq("user_id", agentId)
    .eq("organization_id", p.organizationId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const socleRootId = (membership as any)?.organization?.socle_org_id as string | undefined;
  if (!membership || !socleRootId) return fail(req, 404, "not_found", "Ressource introuvable.");

  // Organisation destinataire OBLIGATOIRE (RM-29) : doit être connue du
  // miroir du tenant (non obsolète) — jamais un simple repli silencieux.
  const { data: destination } = await supabase
    .from("socle_organizations")
    .select("name")
    .eq("organization_id", p.organizationId)
    .eq("socle_id", p.destinationId)
    .is("obsoleted_at", null)
    .maybeSingle();
  if (!destination) {
    return fail(req, 400, "bad_request", "Organisation destinataire inconnue du référentiel du tenant.");
  }
  const destinationLabel = destination.name;

  // Droit de CRÉATION sur le couple (destinataire, démarche) — profils de
  // droits (RM-60). Remplace l'ancienne vérification de rôle.
  const { data: hasCreationRight, error: rightError } = await supabase.rpc("user_has_request_right", {
    p_user_id: agentId,
    p_org_id: p.organizationId,
    p_socle_org_id: p.destinationId,
    p_socle_procedure_id: p.procedureId,
    p_right: "creation",
  });
  if (rightError) {
    console.error("create-request-from-procedure user_has_request_right:", rightError);
    return fail(req, 500, "internal_error", "Erreur lors de la vérification des droits.");
  }
  if (!hasCreationRight) {
    return fail(req, 403, "forbidden",
      "Vous n'avez pas le droit de créer une demande pour cette démarche et ce service.");
  }

  // Démarche ACTIVE du tenant (cache = autorité de périmètre)…
  const { data: cached } = await supabase
    .from("socle_procedure_cache")
    .select("socle_id")
    .eq("socle_id", p.procedureId)
    .eq("organization_id", p.organizationId)
    .is("obsoleted_at", null)
    .maybeSingle();
  if (!cached) {
    return fail(req, 400, "bad_request", "Démarche introuvable, obsolète ou hors du périmètre du tenant.");
  }

  // …RECHARGÉE depuis Socle côté serveur : le schéma qui fait foi n'est JAMAIS
  // celui du navigateur. La création guidée exige le référentiel joignable
  // (contrairement à l'ingestion, jamais refusée : ici l'agent peut réessayer).
  const procRes = await socleFetch(`${publicApiBase()}/v1/procedures/${p.procedureId}`);
  if (procRes?.status === 404) {
    return fail(req, 400, "bad_request", "Démarche introuvable dans le Socle — synchronisez le référentiel.");
  }
  if (!procRes?.ok) {
    return fail(req, 502, "socle_unavailable", "Le Socle est injoignable — réessayez dans un instant.");
  }
  const procedureSnapshot = whitelistProcedureSnapshot(await procRes.json().catch(() => null));
  if (!procedureSnapshot) return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");

  const schema = parseFormSchema(procedureSnapshot.form_schema);
  const requesterConfig = procedureSnapshot.requester_config;

  // Demandeur : gouverné par le requester_config de la démarche rechargée.
  const requesterCheck = validateRequesterSubmission(requesterConfig, p.requester);
  if (!requesterCheck.ok) return fail(req, 400, "bad_request", requesterCheck.message);

  let declared: Record<string, unknown> | null = null;
  let socleContactId: string | null = null;
  let identityStatus: "rapprochee" | "non_rapprochee" | "anonyme";
  // Tableau d'OBJETS `{code}` — jamais de chaînes nues : `requests_set_scope_org`
  // filtre par `a ->> 'code'`, et une chaîne y donne NULL puis disparaît au
  // premier recalcul de périmètre.
  const anomalies: { code: string }[] = [];
  if (p.requester.kind === "contact") {
    const contactRes = await socleFetch(
      `${contactsApiBase()}/v1/contacts/${p.requester.socle_contact_id}`,
      socleRootId,
    );
    if (contactRes?.status === 404) {
      return fail(req, 400, "bad_request", "Usager introuvable dans le Socle.");
    }
    if (!contactRes?.ok) {
      return fail(req, 502, "socle_unavailable", "Le Socle est injoignable — réessayez dans un instant.");
    }
    declared = contactIdentitySnapshot(await contactRes.json().catch(() => null));
    if (!declared) return fail(req, 502, "socle_error", "Réponse inattendue du Socle.");
    socleContactId = p.requester.socle_contact_id;
    identityStatus = "rapprochee";
  } else if (p.requester.kind === "sans_rapprochement") {
    // SORTIE DE SECOURS (décision PO 2026-08-26). Le parcours normal crée
    // désormais la fiche dans le Socle : on n'arrive ici qu'après un échec
    // avéré du référentiel. La demande le dit d'elle-même — l'anomalie est
    // posée par le SERVEUR, jamais sur un drapeau du navigateur, sans quoi
    // n'importe quel client pourrait s'en dispenser.
    declared = sanitizeDeclared(p.requester.audience, p.requester.declared);
    identityStatus = "non_rapprochee";
    anomalies.push({ code: "usager_a_creer_dans_socle" });
  } else {
    declared = { anonymous: true };
    identityStatus = "anonyme";
  }

  // Formulaire : conditions, obligatoires, types, options, pièces (cardinalités
  // et formats) — validés contre le SCHÉMA RECHARGÉ.
  const form = validateFormSubmission(schema, p.formValues, p.attachments);
  if (!form.ok) {
    return fail(req, 400, "bad_request", "Formulaire invalide.", { fields: form.errors });
  }

  // Écriture ATOMIQUE (RPC = une transaction : demande + pièces + événement).
  const { data: created, error: rpcError } = await supabase.rpc("create_request_from_procedure", {
    p: {
      agent_id: agentId,
      organization_id: p.organizationId,
      request_id: p.requestId,
      subject: p.subject,
      body: p.body,
      priority: p.priority,
      channel: p.channel ?? "guichet",
      socle_organization_id: p.destinationId,
      socle_organization_label: destinationLabel,
      socle_procedure_id: p.procedureId,
      socle_contact_id: socleContactId,
      procedure_snapshot: procedureSnapshot,
      requester_snapshot: { declared, socle_contact_id: socleContactId },
      identity_status: identityStatus,
      anomalies,
      form_data: form.formData,
      audience: p.requester.kind === "anonyme" ? null : p.requester.audience,
      attachments: p.attachments,
    },
  });
  if (rpcError) {
    if (rpcError.code === "23505" || rpcError.message?.includes("duplicate key")) {
      return fail(req, 409, "conflict", "Ce brouillon de demande a déjà été déposé.");
    }
    console.error("create-request-from-procedure rpc:", rpcError);
    return fail(req, 500, "internal_error", rpcError.message ?? "Erreur serveur.");
  }

  // deno-lint-ignore no-explicit-any
  const result = created as any;
  return json(req, 201, { id: result.id, reference: result.reference });
});
