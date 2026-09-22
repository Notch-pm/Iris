// requests-api — API d'ingestion générique d'Iris (serveur-à-serveur).
// verify_jwt = false : l'authentification est portée ICI, par clé d'intégration
// (integration_credentials, SHA-256). Le périmètre (tenant, source) est
// entièrement dérivé de la clé — jamais d'un header ou d'un champ de payload
// pris pour argent comptant.
// CORS : accordé aux SEULES routes publiques de documentation (`/` et
// `/v1/openapi.json`), pour que la page /api-doc de l'app puisse lire le
// contrat. Les routes authentifiées n'en portent aucun : cette API ne se
// consomme JAMAIS depuis un navigateur (la clé y serait exposée).

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorBody, HTTP_STATUS, type ErrorCode } from "./_shared/errors.ts";
import { canonicalJson, sha256Hex } from "./_shared/hash.ts";
import {
  fingerprintPayload,
  validateAttachmentList,
  validateEnvelope,
  type AttachmentRef,
  type IngestEnvelope,
  type LinkRef,
} from "./_shared/validation.ts";
import { REQUEST_SELECT, serializeRequest } from "./_shared/serializers.ts";
import { PERMALINK_ANOMALY, sanitizePermalinks } from "./_shared/permalink.ts";
import { buildOpenApi, MAX_UPLOAD_BYTES_DEFAULT, publicBaseUrl } from "./_shared/openapi.ts";
import { httpStatusFor } from "../_shared/files/inspect.ts";
import { readSingleFileForm } from "../_shared/files/multipart.ts";
import { finalPath, isStagingPath, stagingPath } from "../_shared/files/names.ts";
import { discardReceived, receiveFile } from "../_shared/files/receive.ts";
import {
  attachmentFingerprint,
  checkUploadRow,
  type UploadRow,
} from "../_shared/files/uploads.ts";
import {
  degradedProcedureSnapshot,
  whitelistProcedureSnapshot,
  type ProcedureSnapshot,
} from "./_shared/procedure.ts";
import {
  contactCreatePayload,
  contactIdentitySnapshot,
  hasStrongMatch,
  matchIdentityFromDeclared,
} from "../_shared/identity/declared.ts";
import { normalizeConsents, type ConsentRecord } from "../_shared/consents/catalog.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const APP_URL = Deno.env.get("IRIS_APP_URL") ?? null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Pièces jointes : dépôt direct, zone d'attente ---------------------------
//
// Contrat 2.0.0 : le partenaire DÉPOSE les octets (`POST /v1/uploads`), Iris
// les vérifie (type réel, taille, sha256 — porte unique `receiveFile`) et les
// range en zone d'attente `{org}/_staging/{upload_id}` ; l'enveloppe ne porte
// ensuite que des `upload_id`. Au rattachement, l'objet est DÉPLACÉ sous la
// demande (opération de métadonnées) puis la RPC `ingest_request_attachments`
// consomme la ligne d'attente et écrit la pièce — en une transaction.
const BUCKET = "request-attachments";
const MAX_UPLOAD_BYTES = (() => {
  const raw = Number.parseInt(Deno.env.get("IRIS_MAX_UPLOAD_BYTES") ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : MAX_UPLOAD_BYTES_DEFAULT;
})();
/** Un fichier déposé et jamais référencé est purgé après ce délai (lot 4). */
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Dépôts de fichiers par minute et par clé — borne opposable, comptée dans le journal d'audit. */
const UPLOADS_PER_MINUTE = 60;
const UPLOAD_PATH = "/v1/uploads";

// ---- Usager : rapprocher, sinon CRÉER dans le Socle -------------------------
//
// Décision PO du 2026-08-26 : une identité sans correspondance est une nouvelle
// personne, et une nouvelle personne se crée dans le référentiel. La règle vaut
// aussi ici, à l'ingestion — un partenaire qui envoie un nom sans identifiant
// Socle ne doit plus produire une demande orpheline que personne ne rattachera
// jamais.
//
// ⚠️ RISQUE ASSUMÉ, ET BORNÉ. À l'écran, un agent arbitre les homonymes ; ici,
// personne. On cherche donc TOUJOURS un rapprochement d'abord, et on ne
// réutilise une fiche que sur un IDENTIFIANT FORT (courriel, téléphone, SIRET).
// Jamais sur un nom : rattacher la demande d'un habitant à son homonyme serait
// bien pire qu'un doublon — c'est lui donner accès aux échanges d'un autre.
// Faute d'identifiant fort, on crée : c'est la décision, et elle produira des
// doublons que le Socle sait fusionner.
//
// ⚠️ JAMAIS UN REFUS. Un Socle muet ne doit pas faire perdre une demande à un
// partenaire (même doctrine que le snapshot de démarche) : on retombe sur
// `non_rapprochee` avec l'anomalie `usager_a_creer_dans_socle`.

function contactsApiBase(): string {
  const explicit = Deno.env.get("SOCLE_CONTACTS_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return (Deno.env.get("SOCLE_API_URL") ?? "").replace(/\/+$/, "").replace("public-api", "contacts-api");
}

async function socleContactsFetch(
  path: string,
  socleRootOrgId: string,
  body: unknown,
): Promise<Response | null> {
  const base = contactsApiBase();
  const key = Deno.env.get("SOCLE_API_KEY");
  if (base === "" || !key) return null;
  return await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Organization-Id": socleRootOrgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
}

interface ResolvedRequester {
  socleContactId: string | null;
  /** Identité à figer au dépôt : relue du Socle si rapprochée, déclarée sinon. */
  declared: Record<string, unknown> | null;
  identityStatus: "rapprochee" | "non_rapprochee" | "anonyme";
  /** Renseignée quand la fiche n'a pu être ni retrouvée ni créée. */
  anomaly: string | null;
}

async function resolveRequester(
  env: IngestEnvelope,
  socleRootOrgId: string,
): Promise<ResolvedRequester> {
  const declared = env.requester ?? null;

  // Le partenaire a déjà l'identifiant Socle : rien à créer.
  if (env.socle_contact_id) {
    return { socleContactId: env.socle_contact_id, declared, identityStatus: "rapprochee", anomaly: null };
  }
  // L'anonymat est un choix assumé, pas une identité incomplète.
  if (declared?.anonymous === true) {
    return { socleContactId: null, declared, identityStatus: "anonyme", anomaly: null };
  }

  const criteria = matchIdentityFromDeclared(declared);
  const payload = contactCreatePayload(declared);
  if (!criteria || !payload) {
    // Rien de nommable : on ne crée pas une fiche vide dans le référentiel.
    return { socleContactId: null, declared, identityStatus: "non_rapprochee", anomaly: null };
  }

  // 1. Rapprochement — réutilisation SEULEMENT sur identifiant fort.
  const matchRes = await socleContactsFetch("/v1/contacts/match", socleRootOrgId, { identity: criteria });
  if (matchRes?.ok) {
    const body = await matchRes.json().catch(() => null);
    const matches = Array.isArray(body?.matches) ? body.matches : [];
    const strong = matches.find((m: Record<string, unknown>) => hasStrongMatch(m?.reasons));
    // deno-lint-ignore no-explicit-any
    const contact = (strong as any)?.contact;
    if (contact && typeof contact.id === "string") {
      return {
        socleContactId: contact.id,
        declared: contactIdentitySnapshot(contact) ?? declared,
        identityStatus: "rapprochee",
        anomaly: null,
      };
    }
  }

  // 2. Création — la décision : sans correspondance, c'est quelqu'un de nouveau.
  const createRes = await socleContactsFetch("/v1/contacts", socleRootOrgId, payload);
  if (createRes?.ok) {
    const contact = await createRes.json().catch(() => null);
    if (contact && typeof contact.id === "string") {
      return {
        socleContactId: contact.id,
        declared: contactIdentitySnapshot(contact) ?? declared,
        identityStatus: "rapprochee",
        anomaly: null,
      };
    }
  }

  // 3. Socle muet ou refus : jamais un refus d'ingestion, une anomalie.
  console.error(
    `requests-api: usager non créé dans le Socle (match=${matchRes?.status ?? "réseau"}, ` +
      `create=${createRes?.status ?? "réseau"})`,
  );
  return { socleContactId: null, declared, identityStatus: "non_rapprochee", anomaly: "usager_a_creer_dans_socle" };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function fail(code: ErrorCode, message: string): Response {
  return json(HTTP_STATUS[code], errorBody(code, message));
}

/** Documentation du contrat : lisible par un navigateur, donc CORS ouvert. */
const DOC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
function publicJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...DOC_CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

interface AuthContext {
  credentialId: string;
  /** La source DU TENANT — même sous une clé plateforme : le journal et les bornes restent par collectivité. */
  sourceId: string;
  sourceCode: string;
  organizationId: string;  // tenant Iris (organizations.id)
  socleRootOrgId: string;  // UUID Socle de la racine du tenant
  /** Nom de l'organisme principal — interpolé dans le libellé du consentement au partage. */
  organismName: string | null;
  scopes: string[];
}

/**
 * En-tête par lequel une clé PLATEFORME nomme la collectivité pour laquelle
 * elle agit — l'UUID Socle de la racine du tenant. Symétrique de ce qu'Iris
 * fait lui-même vers le Socle (clé plateforme + `X-Organization-Id`).
 */
const TENANT_HEADER = "x-socle-root-organization-id";

async function authenticate(req: Request): Promise<AuthContext | Response> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return fail("unauthorized", "Clé d'intégration absente (Authorization: Bearer).");

  const keyHash = await sha256Hex(match[1].trim());
  const { data, error } = await supabase
    .from("integration_credentials")
    .select(
      "id, scopes, expires_at, revoked_at, " +
      "source:integration_sources!inner(id, code, status, organization_id, " +
      "organization:organizations(id, socle_org_id, name))",
    )
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) return fail("internal_error", "Erreur serveur.");
  if (!data) return fail("unauthorized", "Clé d'intégration inconnue.");
  if (data.revoked_at) return fail("unauthorized", "Clé d'intégration révoquée.");
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return fail("unauthorized", "Clé d'intégration expirée.");
  }
  // deno-lint-ignore no-explicit-any
  const source = data.source as any;
  if (source.status !== "active") return fail("forbidden", "Intégration suspendue.");

  // Best-effort : trace d'usage.
  supabase
    .from("integration_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  const scopes = data.scopes as string[];
  const wantedRoot = req.headers.get(TENANT_HEADER)?.trim() ?? "";

  // Clé liée à UN tenant : le périmètre est celui de la clé, et rien d'autre.
  // L'en-tête, s'il est envoyé, ne peut que le confirmer — jamais l'élargir.
  if (source.organization_id !== null) {
    if (wantedRoot !== "" && wantedRoot.toLowerCase() !== String(source.organization.socle_org_id).toLowerCase()) {
      return fail("forbidden", "X-Socle-Root-Organization-Id hors du périmètre de l'intégration.");
    }
    return {
      credentialId: data.id,
      sourceId: source.id,
      sourceCode: source.code,
      organizationId: source.organization_id,
      socleRootOrgId: source.organization.socle_org_id,
      organismName: (source.organization.name as string | null) ?? null,
      scopes,
    };
  }

  // Clé PLATEFORME : elle authentifie, l'appel nomme la collectivité. Le tenant
  // doit exister dans le miroir ET avoir une source ACTIVE du même code —
  // c'est l'interrupteur par collectivité, et c'est ce que le trigger
  // requests_check_source exigera de toute façon à l'écriture.
  if (!UUID_RE.test(wantedRoot)) {
    return fail("bad_request", "X-Socle-Root-Organization-Id requis (UUID Socle de la collectivité) avec une clé plateforme.");
  }
  const { data: tenant, error: tenantError } = await supabase
    .from("organizations")
    .select("id, socle_org_id, name, integration_sources(id, status)")
    .eq("socle_org_id", wantedRoot)
    .eq("integration_sources.code", source.code)
    .maybeSingle();
  if (tenantError) return fail("internal_error", "Erreur serveur.");
  if (!tenant) return fail("forbidden", "Collectivité inconnue d'Iris.");
  // deno-lint-ignore no-explicit-any
  const tenantSource = ((tenant as any).integration_sources as Array<{ id: string; status: string }>)[0];
  if (!tenantSource) return fail("forbidden", `Source « ${source.code} » non déclarée pour cette collectivité.`);
  if (tenantSource.status !== "active") return fail("forbidden", "Intégration suspendue pour cette collectivité.");

  return {
    credentialId: data.id,
    sourceId: tenantSource.id,
    sourceCode: source.code,
    organizationId: tenant.id,
    socleRootOrgId: tenant.socle_org_id,
    organismName: (tenant.name as string | null) ?? null,
    scopes,
  };
}

async function audit(
  auth: AuthContext | null,
  method: string,
  path: string,
  status: number,
  errorCode: string | null,
  requestId: string | null,
): Promise<void> {
  try {
    await supabase.from("integration_api_logs").insert({
      organization_id: auth?.organizationId ?? null,
      integration_source_id: auth?.sourceId ?? null,
      credential_id: auth?.credentialId ?? null,
      method,
      path,
      status,
      error_code: errorCode,
      request_id: requestId,
    });
  } catch (_) { /* le journal n'échoue jamais une requête */ }
}

// ---- Dépôt d'un fichier (POST /v1/uploads) ----------------------------------

/** Nombre de dépôts réussis de cette source dans la dernière minute (journal d'audit, append-only). */
async function recentUploads(auth: AuthContext): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("integration_api_logs")
    .select("id", { count: "exact", head: true })
    .eq("integration_source_id", auth.sourceId)
    .eq("path", UPLOAD_PATH)
    .eq("status", 201)
    .gte("created_at", since);
  return count ?? 0;
}

