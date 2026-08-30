// send-request-email — ce qui part d'Iris vers l'usager, depuis la fiche.
//
// DEUX MODES, deux habilitations, et ce n'est pas un hasard :
//
//   . `kind` absent (défaut) — LE MESSAGE LIBRE. L'agent a rédigé l'objet et le
//     corps, il les envoie. Droit exigé : **INSTRUCTION**.
//
//   . `kind: "cloture"` — L'AVIS DE CLÔTURE, composé ICI à partir du seul état
//     enregistré de la demande (statut, référence, objet, `closure_text`). Le
//     navigateur n'envoie QUE l'identifiant : ni objet, ni corps, ni pièce ne
//     sont acceptés. Droit exigé : **CLÔTURE** — celui-là même qui vient
//     d'autoriser la résolution.
//     C'est cette composition serveur qui permet d'ouvrir la fonction à la
//     clôture sans en faire un relais ouvert : détenir `cloture` ne donne pas
//     le pouvoir d'écrire n'importe quoi à un habitant, seulement celui
//     d'annoncer une décision qu'on vient de prendre.
//
// Habilitation du mode libre : **droit d'INSTRUCTION** sur le couple de la demande
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
import { charteFromSocle, type EmailCharte, type SocleBrandingDto } from "../_shared/email/charte.ts";
import { closureEmail, isClosureOutcome } from "../_shared/email/cloture.ts";
import { pickDeclared } from "../_shared/identity/declared.ts";

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
  return publicApiBase().replace("public-api", "contacts-api");
}

/**
 * L'adresse portée AUJOURD'HUI par la fiche Socle de l'usager.
 *
 * `undefined` = fiche non lisible (Socle injoignable, non configuré, fiche
 * supprimée) : l'appelant retombe sur le dépôt. `null` = fiche lue, sans
 * adresse : c'est une réponse, pas une panne — on ne ressuscite pas une adresse
 * que l'usager a fait retirer du référentiel.
 */
async function socleContactIdentity(
  socleContactId: string,
  socleRootId: string | null,
): Promise<RecipientIdentity | undefined> {
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
  return declaredIdentity(contact);
}

/**
 * L'identité servie à la formule d'adresse. Mêmes cascades de synonymes que
 * partout (`DECLARED_KEYS`) : une fiche contacts-api et un dépôt partenaire s'y
 * lisent de la même façon, et personne ne recopie la table.
 */
interface RecipientIdentity {
  email: string | null;
  civility: string | null;
  fullName: string | null;
}

function declaredIdentity(source: unknown): RecipientIdentity {
  // Nom d'USAGE avant nom de naissance : c'est celui sous lequel la personne
  // se reconnaît, et le seul qu'on doive lui écrire.
  const first = pickDeclared(source, "firstName");
  const last = pickDeclared(source, "usageName") ?? pickDeclared(source, "lastName");
  const composed = [first, last].filter(Boolean).join(" ").trim();
  return {
    email: pickDeclared(source, "email"),
    civility: pickDeclared(source, "civility"),
    // Une raison sociale tient lieu de nom pour une entreprise ou une
    // association : c'est ainsi qu'on s'adresse à elle.
    fullName: pickDeclared(source, "displayName")
      ?? (composed !== "" ? composed : null)
      ?? pickDeclared(source, "legalName"),
  };
}

/**
 * L'adresse de l'usager telle qu'elle a été retenue AU DÉPÔT — le repli, quand
 * la demande ne porte aucune fiche Socle à relire (identité déclarée sans
 * rapprochement) ou que le référentiel est muet. Mêmes cascades de clés que
 * `requesterIdentity()` côté écran (contacts-api, publics Iris, synonymes
 * partenaires) : l'agent doit envoyer à l'adresse qu'il voit.
 */
function recipientIdentity(snapshot: unknown, identityStatus: string): RecipientIdentity {
  const anonymous: RecipientIdentity = { email: null, civility: null, fullName: null };
  if (identityStatus === "anonyme") return anonymous;
  const declared = isRecord(snapshot) && isRecord(snapshot.declared) ? snapshot.declared : {};
  if (declared.anonymous === true) return anonymous;
  return declaredIdentity(declared);
}

