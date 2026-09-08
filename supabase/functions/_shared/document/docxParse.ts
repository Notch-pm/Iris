// Lecture d'un document Word FUSIONNÉ vers un modèle intermédiaire — module
// PUR (chaîne XML en entrée, objets en sortie), testé par vitest.
//
// POURQUOI CE MODÈLE : le .docx téléchargé garde la mise en page du modèle à
// l'identique ; le PDF, lui, est REDESSINÉ par Iris (décision du 2026-09-01 :
// aucun convertisseur externe, aucun document qui sort de la gamme). Il faut
// donc relire le Word et en tirer ce qu'un courrier a besoin de porter.
//
// CE QU'ON LIT : le format et les marges de la section, les paragraphes (avec
// alignement, espacements, retraits, sauts de page), les runs (gras, italique,
// souligné, taille, couleur), les tableaux simples, les sauts de ligne et les
// tabulations, et les styles nommés (docDefaults + `w:pStyle`, chaîne
// `basedOn` résolue) — sans quoi tous les titres sortiraient en corps de texte.
//
// CE QU'ON NE LIT PAS, ET QUI EST DIT À L'ÉCRAN : les images, les en-têtes et
// pieds de page, les colonnes, les cadres, les filigranes, les tableaux
// imbriqués. Un modèle qui en dépend doit être téléchargé en Word.

// ---- Modèle intermédiaire ---------------------------------------------------

export interface DocRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Taille en points (Word la stocke en demi-points). */
  sizePt: number;
  /** « 1b7a4b » — sans dièse, comme Word. `null` = encre par défaut. */
  color: string | null;
}

export type Align = "left" | "center" | "right" | "justify";

export interface DocParagraph {
  runs: DocRun[];
  align: Align;
  spaceBeforePt: number;
  spaceAfterPt: number;
  /** Interligne multiplicateur (1 = simple). */
  lineHeight: number;
  indentLeftPt: number;
  indentFirstLinePt: number;
  pageBreakBefore: boolean;
  /** Puce d'une liste à puces ou numérotée — le texte à poser dans la marge. */
  bullet: string | null;
}

export interface DocCell {
  paragraphs: DocParagraph[];
  widthPt: number;
}

export interface DocTable {
  rows: { cells: DocCell[] }[];
  bordered: boolean;
}

export type DocBlock =
  | { type: "paragraph"; paragraph: DocParagraph }
  | { type: "table"; table: DocTable };

export interface DocSection {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
}

export interface ParsedDocument {
  section: DocSection;
  blocks: DocBlock[];
  /** Ce que le rendu PDF ne saura pas montrer — à dire à l'agent, pas à taire. */
  warnings: string[];
}

/** A4 portrait, marges 2,5 cm — le repli quand la section est muette. */
export const DEFAULT_SECTION: DocSection = {
  widthPt: 595.28,
  heightPt: 841.89,
  marginTopPt: 70.87,
  marginRightPt: 70.87,
  marginBottomPt: 70.87,
  marginLeftPt: 70.87,
};

const DEFAULT_SIZE_PT = 11;

// ---- Petit lecteur XML (le sous-ensemble WordprocessingML suffit) -----------

