import { describe, expect, it } from "vitest";
import type { DocParagraph, DocRun, ParsedDocument } from "./docxParse";
import {
  columnWidths, layoutDocument, winAnsiSafe, wrapParagraph, type Piece, type TextPiece,
} from "./pdfLayout";

/** Mesure de test : chaque caractère vaut la moitié de la taille de police. */
const measure = (text: string, sizePt: number) => text.length * sizePt * 0.5;

function run(text: string, extra: Partial<DocRun> = {}): DocRun {
  return { text, bold: false, italic: false, underline: false, sizePt: 10, color: null, ...extra };
}

function paragraph(runs: DocRun[], extra: Partial<DocParagraph> = {}): DocParagraph {
  return {
    runs, align: "left", spaceBeforePt: 0, spaceAfterPt: 0, lineHeight: 1,
    indentLeftPt: 0, indentFirstLinePt: 0, pageBreakBefore: false, bullet: null,
    ...extra,
  };
}

const SECTION = {
  widthPt: 300, heightPt: 200,
  marginTopPt: 20, marginRightPt: 20, marginBottomPt: 20, marginLeftPt: 20,
};

function doc(blocks: ParsedDocument["blocks"]): ParsedDocument {
  return { section: SECTION, blocks, warnings: [] };
}

const texts = (pieces: Piece[]): TextPiece[] =>
  pieces.filter((p): p is TextPiece => p.kind === "text");

describe("retour à la ligne", () => {
  it("coupe entre les mots quand la ligne est pleine", () => {
    // « alpha » = 25 pt, « beta » = 20 pt, espace = 5 pt : 50 pt tiennent, pas 75.
    const lines = wrapParagraph(paragraph([run("alpha beta gamma")]), 55, measure);
    expect(lines.map((l) => l.items.map((i) => i.text).join(" "))).toEqual(["alpha beta", "gamma"]);
  });

  it("un saut de ligne explicite ouvre une ligne", () => {
    const lines = wrapParagraph(paragraph([run("a"), run("\n"), run("b")]), 500, measure);
    expect(lines).toHaveLength(2);
  });

  it("un mot plus large que la colonne est coupé au caractère", () => {
    const lines = wrapParagraph(paragraph([run("interminable")]), 30, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.items.map((i) => i.text).join("")).join("")).toBe("interminable");
  });

  it("un paragraphe vide garde une ligne — c'est un blanc voulu", () => {
    expect(wrapParagraph(paragraph([]), 100, measure)).toHaveLength(1);
  });

  it("la hauteur de ligne suit la plus grande police", () => {
    const lines = wrapParagraph(paragraph([run("a", { sizePt: 20 }), run(" b")]), 500, measure);
    expect(lines[0].height).toBeGreaterThan(20);
  });
});

describe("alignements", () => {
  const content = SECTION.widthPt - SECTION.marginLeftPt - SECTION.marginRightPt; // 260

  it("à gauche : le texte commence à la marge", () => {
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: paragraph([run("abcd")]) }]), measure);
    expect(texts(pages.pages[0])[0].x).toBe(20);
  });

  it("centré et à droite", () => {
    const centered = layoutDocument(
      doc([{ type: "paragraph", paragraph: paragraph([run("abcd")], { align: "center" }) }]),
      measure,
    );
    const right = layoutDocument(
      doc([{ type: "paragraph", paragraph: paragraph([run("abcd")], { align: "right" }) }]),
      measure,
    );
    expect(texts(centered.pages[0])[0].x).toBe(20 + (content - 20) / 2);
    expect(texts(right.pages[0])[0].x).toBe(20 + content - 20);
  });

  it("justifié : les espaces s'élargissent, sauf sur la dernière ligne", () => {
    // Assez de texte pour DEUX lignes : la première se justifie, la seconde non.
    const p = paragraph(
      [run("aaaaaa bbbbbb cccccc dddddd eeeeee ffffff gggggg hhhhhh iiiiii")],
      { align: "justify" },
    );
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: p }]), measure);
    const first = texts(pages.pages[0]).filter((t) => t.baseline === texts(pages.pages[0])[0].baseline);
    const last = first[first.length - 1];
    // La dernière boîte de la première ligne touche la marge de droite.
    expect(last.x + measure(last.text, last.sizePt)).toBeCloseTo(20 + content, 5);
  });
});

