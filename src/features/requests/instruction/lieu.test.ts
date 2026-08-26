import { describe, expect, it } from "vitest";
import { interventionLocation } from "./lieu";

// Miroir du bloc « Lieu d'intervention » inséré par le Socle
// (createLieuInterventionSection) : une section ordinaire, clés préfixées.
const BTQ_OPTIONS = [
  { value: "bis", label: "Bis" },
  { value: "ter", label: "Ter" },
  { value: "quater", label: "Quater" },
];

function lieuSection(extra: Record<string, unknown> = {}) {
  return {
    id: "sec-lieu",
    kind: "section",
    title: "Lieu d'intervention",
    fields: [
      { id: "f1", key: "intervention_numero", label: "Numéro", type: "text" },
      { id: "f2", key: "intervention_btq", label: "BTQ", type: "select", options: BTQ_OPTIONS },
      { id: "f3", key: "intervention_voie", label: "Voie", type: "text", required: true },
      { id: "f4", key: "intervention_complement", label: "Complément d'adresse", type: "text" },
      { id: "f5", key: "intervention_appartement", label: "Appartement", type: "text" },
      { id: "f6", key: "intervention_code_postal", label: "Code postal", type: "text", required: true },
      { id: "f7", key: "intervention_ville", label: "Ville", type: "text", required: true },
    ],
    ...extra,
  };
}

const snapshot = (content: unknown[]) => ({ form_schema: { version: 1, content } });

const ADDRESS = {
  intervention_numero: "6",
  intervention_btq: "bis",
  intervention_voie: "Rue de la République",
  intervention_complement: "Bâtiment C",
  intervention_appartement: "12",
  intervention_code_postal: "69001",
  intervention_ville: "Lyon",
};

