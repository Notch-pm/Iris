// Qualification des pièces justificatives — LOGIQUE PURE (sans DOM ni réseau),
// testée. L'agent déclare une pièce CONFORME ou NON CONFORME ; tant qu'une
// pièce obligatoire n'est pas conforme, la demande ne peut pas être résolue
// positivement.
//
// ⚠️ JUMEAU SQL. Ce module reflète, il ne protège rien. La vérité vit dans :
//   . `public.request_piece_requirements(request_id)` — même déduction
//     (visibleIf de la section ET du champ, puis `required` OU `requiredIf`) ;
//   . `public.requests_guard_write()` — le refus de `resolue_positive` ;
//   . `public.qualify_request_attachment(...)` — l'unique porte d'écriture.
// Toute évolution de la règle se répercute ICI, dans la migration, et dans
// `conformite.test.ts` + `supabase/tests/qualification-pieces.test.sql`.
//
// POURQUOI PAR EXIGENCE ET PAS PAR FICHIER : la qualification s'écrit ligne à
// ligne dans `request_attachments` (un fichier = un verdict), mais elle se LIT
// par exigence du formulaire — « le justificatif de domicile est-il en règle ? »
// et non « ce PDF-là est-il en règle ? ». Un champ « pièce » qui accepte
// plusieurs fichiers n'est satisfait que si TOUS le sont, et le motif « la pièce
// est incomplète » ne veut rien dire autrement. Une exigence obligatoire sans
// aucun fichier (dépôt partenaire dégradé) est `manquante` : elle bloque, sans
// qu'il existe la moindre ligne à qualifier.

import {
  attachmentIsRequired,
  dataKey,
  fieldIsVisible,
  flatFields,
  type FormValues,
} from "@fn/create-request-from-procedure/_shared/procedureForm";
// La formule d'adresse est PARTAGÉE avec l'avis de clôture, composé côté
// serveur : deux courriels d'Iris ne doivent pas saluer différemment.
import { quotedSubject, salutation, type Recipient } from "@fn/_shared/email/adresse";
import { formSchemaFrom } from "./instruction";

// ---- Motifs de non-conformité (catalogue FERMÉ, jumeau du check SQL) --------

export type NonConformityMotif =
  | "nom_inattendu"
  | "illisible"
  | "format_non_pris_en_charge"
  | "incomplete"
  | "non_a_jour";

export interface MotifSpec {
  value: NonConformityMotif;
  /** Libellé d'écran (menu, pastille). */
  label: string;
  /** Forme de phrase, minuscule initiale : le corps de l'e-mail l'enchâsse. */
  phrase: string;
}

export const NONCONFORMITY_MOTIFS: MotifSpec[] = [
  {
    value: "nom_inattendu",
    label: "La pièce n'est pas au nom attendu",
    phrase: "la pièce n'est pas au nom attendu",
  },
  {
    value: "illisible",
    label: "Le document n'est pas lisible",
    phrase: "le document n'est pas lisible",
  },
  {
    value: "format_non_pris_en_charge",
    label: "Le fichier est dans un format non pris en charge ou est corrompu",
    phrase: "le fichier est dans un format non pris en charge ou est corrompu",
  },
  {
    value: "incomplete",
    label: "La pièce est incomplète",
    phrase: "la pièce est incomplète",
  },
  {
    value: "non_a_jour",
    label: "La pièce n'est pas à jour",
    phrase: "la pièce n'est pas à jour",
  },
];

const MOTIF_BY_VALUE = new Map(NONCONFORMITY_MOTIFS.map((m) => [m.value, m]));

export function isKnownMotif(value: string): value is NonConformityMotif {
  return MOTIF_BY_VALUE.has(value as NonConformityMotif);
}

export function motifLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return MOTIF_BY_VALUE.get(value as NonConformityMotif)?.label ?? value;
}

export function motifPhrase(value: string | null | undefined): string | null {
  if (!value) return null;
  return MOTIF_BY_VALUE.get(value as NonConformityMotif)?.phrase ?? value;
}

/** Longueur maximale de la précision libre — jumeau du check SQL. */
export const MAX_COMPLIANCE_NOTE = 500;

// ---- Ce qu'on qualifie ------------------------------------------------------

export type Compliance = "conforme" | "non_conforme";

/**
 * Sous-ensemble de `request_attachments` dont dépend la qualification. Une
 * interface structurelle plutôt que la ligne complète : les tests décrivent des
 * cas, pas des lignes de base.
 */
