import { describe, expect, it } from "vitest";
import { officePartWanted, officeText, sharedStrings, unzipFilter, type OfficeFiles } from "./officeText";

const enc = (s: string) => new TextEncoder().encode(s);
const files = (parts: Record<string, string>): OfficeFiles =>
  Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, enc(v)]));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe("officeText — DOCX", () => {
  it("lit les paragraphes, y compris un mot coupé en plusieurs runs, et les tableaux", () => {
    const doc = `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Tarif du </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>stationne</w:t></w:r><w:r><w:t>ment</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Zone A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30 €</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>Fin</w:t></w:r></w:p>
    </w:body></w:document>`;
    const text = officeText("docx", files({ "word/document.xml": doc }));
    expect(text).toContain("Tarif du stationnement");
    expect(text).toContain("Zone A | 30 €");
    expect(text.indexOf("Tarif")).toBeLessThan(text.indexOf("Fin"));
  });

  it("un document sans corps rend une chaîne vide", () => {
    expect(officeText("docx", files({}))).toBe("");
  });
});

describe("officeText — ODT", () => {
  it("lit titres, paragraphes, espaces explicites et listes ; ignore les révisions", () => {
    const content = `<office:document-content><office:body><office:text>
      <text:tracked-changes><text:changed-region><text:deletion><text:p>Texte supprimé</text:p></text:deletion></text:changed-region></text:tracked-changes>
      <text:h text:outline-level="1">Conditions</text:h>
      <text:p>Être<text:s/>résident<text:tab/>depuis<text:s text:c="2"/>6 mois.</text:p>
      <text:list><text:list-item><text:p>Justificatif</text:p></text:list-item></text:list>
    </office:text></office:body></office:document-content>`;
    const text = officeText("odt", files({ "content.xml": content }));
    expect(text).toContain("#### Conditions");
    expect(text).toContain("Être résident depuis 6 mois.");
    expect(text).toContain("- Justificatif");
    expect(text).not.toContain("Texte supprimé");
  });
});

describe("officeText — PPTX", () => {
  it("lit les diapositives dans l'ordre de leur NUMÉRO, pas de leur nom", () => {
    const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const text = officeText("pptx", files({
      "ppt/slides/slide10.xml": slide("Dixième"),
      "ppt/slides/slide2.xml": slide("Deuxième"),
      "ppt/slides/_rels/slide2.xml.rels": "<Relationships/>",
    }));
    expect(text.indexOf("Deuxième")).toBeLessThan(text.indexOf("Dixième"));
    expect(text).toContain("#### Diapositive 2");
  });
});

describe("officeText — XLSX", () => {
  it("résout les chaînes partagées et rend une ligne par rangée", () => {
    const shared = `<sst><si><t>Zone</t></si><si><r><t>Ta</t></r><r><t>rif</t></r><rPh><t>タ</t></rPh></si><si><t>A &amp; B</t></si></sst>`;
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c><c r="C2"/></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>Libre</t></is></c><c r="B3" t="e"><v>#REF!</v></c></row>
    </sheetData></worksheet>`;
    const text = officeText("xlsx", files({ "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet }));
    expect(text).toContain("#### Feuille 1");
    expect(text).toContain("Zone | Tarif");
    expect(text).toContain("A & B | 30");
    expect(text).toContain("Libre");
    expect(text).not.toContain("#REF!");
  });

  it("sharedStrings ignore la prononciation phonétique", () => {
    expect(sharedStrings("<sst><si><r><t>A</t></r><rPh><t>x</t></rPh></si></sst>")).toEqual(["A"]);
  });

  it("borne le travail : s'arrête au plafond", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `<row><c t="inlineStr"><is><t>Ligne ${i}</t></is></c></row>`);
    const text = officeText("xlsx", files({ "xl/worksheets/sheet1.xml": `<worksheet>${rows.join("")}</worksheet>` }), 500);
    expect(text.length).toBeLessThan(700);
    expect(text).toContain("Ligne 0");
    expect(text).not.toContain("Ligne 4999");
  });
});

// ⚠️ Sans ce filtre, la bibliothèque décompresse TOUTES les entrées en
// allouant la taille qu'elles déclarent : 2 Mo d'archive, 2 Go demandés.
describe("unzipFilter — la décompression sous plafonds", () => {
  const entry = (name: string, originalSize: number, size = Math.ceil(originalSize / 5)) => ({ name, originalSize, size });

  it("ne garde que les parties lues du format", () => {
    const keep = unzipFilter("docx");
    expect(keep(entry("word/document.xml", 1000))).toBe(true);
    expect(keep(entry("word/styles.xml", 1000))).toBe(true);
    expect(keep(entry("word/media/image1.png", 1000))).toBe(false);
    expect(keep(entry("customXml/item1.xml", 1000))).toBe(false);
    expect(unzipFilter("xlsx")(entry("xl/worksheets/sheet3.xml", 10))).toBe(true);
    expect(unzipFilter("pptx")(entry("ppt/slides/_rels/slide1.xml.rels", 10))).toBe(false);
  });

  it("refuse une entrée trop grosse, ou trop compressée pour être honnête", () => {
    const keep = unzipFilter("docx");
    expect(keep(entry("word/document.xml", 9 * 1024 * 1024))).toBe(false);
    expect(keep(entry("word/document.xml", 2_000_000, 1000))).toBe(false);
  });

  it("borne le cumul", () => {
    const keep = unzipFilter("xlsx", { maxEntry: 100, maxTotal: 250, maxRatio: 1000 });
    expect(keep(entry("xl/worksheets/sheet1.xml", 100))).toBe(true);
    expect(keep(entry("xl/worksheets/sheet2.xml", 100))).toBe(true);
    expect(keep(entry("xl/worksheets/sheet3.xml", 100))).toBe(false);
    expect(keep(entry("xl/sharedStrings.xml", 50))).toBe(true);
  });

  it("officePartWanted connaît chaque format", () => {
    expect(officePartWanted("odt", "content.xml")).toBe(true);
    expect(officePartWanted("odt", "styles.xml")).toBe(false);
  });
});
