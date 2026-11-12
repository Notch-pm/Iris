import { describe, expect, it } from "vitest";
import {
  buildOrgTree, flattenOrgTree, renderTemplate, TEMPLATE_VARIABLES,
  VARIABLE_GROUP_LABELS, type OrgRow,
} from "./templates";

/**
 * Le catalogue COMMUN du Socle (`email_template_common_variables()`, servi par
 * `GET /v1/email-templates/variables`), dans son ordre. Le Socle refuse tout
 * modèle qui cite une autre clé : Iris doit savoir remplir chacune.
 */
const SOCLE_COMMON_VARIABLES = [
  "usager.salutation", "usager.civilite", "usager.prenom", "usager.nom", "usager.nom_complet",
  "usager.raison_sociale", "usager.courriel", "usager.telephone", "usager.adresse",
  "demande.reference", "demande.objet", "demande.description", "demande.statut", "demande.priorite",
  "demande.demarche", "demande.categorie", "demande.destinataire", "demande.canal", "demande.date_depot",
  "demande.date_instruction", "demande.date_cloture", "demande.date_echeance", "demande.motif_cloture",
  "agent.nom", "organisation.nom",
];

describe("catalogue de variables", () => {
  it("est la copie exacte du catalogue commun du Socle, dans le même ordre", () => {
    expect(TEMPLATE_VARIABLES.map((v) => v.key)).toEqual(SOCLE_COMMON_VARIABLES);
  });

  it("déclare un groupe connu et une valeur d'exemple pour chaque variable", () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(VARIABLE_GROUP_LABELS[v.group]).toBeTruthy();
      expect(v.label.trim()).not.toBe("");
      expect(v.sample.trim()).not.toBe("");
    }
  });
});

describe("renderTemplate", () => {
  it("remplace les variables par les valeurs fournies", () => {
    expect(renderTemplate("Bonjour {{usager.prenom}} {{usager.nom}},", {
      "usager.prenom": "Marie", "usager.nom": "Durand",
    })).toBe("Bonjour Marie Durand,");
  });

  it("efface une variable sans valeur plutôt que de montrer le gabarit à l'usager", () => {
    expect(renderTemplate("Bonjour {{usager.prenom}}.", {})).toBe("Bonjour .");
  });

  it("laisse le texte ordinaire intact, accolades comprises", () => {
    expect(renderTemplate("Un { et un } et {{ pas une variable }}", {}))
      .toBe("Un { et un } et {{ pas une variable }}");
  });

  it("remplace toutes les occurrences d'une même variable", () => {
    expect(renderTemplate("{{usager.nom}}/{{usager.nom}}", { "usager.nom": "Durand" }))
      .toBe("Durand/Durand");
  });

  it("rend une section seulement si sa variable a une valeur (syntaxe du Socle)", () => {
    const text = "Votre demande {{#demande.demarche}}« {{demande.demarche}} » {{/demande.demarche}}({{demande.reference}})";
    expect(renderTemplate(text, { "demande.demarche": "Voirie", "demande.reference": "R1" }))
      .toBe("Votre demande « Voirie » (R1)");
    expect(renderTemplate(text, { "demande.reference": "R1" })).toBe("Votre demande (R1)");
  });
});

describe("buildOrgTree", () => {
  const MAIRIE: OrgRow = { socle_org_id: "m", socle_parent_id: null, name: "Mairie" };
  const VOIRIE: OrgRow = { socle_org_id: "v", socle_parent_id: "m", name: "Voirie" };
  const CCAS: OrgRow = { socle_org_id: "c", socle_parent_id: "m", name: "CCAS" };
  const ANTENNE: OrgRow = { socle_org_id: "a", socle_parent_id: "v", name: "Antenne Nord" };

  it("emboîte les enfants sous leur parent", () => {
    const tree = buildOrgTree([MAIRIE, VOIRIE, CCAS, ANTENNE]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Mairie");
    expect(tree[0].children.map((c) => c.name)).toEqual(["CCAS", "Voirie"]); // triées
    const voirie = tree[0].children.find((c) => c.name === "Voirie")!;
    expect(voirie.children.map((c) => c.name)).toEqual(["Antenne Nord"]);
  });

  it("calcule la profondeur pour l'indentation", () => {
    const plat = flattenOrgTree(buildOrgTree([MAIRIE, VOIRIE, CCAS, ANTENNE]));
    expect(plat.map((n) => [n.name, n.depth])).toEqual([
      ["Mairie", 0], ["CCAS", 1], ["Voirie", 1], ["Antenne Nord", 2],
    ]);
  });

  it("PROMEUT en racine un nœud dont le parent est hors de la liste", () => {
    // Le cas de l'administrateur borné à une branche : il reçoit Voirie et son
    // antenne, mais pas la Mairie. Sans promotion, il ne verrait rien.
    const tree = buildOrgTree([VOIRIE, ANTENNE]);
    expect(tree.map((n) => n.name)).toEqual(["Voirie"]);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children.map((c) => c.name)).toEqual(["Antenne Nord"]);
  });

  it("rend plusieurs racines quand les branches sont disjointes", () => {
    expect(buildOrgTree([VOIRIE, CCAS]).map((n) => n.name)).toEqual(["CCAS", "Voirie"]);
  });

  it("ne boucle pas sur un nœud qui se déclare son propre parent", () => {
    const boucle: OrgRow = { socle_org_id: "x", socle_parent_id: "x", name: "Boucle" };
    expect(buildOrgTree([boucle]).map((n) => n.name)).toEqual(["Boucle"]);
  });

  it("rend un arbre vide sans organisation", () => {
    expect(buildOrgTree([])).toEqual([]);
    expect(flattenOrgTree([])).toEqual([]);
  });
});