async function handleUpload(auth: AuthContext, req: Request): Promise<Response> {
  if (await recentUploads(auth) >= UPLOADS_PER_MINUTE) {
    return fail("too_many_requests", `Plus de ${UPLOADS_PER_MINUTE} dépôts de fichiers dans la minute : patientez.`);
  }
  const form = await readSingleFileForm(req, { maxBytes: MAX_UPLOAD_BYTES });
  if (!form.ok) return fail(form.code, form.message);

  const uploadId = crypto.randomUUID();
  const path = stagingPath(auth.organizationId, uploadId);
  const bucket = supabase.storage.from(BUCKET);
  const received = await receiveFile(bucket, {
    path,
    bytes: form.file.bytes,
    fileName: form.file.name,
    maxBytes: MAX_UPLOAD_BYTES,
  });
  if (!received.ok) {
    if (received.code === "storage_failed") {
      console.error("requests-api: dépôt en zone d'attente impossible", received.message);
      return fail("bad_gateway", "Stockage indisponible : réessayez dans quelques instants.");
    }
    const status = httpStatusFor(received.code);
    const code: ErrorCode = status === 413 ? "payload_too_large"
      : status === 415 ? "unsupported_media_type"
      : status === 422 ? "unprocessable"
      : "bad_request";
    return fail(code, received.message);
  }

  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
  const { error } = await supabase.from("attachment_uploads").insert({
    id: uploadId,
    organization_id: auth.organizationId,
    scope_request_id: null,
    integration_source_id: auth.sourceId,
    uploaded_by: null,
    storage_path: path,
    file_name: received.fileName,
    mime_type: received.mime,
    file_size: received.size,
    checksum: received.checksum,
    expires_at: expiresAt,
  });
  if (error) {
    // Pas d'orphelin : l'objet part avec la ligne qui n'a pas pu naître.
    await discardReceived(bucket, path);
    console.error("requests-api: ligne d'attente non écrite", error);
    return fail("internal_error", "Erreur serveur.");
  }
  return json(201, {
    upload: {
      upload_id: uploadId,
      file_name: received.fileName,
      mime_type: received.mime,
      size_bytes: received.size,
      checksum: received.checksum,
      expires_at: expiresAt,
    },
  });
}

