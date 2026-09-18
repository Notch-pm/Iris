/**
 * `user_communication` — ce que la collectivité écrit POUR SES USAGERS sur une
 * démarche (contrat public-api 1.24.0, Socle, 2026-09-18 ; sixième étape de
 * l'éditeur, « Communication usager »).
 *
 * UNE whitelist, trois lecteurs : `socle-proxy` (ce qui franchit la frontière
 * du navigateur), l'écran « Fiche démarche », et l'assistant IA
 * (`_shared/ai/userCommunication.ts`, qui y ajoute ses contrepoids).
 *
 * Tout ce que porte la colonne est PUBLIC (invariant du Socle) : la faire
 * traverser jusqu'au navigateur n'expose rien. La whitelist sert à ne relayer
 * QUE le contrat — un champ ajouté demain au Socle est ignoré, jamais relayé.
 *
 * ⚠️ IDEMPOTENCE : les noms de champs sont ceux du Socle, à la lettre, et la
 * sortie est un sous-ensemble strict de l'entrée : `parse(parse(x))` vaut
 * `parse(x)`. Le proxy whiteliste, puis le navigateur re-parse par défiance —
 * renommer au passage ferait disparaître au second tour ce que le premier
 * avait gardé (vécu le 2026-08-28 sur la base de connaissances).
 *
 * ⚠️ `null` = la collectivité n'a RIEN écrit, et les défauts de cette colonne
 * sont VIDES (à l'inverse de `communication_config`). Aucun écran ne compose
 * de texte à sa place.
 *
 * ⚠️ Le descriptif usager N'EST PAS ici : c'est `user_description`, colonne
 * voisine, déjà relayée par le proxy.
 *
 * Module PUR (aucune dépendance), testé.
 */

/** Unités du contrat (`UserCommunicationDelays.processingTimeUnit`). */
export type ProcessingTimeUnit = "jour_ouvre" | "jour" | "semaine" | "mois";

const UNITS: readonly ProcessingTimeUnit[] = ["jour_ouvre", "jour", "semaine", "mois"];

/** Bornes du contrat : « 0 n'existe pas », 999 est le plafond de saisie. */
const MIN_PROCESSING_TIME = 1;
const MAX_PROCESSING_TIME = 999;

export interface UserCommunicationDelays {
  /** Durée habituelle d'INSTRUCTION. `null` = aucun délai annoncé. */
  processingTimeValue: number | null;
  /** `null` = unité absente ou inconnue — elle n'est JAMAIS déduite. */
  processingTimeUnit: ProcessingTimeUnit | null;
}

/** Une pièce ANNONCÉE à l'usager — pas une pièce à téléverser. */
export interface UserCommunicationPiece {
  label: string;
  /** Précision facultative — « De moins de trois mois ». Souvent vide. */
  description: string;
}

/** Une question d'usager et sa réponse publiée — jamais la FAQ du service. */
export interface UserCommunicationFaqItem {
  question: string;
  answer: string;
}

export interface UserCommunication {
  delays: UserCommunicationDelays;
  /** ⚠️ Une phrase que l'usager lit, pas une règle : elle ne filtre rien. */
  audience: { note: string };
  attachments: { items: UserCommunicationPiece[] };
  faq: { items: UserCommunicationFaqItem[] };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDelays(raw: unknown): UserCommunicationDelays {
  const delays = record(raw);
  const value = delays?.processingTimeValue;
  const unit = delays?.processingTimeUnit;
  // Une chaîne n'est pas acceptée, même numérique : le contrat annonce un entier.
  const validValue = typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_PROCESSING_TIME && value <= MAX_PROCESSING_TIME;
  return {
    processingTimeValue: validValue ? value : null,
    processingTimeUnit: UNITS.includes(unit as ProcessingTimeUnit) ? unit as ProcessingTimeUnit : null,
  };
}

function parseItems<T>(raw: unknown, pick: (item: Record<string, unknown>) => T | null): T[] {
  const items = record(raw)?.items;
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const entry of items) {
    const item = record(entry);
    const picked = item ? pick(item) : null;
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * Whitelist du bloc `user_communication`. `null` quand la collectivité n'a rien
 * écrit (ou que le bloc est illisible) ; sinon toujours une structure complète.
 */
export function parseUserCommunication(raw: unknown): UserCommunication | null {
  const uc = record(raw);
  if (!uc) return null;
  return {
    delays: parseDelays(uc.delays),
    audience: { note: text(record(uc.audience)?.note) },
    attachments: {
      items: parseItems(uc.attachments, (item) => {
        // Le Socle refuse d'enregistrer une pièce sans intitulé : une précision
        // seule serait une puce orpheline.
        const label = text(item.label);
        return label === "" ? null : { label, description: text(item.description) };
      }),
    },
    faq: {
      items: parseItems(uc.faq, (item) => {
        // « Les deux sont toujours remplies » (contrat).
        const faq = { question: text(item.question), answer: text(item.answer) };
        return faq.question === "" || faq.answer === "" ? null : faq;
      }),
    },
  };
}

/**
 * Libellé d'une unité, accordé sur la valeur. « jour » se dit **calendaire** :
 * c'est le libellé du sélecteur de l'éditeur Socle, et le seul qui empêche de
 * le confondre avec « jours ouvrés ».
 */
export function processingTimeUnitLabel(unit: ProcessingTimeUnit, value: number): string {
  const plural = value > 1;
  switch (unit) {
    case "jour_ouvre":
      return plural ? "jours ouvrés" : "jour ouvré";
    case "jour":
      return plural ? "jours calendaires" : "jour calendaire";
    case "semaine":
      return plural ? "semaines" : "semaine";
    case "mois":
      return "mois";
  }
}

/**
 * « 3 semaines », ou `null` : sans valeur, ou sans unité connue, il n'y a PAS
 * de délai — « 30 » ne dit pas si ce sont trente jours ou trente jours ouvrés.
 */
export function processingTimeLabel(delays: UserCommunicationDelays | null | undefined): string | null {
  if (!delays) return null;
  const { processingTimeValue: value, processingTimeUnit: unit } = delays;
  if (value === null || unit === null) return null;
  return `${value} ${processingTimeUnitLabel(unit, value)}`;
}

/** La collectivité a-t-elle écrit quelque chose dans ce bloc ? */
export function isUserCommunicationEmpty(uc: UserCommunication | null): boolean {
  if (!uc) return true;
  return processingTimeLabel(uc.delays) === null && uc.audience.note === "" &&
    uc.attachments.items.length === 0 && uc.faq.items.length === 0;
}
