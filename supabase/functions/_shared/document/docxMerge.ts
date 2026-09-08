// Fusion des variables dans un document Word — module PUR (chaîne XML en
// entrée, chaîne XML en sortie), testé par vitest. Aucun zip, aucun réseau :
// ouvrir et refermer le .docx est le métier de l'appelant.
//
// ⚠️ LE PIÈGE, ET LA RAISON D'ÊTRE DE CE MODULE : Word ne garde pas un jeton
// d'un seul tenant. `{{usager.nom}}` tapé à la main se retrouve couramment
// découpé en cinq runs — `{{`, `usager`, `.no`, `m`, `}}` — parce que le
// correcteur orthographique, une révision ou un simple `rsid` a coupé le texte.
// Un remplacement naïf sur le XML ne trouve donc RIEN, ou pire, trouve la
// moitié des jetons. On travaille donc PARAGRAPHE PAR PARAGRAPHE : on recolle
// le texte de tous les `<w:t>`, on cherche les jetons dessus, puis on
// redistribue le résultat dans les mêmes nœuds — la mise en forme du premier
// run du jeton l'emporte, ce qui est le comportement attendu.

import { isImageVariable, isKnownLoop, isKnownVariable, type MergeContext } from "./variables.ts";

// ---- XML --------------------------------------------------------------------

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

const T_NODE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
const P_BLOCK = /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TOKEN = /\{\{([^{}]+)\}\}/g;

/** `xml:space="preserve"` TOUJOURS : sans lui, Word mange les espaces de bord. */
function textNodeXml(text: string): string {
  if (text === "") return '<w:t xml:space="preserve"></w:t>';
  // Un saut de ligne dans une valeur (bloc adresse) devient un vrai retour à la
  // ligne Word — `<w:br/>` entre deux `<w:t>`, ce qui reste valide dans un run.
  return text
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join("<w:br/>");
}

interface TextNode {
  /** Position du `<w:t …>…</w:t>` complet dans le XML du paragraphe. */
  start: number;
  end: number;
  /** Texte décodé. */
  text: string;
}

function textNodes(paragraphXml: string): TextNode[] {
  const nodes: TextNode[] = [];
  T_NODE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = T_NODE.exec(paragraphXml)) !== null) {
    nodes.push({ start: m.index, end: m.index + m[0].length, text: decodeXml(m[2]) });
  }
  return nodes;
}

/** Texte du paragraphe, runs recollés — la seule vue sur laquelle chercher. */
export function paragraphText(paragraphXml: string): string {
  return textNodes(paragraphXml).map((n) => n.text).join("");
}

// ---- Remplacement des jetons dans un paragraphe -----------------------------

/** Ce qu'une clé vaut. `null` = clé inconnue : le jeton est LAISSÉ TEL QUEL. */
export type Resolver = (key: string) => string | null;

/**
 * Remplace les jetons d'un paragraphe. Les caractères d'un jeton qui débordent
 * sur les runs suivants sont retirés ; la valeur entière est posée dans le run
 * où le jeton COMMENCE.
 *
 * Un jeton inconnu est laissé tel quel, délibérément : le modèle appartient à
 * la collectivité, et faire disparaître silencieusement `{{ma_variable}}` la
 * laisserait sans explication devant un courrier incomplet.
 */
export function mergeParagraph(paragraphXml: string, resolve: Resolver): string {
  const nodes = textNodes(paragraphXml);
  if (nodes.length === 0) return paragraphXml;

  const joined = nodes.map((n) => n.text).join("");
  if (!joined.includes("{{")) return paragraphXml;

  // Bornes de chaque nœud dans le texte recollé.
  const bounds: { from: number; to: number }[] = [];
  let offset = 0;
  for (const node of nodes) {
    bounds.push({ from: offset, to: offset + node.text.length });
    offset += node.text.length;
  }

  // Texte de sortie, nœud par nœud.
  const out = nodes.map(() => "");
  const nodeAt = (position: number): number => {
    for (let i = 0; i < bounds.length; i += 1) {
      if (position >= bounds[i].from && position < bounds[i].to) return i;
    }
    return bounds.length - 1;
  };

  let cursor = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(joined)) !== null) {
    const key = m[1].trim();
    const value = resolve(key);
    if (value === null) continue;  // inconnu : on n'y touche pas

    // Le texte qui précède le jeton reste dans ses nœuds d'origine.
    copyRange(joined, cursor, m.index, bounds, out);
    out[nodeAt(m.index)] += value;
    cursor = m.index + m[0].length;
  }
  if (cursor === 0) return paragraphXml;  // aucun jeton connu
  copyRange(joined, cursor, joined.length, bounds, out);

  // Réécriture : chaque `<w:t>` est remplacé par son nouveau contenu.
  let result = "";
  let last = 0;
  nodes.forEach((node, i) => {
    result += paragraphXml.slice(last, node.start) + textNodeXml(out[i]);
    last = node.end;
  });
  return result + paragraphXml.slice(last);
}

/** Recopie `joined[from, to)` dans les nœuds auxquels ces caractères appartiennent. */
function copyRange(
  joined: string,
  from: number,
  to: number,
  bounds: { from: number; to: number }[],
  out: string[],
): void {
  for (let i = 0; i < bounds.length; i += 1) {
    const start = Math.max(from, bounds[i].from);
    const end = Math.min(to, bounds[i].to);
    if (end > start) out[i] += joined.slice(start, end);
  }
}

// ---- Boucles ----------------------------------------------------------------

interface Paragraph {
  start: number;
  end: number;
  xml: string;
  text: string;
}

