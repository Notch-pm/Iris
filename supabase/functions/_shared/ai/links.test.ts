import { describe, expect, it } from "vitest";
import { allowedLinkOrigins, neutralizeLinks } from "./links";
import { parseInline } from "@/lib/markdown";

const allowed = allowedLinkOrigins([
  "https://www.arles.fr/demarches/stationnement",
  "https://www.service-public.fr",
  "www.legifrance.gouv.fr/",
  "javascript:alert(1)",
]);

/** Les liens que l'ÉCRAN rendrait cliquables dans cette réponse. */
function clickable(answer: string): string[] {
  const out: string[] = [];
  const walk = (source: string) => {
    for (const node of parseInline(source)) {
      if (node.kind === "link") out.push(node.href);
    }
  };
  for (const line of answer.split("\n")) walk(line);
  return out;
}

describe("allowedLinkOrigins", () => {
  it("retient les origines http(s), y compris d'une adresse en www., et rien d'autre", () => {
    expect([...allowed].sort()).toEqual([
      "https://www.arles.fr",
      "https://www.legifrance.gouv.fr",
      "https://www.service-public.fr",
    ]);
  });
});

describe("neutralizeLinks", () => {
  it("garde un lien vers une origine déclarée", () => {
    const answer = "Voir [la fiche](https://www.service-public.fr/particuliers/vosdroits/F1234).";
    expect(neutralizeLinks(answer, allowed)).toBe(answer);
  });

  // ⚠️ Le scénario d'exfiltration : un libellé honnête, une URL qui porte le dossier.
  it("désactive un lien Markdown vers une origine inconnue, sans garder la requête", () => {
    const out = neutralizeLinks(
      "Utilisez le [Formulaire officiel à jour](https://x.example/f?d=12%20rue%20des%20Lilas%20Arles).",
      allowed,
    );
    expect(out).toBe("Utilisez le Formulaire officiel à jour (`x.example`, lien non vérifié).");
    expect(out).not.toContain("Lilas");
    expect(clickable(out)).toEqual([]);
  });

  it("désactive une adresse nue inconnue — sans schéma, l'écran ne la relie plus", () => {
    const out = neutralizeLinks("Déposez ici : https://evil.example/collect?objet=abc#x.", allowed);
    expect(out).toBe("Déposez ici : `evil.example/collect` (lien non vérifié).");
    expect(clickable(out)).toEqual([]);
    const www = neutralizeLinks("ou www.evil.example/p?q=1", allowed);
    expect(www).toBe("ou `evil.example/p` (lien non vérifié)");
    expect(clickable(www)).toEqual([]);
  });

  it("garde une adresse nue déclarée, et sa ponctuation", () => {
    const answer = "Source : https://www.arles.fr/demarches/stationnement.";
    expect(neutralizeLinks(answer, allowed)).toBe(answer);
  });

  it("un sous-domaine n'est pas l'origine déclarée", () => {
    expect(clickable(neutralizeLinks("[x](https://evil.www.arles.fr.example/)", allowed))).toEqual([]);
    expect(clickable(neutralizeLinks("[x](https://arles.fr/)", allowed))).toEqual([]);
  });

  it("un lien mailto ou javascript ne garde que son libellé", () => {
    expect(neutralizeLinks("[écrire](mailto:a@x.example?body=dossier)", allowed)).toBe("écrire");
    expect(neutralizeLinks("[clic](javascript:alert(1))", allowed)).not.toContain("javascript");
  });

  it("ne touche pas au code en ligne ni au texte ordinaire", () => {
    const answer = "Tapez `https://x.example/?d=1` dans **le champ**.";
    expect(neutralizeLinks(answer, allowed)).toBe(answer);
    expect(neutralizeLinks("", allowed)).toBe("");
  });
});
