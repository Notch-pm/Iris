import { describe, expect, it } from "vitest";
import {
  brandLine,
  escapeHtml,
  renderEmailHtml,
  renderEmailText,
  safeUrl,
  type EmailBrand,
  type EmailContent,
} from "./template";

const brand: EmailBrand = { productName: "Iris", tenantName: "Ville de Test" };

const content: EmailContent = {
  subject: "Réinitialisation de votre mot de passe — Iris · Ville de Test",
  heading: "Réinitialisation de mot de passe",
  paragraphs: ["Bonjour Marie Durand,", "Cliquez sur le bouton ci-dessous."],
  cta: { label: "Choisir un nouveau mot de passe", url: "https://iris.test/nouveau-mot-de-passe?token_hash=abc" },
  footnote: "Ce lien est à usage unique.",
};

describe("escapeHtml", () => {
  it("neutralise les cinq caractères dangereux", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("laisse les accents intacts", () => {
    expect(escapeHtml("Réinitialisation à l'œuvre")).toBe("Réinitialisation à l&#39;œuvre");
  });
});

describe("safeUrl", () => {
  it("accepte http et https", () => {
    expect(safeUrl("https://iris.test/a")).toBe("https://iris.test/a");
    expect(safeUrl("  http://iris.test/b  ")).toBe("http://iris.test/b");
  });

  it("refuse tout autre schéma", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
    expect(safeUrl("")).toBe("#");
  });
});

describe("brandLine", () => {
  it("joint produit et tenant", () => {
    expect(brandLine(brand)).toBe("Iris · Ville de Test");
  });

  it("se réduit au produit sans tenant", () => {
    expect(brandLine({ productName: "Iris" })).toBe("Iris");
    expect(brandLine({ productName: "Iris", tenantName: "   " })).toBe("Iris");
  });
});

