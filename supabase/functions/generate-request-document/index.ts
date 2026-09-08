// generate-request-document — un document du dossier, produit depuis un modèle
// Word et les données de la demande.
//
// TROIS NATURES, une seule fonction : `instruction_interne` (ne sort jamais),
// `instruction_externe` et `courrier` (transmissibles à l'usager). La nature
// est écrite sur la ligne `request_attachments.kind` ; ce qui l'empêche de
// sortir est un TRIGGER (`t05_attachments_internal_never_sent`), pas cette
// fonction — elle pourrait avoir un bug, la garde non.
//
// DEUX FORMATS :
//   · **Word** — le zip du modèle est rouvert, les parties textuelles sont
//     fusionnées, le zip est refermé. Tout le reste (styles, images, en-têtes,
//     polices) est recopié à l'octet près : le document est visuellement
//     IDENTIQUE au modèle.
//   · **PDF** — Iris REDESSINE le document (`docxParse` + `pdfLayout` +
//     `pdfRender`). Décision PO du 2026-09-01 : aucun convertisseur externe,
//     aucun courrier d'usager envoyé à un tiers. Le prix est écrit à l'écran :
//     police substituée, images et en-têtes non repris.
//
// ⚠️ LE CONTEXTE DE FUSION EST COMPOSÉ ICI, jamais accepté du navigateur —
// même règle que l'e-mail à l'usager et que le prompt de l'assistant. Un client
// qui dicterait `{{organisme.nom}}` signerait un courrier de la collectivité
// avec le contenu de son choix.
//
// Droit exigé : **INSTRUCTION** sur le couple (organisation porteuse, démarche)
// — le même que celui qui autorise déjà à déposer une pièce sur la demande.
//
// ⚠️ LE MODÈLE VIENT DU SOCLE, PAS DU NAVIGATEUR (contrat public-api 1.6.0,
// brief du 2026-09-01). Le client n'envoie qu'un `template_id` ; le serveur
// RECHARGE la démarche de la demande, vérifie que ce modèle est bien l'un de
// ses `documents.items`, demande l'URL signée (5 min) et télécharge le fichier
// lui-même. Sans cette confrontation, la fonction serait un lecteur libre du
// bucket `document-templates` dans tout le périmètre de la clé Socle.
//
// Le Socle ne convertit rien : il rend le fichier tel qu'il a été déposé
// (.doc, .docx ou .odt). La fusion ne sait ouvrir qu'un .docx — le refus est
// explicite et dit quoi faire (`unmergeableReason`).

import { createClient } from "npm:@supabase/supabase-js@2";

import { buildDocumentInput, documentFileName } from "../_shared/document/context.ts";
import { mergeDocumentXml, scanTemplate } from "../_shared/document/docxMerge.ts";
import { parseDocument } from "../_shared/document/docxParse.ts";
import { isDocx, openDocx, readXml, saveDocx, textParts, writeXml } from "../_shared/document/docxZip.ts";
import { renderPdf } from "../_shared/document/pdfRender.ts";
import {
  findTemplate, isMergeable, kindOfTemplate, parseProcedureDocuments, unmergeableReason,
} from "../_shared/document/templates.ts";
import { buildMergeContext } from "../_shared/document/variables.ts";
import { charteFromSocle, type SocleBrandingDto } from "../_shared/email/charte.ts";
import { finalPath } from "../_shared/files/names.ts";
import { discardReceived, receiveFile } from "../_shared/files/receive.ts";

/** Un document produit ici ne dépasse pas la limite du bucket (25 Mio). */
const MAX_DOCUMENT_BYTES = 25 * 1_048_576;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);

const BUCKET = "request-attachments";
/** Un modèle Word au-delà de 10 Mo n'est pas un modèle, c'est un dossier. */
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

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

function publicApiBase(): string {
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "");
}
function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return publicApiBase().replace("public-api", "contacts-api");
}

/**
 * Fiche usager RELUE dans le Socle (source de vérité : une adresse corrigée
 * après le dépôt doit servir). Référentiel muet ⇒ `null`, et l'appelant retombe
 * sur l'identité figée au dépôt — dégradé, jamais un refus.
 */
