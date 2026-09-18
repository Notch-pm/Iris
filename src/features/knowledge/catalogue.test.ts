import { describe, expect, it } from "vitest";
import type { SocleProcedureRow } from "@/features/socle/useSocleCatalog";
import {
  buildCatalogue,
  filterCatalogue,
  groupByCategory,
  organismesLabel,
  UNCATEGORIZED,
} from "./catalogue";

const row = (over: Partial<SocleProcedureRow> & { socle_id: string; name: string }): SocleProcedureRow => ({
  category_name: null,
  type: "externe",
  publication: { portalVisible: true, publicationStart: null, publicationEnd: null },
  ...over,
});

const ROWS: SocleProcedureRow[] = [
  row({ socle_id: "p1", name: "Demande de carte de déchetterie", category_name: "Déchetteries" }),
  row({
    socle_id: "p2", name: "Réserver une salle municipale", category_name: "Associations",
    publication: { portalVisible: false, publicationStart: null, publicationEnd: null },
  }),
  row({
    socle_id: "p3", name: "Inscription au concours de façades", category_name: "Associations",
    publication: { portalVisible: true, publicationStart: "2026-09-01", publicationEnd: "2026-10-15" },
  }),
  row({ socle_id: "p4", name: "Signaler un dépôt sauvage", category_name: "  " }),
];

const ORGS = [
  { value: "o-sna", label: "Seine Normandie Agglomération" },
  { value: "o-vernon", label: "Vernon" },
  { value: "o-gasny", label: "Gasny" },
];

const ACTIVATIONS = [
  { socle_org_id: "o-vernon", socle_procedure_id: "p1" },
  { socle_org_id: "o-sna", socle_procedure_id: "p1" },
  { socle_org_id: "o-gasny", socle_procedure_id: "p2" },
  // Organisme sorti du miroir : jamais inventé.
  { socle_org_id: "o-disparu", socle_procedure_id: "p2" },
];

const AUDIENCES = new Map([["p1", ["citoyen", "association"] as const], ["p2", ["entreprise"] as const]]);

describe("buildCatalogue", () => {
  const catalogue = buildCatalogue(ROWS, ACTIVATIONS, ORGS, AUDIENCES);
  const byId = Object.fromEntries(catalogue.map((c) => [c.id, c]));

  it("nomme les organismes qui proposent chaque démarche, triés", () => {
    expect(byId.p1.organismes).toEqual(["Seine Normandie Agglomération", "Vernon"]);
    expect(byId.p2.organismes).toEqual(["Gasny"]);
  });

  // Opt-in strict : absente du miroir = proposée par personne, pas « par tous ».
  it("une démarche sans activation n'a aucun organisme", () => {
    expect(byId.p3.organismes).toEqual([]);
  });

  it("signale l'ouverture temporaire et l'absence du portail, seulement quand il y a lieu", () => {
    expect(byId.p3.temporaryPeriod).toContain("Publiée du");
    expect(byId.p1.temporaryPeriod).toBeNull();
    expect(byId.p2.portalAbsence).toBe("Non visible portail");
    expect(byId.p1.portalAbsence).toBeNull();
  });

  it("libelle le public concerné ; inconnu, il reste vide", () => {
    expect(byId.p1.audiences).toEqual(["Citoyen", "Association"]);
    expect(byId.p3.audiences).toEqual([]);
    expect(buildCatalogue(ROWS, ACTIVATIONS, ORGS)[0].audiences).toEqual([]);
  });

  it("une catégorie blanche vaut « pas de catégorie »", () => {
    expect(byId.p4.category).toBeNull();
  });
});

describe("filterCatalogue", () => {
  const catalogue = buildCatalogue(ROWS, ACTIVATIONS, ORGS, AUDIENCES);

  it("ignore accents et casse, et cherche aussi dans la catégorie et les organismes", () => {
    expect(filterCatalogue(catalogue, "DECHETTERIE").map((c) => c.id)).toEqual(["p1"]);
    expect(filterCatalogue(catalogue, "associations").map((c) => c.id)).toEqual(["p2", "p3"]);
    expect(filterCatalogue(catalogue, "vernon").map((c) => c.id)).toEqual(["p1"]);
    expect(filterCatalogue(catalogue, "entreprise").map((c) => c.id)).toEqual(["p2"]);
  });

  it("plusieurs mots : tous doivent se trouver, dans n'importe quel ordre", () => {
    expect(filterCatalogue(catalogue, "déchetterie carte").map((c) => c.id)).toEqual(["p1"]);
    expect(filterCatalogue(catalogue, "carte salle")).toEqual([]);
  });

  it("une recherche vide rend tout", () => {
    expect(filterCatalogue(catalogue, "   ")).toHaveLength(4);
  });
});

describe("groupByCategory", () => {
  it("catégories par ordre alphabétique, « Sans catégorie » en dernier, démarches triées", () => {
    const groups = groupByCategory(buildCatalogue(ROWS, ACTIVATIONS, ORGS));
    expect(groups.map((g) => g.label)).toEqual(["Associations", "Déchetteries", UNCATEGORIZED]);
    expect(groups[0].procedures.map((p) => p.id)).toEqual(["p3", "p2"]);
  });
});

describe("organismesLabel", () => {
  it("abrège une liste longue, et se tait sans organisme", () => {
    expect(organismesLabel(["A", "B"])).toBe("A, B");
    expect(organismesLabel(["A", "B", "C", "D"])).toBe("A, B, C et 1 autre");
    expect(organismesLabel(["A", "B", "C", "D", "E"])).toBe("A, B, C et 2 autres");
    expect(organismesLabel([])).toBeNull();
  });
});