describe("renderEmailHtml", () => {
  const html = renderEmailHtml(content, brand);

  it("porte le titre, les paragraphes et le bouton", () => {
    expect(html).toContain("Réinitialisation de mot de passe");
    expect(html).toContain("Bonjour Marie Durand,");
    expect(html).toContain("Choisir un nouveau mot de passe");
    expect(html).toContain('href="https://iris.test/nouveau-mot-de-passe?token_hash=abc"');
  });

  it("répète le lien en clair pour les clients qui cassent le bouton", () => {
    expect(html).toContain("Si le bouton ne fonctionne pas");
    expect(html.match(/https:\/\/iris\.test\/nouveau-mot-de-passe\?token_hash=abc/g)?.length).toBe(2);
  });

  it("ouvre par un pré-en-tête masqué reprenant le premier paragraphe", () => {
    expect(html).toContain('<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Bonjour Marie Durand,</div>');
  });

  it("échappe le nom du tenant — c'est une donnée du Socle, pas du HTML", () => {
    const hostile = renderEmailHtml(content, { productName: "Iris", tenantName: "<script>x</script>" });
    expect(hostile).not.toContain("<script>x</script>");
    expect(hostile).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("neutralise une URL d'action non http", () => {
    const html2 = renderEmailHtml(
      { ...content, cta: { label: "Ouvrir", url: "javascript:alert(1)" } },
      brand,
    );
    expect(html2).not.toContain("javascript:alert(1)");
    expect(html2).toContain('href="#"');
  });

  it("affiche un code sans lien de repli", () => {
    const html2 = renderEmailHtml(
      { subject: "s", heading: "Code de vérification", paragraphs: ["Bonjour,"], code: "482913" },
      brand,
    );
    expect(html2).toContain("482913");
    expect(html2).not.toContain("Si le bouton ne fonctionne pas");
  });

  it("n'utilise que des couleurs hexadécimales — aucun client ne lit hsl() ni var()", () => {
    expect(html).not.toContain("hsl(");
    expect(html).not.toContain("var(--");
  });
});

describe("renderEmailText", () => {
  const text = renderEmailText(content, brand);

  it("reprend titre, corps, lien et mention", () => {
    expect(text).toContain("Réinitialisation de mot de passe");
    expect(text).toContain("Bonjour Marie Durand,");
    expect(text).toContain("Choisir un nouveau mot de passe : https://iris.test/nouveau-mot-de-passe?token_hash=abc");
    expect(text).toContain("Ce lien est à usage unique.");
    expect(text).toContain("Iris · Ville de Test — message automatique");
  });

  it("ne contient aucune balise", () => {
    expect(text).not.toMatch(/<[a-z/]/i);
  });

  it("affiche le code plutôt qu'un lien", () => {
    const t = renderEmailText(
      { subject: "s", heading: "Code", paragraphs: [], code: "482913" },
      brand,
    );
    expect(t).toContain("Code : 482913");
  });
});

describe("le gabarit habillé de la charte d'une collectivité", () => {
  const sombre = {
    primary: "#1f8a5b", onPrimary: "#FFFFFF",
    logoUrl: "https://accm.fr/logo.png",
  };
  const clair = { primary: "#ffd166", onPrimary: "#1C2220", logoUrl: null };

  it("trace les bordures et remplit le bouton de la couleur principale", () => {
    const html = renderEmailHtml(content, { ...brand, charte: sombre });
    expect(html).toContain("border:1px solid #1f8a5b;border-radius:14px;");
    expect(html).toContain("border-bottom:1px solid #1f8a5b;padding:20px 32px;");
    expect(html).toContain("background-color:#1f8a5b;border-radius:10px;");
    // Le vert d'Iris n'a plus rien à peindre dans ce message.
    expect(html).not.toContain("#089B59");
  });

  it("garde le bandeau BLANC — un aplat de couleur entrait en collision avec le logo", () => {
    for (const charte of [sombre, clair]) {
      const html = renderEmailHtml(content, { ...brand, charte });
      expect(html).toContain("background-color:#FFFFFF;border-bottom:1px solid");
      expect(html).not.toContain(`background-color:${charte.primary};padding:20px 32px;`);
    }
  });

  it("écrit le nom du bandeau à l'encre du corps, lisible sur blanc quelle que soit la charte", () => {
    const html = renderEmailHtml(content, { ...brand, charte: clair });
    expect(html).toContain("font-weight:800;letter-spacing:0.2px;color:#1C2220;");
  });

  it("porte sur le bouton l'encre CALCULÉE, pas du blanc d'office", () => {
    expect(renderEmailHtml(content, { ...brand, charte: clair })).toMatch(/color:#1C2220;font-family:[^"]*font-size:15px;font-weight:700/);
    expect(renderEmailHtml(content, { ...brand, charte: sombre })).toMatch(/color:#FFFFFF;font-family:[^"]*font-size:15px;font-weight:700/);
  });

  it("affiche le logo, avec un alt VIDE — le nom est déjà écrit à côté", () => {
    const html = renderEmailHtml(content, { ...brand, charte: sombre });
    expect(html).toContain('src="https://accm.fr/logo.png"');
    expect(html).toContain('alt=""');
    // Images bloquées : le nom reste lisible, et le logo n'en ajoute PAS une
    // occurrence de plus — c'est tout l'objet de l'alt vide.
    const sansLogo = renderEmailHtml(content, brand);
    expect((html.match(/Iris · Ville de Test/g) ?? []).length)
      .toBe((sansLogo.match(/Iris · Ville de Test/g) ?? []).length);
  });

  it("échappe l'URL du logo — un guillemet ne sort pas de l'attribut", () => {
    const html = renderEmailHtml(content, {
      ...brand,
      charte: { ...sombre, logoUrl: 'https://accm.fr/l.png" onerror="alert(1)' },
    });
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&quot; onerror=&quot;alert(1)");
  });

  it("sans charte, rend EXACTEMENT le message d'avant", () => {
    expect(renderEmailHtml(content, { ...brand, charte: null })).toBe(renderEmailHtml(content, brand));
    expect(renderEmailHtml(content, brand)).toContain(
      `border-bottom:1px solid ${"#089B59"};padding:20px 32px;`,
    );
    expect(renderEmailHtml(content, brand)).not.toContain("<img");
  });

  it("ne change rien à la version texte — une charte, ça ne s'écrit pas", () => {
    expect(renderEmailText(content, { ...brand, charte: sombre })).toBe(renderEmailText(content, brand));
  });
});