async function socleContact(contactId: string, socleRootId: string | null): Promise<unknown> {
  const base = contactsApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleRootId) return null;
  const res = await fetch(`${base}/v1/contacts/${contactId}`, {
    headers: { Authorization: `Bearer ${key}`, "X-Organization-Id": socleRootId },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`generate-request-document: fiche Socle ${contactId} illisible (${res?.status ?? "réseau"})`);
    return null;
  }
  return await res.json().catch(() => null);
}

/** Coordonnées de l'organisation porteuse. Muet ⇒ des variables vides. */
async function socleOrganization(socleOrgId: string | null): Promise<Record<string, unknown> | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleOrgId) return null;
  const res = await fetch(`${base}/v1/organizations/${socleOrgId}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const dto = await res.json().catch(() => null);
  return isRecord(dto) ? dto : null;
}

/** Charte graphique — décorative, donc jamais bloquante (motif send-request-email). */
async function socleBranding(socleOrgId: string | null): Promise<SocleBrandingDto | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key || !socleOrgId) return null;
  const res = await fetch(`${base}/v1/organizations/${socleOrgId}/branding`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as SocleBrandingDto | null;
}

/** La démarche RECHARGÉE : c'est elle qui dit quels modèles existent. */
async function socleProcedure(procedureId: string): Promise<Record<string, unknown> | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return null;
  const res = await fetch(`${base}/v1/procedures/${procedureId}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`generate-request-document: démarche ${procedureId} illisible (${res?.status ?? "réseau"})`);
    return null;
  }
  const dto = await res.json().catch(() => null);
  return isRecord(dto) ? dto : null;
}

/**
 * Le fichier du modèle. URL signée valable 5 minutes, demandée puis consommée
 * dans la foulée : elle n'est ni stockée, ni mise en cache, ni rendue au
 * navigateur (règle du brief).
 */
