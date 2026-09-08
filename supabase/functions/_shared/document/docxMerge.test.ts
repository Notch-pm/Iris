import { describe, expect, it } from "vitest";
import {
  escapeXml, expandLoops, mergeDocumentXml, mergeParagraph, paragraphText, scanTemplate,
} from "./docxMerge";
import { buildMergeContext, type MergeInput } from "./variables";

/** Un run Word, avec sa mise en forme — c'est elle qui doit survivre. */
function run(text: string, bold = false): string {
  return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}
function para(...runs: string[]): string {
  return `<w:p><w:pPr><w:jc w:val="left"/></w:pPr>${runs.join("")}</w:p>`;
}

const INPUT: MergeInput = {
  usager: {
    civilite: "Madame", prenom: "Marie", nom: "Dupont",
    voie: "12 rue des Lilas", complement: "Bâtiment B",
    code_postal: "13200", ville: "Arles",
    telephone_mobile: "0601020304", telephone_fixe: null,
    courriel: "marie.dupont@exemple.fr", quartier: "Centre",
  },
  demande: {
    libelle_demarche: "Demande d'intervention voirie",
    code_suivi: "DEM-2026-000042",
    organisme_responsable: "Direction de la voirie",
    date_depot: "12/08/2026",
    etat_actuel: "En cours d'instruction",
    agent_nom: "Martin", agent_prenom: "Claire",
    pieces: [
      { libelle: "Justificatif de domicile", statut: "Conforme", fichier: "domicile.pdf" },
      { libelle: "Photo du désordre", statut: "À qualifier", fichier: "photo.jpg" },
    ],
  },
  organisme: { nom: "Mairie d'Arles", adresse: "Place de la République" },
};

const CTX = buildMergeContext(INPUT);

describe("jeton dans un paragraphe", () => {
  it("remplace un jeton d'un seul tenant", () => {
    const xml = para(run("Bonjour {{usager.prenom}},"));
    expect(paragraphText(mergeDocumentXml(xml, CTX))).toBe("Bonjour Marie,");
  });

  it("⚠️ remplace un jeton QUE WORD A COUPÉ en plusieurs runs", () => {
    // Le cas réel : cinq runs pour une seule variable.
    const xml = para(run("Bonjour "), run("{{usa"), run("ger."), run("pre"), run("nom}}"), run(" !"));
    expect(paragraphText(mergeDocumentXml(xml, CTX))).toBe("Bonjour Marie !");
  });

  it("garde la mise en forme du run où le jeton commence", () => {
    const xml = para(run("Réf. "), run("{{demande.", true), run("code_suivi}}", true));
    const merged = mergeDocumentXml(xml, CTX);
    expect(paragraphText(merged)).toBe("Réf. DEM-2026-000042");
    expect(merged).toContain("<w:b/>");
    expect(merged).toContain("<w:jc w:val=\"left\"/>");
  });

  it("laisse un jeton INCONNU tel quel — un modèle appartient à la collectivité", () => {
    const xml = para(run("Suivi {{ma.variable.a.moi}} fin"));
    expect(paragraphText(mergeDocumentXml(xml, CTX))).toBe("Suivi {{ma.variable.a.moi}} fin");
  });

  it("plusieurs jetons dans le même paragraphe", () => {
    const xml = para(run("{{usager.civilite}} {{usager.nom}} — {{demande.etat_actuel}}"));
    expect(paragraphText(mergeDocumentXml(xml, CTX)))
      .toBe("Madame Dupont — En cours d'instruction");
  });

  it("une valeur absente laisse un blanc, jamais le jeton", () => {
    const xml = para(run("Tél. fixe : {{usager.telephone_fixe}}."));
    expect(paragraphText(mergeDocumentXml(xml, CTX))).toBe("Tél. fixe : .");
  });
});