// ---- Rattachement des pièces déposées ----------------------------------------

interface ResolvedUpload {
  ref: AttachmentRef;
  row: UploadRow;
}

/**
 * Relit les lignes d'attente désignées par l'enveloppe et refuse tôt ce que la
 * RPC refuserait de toute façon (autre clé, expiré, retiré…). `allowConsumed`
 * sert au rejeu idempotent : une pièce déjà rattachée doit pouvoir être RELUE
 * pour recomposer l'empreinte, pas rattachée deux fois.
 */
async function resolveUploads(
  auth: AuthContext,
  refs: AttachmentRef[],
  allowConsumed: boolean,
): Promise<ResolvedUpload[] | Response> {
  if (refs.length === 0) return [];
  const { data, error } = await supabase
    .from("attachment_uploads")
    .select(
      "id, organization_id, scope_request_id, integration_source_id, uploaded_by, storage_path, " +
      "file_name, mime_type, file_size, checksum, expires_at, consumed_at, discarded_at",
    )
    .in("id", refs.map((r) => r.upload_id))
    .eq("organization_id", auth.organizationId);
  if (error) return fail("internal_error", "Erreur serveur.");
  const byId = new Map((data ?? []).map((row) => [row.id, row as UploadRow]));
  const out: ResolvedUpload[] = [];
  for (const [i, ref] of refs.entries()) {
    const row = byId.get(ref.upload_id);
    const check = checkUploadRow(row, {
      organizationId: auth.organizationId,
      sourceId: auth.sourceId,
      allowConsumed,
    });
    if (!check.ok) return fail("bad_request", `attachments[${i}] (${ref.upload_id}) : ${check.message}`);
    out.push({ ref, row: row! });
  }
  return out;
}

