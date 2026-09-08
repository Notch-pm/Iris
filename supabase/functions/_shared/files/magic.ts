// Types de fichiers acceptés dans le bucket `request-attachments`, et leur
// reconnaissance par SIGNATURE BINAIRE. Logique pure (ni Deno, ni réseau),
// partagée par les edge functions (réception) et l'écran (attribut `accept`,
// choix « Voir » / « Télécharger »).
//
// ⚠️ LA LISTE EST FERMÉE, ET C'EST LA DÉFENSE. Rien ici ne « scanne » un
// fichier : on refuse tout ce qui n'est pas un format de justificatif ou de
// document bureautique reconnaissable à ses premiers octets — donc jamais un
// SVG, un HTML, un exécutable, une archive quelconque ni un document Office
// à macros. Le type ANNONCÉ par le client (`Content-Type`, extension) n'est
// jamais cru : c'est le contenu qui décide, et l'extension doit s'y accorder.
//
// Ce que la liste retient, et pourquoi :
//   · PDF et images raster (JPEG, PNG, WebP, GIF) — l'essentiel des
//     justificatifs, consultables dans l'onglet (inline) ;
//   · HEIC/HEIF — le format par défaut des photos iPhone : le refuser ferait
//     échouer les dépôts mobiles depuis le portail. Les navigateurs ne
//     l'affichent pas : téléchargement seulement ;
//   · DOCX, XLSX, ODT, ODS — le service produit lui-même du Word, et reçoit
//     des formulaires bureautiques. Refus des variantes à macros (DOCM/XLSM :
//     `vbaProject.bin` dans l'archive) et des anciens conteneurs OLE
//     (.doc/.xls), impossibles à distinguer sûrement d'un porteur de macros.
//   · Rien de « sans signature » (TXT, CSV, RTF) : inopposable, et aucun
//     `acceptedFormats` du Socle ne le demande en pratique.

export interface AllowedType {
  /** Type MIME canonique — celui qui est ÉCRIT dans le bucket et en base. */
  readonly mime: string;
  /** Extensions admises (minuscules, sans point). */
  readonly extensions: readonly string[];
  /** Consultable dans l'onglet du navigateur ; sinon téléchargement forcé. */
  readonly inline: boolean;
  /** Libellé humain (messages d'écran). */
  readonly label: string;
}

export const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: "application/pdf", extensions: ["pdf"], inline: true, label: "PDF" },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"], inline: true, label: "JPEG" },
  { mime: "image/png", extensions: ["png"], inline: true, label: "PNG" },
  { mime: "image/webp", extensions: ["webp"], inline: true, label: "WebP" },
  { mime: "image/gif", extensions: ["gif"], inline: true, label: "GIF" },
  { mime: "image/heic", extensions: ["heic", "heif"], inline: false, label: "HEIC" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: ["docx"], inline: false, label: "Word",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: ["xlsx"], inline: false, label: "Excel",
  },
  { mime: "application/vnd.oasis.opendocument.text", extensions: ["odt"], inline: false, label: "OpenDocument texte" },
  { mime: "application/vnd.oasis.opendocument.spreadsheet", extensions: ["ods"], inline: false, label: "OpenDocument tableur" },
];

/** Libellé de la liste, pour les messages de refus et les aides de saisie. */
export const ACCEPTED_FORMATS_LABEL =
  "PDF, JPEG, PNG, WebP, HEIC, GIF, Word (.docx), Excel (.xlsx), OpenDocument (.odt, .ods)";

/** Valeur de `allowed_mime_types` du bucket : exactement les types écrits. */
export function allowedMimeTypes(): string[] {
  return ALLOWED_TYPES.map((t) => t.mime);
}

/** Attribut `accept` d'un `<input type="file">` (extensions, pas MIME : plus fiable sur mobile). */
export function acceptAttribute(extensions?: readonly string[]): string {
  const wanted = extensions && extensions.length > 0
    ? new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, "")))
    : null;
  const out: string[] = [];
  for (const t of ALLOWED_TYPES) {
    for (const ext of t.extensions) {
      if (!wanted || wanted.has(ext)) out.push(`.${ext}`);
    }
  }
  return out.join(",");
}

export function typeForMime(mime: string | null | undefined): AllowedType | null {
  if (!mime) return null;
  const m = mime.toLowerCase().split(";")[0].trim();
  return ALLOWED_TYPES.find((t) => t.mime === m) ?? null;
}

