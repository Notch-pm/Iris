/**
 * Markdown minimal — l'exact nécessaire pour rendre les textes libres du
 * Socle (consignes d'agent et procédures de la base de connaissances, saisis
 * en Markdown dans l'éditeur de démarche).
 *
 * Pas de dépendance : un rendu Markdown complet coûterait 40 ko de bundle pour
 * du texte de service qui tient en titres, listes, gras et liens. Et surtout,
 * ce module ne produit **jamais de HTML** — il rend une structure que React
 * affiche en éléments : aucun `dangerouslySetInnerHTML`, donc aucune injection
 * possible depuis un champ du référentiel.
 *
 * Ce qui est reconnu : titres `#` à `###`, listes à puces et numérotées,
 * citations `>`, filets `---`, et en ligne `**gras**`, `*italique*`,
 * `` `code` ``, `[texte](url)` et les URL nues. Le reste est du texte, affiché
 * tel quel — un `~~barré~~` non compris se lit encore.
 *
 * Module PUR (aucun DOM), testé.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/**
 * Un élément de liste et sa PROFONDEUR (0 = premier niveau). L'indentation
 * du texte source la porte : 2 à 4 espaces = un cran, et ainsi de suite,
 * plafonnée à 3 — ce que l'assistant IA et les rédacteurs de fiches écrivent
 * couramment (« - Pièces :\n  - CNI\n  - justificatif »). Une ligne indentée
 * SANS puce sous un élément en est la suite, pas un nouveau paragraphe.
 */
export interface ListItem {
  content: Inline[];
  depth: number;
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; content: Inline[] }
  | { kind: "rule" };

/**
 * Schémas admis pour un lien. Un `javascript:` (ou `data:`) écrit dans une
 * fiche du référentiel ne doit pas devenir cliquable : il retombe en texte.
 */
const SAFE_SCHEME = /^(https?:|mailto:)/i;

export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url === "") return null;
  if (SAFE_SCHEME.test(url)) return url;
  // Domaine nu écrit sans schéma (« service-public.fr/… ») : on suppose https.
  if (/^www\.[^\s]+$/i.test(url)) return `https://${url}`;
  return null;
}

// Une seule passe, l'ordre des alternatives portant la priorité : le contenu
// d'un `code` est littéral, un lien avant l'emphase (son libellé peut en
// contenir), le gras avant l'italique (`**` avant `*`).
const INLINE_RE =
  /`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|((?:https?:\/\/|www\.)[^\s<>()[\]]+)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text !== "") out.push({ kind: "text", text });
  };

  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(source)) !== null) {
    push(source.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined && m[3] !== undefined) {
      const href = safeHref(m[3]);
      const label = m[2] === "" ? m[3] : m[2];
      // Lien non sûr : le libellé reste lisible, il n'est simplement pas cliquable.
      if (href) out.push({ kind: "link", text: label, href });
      else push(label);
    } else if (m[4] !== undefined) out.push({ kind: "strong", text: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "strong", text: m[5] });
    else if (m[6] !== undefined) out.push({ kind: "em", text: m[6] });
    else if (m[7] !== undefined) out.push({ kind: "em", text: m[7] });
    else if (m[8] !== undefined) {
      const href = safeHref(m[8]);
      if (href) out.push({ kind: "link", text: m[8], href });
      else push(m[8]);
    }
  }
  push(source.slice(last));
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const MAX_LIST_DEPTH = 3;

/** Profondeur d'un élément d'après son indentation (tabulation = 4 espaces). */
function listDepth(indent: string): number {
  const width = indent.replace(/\t/g, "    ").length;
  return Math.min(MAX_LIST_DEPTH, Math.ceil(width / 4));
}
const QUOTE_RE = /^\s*>\s?(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = (source ?? "").replace(/\r\n?/g, "\n").split("\n");

  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: { text: string; depth: number }[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // Les retours à la ligne d'un texte de service sont voulus : ils sont
    // conservés (le rendu applique `whitespace-pre-line`).
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push({ kind: "quote", content: parseInline(quote.join("\n")) });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      kind: "list",
      ordered: list.ordered,
      items: list.items.map((item) => ({ content: parseInline(item.text), depth: item.depth })),
    });
    list = null;
  };
  const flushAll = () => { flushParagraph(); flushQuote(); flushList(); };

  for (const line of lines) {
    if (line.trim() === "") { flushAll(); continue; }

    if (RULE_RE.test(line)) { flushAll(); blocks.push({ kind: "rule" }); continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, content: parseInline(heading[2].trim()) });
      continue;
    }

    const quoted = QUOTE_RE.exec(line);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }

    const ordered = ORDERED_RE.exec(line);
    const bullet = ordered ? null : BULLET_RE.exec(line);
    if (ordered || bullet) {
      flushParagraph(); flushQuote();
      const isOrdered = Boolean(ordered);
      // Changer de type de liste ferme la précédente.
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      const match = ordered ?? bullet!;
      list.items.push({ text: match[2].trim(), depth: listDepth(match[1]) });
      continue;
    }

    // Une ligne INDENTÉE sous un élément de liste en est la suite (l'assistant
    // IA coupe volontiers un élément long sur deux lignes) : la rattacher
    // plutôt que de fermer la liste et d'ouvrir un paragraphe orphelin.
    if (list && /^\s+\S/.test(line)) {
      const last = list.items[list.items.length - 1];
      last.text = `${last.text}\n${line.trim()}`;
      continue;
    }

    flushQuote(); flushList();
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks;
}

/** Y a-t-il quelque chose à afficher ? (texte blanc ⇒ aucun bloc) */
export function hasMarkdown(source: string | null | undefined): boolean {
  return typeof source === "string" && source.trim() !== "";
}
