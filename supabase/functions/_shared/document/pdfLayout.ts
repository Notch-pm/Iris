// Mise en page du PDF — module PUR (aucune dépendance, aucun dessin réel),
// testé par vitest. Il transforme le document intermédiaire en une liste de
// PAGES portant des primitives déjà positionnées ; le rendu, lui, ne fait plus
// que poser du texte et des traits (`pdfRender.ts`, seul à connaître pdf-lib).
//
// Cette séparation n'est pas une coquetterie : c'est ce qui rend la mise en
// page testable (retour à la ligne, alignements, sauts de page, tableaux) sans
// jamais produire un octet de PDF.
//
// REPÈRE DES COORDONNÉES : l'origine est en HAUT à gauche, `y` descend — comme
// une page qu'on lit. Le rendu retourne l'axe pour PDF (origine en bas).

import type { Align, DocParagraph, DocRun, DocTable, ParsedDocument } from "./docxParse.ts";

/** Largeur d'un texte dans un style donné, en points. Injectée : en test, une
 *  approximation ; au rendu, la vraie métrique de la police. */
export type Measure = (text: string, sizePt: number, bold: boolean, italic: boolean) => number;

export interface TextPiece {
  kind: "text";
  x: number;
  /** Ligne de base, distance depuis le haut de la page. */
  baseline: number;
  text: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: string | null;
}

export interface LinePiece {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthPt: number;
}

export type Piece = TextPiece | LinePiece;

export interface LaidOutDocument {
  widthPt: number;
  heightPt: number;
  pages: Piece[][];
}

/** Interligne d'une ligne « simple » chez Word, rapporté à la taille de police. */
const LINE_FACTOR = 1.18;
/** Marge intérieure d'une cellule de tableau (Word : 0,19 cm ≈ 5,4 pt). */
const CELL_PAD = 5.4;
/** Avance d'une tabulation, faute de connaître les taquets du modèle. */
const TAB_PT = 35.4;

/**
 * Caractères hors Latin-1 que WinAnsi (l'encodage des polices standard d'un
 * PDF) sait tout de même écrire : ligatures françaises, guillemets typographiques,
 * tirets longs, points de suspension, euro.
 */
const WINANSI_EXTRA = new Set([
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021,
  0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/**
 * Texte écrivable par une police standard de PDF. Un caractère hors encodage
 * ferait ÉCHOUER la génération entière (pdf-lib lève) : mieux vaut un « ? » sur
 * un pictogramme exotique qu'un courrier qui ne sort pas. Les accents français,
 * eux, sont tous dans Latin-1.
 */
export function winAnsiSafe(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code <= 0xff || WINANSI_EXTRA.has(code) ? char : "?";
  }
  return out;
}

interface Item {
  text: string;
  width: number;
  run: DocRun;
  /** Espace insécable de fin de mot : sert au calcul de la justification. */
  space: boolean;
  tab: boolean;
}

interface Line {
  items: Item[];
  width: number;
  height: number;
  /** Ascendante approximative : où poser la ligne de base sous le haut de ligne. */
  ascent: number;
  /** Dernière ligne d'un paragraphe : elle ne se justifie pas. */
  last: boolean;
}

/** Découpe les runs en mots mesurables, sauts de ligne et tabulations compris. */
function items(runs: DocRun[], measure: Measure): (Item | "break")[] {
  const out: (Item | "break")[] = [];
  for (const run of runs) {
    if (run.text === "\n") { out.push("break"); continue; }
    if (run.text === "\t") {
      out.push({ text: "", width: TAB_PT, run, space: false, tab: true });
      continue;
    }
    // On garde l'espace qui suit chaque mot : sans lui, « a b » deviendrait « ab ».
    // La sanitisation a lieu ICI, avant la mesure : mesurer un texte et en
    // dessiner un autre décalerait toute la ligne.
    const parts = winAnsiSafe(run.text).split(/(\s+)/).filter((p) => p !== "");
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        const previous = out[out.length - 1];
        if (previous && previous !== "break") previous.space = true;
        continue;
      }
      out.push({
        text: part,
        width: measure(part, run.sizePt, run.bold, run.italic),
        run,
        space: false,
        tab: false,
      });
    }
  }
  return out;
}

function spaceWidth(run: DocRun, measure: Measure): number {
  return measure(" ", run.sizePt, run.bold, run.italic);
}

/**
 * Retour à la ligne glouton — celui de tous les traitements de texte : on
 * ajoute des mots tant qu'ils tiennent. Un mot plus large que la colonne est
 * coupé au caractère : mieux vaut une coupure qu'un débordement hors page.
 */