export interface QualifiableAttachment {
  id: string;
  file_name: string;
  form_field_key: string | null;
  /** Non-NULL = pièce jointe à un e-mail SORTANT : ce n'est pas une pièce de l'usager. */
  email_id?: string | null;
  /**
   * Non-NULL = pièce REMPLACÉE par une plus récente (décision PO 2026-08-28 :
   * « la plus récente fait foi »). Elle reste au dossier — une pièce
   * administrative ne se supprime pas — mais sort du calcul de conformité.
   */
  superseded_by?: string | null;
  compliance: string | null;
  compliance_motif: string | null;
  compliance_note?: string | null;
}

/**
 * `manquante` n'existe que pour une exigence obligatoire sans aucun fichier :
 * une exigence facultative vide n'est pas une exigence, elle ne s'affiche pas.
 */
export type RequirementState = "conforme" | "non_conforme" | "a_qualifier" | "manquante";

export interface PieceRequirement {
  /** `form_field_key` du champ ; `null` pour les pièces hors formulaire. */
  key: string | null;
  label: string;
  required: boolean;
  /** Pièces ACTIVES : ce sont elles, et elles seules, qui font l'état. */
  attachments: QualifiableAttachment[];
  /** Pièces remplacées, de la plus récente à la plus ancienne — mémoire du dossier. */
  superseded: QualifiableAttachment[];
  state: RequirementState;
  /** Motifs relevés sur les fichiers non conformes, dans l'ordre du catalogue. */
  motifs: NonConformityMotif[];
}

/** Libellé et exigence d'un champ « pièce » visible du formulaire. */
export interface PieceField {
  key: string;
  label: string;
  required: boolean;
}

/**
 * Champs « pièce » que la demande expose réellement : la visibilité (section et
 * champ) est rejouée sur les valeurs stockées, exactement comme pour les
 * réponses affichées — un champ masqué par une condition n'exige rien.
 *
 * ⚠️ `form_data` est indexé par clé machine (`dataKey`), les conditions par
 * `id` de champ : la table `byId` fait le pont, comme dans `formAnswers`.
 */
export function pieceFields(procedureSnapshot: unknown, formData: unknown): PieceField[] {
  const schema = formSchemaFrom(procedureSnapshot);
  if (!schema) return [];
  const data = isRecord(formData) ? formData : {};
  const entries = flatFields(schema);
  const byId: FormValues = {};
  for (const entry of entries) byId[entry.field.id] = data[dataKey(entry.field)];

  const out: PieceField[] = [];
  for (const entry of entries) {
    if (entry.field.type !== "attachment") continue;
    if (!fieldIsVisible(entry, byId)) continue;
    out.push({
      key: dataKey(entry.field),
      label: entry.field.label,
      required: attachmentIsRequired(entry.field, byId),
    });
  }
  return out;
}

/**
 * Exigences de pièces d'une demande, dans l'ordre du formulaire, suivies des
 * pièces déposées qui ne répondent à aucun champ connu (dépôt partenaire,
 * snapshot dégradé) — celles-ci restent qualifiables mais ne bloquent rien.
 *
 * Les pièces jointes à un e-mail sortant sont écartées : elles appartiennent à
 * l'échange, pas au dossier de l'usager (même règle que l'onglet Documents).
 */
export function pieceRequirements(
  procedureSnapshot: unknown,
  formData: unknown,
  attachments: QualifiableAttachment[],
): PieceRequirement[] {
  const deposited = attachments.filter((a) => !a.email_id);
  const active = deposited.filter((a) => !a.superseded_by);
  const replaced = deposited.filter((a) => a.superseded_by);
  const fields = pieceFields(procedureSnapshot, formData);
  const claimed = new Set<string>();
  const out: PieceRequirement[] = [];

  for (const field of fields) {
    const files = active.filter((a) => a.form_field_key === field.key);
    const old = replaced.filter((a) => a.form_field_key === field.key);
    for (const file of [...files, ...old]) claimed.add(file.id);
    // Une exigence facultative sans aucune pièce, active ou remplacée, n'a rien
    // à montrer. Une exigence remplacée à blanc, si.
    if (files.length === 0 && old.length === 0 && !field.required) continue;
    out.push(buildRequirement(field.key, field.label, field.required, files, old));
  }

  // Pièces hors formulaire : une exigence par pièce ACTIVE, à laquelle on
  // rattache la chaîne de celles qu'elle a remplacées (une pièce peut avoir été
  // remplacée par une pièce elle-même remplacée : on remonte).
  for (const file of active) {
    if (claimed.has(file.id)) continue;
    const chain = supersededChain(file.id, replaced, claimed);
    out.push(buildRequirement(null, file.file_name, false, [file], chain));
  }
  // Une pièce remplacée dont le remplaçant a disparu (FK `on delete set null`
  // n'arrive pas, mais un filtre côté appelant, si) ne doit pas s'évaporer.
  for (const file of replaced) {
    if (claimed.has(file.id)) continue;
    out.push(buildRequirement(null, file.file_name, false, [], [file]));
  }
  return out;
}

