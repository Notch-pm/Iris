/**
 * Estimation du coût d'un appel, en jetons.
 *
 * Ce que ce module promet : une **borne haute raisonnable**, pas une vérité.
 * La réservation n'a pas besoin d'être exacte — `settle_ai_usage` la corrige
 * ensuite avec le `usage.total_tokens` rendu par le fournisseur. Ce qu'elle ne
 * doit jamais faire, c'est SOUS-estimer : une sous-estimation systématique
 * laisserait dépasser le plafond avant que le règlement ne s'en aperçoive.
 *
 * ⚠️ POURQUOI PAS `chars / 4` (la constante de Clara, et l'usage courant) :
 * cette règle est calibrée sur l'anglais ASCII. Le français administratif
 * coûte plus cher — les accents sont souvent des jetons à part entière, et le
 * vocabulaire (« justificatif », « réglementation », « déclaration ») se
 * découpe en plusieurs morceaux. Mesuré sur les bases de connaissances ACCM,
 * l'écart est de 15 à 25 %. On prend donc `chars / 3.5`, qui laisse de la
 * marge dans le bon sens.
 *
 * Ces tests épinglent le CONTRAT de l'heuristique (monotonie, borne, marge),
 * pas une vérité de tokenizer : aucun appel réseau, aucune dépendance.
 *
 * Module PUR, testé.
 */

/** Caractères français par jeton — voir l'en-tête pour le choix de 3.5. */
const CHARS_PER_TOKEN = 3.5;

/** Coût de structure d'un message dans le protocole de chat (rôle, séparateurs). */
const PER_MESSAGE_OVERHEAD = 4;

/**
 * Longueur maximale de la réponse, imposée par IRIS à chaque appel — jamais
 * laissée au défaut d'une console. Le panneau fait 372 px de large : une
 * réponse plus longue ne serait pas lue, et coûterait pour rien.
 */
export const MAX_OUTPUT_TOKENS = 900;

export function estimateTokens(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface EstimatedMessage {
  role: string;
  content: string;
}

export function estimateMessagesTokens(messages: EstimatedMessage[]): number {
  return messages.reduce(
    (total, m) => total + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD,
    0,
  );
}

export interface CallEstimate {
  system: string;
  messages: EstimatedMessage[];
  maxOutput?: number;
}

/**
 * Ce qu'on réserve AVANT l'appel : l'entrée estimée plus la sortie maximale.
 * Réserver la sortie maximale est délibéré — au moment de la réservation on ne
 * sait pas ce que le modèle écrira, et un plafond doit se tenir sur le pire
 * cas. Le règlement rend ensuite la différence.
 */
export function estimateCall({ system, messages, maxOutput }: CallEstimate): number {
  const input = estimateTokens(system) + PER_MESSAGE_OVERHEAD + estimateMessagesTokens(messages);
  return input + (maxOutput ?? MAX_OUTPUT_TOKENS);
}
