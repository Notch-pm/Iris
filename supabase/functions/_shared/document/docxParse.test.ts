import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, parseDocument, parseSection, parseStyles } from "./docxParse";

function body(inner: string, sectPr = ""): string {
  return `<w:document><w:body>${inner}${sectPr}</w:body></w:document>`;
}

describe("section", () => {
  it("lit le format et les marges en twips", () => {
    const xml = body("", '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1134"/></w:sectPr>');
    const section = parseSection(xml);
    expect(Math.round(section.widthPt)).toBe(595);
    expect(Math.round(section.heightPt)).toBe(842);
    expect(Math.round(section.marginTopPt)).toBe(71);
    expect(Math.round(section.marginLeftPt)).toBe(57);
  });

  it("retombe sur A4 quand la section est muette", () => {
    expect(parseSection("<w:body/>")).toEqual(DEFAULT_SECTION);
  });
});

describe("paragraphes et runs", () => {
  it("lit l'alignement, les espacements et les retraits", () => {
    const xml = body(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/>' +
      '<w:ind w:left="720" w:firstLine="360"/></w:pPr>' +
      '<w:r><w:t>Titre</w:t></w:r></w:p>',
    );
    const p = parseDocument(xml).blocks[0];
    expect(p.type).toBe("paragraph");
    if (p.type !== "paragraph") return;
    expect(p.paragraph.align).toBe("center");
    expect(p.paragraph.spaceBeforePt).toBe(12);
    expect(p.paragraph.spaceAfterPt).toBe(6);
    expect(p.paragraph.indentLeftPt).toBe(36);
    expect(p.paragraph.indentFirstLinePt).toBe(18);
  });

  it("lit gras, italique, souligné, taille (demi-points) et couleur", () => {
    const xml = body(
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:sz w:val="28"/>' +
      '<w:color w:val="1B7A4B"/></w:rPr><w:t>Gras</w:t></w:r></w:p>',
    );
    const p = parseDocument(xml).blocks[0];
    if (p.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(p.paragraph.runs[0]).toEqual({
      text: "Gras", bold: true, italic: true, underline: true, sizePt: 14, color: "1B7A4B",
    });
  });

  it("un interrupteur à 0 ne compte pas (Word écrit `w:val=\"0\"` pour désactiver)", () => {
    const xml = body('<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Normal</w:t></w:r></w:p>');
    const p = parseDocument(xml).blocks[0];
    if (p.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(p.paragraph.runs[0].bold).toBe(false);
  });

  it("saut de ligne et tabulation deviennent des runs à part", () => {
    const xml = body('<w:p><w:r><w:t>a</w:t><w:br/><w:tab/><w:t>b</w:t></w:r></w:p>');
    const p = parseDocument(xml).blocks[0];
    if (p.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(p.paragraph.runs.map((r) => r.text)).toEqual(["a", "\n", "\t", "b"]);
  });

  it("décode les entités XML", () => {
    const xml = body('<w:p><w:r><w:t>Voirie &amp; R&#233;seaux</w:t></w:r></w:p>');
    const p = parseDocument(xml).blocks[0];
    if (p.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(p.paragraph.runs[0].text).toBe("Voirie & Réseaux");
  });
});

describe("styles", () => {
  const STYLES = `<w:styles>
    <w:docDefaults><w:rPr><w:sz w:val="22"/></w:rPr></w:docDefaults>
    <w:style w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
    <w:style w:styleId="Titre1"><w:basedOn w:val="Normal"/>
      <w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  </w:styles>`;

  it("résout la chaîne basedOn", () => {
    const book = parseStyles(STYLES);
    expect(book.defaults.sizePt).toBe(11);
    expect(book.byId.get("Titre1")).toMatchObject({ bold: true, sizePt: 16, align: "center" });
  });

  it("un paragraphe hérite du style nommé, et le run garde le dernier mot", () => {
    const xml = body(
      '<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Objet</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Petit</w:t></w:r></w:p>',
    );
    const doc = parseDocument(xml, STYLES);
    const first = doc.blocks[0];
    const second = doc.blocks[1];
    if (first.type !== "paragraph" || second.type !== "paragraph") throw new Error("paragraphes attendus");
    expect(first.paragraph.align).toBe("center");
    expect(first.paragraph.runs[0]).toMatchObject({ bold: true, sizePt: 16 });
    expect(second.paragraph.runs[0]).toMatchObject({ bold: true, sizePt: 10 });
  });

  it("sans styles.xml, la taille par défaut est 11 pt", () => {
    const xml = body('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const p = parseDocument(xml).blocks[0];
    if (p.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(p.paragraph.runs[0].sizePt).toBe(11);
  });
});

describe("tableaux", () => {
  const TABLE = '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:t>Clé</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:t>Valeur</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  it("lit les lignes, les cellules et leurs largeurs", () => {
    const block = parseDocument(body(TABLE)).blocks[0];
    expect(block.type).toBe("table");
    if (block.type !== "table") return;
    expect(block.table.bordered).toBe(true);
    expect(block.table.rows).toHaveLength(1);
    expect(block.table.rows[0].cells.map((c) => c.widthPt)).toEqual([100, 300]);
    expect(block.table.rows[0].cells[1].paragraphs[0].runs[0].text).toBe("Valeur");
  });

  it("les paragraphes d'un tableau ne sont pas repris au premier niveau", () => {
    const doc = parseDocument(body(
      '<w:p><w:r><w:t>avant</w:t></w:r></w:p>' + TABLE + '<w:p><w:r><w:t>après</w:t></w:r></w:p>',
    ));
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
  });
});

describe("avertissements", () => {
  it("dit ce que le PDF ne montrera pas", () => {
    const xml = body(
      '<w:p><w:r><w:drawing><w:inline/></w:drawing></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>',
      '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>',
    );
    const doc = parseDocument(xml);
    expect(doc.warnings).toEqual(expect.arrayContaining([
      "les images du modèle ne sont pas reprises",
      "les listes numérotées deviennent des puces",
      "l'en-tête et le pied de page ne sont pas repris",
    ]));
  });

  it("un document ordinaire n'avertit de rien", () => {
    expect(parseDocument(body('<w:p><w:r><w:t>ok</w:t></w:r></w:p>')).warnings).toEqual([]);
  });
});
