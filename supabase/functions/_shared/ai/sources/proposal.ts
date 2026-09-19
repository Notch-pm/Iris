/**
 * La proposition de l'assistant : « je peux consulter telles sources ».
 *
 * Le modèle la formule en fin de réponse par une ligne balisée
 * `[[CONSULTER: s-xxxx, s-yyyy]]`, que le prompt lui décrit. Iris la retire du
 * texte et n'en garde que les identifiants QU'IL LUI AVAIT OFFERTS : tout le
 * reste — identifiant inventé, source déjà consultée, balise malformée — est
 * ignoré. L'échec est donc sans danger : au pire, il n'y a pas de proposition,
 * et l'agent lit une réponse qui dit ce qui lui manque.
 *
 * Pourquoi une ligne balisée plutôt qu'une réponse JSON : le format de la
 * réponse reste du Markdown que l'agent lit, et une balise ratée ne coûte
 * qu'une proposition, là où un JSON raté coûterait la réponse entière.
 *
 * Module PUR, testé.
 */

import { MAX_PROPOSED, type SourceRef } from "./catalogue.ts";

/** Toute balise, éventuellement entourée d'accents graves (Markdown de code). */
const TAG = /`?\[\[\s*CONSULTER\s*:([^\]]*)\]\]`?/gi;
/** Une balise interrompue en fin de réponse (plafond de sortie atteint). */
const DANGLING = /`?\[\[\s*CONSULTER[^\]]*$/i;

export interface ExtractedProposal {
  /** La réponse, débarrassée de toute balise. */
  answer: string;
  /** Les sources proposées, dans l'ordre du modèle ; `null` s'il n'y en a pas. */
  proposal: SourceRef[] | null;
}

/** Repli quand la réponse ne contenait QUE la balise. */
export const PROPOSAL_ONLY_ANSWER =
  "Les informations dont je dispose ne suffisent pas à répondre. Les sources ci-dessous pourraient contenir la réponse.";

export function extractProposal(answer: string, offered: SourceRef[]): ExtractedProposal {
  const text = typeof answer === "string" ? answer : "";
  const matches = [...text.matchAll(TAG)];

  const cleaned = text
    .replace(TAG, "")
    .replace(DANGLING, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let proposal: SourceRef[] | null = null;
  if (matches.length > 0) {
    // La DERNIÈRE balise fait foi : c'est la conclusion de la réponse.
    const byId = new Map(offered.map((s) => [s.id, s]));
    const picked: SourceRef[] = [];
    for (const raw of matches[matches.length - 1][1].split(/[\s,;]+/)) {
      const source = byId.get(raw.trim().toLowerCase());
      if (source && !picked.includes(source)) picked.push(source);
      if (picked.length === MAX_PROPOSED) break;
    }
    if (picked.length > 0) proposal = picked;
  }

  return {
    answer: cleaned === "" && proposal ? PROPOSAL_ONLY_ANSWER : cleaned,
    proposal,
  };
}