/**
 * Déplace chaque objet encore en attente sous la demande, puis rattache le
 * tout en UNE transaction (RPC). Idempotent : une pièce déjà consommée est
 * ignorée, un objet déjà déplacé n'est pas redéplacé — un rejeu après un
 * échec partiel rattache exactement ce qui manque.
 */
async function attachUploads(
  auth: AuthContext,
  requestId: string,
  resolved: ResolvedUpload[],
): Promise<{ registered: number } | Response> {
  const pending = resolved.filter((r) => r.row.consumed_at === null);
  if (pending.length === 0) return { registered: 0 };
  const bucket = supabase.storage.from(BUCKET);
  for (const item of pending) {
    if (!isStagingPath(item.row.storage_path)) continue;
    const dest = finalPath(auth.organizationId, requestId, item.row.id, item.row.file_name);
    const { error } = await bucket.move(item.row.storage_path, dest);
    if (error && !/already exists|duplicate/i.test(error.message)) {
      console.error("requests-api: déplacement d'une pièce impossible", error);
      return fail("bad_gateway", "Stockage indisponible pendant le rattachement des pièces : rejouez à l'identique.");
    }
    // La ligne d'attente suit l'objet : si la RPC échoue ensuite, la purge saura où il est.
    const { error: updateError } = await supabase
      .from("attachment_uploads")
      .update({ storage_path: dest })
      .eq("id", item.row.id);
    if (updateError) return fail("internal_error", "Erreur serveur.");
    item.row.storage_path = dest;
  }
  const { data, error } = await supabase.rpc("ingest_request_attachments", {
    p_request_id: requestId,
    p_org: auth.organizationId,
    p_source: auth.sourceId,
    p_items: pending.map((p) => ({ upload_id: p.row.id, form_field_key: p.ref.form_field_key ?? null })),
  });
  if (error) {
    console.error("requests-api: ingest_request_attachments en échec", error);
    return fail("bad_request", `Pièces non rattachées : ${error.message}`);
  }
  return { registered: typeof data === "number" ? data : pending.length };
}