export function wrapParagraph(
  paragraph: DocParagraph,
  widthPt: number,
  measure: Measure,
): Line[] {
  const flat = items(paragraph.runs, measure);
  const lines: Line[] = [];
  let current: Item[] = [];
  let width = 0;
  let first = true;

  const available = () => Math.max(1, widthPt - (first ? Math.max(0, paragraph.indentFirstLinePt) : 0));
  const push = (last: boolean) => {
    const sizes = current.map((i) => i.run.sizePt);
    const max = sizes.length > 0 ? Math.max(...sizes) : (paragraph.runs[0]?.sizePt ?? 11);
    lines.push({
      items: current,
      width,
      height: max * LINE_FACTOR * paragraph.lineHeight,
      ascent: max * 0.86,
      last,
    });
    current = [];
    width = 0;
    first = false;
  };

  for (const entry of flat) {
    if (entry === "break") { push(false); continue; }
    let item = entry;
    // Mot trop large pour une ligne vide : coupure au caractère.
    if (item.width > available() && current.length === 0 && item.text.length > 1) {
      let head = item.text;
      while (head.length > 1 && measure(head, item.run.sizePt, item.run.bold, item.run.italic) > available()) {
        head = head.slice(0, -1);
      }
      const rest = item.text.slice(head.length);
      const headWidth = measure(head, item.run.sizePt, item.run.bold, item.run.italic);
      current.push({ ...item, text: head, width: headWidth });
      width += headWidth;
      push(false);
      item = {
        ...item,
        text: rest,
        width: measure(rest, item.run.sizePt, item.run.bold, item.run.italic),
      };
    }
    const gap = current.length > 0 && current[current.length - 1].space
      ? spaceWidth(current[current.length - 1].run, measure)
      : 0;
    if (current.length > 0 && width + gap + item.width > available()) push(false);
    else width += gap;
    current.push(item);
    width += item.width;
  }
  push(true);
  // Un paragraphe vide garde UNE ligne : c'est un blanc voulu par le rédacteur.
  return lines;
}

/** Position horizontale du début d'une ligne, selon l'alignement. */
function startX(line: Line, x: number, widthPt: number, align: Align): number {
  if (align === "center") return x + (widthPt - line.width) / 2;
  if (align === "right") return x + widthPt - line.width;
  return x;
}

/** Espace supplémentaire à répartir entre les mots d'une ligne justifiée. */
function justifyGap(line: Line, widthPt: number, align: Align, measure: Measure): number {
  if (align !== "justify" || line.last) return 0;
  const gaps = line.items.filter((i, index) => i.space && index < line.items.length - 1).length;
  if (gaps === 0) return 0;
  const natural = line.items.reduce((sum, item, index) => {
    const gap = item.space && index < line.items.length - 1 ? spaceWidth(item.run, measure) : 0;
    return sum + item.width + gap;
  }, 0);
  return Math.max(0, (widthPt - natural) / gaps);
}

/** Dessine une ligne déjà découpée. `top` = haut de la ligne. */
function drawLine(
  line: Line,
  x: number,
  top: number,
  widthPt: number,
  align: Align,
  measure: Measure,
): Piece[] {
  const pieces: Piece[] = [];
  const extra = justifyGap(line, widthPt, align, measure);
  const baseline = top + line.ascent;
  let cursor = startX(line, x, widthPt, align);
  line.items.forEach((item, index) => {
    if (item.tab) { cursor += item.width; return; }
    if (item.text !== "") {
      pieces.push({
        kind: "text",
        x: cursor,
        baseline,
        text: item.text,
        sizePt: item.run.sizePt,
        bold: item.run.bold,
        italic: item.run.italic,
        color: item.run.color,
      });
      if (item.run.underline) {
        const y = baseline + item.run.sizePt * 0.12;
        pieces.push({
          kind: "line",
          x1: cursor, y1: y, x2: cursor + item.width, y2: y,
          widthPt: Math.max(0.5, item.run.sizePt * 0.05),
        });
      }
    }
    cursor += item.width;
    if (item.space && index < line.items.length - 1) cursor += spaceWidth(item.run, measure) + extra;
  });
  return pieces;
}

/** Hauteur d'un bloc de paragraphes dans une colonne — sert aux cellules. */
function paragraphsHeight(paragraphs: DocParagraph[], widthPt: number, measure: Measure): number {
  return paragraphs.reduce((sum, paragraph) => {
    const lines = wrapParagraph(paragraph, widthPt - paragraph.indentLeftPt, measure);
    return sum + paragraph.spaceBeforePt + paragraph.spaceAfterPt
      + lines.reduce((h, line) => h + line.height, 0);
  }, 0);
}

