// Rendu PDF — SEULE brique de ce dossier à connaître pdf-lib. Elle ne DÉCIDE
// rien : la mise en page est déjà calculée par `pdfLayout.ts` (pur, testé), et
// ce module ne fait que poser du texte et des traits aux coordonnées reçues.
//
// Décision du 2026-09-01 (PO) : Iris redessine le PDF lui-même plutôt que
// d'envoyer les courriers des usagers à un convertisseur externe. Le prix de ce
// choix est connu et écrit à l'écran : la police du modèle est SUBSTITUÉE
// (Helvetica, métriquement proche d'Arial), les images et les en-têtes ne sont
// pas repris. La fidélité de référence reste le .docx, toujours téléchargeable.

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

import type { ParsedDocument } from "./docxParse.ts";
import { layoutDocument, type Measure } from "./pdfLayout.ts";

/** « 1B7A4B » → couleur pdf-lib. Une valeur illisible rend l'encre par défaut. */
function color(hex: string | null) {
  if (!hex) return rgb(0, 0, 0);
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return rgb(0, 0, 0);
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  );
}

/**
 * Le document mis en page, en PDF. Les quatre graisses d'Helvetica couvrent le
 * gras et l'italique ; le souligné est un trait, comme dans le modèle.
 */
export async function renderPdf(parsed: ParsedDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const pick = (isBold: boolean, isItalic: boolean) =>
    isBold ? (isItalic ? boldItalic : bold) : (isItalic ? italic : regular);

  // La mesure du rendu EST celle de la mise en page : c'est la vraie métrique
  // de la police qui décide des retours à la ligne.
  const measure: Measure = (text, sizePt, isBold, isItalic) =>
    pick(isBold, isItalic).widthOfTextAtSize(text, sizePt);

  const laid = layoutDocument(parsed, measure);

  for (const pieces of laid.pages) {
    const page = pdf.addPage([laid.widthPt, laid.heightPt]);
    for (const piece of pieces) {
      if (piece.kind === "text") {
        // Retournement de l'axe : la mise en page compte depuis le HAUT.
        page.drawText(piece.text, {
          x: piece.x,
          y: laid.heightPt - piece.baseline,
          size: piece.sizePt,
          font: pick(piece.bold, piece.italic),
          color: color(piece.color),
        });
        continue;
      }
      page.drawLine({
        start: { x: piece.x1, y: laid.heightPt - piece.y1 },
        end: { x: piece.x2, y: laid.heightPt - piece.y2 },
        thickness: piece.widthPt,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  return await pdf.save();
}
