import { describe, expect, it } from "vitest";
import { bodyParagraphs, usagerBrand, usagerEmailContent } from "./usager.ts";
import { brandLine, renderEmailHtml, renderEmailText } from "./template.ts";

describe("usagerBrand", () => {
  it("porte la COLLECTIVITÉ seule, jamais « Iris · … »", () => {
    const brand = usagerBrand("Ville de Saint-Aubin");
    expect(brandLine(brand)).toBe("Ville de Saint-Aubin");
    expect(brandLine(brand)).not.toContain("Iris");
  });

  it("retombe sur le produit si le tenant n'a pas de nom lisible", () => {
    expect(brandLine(usagerBrand(null))).toBe("Iris");
    expect(brandLine(usagerBrand("   "))).toBe("Iris");
  });
});

describe("bodyParagraphs", () => {
  it("sépare sur les lignes vides", () => {
    expect(bodyParagraphs("Bonjour,\n\nVotre demande avance.\n\nCordialement")).toEqual([
      "Bonjour,",
      "Votre demande avance.",
      "Cordialement",
    ]);
  });

  it("garde les retours à la ligne SIMPLES dans le paragraphe", () => {
    expect(bodyParagraphs("Le service voirie\nMairie de Saint-Aubin")).toEqual([
      "Le service voirie\nMairie de Saint-Aubin",
    ]);
  });

  it("tolère CRLF, lignes vides multiples et espaces de fin", () => {
    expect(bodyParagraphs("Un\r\n\r\n\r\nDeux   \r\n")).toEqual(["Un", "Deux"]);
  });

  it("rend une liste vide pour un texte vide", () => {
    expect(bodyParagraphs("   \n\n  ")).toEqual([]);
  });
});

describe("usagerEmailContent", () => {
  it("reprend l'objet comme titre, et n'ajoute RIEN", () => {
    const content = usagerEmailContent("  Votre demande DEM-42  ", "Bonjour,\n\nC'est noté.");
    expect(content.subject).toBe("Votre demande DEM-42");
    expect(content.heading).toBe("Votre demande DEM-42");
    expect(content.paragraphs).toEqual(["Bonjour,", "C'est noté."]);
    // Décision PO : « ne pas répondre, sans plus » — aucun rappel de référence
    // ni bouton ajouté d'office.
    expect(content.cta).toBeUndefined();
    expect(content.code).toBeUndefined();
    expect(content.footnote).toBeUndefined();
  });
});

describe("le message rendu", () => {
  const content = usagerEmailContent("Votre demande", "Bonjour,\n\nC'est <noté> & compris.");
  const brand = usagerBrand("Ville de Saint-Aubin");

  it("porte la mention « ne pas y répondre » dans les DEUX rendus", () => {
    expect(renderEmailText(content, brand)).toContain(
      "Ville de Saint-Aubin — message automatique, merci de ne pas y répondre.",
    );
    expect(renderEmailHtml(content, brand)).toContain("merci de ne pas y répondre.");
  });

  it("n'annonce jamais Iris à l'usager", () => {
    expect(renderEmailText(content, brand)).not.toContain("Iris");
    expect(renderEmailHtml(content, brand)).not.toContain("Iris");
  });

  it("échappe le texte de l'agent — c'est du texte brut, pas du HTML", () => {
    const html = renderEmailHtml(content, brand);
    // L'apostrophe est échappée elle aussi (`&#39;`) : le gabarit n'épargne rien.
    expect(html).toContain("C&#39;est &lt;noté&gt; &amp; compris.");
    expect(html).not.toContain("<noté>");
  });

  it("rend les retours à la ligne simples en <br />", () => {
    const signed = usagerEmailContent("Objet", "Le service\nMairie");
    expect(renderEmailHtml(signed, brand)).toContain("Le service<br />Mairie");
  });
});

describe("la charte de la collectivité dans un message à l'usager", () => {
  const charte = {
    primary: "#1f8a5b", onPrimary: "#FFFFFF",
    logoUrl: "https://accm.fr/logo.png",
  };
  const content = usagerEmailContent("Votre demande", "Bonjour,\n\nC'est noté.");

  it("habille la carte aux couleurs et au logo de la collectivité", () => {
    const html = renderEmailHtml(content, usagerBrand("Ville de Saint-Aubin", charte));
    expect(html).toContain("border-bottom:1px solid #1f8a5b;padding:20px 32px;");
    expect(html).toContain('src="https://accm.fr/logo.png"');
    // Et toujours pas un mot d'Iris à l'habitant.
    expect(html).not.toContain("Iris");
  });

  it("garde l'habillage Iris quand la collectivité n'a pas de charte", () => {
    const sans = renderEmailHtml(content, usagerBrand("Ville de Saint-Aubin", null));
    expect(sans).toBe(renderEmailHtml(content, usagerBrand("Ville de Saint-Aubin")));
    expect(sans).not.toContain("<img");
  });
});
