import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "./htmlText";

describe("htmlToText", () => {
  const page = `<!doctype html><html><head><title>Stationnement &ndash; Arles</title>
    <style>.x{color:red}</style><script>alert("x")</script></head>
    <body>
      <header><nav><a href="/">Accueil</a><a href="/mairie">Mairie</a></nav></header>
      <main>
        <h1>Carte de stationnement résident</h1>
        <p>Elle est délivrée&nbsp;par la <strong>police municipale</strong>.</p>
        <h2>Pièces</h2>
        <ul><li>Justificatif de domicile</li><li>Carte grise</li></ul>
        <table><tr><th>Zone</th><th>Tarif</th></tr><tr><td>A</td><td>30&nbsp;&euro;</td></tr></table>
        <!-- commentaire caché -->
      </main>
      <footer>Mentions légales</footer>
    </body></html>`;

  it("garde le contenu principal, sa structure, et jette le reste", () => {
    const { title, text } = htmlToText(page);
    expect(title).toBe("Stationnement – Arles");
    expect(text).toContain("#### Carte de stationnement résident");
    expect(text).toContain("##### Pièces");
    expect(text).toContain("- Justificatif de domicile\n- Carte grise");
    expect(text).toContain("Elle est délivrée par la police municipale.");
    expect(text).toContain("A | 30 €");
    for (const absent of ["alert", "color:red", "Accueil", "Mentions légales", "commentaire caché"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("sans <main>, lit le corps — un paragraphe par bloc, séparés d'une ligne vide", () => {
    expect(htmlToText("<body><p>Un</p><p>Deux</p></body>").text).toBe("Un\n\nDeux");
  });

  it("une balise script non fermée ne laisse pas fuir son contenu comme du texte de page", () => {
    const { text } = htmlToText("<p>Avant</p><script src=x.js>");
    expect(text).toBe("Avant");
  });

  it("ne rend jamais de balise", () => {
    expect(htmlToText("<p onclick=\"x()\">Texte <img src=x onerror=alert(1)></p>").text).toBe("Texte");
  });
});

describe("decodeEntities", () => {
  it("décode les entités nommées et numériques", () => {
    expect(decodeEntities("&laquo;&nbsp;&eacute;t&eacute;&nbsp;&raquo; &#233; &#xE9; &amp;")).toBe("« été » é é &");
  });

  it("garde brute une entité inconnue ou invalide", () => {
    expect(decodeEntities("&inconnue; &#0; &#xD800;")).toBe("&inconnue; &#0; &#xD800;");
  });
});

// ⚠️ La page vient d'un tiers et le temps CPU d'une edge function est compté :
// ces entrées rendaient l'ancienne réduction quadratique.
describe("htmlToText — temps linéaire sur une page hostile", () => {
  const timed = (html: string) => {
    const start = performance.now();
    htmlToText(html);
    return performance.now() - start;
  };

  it("des milliers d'ouvrantes jamais fermées", () => {
    expect(timed("<p>x</p>" + "<nav ".repeat(200_000))).toBeLessThan(1500);
    expect(timed("<main".repeat(200_000))).toBeLessThan(1500);
    expect(timed("<!--".repeat(200_000))).toBeLessThan(1500);
    expect(timed("<h1".repeat(200_000) + "<".repeat(200_000))).toBeLessThan(1500);
  });
});

describe("htmlToText — éléments jetés", () => {
  it("un <nav> jamais fermé ne perd que sa balise : la page reste", () => {
    expect(htmlToText("<body><nav><p>Contenu utile</p></body>").text).toBe("Contenu utile");
  });

  it("apparie les éléments imbriqués du même nom", () => {
    expect(htmlToText("<body><aside><aside>a</aside>b</aside><p>Garde</p></body>").text).toBe("Garde");
  });

  it("un script dans la navigation, un script après : aucun ne fuit", () => {
    const { text } = htmlToText("<body><nav><script>x()</script>Menu</nav><p>Texte</p><script>y()</script></body>");
    expect(text).toBe("Texte");
  });
});
