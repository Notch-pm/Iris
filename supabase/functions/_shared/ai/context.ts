/**
 * Le contexte métier d'une demande, tel qu'il part chez le fournisseur.
 *
 * ⚠️ LA PREMIÈRE DÉFENSE EST ICI, ET C'EST `REQUEST_CONTEXT_COLUMNS`.
 * Cette constante est la liste de `select` de l'edge function. Elle ne contient
 * NI `requester_snapshot`, NI `socle_contact_id`, NI `identity_status` : les
 * colonnes d'identité ne sont pas demandées, donc pas chargées, donc pas en
 * mémoire du processus. Un test d'une ligne le vérifie — il vaut tous les
 * retraits a posteriori, qui ne peuvent qu'oublier un cas.
 * `redact.ts` couvre le reste : `form_data` et les payloads d'événements, où
 * une identité peut se glisser dans une réponse libre.
 *
 * CE QUI RESTE : la démarche, l'objet, la description, les réponses au
 * formulaire (conditions rejouées), le statut, l'urgence, l'échéance, le
 * motif de clôture, les anomalies, et l'historique des étapes. C'est de quoi
 * répondre à « que dois-je faire de ce dossier ? » sans savoir qui l'a déposé.
 *
 * Module PUR, testé.
 */

import {
  parseLocationValue,
  dataKey,
  fieldIsVisible,
  flatFields,
  isChoiceType,
  parseFormSchema,
  type Field,
  type FormValues,
} from "../../create-request-from-procedure/_shared/procedureForm.ts";
import { redactValue } from "./redact.ts";

/**
 * ⚠️ NE JAMAIS AJOUTER ICI une colonne d'identité. C'est la promesse faite au
 * PO (décision du 2026-08-28) et elle se tient à cette ligne.
 */
export const REQUEST_CONTEXT_COLUMNS = [
  "id", "reference", "subject", "body", "status", "priority", "channel",
  "received_at", "due_at", "closed_at", "closure_motif", "closure_text",
  "organization_id", "socle_scope_org_id", "socle_procedure_id",
  "socle_procedure_label", "socle_category_label", "socle_organization_label",
  "form_data", "procedure_snapshot", "anomalies",
].join(", ");

/** Colonnes bannies, nommées pour que le test soit lisible. */
export const IDENTITY_COLUMNS = [
  "requester_snapshot", "socle_contact_id", "identity_status",
] as const;

// Jumeau des libellés de `src/features/requests/statuts.ts`. Un test importe
// les DEUX et affirme l'égalité — l'assistant ne doit pas nommer un statut
// autrement que l'écran que l'agent a sous les yeux.
export const STATUS_LABELS: Record<string, string> = {
  a_traiter: "À traiter",
  en_instruction: "En cours d'instruction",
  en_attente: "En attente d'information",
  annulee: "Annulée",
  resolue_positive: "Résolue positivement",
  resolue_negative: "Résolue négativement",
  archivee: "Archivée",
};

export const PRIORITY_LABELS: Record<string, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

/** Événements du journal traduits en clair. Tout type inconnu est IGNORÉ. */
export const EVENT_LABELS: Record<string, string> = {
  request_created: "Demande créée",
  request_created_from_procedure: "Demande créée depuis une démarche",
  request_ingested: "Demande reçue d'une application partenaire",
  status_changed: "Changement de statut",
  assigned: "Affectation à un agent",
  unassigned: "Retrait d'affectation",
  priority_changed: "Changement d'urgence",
  attachment_added: "Pièce ajoutée",
  attachment_qualified: "Pièce qualifiée",
  attachment_replaced: "Pièce remplacée",
  form_data_updated: "Réponses du formulaire modifiées",
  email_sent: "Message envoyé à l'usager",
  linked: "Demande liée",
};

export interface RequestRow {
  reference: string;
  subject: string;
  body: string | null;
  status: string;
  priority: string;
  channel: string | null;
  received_at: string;
  due_at: string | null;
  closure_motif: string | null;
  closure_text: string | null;
  socle_procedure_label: string | null;
  socle_category_label: string | null;
  socle_organization_label: string | null;
  form_data: unknown;
  procedure_snapshot: unknown;
  anomalies: unknown;
}

export interface EventRow {
  event_type: string;
  created_at: string;
}

export interface ContextAnswer {
  label: string;
  value: string;
}

export interface RequestContext {
  reference: string;
  procedure: string | null;
  category: string | null;
  service: string | null;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  channel: string | null;
  receivedAt: string;
  dueAt: string | null;
  closure: string | null;
  answers: ContextAnswer[];
  history: string[];
  anomalies: string[];
  /** Champs d'identité effectivement retirés — le prompt le dit au modèle. */
  removedIdentityKeys: string[];
}

function isoDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(displayValue).filter((v) => v !== "").join(", ");
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

/** Le CODE d'une option ne dit rien au modèle ; son libellé, si. */
function optionLabel(field: Field, raw: unknown): string {
  // Un lieu d'intervention se lit par son adresse : ses coordonnées ne disent
  // rien au modèle, et un JSON brut moins encore.
  if (field.type === "location") return parseLocationValue(raw)?.address ?? "";
  if (!isChoiceType(field.type)) return displayValue(raw);
  const options = (field as { options?: { value: string; label: string }[] }).options ?? [];
  const one = (v: unknown) =>
    options.find((o) => o.value === String(v))?.label ?? displayValue(v);
  return Array.isArray(raw)
    ? raw.map(one).filter((v) => v !== "").join(", ")
    : one(raw);
}

/**
 * Réponses au formulaire FIGÉ de la demande, conditions rejouées : un champ
 * dont le `visibleIf` est faux n'a pas de réponse à montrer, et le donner au
 * modèle l'inviterait à raisonner sur une question jamais posée.
 *
 * ⚠️ `form_data` est indexé par CLÉ MACHINE, alors que les conditions
 * référencent l'ID du champ. Il faut donc construire une vue par id avant
 * d'évaluer la visibilité — c'est exactement ce que fait `formAnswers` dans
 * `src/features/requests/instruction/instruction.ts`, et ce module en est le
 * jumeau serveur. L'oublier fait disparaître silencieusement tous les champs
 * conditionnels (attrapé par le test « montre le champ quand la condition est
 * vraie »).
 *
 * Les clés que le schéma ne connaît pas (payloads partenaires) sont conservées
 * en clair, comme à l'écran : un snapshot dégradé ne doit pas faire perdre la
 * saisie.
 */
export function contextAnswers(snapshot: unknown, formData: unknown): ContextAnswer[] {
  const data = (typeof formData === "object" && formData !== null && !Array.isArray(formData)
    ? formData
    : {}) as Record<string, unknown>;
  const rawSchema = (snapshot as { form_schema?: unknown } | null)?.form_schema;
  const entries = flatFields(parseFormSchema(rawSchema));

  const answers: ContextAnswer[] = [];
  const consumed = new Set<string>();

  const byId: FormValues = {};
  for (const entry of entries) byId[entry.field.id] = data[dataKey(entry.field)];

  for (const entry of entries) {
    const key = dataKey(entry.field);
    consumed.add(key);
    if (entry.field.type === "attachment") continue;
    if (!fieldIsVisible(entry, byId)) continue;
    const value = optionLabel(entry.field, data[key]);
    if (value === "") continue;
    answers.push({ label: entry.field.label || key, value });
  }

  for (const [key, value] of Object.entries(data)) {
    if (consumed.has(key)) continue;
    const text = displayValue(value);
    if (text === "") continue;
    answers.push({ label: key, value: text });
  }
  return answers;
}

/** Anomalies déclarées sur la demande (`usager_a_creer_dans_socle`, etc.). */
function anomalyList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((a) => displayValue(a)).filter((a) => a !== "");
  if (typeof raw === "object" && raw !== null) return Object.keys(raw);
  return [];
}

export function buildRequestContext(
  row: RequestRow,
  events: EventRow[],
): RequestContext {
  // `form_data` est la seule zone où une identité peut encore se trouver :
  // c'est de la saisie libre. On la passe au module de retrait AVANT d'en
  // faire des réponses lisibles.
  const redacted = redactValue(row.form_data);

  const closure = row.closure_motif
    ? `${row.closure_motif}${row.closure_text ? ` — ${row.closure_text}` : ""}`
    : row.closure_text;

  return {
    reference: row.reference,
    procedure: row.socle_procedure_label,
    category: row.socle_category_label,
    service: row.socle_organization_label,
    subject: row.subject,
    description: row.body ? redactValue(row.body).value : null,
    status: STATUS_LABELS[row.status] ?? row.status,
    priority: PRIORITY_LABELS[row.priority] ?? row.priority,
    channel: row.channel,
    receivedAt: isoDay(row.received_at) ?? row.received_at,
    dueAt: isoDay(row.due_at),
    closure: closure ? redactValue(closure).value : null,
    answers: contextAnswers(row.procedure_snapshot, redacted.value),
    history: events
      .map((e) => {
        const label = EVENT_LABELS[e.event_type];
        const day = isoDay(e.created_at);
        return label && day ? `${day} — ${label}` : null;
      })
      .filter((h): h is string => h !== null),
    anomalies: anomalyList(row.anomalies),
    removedIdentityKeys: redacted.removedKeys,
  };
}