describe("interventionLocation", () => {
  it("compose l'adresse postale du bloc Socle", () => {
    const lieu = interventionLocation(snapshot([lieuSection()]), ADDRESS);
    expect(lieu).toMatchObject({
      title: "Lieu d'intervention",
      lines: ["6 Bis Rue de la République", "69001 Lyon"],
      query: "6 Bis Rue de la République, 69001 Lyon",
      details: [
        { label: "Complément d'adresse", value: "Bâtiment C" },
        { label: "Appartement", value: "12" },
      ],
      postcode: "69001",
      city: "Lyon",
      empty: false,
    });
  });

  it("déclare les clés couvertes, pour ne pas répéter l'adresse dans les informations saisies", () => {
    const lieu = interventionLocation(snapshot([lieuSection()]), ADDRESS);
    expect(lieu!.keys).toEqual([
      "intervention_numero", "intervention_btq", "intervention_voie", "intervention_complement",
      "intervention_appartement", "intervention_code_postal", "intervention_ville",
    ]);
  });

  it("se contente de ce qui est renseigné", () => {
    const lieu = interventionLocation(snapshot([lieuSection()]), {
      intervention_voie: "Chemin des Vignes",
      intervention_ville: "Sainte-Foy-lès-Lyon",
    });
    expect(lieu).toMatchObject({
      lines: ["Chemin des Vignes", "Sainte-Foy-lès-Lyon"],
      query: "Chemin des Vignes, Sainte-Foy-lès-Lyon",
      details: [],
      postcode: null,
      empty: false,
    });
  });

  it("signale la question posée mais restée sans réponse", () => {
    const lieu = interventionLocation(snapshot([lieuSection()]), {});
    expect(lieu).toMatchObject({ lines: [], query: "", details: [], empty: true });
  });

  it("ne rend rien quand la démarche ne demande pas de lieu", () => {
    const autre = {
      id: "sec-1", kind: "section", title: "Votre demande",
      fields: [{ id: "a1", key: "precisions", label: "Précisions", type: "textarea" }],
    };
    expect(interventionLocation(snapshot([autre]), { precisions: "…" })).toBeNull();
    expect(interventionLocation(null, { precisions: "…" })).toBeNull();
  });

  it("respecte les conditions de visibilité de la section", () => {
    const content = [
      { id: "q", key: "sur_place", label: "Intervention sur place ?", type: "boolean" },
      lieuSection({ visibleIf: { combinator: "and", rules: [{ fieldId: "q", operator: "equals", value: "true" }] } }),
    ];
    expect(interventionLocation(snapshot(content), { sur_place: false, ...ADDRESS })).toBeNull();
    expect(interventionLocation(snapshot(content), { sur_place: true, ...ADDRESS })).not.toBeNull();
  });

  it("reconnaît le bloc renommé dans le Socle, par le titre puis les libellés", () => {
    const renamed = {
      id: "sec-lieu", kind: "section", title: "Lieu d'intervention (voirie)",
      fields: [
        { id: "g1", key: "voirie_numero", label: "Numéro", type: "text" },
        { id: "g2", key: "voirie_rue", label: "Voie", type: "text" },
        { id: "g3", key: "voirie_cp", label: "Code postal", type: "text" },
        { id: "g4", key: "voirie_commune", label: "Commune", type: "text" },
        { id: "g5", key: "voirie_repere", label: "Point de repère", type: "text" },
      ],
    };
    const lieu = interventionLocation(snapshot([renamed]), {
      voirie_numero: "14", voirie_rue: "Avenue Jean Jaurès", voirie_cp: "69007",
      voirie_commune: "Lyon", voirie_repere: "face à la boulangerie",
    });
    expect(lieu).toMatchObject({
      title: "Lieu d'intervention (voirie)",
      lines: ["14 Avenue Jean Jaurès", "69007 Lyon"],
      // Le point de repère n'est pas une part d'adresse : il reste dans les
      // informations saisies.
      keys: ["voirie_numero", "voirie_rue", "voirie_cp", "voirie_commune"],
    });
  });

  it("complète les clés du contrat par les libellés de la même section", () => {
    const partiel = {
      id: "sec-lieu", kind: "section", title: "Lieu d'intervention",
      fields: [
        { id: "h1", key: "intervention_voie", label: "Voie", type: "text" },
        { id: "h2", key: "cp_travaux", label: "Code postal", type: "text" },
        { id: "h3", key: "ville_travaux", label: "Ville", type: "text" },
      ],
    };
    const lieu = interventionLocation(snapshot([partiel]), {
      intervention_voie: "Quai Claude Bernard", cp_travaux: "69007", ville_travaux: "Lyon",
    });
    expect(lieu).toMatchObject({ lines: ["Quai Claude Bernard", "69007 Lyon"], postcode: "69007", city: "Lyon" });
  });

  it("suit le repli sur l'id quand le Socle a laissé les clés machine vides", () => {
    // Cas constaté en production : le builder Socle enregistre `key: ""` et
    // `form_data` est alors indexé par l'id du champ.
    const sansCles = {
      id: "sec-lieu", kind: "section", title: "Lieu d'intervention",
      fields: [
        { id: "id-numero", key: "", label: "Numéro", type: "text" },
        { id: "id-voie", key: "", label: "Voie", type: "text" },
        { id: "id-cp", key: "", label: "Code postal", type: "text" },
        { id: "id-ville", key: "", label: "Ville", type: "text" },
      ],
    };
    const lieu = interventionLocation(snapshot([sansCles]), {
      "id-numero": "3", "id-voie": "Place Bellecour", "id-cp": "69002", "id-ville": "Lyon",
    });
    expect(lieu).toMatchObject({
      lines: ["3 Place Bellecour", "69002 Lyon"],
      keys: ["id-numero", "id-voie", "id-cp", "id-ville"],
    });
  });

  it("n'attire pas les champs homonymes d'une autre section", () => {
    const content = [
      lieuSection(),
      {
        id: "sec-2", kind: "section", title: "Facturation",
        fields: [{ id: "b1", key: "facturation_ville", label: "Ville", type: "text" }],
      },
    ];
    const lieu = interventionLocation(snapshot(content), { ...ADDRESS, facturation_ville: "Villeurbanne" });
    expect(lieu!.city).toBe("Lyon");
    expect(lieu!.keys).not.toContain("facturation_ville");
  });

  it("reconstitue l'adresse d'un snapshot dégradé, sur les seules clés du contrat", () => {
    const lieu = interventionLocation({ id: "proc-1", label: "Éclairage public" }, ADDRESS);
    expect(lieu).toMatchObject({
      title: "Lieu d'intervention",
      // Sans schéma, la valeur brute de la liste BTQ ne peut pas être traduite.
      lines: ["6 bis Rue de la République", "69001 Lyon"],
      details: [
        { label: "Complément d'adresse", value: "Bâtiment C" },
        { label: "Appartement", value: "12" },
      ],
    });
    expect(interventionLocation({ id: "proc-1" }, { autre_champ: "x" })).toBeNull();
  });
});
