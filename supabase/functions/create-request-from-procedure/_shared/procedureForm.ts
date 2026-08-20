// Moteur de rendu/validation du formulaire d'une démarche Socle — LOGIQUE PURE
// (aucune dépendance Deno/React/réseau), partagée entre le parcours de création
// (rendu + validation de confort) et l'edge function create-request-from-procedure
// (validation d'AUTORITÉ, sur la démarche rechargée depuis Socle côté serveur).
//
// Types = miroir EXACT du contrat public Socle (`form_schema` v1,
// `requester_config`) — voir Socle src/features/procedures/{formSchema,
// conditions, requesterFields}.ts. Parsing tolérant : un JSON invalide retombe
// sur un schéma vide plutôt que de planter (parité parseFormSchema Socle).

// ---- Conditions (contrat Socle, copie conforme) -----------------------------

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "includes"
  | "isEmpty"
  | "isNotEmpty";

export interface ConditionRule {
  /** id du champ dont dépend la règle (l'`id` du nœud, pas la clé machine). */
  fieldId: string;
  operator: ConditionOperator;
  value?: string | string[];
}

export interface Condition {
  combinator: "and" | "or";
  rules: ConditionRule[];
}

/** Valeurs saisies dans le formulaire, indexées par **id** de champ. */
export type FormValues = Record<string, unknown>;

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asScalar(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function ruleEquals(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (fieldValue === undefined || fieldValue === null) return false;
  return String(fieldValue) === target;
}

function ruleIncludes(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (typeof fieldValue === "string") return fieldValue.includes(target);
  return false;
}

export function evaluateRule(rule: ConditionRule, values: FormValues): boolean {
  const fieldValue = values[rule.fieldId];
  switch (rule.operator) {
    case "isEmpty":
      return isEmptyValue(fieldValue);
    case "isNotEmpty":
      return !isEmptyValue(fieldValue);
    case "equals":
      return ruleEquals(fieldValue, asScalar(rule.value));
    case "notEquals":
      return !ruleEquals(fieldValue, asScalar(rule.value));
    case "includes":
      return ruleIncludes(fieldValue, asScalar(rule.value));
    default:
      return false;
  }
}

/** Condition absente ou sans règle = satisfaite (toujours affiché / facultatif). */
export function evaluateCondition(
  condition: Condition | undefined | null,
  values: FormValues,
): boolean {
  if (!condition || condition.rules.length === 0) return true;
  const results = condition.rules.map((rule) => evaluateRule(rule, values));
  return condition.combinator === "or" ? results.some(Boolean) : results.every(Boolean);
}

// ---- Schéma de formulaire (contrat Socle v1) --------------------------------

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "boolean"
  | "select"
  | "radio"
  | "checkboxes"
  | "attachment";

export const CHOICE_TYPES = ["select", "radio", "checkboxes"] as const;
export type ChoiceType = (typeof CHOICE_TYPES)[number];

export interface FieldOption {
  value: string;
  label: string;
}

interface FieldCommon {
  id: string;
  /** Clé machine — la donnée du contrat consommée en aval (jamais l'`id`). */
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  visibleIf?: Condition;
}

export interface SimpleField extends FieldCommon {
  type: "text" | "textarea" | "number" | "date" | "email" | "phone" | "boolean";
  maxLength?: number;
}

export interface ChoiceField extends FieldCommon {
  type: ChoiceType;
  options: FieldOption[];
}

export const MAX_ATTACHMENT_FILES = 5;

export interface AttachmentField extends FieldCommon {
  type: "attachment";
  documentTypeId?: string;
  /** 1 = un seul fichier ; 2..5 = plusieurs (borné par MAX_ATTACHMENT_FILES). */
  maxFiles: number;
  /** Extensions acceptées, normalisées sans point (ex. ["pdf", "jpg"]). */
  acceptedFormats: string[];
  /** Obligatoire si la condition est satisfaite (en plus du `required` statique). */
  requiredIf?: Condition;
}

export type Field = SimpleField | ChoiceField | AttachmentField;

export interface Section {
  id: string;
  kind: "section";
  title: string;
  description?: string;
  visibleIf?: Condition;
  fields: Field[];
}

export type FormNode = Field | Section;

export interface FormSchema {
  version: 1;
  content: FormNode[];
}

export function isSection(node: FormNode): node is Section {
  return "kind" in node && node.kind === "section";
}

export function isChoiceType(type: FieldType): type is ChoiceType {
  return (CHOICE_TYPES as readonly string[]).includes(type);
}

// ---- Parsing tolérant (sans zod — même contrat que parseFormSchema Socle) ---

const SIMPLE_TYPES = ["text", "textarea", "number", "date", "email", "phone", "boolean"] as const;
const OPERATORS: readonly string[] = ["equals", "notEquals", "includes", "isEmpty", "isNotEmpty"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCondition(raw: unknown): Condition | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) return null; // invalide
  const combinator = raw.combinator;
  if (combinator !== "and" && combinator !== "or") return null;
  if (!Array.isArray(raw.rules)) return null;
  const rules: ConditionRule[] = [];
  for (const r of raw.rules) {
    if (!isRecord(r) || typeof r.fieldId !== "string") return null;
    if (typeof r.operator !== "string" || !OPERATORS.includes(r.operator)) return null;
    const rule: ConditionRule = { fieldId: r.fieldId, operator: r.operator as ConditionOperator };
    if (typeof r.value === "string") rule.value = r.value;
    else if (Array.isArray(r.value) && r.value.every((v) => typeof v === "string")) {
      rule.value = r.value as string[];
    } else if (r.value !== undefined) return null;
    rules.push(rule);
  }
  return { combinator, rules };
}