/** Les pièces remplacées PAR `id`, puis celles qu'elles avaient remplacées. */
function supersededChain(
  id: string,
  replaced: QualifiableAttachment[],
  claimed: Set<string>,
): QualifiableAttachment[] {
  const out: QualifiableAttachment[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const file of replaced) {
      if (file.superseded_by !== current || claimed.has(file.id)) continue;
      claimed.add(file.id);
      out.push(file);
      queue.push(file.id);
    }
  }
  return out;
}

function buildRequirement(
  key: string | null,
  label: string,
  required: boolean,
  files: QualifiableAttachment[],
  superseded: QualifiableAttachment[] = [],
): PieceRequirement {
  return {
    key,
    label,
    required,
    attachments: files,
    superseded,
    state: requirementState(required, files),
    motifs: motifsOf(files),
  };
}

function requirementState(required: boolean, files: QualifiableAttachment[]): RequirementState {
  if (files.length === 0) return required ? "manquante" : "a_qualifier";
  if (files.some((f) => f.compliance === "non_conforme")) return "non_conforme";
  if (files.some((f) => f.compliance !== "conforme")) return "a_qualifier";
  return "conforme";
}

function motifsOf(files: QualifiableAttachment[]): NonConformityMotif[] {
  const seen = new Set<NonConformityMotif>();
  for (const file of files) {
    if (file.compliance !== "non_conforme") continue;
    const motif = file.compliance_motif;
    if (motif && isKnownMotif(motif)) seen.add(motif);
  }
  return NONCONFORMITY_MOTIFS.filter((m) => seen.has(m.value)).map((m) => m.value);
}

// ---- Ce que la garde serveur en déduit --------------------------------------

/**
 * Exigences qui ferment « Résoudre positivement » — miroir EXACT de la garde
 * SQL : une exigence OBLIGATOIRE qui n'est pas conforme, qu'elle soit non
 * conforme, pas encore qualifiée, ou jamais déposée.
 *
 * Ni la résolution négative, ni l'annulation, ni la mise en attente ne sont
 * concernées (décision PO 2026-08-28) : on refuse souvent PARCE QU'une pièce
 * manque, et une pièce qui cloche doit pouvoir mettre le dossier en attente.
 */
export function blockingRequirements(requirements: PieceRequirement[]): PieceRequirement[] {
  return requirements.filter((r) => r.required && r.state !== "conforme");
}

/** Explication du blocage, ou `null` si la résolution positive est ouverte. */
export function blockingMessage(requirements: PieceRequirement[]): string | null {
  const blocking = blockingRequirements(requirements);
  if (blocking.length === 0) return null;
  const missing = blocking.filter((r) => r.state === "manquante").length;
  const nonConforme = blocking.filter((r) => r.state === "non_conforme").length;
  const toQualify = blocking.length - missing - nonConforme;
  const parts: string[] = [];
  if (toQualify > 0) parts.push(`${toQualify} à qualifier`);
  if (nonConforme > 0) parts.push(`${nonConforme} non conforme${nonConforme > 1 ? "s" : ""}`);
  if (missing > 0) parts.push(`${missing} manquante${missing > 1 ? "s" : ""}`);
  const n = blocking.length;
  return (
    `${n} pièce${n > 1 ? "s" : ""} obligatoire${n > 1 ? "s" : ""} (${parts.join(", ")})` +
    " : la résolution positive reste fermée tant qu'elles ne sont pas conformes."
  );
}

/** Au moins une pièce déclarée non conforme — c'est ce qui met la demande en attente. */
export function hasNonConforme(requirements: PieceRequirement[]): boolean {
  return requirements.some((r) => r.state === "non_conforme");
}

