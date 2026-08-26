// send-request-email — l'agent répond à l'usager, depuis la fiche demande.
//
// Habilitation : **droit d'INSTRUCTION** sur le couple de la demande
// (organisation porteuse Socle, démarche). La règle reste écrite en SQL —
// `request_right_for(user, org, socle_org, procedure, 'instruction')`, le même
// moteur `permission_pairs_of` que partout ailleurs : la fonction la consulte,
// elle ne la réinvente pas. C'est aussi exactement le droit qu'exigent déjà la
// policy d'insertion de `request_attachments` et la policy storage du bucket,
// donc rien ne se contourne en passant par le navigateur.
//
// ⚠️ L'ADRESSE DU DESTINATAIRE EST RÉSOLUE ICI, jamais acceptée du navigateur :
// un client qui pourrait désigner le destinataire ferait d'Iris un relais
// ouvert. Elle vient de la fiche de l'usager RELUE DANS LE SOCLE quand la
// demande est rattachée à une fiche (`socle_contact_id`) — le Socle est la
// source de vérité des usagers, et une adresse corrigée après le dépôt doit
// servir —, et du `requester_snapshot` figé au dépôt sinon : identité déclarée
// sans rapprochement, ou Socle injoignable (dégradé, jamais un refus).
//
// ⚠️ LES CHEMINS DE PIÈCES SONT VÉRIFIÉS : chacun doit être préfixé par
// `{organization_id}/{request_id}/`. Sans cela, un agent joindrait n'importe
// quel objet du bucket à son courrier (motif du « chemin préfixé au brouillon »
// de create-request-from-procedure).
//
// L'échange est écrit AVANT l'envoi (`start_request_email`), puis clos
// (`settle_request_email`). Écrire après laisserait un trou : l'e-mail parti et
// aucune trace si l'écriture échoue. Ici un échec laisse une ligne « echec »
// avec son motif, lisible dans l'onglet Échanges.
//
// Envoi SYNCHRONE, motif `admin-users` : la file d'attente de
// `notifications-mailer` existe parce qu'un envoi y est l'effet de bord d'un
// geste métier (« on n'annule pas une affectation parce qu'un serveur de mail
// tousse »). Ici l'envoi EST le geste, et l'agent attend sa réponse.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { resolveSmtp, type SmtpConfig, type SmtpRow } from "../_shared/email/config.ts";
import { sendBrandedEmail, type EmailAttachment } from "../_shared/email/transport.ts";
import { usagerBrand, usagerEmailContent } from "../_shared/email/usager.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);

/** Jumeau de `MAX_EMAIL_ATTACHMENT_BYTES` (src/features/requests/instruction/courriel.ts).
 *  Ici c'est la garde ; là-bas, le confort qui ferme le bouton plus tôt. */
const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
const BUCKET = "request-attachments";

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

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- Socle (contacts-api) ---------------------------------------------------
// Même accès que `create-request-from-procedure` : clé de service côté serveur,
// périmètre porté par `X-Organization-Id` (racine Socle du tenant).

function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "").replace("public-api", "contacts-api");
}

/**
 * L'adresse portée AUJOURD'HUI par la fiche Socle de l'usager.
 *
 * `undefined` = fiche non lisible (Socle injoignable, non configuré, fiche
 * supprimée) : l'appelant retombe sur le dépôt. `null` = fiche lue, sans
 * adresse : c'est une réponse, pas une panne — on ne ressuscite pas une adresse
 * que l'usager a fait retirer du référentiel.
 */
