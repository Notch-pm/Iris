/**
 * Le texte des formats bureautiques ouverts — DOCX, ODT, PPTX, XLSX.
 *
 * Tous quatre sont des archives d'XML. L'archive est ouverte ailleurs
 * (`read.ts`, seule brique à dépendre d'une bibliothèque de zip) ; ce module
 * ne reçoit que ses parties, et n'en tire que le TEXTE, dans l'ordre de
 * lecture :
 *
 *  • DOCX : réutilise `parseDocument` de la génération de courriers — la même
 *    lecture des paragraphes, puces et tableaux, déjà éprouvée sur de vrais
 *    modèles Word (runs coupés, tabulations, sauts de ligne) ;
 *  • ODT : les paragraphes et titres de `content.xml` ;
 *  • PPTX : diapositive par diapositive, dans l'ordre de leur numéro ;
 *  • XLSX : feuille par feuille, une ligne de tableur = une ligne de texte,
 *    cellules séparées par « | » — valeurs partagées résolues.
 *
 * `maxChars` borne le TRAVAIL, pas seulement la sortie : un classeur de
 * 50 000 lignes ne doit pas coûter son parcours entier quand l'enveloppe de
 * l'assistant n'en gardera que quelques pages — le temps CPU d'une edge
 * function est compté.
 *
 * Module PUR, testé.
 */

import { parseDocument, type DocParagraph } from "../../document/docxParse.ts";
import { decodeEntities } from "./htmlText.ts";

export type OfficeFiles = Record<string, Uint8Array>;
export type OfficeFormat = "docx" | "odt" | "pptx" | "xlsx";

function xml(files: OfficeFiles, path: string): string | null {
  const entry = files[path];
  return entry ? new TextDecoder().decode(entry) : null;
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Des lignes, jusqu'au plafond. */
class Lines {
  private readonly lines: string[] = [];
  private size = 0;
  constructor(private readonly max: number) {}
  get full(): boolean {
    return this.size >= this.max;
  }
  push(line: string): void {
    if (this.full) return;
    this.lines.push(line);
    this.size += line.length + 1;
  }
  text(): string {
    return tidy(this.lines.join("\n"));
  }
}

/** Numéro d'une partie (`slide12.xml` → 12) pour trier dans l'ordre de lecture. */
function partNumber(path: string): number {
  const m = path.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

function paragraphText(p: DocParagraph): string {
  const text = p.runs.map((r) => r.text).join("");
  return p.bullet && text.trim() !== "" ? `- ${text}` : text;
}

function docxText(files: OfficeFiles, max: number): string {
  const documentXml = xml(files, "word/document.xml");
  if (!documentXml) return "";
  const parsed = parseDocument(documentXml, xml(files, "word/styles.xml") ?? "");
  const out = new Lines(max);
  for (const block of parsed.blocks) {
    if (out.full) break;
    if (block.type === "paragraph") {
      out.push(paragraphText(block.paragraph));
      continue;
    }
    for (const row of block.table.rows) {
      const cells = row.cells.map((cell) => cell.paragraphs.map(paragraphText).join(" ").trim());
      if (cells.some((c) => c !== "")) out.push(cells.join(" | "));
    }
    out.push("");
  }
  return out.text();
}

/**
 * Texte d'un fragment XML : les espaces explicites et tabulations de
 * l'OpenDocument et de DrawingML sont rendus, les balises retirées, les
 * entités décodées.
 */
function inlineText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<text:s\b[^>]*c="(\d+)"[^>]*\/>/g, (_m, n: string) => " ".repeat(Math.min(Number(n), 8)))
      .replace(/<text:s\b[^>]*\/>/g, " ")
      .replace(/<(text:tab|a:tab)\b[^>]*\/>/g, "\t")
      .replace(/<(text:line-break|a:br)\b[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function odtText(files: OfficeFiles, max: number): string {
  const content = xml(files, "content.xml");
  if (!content) return "";
  const body = (content.match(/<office:text\b[^>]*>([\s\S]*)<\/office:text>/)?.[1] ?? content)
    // Révisions suivies (le texte SUPPRIMÉ y est conservé) et commentaires :
    // rien de cela n'est le document.
    .replace(/<text:tracked-changes\b[\s\S]*?<\/text:tracked-changes>/g, "")
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, "")
    // Le premier paragraphe d'un élément de liste est marqué, pour porter sa puce.
    .replace(/(<text:list-item\b[^>]*>\s*)<text:p\b/g, "$1<text:p iris-li=\"1\"");
  const out = new Lines(max);
  const BLOCK = /<text:(h|p)\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:\1>)/g;
  let m: RegExpExecArray | null;
  while (!out.full && (m = BLOCK.exec(body)) !== null) {
    const text = inlineText(m[2] ?? "");
    if (m[1] === "h") {
      out.push(`\n#### ${text}\n`);
    } else {
      out.push(m[0].startsWith("<text:p iris-li") && text.trim() !== "" ? `- ${text}` : text);
    }
  }
  return out.text();
}

function pptxText(files: OfficeFiles, max: number): string {
  const slides = Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const out = new Lines(max);
  for (const path of slides) {
    if (out.full) break;
    const slide = xml(files, path) ?? "";
    const paragraphs = [...slide.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map((m) => inlineText(m[1]).trim())
      .filter((t) => t !== "");
    if (paragraphs.length === 0) continue;
    out.push(`#### Diapositive ${partNumber(path)}`);
    for (const p of paragraphs) out.push(p);
    out.push("");
  }
  return out.text();
}

/** Les chaînes partagées d'un classeur, dans leur ordre d'index. */
export function sharedStrings(source: string): string[] {
  return [...source.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    // Un texte enrichi est découpé en runs `<r><t>…</t></r>` : on les recolle,
    // sans lire la prononciation phonétique (`<rPh>`) qui les double.
    decodeEntities(
      [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => t[1])
        .join(""),
    )
  );
}

function xlsxText(files: OfficeFiles, max: number): string {
  const sharedXml = xml(files, "xl/sharedStrings.xml");
  const shared = sharedXml ? sharedStrings(sharedXml) : [];
  const sheets = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => partNumber(a) - partNumber(b));
  const out = new Lines(max);
  for (const path of sheets) {
    if (out.full) break;
    const sheet = xml(files, path) ?? "";
    let heading = false;
    for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (out.full) break;
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = cell[1].match(/\bt="([^"]+)"/)?.[1];
        const inner = cell[2] ?? "";
        let value: string;
        if (type === "inlineStr") {
          value = decodeEntities([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
        } else {
          const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
          value = type === "s" ? shared[Number(raw)] ?? "" : type === "e" ? "" : decodeEntities(raw);
        }
        cells.push(value.replace(/\s+/g, " ").trim());
      }
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      if (!cells.some((c) => c !== "")) continue;
      if (!heading) {
        out.push(`#### Feuille ${partNumber(path)}`);
        heading = true;
      }
      out.push(cells.join(" | "));
    }
    if (heading) out.push("");
  }
  return out.text();
}