/**
 * Plus aucune pièce non conforme ET plus rien qui bloque la résolution : c'est
 * le moment de proposer la reprise de l'instruction.
 */
export function readyToResume(requirements: PieceRequirement[]): boolean {
  return !hasNonConforme(requirements) && blockingRequirements(requirements).length === 0;
}

export interface ComplianceCounts {
  total: number;
  conforme: number;
  nonConforme: number;
  aQualifier: number;
  manquante: number;
}

export function complianceCounts(requirements: PieceRequirement[]): ComplianceCounts {
  return {
    total: requirements.length,
    conforme: requirements.filter((r) => r.state === "conforme").length,
    nonConforme: requirements.filter((r) => r.state === "non_conforme").length,
    aQualifier: requirements.filter((r) => r.state === "a_qualifier").length,
    manquante: requirements.filter((r) => r.state === "manquante").length,
  };
}

// ---- Le courriel de signalement ---------------------------------------------

/** Réexporté pour les appelants : c'est le `Recipient` partagé, pas un jumeau. */
export type NonConformityRecipient = Recipient;

export interface NonConformityInput {
  reference: string;
  subject: string | null;
  requirements: PieceRequirement[];
  recipient: NonConformityRecipient;
  tenantName: string;
}

export interface DraftEmail {
  subject: string;
  body: string;
}

/**
 * Brouillon du signalement de non-conformité, déposé dans le composeur de
 * l'onglet Échanges — l'agent le relit, l'amende et l'envoie lui-même. Aucun
 * envoi automatique : ce texte parle au nom de la collectivité.
 *
 * Ne cite QUE les pièces non conformes, jamais les manquantes : réclamer une
 * pièce jamais déposée est un autre geste (« Demander une pièce »), avec ses
 * propres mots. Mélanger les deux ferait un courriel qui reproche à l'usager
 * quelque chose qu'il n'a pas fait.
 *
 * Une valeur absente est OMISE plutôt que remplie d'un repli — même règle que
 * `requestTemplateValues` : « Identité déclarée » ou « date inconnue » sont des
 * mots d'écran de gestion, aucun ne doit atteindre un usager.
 */
export function buildNonConformityEmail(input: NonConformityInput): DraftEmail {
  const pieces = input.requirements.filter((r) => r.state === "non_conforme");
  const plural = pieces.length > 1;

  const subject = `Votre demande ${input.reference} : pièce${plural ? "s" : ""} à transmettre à nouveau`;

  const lines: string[] = [];
  lines.push(`${salutation(input.recipient)},`);
  lines.push("");
  lines.push(
    `Nous avons examiné les pièces jointes à votre demande ${quotedSubject(input.subject)}` +
      `(référence ${input.reference}).`,
  );
  lines.push("");
  lines.push(
    plural
      ? "Plusieurs d'entre elles ne peuvent pas être retenues en l'état :"
      : "L'une d'elles ne peut pas être retenue en l'état :",
  );
  lines.push("");
  for (const piece of pieces) lines.push(...pieceLines(piece));
  lines.push("");
  lines.push(
    `Nous vous remercions de nous transmettre à nouveau ${plural ? "ces pièces" : "cette pièce"}` +
      " afin que l'instruction de votre demande puisse se poursuivre. Votre demande est" +
      " placée en attente de ces éléments.",
  );
  lines.push("");
  lines.push("Cordialement,");
  lines.push(input.tenantName);

  return { subject, body: lines.join("\n") };
}

function pieceLines(piece: PieceRequirement): string[] {
  const names = piece.attachments.map((a) => a.file_name).filter((n) => clean(n) !== "");
  const head = names.length > 0 ? `${piece.label} (${names.join(", ")})` : piece.label;
  const reasons = piece.motifs.map((m) => motifPhrase(m)).filter((p): p is string => p !== null);
  const out = [reasons.length > 0 ? `- ${head} : ${reasons.join(" ; ")}.` : `- ${head}.`];
  for (const note of notesOf(piece)) out.push(`  Précision : ${note}`);
  return out;
}

function notesOf(piece: PieceRequirement): string[] {
  const out: string[] = [];
  for (const file of piece.attachments) {
    if (file.compliance !== "non_conforme") continue;
    const note = clean(file.compliance_note);
    if (note && !out.includes(note)) out.push(note);
  }
  return out;
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