async function insertLinks(
  organizationId: string,
  requestId: string,
  links: LinkRef[],
): Promise<void> {
  if (links.length === 0) return;
  const seen = new Set<string>();
  const rows = [];
  for (const l of links) {
    const key = `${l.type} ${l.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      organization_id: organizationId,
      request_id: requestId,
      link_type: "externe",
      external_type: l.type,
      external_id: l.id,
      external_url: l.url ?? null,
      created_by: null,
    });
  }
  if (rows.length > 0) await supabase.from("request_links").insert(rows);
}

/**
 * Rejeu : contenu identique → 200 avec l'existante ; divergent → 409 explicite.
 * Un rejeu identique RATTACHE les pièces qui ne l'auraient pas encore été
 * (échec de stockage au premier passage) : c'est ce qui rend le « rejouez à
 * l'identique » du contrat réellement réparateur.
 */
async function replayResponse(
  auth: AuthContext,
  existing: Record<string, unknown>,
  fingerprint: string,
  resolved: ResolvedUpload[],
): Promise<Response> {
  if (existing.ingest_fingerprint === fingerprint) {
    const attached = await attachUploads(auth, existing.id as string, resolved);
    if (attached instanceof Response) return attached;
    return json(200, {
      created: false,
      request: serializeRequest(existing, APP_URL),
      attachments_registered: attached.registered,
    });
  }
  return fail(
    "conflict",
    `Une demande existe déjà pour cette source avec le même identifiant ` +
    `(référence ${existing.reference}) mais un contenu différent. ` +
    `Rejouez à l'identique, ou utilisez un nouvel external_id / une nouvelle idempotency_key.`,
  );
}

