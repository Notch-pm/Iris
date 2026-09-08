import { describe, expect, it } from "vitest";
import { formatMib, httpStatusFor, inspectUpload } from "./inspect";
import { docmBytes, docxBytes, heicBytes, pdfBytes, svgBytes } from "./fixtures";

const MAX = 25 * 1_048_576;

describe("inspectUpload", () => {
  it("accepte un PDF nommé .pdf et rend son type détecté", () => {
    const r = inspectUpload({ bytes: pdfBytes(), fileName: "  Justificatif.pdf ", maxBytes: MAX });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type.mime).toBe("application/pdf");
      expect(r.fileName).toBe("Justificatif.pdf");
    }
  });

  it("refuse un fichier vide, un nom vide ou trop long", () => {
    expect(inspectUpload({ bytes: new Uint8Array(), fileName: "a.pdf", maxBytes: MAX })).toMatchObject({ code: "empty_file" });
    expect(inspectUpload({ bytes: pdfBytes(), fileName: "   ", maxBytes: MAX })).toMatchObject({ code: "bad_name" });
    expect(inspectUpload({ bytes: pdfBytes(), fileName: "a".repeat(300) + ".pdf", maxBytes: MAX })).toMatchObject({ code: "bad_name" });
  });

  it("refuse au-delà de la taille maximale, avec la limite dans le message", () => {
    const r = inspectUpload({ bytes: pdfBytes(), fileName: "a.pdf", maxBytes: 10 });
    expect(r).toMatchObject({ ok: false, code: "payload_too_large" });
    if (!r.ok) expect(r.message).toContain("0.0 Mo");
    expect(formatMib(25 * 1_048_576)).toBe("25 Mo");
    expect(formatMib(10 * 1_048_576)).toBe("10 Mo");
  });

  it("refuse un SVG même nommé .png, en citant les formats acceptés", () => {
    const r = inspectUpload({ bytes: svgBytes(), fileName: "image.png", maxBytes: MAX });
    expect(r).toMatchObject({ ok: false, code: "unsupported_media_type" });
    if (!r.ok) expect(r.message).toContain("PDF");
  });

  it("refuse un Office à macros avec un message qui dit quoi faire", () => {
    const r = inspectUpload({ bytes: docmBytes(), fileName: "modele.docm", maxBytes: MAX });
    expect(r).toMatchObject({ ok: false, code: "unsupported_media_type" });
    if (!r.ok) expect(r.message).toContain("macros");
  });

  it("refuse une extension qui ment sur le contenu, ou absente", () => {
    const menteur = inspectUpload({ bytes: pdfBytes(), fileName: "scan.jpg", maxBytes: MAX });
    expect(menteur).toMatchObject({ ok: false, code: "extension_mismatch" });
    if (!menteur.ok) expect(menteur.message).toContain(".jpg");
    const sans = inspectUpload({ bytes: docxBytes(), fileName: "courrier", maxBytes: MAX });
    expect(sans).toMatchObject({ ok: false, code: "extension_mismatch" });
    if (!sans.ok) expect(sans.message).toContain(".docx");
  });

  it("accepte .heif comme .heic pour une photo HEIC", () => {
    expect(inspectUpload({ bytes: heicBytes(), fileName: "IMG_0001.HEIF", maxBytes: MAX }).ok).toBe(true);
  });

  it("traduit chaque refus en statut HTTP", () => {
    expect(httpStatusFor("payload_too_large")).toBe(413);
    expect(httpStatusFor("unsupported_media_type")).toBe(415);
    expect(httpStatusFor("extension_mismatch")).toBe(422);
    expect(httpStatusFor("empty_file")).toBe(400);
    expect(httpStatusFor("bad_name")).toBe(400);
  });
});
