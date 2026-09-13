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

import type { Audience, RequesterSubmission } from "./procedureForm.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ["basse", "normale", "haute", "urgente"];
const AUDIENCES: Audience[] = ["citoyen", "entreprise", "association"];

/**
 * Une pièce du guichet est un fichier DÉJÀ reçu par l'edge function
 * `request-attachments` (zone d'attente) : le navigateur ne dit plus que
 * « quel upload répond à quelle exigence ». Nom, type, taille, chemin et
 * empreinte sont relus en base.
 */
export interface UploadRef {
  upload_id: string;
  form_field_key: string;
}

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
  attachments: UploadRef[];
  /**
   * Consentements RGPD tels que le navigateur les envoie : `[{ kind, granted }]`,
   * et rien de plus. Validés — et leur LIBELLÉ composé — par `normalizeConsents`
   * dans `index.ts`, qui seul connaît le nom de l'organisme principal. Laissés
   * bruts ici : cette validation-ci est de forme, et le catalogue n'a pas à
   * être dupliqué dans deux modules.
   */
  rawConsents: unknown;
}

const PAYLOAD_KEYS = new Set([
  "organization_id", "request_id", "socle_procedure_id", "subject", "body",
  "priority", "channel", "socle_organization_id", "requester", "form_values", "attachments",
  "consents",
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

  const attachments: UploadRef[] = [];
  const rawAttachments = raw.attachments ?? [];
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 50) {
    return { error: "attachments : tableau de 50 éléments maximum." };
  }
  const seen = new Set<string>();
  for (const [i, a] of rawAttachments.entries()) {
    if (typeof a !== "object" || a === null) return { error: `attachments[${i}] : objet attendu.` };
    const keys = Object.keys(a);
    if (keys.some((k) => k !== "upload_id" && k !== "form_field_key")) {
      // Un chemin, un nom ou un type venus du navigateur ne sont plus acceptés :
      // tout est relu dans la zone d'attente.
      return { error: `attachments[${i}] : seules les clés upload_id et form_field_key sont acceptées.` };
    }
    if (typeof a.form_field_key !== "string" || a.form_field_key.trim() === ""
        || a.form_field_key.length > 120) {
      return { error: `attachments[${i}].form_field_key : clé de champ requise.` };
    }
    if (typeof a.upload_id !== "string" || !UUID_RE.test(a.upload_id)) {
      return { error: `attachments[${i}].upload_id : identifiant de pièce téléversée requis.` };
    }
    const uploadId = a.upload_id.toLowerCase();
    if (seen.has(uploadId)) return { error: `attachments[${i}].upload_id : pièce référencée deux fois.` };
    seen.add(uploadId);
    attachments.push({ upload_id: uploadId, form_field_key: a.form_field_key.trim() });
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
    rawConsents: raw.consents,
  };
}
