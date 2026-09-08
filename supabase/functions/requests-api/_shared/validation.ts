// Validation stricte de l'enveloppe d'ingestion — whitelist des clés (clé
// inconnue → 400), messages en français. Logique pure, testée par vitest.

import {
  sortFingerprints,
  type AttachmentFingerprint,
} from "../../_shared/files/uploads.ts";

/** Le slug de nom de fichier vit désormais avec les chemins du bucket ; ré-exporté pour les appelants historiques. */
export { slugifyFileName } from "../../_shared/files/names.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_RE = /^[a-z][a-z0-9_-]{1,39}$/;

/**
 * Contrat 2.0.0 : une pièce est un fichier DÉJÀ déposé sur `POST /v1/uploads`,
 * désigné par son `upload_id`. Le contenu, le nom, le type et l'empreinte
 * sont ceux que le serveur a vérifiés à la réception — l'enveloppe ne les
 * redit pas (elle ne pourrait que les contredire).
 */
export interface AttachmentRef {
  upload_id: string;
  /** Clé machine (`key`) du champ pièce justificative du form_schema Socle. */
  form_field_key?: string;
}

export interface LinkRef {
  type: string;
  id: string;
  url?: string;
  label?: string;
}

export interface EnvelopeContext {
  channel?: string;
  received_at?: string;
  external_url?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestEnvelope {
  source_system: string;
  external_id: string;
  idempotency_key?: string;
  socle_root_organization_id: string;
  socle_organization_id?: string;
  /** OBLIGATOIRE : toute demande est fondée sur une démarche Socle active. */
  socle_procedure_id: string;
  socle_contact_id?: string;
  subject: string;
  body?: string;
  requester?: Record<string, unknown>;
  form_data?: Record<string, unknown>;
  attachments?: AttachmentRef[];
  context?: EnvelopeContext;
  links?: LinkRef[];
}

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail<T>(message: string): Validation<T> {
  return { ok: false, message };
}

const ENVELOPE_KEYS = new Set([
  "source_system", "external_id", "idempotency_key",
  "socle_root_organization_id", "socle_organization_id",
  "socle_procedure_id", "socle_contact_id",
  "subject", "body", "requester", "form_data",
  "attachments", "context", "links",
]);
const ATTACHMENT_KEYS = new Set(["upload_id", "form_field_key"]);
/** Clés du contrat 1.x : refusées avec un message qui dit quoi faire à la place. */
const LEGACY_ATTACHMENT_KEYS = new Set(["fetch_url", "file_name", "mime_type", "size_bytes", "checksum"]);
const LINK_KEYS = new Set(["type", "id", "url", "label"]);
const CONTEXT_KEYS = new Set(["channel", "received_at", "external_url", "metadata"]);

function checkString(v: unknown, name: string, max: number): string | { error: string } {
  if (typeof v !== "string" || v.trim() === "") return { error: `${name} : chaîne non vide requise.` };
  if (v.length > max) return { error: `${name} : ${max} caractères maximum.` };
  return v;
}

function checkUuid(v: unknown, name: string): string | { error: string } {
  if (typeof v !== "string" || !UUID_RE.test(v)) return { error: `${name} : UUID invalide.` };
  return v.toLowerCase();
}

const UPLOAD_HINT =
  "Déposez d'abord le fichier sur POST /v1/uploads (multipart), puis référencez son upload_id.";

/** Pièces jointes : références `{ upload_id, form_field_key? }` — JAMAIS de contenu inline ni d'URL. */
export function validateAttachmentList(value: unknown): Validation<AttachmentRef[]> {
  if (!Array.isArray(value)) return fail("attachments : tableau attendu.");
  if (value.length > 50) return fail("attachments : 50 pièces maximum par appel.");
  const out: AttachmentRef[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of value.entries()) {
    if (!isPlainObject(raw)) return fail(`attachments[${i}] : objet attendu.`);
    const legacy = Object.keys(raw).filter((k) => LEGACY_ATTACHMENT_KEYS.has(k));
    if (legacy.length > 0) {
      return fail(
        `attachments[${i}] : ${legacy.join(", ")} n'est plus pris en charge (contrat 2.0.0 — ` +
        `le mode « URL signée » a été retiré). ${UPLOAD_HINT}`,
      );
    }
    const unknown = Object.keys(raw).filter((k) => !ATTACHMENT_KEYS.has(k));
    if (unknown.length > 0) {
      return fail(
        `attachments[${i}] : clés inconnues (${unknown.join(", ")}). ` +
        `Le contenu inline est refusé. ${UPLOAD_HINT}`,
      );
    }
    const uploadId = checkUuid(raw.upload_id, `attachments[${i}].upload_id`);
    if (typeof uploadId !== "string") return fail(uploadId.error);
    if (seen.has(uploadId)) return fail(`attachments[${i}].upload_id : pièce référencée deux fois.`);
    seen.add(uploadId);
    if (raw.form_field_key !== undefined
        && (typeof raw.form_field_key !== "string" || raw.form_field_key.trim() === ""
            || raw.form_field_key.length > 120)) {
      return fail(`attachments[${i}].form_field_key : clé de champ invalide.`);
    }
    out.push({
      upload_id: uploadId,
      form_field_key: typeof raw.form_field_key === "string" ? raw.form_field_key : undefined,
    });
  }
  return { ok: true, value: out };
}

export function validateEnvelope(body: unknown): Validation<IngestEnvelope> {
  if (!isPlainObject(body)) return fail("Corps JSON attendu.");

  const unknown = Object.keys(body).filter((k) => !ENVELOPE_KEYS.has(k));
  if (unknown.length > 0) return fail(`Clés inconnues : ${unknown.join(", ")}.`);

  const sourceSystem = checkString(body.source_system, "source_system", 40);
  if (typeof sourceSystem !== "string") return fail(sourceSystem.error);
  if (!SOURCE_RE.test(sourceSystem)) return fail("source_system : format invalide.");

  const externalId = checkString(body.external_id, "external_id", 200);
  if (typeof externalId !== "string") return fail(externalId.error);

  const subject = checkString(body.subject, "subject", 500);
  if (typeof subject !== "string") return fail(subject.error);

  const rootOrg = checkUuid(body.socle_root_organization_id, "socle_root_organization_id");
  if (typeof rootOrg !== "string") return fail(rootOrg.error);

  // Règle impérative : aucune demande libre — la démarche Socle est obligatoire.
  const procedureId = checkUuid(body.socle_procedure_id, "socle_procedure_id");
  if (typeof procedureId !== "string") {
    return fail(
      "socle_procedure_id : obligatoire — toute demande doit être fondée sur une démarche Socle active.",
    );
  }

  const env: IngestEnvelope = {
    source_system: sourceSystem,
    external_id: externalId,
    socle_root_organization_id: rootOrg,
    socle_procedure_id: procedureId,
    subject,
  };

  for (const key of ["socle_organization_id", "socle_contact_id"] as const) {
    if (body[key] !== undefined && body[key] !== null) {
      const v = checkUuid(body[key], key);
      if (typeof v !== "string") return fail(v.error);
      env[key] = v;
    }
  }

  if (body.idempotency_key !== undefined) {
    const v = checkString(body.idempotency_key, "idempotency_key", 200);
    if (typeof v !== "string") return fail(v.error);
    env.idempotency_key = v;
  }

  if (body.body !== undefined && body.body !== null) {
    if (typeof body.body !== "string") return fail("body : texte attendu.");
    env.body = body.body;
  }

  if (body.requester !== undefined && body.requester !== null) {
    if (!isPlainObject(body.requester)) return fail("requester : objet attendu.");
    env.requester = body.requester;
  }
  // Identité : un contact Socle, OU une identité déclarée (y compris
  // { anonymous: true } — l'anonymat est un choix assumé, pas un oubli).
  if (!env.socle_contact_id && (!env.requester || Object.keys(env.requester).length === 0)) {
    return fail(
      "Identité du demandeur requise : socle_contact_id, ou requester " +
      "(identité déclarée, ou { \"anonymous\": true } pour un dépôt anonyme).",
    );
  }

  if (body.form_data !== undefined) {
    if (!isPlainObject(body.form_data)) return fail("form_data : objet attendu.");
    env.form_data = body.form_data;
  }

  if (body.attachments !== undefined) {
    const res = validateAttachmentList(body.attachments);
    if (!res.ok) return res;
    env.attachments = res.value;
  }

  if (body.context !== undefined) {
    if (!isPlainObject(body.context)) return fail("context : objet attendu.");
    const ctxUnknown = Object.keys(body.context).filter((k) => !CONTEXT_KEYS.has(k));
    if (ctxUnknown.length > 0) return fail(`context : clés inconnues (${ctxUnknown.join(", ")}).`);
    const ctx: EnvelopeContext = {};
    if (body.context.channel !== undefined) {
      const v = checkString(body.context.channel, "context.channel", 40);
      if (typeof v !== "string") return fail(v.error);
      ctx.channel = v;
    }
    if (body.context.received_at !== undefined) {
      if (typeof body.context.received_at !== "string" || Number.isNaN(Date.parse(body.context.received_at))) {
        return fail("context.received_at : date ISO 8601 attendue.");
      }
      ctx.received_at = body.context.received_at;
    }
    if (body.context.external_url !== undefined) {
      if (typeof body.context.external_url !== "string" || !/^https?:\/\//.test(body.context.external_url)) {
        return fail("context.external_url : URL attendue.");
      }
      ctx.external_url = body.context.external_url;
    }
    if (body.context.metadata !== undefined) {
      if (!isPlainObject(body.context.metadata)) return fail("context.metadata : objet attendu.");
      ctx.metadata = body.context.metadata;
    }
    env.context = ctx;
  }

  if (body.links !== undefined) {
    if (!Array.isArray(body.links)) return fail("links : tableau attendu.");
    if (body.links.length > 20) return fail("links : 20 liens maximum.");
    const links: LinkRef[] = [];
    for (const [i, raw] of body.links.entries()) {
      if (!isPlainObject(raw)) return fail(`links[${i}] : objet attendu.`);
      const linkUnknown = Object.keys(raw).filter((k) => !LINK_KEYS.has(k));
      if (linkUnknown.length > 0) return fail(`links[${i}] : clés inconnues (${linkUnknown.join(", ")}).`);
      const type = checkString(raw.type, `links[${i}].type`, 60);
      if (typeof type !== "string") return fail(type.error);
      const id = checkString(raw.id, `links[${i}].id`, 200);
      if (typeof id !== "string") return fail(id.error);
      const link: LinkRef = { type, id };
      if (raw.url !== undefined) {
        if (typeof raw.url !== "string" || !/^https?:\/\//.test(raw.url)) return fail(`links[${i}].url : URL attendue.`);
        link.url = raw.url;
      }
      if (raw.label !== undefined && typeof raw.label === "string") link.label = raw.label;
      links.push(link);
    }
    env.links = links;
  }

  return { ok: true, value: env };
}

/**
 * Champs entrant dans l'empreinte de contenu. Exclusions volontaires :
 * - idempotency_key (identifie la soumission, pas le contenu) ;
 * - les `upload_id` des pièces : deux dépôts légitimes du même fichier
 *   (rejeu après timeout, avec un nouveau téléversement) portent deux
 *   identifiants différents. Ce qui entre, c'est le CONTENU vérifié par le
 *   serveur — nom, type détecté, taille, sha256, clé de champ —, lu dans la
 *   zone d'attente et passé ici par l'appelant, dans un ordre stable.
 */
export function fingerprintPayload(
  env: IngestEnvelope,
  attachments: AttachmentFingerprint[] = [],
): unknown {
  return {
    external_id: env.external_id,
    socle_root_organization_id: env.socle_root_organization_id,
    socle_organization_id: env.socle_organization_id ?? null,
    socle_procedure_id: env.socle_procedure_id ?? null,
    socle_contact_id: env.socle_contact_id ?? null,
    subject: env.subject,
    body: env.body ?? null,
    requester: env.requester ?? null,
    form_data: env.form_data ?? {},
    attachments: sortFingerprints(attachments),
    context: {
      channel: env.context?.channel ?? null,
      received_at: env.context?.received_at ?? null,
      external_url: env.context?.external_url ?? null,
      metadata: env.context?.metadata ?? null,
    },
    links: (env.links ?? []).map((l) => ({
      type: l.type, id: l.id, url: l.url ?? null, label: l.label ?? null,
    })),
  };
}

// `identityStatus()` a été RETIRÉE le 2026-08-26 : le statut d'identité ne se
// déduit plus de l'enveloppe. Une identité déclarée sans identifiant Socle est
// désormais rapprochée ou CRÉÉE dans le référentiel (`resolveRequester`, dans
// index.ts), et ne retombe en `non_rapprochee` que si le Socle est muet.
