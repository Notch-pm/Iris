import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Un `CLAUDE.md` est chargé en entier dans le contexte d'un agent — la racine à chaque
 * session, celui d'un dossier dès qu'on y travaille ; au-delà de 40 000 caractères, Claude
 * Code le signale comme trop lourd.
 *
 * ⚠️ Le 2026-10-30, la racine en faisait 58 000 et celui de `src/features/requests`
 * 122 000 : chaque feature y avait déposé ses pièges, un paragraphe à la fois, et personne
 * ne voyait le total monter. Le détail vit depuis dans les fiches `docs/features/*.md`
 * (motif du Socle, 2026-09-18) ; les `CLAUDE.md` ne sont plus que des index. Ce test tient
 * la limite, et vérifie que les index et les fiches ne se perdent pas de vue — une fiche
 * que rien ne cite ne serait jamais lue, un lien vers un fichier absent enverrait chercher
 * dans le vide.
 */
const root = new URL("../", import.meta.url);

const LIMIT = 40_000;

const read = (path: string) => readFileSync(new URL(path, root), "utf8");

/** Tous les `CLAUDE.md` du dépôt, chemins relatifs à la racine. */
const claudeFiles = [
  "CLAUDE.md",
  ...["src", "supabase"].flatMap((dir) =>
    readdirSync(new URL(`${dir}/`, root), { recursive: true, encoding: "utf8" })
      .map((p) => `${dir}/${p.split("\\").join("/")}`)
      .filter((p) => p.endsWith("/CLAUDE.md") && !p.includes("node_modules")),
  ),
];

const fiches = readdirSync(new URL("docs/features/", root))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `docs/features/${f}`);

/** Liens Markdown relatifs d'un texte, hors code en ligne (`@[Nom](uuid)` n'est pas un lien). */
function relativeLinks(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
    .map((m) => m[1])
    .filter((target) => !/^[a-z]+:/i.test(target));
}

function resolve(from: string, target: string): string {
  return new URL(target, new URL(from, root)).pathname;
}

describe("les CLAUDE.md restent des index", () => {
  it.each(claudeFiles)(`%s tient sous ${LIMIT} caractères`, (file) => {
    const size = read(file).length;
    if (size >= LIMIT) {
      throw new Error(
        `${file} fait ${size} caractères (limite ${LIMIT}). ` +
          "Déplacer le détail dans la fiche docs/features/ de la feature concernée : " +
          "l'index ne garde que ce qu'il faut savoir avant de l'ouvrir.",
      );
    }
    expect(size).toBeLessThan(LIMIT);
  });

  it("chaque fiche est citée par un CLAUDE.md", () => {
    const cited = new Set(
      claudeFiles.flatMap((file) => relativeLinks(read(file)).map((t) => resolve(file, t))),
    );

    expect(fiches.length).toBeGreaterThan(0);
    expect(fiches.filter((f) => !cited.has(new URL(f, root).pathname))).toEqual([]);
  });

  it.each([...claudeFiles, ...fiches])("chaque lien relatif de %s mène à un fichier", (file) => {
    const broken = relativeLinks(read(file)).filter(
      (target) => !existsSync(new URL(target, new URL(file, root))),
    );
    expect(broken).toEqual([]);
  });
});
