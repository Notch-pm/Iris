// Validation de forme du payload de create-request-from-procedure — whitelist
// stricte des clés (un navigateur ne peut JAMAIS fournir ni altérer un
// snapshot), messages en français. Logique pure, sans dépendance Deno, testée
// par vitest.
//
// RM-29 (paramètres de droits) : l'organisation destinataire devient
// OBLIGATOIRE pour toute demande créée dans Iris — `socle_organization_id`
// absent ou non-UUID est refusé ICI (validation de forme). L'existence de
// cette organisation dans le miroir du tenant (non obsolète) reste vérifiée
// dans index.ts (accès base de données, hors de cette logique pure).

// deno-lint-ignore-file no-explicit-any

import type { AttachmentDeclaration, Audience, RequesterSubmission } from "./procedureForm.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ["basse", "normale", "haute", "urgente"];
const AUDIENCES: Audience[] = ["citoyen", "entreprise", "association"];

export interface CreatePayload {
  organizationId: string;
  requestId: string;
  procedureId: string;
  subject: string;
  body: string | null;
  priority: string;
  channel: string | null;
  /** Organisation destinataire — OBLIGATOIRE (RM-29), UUID Socle nu. */
  destinationId: string;
  requester: RequesterSubmission;
  formValues: Record<string, unknown>;
  attachments: AttachmentDeclaration[];
}

const PAYLOAD_KEYS = new Set([
  "organization_id", "request_id", "socle_procedure_id", "subject", "body",
  "priority", "channel", "socle_organization_id", "requester", "form_values", "attachments",
]);
const REQUESTER_KEYS = new Set(["kind", "audience", "socle_contact_id", "declared"]);

export function parsePayload(raw: any): CreatePayload | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "Corps JSON attendu." };
  }
  // Whitelist stricte : un navigateur ne peut JAMAIS fournir ni altérer un
  // snapshot (procedure_snapshot, requester_snapshot… → refus explicite).
  const unknown = Object.keys(raw).filter((k) => !PAYLOAD_KEYS.has(k));
  if (unknown.length > 0) {
    return { error: `Clés inconnues : ${unknown.join(", ")}. Les snapshots sont construits côté serveur.` };
  }
  for (const key of ["organization_id", "request_id", "socle_procedure_id"] as const) {
    if (typeof raw[key] !== "string" || !UUID_RE.test(raw[key])) {
      return { error: `${key} : UUID requis.` };
    }
  }
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (subject === "" || subject.length > 500) {
    return { error: "subject : chaîne non vide de 500 caractères maximum requise." };
  }
  const priority = raw.priority === undefined ? "normale" : raw.priority;
  if (!PRIORITIES.includes(priority)) return { error: "priority : valeur inconnue." };
  // RM-29 : organisation destinataire obligatoire pour toute demande créée
  // dans Iris (l'ingestion, elle, continue de l'accepter absente — hors de
  // cette fonction, propre à requests-api).
  if (typeof raw.socle_organization_id !== "string" || !UUID_RE.test(raw.socle_organization_id)) {
    return { error: "socle_organization_id : UUID de l'organisation destinataire requis." };
  }

  const r = raw.requester;
  if (typeof r !== "object" || r === null) return { error: "requester : objet requis." };
  const unknownRequester = Object.keys(r).filter((k) => !REQUESTER_KEYS.has(k));
  if (unknownRequester.length > 0) {
    return { error: `requester : clés inconnues (${unknownRequester.join(", ")}).` };
  }
  let requester: RequesterSubmission;
  if (r.kind === "anonyme") {
    requester = { kind: "anonyme" };
  } else if (r.kind === "contact" || r.kind === "sans_rapprochement") {
    if (!AUDIENCES.includes(r.audience)) return { error: "requester.audience : valeur inconnue." };
    if (r.kind === "contact") {
      if (typeof r.socle_contact_id !== "string" || !UUID_RE.test(r.socle_contact_id)) {
        return { error: "requester.socle_contact_id : UUID requis." };
      }
      requester = { kind: "contact", audience: r.audience, socle_contact_id: r.socle_contact_id };
    } else {
      if (typeof r.declared !== "object" || r.declared === null || Array.isArray(r.declared)) {
        return { error: "requester.declared : objet requis." };
      }
      requester = { kind: "sans_rapprochement", audience: r.audience, declared: r.declared };
    }
  } else {
    return { error: "requester.kind : contact, sans_rapprochement ou anonyme." };
  }

  const formValues = raw.form_values ?? {};
  if (typeof formValues !== "object" || Array.isArray(formValues)) {
    return { error: "form_values : objet requis." };
  }

  const attachments: AttachmentDeclaration[] = [];
  const rawAttachments = raw.attachments ?? [];
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 50) {
    return { error: "attachments : tableau de 50 éléments maximum." };
  }
  const prefix = `${raw.organization_id}/${raw.request_id}/`;
  for (const [i, a] of rawAttachments.entries()) {
    if (typeof a !== "object" || a === null) return { error: `attachments[${i}] : objet attendu.` };
    if (typeof a.form_field_key !== "string" || a.form_field_key.trim() === ""
        || a.form_field_key.length > 120) {
      return { error: `attachments[${i}].form_field_key : clé de champ requise.` };
    }
    if (typeof a.file_name !== "string" || a.file_name.trim() === "" || a.file_name.length > 255) {
      return { error: `attachments[${i}].file_name : nom de fichier requis.` };
    }
    if (typeof a.storage_path !== "string" || !a.storage_path.startsWith(prefix)
        || a.storage_path.includes("..")) {
      return { error: `attachments[${i}].storage_path : chemin hors du brouillon de la demande.` };
    }
    if (a.size_bytes !== undefined && (typeof a.size_bytes !== "number" || a.size_bytes < 0)) {
      return { error: `attachments[${i}].size_bytes : entier positif attendu.` };
    }
    attachments.push({
      form_field_key: a.form_field_key.trim(),
      file_name: a.file_name,
      storage_path: a.storage_path,
      mime_type: typeof a.mime_type === "string" ? a.mime_type : null,
      size_bytes: typeof a.size_bytes === "number" ? a.size_bytes : null,
    });
  }

  return {
    organizationId: raw.organization_id,
    requestId: raw.request_id,
    procedureId: raw.socle_procedure_id,
    subject,
    body: typeof raw.body === "string" && raw.body.trim() !== "" ? raw.body.trim() : null,
    priority,
    channel: typeof raw.channel === "string" && raw.channel.trim() !== ""
      ? raw.channel.trim().slice(0, 40) : null,
    destinationId: raw.socle_organization_id,
    requester,
    formValues: formValues as Record<string, unknown>,
    attachments,
  };
}
