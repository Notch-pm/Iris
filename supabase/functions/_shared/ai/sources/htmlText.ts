/**
 * Une page HTML réduite à son texte lisible, pour le modèle.
 *
 * Ce n'est pas un moteur de rendu : c'est une réduction prudente, sans
 * dépendance, qui garde la STRUCTURE utile à un lecteur (titres, listes,
 * paragraphes, cellules) et jette ce qui n'est pas du contenu — scripts,
 * styles, navigation, en-têtes et pieds de site, formulaires. Quand la page
 * balise son contenu principal (`<main>`, sinon `<article>`), on ne lit que
 * lui : le menu d'un site public pèse souvent plus lourd que l'article.
 *
 * Les titres sont descendus sous ceux du prompt (`####` au moins), pour que le
 * titre d'une page ne se lise pas comme un bloc voisin — même règle que
 * `demoteHeadings` pour le descriptif usager.
 *
 * ⚠️ TEMPS LINÉAIRE, EXIGÉ. La page vient d'un tiers et le temps CPU d'une
 * edge function est compté (2 s). Une expression comme
 * `<nav\b[^>]*>[\s\S]*?<\/nav>` rebalaie le texte jusqu'au bout pour CHAQUE
 * ouvrante sans fermante : 2 Mo de `<nav ` suffisent à tuer la fonction. D'où
 * trois règles : jamais de `[\s\S]*?` entre deux balises (les éléments jetés
 * sont appariés par une pile, en une passe) ; `[^<>]*` et non `[^>]*` dans une
 * balise (la recherche s'arrête au chevron suivant) ; les commentaires retirés
 * par `indexOf`. Et l'entrée est bornée.
 *
 * Ce qui sort n'est jamais exécuté ni affiché tel quel : c'est de la DONNÉE,
 * enfermée par `prompt.ts` dans un bloc délimité et désamorcée par
 * `sanitizeBlock`.
 *
 * Module PUR, testé.
 */

/** Au-delà, la page est coupée avant tout traitement (une page lue fait 2 Mo au plus). */
export const MAX_HTML_CHARS = 3_000_000;

const DROPPED = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe", "object",
  "nav", "header", "footer", "aside", "form", "button", "select", "dialog",
]);
/** Éléments dont le contenu n'est JAMAIS du texte : non fermés, ils emportent la suite. */
const RAW_TEXT = new Set(["script", "style", "template", "svg"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", auml: "ä",
  ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö", ugrave: "ù", ucirc: "û",
  uuml: "ü", yuml: "ÿ", oelig: "œ", aelig: "æ",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Agrave: "À", Acirc: "Â", Ccedil: "Ç",
  Icirc: "Î", Ocirc: "Ô", Ugrave: "Ù", Ucirc: "Û", OElig: "Œ", AElig: "Æ",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", ndash: "–", mdash: "—", euro: "€", deg: "°", middot: "·",
  bull: "•", copy: "©", reg: "®", sect: "§", times: "×", shy: "",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Ni NUL, ni substituts isolés, ni hors Unicode : on garde l'entité brute.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return whole;
      }
      return String.fromCodePoint(code);
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Retire les commentaires ; un commentaire jamais fermé emporte la suite, comme dans un navigateur. */
function stripComments(html: string): string {
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = html.indexOf("<!--", cursor);
    if (start === -1) {
      parts.push(html.slice(cursor));
      break;
    }
    parts.push(html.slice(cursor, start));
    const end = html.indexOf("-->", start + 4);
    if (end === -1) break;
    cursor = end + 3;
  }
  return parts.join("");
}

/** Contenu du premier élément `tag` : première ouvrante, première fermante qui la suit. */
function innerOf(html: string, lower: string, tag: string): string | null {
  const open = new RegExp(`<${tag}(?=[\\s/>])[^<>]*>`, "i").exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  const close = lower.indexOf(`</${tag}`, from);
  return close === -1 ? null : html.slice(from, close);
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])[^<>]*>/g;

/**
 * Jette les éléments de `DROPPED` avec leur contenu, en une passe : les
 * balises sont relevées une fois, appariées par une pile par nom, puis
 * parcourues. Un élément jamais fermé ne perd que sa balise (un `<nav>`
 * orphelin n'efface pas la page) — sauf un élément de texte brut (`<script>`),
 * dont la suite n'est pas du texte.
 */
function dropElements(html: string): string {
  const tags = [...html.matchAll(TAG)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    name: m[2].toLowerCase(),
    closing: m[1] === "/",
    self: m[0].endsWith("/>"),
  }));

  const closeOf = new Map<number, number>();
  const stacks = new Map<string, number[]>();
  tags.forEach((t, i) => {
    if (!DROPPED.has(t.name) || t.self) return;
    let stack = stacks.get(t.name);
    if (!stack) stacks.set(t.name, stack = []);
    if (!t.closing) {
      stack.push(i);
    } else {
      const open = stack.pop();
      if (open !== undefined) closeOf.set(open, t.end);
    }
  });

  const out: string[] = [];
  let cursor = 0;
  tags.forEach((t, i) => {
    if (t.start < cursor || t.closing || !DROPPED.has(t.name)) return;
    out.push(html.slice(cursor, t.start), " ");
    const end = t.self ? t.end : closeOf.get(i);
    cursor = end ?? (RAW_TEXT.has(t.name) ? html.length : t.end);
  });
  out.push(html.slice(cursor));
  return out.join("");
}

export interface HtmlText {
  title: string;
  text: string;
}

export function htmlToText(html: string): HtmlText {
  let source = typeof html === "string" ? html : "";
  if (source.length > MAX_HTML_CHARS) source = source.slice(0, MAX_HTML_CHARS);
  source = stripComments(source);
  const lower = source.toLowerCase();

  const title = decodeEntities((innerOf(source, lower, "title") ?? "").replace(/<[^<>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

  // Le contenu principal quand la page le balise.
  const body = innerOf(source, lower, "main") ?? innerOf(source, lower, "article") ??
    innerOf(source, lower, "body") ?? source;

  const text = decodeEntities(
    dropElements(body)
      .replace(/<h([1-6])(?=[\s/>])[^<>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Math.min(6, Number(level) + 3))} `)
      .replace(/<\/h[1-6]\s*>/gi, "\n\n")
      .replace(/<li(?=[\s/>])[^<>]*>/gi, "\n- ")
      .replace(/<br(?=[\s/>])[^<>]*>/gi, "\n")
      .replace(/<\/t[dh]\s*>/gi, " | ")
      .replace(
        /<\/?(?:p|div|section|article|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|blockquote|figure|figcaption|pre|address|hr)(?=[\s/>])[^<>]*>/gi,
        "\n",
      )
      .replace(/<[^<>]*>/g, ""),
  )
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}
