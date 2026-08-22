// Fiche d'instruction de la demande — logique pure (sans DOM ni réseau), testée.
// Tout ce qui se DÉDUIT des données de la demande (échéance, identité retenue
// au dépôt, réponses du formulaire étiquetées par le snapshot de démarche,
// étapes d'avancement, journal d'activité) vit ici ; les composants ne font
// qu'afficher. Rien ici ne protège quoi que ce soit : la garde SQL reste
// l'autorité sur les transitions et le RLS sur la visibilité.

import {
  dataKey,
  fieldIsVisible,
  flatFields,
  parseFormSchema,
  type FormSchema,
  type FormValues,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import { displayFieldValue, formatIsoDate } from "../creation/model";
import {
  MOTIF_LABELS,
  STATUS_LABELS,
  type ClosureMotif,
  type RequestStatus,
  type TransitionSpec,
} from "../statuts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- Dates ------------------------------------------------------------------

function asDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 21 août » ou « 21 août 2026 ». */
export function formatDayMonth(iso: string, withYear = false): string {
  const d = asDate(iso);
  if (!d) return "date inconnue";
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** « 22 août 2026, 09:28 » (journal d'activité). */
export function formatTimeline(iso: string): string {
  const d = asDate(iso);
  if (!d) return "date inconnue";
  const day = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** « 22/08/2026 09:28 » (formats compacts). */
export function formatDateTime(iso: string): string {
  const d = asDate(iso);
  if (!d) return "date inconnue";
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export type DueTone = "late" | "soon" | "normal";

export interface DueView {
  label: string;
  tone: DueTone;
  /** Jours calendaires restants (négatif = en retard). */
  days: number;
}

/** Pastille d'échéance de l'en-tête — null sans `due_at`. */
export function dueView(dueAt: string | null, now: Date): DueView | null {
  const due = asDate(dueAt);
  if (!due) return null;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days < 0) {
    const late = -days;
    return { label: `En retard de ${late} jour${late > 1 ? "s" : ""}`, tone: "late", days };
  }
  if (days === 0) return { label: "Échéance aujourd'hui", tone: "soon", days };
  if (days === 1) return { label: "Échéance demain", tone: "soon", days };
  return { label: `Échéance dans ${days} jours`, tone: days <= 3 ? "soon" : "normal", days };
}

// ---- Canal de dépôt et sous-titre ------------------------------------------

const CHANNEL_PHRASES: Record<string, string> = {
  guichet: "au guichet",
  courrier: "par courrier",
  email: "par courriel",
  courriel: "par courriel",
  telephone: "par téléphone",
  web: "en ligne",
  en_ligne: "en ligne",
  api: "par une application partenaire",
};

const CHANNEL_LABELS: Record<string, string> = {
  guichet: "Guichet",
  courrier: "Courrier",
  email: "Courriel",
  courriel: "Courriel",
  telephone: "Téléphone",
  web: "En ligne",
  en_ligne: "En ligne",
  api: "Application partenaire",
};

export function channelLabel(channel: string | null): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel] ?? channel;
}

export interface SubtitleInput {
  requesterName: string;
  channel: string | null;
  source: string;
  receivedAt: string;
  dueAt: string | null;
}

/** « Marie Durand · déposée au guichet le 21 août 2026 · échéance le 28 août 2026 ». */
export function headerSubtitle(input: SubtitleInput): string {
  const received = formatDayMonth(input.receivedAt, true);
  let deposit: string;
  if (input.channel) {
    const phrase = CHANNEL_PHRASES[input.channel] ?? `via ${input.channel}`;
    deposit = `déposée ${phrase} le ${received}`;
  } else if (input.source !== "iris") {
    deposit = `reçue de ${input.source} le ${received}`;
  } else {
    deposit = `déposée le ${received}`;
  }
  const parts = [input.requesterName, deposit];
  if (input.dueAt && asDate(input.dueAt)) parts.push(`échéance le ${formatDayMonth(input.dueAt, true)}`);
  return parts.join(" · ");
}

// ---- Identité retenue au dépôt (requester_snapshot) -------------------------

export interface IdentityRow {
  label: string;
  value: string;
}

export interface RequesterIdentity {
  anonymous: boolean;
  /** Au moins un nom a pu être déduit du snapshot. */
  known: boolean;
  name: string;
  initials: string;
  subtitle: string | null;
  rows: IdentityRow[];
  email: string | null;
  phone: string | null;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return letters === "" ? "?" : letters;
}

export function humanizeKey(key: string): string {
  const text = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return text === "" ? key : text[0]!.toUpperCase() + text.slice(1);
}

/** Clés interprétées par `requesterIdentity` (contacts-api Socle, publics Iris, synonymes partenaires). */
const KNOWN_IDENTITY_KEYS = new Set([
  "anonymous", "civility", "civilite",
  "display_name", "name", "full_name",
  "first_name", "prenoms", "prenom", "firstName",
  "usage_name", "last_name", "nom_usuel", "nom_naissance", "nom", "lastName",
  "legal_name", "raison_sociale", "birth_date", "date_naissance", "siret",
  "email", "courriel", "mail",
  "mobile_phone", "tel_portable", "phone", "telephone", "mobile", "landline_phone", "tel_fixe",
  "adresse", "address", "address_line1", "address_line2", "postal_code", "city",
]);

const ANONYMOUS_IDENTITY: RequesterIdentity = {
  anonymous: true,
  known: false,
  name: "Dépôt anonyme",
  initials: "?",
  subtitle: "Aucune identité — assumé par l'agent au dépôt",
  rows: [],
  email: null,
  phone: null,
};

/**
 * Normalise l'identité figée au dépôt, quelle que soit son origine : fiche
 * Socle relue (clés contacts-api), identité déclarée au guichet (clés des
 * publics Iris) ou payload libre d'un partenaire (clés inconnues conservées en
 * lignes supplémentaires — jamais perdues, jamais interprétées).
 */
export function requesterIdentity(
  snapshot: unknown,
  identityStatus: string,
): RequesterIdentity {
  const declared = isRecord(snapshot) && isRecord(snapshot.declared) ? snapshot.declared : {};
  if (identityStatus === "anonyme" || declared.anonymous === true) return ANONYMOUS_IDENTITY;

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = declared[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };

  const display = pick("display_name", "name", "full_name");
  const first = pick("first_name", "prenoms", "prenom", "firstName");
  const last = pick("usage_name", "last_name", "nom_usuel", "nom_naissance", "nom", "lastName");
  const legal = pick("legal_name", "raison_sociale");
  const birth = pick("birth_date", "date_naissance");
  const siret = pick("siret");
  const email = pick("email", "courriel", "mail");
  const mobile = pick("mobile_phone", "tel_portable", "phone", "telephone", "mobile");
  const landline = pick("landline_phone", "tel_fixe");
  const freeAddress = pick("adresse", "address");
  const line1 = pick("address_line1");
  const line2 = pick("address_line2");
  const postal = pick("postal_code");
  const city = pick("city");

  const composed = [first, last].filter(Boolean).join(" ");
  const name = display ?? (composed !== "" ? composed : null);
  const resolvedName = name ?? legal ?? "Identité déclarée";
  const known = Boolean(name || legal);

  const phone = [mobile, landline].filter(Boolean).join(" · ") || null;
  const address = freeAddress
    ?? ([line1, line2, [postal, city].filter(Boolean).join(" ")].filter((p) => p && p !== "").join(", ") || null);

  const rows: IdentityRow[] = [];
  if (legal && name) rows.push({ label: "Raison sociale", value: legal });
  if (address) rows.push({ label: "Adresse", value: address });
  if (email) rows.push({ label: "Courriel", value: email });
  if (phone) rows.push({ label: "Téléphone", value: phone });
  if (siret) rows.push({ label: "SIRET", value: siret });
  // Clés inconnues (payload partenaire) : affichées en clair, jamais perdues.
  for (const [key, value] of Object.entries(declared)) {
    if (KNOWN_IDENTITY_KEYS.has(key)) continue;
    if (typeof value === "string" && value.trim() !== "") rows.push({ label: humanizeKey(key), value: value.trim() });
    else if (typeof value === "number" || typeof value === "boolean") rows.push({ label: humanizeKey(key), value: String(value) });
  }

  const subtitleParts: string[] = [];
  if (birth) subtitleParts.push(`Né(e) le ${formatIsoDate(birth)}`);
  subtitleParts.push(identityStatus === "rapprochee" ? "Usager Socle rapproché" : "Identité déclarée, sans rapprochement");

  return {
    anonymous: false,
    known,
    name: resolvedName,
    initials: initials(resolvedName),
    subtitle: subtitleParts.join(" · "),
    rows,
    email,
    phone,
  };
}

// ---- Réponses du formulaire (form_data étiqueté par procedure_snapshot) -----

export function formSchemaFrom(procedureSnapshot: unknown): FormSchema | null {
  if (!isRecord(procedureSnapshot) || !isRecord(procedureSnapshot.form_schema)) return null;
  return parseFormSchema(procedureSnapshot.form_schema);
}

export function formSchemaVersion(procedureSnapshot: unknown): number | null {
  if (!isRecord(procedureSnapshot) || !isRecord(procedureSnapshot.form_schema)) return null;
  const v = procedureSnapshot.form_schema.version;
  return typeof v === "number" ? v : null;
}

export interface AnswerRow {
  key: string;
  label: string;
  value: string;
  /** Texte long : occupe toute la largeur de la grille. */
  full: boolean;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).filter((v) => v !== "").join(", ");
  return JSON.stringify(value);
}

/**
 * Réponses lisibles : champs du snapshot (libellés, options, conditions de
 * visibilité rejouées sur les valeurs stockées), puis les clés de `form_data`
 * que le schéma ne connaît pas (payloads partenaires) en clair.
 */
export function formAnswers(procedureSnapshot: unknown, formData: unknown): AnswerRow[] {
  const data = isRecord(formData) ? formData : {};
  const rows: AnswerRow[] = [];
  const consumed = new Set<string>();
  const schema = formSchemaFrom(procedureSnapshot);
  if (schema) {
    const entries = flatFields(schema);
    const byId: FormValues = {};
    for (const entry of entries) byId[entry.field.id] = data[dataKey(entry.field)];
    for (const entry of entries) {
      const key = dataKey(entry.field);
      consumed.add(key);
      if (entry.field.type === "attachment") continue;
      if (!fieldIsVisible(entry, byId)) continue;
      const text = displayFieldValue(entry.field, data[key]);
      rows.push({
        key,
        label: entry.field.label,
        value: text === "" ? "—" : text,
        full: entry.field.type === "textarea",
      });
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (consumed.has(key)) continue;
    const text = stringifyValue(value);
    if (text === "") continue;
    rows.push({ key, label: humanizeKey(key), value: text, full: text.length > 80 });
  }
  return rows;
}

/** Libellé des champs « pièce » du snapshot, par clé de rattachement (`form_field_key`). */
export function attachmentFieldLabels(procedureSnapshot: unknown): Record<string, string> {
  const schema = formSchemaFrom(procedureSnapshot);
  const out: Record<string, string> = {};
  if (!schema) return out;
  for (const entry of flatFields(schema)) {
    if (entry.field.type === "attachment") out[dataKey(entry.field)] = entry.field.label;
  }
  return out;
}

// ---- Avancement (étapes du cycle de vie) -----------------------------------

export type StageKey = "a_traiter" | "en_instruction" | "en_attente" | "cloturee" | "archivee";
export type StageState = "done" | "current" | "todo" | "skipped";

export interface StageView {
  key: StageKey;
  label: string;
  hint: string;
  state: StageState;
}

export interface StageEvent {
  event_type: string;
  payload: unknown;
  created_at: string;
}

const STAGE_DEFS: { key: StageKey; label: string; todo: string; skipped: string }[] = [
  { key: "a_traiter", label: "À traiter", todo: "à qualifier", skipped: "étape non passée" },
  { key: "en_instruction", label: "En cours d'instruction", todo: "prise en charge par un agent", skipped: "étape non passée" },
  { key: "en_attente", label: "En attente d'information", todo: "pièce ou précision demandée à l'usager", skipped: "sans mise en attente" },
  { key: "cloturee", label: "Clôturée", todo: "résolue ou annulée", skipped: "étape non passée" },
  { key: "archivee", label: "Archivée", todo: "par un administrateur", skipped: "étape non passée" },
];

export function stageOf(status: RequestStatus): StageKey {
  switch (status) {
    case "a_traiter":
    case "en_instruction":
    case "en_attente":
    case "archivee":
      return status;
    default:
      return "cloturee";
  }
}

export interface StagesInput {
  status: RequestStatus;
  closureMotif: string | null;
  createdAt: string;
  events: StageEvent[];
}

/**
 * Parcours linéaire de la demande : étapes passées (datées d'après le
 * journal), étape courante, étapes sautées (ex. jamais mise en attente) et
 * étapes à venir. Lecture seule — les transitions passent par les actions.
 */
export function buildStages(input: StagesInput): StageView[] {
  const visited = new Map<StageKey, string>();
  visited.set("a_traiter", input.createdAt);
  const sorted = [...input.events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of sorted) {
    const payload = isRecord(event.payload) ? event.payload : {};
    if (event.event_type === "created" && typeof payload.status === "string") {
      visited.set(stageOf(payload.status as RequestStatus), event.created_at);
    }
    if (event.event_type === "status_changed" && typeof payload.to === "string") {
      visited.set(stageOf(payload.to as RequestStatus), event.created_at);
    }
  }
  const currentKey = stageOf(input.status);
  const currentIdx = STAGE_DEFS.findIndex((s) => s.key === currentKey);
  const since = visited.get(currentKey) ?? input.createdAt;
  const motif = input.closureMotif ? MOTIF_LABELS[input.closureMotif as ClosureMotif] ?? input.closureMotif : null;

  return STAGE_DEFS.map((def, idx) => {
    if (idx === currentIdx) {
      const hint = def.key === "cloturee"
        ? `${STATUS_LABELS[input.status]}${motif ? ` — ${motif}` : ""}, le ${formatDayMonth(since)}`
        : `depuis le ${formatDayMonth(since)}`;
      return { key: def.key, label: def.label, hint, state: "current" };
    }
    if (idx < currentIdx) {
      const date = visited.get(def.key);
      if (!date) return { key: def.key, label: def.label, hint: def.skipped, state: "skipped" };
      return { key: def.key, label: def.label, hint: `le ${formatDayMonth(date)}`, state: "done" };
    }
    return { key: def.key, label: def.label, hint: def.todo, state: "todo" };
  });
}

// ---- Transitions : action principale vs menu -------------------------------

const PRIMARY_TARGET: Partial<Record<RequestStatus, RequestStatus>> = {
  a_traiter: "en_instruction",
  en_instruction: "resolue_positive",
  en_attente: "en_instruction",
  annulee: "archivee",
  resolue_positive: "archivee",
  resolue_negative: "archivee",
};

export interface TransitionSplit {
  primary: TransitionSpec | null;
  secondary: TransitionSpec[];
}

/** Le bouton principal porte la transition « vers l'avant » ; le reste va dans le menu. */
export function splitTransitions(status: RequestStatus, specs: TransitionSpec[]): TransitionSplit {
  const target = PRIMARY_TARGET[status];
  const primary = target ? specs.find((s) => s.to === target) ?? null : null;
  return { primary, secondary: specs.filter((s) => s !== primary) };
}

// ---- Journal d'activité -----------------------------------------------------

export interface ActivityEvent {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
  created_by: string | null;
}

export interface ActivityNote {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  label: string;
  detail: string;
  at: string;
}

export function excerpt(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface ActivityInput {
  events: ActivityEvent[];
  notes: ActivityNote[];
  nameOf: (userId: string | null) => string;
}

function statusLabel(value: unknown): string {
  return typeof value === "string" ? STATUS_LABELS[value as RequestStatus] ?? value : "—";
}

function describeEvent(event: ActivityEvent, nameOf: ActivityInput["nameOf"]): { label: string; detail: string } {
  const p = isRecord(event.payload) ? event.payload : {};
  const who = nameOf(event.created_by);
  switch (event.event_type) {
    case "created": {
      const source = typeof p.source === "string" ? p.source : "iris";
      return {
        label: "Demande créée",
        detail: source === "iris" ? `${who} · saisie dans Iris` : `Ingérée depuis ${source} · ${who}`,
      };
    }
    case "request_created_from_procedure": {
      const n = typeof p.attachments === "number" ? p.attachments : 0;
      return {
        label: "Fondée sur une démarche Socle",
        detail: `${n === 0 ? "sans pièce jointe" : `${n} pièce${n > 1 ? "s" : ""} jointe${n > 1 ? "s" : ""}`} · ${who}`,
      };
    }
    case "status_changed": {
      const motif = typeof p.motif === "string" ? MOTIF_LABELS[p.motif as ClosureMotif] ?? p.motif : null;
      return {
        label: `Passage à « ${statusLabel(p.to)} »`,
        detail: `${who} · depuis « ${statusLabel(p.from)} »${motif ? ` · motif : ${motif}` : ""}`,
      };
    }
    case "assigned": {
      const from = typeof p.from === "string" ? p.from : null;
      const to = typeof p.to === "string" ? p.to : null;
      if (!to) return { label: "Demande désaffectée", detail: `${nameOf(from)} · par ${who}` };
      return {
        label: "Demande affectée",
        detail: `${from ? `${nameOf(from)} → ` : ""}${nameOf(to)} · par ${who}`,
      };
    }
    default:
      return { label: humanizeKey(event.event_type), detail: who };
  }
}

/** Journal fusionné (événements immuables + notes internes), du plus récent au plus ancien. */
export function activityItems(input: ActivityInput): ActivityItem[] {
  const items: ActivityItem[] = input.events.map((event) => {
    const { label, detail } = describeEvent(event, input.nameOf);
    return { id: `evt-${event.id}`, label, detail, at: event.created_at };
  });
  for (const note of input.notes) {
    items.push({
      id: `note-${note.id}`,
      label: "Note interne ajoutée",
      detail: `${input.nameOf(note.author_id)} · ${excerpt(note.body)}`,
      at: note.created_at,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

// ---- Divers (membres, pièces, liens, priorités) -----------------------------

export function memberName(
  members: { userId: string; displayName: string }[],
  userId: string | null,
): string {
  if (!userId) return "Système / intégration";
  return members.find((m) => m.userId === userId)?.displayName ?? "Utilisateur";
}

/** Vignette d'extension : « PDF », « PNG », « DOCX »… */
export function attachmentExt(fileName: string, mimeType: string | null): string {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot + 1).toUpperCase();
    if (ext.length <= 4) return ext;
  }
  if (mimeType && mimeType.includes("/")) {
    const sub = mimeType.split("/")[1]!.replace(/^x-/, "").toUpperCase();
    if (sub.length <= 4) return sub;
  }
  return "DOC";
}

export function formatBytes(size: number | null): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

export const COPY_STATUS: Record<string, { label: string; tone: "ok" | "pending" | "error" }> = {
  copied: { label: "Disponible", tone: "ok" },
  pending: { label: "Copie en attente", tone: "pending" },
  error: { label: "Erreur de copie", tone: "error" },
};

const LINK_REASONS: Record<string, string> = {
  liee_a: "liée par un agent",
  doublon: "doublon",
  doublon_de: "doublon",
  externe: "référence externe",
};

export function linkReason(link: { link_type: string; external_type: string | null }): string {
  if (link.link_type === "externe" && link.external_type) return `référence ${link.external_type}`;
  return LINK_REASONS[link.link_type] ?? humanizeKey(link.link_type).toLowerCase();
}

export type PriorityTone = "muted" | "warn" | "danger";

export interface PriorityOption {
  key: string;
  label: string;
  hint: string;
  tone: PriorityTone;
}

export const PRIORITY_OPTIONS: PriorityOption[] = [
  { key: "basse", label: "Basse", hint: "Sans urgence particulière — traitée après les autres.", tone: "muted" },
  { key: "normale", label: "Normale", hint: "Traitement au fil de l'eau, dans l'ordre d'arrivée.", tone: "muted" },
  { key: "haute", label: "Haute", hint: "Remontée en tête de file du service.", tone: "warn" },
  { key: "urgente", label: "Urgente", hint: "Traitement prioritaire immédiat.", tone: "danger" },
];

export function priorityOption(key: string): PriorityOption {
  return PRIORITY_OPTIONS.find((p) => p.key === key) ?? { key, label: humanizeKey(key), hint: "", tone: "muted" };
}
