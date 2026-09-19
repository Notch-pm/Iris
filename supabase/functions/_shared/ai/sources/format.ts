/**
 * Quel extracteur pour quel fichier — et quoi dire quand il n'y en a pas.
 *
 * Formats LUS : ceux dont Iris sait tirer du texte sans service tiers — texte
 * brut, HTML, PDF à couche texte, et les formats bureautiques ouverts (DOCX,
 * ODT, PPTX, XLSX), qui sont des archives d'XML.
 *
 * Formats ÉCARTÉS, et NOMMÉS comme tels à l'agent : les anciens formats
 * binaires de Microsoft (.doc, .xls, .ppt), le RTF, et les images — une image
 * ou un PDF scanné demanderait une reconnaissance de caractères, facturée à la
 * page par le guichet du Socle ; elle mérite sa propre approbation et n'est
 * pas de ce lot.
 *
 * Module PUR, testé.
 */

export type Extractor = "text" | "html" | "pdf" | "docx" | "odt" | "pptx" | "xlsx";

export type ExtractorChoice =
  | { ok: true; extractor: Extractor }
  | { ok: false; reason: string };

const BY_EXTENSION: Record<string, Extractor> = {
  txt: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  tsv: "text",
  json: "text",
  html: "html",
  htm: "html",
  xhtml: "html",
  pdf: "pdf",
  docx: "docx",
  odt: "odt",
  pptx: "pptx",
  xlsx: "xlsx",
};

const UNREAD_EXTENSION: Record<string, string> = {
  doc: "ancien format Word (.doc), non lu",
  xls: "ancien format Excel (.xls), non lu",
  ppt: "ancien format PowerPoint (.ppt), non lu",
  rtf: "format RTF, non lu",
  odp: "présentation OpenDocument, non lue",
  ods: "classeur OpenDocument, non lu",
};

const BY_MIME: Record<string, Extractor> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  const slash = clean.lastIndexOf("/");
  return dot > slash && dot !== -1 ? clean.slice(dot + 1).toLowerCase() : "";
}

function mimeOf(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Pour un DOCUMENT, l'extension fait foi (c'est ce que le Socle a accepté au
 * téléversement) ; le type annoncé ne sert qu'à défaut. Pour une PAGE, c'est
 * l'inverse : `/reglement` peut servir du HTML comme du PDF, seul le serveur
 * le sait — `preferMime`.
 */
export function extractorFor(
  name: string,
  contentType?: string | null,
  preferMime = false,
): ExtractorChoice {
  const ext = extensionOf(name);
  const mime = mimeOf(contentType);
  const fromMime = BY_MIME[mime];
  const fromExt = BY_EXTENSION[ext];

  const chosen = preferMime ? fromMime ?? fromExt : fromExt ?? fromMime;
  if (chosen) return { ok: true, extractor: chosen };

  if (UNREAD_EXTENSION[ext]) return { ok: false, reason: UNREAD_EXTENSION[ext] };
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|heic|tiff?|bmp)$/.test(ext)) {
    return { ok: false, reason: "image — lecture par reconnaissance de caractères non activée" };
  }
  if (mime.startsWith("text/")) return { ok: true, extractor: "text" };
  return { ok: false, reason: "format non lu" };
}

/**
 * Une PAGE en ligne ne se lit que comme texte, HTML ou PDF. Un site qui
 * servirait une archive bureautique (DOCX, XLSX…) sous une adresse de page
 * n'atteint pas la décompression : c'est une porte de moins vers la mémoire
 * du serveur, et une page déclarée n'a aucune raison d'en être une.
 */
export function pageExtractor(name: string, contentType?: string | null): ExtractorChoice {
  const choice = extractorFor(name, contentType, true);
  if (!choice.ok) return choice;
  if (choice.extractor === "text" || choice.extractor === "html" || choice.extractor === "pdf") return choice;
  return { ok: false, reason: "format non lu pour une page en ligne" };
}

/** Jeux de caractères qu'on accepte de décoder ; tout autre ⇒ UTF-8. */
const CHARSETS = new Set(["utf-8", "utf8", "iso-8859-1", "iso-8859-15", "latin1", "windows-1252", "us-ascii"]);

function charsetFrom(value: string | null | undefined): string | null {
  const m = (value ?? "").match(/charset\s*=\s*["']?([\w-]+)/i);
  if (!m) return null;
  const charset = m[1].toLowerCase();
  return CHARSETS.has(charset) ? charset : null;
}

/**
 * Des octets vers du texte. Le jeu de caractères vient de l'en-tête HTTP, sinon
 * — pour du HTML — de la balise `<meta charset>` des premiers octets, sinon
 * UTF-8. Un octet invalide devient un caractère de remplacement : un texte
 * légèrement abîmé vaut mieux qu'une source perdue.
 */
export function decodeText(bytes: Uint8Array, contentType?: string | null, sniffHtml = false): string {
  let charset = charsetFrom(contentType);
  if (!charset && sniffHtml) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset = charsetFrom(head.match(/<meta[^>]+charset[^>]*>/i)?.[0]);
  }
  const text = new TextDecoder(charset ?? "utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Un PDF lu page par page : le texte, et le verdict « scanné ». Un PDF dont
 * les pages ne rendent presque rien n'est pas vide — c'est une image de
 * papier, qu'il faudrait passer en reconnaissance de caractères. On le dit
 * plutôt que de servir trois mots au modèle comme si c'était le document.
 */
export function pdfPagesToText(pages: string[]): { text: string; scanned: boolean } {
  const cleaned = pages.map((p) =>
    p.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  );
  const meaningful = cleaned.join("").replace(/\s/g, "").length;
  const scanned = pages.length > 0 && meaningful < Math.max(50, 20 * pages.length);
  return {
    text: cleaned.filter((p) => p !== "").join("\n\n"),
    scanned,
  };
}
