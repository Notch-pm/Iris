// Ouvrir et refermer un .docx — SEULE brique de ce dossier à dépendre d'une
// bibliothèque (motif `email/transport.ts` : tout ce qui décide vit dans les
// modules purs voisins, testés par vitest ; ici, on ne fait que du zip).
//
// Un .docx est un zip d'XML. On le rouvre, on réécrit les parties qui portent
// du texte, on le referme : TOUT LE RESTE — styles, images, en-têtes, polices,
// numérotation, propriétés — est recopié à l'octet près. C'est ce qui garantit
// qu'un document Word fusionné est visuellement IDENTIQUE à son modèle.

import { unzipSync, zipSync } from "npm:fflate@0.8.2";

export type DocxFiles = Record<string, Uint8Array>;

export function openDocx(bytes: Uint8Array): DocxFiles {
  return unzipSync(bytes);
}

export function saveDocx(files: DocxFiles): Uint8Array {
  return zipSync(files, { level: 6 });
}

export function readXml(files: DocxFiles, path: string): string | null {
  const entry = files[path];
  return entry ? new TextDecoder().decode(entry) : null;
}

export function writeXml(files: DocxFiles, path: string, xml: string): void {
  files[path] = new TextEncoder().encode(xml);
}

/**
 * Les parties qui portent du texte visible : le corps, puis les en-têtes et
 * pieds de page — un modèle de courrier met volontiers `{{organisme.nom}}` dans
 * son en-tête. Les notes, commentaires et zones de texte flottantes ne sont pas
 * balayés : aucun modèle vu n'en dépend, et un remplacement à l'aveugle dans
 * tout le zip toucherait des parties qu'on ne sait pas relire.
 */
export function textParts(files: DocxFiles): string[] {
  return Object.keys(files).filter((path) =>
    path === "word/document.xml" ||
    /^word\/(header|footer)\d*\.xml$/.test(path)
  );
}

/** Un .docx digne de ce nom porte un corps de document. */
export function isDocx(files: DocxFiles): boolean {
  return Object.hasOwn(files, "word/document.xml");
}