function parseCommon(raw: Record<string, unknown>): FieldCommon | null {
  if (typeof raw.id !== "string" || typeof raw.key !== "string" || typeof raw.label !== "string") {
    return null;
  }
  const visibleIf = parseCondition(raw.visibleIf);
  if (visibleIf === null) return null;
  const common: FieldCommon = { id: raw.id, key: raw.key, label: raw.label };
  if (typeof raw.help === "string") common.help = raw.help;
  if (typeof raw.placeholder === "string") common.placeholder = raw.placeholder;
  if (typeof raw.required === "boolean") common.required = raw.required;
  if (visibleIf) common.visibleIf = visibleIf;
  return common;
}

function parseField(raw: unknown): Field | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const common = parseCommon(raw);
  if (!common) return null;

  if (raw.type === "attachment") {
    const requiredIf = parseCondition(raw.requiredIf);
    if (requiredIf === null) return null;
    const field: AttachmentField = {
      ...common,
      type: "attachment",
      maxFiles: typeof raw.maxFiles === "number" && raw.maxFiles >= 1
        ? Math.min(Math.floor(raw.maxFiles), MAX_ATTACHMENT_FILES)
        : 1,
      acceptedFormats: Array.isArray(raw.acceptedFormats)
        ? raw.acceptedFormats.filter((f): f is string => typeof f === "string")
        : [],
    };
    if (typeof raw.documentTypeId === "string") field.documentTypeId = raw.documentTypeId;
    if (requiredIf) field.requiredIf = requiredIf;
    return field;
  }

  if ((CHOICE_TYPES as readonly string[]).includes(raw.type)) {
    const options: FieldOption[] = [];
    if (Array.isArray(raw.options)) {
      for (const o of raw.options) {
        if (!isRecord(o) || typeof o.value !== "string" || typeof o.label !== "string") return null;
        options.push({ value: o.value, label: o.label });
      }
    }
    return { ...common, type: raw.type as ChoiceType, options };
  }

  if ((SIMPLE_TYPES as readonly string[]).includes(raw.type)) {
    const field: SimpleField = { ...common, type: raw.type as SimpleField["type"] };
    if (typeof raw.maxLength === "number") field.maxLength = raw.maxLength;
    return field;
  }
  return null;
}

function parseNode(raw: unknown): FormNode | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "section") {
    if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
    const visibleIf = parseCondition(raw.visibleIf);
    if (visibleIf === null) return null;
    const fields: Field[] = [];
    if (Array.isArray(raw.fields)) {
      for (const f of raw.fields) {
        const parsed = parseField(f);
        if (!parsed) return null;
        fields.push(parsed);
      }
    }
    const section: Section = { id: raw.id, kind: "section", title: raw.title, fields };
    if (typeof raw.description === "string") section.description = raw.description;
    if (visibleIf) section.visibleIf = visibleIf;
    return section;
  }
  return parseField(raw);
}

/** JSON stocké → FormSchema valide ; structure invalide → schéma vide (parité Socle). */
export function parseFormSchema(raw: unknown): FormSchema {
  const empty: FormSchema = { version: 1, content: [] };
  if (!raw || !isRecord(raw)) return empty;
  if (raw.version !== undefined && raw.version !== 1) return empty;
  if (raw.content === undefined) return empty;
  if (!Array.isArray(raw.content)) return empty;
  const content: FormNode[] = [];
  for (const node of raw.content) {
    const parsed = parseNode(node);
    if (!parsed) return empty;
    content.push(parsed);
  }
  return { version: 1, content };
}

