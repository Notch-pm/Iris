/**
 * Retrait de l'identité de l'usager avant l'envoi au fournisseur.
 *
 * ⚠️ CE MODULE EST LA SECONDE LIGNE DE DÉFENSE, PAS LA PREMIÈRE. La première
 * est le `select` : `REQUEST_CONTEXT_COLUMNS` (context.ts) ne demande jamais
 * `requester_snapshot`, `socle_contact_id` ni `identity_status`. Ces colonnes
 * ne sont pas en mémoire, donc elles ne peuvent pas fuir. Ce qui reste à
 * couvrir, c'est ce qui se glisse AILLEURS : une réponse de formulaire, le
 * payload d'un événement.
 *
 * CE QUE LE MODULE PROMET : aucun champ d'identité **connu** ne sort — les
 * clés du catalogue `DECLARED_KEYS`, plus les courriels, téléphones, IBAN et
 * SIRET repérables dans du texte libre.
 *
 * CE QU'IL NE PROMET PAS : les NOMS dans du texte libre. Sans reconnaissance
 * d'entités, c'est hors de portée — et masquer « Dupont » casserait « rue
 * Marcel Dupont ». Une réponse en texte libre peut donc encore contenir un
 * nom. Cette limite est écrite ici, dans `docs/assistant-ia.md`, et affichée
 * à l'agent dans le panneau : on ne promet pas ce qu'on ne tient pas.
 *
 * CE QUI RESTE VOLONTAIREMENT : le LIEU D'INTERVENTION. Un lieu n'est pas une
 * personne, et c'est souvent le cœur de la question posée à l'assistant
 * (« que faire d'un nid-de-poule signalé rue des Lilas ? »).
 *
 * Module PUR, testé.
 */

import { ALL_DECLARED_KEYS } from "../identity/declared.ts";

/**
 * Préfixes préservés malgré le catalogue. Le bloc « Lieu d'intervention » du
 * contrat Socle nomme ses champs `intervention_numero|btq|voie|complement|
 * appartement|code_postal|ville` : aucun ne collisionne avec le catalogue
 * aujourd'hui, mais la règle explicite protège le jour où un champ
 * d'intervention s'appellerait `adresse`.
 */
const KEEP_PREFIXES = ["intervention_"] as const;

const DECLARED = new Set(ALL_DECLARED_KEYS.map((k) => k.toLowerCase()));

function isIdentityKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (KEEP_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return DECLARED.has(lower);
}

export interface StripResult<T> {
  value: T;
  /** Clés effectivement retirées — le prompt le dit honnêtement au modèle. */
  removedKeys: string[];
}

/**
 * Parcours récursif de n'importe quel JSON. Retire les clés d'identité à
 * TOUTE profondeur : un partenaire peut imbriquer `{ demandeur: { email } }`,
 * et un retrait de surface laisserait passer l'essentiel.
 */
export function stripIdentityKeys<T>(value: T): StripResult<T> {
  const removed = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (isIdentityKey(key)) {
        removed.add(key);
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };

  return { value: walk(value) as T, removedKeys: [...removed].sort() };
}

// Les motifs sont volontairement larges côté téléphone (le français s'écrit
// « 06 12 34 56 78 », « 06.12.34.56.78 », « +33 6 12 34 56 78 »…) et étroits
// ailleurs : on préfère laisser passer un faux négatif qu'expurger un numéro
// de voie ou une référence de dossier.
const EMAIL_RE = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+33|0033|\b0)\s?[1-9](?:[\s.\-]?\d{2}){4}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[\s]?[A-Z0-9]{4}){2,7}(?:[\s]?[A-Z0-9]{1,3})?\b/g;
const SIRET_RE = /\b\d{14}\b/g;

/**
 * Passe *best effort* sur du texte libre. L'ordre compte : le courriel
 * d'abord (il peut contenir des chiffres qu'un motif de téléphone
 * attraperait), l'IBAN avant le SIRET (un IBAN contient de longues suites de
 * chiffres).
 */
export function redactFreeText(text: string): string {
  if (typeof text !== "string" || text === "") return "";
  return text
    .replace(EMAIL_RE, "[courriel retiré]")
    .replace(IBAN_RE, "[IBAN retiré]")
    .replace(PHONE_RE, "[téléphone retiré]")
    .replace(SIRET_RE, "[SIRET retiré]");
}

/** Le geste complet : retrait des clés connues, puis nettoyage du texte libre. */
export function redactValue<T>(value: T): StripResult<T> {
  const stripped = stripIdentityKeys(value);

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactFreeText(node);
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(child);
    }
    return out;
  };

  return { value: walk(stripped.value) as T, removedKeys: stripped.removedKeys };
}
