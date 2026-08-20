import { describe, expect, it } from "vitest";
import { buildRequestFacets } from "./facets";

describe("buildRequestFacets", () => {
  it("déduplique, ignore les null et trie par libellé (fr)", () => {
    const facets = buildRequestFacets([
      { socle_organization_id: "o1", socle_organization_label: "Voirie", socle_procedure_id: "p1", socle_procedure_label: "Signalement", source: "iris" },
      { socle_organization_id: "o1", socle_organization_label: "Voirie", socle_procedure_id: null, socle_procedure_label: null, source: "portail-citoyen" },
      { socle_organization_id: "o2", socle_organization_label: "État civil", socle_procedure_id: "p2", socle_procedure_label: "Acte de naissance", source: "iris" },
      { socle_organization_id: null, socle_organization_label: null, socle_procedure_id: "p1", socle_procedure_label: "Signalement", source: "iris" },
    ]);
    expect(facets.destinataires).toEqual([
      { value: "o2", label: "État civil" },
      { value: "o1", label: "Voirie" },
    ]);
    expect(facets.procedures).toEqual([
      { value: "p2", label: "Acte de naissance" },
      { value: "p1", label: "Signalement" },
    ]);
    expect(facets.sources.map((s) => s.value)).toEqual(["iris", "portail-citoyen"]);
  });

  it("replie sur l'UUID quand le libellé manque", () => {
    const facets = buildRequestFacets([
      { socle_organization_id: "o9", socle_organization_label: null, socle_procedure_id: null, socle_procedure_label: null, source: "iris" },
    ]);
    expect(facets.destinataires).toEqual([{ value: "o9", label: "o9" }]);
  });
});