// ---- Clés, visibilité, exigences -------------------------------------------

/**
 * Clé de la donnée dans `form_data` : la clé machine `key` — repli sur l'`id`
 * quand le builder Socle a laissé la clé vide (constaté en production).
 */
export function dataKey(field: Field): string {
  return field.key.trim() !== "" ? field.key.trim() : field.id;
}

export interface FlatField {
  field: Field;
  section: Section | null;
}

export function flatFields(schema: FormSchema): FlatField[] {
  const out: FlatField[] = [];
  for (const node of schema.content) {
    if (isSection(node)) {
      for (const field of node.fields) out.push({ field, section: node });
    } else {
      out.push({ field: node, section: null });
    }
  }
  return out;
}

/** Visible = sa section (le cas échéant) ET lui-même satisfont leur visibleIf. */
export function fieldIsVisible(entry: FlatField, values: FormValues): boolean {
  if (entry.section && !evaluateCondition(entry.section.visibleIf, values)) return false;
  return evaluateCondition(entry.field.visibleIf, values);
}

/**
 * Pièce obligatoire : `required` statique OU `requiredIf` satisfaite.
 * ⚠️ `requiredIf` ABSENTE ne rend pas obligatoire (contrairement à visibleIf,
 * où l'absence signifie « toujours visible »).
 */
export function attachmentIsRequired(field: AttachmentField, values: FormValues): boolean {
  if (field.required) return true;
  if (!field.requiredIf || field.requiredIf.rules.length === 0) return false;
  return evaluateCondition(field.requiredIf, values);
}

// ---- Validation d'une soumission -------------------------------------------

export interface AttachmentDeclaration {
  /** Clé du champ pièce (dataKey) auquel le fichier répond. */
  form_field_key: string;
  file_name: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
}

export interface FormValidationResult {
  ok: boolean;
  /** Messages d'erreur par id de champ ("_attachments" pour les pièces orphelines). */
  errors: Record<string, string>;
  /** Réponses normalisées, indexées par dataKey — champs VISIBLES uniquement. */
  formData: Record<string, unknown>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()./\s-]{6,20}$/;

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).trim().toLowerCase();
}

/**
 * Valide les valeurs (indexées par id) et les pièces déclarées contre le
 * schéma : champs invisibles ignorés (et exclus de form_data), obligatoires,
 * types, options, conditions, cardinalités et formats des pièces.
 */