function paragraphs(xml: string): Paragraph[] {
  const list: Paragraph[] = [];
  P_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = P_BLOCK.exec(xml)) !== null) {
    list.push({
      start: m.index,
      end: m.index + m[0].length,
      xml: m[0],
      text: paragraphText(m[0]),
    });
  }
  return list;
}

const OPEN_LOOP = /\{\{#([^{}]+)\}\}/;

/**
 * Développe la première boucle rencontrée, puis se rappelle : `{{#liste}}` …
 * `{{/liste}}` répète tout ce qui se trouve ENTRE les deux paragraphes
 * marqueurs, une fois par élément, et les marqueurs disparaissent.
 *
 * Choix : la répétition se fait au PARAGRAPHE. Une boucle qui ouvre et ferme
 * dans le même paragraphe répète ce paragraphe. Les boucles imbriquées ne sont
 * pas gérées — aucun modèle n'en a eu besoin, et le jour où, ce sera un lot à
 * part avec ses propres tests.
 *
 * Une liste vide, ou inconnue, fait disparaître le bloc : un courrier ne montre
 * pas « aucune pièce » là où le modèle attendait des lignes.
 */
export function expandLoops(xml: string, ctx: MergeContext): string {
  const blocks = paragraphs(xml);
  for (let i = 0; i < blocks.length; i += 1) {
    const open = OPEN_LOOP.exec(blocks[i].text);
    if (!open) continue;
    const key = open[1].trim();
    const closeMark = `{{/${key}}}`;

    let closeIndex = -1;
    for (let j = i; j < blocks.length; j += 1) {
      if (blocks[j].text.includes(closeMark)) { closeIndex = j; break; }
    }
    if (closeIndex === -1) continue;  // marqueur d'ouverture orphelin : on laisse

    const items = ctx.lists[key] ?? [];
    const sameParagraph = closeIndex === i;
    const inner = sameParagraph
      ? blocks[i].xml
      : xml.slice(blocks[i].end, blocks[closeIndex].start);

    const repeated = items.map((item) => {
      const body = sameParagraph
        ? mergeParagraph(inner, (k) => (k === `#${key}` || k === `/${key}` ? "" : itemValue(item, ctx, k)))
        : mergeXml(inner, (k) => itemValue(item, ctx, k));
      return body;
    }).join("");

    const before = xml.slice(0, blocks[i].start);
    const after = xml.slice(blocks[closeIndex].end);
    // On recommence sur le résultat : une deuxième boucle peut suivre.
    return expandLoops(before + repeated + after, ctx);
  }
  return xml;
}

/** Dans une boucle, les clés RELATIVES l'emportent, le contexte global reste lisible. */
function itemValue(item: Record<string, string>, ctx: MergeContext, key: string): string | null {
  if (Object.hasOwn(item, key)) return item[key];
  if (Object.hasOwn(ctx.values, key)) return ctx.values[key];
  return null;
}

// ---- Fusion complète --------------------------------------------------------

/** Applique un résolveur à tous les paragraphes d'un fragment XML. */
export function mergeXml(xml: string, resolve: Resolver): string {
  return xml.replace(P_BLOCK, (paragraph) => mergeParagraph(paragraph, resolve));
}

/**
 * Fusion d'une partie du document (document.xml, en-tête, pied) : boucles
 * d'abord — elles produisent des paragraphes qu'il faut ensuite fusionner —
 * puis les variables simples.
 */
export function mergeDocumentXml(xml: string, ctx: MergeContext): string {
  const expanded = expandLoops(xml, ctx);
  return mergeXml(expanded, (key) => {
    if (Object.hasOwn(ctx.values, key)) {
      // Les variables d'image ne sont pas insérables aujourd'hui : elles
      // rendent du vide plutôt que leur URL (voir `isImageVariable`).
      return isImageVariable(key) ? "" : ctx.values[key];
    }
    return null;
  });
}

// ---- Inventaire d'un modèle -------------------------------------------------

export interface TemplateScan {
  /** Variables du catalogue trouvées dans le modèle. */
  variables: string[];
  /** Boucles du catalogue trouvées. */
  loops: string[];
  /** Variables d'image trouvées — reconnues, mais rendues vides. */
  images: string[];
  /** Jetons que le catalogue ne connaît pas : laissés tels quels à la fusion. */
  unknown: string[];
}

/**
 * Ce qu'un modèle demande, lu sur le texte RECOLLÉ (sans quoi un jeton coupé
 * par Word passerait pour inconnu). Sert l'aperçu avant génération.
 */
export function scanTemplate(xml: string): TemplateScan {
  const variables = new Set<string>();
  const loops = new Set<string>();
  const images = new Set<string>();
  const unknown = new Set<string>();

  for (const block of paragraphs(xml)) {
    TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN.exec(block.text)) !== null) {
      const raw = m[1].trim();
      if (raw.startsWith("#") || raw.startsWith("/")) {
        const key = raw.slice(1).trim();
        if (isKnownLoop(key)) loops.add(key);
        else unknown.add(raw);
        continue;
      }
      if (isImageVariable(raw)) { images.add(raw); continue; }
      if (isKnownVariable(raw)) { variables.add(raw); continue; }
      // Clé relative d'une boucle connue : elle n'a de sens qu'à l'intérieur,
      // et `expandLoops` s'en occupe. On ne la compte pas comme inconnue.
      if (!isRelativeLoopKey(raw)) unknown.add(raw);
    }
  }
  const sorted = (set: Set<string>) => [...set].sort();
  return {
    variables: sorted(variables),
    loops: sorted(loops),
    images: sorted(images),
    unknown: sorted(unknown),
  };
}

function isRelativeLoopKey(key: string): boolean {
  return ["libelle", "statut", "fichier"].includes(key);
}
