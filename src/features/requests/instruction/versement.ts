// « Verser au dossier » une pièce reçue en réponse de l'usager (backlog B10,
// décision PO 2026-10-24) — logique pure, testée.
//
// Une pièce jointe par l'usager à une réponse en ligne reste dans l'ÉCHANGE
// (`citizen_message_id`) : ni dans les exigences, ni dans la conformité. Le
// cas courant — « voici la pièce qui manquait » — demande donc un geste
// explicite de l'agent, jamais automatique : la RPC `file_citizen_piece` crée
// une LIGNE de plus (même fichier, `source_attachment_id` vers l'original,
// `citizen_message_id` NULL), rattachée à l'exigence choisie, qui remplace les
// pièces actives de cette exigence (« la plus récente fait foi »).
//
// L'original ne bouge pas : il reste lisible dans son message.

import type { Tables } from "@/types/database.types";
import type { PieceField, PieceRequirement, QualifiableAttachment } from "./conformite";

type Attachment = Pick<Tables<"request_attachments">, "id" | "email_id" | "citizen_message_id" | "source_attachment_id">;

/**
 * Les pièces de réponse DÉJÀ versées : identifiants des originaux dont une copie
 * est au dossier. Une copie jointe à un e-mail (`email_id`) n'est pas un
 * versement — c'est l'autre sens du même motif.
 */
export function filedCitizenPieceIds(attachments: readonly Attachment[]): Set<string> {
  const ids = new Set<string>();
  for (const a of attachments) {
    if (a.source_attachment_id && !a.email_id && !a.citizen_message_id) ids.add(a.source_attachment_id);
  }
  return ids;
}

export interface FilingTarget {
  /** `form_field_key` de l'exigence ; `null` = pièce hors formulaire. */
  key: string | null;
  label: string;
  required: boolean;
  /** Pièces ACTIVES que le versement remplacera — annoncées avant d'agir. */
  replaces: QualifiableAttachment[];
}

export const OUTSIDE_FORM_LABEL = "Pièce hors formulaire";

/**
 * Où la pièce peut aller : chaque champ « pièce » visible du formulaire figé —
 * y compris une exigence facultative encore vide, que `pieceRequirements` ne
 * montre pas —, puis « hors formulaire », qui ne remplace rien.
 */
export function filingTargets(fields: readonly PieceField[], requirements: readonly PieceRequirement[]): FilingTarget[] {
  const targets: FilingTarget[] = fields.map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    replaces: requirements.find((r) => r.key === field.key)?.attachments ?? [],
  }));
  targets.push({ key: null, label: OUTSIDE_FORM_LABEL, required: false, replaces: [] });
  return targets;
}