export function validateFormSubmission(
  schema: FormSchema,
  values: FormValues,
  attachments: AttachmentDeclaration[],
): FormValidationResult {
  const errors: Record<string, string> = {};
  const formData: Record<string, unknown> = {};
  const visibleAttachmentKeys = new Set<string>();

  for (const entry of flatFields(schema)) {
    const field = entry.field;
    if (!fieldIsVisible(entry, values)) continue;

    if (field.type === "attachment") {
      const key = dataKey(field);
      visibleAttachmentKeys.add(key);
      const files = attachments.filter((a) => a.form_field_key === key);
      const required = attachmentIsRequired(field, values);
      if (required && files.length === 0) {
        errors[field.id] = "Pièce justificative obligatoire.";
        continue;
      }
      const max = Math.min(field.maxFiles, MAX_ATTACHMENT_FILES);
      if (files.length > max) {
        errors[field.id] = `${max} fichier${max > 1 ? "s" : ""} maximum pour cette pièce.`;
        continue;
      }
      if (field.acceptedFormats.length > 0) {
        const bad = files.find((f) => !field.acceptedFormats.includes(fileExtension(f.file_name)));
        if (bad) {
          errors[field.id] =
            `Format refusé (${bad.file_name}) — formats acceptés : ${field.acceptedFormats.join(", ")}.`;
        }
      }
      continue; // les pièces vivent dans request_attachments, jamais dans form_data
    }

    const value = values[field.id];
    const required = field.required === true;
    if (isEmptyValue(value)) {
      if (required) errors[field.id] = "Champ obligatoire.";
      continue;
    }

    let normalized: unknown = value;
    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") { errors[field.id] = "Texte attendu."; continue; }
        const s = value.trim();
        if (field.maxLength && s.length > field.maxLength) {
          errors[field.id] = `${field.maxLength} caractères maximum.`;
          continue;
        }
        normalized = s;
        break;
      }
      case "number": {
        const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
        if (!Number.isFinite(n)) { errors[field.id] = "Nombre attendu."; continue; }
        normalized = n;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
          errors[field.id] = "Date attendue (AAAA-MM-JJ).";
          continue;
        }
        break;
      }
      case "email": {
        if (typeof value !== "string" || !EMAIL_RE.test(value.trim())) {
          errors[field.id] = "Adresse e-mail invalide.";
          continue;
        }
        normalized = value.trim();
        break;
      }
      case "phone": {
        if (typeof value !== "string" || !PHONE_RE.test(value.trim())) {
          errors[field.id] = "Numéro de téléphone invalide.";
          continue;
        }
        normalized = value.trim();
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") { errors[field.id] = "Réponse Oui/Non attendue."; continue; }
        break;
      }
      case "select":
      case "radio": {
        if (typeof value !== "string"
            || !field.options.some((o) => o.value === value)) {
          errors[field.id] = "Choix hors des options proposées.";
          continue;
        }
        break;
      }
      case "checkboxes": {
        if (!Array.isArray(value)
            || !value.every((v) => typeof v === "string" && field.options.some((o) => o.value === v))) {
          errors[field.id] = "Choix hors des options proposées.";
          continue;
        }
        break;
      }
    }

    const key = dataKey(field);
    // Collision de clé machine (deux champs visibles partageant la même clé) :
    // repli sur l'id pour ne jamais écraser silencieusement une réponse.
    formData[key in formData ? field.id : key] = normalized;
  }

  const orphan = attachments.find((a) => !visibleAttachmentKeys.has(a.form_field_key));
  if (orphan) {
    errors["_attachments"] =
      `Pièce inattendue (champ « ${orphan.form_field_key} » absent ou masqué du formulaire).`;
  }

  return { ok: Object.keys(errors).length === 0, errors, formData };
}

// ---- Configuration demandeur (contrat Socle requester_config) ---------------

export type Audience = "citoyen" | "entreprise" | "association";
export type FieldVisibility = "obligatoire" | "visible" | "masque";

export interface RequesterFieldDef {
  key: string;
  label: string;
}