function drawParagraphs(
  paragraphs: DocParagraph[],
  x: number,
  top: number,
  widthPt: number,
  measure: Measure,
): Piece[] {
  const pieces: Piece[] = [];
  let y = top;
  for (const paragraph of paragraphs) {
    y += paragraph.spaceBeforePt;
    const lines = wrapParagraph(paragraph, widthPt - paragraph.indentLeftPt, measure);
    lines.forEach((line, index) => {
      const indent = paragraph.indentLeftPt + (index === 0 ? Math.max(0, paragraph.indentFirstLinePt) : 0);
      pieces.push(...drawLine(line, x + indent, y, widthPt - indent, paragraph.align, measure));
      y += line.height;
    });
    y += paragraph.spaceAfterPt;
  }
  return pieces;
}

/** Largeurs de colonnes : celles du modèle, ramenées à la largeur utile. */
export function columnWidths(table: DocTable, contentWidthPt: number): number[] {
  const first = table.rows[0];
  if (!first) return [];
  const declared = first.cells.map((c) => c.widthPt);
  const total = declared.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return declared.map(() => contentWidthPt / declared.length);
  const factor = total > contentWidthPt ? contentWidthPt / total : 1;
  return declared.map((w) => (w > 0 ? w * factor : contentWidthPt / declared.length));
}

/**
 * Mise en page complète. Le flux est simple et assumé : les blocs se suivent,
 * une ligne qui ne tient plus ouvre une page, une ligne de tableau qui ne tient
 * plus ouvre une page. Pas de veuves ni d'orphelines : un courrier
 * administratif n'en meurt pas, et la fidélité de référence reste le .docx.
 */
export function layoutDocument(doc: ParsedDocument, measure: Measure): LaidOutDocument {
  const { section } = doc;
  const contentWidth = Math.max(
    1,
    section.widthPt - section.marginLeftPt - section.marginRightPt,
  );
  const bottom = section.heightPt - section.marginBottomPt;

  const pages: Piece[][] = [];
  let current: Piece[] = [];
  let y = section.marginTopPt;
  const newPage = () => {
    pages.push(current);
    current = [];
    y = section.marginTopPt;
  };

  for (const block of doc.blocks) {
    if (block.type === "paragraph") {
      const paragraph = block.paragraph;
      if (paragraph.pageBreakBefore && current.length > 0) newPage();
      y += paragraph.spaceBeforePt;
      const width = contentWidth - paragraph.indentLeftPt;
      const lines = wrapParagraph(paragraph, width, measure);
      lines.forEach((line, index) => {
        if (y + line.height > bottom && current.length > 0) newPage();
        const indent = paragraph.indentLeftPt
          + (index === 0 ? Math.max(0, paragraph.indentFirstLinePt) : 0);
        if (index === 0 && paragraph.bullet) {
          current.push({
            kind: "text",
            x: section.marginLeftPt + Math.max(0, paragraph.indentLeftPt - 12),
            baseline: y + line.ascent,
            text: paragraph.bullet,
            sizePt: line.items[0]?.run.sizePt ?? 11,
            bold: false, italic: false, color: null,
          });
        }
        current.push(...drawLine(
          line,
          section.marginLeftPt + indent,
          y,
          contentWidth - indent,
          paragraph.align,
          measure,
        ));
        y += line.height;
      });
      y += paragraph.spaceAfterPt;
      continue;
    }

    const table = block.table;
    const widths = columnWidths(table, contentWidth);
    for (const row of table.rows) {
      const heights = row.cells.map((cell, index) =>
        paragraphsHeight(cell.paragraphs, Math.max(1, (widths[index] ?? contentWidth) - 2 * CELL_PAD), measure));
      const rowHeight = Math.max(12, ...heights) + 2 * CELL_PAD;
      if (y + rowHeight > bottom && current.length > 0) newPage();

      let x = section.marginLeftPt;
      row.cells.forEach((cell, index) => {
        const width = widths[index] ?? contentWidth;
        current.push(...drawParagraphs(
          cell.paragraphs,
          x + CELL_PAD,
          y + CELL_PAD,
          Math.max(1, width - 2 * CELL_PAD),
          measure,
        ));
        if (table.bordered) {
          const right = x + width;
          const bottomY = y + rowHeight;
          current.push(
            { kind: "line", x1: x, y1: y, x2: right, y2: y, widthPt: 0.5 },
            { kind: "line", x1: x, y1: bottomY, x2: right, y2: bottomY, widthPt: 0.5 },
            { kind: "line", x1: x, y1: y, x2: x, y2: bottomY, widthPt: 0.5 },
            { kind: "line", x1: right, y1: y, x2: right, y2: bottomY, widthPt: 0.5 },
          );
        }
        x += width;
      });
      y += rowHeight;
    }
  }

  pages.push(current);
  return { widthPt: section.widthPt, heightPt: section.heightPt, pages };
}