/** Les seules parties d'une archive qu'on lit, par format. */
const WANTED: Record<OfficeFormat, RegExp> = {
  docx: /^word\/(document|styles)\.xml$/,
  odt: /^content\.xml$/,
  pptx: /^ppt\/slides\/slide\d+\.xml$/,
  xlsx: /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/,
};

export function officePartWanted(format: OfficeFormat, name: string): boolean {
  return WANTED[format].test(name);
}

/** Ce que l'archive déclare d'une entrée, avant toute décompression (motif fflate). */
export interface ZipEntryInfo {
  name: string;
  /** Taille compressée. */
  size: number;
  /** Taille déclarée une fois décompressée — c'est elle que la bibliothèque alloue. */
  originalSize: number;
}

export interface UnzipLimits {
  /** Taille décompressée maximale d'une entrée. */
  maxEntry: number;
  /** Taille décompressée cumulée maximale. */
  maxTotal: number;
  /** Rapport de compression maximal — au-delà, c'est une bombe, pas un document. */
  maxRatio: number;
}

export const UNZIP_LIMITS: UnzipLimits = {
  maxEntry: 8 * 1024 * 1024,
  maxTotal: 24 * 1024 * 1024,
  maxRatio: 200,
};

/**
 * Le filtre à passer à la décompression : SEULES les parties lues, et sous
 * plafonds. Sans lui, la bibliothèque décompresse TOUTES les entrées en
 * allouant la taille qu'elles DÉCLARENT : 2 Mo d'archive suffisent à demander
 * 2 Go de mémoire, et la edge function tombe — à chaque question, puisque la
 * source approuvée est relue à chaque tour. Une entrée refusée est simplement
 * absente : le texte sera partiel, jamais la fonction à terre.
 *
 * Le filtre est À ÉTAT (le cumul) : un filtre par archive.
 */
export function unzipFilter(
  format: OfficeFormat,
  limits: UnzipLimits = UNZIP_LIMITS,
): (entry: ZipEntryInfo) => boolean {
  let total = 0;
  return (entry) => {
    if (!officePartWanted(format, entry.name)) return false;
    if (entry.originalSize > limits.maxEntry) return false;
    if (entry.size > 0 && entry.originalSize / entry.size > limits.maxRatio) return false;
    if (total + entry.originalSize > limits.maxTotal) return false;
    total += entry.originalSize;
    return true;
  };
}

export function officeText(format: OfficeFormat, files: OfficeFiles, maxChars = Infinity): string {
  switch (format) {
    case "docx": return docxText(files, maxChars);
    case "odt": return odtText(files, maxChars);
    case "pptx": return pptxText(files, maxChars);
    case "xlsx": return xlsxText(files, maxChars);
  }
}