const CITOYEN_FIELDS: RequesterFieldDef[] = [
  { key: "civilite", label: "Civilité" },
  { key: "nom_naissance", label: "Nom de naissance" },
  { key: "nom_usuel", label: "Nom usuel" },
  { key: "prenoms", label: "Prénom(s)" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

const ORGANISATION_FIELDS: RequesterFieldDef[] = [
  { key: "siret", label: "SIRET" },
  { key: "raison_sociale", label: "Raison sociale" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

export const AUDIENCES: { key: Audience; label: string; fields: RequesterFieldDef[] }[] = [
  { key: "citoyen", label: "Citoyen", fields: CITOYEN_FIELDS },
  { key: "entreprise", label: "Entreprise", fields: ORGANISATION_FIELDS },
  { key: "association", label: "Association", fields: ORGANISATION_FIELDS },
];

export interface AudienceConfig {
  enabled: boolean;
  fields: Record<string, FieldVisibility>;
}

export type RequesterConfig = Record<Audience, AudienceConfig>;

const VALID_VISIBILITIES: readonly FieldVisibility[] = ["obligatoire", "visible", "masque"];

function defaultAudienceConfig(fields: RequesterFieldDef[]): AudienceConfig {
  const map: Record<string, FieldVisibility> = {};
  for (const f of fields) map[f.key] = "masque";
  return { enabled: false, fields: map };
}

export function defaultRequesterConfig(): RequesterConfig {
  return {
    citoyen: defaultAudienceConfig(CITOYEN_FIELDS),
    entreprise: defaultAudienceConfig(ORGANISATION_FIELDS),
    association: defaultAudienceConfig(ORGANISATION_FIELDS),
  };
}

/**
 * JSON stocké → config complète : publics/champs inconnus ignorés, valeurs
 * invalides corrigées, champs manquants complétés (copie du parseur Socle).
 */
export function parseRequesterConfig(raw: unknown): RequesterConfig {
  const config = defaultRequesterConfig();
  if (!raw || typeof raw !== "object") return config;
  const stored = raw as Record<string, unknown>;
  for (const audience of AUDIENCES) {
    const audienceRaw = stored[audience.key];
    if (!audienceRaw || typeof audienceRaw !== "object") continue;
    const { enabled, fields } = audienceRaw as { enabled?: unknown; fields?: unknown };
    if (typeof enabled === "boolean") config[audience.key].enabled = enabled;
    if (fields && typeof fields === "object") {
      const storedFields = fields as Record<string, unknown>;
      for (const field of audience.fields) {
        const v = storedFields[field.key];
        if (typeof v === "string" && VALID_VISIBILITIES.includes(v as FieldVisibility)) {
          config[audience.key].fields[field.key] = v as FieldVisibility;
        }
      }
    }
  }
  return config;
}

/**
 * Publics proposables à l'agent : ceux activés par la démarche — repli sur
 * « citoyen » pour les démarches historiques sans configuration (aucun public
 * activé), afin de ne jamais bloquer l'instruction.
 */
export function selectableAudiences(config: RequesterConfig): Audience[] {
  const enabled = AUDIENCES.filter((a) => config[a.key].enabled).map((a) => a.key);
  return enabled.length > 0 ? enabled : ["citoyen"];
}

export function visibleRequesterFields(
  config: RequesterConfig,
  audience: Audience,
): { def: RequesterFieldDef; visibility: FieldVisibility }[] {
  const defs = AUDIENCES.find((a) => a.key === audience)?.fields ?? [];
  return defs
    .map((def) => ({ def, visibility: config[audience].fields[def.key] ?? "masque" }))
    .filter((f) => f.visibility !== "masque");
}

export function requiredRequesterFields(
  config: RequesterConfig,
  audience: Audience,
): RequesterFieldDef[] {
  return visibleRequesterFields(config, audience)
    .filter((f) => f.visibility === "obligatoire")
    .map((f) => f.def);
}

/**
 * Dépôt anonyme permis UNIQUEMENT si la démarche ne rend aucune identité
 * demandeur obligatoire : aucun public activé n'a de champ « obligatoire ».
 * Config absente/inconnue → aucune exigence explicite → permis.
 */
export function allowsAnonymous(rawConfig: unknown): boolean {
  const config = parseRequesterConfig(rawConfig);
  for (const audience of AUDIENCES) {
    const c = config[audience.key];
    if (!c.enabled) continue;
    if (Object.values(c.fields).some((v) => v === "obligatoire")) return false;
  }
  return true;
}

// ---- Soumission demandeur ---------------------------------------------------

/** Clés d'identité déclarée admises (celles du contrat + date de naissance). */
const DECLARED_EXTRA_KEYS = ["date_naissance"] as const;

export type RequesterSubmission =
  | { kind: "contact"; audience: Audience; socle_contact_id: string }
  | { kind: "sans_rapprochement"; audience: Audience; declared: Record<string, string> }
  | { kind: "anonyme" };

/** Ne conserve que les clés du contrat pour ce public, non vides, épurées. */
export function sanitizeDeclared(
  audience: Audience,
  declared: Record<string, unknown>,
): Record<string, string> {
  const allowed = new Set<string>([
    ...(AUDIENCES.find((a) => a.key === audience)?.fields.map((f) => f.key) ?? []),
    ...DECLARED_EXTRA_KEYS,
  ]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(declared)) {
    if (!allowed.has(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed !== "") out[key] = trimmed;
  }
  return out;
}

export function validateRequesterSubmission(
  rawConfig: unknown,
  submission: RequesterSubmission,
): { ok: true } | { ok: false; message: string } {
  const config = parseRequesterConfig(rawConfig);

  if (submission.kind === "anonyme") {
    if (!allowsAnonymous(rawConfig)) {
      return {
        ok: false,
        message: "Cette démarche rend une identité demandeur obligatoire — le dépôt anonyme n'est pas permis.",
      };
    }
    return { ok: true };
  }

  if (!selectableAudiences(config).includes(submission.audience)) {
    return { ok: false, message: "Public demandeur non proposé par cette démarche." };
  }

  if (submission.kind === "sans_rapprochement") {
    const declared = sanitizeDeclared(submission.audience, submission.declared);
    if (Object.keys(declared).length === 0) {
      return { ok: false, message: "Identité déclarée vide — renseignez le demandeur ou choisissez le dépôt anonyme." };
    }
    const missing = requiredRequesterFields(config, submission.audience)
      .filter((def) => !declared[def.key]);
    if (missing.length > 0) {
      return {
        ok: false,
        message: `Champs demandeur obligatoires manquants : ${missing.map((d) => d.label).join(", ")}.`,
      };
    }
  }

  return { ok: true };
}