async function handleIngest(auth: AuthContext, req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = validateEnvelope(body);
  if (!parsed.ok) return fail("bad_request", parsed.message);
  const env = parsed.value;

  // Liaison stricte contexte ↔ intégration : la source déclarée et la racine
  // Socle déclarée doivent correspondre à la clé — jamais l'inverse.
  if (env.source_system !== auth.sourceCode) {
    return fail("forbidden", "source_system ne correspond pas à l'intégration authentifiée.");
  }
  if (env.socle_root_organization_id.toLowerCase() !== auth.socleRootOrgId.toLowerCase()) {
    return fail("forbidden", "socle_root_organization_id hors du périmètre de l'intégration.");
  }

  // Les pièces d'abord : l'empreinte porte leur CONTENU (relu en zone
  // d'attente), et un rejeu doit pouvoir relire une pièce déjà rattachée.
  const resolved = await resolveUploads(auth, env.attachments ?? [], true);
  if (resolved instanceof Response) return resolved;
  const fingerprint = await sha256Hex(canonicalJson(fingerprintPayload(
    env,
    resolved.map((r) => attachmentFingerprint(r.row, r.ref.form_field_key)),
  )));

  // Idempotence 1 : (source, external_id).
  const byExternal = await supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("organization_id", auth.organizationId)
    .eq("source", auth.sourceCode)
    .eq("external_ref", env.external_id)
    .maybeSingle();
  if (byExternal.data) return await replayResponse(auth, byExternal.data, fingerprint, resolved);

  // Idempotence 2 : idempotency_key (une même soumission ne crée jamais deux demandes).
  if (env.idempotency_key) {
    const byKey = await supabase
      .from("requests")
      .select(REQUEST_SELECT)
      .eq("organization_id", auth.organizationId)
      .eq("source", auth.sourceCode)
      .eq("idempotency_key", env.idempotency_key)
      .maybeSingle();
    if (byKey.data) return await replayResponse(auth, byKey.data, fingerprint, resolved);
  }
  // Une pièce déjà rattachée à une AUTRE demande n'a rien à faire dans un
  // dépôt neuf (le rejeu a été traité ci-dessus).
  const alreadyUsed = resolved.find((r) => r.row.consumed_at !== null);
  if (alreadyUsed) {
    return fail("bad_request", `attachments (${alreadyUsed.row.id}) : pièce téléversée déjà rattachée à une demande.`);
  }

  // Règle impérative : la démarche doit exister dans le tenant et être active
  // (le trigger SQL revérifie — ici on refuse tôt avec un message explicite).
  const { data: cachedProcedure } = await supabase
    .from("socle_procedure_cache")
    .select("socle_id, name, type, category_socle_id")
    .eq("socle_id", env.socle_procedure_id)
    .eq("organization_id", auth.organizationId)
    .is("obsoleted_at", null)
    .maybeSingle();
  if (!cachedProcedure) {
    return fail("bad_request", "Démarche introuvable, obsolète ou hors du périmètre du tenant.");
  }

  // Snapshot construit CÔTÉ SERVEUR depuis Socle — un payload externe ne peut
  // jamais l'imposer (toute clé snapshot dans l'enveloppe → 400 whitelist).
  // Tableau d'OBJETS `{code}` — jamais de chaînes nues : `requests_set_scope_org`
  // filtre par `a ->> 'code'`, et une chaîne y donne NULL puis se fait
  // silencieusement effacer au premier recalcul de périmètre.
  const anomalies: { code: string }[] = [];
  let procedureSnapshot: ProcedureSnapshot | null = null;
  const socleUrl = Deno.env.get("SOCLE_API_URL");
  const socleKey = Deno.env.get("SOCLE_API_KEY");
  if (socleUrl && socleKey) {
    const res = await fetch(
      `${socleUrl.replace(/\/+$/, "")}/v1/procedures/${env.socle_procedure_id}`,
      { headers: { Authorization: `Bearer ${socleKey}` }, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (res?.ok) {
      procedureSnapshot = whitelistProcedureSnapshot(await res.json().catch(() => null));
    }
  }
  if (!procedureSnapshot) {
    // Socle injoignable (ou cache en avance sur Socle) : jamais un refus —
    // snapshot minimal du cache + anomalie à lever à la qualification (AC-I10).
    procedureSnapshot = degradedProcedureSnapshot(cachedProcedure);
    anomalies.push({ code: "referentiel_indisponible" });
  }

  // L'usager : rapproché, sinon CRÉÉ dans le Socle (voir `resolveRequester`).
  const requester = await resolveRequester(env, auth.socleRootOrgId);
  if (requester.anomaly) anomalies.push({ code: requester.anomaly });

  // Consentements RGPD. FACULTATIFS ici, à la différence du guichet — le
  // contrat 2.x n'évolue qu'en additif, et les exiger casserait toutes les
  // intégrations en place. Absents, la demande le DIT (anomalie) au lieu de
  // laisser croire que la question a été posée. Présents, ils sont validés
  // comme au guichet : catalogue fermé, libellé recomposé côté serveur.
  let consents: ConsentRecord[] = [];
  if (env.consents === undefined) {
    anomalies.push({ code: "consentement_absent" });
  } else {
    const check = normalizeConsents(env.consents, auth.organismName);
    if (!check.ok) return fail("bad_request", check.message);
    consents = check.consents;
  }

  // Le consentement d'une PERSONNE appartient au référentiel. `source_app` est
  // le code de l'ÉMETTEUR (`nora`, un partenaire…) et non « iris » : c'est lui
  // qui a affiché la case et recueilli la réponse — Iris n'a fait que la
  // transporter. `external_id` porte l'idempotence : un rejeu du même dépôt met
  // la ligne à jour au lieu d'en créer une seconde.
  // Jamais un refus (doctrine de l'ingestion) : la demande porte déjà la preuve.
  if (consents.length > 0 && requester.socleContactId) {
    const res = await socleContactsFetch(
      `/v1/contacts/${requester.socleContactId}/consents`,
      auth.socleRootOrgId,
      {
        source_app: auth.sourceCode,
        source_reference: env.external_id,
        consents: consents.map((c) => ({ kind: c.kind, granted: c.granted, statement: c.statement })),
      },
    );
    if (!res?.ok) {
      console.error("requests-api: consentements non transmis au Socle", res?.status ?? "réseau");
      anomalies.push({ code: "consentement_non_transmis_au_socle" });
    }
  }

  // Permaliens du partenaire : Iris les stocke tels quels — mais seulement
  // ceux qui ont un sens depuis le navigateur d'un agent. Un `localhost` vient
  // d'une edge function de partenaire configurée sur un poste de dev : cliqué
  // par un agent, il désigne SA machine. Écarté, jamais réécrit (`permalink.ts`).
  const permalinks = sanitizePermalinks(env);
  if (permalinks.dropped) anomalies.push({ code: PERMALINK_ANOMALY });

  const insert = await supabase
    .from("requests")
    .insert({
      organization_id: auth.organizationId,
      // reference / socle_root_org_id / libellés posés par triggers — vérité serveur
      // (démarche et catégorie : t16 ; organisme : t08, relu dans le miroir, 2026-09-17).
      reference: "en-attente", reference_year: 0, reference_seq: 0,
      socle_root_org_id: auth.socleRootOrgId,
      socle_organization_id: env.socle_organization_id ?? null,
      socle_procedure_id: env.socle_procedure_id,
      socle_contact_id: requester.socleContactId,
      procedure_snapshot: procedureSnapshot,
      requester_snapshot: {
        declared: requester.declared,
        socle_contact_id: requester.socleContactId,
      },
      identity_status: requester.identityStatus,
      source: auth.sourceCode,
      external_ref: env.external_id,
      external_url: permalinks.externalUrl,
      channel: env.context?.channel ?? null,
      received_at: env.context?.received_at ?? new Date().toISOString(),
      subject: env.subject,
      body: env.body ?? null,
      form_data: env.form_data ?? {},
      anomalies,
      consents,
      idempotency_key: env.idempotency_key ?? null,
      ingest_fingerprint: fingerprint,
    })
    .select(REQUEST_SELECT)
    .single();

  if (insert.error) {
    // Course entre deux rejeux simultanés : l'unicité tranche, on relit.
    if (insert.error.code === "23505") {
      const again = await supabase
        .from("requests")
        .select(REQUEST_SELECT)
        .eq("organization_id", auth.organizationId)
        .eq("source", auth.sourceCode)
        .eq("external_ref", env.external_id)
        .maybeSingle();
      if (again.data) return await replayResponse(auth, again.data, fingerprint, resolved);
    }
    // Un refus d'une garde métier (P0001 : démarche non activée pour l'organisme,
    // pièce obligatoire…) est une réponse au partenaire, pas une panne : il porte
    // son message, en 400, pour que l'émetteur sache quoi corriger.
    if (insert.error.code === "P0001") {
      return fail("bad_request", insert.error.message);
    }
    console.error("requests-api insert:", insert.error);
    return fail("internal_error", "Erreur serveur.");
  }

  const row = insert.data;
  await insertLinks(auth.organizationId, row.id, permalinks.links);
  // La demande existe désormais : un échec ici n'est PAS une perte — le
  // rejeu à l'identique (200) rattachera ce qui manque.
  const attached = await attachUploads(auth, row.id, resolved);
  if (attached instanceof Response) return attached;

  return json(201, {
    created: true,
    request: serializeRequest(row, APP_URL),
    attachments_registered: attached.registered,
  });
}

async function findOwnRequest(auth: AuthContext, id: string) {
  return await supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("id", id)
    .eq("organization_id", auth.organizationId)
    .eq("source", auth.sourceCode)
    .maybeSingle();
}

async function handleGet(auth: AuthContext, id: string): Promise<Response> {
  const { data } = await findOwnRequest(auth, id);
  if (!data) return fail("not_found", "Ressource introuvable.");
  return json(200, { request: serializeRequest(data, APP_URL) });
}

async function handleList(auth: AuthContext, url: URL): Promise<Response> {
  const limitRaw = url.searchParams.get("limit") ?? "100";
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return fail("bad_request", "limit : entier entre 1 et 500.");
  }
  let query = supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("organization_id", auth.organizationId)
    .eq("source", auth.sourceCode)
    .order("updated_at", { ascending: true })
    .limit(limit);
  const since = url.searchParams.get("updated_since");
  if (since !== null) {
    if (Number.isNaN(Date.parse(since))) {
      return fail("bad_request", "updated_since : date ISO 8601 attendue.");
    }
    query = query.gte("updated_at", since);
  }
  const { data, error } = await query;
  if (error) return fail("internal_error", "Erreur serveur.");
  return json(200, { requests: (data ?? []).map((r) => serializeRequest(r, APP_URL)) });
}

async function handleAddAttachments(auth: AuthContext, id: string, req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail("bad_request", "Corps JSON attendu : { attachments: [...] }.");
  }
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.some((k) => k !== "attachments")) {
    return fail("bad_request", "Seule la clé attachments est acceptée.");
  }
  const parsed = validateAttachmentList((body as Record<string, unknown>).attachments);
  if (!parsed.ok) return fail("bad_request", parsed.message);
  if (parsed.value.length === 0) return fail("bad_request", "attachments : au moins une pièce.");

  const { data } = await findOwnRequest(auth, id);
  if (!data) return fail("not_found", "Ressource introuvable.");

  const resolved = await resolveUploads(auth, parsed.value, false);
  if (resolved instanceof Response) return resolved;
  const attached = await attachUploads(auth, data.id, resolved);
  if (attached instanceof Response) return attached;
  return json(201, { registered: attached.registered });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/requests-api/, "") || "/";
  const method = req.method.toUpperCase();

  // Routes publiques (documentation du contrat) — les seules ouvertes au navigateur.
  const isDocPath = path === "/" || path === "" || path === "/v1/openapi.json";
  if (method === "OPTIONS" && isDocPath) {
    return new Response(null, { status: 204, headers: DOC_CORS });
  }
  if (method === "GET" && (path === "/" || path === "")) {
    return publicJson({
      name: "Iris — requests-api",
      version: (buildOpenApi("")).info.version,
      openapi: "/v1/openapi.json",
    });
  }
  if (method === "GET" && path === "/v1/openapi.json") {
    return publicJson(buildOpenApi(publicBaseUrl(
      req.headers.get("x-forwarded-proto"),
      req.headers.get("x-forwarded-host"),
      url,
    )));
  }

  const auth = await authenticate(req);
  if (auth instanceof Response) {
    await audit(null, method, path, auth.status, "auth_failed", null);
    return auth;
  }

  const requireScope = (scope: string): Response | null =>
    auth.scopes.includes(scope)
      ? null
      : fail("forbidden", `Scope ${scope} requis.`);

  let response: Response;
  let requestId: string | null = null;

  const idMatch = path.match(/^\/v1\/requests\/([0-9a-f-]{36})$/i);
  const attachMatch = path.match(/^\/v1\/requests\/([0-9a-f-]{36})\/attachments$/i);

  if (path === UPLOAD_PATH && method === "POST") {
    response = requireScope("requests:write") ?? await handleUpload(auth, req);
  } else if (path === UPLOAD_PATH) {
    response = fail("method_not_allowed", "Méthode non prévue sur cette route.");
  } else if (path === "/v1/requests" && method === "POST") {
    response = requireScope("requests:write") ?? await handleIngest(auth, req);
  } else if (path === "/v1/requests" && method === "GET") {
    response = requireScope("requests:read") ?? await handleList(auth, url);
  } else if (idMatch && method === "GET" && UUID_RE.test(idMatch[1])) {
    requestId = idMatch[1];
    response = requireScope("requests:read") ?? await handleGet(auth, requestId);
  } else if (attachMatch && method === "POST" && UUID_RE.test(attachMatch[1])) {
    requestId = attachMatch[1];
    response = requireScope("requests:write") ?? await handleAddAttachments(auth, requestId, req);
  } else if (path === "/v1/requests" || idMatch || attachMatch) {
    response = fail("method_not_allowed", "Méthode non prévue sur cette route.");
  } else {
    response = fail("not_found", "Ressource introuvable.");
  }

  const errorCode = response.status >= 400
    ? (response.status === 409 ? "conflict" : `http_${response.status}`)
    : null;
  await audit(auth, method, path, response.status, errorCode, requestId);
  return response;
});
