// Documents d'une demande — logique pure (sans DOM ni réseau), testée.
//
// TROIS NATURES au-delà des pièces de l'usager, et une seule règle à retenir :
//
//   · `instruction_interne` — la pièce de travail du service. **Elle ne sort
//     jamais** : pas de bouton « Joindre à un échange », et un trigger le
//     garantit en base (`t05_attachments_internal_never_sent`). L'écran ne fait
//     que refléter cette règle, il ne la porte pas.
//   · `instruction_externe` — transmissible à l'usager.
//   · `courrier` — le pli, produit depuis un modèle Word de la démarche.
//
// Les pièces JOINTES À UN ÉCHANGE (`email_id` non nul) ne sont pas des
// documents du dossier : ce sont des copies parties avec un message, et
// l'onglet Échanges les montre déjà. On les écarte partout ici.

import type { RequestAttachment } from "../useRequests";

/**
 * « Voir » n'est proposé que pour ce qu'un navigateur affiche : PDF et images
 * raster. Tout le reste (Word, HEIC…) se télécharge. La liste vit avec la
 * reconnaissance des types, côté serveur — une seule vérité.
 */
export { inlineViewable } from "@fn/_shared/files/magic";

export type DocumentKind = "instruction_interne" | "instruction_externe" | "courrier";

export const DOCUMENT_KINDS: {
  value: DocumentKind;
  label: string;
  /** Ce que l'agent doit comprendre AVANT de choisir. */
  sub: string;
}[] = [
  {
    value: "instruction_interne",
    label: "Pièce d'instruction interne",
    sub: "Interne au service — ne sera jamais transmise à l'usager",
  },
  {
    value: "instruction_externe",
    label: "Pièce d'instruction externe",
    sub: "Transmissible à l'usager en pièce jointe d'un échange",
  },
  {
    value: "courrier",
    label: "Courrier",
    sub: "Le pli adressé à l'usager, transmissible en pièce jointe",
  },
];

export function kindLabel(kind: string): string {
  return DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Un document interne ne quitte JAMAIS Iris — miroir de la règle des notes internes. */
export function isSendable(kind: string): boolean {
  return kind === "instruction_externe" || kind === "courrier";
}

/** Les documents d'une nature : jamais les pièces déjà parties dans un échange. */
export function documentsOf(
  attachments: readonly RequestAttachment[],
  kind: DocumentKind,
): RequestAttachment[] {
  return attachments
    .filter((a) => a.email_id === null && a.kind === kind)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Ce qu'on peut proposer en pièce jointe d'un message à l'usager. */
export function sendableDocuments(attachments: readonly RequestAttachment[]): RequestAttachment[] {
  return attachments
    .filter((a) => a.email_id === null && isSendable(a.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** « Généré le 01/09/2026 depuis « Courrier usager » » — vide si déposé à la main. */
export function generatedMeta(attachment: RequestAttachment): string {
  if (!attachment.generated_at) return "";
  const date = new Date(attachment.generated_at).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const template = attachment.template_label?.trim();
  return template ? `Généré le ${date} depuis « ${template} »` : `Généré le ${date}`;
}

// ---- Choix du modèle --------------------------------------------------------
// Les modèles viennent du SOCLE (`@fn/_shared/document/templates`) : la démarche
// dit lesquels existent, leur nature et à quel stade ils se proposent. Iris n'a
// donc aucun fichier à valider ici — seulement à refléter.

export type DocumentFormat = "pdf" | "docx";

export const FORMATS: { value: DocumentFormat; label: string; sub: string }[] = [
  { value: "pdf", label: "PDF", sub: "Redessiné par Iris — police substituée, images non reprises" },
  { value: "docx", label: "Word", sub: "Identique au modèle, modifiable" },
];

/** Aperçu : une valeur vide se voit, elle ne se devine pas. */
export function previewValue(value: string): string {
  return value.trim() === "" ? "—" : value;
}

/**
 * Les avertissements du rendu PDF, en une phrase. Ils ne bloquent rien : ils
 * disent ce que le PDF ne montrera pas, et laissent l'agent choisir Word.
 */
export function pdfWarningLine(warnings: readonly string[]): string {
  if (warnings.length === 0) return "";
  return `Ce modèle contient des éléments que le PDF ne reprendra pas : ${warnings.join(", ")}. ` +
    "Le format Word, lui, reste identique au modèle.";
}