describe("valeurs particulières", () => {
  it("le bloc adresse devient de vrais retours à la ligne Word", () => {
    const merged = mergeDocumentXml(para(run("{{usager.adresse_complete}}")), CTX);
    expect(merged).toContain("<w:br/>");
    expect(paragraphText(merged)).toBe("12 rue des LilasBâtiment B13200 Arles");
  });

  it("échappe ce qui casserait le XML", () => {
    const ctx = buildMergeContext({
      ...INPUT,
      organisme: { nom: "Service <Voirie> & Réseaux" },
    });
    const merged = mergeDocumentXml(para(run("{{organisme.nom}}")), ctx);
    expect(merged).toContain("Service &lt;Voirie&gt; &amp; Réseaux");
    expect(paragraphText(merged)).toBe("Service <Voirie> & Réseaux");
  });

  it("une variable d'IMAGE rend du vide, jamais son URL", () => {
    expect(paragraphText(mergeDocumentXml(para(run("[{{organisme.logo_url}}]")), CTX)))
      .toBe("[]");
  });

  it("escapeXml couvre les cinq entités", () => {
    expect(escapeXml(`<a href="x">&'</a>`))
      .toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });
});

describe("boucles", () => {
  const loop = [
    para(run("{{#demande.pieces}}")),
    para(run("{{libelle}} : {{statut}}")),
    para(run("{{/demande.pieces}}")),
  ].join("");

  it("répète le bloc une fois par élément et retire les marqueurs", () => {
    const merged = mergeDocumentXml(loop, CTX);
    expect(merged).not.toContain("{{#");
    expect(merged).not.toContain("{{/");
    expect(paragraphText(merged))
      .toBe("Justificatif de domicile : ConformePhoto du désordre : À qualifier");
  });

  it("une liste vide fait disparaître le bloc entier", () => {
    const empty = buildMergeContext({ ...INPUT, demande: { ...INPUT.demande, pieces: [] } });
    expect(mergeDocumentXml(loop, empty).replace(/\s/g, "")).toBe("");
  });

  it("les clés globales restent lisibles à l'intérieur d'une boucle", () => {
    const xml = [
      para(run("{{#demande.pieces}}")),
      para(run("{{demande.code_suivi}} — {{libelle}}")),
      para(run("{{/demande.pieces}}")),
    ].join("");
    expect(paragraphText(mergeDocumentXml(xml, CTX)))
      .toBe("DEM-2026-000042 — Justificatif de domicileDEM-2026-000042 — Photo du désordre");
  });

  it("un marqueur d'ouverture orphelin ne casse rien", () => {
    const xml = para(run("{{#demande.pieces}} sans fin"));
    expect(expandLoops(xml, CTX)).toBe(xml);
  });

  it("une boucle coupée en runs par Word est reconnue", () => {
    const xml = [
      para(run("{{#dem"), run("ande.pieces}}")),
      para(run("{{libelle}}")),
      para(run("{{/demande."), run("pieces}}")),
    ].join("");
    expect(paragraphText(mergeDocumentXml(xml, CTX)))
      .toBe("Justificatif de domicilePhoto du désordre");
  });
});

describe("inventaire d'un modèle", () => {
  it("distingue variables, boucles, images et jetons inconnus", () => {
    const xml = [
      para(run("{{usager.nom}} {{organisme.logo_url}} {{inconnu.truc}}")),
      para(run("{{#demande.pieces}}")),
      para(run("{{libelle}}")),
      para(run("{{/demande.pieces}}")),
    ].join("");
    const scan = scanTemplate(xml);
    expect(scan.variables).toEqual(["usager.nom"]);
    expect(scan.images).toEqual(["organisme.logo_url"]);
    expect(scan.loops).toEqual(["demande.pieces"]);
    expect(scan.unknown).toEqual(["inconnu.truc"]);
  });

  it("lit les jetons coupés par Word comme les autres", () => {
    const xml = para(run("{{usa"), run("ger.ville}}"));
    expect(scanTemplate(xml).variables).toEqual(["usager.ville"]);
  });
});

describe("mergeParagraph", () => {
  it("ne touche pas un paragraphe sans jeton", () => {
    const xml = para(run("Texte ordinaire"));
    expect(mergeParagraph(xml, () => "x")).toBe(xml);
  });
});
