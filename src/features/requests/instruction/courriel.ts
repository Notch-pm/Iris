// Résolution des variables d'un modèle d'e-mail SUR UNE VRAIE DEMANDE — logique
// pure, sans DOM ni réseau.
//
// Ce module vit ici, et non dans `features/templates`, parce qu'il connaît une
// demande : le spécifique importe le général (`renderTemplate`), jamais
// l'inverse.
//
// ⚠️ RÈGLE UNIQUE ET NON NÉGOCIABLE : une valeur absente ⇒ LA CLÉ EST OMISE.
// `renderTemplate` remplace alors par une chaîne vide. Les replis de
// `instruction.ts` (« Identité déclarée », « Système / intégration », « date
// inconnue ») et de `useTenantMembers` (l'e-mail de l'agent à défaut de nom)
// sont écrits pour un écran de gestion : aucun ne doit atteindre un usager. Un
// trou visible, que l'agent comble avant d'envoyer, vaut mieux qu'un mot
// d'interface glissé dans un courrier.

import type { Tables } from "@/types/database.types";
import { MOTIF_LABELS, PRIORITY_LABELS, STATUS_LABELS, type ClosureMotif } from "../statuts";
import {
  channelLabel,
  firstInstructionAt,
  formatBytes,
  formatDayMonth,
  type RequesterIdentity,
  type StageEvent,
} from "./instruction";

/**
 * Plafond des pièces jointes d'un envoi. **Jumeau** de
 * `MAX_ATTACHMENTS_BYTES` dans `supabase/functions/send-request-email/index.ts`,
 * qui fait autorité : ici c'est un confort (le bouton se ferme avant l'aller
 * retour), là-bas c'est la garde.
 *
 * 10 Mo est la limite pratique des relais SMTP, bien en deçà des 25 Mio que le
 * bucket accepte par objet.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface TemplateValuesInput {
  request: Tables<"requests">;
  identity: RequesterIdentity;
  events: StageEvent[];
  members: { userId: string; displayName: string }[];
  tenantName: string;
}

/** Date longue française — `null` dès que la date est absente ou illisible. */
function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return Number.isNaN(new Date(iso).getTime()) ? null : formatDayMonth(iso, true);
}

/**
 * Nom de l'agent en charge — omis s'il n'y a pas d'affectataire, si le membre
 * est inconnu, ou si son « nom d'affichage » est en réalité son adresse
 * (`useTenantMembers` retombe dessus quand le profil n'a ni prénom ni nom).
 * Une adresse d'agent n'a rien à faire dans un courrier à un habitant.
 */
function agentName(input: TemplateValuesInput): string | null {
  const id = input.request.assigned_to;
  if (!id) return null;
  const found = input.members.find((m) => m.userId === id)?.displayName?.trim();
  if (!found || found.includes("@")) return null;
  return found;
}

/**
 * Les valeurs réelles des variables du catalogue, pour CETTE demande.
 * Les clés sans valeur ne figurent tout simplement pas dans le résultat.
 */
export function requestTemplateValues(input: TemplateValuesInput): Record<string, string> {
  const { request: r, identity } = input;
  const values: Record<string, string> = {};

  const put = (key: string, value: string | null | undefined) => {
    const text = (value ?? "").trim();
    if (text !== "") values[key] = text;
  };

  // — Usager : l'identité FIGÉE au dépôt, jamais une relecture du Socle -------
  put("usager.civilite", identity.civility);
  put("usager.prenom", identity.firstName);
  put("usager.nom", identity.lastName);
  // `identity.name` retombe sur « Identité déclarée » quand rien n'est connu :
  // `known` est justement le drapeau qui distingue les deux.
  put("usager.nom_complet", identity.known ? identity.name : null);
  put("usager.raison_sociale", identity.legalName);
  put("usager.courriel", identity.email);
  put("usager.telephone", identity.phone);
  put("usager.adresse", identity.address);

  // — Demande ---------------------------------------------------------------
  put("demande.reference", r.reference);
  put("demande.objet", r.subject);
  put("demande.description", r.body);
  put("demande.statut", STATUS_LABELS[r.status as keyof typeof STATUS_LABELS]);
  put("demande.priorite", PRIORITY_LABELS[r.priority]);
  put("demande.demarche", r.socle_procedure_label);
  put("demande.categorie", r.socle_category_label);
  put("demande.destinataire", r.socle_organization_label);
  put("demande.canal", channelLabel(r.channel));
  put("demande.date_depot", longDate(r.received_at));
  put("demande.date_instruction", longDate(firstInstructionAt(input.events)));
  put("demande.date_cloture", longDate(r.closed_at));
  put("demande.date_echeance", longDate(r.due_at));
  put("demande.motif_cloture", r.closure_motif ? MOTIF_LABELS[r.closure_motif as ClosureMotif] : null);

  // — Qui traite, et pour qui ------------------------------------------------
  put("agent.nom", agentName(input));
  put("organisation.nom", input.tenantName);

  return values;
}

// ---------------------------------------------------------------------------
// Le brouillon du composeur
// ---------------------------------------------------------------------------

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface DraftErrors {
  subject?: string;
  body?: string;
  attachments?: string;
}

export function totalBytes(files: { size: number }[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

/**
 * Contrôles d'écran. Ils DOUBLENT le serveur (contraintes `btrim(...) <> ''`,
 * plafond des pièces) — ils ne le remplacent pas : ils évitent un aller-retour
 * et disent pourquoi en français.
 */
export function validateEmailDraft(
  draft: EmailDraft,
  files: { size: number }[],
): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.subject.trim() === "") errors.subject = "L'objet est obligatoire.";
  if (draft.body.trim() === "") errors.body = "Le message est obligatoire.";
  // Le total courant est affiché par le sélecteur de pièces, juste à côté : le
  // répéter ici donnerait « pèsent 10 Mo : le maximum est 10 Mo » dès qu'on
  // dépasse de peu (l'arrondi rend les deux nombres identiques).
  if (totalBytes(files) > MAX_EMAIL_ATTACHMENT_BYTES) {
    errors.attachments =
      `Les pièces jointes dépassent le maximum de ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}.`;
  }
  return errors;
}

export function hasDraftErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Insertion de la VALEUR d'une variable au curseur — pas du jeton `{{…}}`.
 *
 * C'est la différence entre ce composeur et l'éditeur de modèles : ici l'agent
 * rédige le message final, le voit tel qu'il partira, et c'est ce texte-là qui
 * est envoyé. Un trou (variable sans valeur pour cette demande) se voit donc
 * immédiatement et se comble à la main, au lieu de partir sans qu'on le sache.
 */
export function insertAtCaret(
  text: string,
  caret: number,
  insertion: string,
): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  return {
    text: text.slice(0, at) + insertion + text.slice(at),
    caret: at + insertion.length,
  };
}
