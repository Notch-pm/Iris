// Fiche d'instruction de la demande — logique pure (sans DOM ni réseau), testée.
// Tout ce qui se DÉDUIT des données de la demande (échéance, identité retenue
// au dépôt, réponses du formulaire étiquetées par le snapshot de démarche,
// étapes d'avancement, journal d'activité) vit ici ; les composants ne font
// qu'afficher. Rien ici ne protège quoi que ce soit : la garde SQL reste
// l'autorité sur les transitions et le RLS sur la visibilité.

import {
  parseLocationValue,
  dataKey,
  fieldIsVisible,
  flatFields,
  parseFormSchema,
  type FormSchema,
  type FormValues,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
import {
  ALL_DECLARED_KEYS,
  contactIdentitySnapshot,
  DECLARED_KEYS,
} from "@fn/_shared/identity/declared";
import { civilityLabel } from "@/features/contacts/usager";
import { displayFieldValue, formatIsoDate } from "../creation/model";
import { plainBody } from "./mentions";
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

// Le canal de réception est un TEXTE LIBRE du contrat d'ingestion (`context.channel`) :
// chaque émetteur y met ses propres codes. À ceux d'Iris s'ajoutent donc ceux de
// CLARA (`paper` = courrier papier scanné, `email`, `portal`, `manual` = saisi à la
// main par un agent — le vocabulaire de son `couriers.channel`) et celui du PORTAIL
// usagers (`portail`). Un code inconnu reste affiché tel quel, mais entre guillemets
// dans la phrase : « déposée via paper » mélangeait les langues sans le dire
// (DEM-2026-000053, 2026-09-19).
const CHANNEL_PHRASES: Record<string, string> = {
  guichet: "au guichet",
  courrier: "par courrier",
  paper: "par courrier",
  email: "par courriel",
  courriel: "par courriel",
  telephone: "par téléphone",
  web: "en ligne",
  en_ligne: "en ligne",
  portail: "sur le portail usagers",
  portal: "sur le portail usagers",
  manual: "par saisie d'un agent",
  api: "par une application partenaire",
};

const CHANNEL_LABELS: Record<string, string> = {
  guichet: "Guichet",
  courrier: "Courrier",
  paper: "Courrier",
  email: "Courriel",
  courriel: "Courriel",
  telephone: "Téléphone",
  web: "En ligne",
  en_ligne: "En ligne",
  portail: "Portail usagers",
  portal: "Portail usagers",
  manual: "Saisie par un agent",
  api: "Application partenaire",
};

export function channelLabel(channel: string | null): string | null {
  if (!channel) return null;
  return CHANNEL_LABELS[channel] ?? channel;
}

export interface SubtitleInput {
  /** `null` tant que l'identité n'est pas arrêtée : mieux vaut pas de nom du
   *  tout qu'un nom du dépôt remplacé sous les yeux par celui de la fiche. */
  requesterName: string | null;
  channel: string | null;
  source: string;
  receivedAt: string;
  dueAt: string | null;
}

// Noms d'affichage des sources d'ingestion connues (`source` = code de
// l'émetteur, registre `integration_sources`). Une source absente d'ici
// s'affiche entre guillemets.
const SOURCE_LABELS: Record<string, string> = {
  clara: "Clara",
  "portail-citoyen": "le portail usagers",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? `« ${source} »`;
}

/** « Marie Durand · déposée au guichet le 21 août 2026 · échéance le 28 août 2026 ».
 *  Une demande INGÉRÉE dit d'où elle vient : « reçue par courrier via Clara le … »
 *  (décision PO 2026-09-19) ; le portail ne se nomme qu'une fois (« reçue sur le
 *  portail usagers le … »). Sans nom (`requesterName: null`), le segment est absent. */
export function headerSubtitle(input: SubtitleInput): string {
  const received = formatDayMonth(input.receivedAt, true);
  const phrase = input.channel
    ? (CHANNEL_PHRASES[input.channel] ?? `via « ${input.channel} »`)
    : null;
  let deposit: string;
  if (input.source === "iris") {
    deposit = phrase ? `déposée ${phrase} le ${received}` : `déposée le ${received}`;
  } else if (!phrase) {
    deposit = `reçue de ${sourceLabel(input.source)} le ${received}`;
  } else if (phrase === CHANNEL_PHRASES.portail && input.source === "portail-citoyen") {
    deposit = `reçue ${phrase} le ${received}`;
  } else {
    deposit = `reçue ${phrase} via ${sourceLabel(input.source)} le ${received}`;
  }
  const parts = [input.requesterName, deposit].filter((p): p is string => Boolean(p));
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
  // Champs bruts — pour qui doit s'adresser à l'usager plutôt que l'afficher
  // (variables des modèles d'e-mail). Ils vivent ICI, et pas dans un résolveur
  // à part, parce que les cascades de clés (contacts-api, publics Iris,
  // synonymes partenaires) n'ont qu'un seul endroit légitime : les recopier
  // ailleurs ferait deux vérités qui divergeraient au premier format partenaire.
  /** Libellé français : « Madame », « Monsieur », ou la valeur telle quelle. */
  civility: string | null;
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  /** Adresse recomposée : libre, ou lignes + code postal + ville. */
  address: string | null;
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

/**
 * Clés interprétées ici (contacts-api Socle, publics Iris, synonymes
 * partenaires) : la table vit dans `@fn/_shared/identity/declared`, partagée
 * avec l'ingestion qui, elle, ÉCRIT ces identités dans le Socle. Deux listes
 * divergeraient au premier format partenaire un peu exotique.
 * `anonymous` s'y ajoute : c'est un marqueur, pas un champ d'identité.
 */
const KNOWN_IDENTITY_KEYS = new Set<string>(["anonymous", ...ALL_DECLARED_KEYS]);

/**
 * Le « nom » d'un écran fusionne deux champs que contacts-api distingue : le
 * nom d'USAGE l'emporte sur le nom de naissance — c'est celui sous lequel la
 * personne se présente.
 */
const DISPLAY_LAST_NAME_KEYS = [...DECLARED_KEYS.usageName, ...DECLARED_KEYS.lastName];

const ANONYMOUS_IDENTITY: RequesterIdentity = {
  anonymous: true,
  known: false,
  name: "Dépôt anonyme",
  initials: "?",
  subtitle: "Aucune identité — assumé par l'agent au dépôt",
  rows: [],
  email: null,
  phone: null,
  civility: null,
  firstName: null,
  lastName: null,
  legalName: null,
  address: null,
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

  // `civility` / `civilite` figuraient dans KNOWN_IDENTITY_KEYS — donc exclues
  // des lignes « clés inconnues » — sans qu'aucun pick() ne les lise : la
  // civilité se perdait entre les deux règles.
  const civility = pick(...DECLARED_KEYS.civility);
  const display = pick(...DECLARED_KEYS.displayName);
  const first = pick(...DECLARED_KEYS.firstName);
  const last = pick(...DISPLAY_LAST_NAME_KEYS);
  const legal = pick(...DECLARED_KEYS.legalName);
  const birth = pick(...DECLARED_KEYS.birthDate);
  const siret = pick(...DECLARED_KEYS.siret);
  const email = pick(...DECLARED_KEYS.email);
  const mobile = pick(...DECLARED_KEYS.mobilePhone);
  const landline = pick(...DECLARED_KEYS.landlinePhone);
  const freeAddress = pick(...DECLARED_KEYS.addressFree);
  const line1 = pick(...DECLARED_KEYS.addressLine1);
  const line2 = pick(...DECLARED_KEYS.addressLine2);
  const postal = pick(...DECLARED_KEYS.postalCode);
  const city = pick(...DECLARED_KEYS.city);

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
  subtitleParts.push(identityStatus === "rapprochee" ? "Usager rapproché du Référentiel" : "Identité déclarée, sans rapprochement");

  return {
    anonymous: false,
    known,
    name: resolvedName,
    initials: initials(resolvedName),
    subtitle: subtitleParts.join(" · "),
    rows,
    email,
    phone,
    civility: civility ? civilityLabel(civility) : null,
    firstName: first,
    lastName: last,
    legalName: legal,
    address,
  };
}

// ---- Identité vivante (fiche Socle relue) -----------------------------------

/** Un champ d'identité qui a bougé entre le dépôt et la fiche Socle d'aujourd'hui. */
export interface IdentityChange {
  label: string;
  /** Valeur retenue au dépôt — `null` si le champ n'était pas renseigné. */
  before: string | null;
  /** Valeur actuelle dans le Socle — `null` si le champ a été vidé depuis. */
  after: string | null;
}

export interface RequesterView {
  /** Identité À AFFICHER : la fiche Socle d'aujourd'hui si elle a pu être relue. */
  identity: RequesterIdentity;
  /** Identité RETENUE AU DÉPÔT, jamais réécrite — la pièce administrative. */
  deposited: RequesterIdentity;
  /** La fiche Socle a bien été relue (sinon on n'affiche que le dépôt). */
  live: boolean;
  /** Écarts entre le dépôt et la fiche du jour, vide s'ils coïncident. */
  changes: IdentityChange[];
}

/**
 * Compare deux identités déjà normalisées, champ visible par champ visible :
 * le nom, puis les lignes (`rows`), qui portent aussi bien les clés connues
 * (adresse, courriel, téléphone, SIRET) que les clés inconnues d'un partenaire.
 * Un champ apparu depuis le dépôt a `before: null` ; un champ vidé, `after: null`.
 */
function identityChanges(before: RequesterIdentity, after: RequesterIdentity): IdentityChange[] {
  const changes: IdentityChange[] = [];
  if (before.name !== after.name) {
    changes.push({
      label: "Nom",
      before: before.known ? before.name : null,
      after: after.known ? after.name : null,
    });
  }
  const bRows = new Map(before.rows.map((r) => [r.label, r.value]));
  const aRows = new Map(after.rows.map((r) => [r.label, r.value]));
  // Ordre : les lignes du dépôt d'abord, puis celles qui n'existaient pas.
  const labels = Array.from(new Set([...bRows.keys(), ...aRows.keys()]));
  for (const label of labels) {
    const b = bRows.get(label) ?? null;
    const a = aRows.get(label) ?? null;
    if (b !== a) changes.push({ label, before: b, after: a });
  }
  return changes;
}

/**
 * Ce que la fiche montre de l'usager. Le `requester_snapshot` est IMMUABLE —
 * il fige l'identité retenue au dépôt et ne se complète jamais après coup —
 * mais il n'est pas pour autant ce qu'un agent doit lire un mois plus tard :
 * l'usager a pu corriger son courriel ou déménager dans le Socle, qui reste la
 * source de vérité. On affiche donc la fiche RELUE quand elle est disponible,
 * en conservant le dépôt à côté (et l'écart entre les deux, qui est lui-même
 * une information : ce n'est pas cette adresse-là qui figurait au dossier).
 *
 * `liveContact` est la réponse de `socle-proxy /v1/contacts/get`, relue sans
 * rétention par l'écran. Absente — usager non rapproché, dépôt anonyme, Socle
 * injoignable, ou lecteur sans droit de création (garde du proxy) — on retombe
 * simplement sur le dépôt : aucune erreur, aucun trou.
 */
export function requesterView(
  snapshot: unknown,
  identityStatus: string,
  liveContact: unknown,
): RequesterView {
  const deposited = requesterIdentity(snapshot, identityStatus);
  const declared = deposited.anonymous ? null : contactIdentitySnapshot(liveContact);
  // Whitelist vide = fiche Socle sans aucun champ d'identité lisible : afficher
  // « Identité déclarée » à la place du nom du dépôt serait une régression.
  if (!declared || Object.keys(declared).length === 0) {
    return { identity: deposited, deposited, live: false, changes: [] };
  }
  const identity = requesterIdentity({ declared }, "rapprochee");
  return { identity, deposited, live: true, changes: identityChanges(deposited, identity) };
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
  // Un lieu d'intervention que le schéma n'annonce pas (snapshot dégradé ou
  // périmé) reste une ADRESSE : l'agent doit la lire, pas déchiffrer du JSON.
  const lieu = parseLocationValue(value);
  if (lieu) return lieu.address;
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

/**
 * PREMIER passage au statut « En cours d'instruction », d'après le journal —
 * la « date de prise en charge » que promet le catalogue de variables des
 * modèles d'e-mail.
 *
 * ⚠️ `buildStages()` fait un calcul voisin qui ne peut PAS servir ici : son
 * `visited.set` écrase, donc après une réouverture il retient le DERNIER
 * passage. C'est juste pour « depuis le … » (l'étape en cours) et faux pour
 * « prise en charge le … » (le fait daté). Deux besoins, deux fonctions.
 */
export function firstInstructionAt(events: StageEvent[]): string | null {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of sorted) {
    if (!isRecord(event.payload)) continue;
    const reached =
      (event.event_type === "status_changed" && event.payload.to === "en_instruction") ||
      (event.event_type === "created" && event.payload.status === "en_instruction");
    if (reached) return event.created_at;
  }
  return null;
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
  /**
   * Libellé d'un motif de non-conformité (`piece_qualifiee`). INJECTÉ, comme
   * `nameOf` : le catalogue vit dans `conformite.ts`, qui lit déjà d'ici
   * (`formSchemaFrom`) — l'importer en retour ferait un cycle. Absent, le code
   * brut du motif s'affiche, ce qui reste lisible.
   */
  motifLabel?: (code: string) => string | null;
}

function statusLabel(value: unknown): string {
  return typeof value === "string" ? STATUS_LABELS[value as RequestStatus] ?? value : "—";
}

/** « 12/03/2026 » depuis un jour `AAAA-MM-JJ` du payload ; vide si absent ou illisible. */
function dayLabel(value: unknown): string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function describeEvent(
  event: ActivityEvent,
  nameOf: ActivityInput["nameOf"],
  motifLabel: ActivityInput["motifLabel"],
): { label: string; detail: string } {
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
        label: "Fondée sur une démarche du Référentiel",
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
    case "transferred": {
      const from = typeof p.from_label === "string" ? p.from_label : null;
      const to = typeof p.to_label === "string" ? p.to_label : null;
      const lost = p.unassigned === true;
      return {
        label: "Demande transférée",
        detail: `${from ? `${from} → ` : ""}${to ?? "organisme inconnu"} · par ${who}`
          + (lost ? " · affectation retirée" : ""),
      };
    }
    case "piece_qualifiee": {
      const conforme = p.compliance === "conforme";
      const name = typeof p.file_name === "string" ? p.file_name : "Pièce";
      const code = typeof p.motif === "string" ? p.motif : null;
      const motif = code ? motifLabel?.(code) ?? code : null;
      return {
        label: conforme ? "Pièce déclarée conforme" : "Pièce déclarée non conforme",
        detail: `${name} · ${who}${motif ? ` · ${motif}` : ""}`,
      };
    }
    case "piece_ajoutee": {
      const name = typeof p.file_name === "string" ? p.file_name : "Pièce";
      const n = typeof p.remplacees === "number" ? p.remplacees : 0;
      return {
        label: n > 0 ? "Pièce remplacée" : "Pièce ajoutée",
        detail: `${name} · ${who}${n > 0 ? ` · ${n} pièce${n > 1 ? "s" : ""} remplacée${n > 1 ? "s" : ""}` : ""}`,
      };
    }
    case "form_data_updated": {
      const n = typeof p.count === "number" ? p.count : 0;
      return {
        label: "Réponses du formulaire modifiées",
        detail: `${who}${n > 0 ? ` · ${n} réponse${n > 1 ? "s" : ""}` : ""}`,
      };
    }
    case "intervention_requested": {
      const name = typeof p.intervenant_name === "string" && p.intervenant_name !== ""
        ? p.intervenant_name : nameOf(typeof p.intervenant === "string" ? p.intervenant : null);
      const day = dayLabel(p.requested_for);
      return {
        label: "Intervenant sollicité",
        detail: `${name} · par ${who}${day ? ` · souhaitée le ${day}` : ""}`,
      };
    }
    case "intervention_completed": {
      const name = typeof p.intervenant_name === "string" && p.intervenant_name !== ""
        ? p.intervenant_name : who;
      const day = dayLabel(p.completed_on);
      const n = typeof p.attachments === "number" ? p.attachments : 0;
      return {
        label: "Intervention réalisée",
        detail: `${name}${day ? ` · le ${day}` : ""}${n > 0 ? ` · ${n} justificatif${n > 1 ? "s" : ""}` : ""}`,
      };
    }
    default:
      return { label: humanizeKey(event.event_type), detail: who };
  }
}

/** Journal fusionné (événements immuables + notes internes), du plus récent au plus ancien. */
export function activityItems(input: ActivityInput): ActivityItem[] {
  const items: ActivityItem[] = input.events.map((event) => {
    const { label, detail } = describeEvent(event, input.nameOf, input.motifLabel);
    return { id: `evt-${event.id}`, label, detail, at: event.created_at };
  });
  for (const note of input.notes) {
    items.push({
      id: `note-${note.id}`,
      label: "Note interne ajoutée",
      // Le corps privé de ses jetons de mention : « @Nom » (ou « @adresse »
      // pour un compte sans nom), jamais `@[…](uuid)` (constaté le 2026-09-19).
      detail: `${input.nameOf(note.author_id)} · ${excerpt(plainBody(note.body))}`,
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

export interface OriginResource {
  reference: string;
  source: string;
  url: string | null;
}

/**
 * La « ressource d'origine » d'une demande ingérée : `external_ref` (l'identifiant chez
 * l'émetteur, clé d'idempotence — pour Clara, le ticket d'ACTION, pas le courrier) et
 * `external_url`. Elle n'est montrée que si aucun lien externe ne mène déjà au même
 * endroit : Clara envoie `external_id` = action ET `links = [courrier]` avec le MÊME
 * permalien, et l'agent voyait deux lignes pour un seul courrier (2026-09-19). Sans lien
 * doublon — partenaire qui ne déclare que son identifiant —, la ligne reste : c'est alors
 * la seule trace de l'origine.
 */
export function originResource(
  request: { external_ref: string | null; external_url: string | null; source: string },
  links: readonly { target_request_id: string | null; external_id: string | null; external_url: string | null }[],
): OriginResource | null {
  if (!request.external_ref) return null;
  const covered = links.some((l) => {
    if (l.target_request_id) return false;
    if (request.external_url && l.external_url) return l.external_url === request.external_url;
    return l.external_id === request.external_ref;
  });
  if (covered) return null;
  return { reference: request.external_ref, source: request.source, url: request.external_url };
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
