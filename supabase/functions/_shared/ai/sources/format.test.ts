import { describe, expect, it } from "vitest";
import { decodeText, extractorFor, pageExtractor, pdfPagesToText } from "./format";

describe("extractorFor", () => {
  it("un document : l'extension fait foi", () => {
    expect(extractorFor("Guide.pdf", "application/octet-stream")).toEqual({ ok: true, extractor: "pdf" });
    expect(extractorFor("bareme.XLSX")).toEqual({ ok: true, extractor: "xlsx" });
    expect(extractorFor("note.md")).toEqual({ ok: true, extractor: "text" });
    expect(extractorFor("liste.csv")).toEqual({ ok: true, extractor: "text" });
  });

  it("une page : le type servi fait foi", () => {
    expect(extractorFor("/reglement", "text/html; charset=utf-8", true)).toEqual({ ok: true, extractor: "html" });
    expect(extractorFor("/reglement.html", "application/pdf", true)).toEqual({ ok: true, extractor: "pdf" });
  });

  it("nomme ce qu'il ne lit pas", () => {
    const doc = extractorFor("ancien.doc");
    expect(doc.ok).toBe(false);
    if (!doc.ok) expect(doc.reason).toContain(".doc");
    const img = extractorFor("scan.jpg", "image/jpeg");
    expect(img.ok).toBe(false);
    if (!img.ok) expect(img.reason).toContain("reconnaissance de caractères");
    expect(extractorFor("archive.zip").ok).toBe(false);
  });

  it("un type texte inconnu se lit comme du texte", () => {
    expect(extractorFor("/flux", "text/x-inconnu", true)).toEqual({ ok: true, extractor: "text" });
  });
});

describe("decodeText", () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // « café » en Latin-1

  it("lit le jeu de caractères de l'en-tête", () => {
    expect(decodeText(latin1, "text/plain; charset=ISO-8859-1")).toBe("café");
  });

  it("lit la balise meta d'une page HTML", () => {
    const html = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="windows-1252"><p>'),
      0x63, 0x61, 0x66, 0xe9,
    ]);
    expect(decodeText(html, "text/html", true)).toContain("café");
  });

  it("UTF-8 par défaut, sans le BOM", () => {
    expect(decodeText(new TextEncoder().encode("﻿élan"))).toBe("élan");
  });
});

describe("pdfPagesToText", () => {
  it("assemble les pages et resserre les blancs", () => {
    const r = pdfPagesToText([
      "Article 1   —  objet du règlement\n\n\n\nLe présent règlement fixe les conditions.",
      "Article 2   —  tarifs applicables en zone résidentielle.",
    ]);
    expect(r.text).toBe(
      "Article 1 — objet du règlement\n\nLe présent règlement fixe les conditions.\n\n" +
        "Article 2 — tarifs applicables en zone résidentielle.",
    );
    expect(r.scanned).toBe(false);
  });

  it("reconnaît un PDF scanné : des pages qui ne rendent presque rien", () => {
    expect(pdfPagesToText(["", " ", "3"]).scanned).toBe(true);
    expect(pdfPagesToText(["Titre", "", "", "", ""]).scanned).toBe(true);
  });
});

describe("pageExtractor — une page en ligne n'est que texte, HTML ou PDF", () => {
  it("accepte les trois", () => {
    expect(pageExtractor("/a", "text/html")).toEqual({ ok: true, extractor: "html" });
    expect(pageExtractor("/a.pdf", "application/pdf")).toEqual({ ok: true, extractor: "pdf" });
    expect(pageExtractor("/a", "text/plain")).toEqual({ ok: true, extractor: "text" });
  });

  it("refuse une archive bureautique servie comme une page", () => {
    const r = pageExtractor(
      "/rapport",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(r.ok).toBe(false);
    expect(pageExtractor("/classeur.xlsx", "application/octet-stream").ok).toBe(false);
  });
});