// ---- Socle (public-api) : la charte graphique de la collectivité -----------
// Le bandeau et le bouton d'un message à l'usager portent SES couleurs et SON
// logo. La source est le Socle, et rien d'autre :
// `GET /v1/organizations/{id}/branding` sur l'organisation PORTEUSE de la
// demande (`socle_scope_org_id`). La route RÉSOUT l'héritage elle-même — « le
// logo de l'organisme concerné, ou à défaut celui de son organisation parente »
// est donc déjà répondu quand Iris lit, sans remonter aucun arbre.
//
// ⚠️ Ne JAMAIS reconstituer la charte depuis `/v1/organizations/{id}` : les
// colonnes brutes d'une organisation qui hérite sont nulles.
//
// ⚠️ DÉCORATIF, DONC JAMAIS BLOQUANT. Délai court et échec silencieux : un
// Socle lent ou muet fait partir le message en habillage Iris, il ne l'empêche
// pas de partir. C'est l'inverse exact du relais d'envoi, dont l'absence est,
// elle, un refus — sans relais il n'y a pas de message ; sans charte il y a un
// message sobre.
//
// Cache court en mémoire du worker (5 min, motif `getKeyRoots` de socle-proxy).
// Une charte graphique change deux fois par décennie, et le Socle demande de ne
// pas recopier durablement son référentiel : ni table, ni miroir, ni migration.
const BRANDING_TTL_MS = 300_000;
const charteCache = new Map<string, { charte: EmailCharte | null; at: number }>();

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}