async function socleContactEmail(
  socleContactId: string,
  socleRootId: string | null,
): Promise<string | null | undefined> {
  const base = contactsApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleRootId) return undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "X-Organization-Id": socleRootId,
  };
  const res = await fetch(`${base}/v1/contacts/${socleContactId}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`send-request-email: fiche Socle ${socleContactId} illisible (${res?.status ?? "réseau"})`);
    return undefined;
  }
  const contact = await res.json().catch(() => null);
  if (!isRecord(contact)) return undefined;
  const email = contact.email;
  return typeof email === "string" && email.trim() !== "" ? email.trim() : null;
}

/**
 * L'adresse de l'usager telle qu'elle a été retenue AU DÉPÔT — le repli, quand
 * la demande ne porte aucune fiche Socle à relire (identité déclarée sans
 * rapprochement) ou que le référentiel est muet. Mêmes cascades de clés que
 * `requesterIdentity()` côté écran (contacts-api, publics Iris, synonymes
 * partenaires) : l'agent doit envoyer à l'adresse qu'il voit.
 */
function recipientEmail(snapshot: unknown, identityStatus: string): string | null {
  if (identityStatus === "anonyme") return null;
  const declared = isRecord(snapshot) && isRecord(snapshot.declared) ? snapshot.declared : {};
  if (declared.anonymous === true) return null;
  for (const key of ["email", "courriel", "mail"]) {
    const value = declared[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

interface DeclaredAttachment {
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number;
}

/** Serveur d'envoi du tenant, relais de plateforme en repli. */
async function smtpForOrg(orgId: string): Promise<{ smtp: SmtpConfig | null; tenantName: string | null }> {
  const { data, error } = await supabase.rpc("smtp_config_for_org", { p_org_id: orgId });
  if (error) console.error("send-request-email: smtp_config_for_org en échec", error);
  const row = ((Array.isArray(data) ? data[0] : null) ?? null) as
    | (SmtpRow & { organization_name?: string | null })
    | null;
  return { smtp: resolveSmtp(row, Deno.env.toObject()), tenantName: row?.organization_name ?? null };
}

/** Retire des objets déjà téléversés — le brouillon n'a pas abouti. */
async function discardUploads(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error("send-request-email: nettoyage des pièces en échec", error);
}

async function settle(id: string, ok: boolean, message?: string): Promise<void> {
  const { error } = await supabase.rpc("settle_request_email", {
    p_id: id,
    p_ok: ok,
    p_error: message ?? null,
  });
  if (error) console.error("send-request-email: settle_request_email en échec", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  // ---- Authentification de l'appelant --------------------------------------
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const actorId = userData.user.id;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = str(body?.request_id);
  const subject = str(body?.subject);
  const message = typeof body?.body === "string" ? body.body : "";
  if (requestId === "") return fail(req, 400, "invalid_request", "Demande manquante.");
  if (subject === "") return fail(req, 400, "invalid_subject", "L'objet est obligatoire.");
  if (message.trim() === "") return fail(req, 400, "invalid_body", "Le message est obligatoire.");

  // ---- La demande, et le droit d'instruction sur SON couple -----------------
  const { data: request } = await supabase
    .from("requests")
    .select(
      "id, organization_id, socle_scope_org_id, socle_procedure_id, socle_contact_id, " +
        "requester_snapshot, identity_status, reference",
    )
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
    console.error("send-request-email: request_right_for en échec", rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  if (allowed !== true) {
    return fail(req, 403, "forbidden", "Écrire à l'usager exige le droit d'instruction sur cette demande.");
  }

  // ---- Le destinataire, résolu ici ------------------------------------------
  // Fiche Socle d'abord (source de vérité, corrections postérieures au dépôt
  // comprises), snapshot du dépôt en repli. Le navigateur ne propose rien.
  const deposited = recipientEmail(request.requester_snapshot, request.identity_status);
  let to = deposited;
  if (request.socle_contact_id && request.identity_status !== "anonyme") {
    const { data: org } = await supabase
      .from("organizations")
      .select("socle_org_id")
      .eq("id", request.organization_id)
      .maybeSingle();
    const live = await socleContactEmail(request.socle_contact_id, org?.socle_org_id ?? null);
    // `undefined` = référentiel muet : on garde le dépôt plutôt que de refuser.
    if (live !== undefined) to = live;
  }
  if (!to) {
    return fail(req, 400, "no_recipient", "Cette demande ne porte aucune adresse de courriel.");
  }

  // ---- Les pièces : chemins vérifiés, poids borné ---------------------------
  const prefix = `${request.organization_id}/${request.id}/`;
  const declared: DeclaredAttachment[] = Array.isArray(body?.attachments)
    ? (body.attachments as unknown[]).filter(isRecord).map((a) => ({
      storage_path: str(a.storage_path),
      file_name: str(a.file_name) || "piece-jointe",
      mime_type: str(a.mime_type) || null,
      file_size: typeof a.file_size === "number" && a.file_size >= 0 ? a.file_size : 0,
    }))
    : [];
  const paths = declared.map((a) => a.storage_path);

  if (declared.some((a) => !a.storage_path.startsWith(prefix))) {
    // Aucun nettoyage : les chemins sont hors de cette demande, on n'y touche pas.
    return fail(req, 400, "invalid_attachment", "Pièce jointe hors de cette demande.");
  }
  if (declared.reduce((sum, a) => sum + a.file_size, 0) > MAX_ATTACHMENTS_BYTES) {
    await discardUploads(paths);
    return fail(req, 400, "attachments_too_large", "Les pièces jointes dépassent 10 Mo.");
  }

  // ---- L'échange est ouvert AVANT l'envoi ------------------------------------
  const { data: emailId, error: startError } = await supabase.rpc("start_request_email", {
    p_request_id: request.id,
    p_sent_by: actorId,
    p_to_email: to,
    p_subject: subject,
    p_body: message,
    p_template_id: str(body?.template_id) || null,
    p_template_name: str(body?.template_name) || null,
    p_attachments: declared,
  });
  if (startError || typeof emailId !== "string") {
    console.error("send-request-email: start_request_email en échec", startError);
    await discardUploads(paths);
    return fail(req, 500, "not_recorded", "L'échange n'a pas pu être enregistré : rien n'a été envoyé.");
  }

  // ---- Relais, pièces, envoi -------------------------------------------------
  const { smtp, tenantName } = await smtpForOrg(request.organization_id);
  if (!smtp) {
    await settle(emailId, false, "Aucun serveur d'envoi configuré pour cette collectivité.");
    return fail(
      req,
      400,
      "smtp_missing",
      "Aucun serveur d'envoi configuré : renseignez-le dans le Socle, puis synchronisez le référentiel.",
    );
  }

  const attachments: EmailAttachment[] = [];
  for (const piece of declared) {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(piece.storage_path);
    if (error || !blob) {
      const reason = `Pièce jointe illisible : ${piece.file_name}.`;
      await settle(emailId, false, reason);
      return fail(req, 502, "attachment_unreadable", reason);
    }
    attachments.push({
      filename: piece.file_name,
      content: new Uint8Array(await blob.arrayBuffer()),
      contentType: piece.mime_type ?? undefined,
    });
  }

  try {
    await sendBrandedEmail(
      smtp,
      to,
      usagerEmailContent(subject, message),
      usagerBrand(tenantName),
      attachments,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Envoi impossible.";
    await settle(emailId, false, reason);
    return fail(req, 502, "send_failed", reason);
  }

  await settle(emailId, true);
  // Journal : jamais l'adresse ni le contenu — seulement de quoi suivre l'envoi.
  console.log(
    `send-request-email: échange ${emailId} envoyé (demande=${request.reference}, ` +
      `pièces=${attachments.length}, relais=${smtp.source})`,
  );
  return json(req, 200, { email_id: emailId, to, email_sent: true });
});