/** Valeur d'un attribut `w:name` sur la balise ouvrante fournie. */
export function attrValue(tag: string, name: string): string | null {
  const m = new RegExp(`\\sw:${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** Twips (1/20 de point) → points. */
function twips(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 20 : null;
}

/** Première balise `<w:name …>…</w:name>` (ou auto-fermante) du fragment. */
function firstTag(xml: string, name: string): { full: string; open: string; inner: string } | null {
  const re = new RegExp(`<w:${name}\\b([^>]*)/>|<w:${name}\\b([^>]*)>([\\s\\S]*?)</w:${name}>`);
  const m = re.exec(xml);
  if (!m) return null;
  return {
    full: m[0],
    open: m[0].startsWith(`<w:${name}`) ? m[0] : m[0],
    inner: m[3] ?? "",
  };
}

/** Toutes les balises `<w:name>` d'un fragment, dans l'ordre. */
function allTags(xml: string, name: string): { full: string; inner: string }[] {
  const re = new RegExp(`<w:${name}\\b[^>]*/>|<w:${name}\\b[^>]*>([\\s\\S]*?)</w:${name}>`, "g");
  const out: { full: string; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ full: m[0], inner: m[1] ?? "" });
  return out;
}

/** Présence d'un interrupteur Word : `<w:b/>` ou `<w:b w:val="1"/>`, mais pas `w:val="0"`. */
function toggle(xml: string, name: string): boolean {
  const re = new RegExp(`<w:${name}\\b([^>]*)/?>`);
  const m = re.exec(xml);
  if (!m) return false;
  const val = attrValue(m[0], "val");
  return val === null || !["0", "false", "none"].includes(val);
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, c: string) => String.fromCodePoint(Number(c)))
    .replace(/&amp;/g, "&");
}

// ---- Styles -----------------------------------------------------------------

interface StyleProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sizePt?: number;
  color?: string | null;
  align?: Align;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  lineHeight?: number;
}

export interface StyleBook {
  /** Ce que `w:docDefaults` impose à tout le document. */
  defaults: StyleProps;
  byId: Map<string, StyleProps>;
}

export const EMPTY_STYLES: StyleBook = { defaults: {}, byId: new Map() };

function readRunProps(rPr: string): StyleProps {
  const props: StyleProps = {};
  if (toggle(rPr, "b")) props.bold = true;
  if (toggle(rPr, "i")) props.italic = true;
  const u = /<w:u\b([^>]*)\/?>/.exec(rPr);
  if (u && attrValue(u[0], "val") !== "none") props.underline = true;
  const sz = /<w:sz\b([^>]*)\/?>/.exec(rPr);
  const half = sz ? Number(attrValue(sz[0], "val")) : NaN;
  if (Number.isFinite(half) && half > 0) props.sizePt = half / 2;
  const color = /<w:color\b([^>]*)\/?>/.exec(rPr);
  const hex = color ? attrValue(color[0], "val") : null;
  if (hex && hex.toLowerCase() !== "auto") props.color = hex;
  return props;
}

const ALIGNMENTS: Record<string, Align> = {
  left: "left", start: "left", center: "center", centre: "center",
  right: "right", end: "right", both: "justify", justify: "justify",
};

function readParagraphProps(pPr: string): StyleProps {
  const props: StyleProps = {};
  const jc = /<w:jc\b([^>]*)\/?>/.exec(pPr);
  const align = jc ? ALIGNMENTS[attrValue(jc[0], "val") ?? ""] : undefined;
  if (align) props.align = align;
  const spacing = /<w:spacing\b([^>]*)\/?>/.exec(pPr);
  if (spacing) {
    const before = twips(attrValue(spacing[0], "before"));
    const after = twips(attrValue(spacing[0], "after"));
    if (before !== null) props.spaceBeforePt = before;
    if (after !== null) props.spaceAfterPt = after;
    const rule = attrValue(spacing[0], "lineRule");
    const line = Number(attrValue(spacing[0], "line"));
    // `auto` : 240 = interligne simple. Sinon (`exact`/`atLeast`), la valeur est
    // en twips — on la ramène en multiplicateur d'une ligne de 12 pt.
    if (Number.isFinite(line) && line > 0) {
      props.lineHeight = rule === "auto" || rule === null ? line / 240 : line / 20 / 12;
    }
  }
  return props;
}

/** `styles.xml` → défauts du document et styles nommés, chaîne `basedOn` résolue. */
export function parseStyles(stylesXml: string): StyleBook {
  const defaults: StyleProps = {};
  const docDefaults = firstTag(stylesXml, "docDefaults");
  if (docDefaults) {
    Object.assign(defaults, readRunProps(docDefaults.inner), readParagraphProps(docDefaults.inner));
  }

  const raw = new Map<string, { props: StyleProps; basedOn: string | null }>();
  for (const style of allTags(stylesXml, "style")) {
    const id = attrValue(style.full.slice(0, style.full.indexOf(">") + 1), "styleId");
    if (!id) continue;
    const basedOn = /<w:basedOn\b([^>]*)\/?>/.exec(style.inner);
    raw.set(id, {
      props: { ...readRunProps(style.inner), ...readParagraphProps(style.inner) },
      basedOn: basedOn ? attrValue(basedOn[0], "val") : null,
    });
  }

  // Résolution de l'héritage — « Titre 1 » hérite de « Normal ». Profondeur
  // bornée : un `basedOn` circulaire existe dans la nature.
  const byId = new Map<string, StyleProps>();
  for (const [id] of raw) {
    const chain: StyleProps[] = [];
    let current: string | null = id;
    const seen = new Set<string>();
    while (current && !seen.has(current) && chain.length < 12) {
      seen.add(current);
      const entry: { props: StyleProps; basedOn: string | null } | undefined = raw.get(current);
      if (!entry) break;
      chain.unshift(entry.props);
      current = entry.basedOn;
    }
    byId.set(id, Object.assign({}, ...chain) as StyleProps);
  }
  return { defaults, byId };
}

// ---- Paragraphes et runs ----------------------------------------------------

function baseParagraph(props: StyleProps): DocParagraph {
  return {
    runs: [],
    align: props.align ?? "left",
    spaceBeforePt: props.spaceBeforePt ?? 0,
    spaceAfterPt: props.spaceAfterPt ?? 0,
    lineHeight: props.lineHeight ?? 1,
    indentLeftPt: 0,
    indentFirstLinePt: 0,
    pageBreakBefore: false,
    bullet: null,
  };
}

function parseParagraph(xml: string, styles: StyleBook, warnings: Set<string>): DocParagraph {
  const pPrTag = firstTag(xml, "pPr");
  const pPr = pPrTag ? pPrTag.inner : "";

  const styleId = (() => {
    const m = /<w:pStyle\b([^>]*)\/?>/.exec(pPr);
    return m ? attrValue(m[0], "val") : null;
  })();
  const fromStyle = styleId ? styles.byId.get(styleId) ?? {} : {};
  const props: StyleProps = { ...styles.defaults, ...fromStyle, ...readParagraphProps(pPr) };
  const paragraph = baseParagraph(props);

  const ind = /<w:ind\b([^>]*)\/?>/.exec(pPr);
  if (ind) {
    paragraph.indentLeftPt = twips(attrValue(ind[0], "left")) ?? 0;
    const first = twips(attrValue(ind[0], "firstLine")) ?? 0;
    const hanging = twips(attrValue(ind[0], "hanging")) ?? 0;
    paragraph.indentFirstLinePt = first - hanging;
  }
  paragraph.pageBreakBefore = toggle(pPr, "pageBreakBefore");
  // Une liste : Word ne stocke que le lien vers la numérotation. On pose une
  // puce, sans chercher à retrouver le format exact (numbering.xml) — le
  // dernier mot reste au .docx pour qui a besoin de la numérotation d'origine.
  if (/<w:numPr\b/.test(pPr)) {
    paragraph.bullet = "•";
    warnings.add("numerotation");
  }

  const runStyle: StyleProps = {
    ...styles.defaults,
    ...(styleId ? styles.byId.get(styleId) ?? {} : {}),
  };

  for (const r of allTags(xml, "r")) {
    const rPrTag = firstTag(r.inner, "rPr");
    const rPr = rPrTag ? rPrTag.inner : "";
    const rStyleId = (() => {
      const m = /<w:rStyle\b([^>]*)\/?>/.exec(rPr);
      return m ? attrValue(m[0], "val") : null;
    })();
    const merged: StyleProps = {
      ...runStyle,
      ...(rStyleId ? styles.byId.get(rStyleId) ?? {} : {}),
      ...readRunProps(rPr),
    };
    const style = {
      bold: merged.bold ?? false,
      italic: merged.italic ?? false,
      underline: merged.underline ?? false,
      sizePt: merged.sizePt ?? DEFAULT_SIZE_PT,
      color: merged.color ?? null,
    };

    // Contenu du run, dans l'ordre : texte, sauts de ligne, tabulations.
    const CONTENT = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:br\b[^>]*\/?>|<w:tab\b[^>]*\/?>|<w:drawing\b/g;
    let m: RegExpExecArray | null;
    while ((m = CONTENT.exec(r.inner)) !== null) {
      if (m[0].startsWith("<w:drawing")) { warnings.add("image"); continue; }
      if (m[0].startsWith("<w:br")) { paragraph.runs.push({ ...style, text: "\n" }); continue; }
      if (m[0].startsWith("<w:tab")) { paragraph.runs.push({ ...style, text: "\t" }); continue; }
      paragraph.runs.push({ ...style, text: decode(m[1] ?? "") });
    }
  }
  return paragraph;
}

// ---- Tableaux ---------------------------------------------------------------

function parseTable(xml: string, styles: StyleBook, warnings: Set<string>): DocTable {
  const tblPr = firstTag(xml, "tblPr");
  const bordered = tblPr ? /<w:tblBorders\b/.test(tblPr.inner) : false;

  const rows: { cells: DocCell[] }[] = [];
  for (const tr of allTags(xml, "tr")) {
    const cells: DocCell[] = [];
    for (const tc of allTags(tr.inner, "tc")) {
      const tcPr = firstTag(tc.inner, "tcPr");
      const w = tcPr ? /<w:tcW\b([^>]*)\/?>/.exec(tcPr.inner) : null;
      const type = w ? attrValue(w[0], "type") : null;
      const widthPt = w && type === "dxa" ? twips(attrValue(w[0], "w")) ?? 0 : 0;
      if (/<w:tbl\b/.test(tc.inner)) warnings.add("tableau_imbrique");
      cells.push({
        widthPt,
        paragraphs: allTags(tc.inner, "p").map((p) => parseParagraph(p.inner, styles, warnings)),
      });
    }
    if (cells.length > 0) rows.push({ cells });
  }
  return { rows, bordered };
}

// ---- Section ----------------------------------------------------------------

export function parseSection(bodyXml: string): DocSection {
  const sectPr = firstTag(bodyXml, "sectPr");
  if (!sectPr) return DEFAULT_SECTION;
  const pgSz = /<w:pgSz\b([^>]*)\/?>/.exec(sectPr.inner);
  const pgMar = /<w:pgMar\b([^>]*)\/?>/.exec(sectPr.inner);
  const width = pgSz ? twips(attrValue(pgSz[0], "w")) : null;
  const height = pgSz ? twips(attrValue(pgSz[0], "h")) : null;
  return {
    widthPt: width ?? DEFAULT_SECTION.widthPt,
    heightPt: height ?? DEFAULT_SECTION.heightPt,
    marginTopPt: (pgMar ? twips(attrValue(pgMar[0], "top")) : null) ?? DEFAULT_SECTION.marginTopPt,
    marginRightPt: (pgMar ? twips(attrValue(pgMar[0], "right")) : null) ?? DEFAULT_SECTION.marginRightPt,
    marginBottomPt: (pgMar ? twips(attrValue(pgMar[0], "bottom")) : null) ?? DEFAULT_SECTION.marginBottomPt,
    marginLeftPt: (pgMar ? twips(attrValue(pgMar[0], "left")) : null) ?? DEFAULT_SECTION.marginLeftPt,
  };
}

// ---- Document ---------------------------------------------------------------

const WARNING_LABELS: Record<string, string> = {
  image: "les images du modèle ne sont pas reprises",
  entete: "l'en-tête et le pied de page ne sont pas repris",
  numerotation: "les listes numérotées deviennent des puces",
  tableau_imbrique: "les tableaux imbriqués ne sont pas repris",
};

/**
 * `document.xml` fusionné (+ `styles.xml` s'il est disponible) → blocs à mettre
 * en page. Les avertissements listent, en français, ce que le PDF ne montrera
 * pas — l'écran les répète avant de générer.
 */
export function parseDocument(documentXml: string, stylesXml = ""): ParsedDocument {
  const styles = stylesXml ? parseStyles(stylesXml) : EMPTY_STYLES;
  const body = firstTag(documentXml, "body");
  const inner = body ? body.inner : documentXml;
  const warnings = new Set<string>();
  if (/<w:headerReference\b|<w:footerReference\b/.test(documentXml)) warnings.add("entete");

  const blocks: DocBlock[] = [];
  // Paragraphes et tableaux de PREMIER NIVEAU, dans l'ordre du document : on
  // balaie le corps en repérant l'ouverture de l'un ou de l'autre.
  const TOP = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = TOP.exec(inner)) !== null) {
    if (m[0].startsWith("<w:tbl")) {
      blocks.push({ type: "table", table: parseTable(m[0], styles, warnings) });
    } else {
      blocks.push({ type: "paragraph", paragraph: parseParagraph(m[0], styles, warnings) });
    }
  }

  return {
    section: parseSection(inner),
    blocks,
    warnings: [...warnings].map((w) => WARNING_LABELS[w] ?? w),
  };
}