async function charteFor(socleOrgId: string | null): Promise<EmailCharte | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleOrgId) return null;

  const hit = charteCache.get(socleOrgId);
  if (hit && Date.now() - hit.at < BRANDING_TTL_MS) return hit.charte;

  const res = await fetch(`${base}/v1/organizations/${socleOrgId}/branding`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) {
    // 404 = hors du périmètre de la clé Socle (le Socle ne révèle pas
    // l'existence de ce qu'on n'a pas le droit de voir) ; le reste est une
    // panne. Dans les deux cas : habillage Iris, une ligne de journal, et
    // surtout PAS de mise en cache — une panne d'une seconde ne doit pas
    // dépeindre les messages des cinq minutes suivantes.
    console.error(
      `send-request-email: charte de ${socleOrgId} illisible (${res?.status ?? "réseau"})`,
    );
    return null;
  }
  const dto = (await res.json().catch(() => null)) as SocleBrandingDto | null;
  const charte = charteFromSocle(dto);
  charteCache.set(socleOrgId, { charte, at: Date.now() });
  return charte;
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
  const kind = str(body?.kind) || "libre";
  if (requestId === "") return fail(req, 400, "invalid_request", "Demande manquante.");
  if (kind !== "libre" && kind !== "cloture") {
    return fail(req, 400, "invalid_kind", "Type d'envoi inconnu.");
  }
  const closureMode = kind === "cloture";

  // En mode clôture, RIEN du corps du payload n'est lu : l'objet et le message
  // sont composés plus bas à partir de l'état enregistré de la demande.
  let subject = closureMode ? "" : str(body?.subject);
  let message = closureMode ? "" : (typeof body?.body === "string" ? body.body : "");
  if (!closureMode) {
    if (subject === "") return fail(req, 400, "invalid_subject", "L'objet est obligatoire.");
    if (message.trim() === "") return fail(req, 400, "invalid_body", "Le message est obligatoire.");
  }

  // ---- La demande, et le droit exigé par CE mode ----------------------------
  const { data: request } = await supabase
    .from("requests")
    .select(
      "id, organization_id, socle_scope_org_id, socle_procedure_id, socle_contact_id, " +
        "requester_snapshot, identity_status, reference, status, subject, closure_text",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return fail(req, 404, "not_found", "Demande introuvable.");

  // `outcome` porte le NARROWING : `request.status` est un `string` libre côté
  // base (le workflow vit dans les gardes, pas dans un enum PostgreSQL).
  const outcome = isClosureOutcome(request.status) ? request.status : null;
  if (closureMode && outcome === null) {
    return fail(req, 409, "not_closed",
      "L'avis de clôture ne concerne qu'une demande résolue.");
  }

  // Le mode clôture exige la CLÔTURE — le droit qui vient d'autoriser la
  // résolution. L'exiger « instruction » fermerait l'avis à l'agent qui a
  // pourtant le pouvoir de clore ; l'ouvrir sans composition serveur ferait
  // d'Iris un relais. Les deux vont ensemble.
  const requiredRight = closureMode ? "cloture" : "instruction";
  const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
    p_user_id: actorId,
    p_org_id: request.organization_id,
    p_socle_org_id: request.socle_scope_org_id,
    p_socle_procedure_id: request.socle_procedure_id,
    p_right: requiredRight,
  });
  if (rightError) {
    console.error("send-request-email: request_right_for en échec", rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  if (allowed !== true) {
    return fail(req, 403, "forbidden", closureMode
      ? "Prévenir l'usager de la clôture exige le droit de clôture sur cette demande."
      : "Écrire à l'usager exige le droit d'instruction sur cette demande.");
  }

  // ---- Le destinataire, résolu ici ------------------------------------------
  // Fiche Socle d'abord (source de vérité, corrections postérieures au dépôt
  // comprises), snapshot du dépôt en repli. Le navigateur ne propose rien.
  let who = recipientIdentity(request.requester_snapshot, request.identity_status);
  if (request.socle_contact_id && request.identity_status !== "anonyme") {
    const { data: org } = await supabase
      .from("organizations")
      .select("socle_org_id")
      .eq("id", request.organization_id)
      .maybeSingle();
    const live = await socleContactIdentity(request.socle_contact_id, org?.socle_org_id ?? null);
    // `undefined` = référentiel muet : on garde le dépôt plutôt que de refuser.
    // Une fiche LUE SANS adresse, elle, vaut réponse : on ne ressuscite pas une
    // adresse que l'usager a fait retirer du référentiel.
    if (live !== undefined) who = live;
  }
  const to = who.email;
  if (!to) {
    return fail(req, 400, "no_recipient", "Cette demande ne porte aucune adresse de courriel.");
  }

  // ---- Le relais, lu ICI : sa marque signe l'avis de clôture -----------------
  // Lecture seule, remontée avant la composition parce que le nom de la
  // collectivité entre dans le corps du message. Le REFUS pour relais manquant,
  // lui, reste APRÈS l'ouverture de l'échange : un envoi impossible doit
  // laisser une trace « echec » lisible, pas disparaître.
  //
  // La charte graphique se lit EN MÊME TEMPS : deux lectures indépendantes,
  // l'une en base, l'autre chez le Socle — les enchaîner ajouterait sa latence
  // à un envoi que l'agent attend. Elle est demandée pour l'organisation
  // PORTEUSE de la demande, pas pour la racine du tenant : c'est le service qui
  // a reçu et traité la demande qui signe le message (le Socle remonte au
  // parent tout seul si ce service n'a pas de charte propre).
  const [{ smtp, tenantName }, charte] = await Promise.all([
    smtpForOrg(request.organization_id),
    charteFor(request.socle_scope_org_id),
  ]);

  // ---- L'avis de clôture, composé ICI ---------------------------------------
  if (closureMode && outcome) {
    const composed = closureEmail({
      outcome,
      reference: request.reference,
      requestSubject: request.subject,
      // Le commentaire de l'agent, s'il en a écrit un — il est FACULTATIF
      // depuis le 2026-08-28 (la garde SQL ne l'exige plus).
      closureText: request.closure_text,
      recipient: { civility: who.civility, fullName: who.fullName },
      tenantName,
    });
    subject = composed.subject;
    message = composed.body;
  }

  // ---- Les pièces : chemins vérifiés, poids borné ---------------------------
  // Aucune pièce en mode clôture : l'avis annonce une décision, il ne transmet
  // pas de document. Le payload n'en propose d'ailleurs pas.
  const prefix = `${request.organization_id}/${request.id}/`;
  const declared: DeclaredAttachment[] = !closureMode && Array.isArray(body?.attachments)
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
    p_template_id: closureMode ? null : (str(body?.template_id) || null),
    p_template_name: closureMode ? null : (str(body?.template_name) || null),
    p_attachments: declared,
  });
  if (startError || typeof emailId !== "string") {
    console.error("send-request-email: start_request_email en échec", startError);
    await discardUploads(paths);
    return fail(req, 500, "not_recorded", "L'échange n'a pas pu être enregistré : rien n'a été envoyé.");
  }

  // ---- Relais, pièces, envoi -------------------------------------------------
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
      usagerBrand(tenantName, charte),
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
