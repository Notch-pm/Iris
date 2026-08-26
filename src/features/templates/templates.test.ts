import { describe, expect, it } from "vitest";
import {
  buildOrgTree, emptyDraft, flattenOrgTree, hasErrors, insertVariable, isKnownVariable,
  parseVariables, previewValues, renderTemplate, TEMPLATE_VARIABLES, unknownVariables,
  validateTemplateDraft, VARIABLE_GROUP_LABELS, type OrgRow,
} from "./templates";

describe("catalogue de variables", () => {
  it("n'a aucune clé en double", () => {
    const keys = TEMPLATE_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respecte la forme `groupe.cle` attendue par la base", () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("déclare un groupe connu et une valeur d'exemple pour chaque variable", () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(VARIABLE_GROUP_LABELS[v.group]).toBeTruthy();
      expect(v.label.trim()).not.toBe("");
      expect(v.sample.trim()).not.toBe("");
    }
  });

  it("couvre les informations citées par le PO", () => {
    for (const key of [
      "usager.nom", "usager.prenom",
      "demande.demarche", "demande.categorie",
      "demande.date_depot", "demande.date_instruction",
    ]) {
      expect(isKnownVariable(key)).toBe(true);
    }
  });

  it("ne connaît pas une clé inventée", () => {
    expect(isKnownVariable("usager.pseudo")).toBe(false);
    expect(isKnownVariable("demande.inexistant")).toBe(false);
  });
});

describe("parseVariables", () => {
  it("relève les clés dans l'ordre, sans doublon", () => {
    expect(parseVariables("{{usager.nom}} — {{demande.reference}} — {{usager.nom}}"))
      .toEqual(["usager.nom", "demande.reference"]);
  });

  it("tolère les espaces intérieurs, comme le motif SQL", () => {
    expect(parseVariables("{{  usager.nom  }}")).toEqual(["usager.nom"]);
  });

  it("ignore ce qui n'est pas une variable", () => {
    expect(parseVariables("Une accolade { seule, et {{ PAS UNE VARIABLE }}")).toEqual([]);
    expect(parseVariables("{{Usager.Nom}}")).toEqual([]); // majuscules : pas le motif
    expect(parseVariables("{{sansgroupe}}")).toEqual([]);
    expect(parseVariables("")).toEqual([]);
  });
});

describe("unknownVariables", () => {
  it("ne signale que ce qui manque au catalogue", () => {
    expect(unknownVariables("{{usager.nom}} et {{usager.pseudo}}")).toEqual(["usager.pseudo"]);
  });

  it("rend un tableau vide quand tout est connu", () => {
    expect(unknownVariables("{{demande.reference}} {{agent.nom}}")).toEqual([]);
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

  it("rend un aperçu complet avec les valeurs d'exemple", () => {
    const rendu = renderTemplate(
      "Objet : {{demande.reference}} — {{demande.objet}}",
      previewValues(),
    );
    expect(rendu).toBe("Objet : DEM-2026-000042 — Nid-de-poule rue des Lilas");
    expect(rendu).not.toContain("{{");
  });
});

describe("previewValues", () => {
  it("couvre TOUT le catalogue — aucun trou dans l'aperçu", () => {
    const values = previewValues();
    for (const v of TEMPLATE_VARIABLES) expect(values[v.key]).toBe(v.sample);
    expect(Object.keys(values)).toHaveLength(TEMPLATE_VARIABLES.length);
  });
});

describe("insertVariable", () => {
  it("insère au curseur et rend la position d'après", () => {
    expect(insertVariable("Bonjour , merci", 8, "usager.nom")).toEqual({
      text: "Bonjour {{usager.nom}}, merci",
      caret: 8 + "{{usager.nom}}".length,
    });
  });

  it("insère en fin de texte quand le curseur est au bout", () => {
    expect(insertVariable("Bonjour ", 8, "usager.nom").text).toBe("Bonjour {{usager.nom}}");
  });

  it("borne un curseur aberrant", () => {
    expect(insertVariable("abc", 99, "agent.nom").text).toBe("abc{{agent.nom}}");
    expect(insertVariable("abc", -5, "agent.nom").text).toBe("{{agent.nom}}abc");
  });
});

describe("validateTemplateDraft", () => {
  const ok = {
    name: "Accusé de réception",
    description: "",
    subject: "Votre demande {{demande.reference}}",
    body: "Bonjour {{usager.nom}},",
  };

  it("accepte un modèle complet et n'employant que des variables connues", () => {
    expect(hasErrors(validateTemplateDraft(ok))).toBe(false);
  });

  it("exige un nom, un objet et un corps", () => {
    const errors = validateTemplateDraft(emptyDraft());
    expect(errors.name).toBe("Donnez un nom à ce modèle.");
    expect(errors.subject).toBe("L'objet est obligatoire.");
    expect(errors.body).toBe("Le corps du message est obligatoire.");
  });

  it("refuse un nom fait d'espaces", () => {
    expect(validateTemplateDraft({ ...ok, name: "   " }).name).toBeTruthy();
  });

  it("signale une variable inconnue dans l'objet", () => {
    expect(validateTemplateDraft({ ...ok, subject: "Votre demande {{demande.numero}}" }).subject)
      .toBe("Variable inconnue : {{demande.numero}}.");
  });

  it("signale une variable inconnue dans le corps", () => {
    expect(validateTemplateDraft({ ...ok, body: "Bonjour {{usager.pseudo}}," }).body)
      .toBe("Variable inconnue : {{usager.pseudo}}.");
  });

  it("accorde le message au pluriel", () => {
    expect(validateTemplateDraft({ ...ok, body: "{{a.b}} et {{c.d}}" }).body)
      .toBe("Variables inconnues : {{a.b}}, {{c.d}}.");
  });

  it("la description reste facultative", () => {
    expect(hasErrors(validateTemplateDraft({ ...ok, description: "" }))).toBe(false);
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
