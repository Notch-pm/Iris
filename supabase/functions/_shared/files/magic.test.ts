import { describe, expect, it } from "vitest";
import {
  acceptAttribute,
  ALLOWED_TYPES,
  allowedMimeTypes,
  extensionMatches,
  extensionOf,
  inlineViewable,
  sniffFile,
  typeForMime,
} from "./magic";
import {
  docmBytes,
  docxBytes,
  elfBytes,
  exeBytes,
  gifBytes,
  heicBytes,
  htmlBytes,
  jpegBytes,
  odsBytes,
  odtBytes,
  pdfBytes,
  plainZipBytes,
  pngBytes,
  svgBytes,
  webpBytes,
  xlsxBytes,
} from "./fixtures";

function mimeOf(bytes: Uint8Array): string | null {
  const r = sniffFile(bytes);
  return r.kind === "type" ? r.type.mime : null;
}

describe("sniffFile — chaque type accepté est reconnu à ses octets", () => {
  it.each([
    ["PDF", pdfBytes(), "application/pdf"],
    ["JPEG", jpegBytes(), "image/jpeg"],
    ["PNG", pngBytes(), "image/png"],
    ["GIF", gifBytes(), "image/gif"],
    ["WebP", webpBytes(), "image/webp"],
    ["HEIC", heicBytes(), "image/heic"],
    ["DOCX", docxBytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["XLSX", xlsxBytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["ODT", odtBytes(), "application/vnd.oasis.opendocument.text"],
    ["ODS", odsBytes(), "application/vnd.oasis.opendocument.spreadsheet"],
  ])("%s", (_label, bytes, mime) => {
    expect(mimeOf(bytes)).toBe(mime);
  });
});

describe("sniffFile — ce qui est refusé", () => {
  it("ne reconnaît ni SVG, ni HTML, ni exécutable, ni fichier trop court", () => {
    expect(sniffFile(svgBytes())).toEqual({ kind: "unknown" });
    expect(sniffFile(htmlBytes())).toEqual({ kind: "unknown" });
    expect(sniffFile(exeBytes())).toEqual({ kind: "unknown" });
    expect(sniffFile(elfBytes())).toEqual({ kind: "unknown" });
    expect(sniffFile(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toEqual({ kind: "unknown" });
  });

  it("refuse un document Office à macros (vbaProject.bin)", () => {
    expect(sniffFile(docmBytes())).toEqual({ kind: "refused", reason: "macros" });
  });

  it("refuse une archive ZIP quelconque, et un ZIP tronqué", () => {
    expect(sniffFile(plainZipBytes())).toEqual({ kind: "refused", reason: "archive" });
    expect(sniffFile(docxBytes().slice(0, 40))).toEqual({ kind: "refused", reason: "archive" });
  });

  it("ne se laisse pas tromper par une extension : c'est le contenu qui décide", () => {
    // Un SVG nommé .png reste inconnu ; un PDF nommé .jpg reste un PDF.
    expect(sniffFile(svgBytes()).kind).toBe("unknown");
    expect(mimeOf(pdfBytes())).toBe("application/pdf");
  });
});

describe("extensions et affichage", () => {
  it("l'extension du nom doit correspondre au type détecté", () => {
    const pdf = typeForMime("application/pdf")!;
    expect(extensionMatches("piece.pdf", pdf)).toBe(true);
    expect(extensionMatches("piece.PDF", pdf)).toBe(true);
    expect(extensionMatches("piece.jpg", pdf)).toBe(false);
    expect(extensionMatches("sans-extension", pdf)).toBe(false);
    expect(extensionOf(".htaccess")).toBe("");
    expect(extensionOf("photo.final.JPEG")).toBe("jpeg");
  });

  it("seuls PDF et images raster se regardent dans l'onglet", () => {
    expect(inlineViewable("application/pdf")).toBe(true);
    expect(inlineViewable("image/jpeg; charset=binary")).toBe(true);
    expect(inlineViewable("image/heic")).toBe(false);
    expect(inlineViewable("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(inlineViewable(null)).toBe(false);
    expect(inlineViewable("image/svg+xml")).toBe(false);
  });

  it("la liste des MIME du bucket est exactement celle des types acceptés, sans SVG ni HTML", () => {
    const mimes = allowedMimeTypes();
    expect(mimes).toHaveLength(ALLOWED_TYPES.length);
    expect(mimes).not.toContain("image/svg+xml");
    expect(mimes).not.toContain("text/html");
    expect(new Set(mimes).size).toBe(mimes.length);
  });

  it("l'attribut accept se restreint aux formats demandés par la démarche", () => {
    expect(acceptAttribute()).toContain(".pdf");
    expect(acceptAttribute()).toContain(".heic");
    expect(acceptAttribute(["pdf", ".JPG"])).toBe(".pdf,.jpg");
    // Un format demandé par le Socle mais refusé par Iris n'apparaît pas.
    expect(acceptAttribute(["svg"])).toBe("");
  });
});
