import { describe, expect, it } from "vitest";
import { parseDocument } from "./docxParse";
import { documentPlainText } from "./docxText";

function body(inner: string): string {
  return `<w:document><w:body>${inner}</w:body></w:document>`;
}
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("documentPlainText", () => {
  it("un paragraphe par ligne, les paragraphes vides gardés comme respiration", () => {
    const doc = parseDocument(body(p("Madame,") + "<w:p/>" + p("Votre demande est acceptée.")));
    expect(documentPlainText(doc)).toBe("Madame,\n\nVotre demande est acceptée.");
  });

  it("recolle les runs et rend les sauts de ligne", () => {
    const doc = parseDocument(body(
      "<w:p><w:r><w:t>Marie </w:t></w:r><w:r><w:t>Durand</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>1 rue Haute</w:t></w:r></w:p>",
    ));
    expect(documentPlainText(doc)).toBe("Marie Durand\n1 rue Haute");
  });

  it("une cellule de tableau par ligne, cellules vides omises", () => {
    const doc = parseDocument(body(
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mairie</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc>" +
      "<w:tc><w:p><w:r><w:t>Mme Durand</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" + p("Objet : réponse"),
    ));
    expect(documentPlainText(doc)).toBe("Mairie\nMme Durand\n\nObjet : réponse");
  });

  it("écrase les blancs en excès et rogne les bords", () => {
    const doc = parseDocument(body("<w:p/><w:p/>" + p("A") + "<w:p/><w:p/><w:p/><w:p/>" + p("B") + "<w:p/>"));
    expect(documentPlainText(doc)).toBe("A\n\nB");
  });

  it("document vide : texte vide", () => {
    expect(documentPlainText(parseDocument(body("")))).toBe("");
  });
});