describe("flux des pages", () => {
  it("ouvre une page quand la ligne ne tient plus", () => {
    const many = Array.from({ length: 20 }, () => ({
      type: "paragraph" as const, paragraph: paragraph([run("ligne")]),
    }));
    const pages = layoutDocument(doc(many), measure);
    expect(pages.pages.length).toBeGreaterThan(1);
    // Rien ne dépasse la marge basse.
    for (const page of pages.pages) {
      for (const piece of texts(page)) expect(piece.baseline).toBeLessThanOrEqual(180);
    }
  });

  it("un saut de page explicite en ouvre une, même à moitié remplie", () => {
    const pages = layoutDocument(doc([
      { type: "paragraph", paragraph: paragraph([run("avant")]) },
      { type: "paragraph", paragraph: paragraph([run("après")], { pageBreakBefore: true }) },
    ]), measure);
    expect(pages.pages).toHaveLength(2);
    expect(texts(pages.pages[1])[0].text).toBe("après");
  });

  it("le premier texte d'une page part de la marge haute", () => {
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: paragraph([run("x")]) }]), measure);
    expect(texts(pages.pages[0])[0].baseline).toBeCloseTo(20 + 10 * 0.86, 5);
  });
});

describe("tableaux", () => {
  const table = {
    bordered: true,
    rows: [{
      cells: [
        { widthPt: 100, paragraphs: [paragraph([run("Clé")])] },
        { widthPt: 300, paragraphs: [paragraph([run("Valeur")])] },
      ],
    }],
  };

  it("ramène les colonnes à la largeur utile", () => {
    expect(columnWidths(table, 260)).toEqual([65, 195]);
  });

  it("des colonnes sans largeur se partagent la place", () => {
    const sansLargeur = { bordered: false, rows: [{ cells: [
      { widthPt: 0, paragraphs: [] }, { widthPt: 0, paragraphs: [] },
    ] }] };
    expect(columnWidths(sansLargeur, 260)).toEqual([130, 130]);
  });

  it("dessine quatre traits par cellule quand le tableau est bordé", () => {
    const pages = layoutDocument(doc([{ type: "table", table }]), measure);
    const lines = pages.pages[0].filter((p) => p.kind === "line");
    expect(lines).toHaveLength(8);
  });

  it("un tableau sans bordure ne dessine aucun trait", () => {
    const pages = layoutDocument(doc([{ type: "table", table: { ...table, bordered: false } }]), measure);
    expect(pages.pages[0].filter((p) => p.kind === "line")).toHaveLength(0);
  });
});

describe("détails de rendu", () => {
  it("le souligné produit un trait sous le texte", () => {
    const p = paragraph([run("souligné", { underline: true })]);
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: p }]), measure);
    const line = pages.pages[0].find((piece) => piece.kind === "line");
    const text = texts(pages.pages[0])[0];
    expect(line).toBeDefined();
    if (line?.kind !== "line") return;
    expect(line.y1).toBeGreaterThan(text.baseline);
  });

  it("une puce est posée dans la marge du paragraphe", () => {
    const p = paragraph([run("item")], { bullet: "•", indentLeftPt: 20 });
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: p }]), measure);
    const puce = texts(pages.pages[0])[0];
    expect(puce.text).toBe("•");
    expect(puce.x).toBe(20 + 8);
  });

  it("les accents français passent, un pictogramme exotique devient « ? »", () => {
    // Un caractère hors encodage ferait échouer la génération entière.
    expect(winAnsiSafe("Éclairage défectueux — cœur, 12 €")).toBe("Éclairage défectueux — cœur, 12 €");
    expect(winAnsiSafe("flèche → ici")).toBe("flèche ? ici");
  });

  it("le texte dessiné est celui qui a été mesuré", () => {
    const p = paragraph([run("a→b")]);
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: p }]), measure);
    expect(texts(pages.pages[0])[0].text).toBe("a?b");
  });

  it("la couleur et la graisse suivent le run", () => {
    const p = paragraph([run("rouge", { color: "FF0000", bold: true })]);
    const pages = layoutDocument(doc([{ type: "paragraph", paragraph: p }]), measure);
    expect(texts(pages.pages[0])[0]).toMatchObject({ color: "FF0000", bold: true });
  });
});