async function downloadTemplate(templateId: string): Promise<Uint8Array | null> {
  const base = publicApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return null;
  const res = await fetch(`${base}/v1/document-templates/${templateId}/signed-url`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`generate-request-document: URL signée du modèle ${templateId} refusée (${res?.status ?? "réseau"})`);
    return null;
  }
  const signed = await res.json().catch(() => null);
  const url = isRecord(signed) && typeof signed.url === "string" ? signed.url : "";
  if (url === "") return null;
  const file = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!file?.ok) {
    console.error(`generate-request-document: téléchargement du modèle ${templateId} en échec`);
    return null;
  }
  return new Uint8Array(await file.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST attendu.");

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return fail(req, 401, "unauthorized", "Session invalide.");
  const actorId = userData.user.id;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = str(body?.request_id);
  const preview = body?.mode === "preview";
  const format = str(body?.format) === "docx" ? "docx" : "pdf";
  const templateId = str(body?.template_id);

  if (requestId === "") return fail(req, 400, "invalid_request", "Demande manquante.");
  if (templateId === "") return fail(req, 400, "invalid_template", "Modèle manquant.");

  // ---- La demande, et le droit d'instruire ----------------------------------
  const { data: request } = await supabase
    .from("requests")
    .select(
      "id, organization_id, socle_scope_org_id, socle_procedure_id, socle_contact_id, " +
        "requester_snapshot, identity_status, reference, subject, status, priority, " +
        "received_at, due_at, closed_at, socle_organization_label, socle_procedure_label, " +
        "socle_category_label, assigned_to",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return fail(req, 404, "not_found", "Demande introuvable.");
  if (request.status === "archivee") {
    return fail(req, 409, "archived", "Cette demande est archivée : aucun document ne s'y ajoute.");
  }

  const { data: allowed, error: rightError } = await supabase.rpc("request_right_for", {
    p_user_id: actorId,
    p_org_id: request.organization_id,
    p_socle_org_id: request.socle_scope_org_id,
    p_socle_procedure_id: request.socle_procedure_id,
    p_right: "instruction",
  });
  if (rightError) {
    console.error("generate-request-document: request_right_for en échec", rightError);
    return fail(req, 500, "rights_unavailable", "Droits indisponibles — réessayez.");
  }
  if (allowed !== true) {
    return fail(req, 403, "forbidden", "Produire un document exige le droit d'instruction sur cette demande.");
  }

  // ---- Le modèle, confronté à la démarche de la demande ---------------------
  // Le navigateur n'a désigné qu'un identifiant : c'est la démarche RECHARGÉE
  // qui dit si ce modèle existe et ce qu'il est. Sans cette confrontation, la
  // fonction lirait n'importe quel modèle du périmètre de la clé Socle.
  if (!request.socle_procedure_id) {
    return fail(req, 409, "no_procedure",
      "Cette demande n'est fondée sur aucune démarche : aucun modèle ne s'y rattache.");
  }
  const procedureDto = await socleProcedure(request.socle_procedure_id);
  if (!procedureDto) {
    return fail(req, 502, "socle_unavailable",
      "Le référentiel est injoignable : les modèles de la démarche n'ont pas pu être lus.");
  }
  const documents = parseProcedureDocuments(procedureDto.documents);
  const template = findTemplate(documents, templateId);
  if (!template) {
    // Même réponse qu'un modèle inexistant : on ne révèle pas ce qui existe
    // ailleurs (motif du 404 du Socle).
    return fail(req, 404, "template_not_found",
      "Ce modèle n'est pas proposé par la démarche de cette demande.");
  }
  if (!isMergeable(template.file_name)) {
    return fail(req, 400, "template_not_mergeable", unmergeableReason(template.file_name));
  }
  const kind = kindOfTemplate(template.type);
  const templateName = template.name;

  const templateBytes = await downloadTemplate(template.id);
  if (!templateBytes || templateBytes.length === 0) {
    return fail(req, 502, "template_unreadable",
      "Le modèle n'a pas pu être téléchargé depuis le référentiel.");
  }
  if (templateBytes.length > MAX_TEMPLATE_BYTES) {
    return fail(req, 400, "template_too_large", "Le modèle dépasse 10 Mo.");
  }

  let files;
  try {
    files = openDocx(templateBytes);
  } catch {
    return fail(req, 400, "invalid_template", unmergeableReason(template.file_name));
  }
  if (!isDocx(files)) {
    return fail(req, 400, "invalid_template", unmergeableReason(template.file_name));
  }
  const documentXml = readXml(files, "word/document.xml") ?? "";
  const scan = scanTemplate(documentXml);

  // ---- Le contexte, composé ICI ---------------------------------------------
  const { data: org } = await supabase
    .from("organizations")
    .select("socle_org_id, name")
    .eq("id", request.organization_id)
    .maybeSingle();

  const [agentRow, piecesRows] = await Promise.all([
    request.assigned_to
      ? supabase.from("users").select("first_name, last_name, email").eq("id", request.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("request_attachments")
      .select("file_name, document_type_label, compliance")
      .eq("request_id", requestId)
      .is("email_id", null)
      .eq("kind", "demande")
      .is("superseded_at", null)
      .order("created_at", { ascending: true }),
  ]);

  // Identité : fiche Socle relue d'abord, dépôt en repli.
  const snapshot = isRecord(request.requester_snapshot) ? request.requester_snapshot : {};
  const declared = isRecord(snapshot.declared) ? snapshot.declared : {};
  let identity: unknown = declared;
  let quartier: string | null = null;
  if (request.socle_contact_id && request.identity_status !== "anonyme") {
    const live = await socleContact(request.socle_contact_id, org?.socle_org_id ?? null);
    if (isRecord(live)) {
      identity = live;
      const q = live.quartier;
      quartier = isRecord(q) && typeof q.name === "string" ? q.name : null;
    }
  }

  const scopeOrgId = request.socle_scope_org_id ?? org?.socle_org_id ?? null;
  const [orgDto, brandingDto] = await Promise.all([
    socleOrganization(scopeOrgId),
    socleBranding(scopeOrgId),
  ]);
  const charte = charteFromSocle(brandingDto);

  const input = buildDocumentInput({
    request: {
      reference: request.reference,
      subject: request.subject,
      status: request.status,
      priority: request.priority,
      received_at: request.received_at,
      due_at: request.due_at,
      closed_at: request.closed_at,
      socle_organization_label: request.socle_organization_label,
      socle_procedure_label: request.socle_procedure_label,
      socle_category_label: request.socle_category_label,
    },
    agent: agentRow.data ?? null,
    pieces: piecesRows.data ?? [],
    identity,
    quartier,
    organisme: {
      nom: request.socle_organization_label ?? (typeof orgDto?.name === "string" ? orgDto.name : null)
        ?? org?.name ?? null,
      adresse: typeof orgDto?.address === "string" ? orgDto.address : null,
      telephone: typeof orgDto?.phone === "string" ? orgDto.phone : null,
      courriel: typeof orgDto?.email === "string" ? orgDto.email : null,
      couleurPrincipale: charte?.primary ?? null,
      couleurSecondaire: typeof brandingDto?.secondary_color === "string"
        ? brandingDto.secondary_color : null,
    },
  });
  const ctx = buildMergeContext(input);

  // ---- Aperçu : ce que le modèle demande, et ce qu'il recevra ---------------
  if (preview) {
    const parsed = parseDocument(documentXml, readXml(files, "word/styles.xml") ?? "");
    return json(req, 200, {
      template: { id: template.id, name: template.name, type: template.type, kind },
      scan,
      values: Object.fromEntries(
        [...scan.variables, ...scan.images].map((key) => [key, ctx.values[key] ?? ""]),
      ),
      pieces: ctx.lists["demande.pieces"] ?? [],
      pdf_warnings: parsed.warnings,
    });
  }

  // ---- Fusion ---------------------------------------------------------------
  for (const part of textParts(files)) {
    const xml = readXml(files, part);
    if (xml === null) continue;
    writeXml(files, part, mergeDocumentXml(xml, ctx));
  }

  let bytes: Uint8Array;
  let mime: string;
  let pdfWarnings: string[] = [];
  if (format === "docx") {
    bytes = saveDocx(files);
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else {
    const merged = readXml(files, "word/document.xml") ?? "";
    const parsed = parseDocument(merged, readXml(files, "word/styles.xml") ?? "");
    pdfWarnings = parsed.warnings;
    try {
      bytes = await renderPdf(parsed);
    } catch (error) {
      console.error("generate-request-document: rendu PDF en échec", error);
      return fail(req, 500, "pdf_failed",
        "Le PDF n'a pas pu être produit. Le document reste disponible au format Word.");
    }
    mime = "application/pdf";
  }

  // ---- Dépôt ----------------------------------------------------------------
  // Même porte que tout octet qui entre dans le bucket : le document produit
  // ici est inspecté (type réel, extension), haché, puis écrit avec son type
  // DÉTECTÉ — le `mime` calculé ci-dessus n'est qu'une attente à confirmer.
  const fileName = documentFileName(templateName, request.reference, format);
  const path = finalPath(request.organization_id, requestId, crypto.randomUUID(), fileName);
  const bucket = supabase.storage.from(BUCKET);
  const received = await receiveFile(bucket, { path, bytes, fileName, maxBytes: MAX_DOCUMENT_BYTES });
  if (!received.ok) {
    console.error("generate-request-document: dépôt impossible", received.code, received.message);
    return fail(req, 502, "upload_failed", `Le document n'a pas pu être enregistré (${received.message}).`);
  }
  if (received.mime !== mime) {
    console.warn(`generate-request-document: type détecté ${received.mime}, attendu ${mime}`);
  }

  const { data: row, error: insertError } = await supabase
    .from("request_attachments")
    .insert({
      organization_id: request.organization_id,
      request_id: requestId,
      storage_path: path,
      file_name: fileName,
      mime_type: received.mime,
      file_size: received.size,
      checksum: received.checksum,
      copy_status: "copied",
      uploaded_by: actorId,
      kind,
      template_socle_id: template.id,
      template_label: templateName,
      generated_at: new Date().toISOString(),
      generated_by: actorId,
    })
    .select("id, file_name, mime_type, file_size, kind, storage_path, created_at")
    .single();
  if (insertError) {
    // L'objet est retiré : pas d'orphelin dans le bucket (motif de la photo de profil).
    await discardReceived(bucket, path);
    console.error("generate-request-document: écriture de la ligne en échec", insertError);
    return fail(req, 500, "insert_failed", "Le document n'a pas pu être rattaché à la demande.");
  }

  console.log(
    `generate-request-document: ${fileName} (${format}, ${bytes.length} o, ${kind}) ` +
    `sur ${request.reference} par ${actorId}`,
  );
  return json(req, 200, { attachment: row, scan, pdf_warnings: pdfWarnings });
});