/** Une pièce se regarde dans l'onglet seulement si son type est un PDF ou une image raster. */
export function inlineViewable(mime: string | null | undefined): boolean {
  return typeForMime(mime)?.inline ?? false;
}

export function extensionOf(fileName: string): string {
  const base = fileName.trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** L'extension du nom doit correspondre au type DÉTECTÉ — jamais l'inverse. */
export function extensionMatches(fileName: string, type: AllowedType): boolean {
  return type.extensions.includes(extensionOf(fileName));
}

export type SniffResult =
  | { kind: "type"; type: AllowedType }
  | { kind: "unknown" }
  /** Une archive ZIP reconnue mais refusée : Office à macros, ou ZIP quelconque. */
  | { kind: "refused"; reason: "macros" | "archive" };

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"]);

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return "";
  let out = "";
  for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}
function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000;
}
function byType(mime: string): AllowedType {
  return ALLOWED_TYPES.find((t) => t.mime === mime)!;
}

/** Reconnaît le type d'un fichier à ses octets. Ne lit jamais l'extension. */
export function sniffFile(bytes: Uint8Array): SniffResult {
  if (bytes.length < 12) return { kind: "unknown" };
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "type", type: byType("application/pdf") };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "type", type: byType("image/jpeg") };
  }
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a
      && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { kind: "type", type: byType("image/png") };
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return { kind: "type", type: byType("image/gif") };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "type", type: byType("image/webp") };
  }
  if (ascii(bytes, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 4).toLowerCase())) {
    return { kind: "type", type: byType("image/heic") };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return sniffZip(bytes);
  }
  return { kind: "unknown" };
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/**
 * Entrées du répertoire central d'un ZIP (fin de fichier) — la seule façon
 * fiable de lister une archive sans la décompresser : les en-têtes locaux
 * peuvent ne pas porter les tailles (descripteurs de données).
 */
function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const min = Math.max(0, bytes.length - 22 - 65_535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return null; // ZIP64 : hors périmètre
  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length) return null;
    if (!(bytes[pos] === 0x50 && bytes[pos + 1] === 0x4b && bytes[pos + 2] === 0x01 && bytes[pos + 3] === 0x02)) {
      return null;
    }
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    entries.push({
      name: ascii(bytes, pos + 46, nameLen),
      method: u16(bytes, pos + 10),
      compressedSize: u32(bytes, pos + 20),
      localOffset: u32(bytes, pos + 42),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Contenu d'une entrée STOCKÉE (non compressée) — suffit pour `mimetype` d'un OpenDocument. */
function storedEntryContent(bytes: Uint8Array, entry: ZipEntry): string | null {
  if (entry.method !== 0) return null;
  const lo = entry.localOffset;
  if (lo + 30 > bytes.length) return null;
  if (!(bytes[lo] === 0x50 && bytes[lo + 1] === 0x4b && bytes[lo + 2] === 0x03 && bytes[lo + 3] === 0x04)) return null;
  const nameLen = u16(bytes, lo + 26);
  const extraLen = u16(bytes, lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  return ascii(bytes, start, entry.compressedSize);
}

function sniffZip(bytes: Uint8Array): SniffResult {
  const entries = zipEntries(bytes);
  if (entries === null) return { kind: "refused", reason: "archive" };
  const names = entries.map((e) => e.name);
  // Un document Office à macros porte TOUJOURS son projet VBA en clair dans l'archive.
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return { kind: "refused", reason: "macros" };

  const mimetype = entries.find((e) => e.name === "mimetype");
  if (mimetype) {
    const declared = storedEntryContent(bytes, mimetype)?.trim();
    if (declared === "application/vnd.oasis.opendocument.text") {
      return { kind: "type", type: byType("application/vnd.oasis.opendocument.text") };
    }
    if (declared === "application/vnd.oasis.opendocument.spreadsheet") {
      return { kind: "type", type: byType("application/vnd.oasis.opendocument.spreadsheet") };
    }
    return { kind: "refused", reason: "archive" };
  }
  if (names.includes("word/document.xml")) {
    return { kind: "type", type: byType("application/vnd.openxmlformats-officedocument.wordprocessingml.document") };
  }
  if (names.includes("xl/workbook.xml")) {
    return { kind: "type", type: byType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") };
  }
  return { kind: "refused", reason: "archive" };
}
