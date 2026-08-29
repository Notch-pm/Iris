import { describe, expect, it } from "vitest";
import { hasMarkdown, parseInline, parseMarkdown, safeHref, type Block } from "./markdown";

describe("safeHref", () => {
  it("accepte http, https et mailto, complète un domaine nu", () => {
    expect(safeHref("https://x.fr/a")).toBe("https://x.fr/a");
    expect(safeHref(" http://x.fr ")).toBe("http://x.fr");
    expect(safeHref("mailto:a@b.fr")).toBe("mailto:a@b.fr");
    expect(safeHref("www.service-public.fr")).toBe("https://www.service-public.fr");
  });

  it("refuse tout le reste — un champ du référentiel ne devient pas exécutable", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("/interne")).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reconnaît gras, italique, code et liens", () => {
    expect(parseInline("Voir **le guide** puis *vérifier*")).toEqual([
      { kind: "text", text: "Voir " },
      { kind: "strong", text: "le guide" },
      { kind: "text", text: " puis " },
      { kind: "em", text: "vérifier" },
    ]);
    expect(parseInline("`form_data` est figé")).toEqual([
      { kind: "code", text: "form_data" },
      { kind: "text", text: " est figé" },
    ]);
    expect(parseInline("[Fiche](https://x.fr)")).toEqual([
      { kind: "link", text: "Fiche", href: "https://x.fr" },
    ]);
  });

  it("le contenu d'un code reste littéral", () => {
    expect(parseInline("`**pas gras**`")).toEqual([{ kind: "code", text: "**pas gras**" }]);
  });

  it("transforme une URL nue en lien", () => {
    expect(parseInline("cf. https://x.fr/a")).toEqual([
      { kind: "text", text: "cf. " },
      { kind: "link", text: "https://x.fr/a", href: "https://x.fr/a" },
    ]);
  });

  it("un lien non sûr retombe en texte, jamais en lien cliquable", () => {
    expect(parseInline("[Cliquez](javascript:alert)")).toEqual([
      { kind: "text", text: "Cliquez" },
    ]);
    expect(parseInline("[Cliquez](data:text/html,x)").some((i) => i.kind === "link")).toBe(false);
    expect(parseInline("[Cliquez](javascript:alert(1))").some((i) => i.kind === "link")).toBe(false);
  });

  it("laisse le texte ordinaire intact", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ kind: "text", text: "2 * 3 = 6" }]);
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseMarkdown", () => {
  it("titres, paragraphes et filets", () => {
    const blocks = parseMarkdown("# Titre\n\nUn texte.\n\n---\n\n### Sous-titre");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "rule", "heading"]);
    expect((blocks[0] as Extract<Block, { kind: "heading" }>).level).toBe(1);
    expect((blocks[3] as Extract<Block, { kind: "heading" }>).level).toBe(3);
  });

  it("plafonne le niveau de titre à 3", () => {
    const [b] = parseMarkdown("###### Très profond");
    expect(b).toEqual({ kind: "heading", level: 3, content: [{ kind: "text", text: "Très profond" }] });
  });

  it("regroupe les listes et distingue puces et numéros", () => {
    const blocks = parseMarkdown("- un\n- deux\n\n1. premier\n2) second");
    expect(blocks).toHaveLength(2);
    const bullets = blocks[0] as Extract<Block, { kind: "list" }>;
    const ordered = blocks[1] as Extract<Block, { kind: "list" }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(ordered.ordered).toBe(true);
    expect(ordered.items).toHaveLength(2);
  });

  it("changer de type de liste ouvre une nouvelle liste, sans ligne vide", () => {
    const blocks = parseMarkdown("- puce\n1. numéro");
    expect(blocks.map((b) => (b as Extract<Block, { kind: "list" }>).ordered)).toEqual([false, true]);
  });

  it("regroupe les citations consécutives", () => {
    const blocks = parseMarkdown("> une\n> deux\n\nsuite");
    expect(blocks[0].kind).toBe("quote");
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("conserve les retours à la ligne d'un paragraphe", () => {
    const [b] = parseMarkdown("ligne 1\nligne 2");
    expect(b).toEqual({ kind: "paragraph", content: [{ kind: "text", text: "ligne 1\nligne 2" }] });
  });

  it("un texte vide ne produit aucun bloc", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
    expect(hasMarkdown("  ")).toBe(false);
    expect(hasMarkdown("x")).toBe(true);
    expect(hasMarkdown(null)).toBe(false);
  });

  it("normalise les fins de ligne Windows", () => {
    expect(parseMarkdown("# T\r\n\r\n- a\r\n- b").map((b) => b.kind)).toEqual(["heading", "list"]);
  });
});
