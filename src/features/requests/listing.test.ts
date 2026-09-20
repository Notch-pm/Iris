import { describe, expect, it } from "vitest";
import {
  activeFilterCount, DEFAULT_SORT, EMPTY_FILTERS, exportFilename, filterChips, GROUP_LABELS, groupLabelOf, groupRows,
  orderClauses, pageWindow, removeFilterChip, requestCsvColumns, searchClause, toggleFilterValue,
  toggleSort,
} from "./listing";
import type { RequestListItem } from "./useRequests";

function item(partial: Partial<RequestListItem>): RequestListItem {
  return {
    id: "r", reference: "DEM-2026-000001", subject: "Objet", status: "a_traiter", priority: "normale",
    source: "iris", identity_status: "anonyme", socle_organization_id: null, socle_organization_label: null,
    socle_procedure_id: null, socle_procedure_label: null, assigned_to: null,
    received_at: "2026-08-22T10:00:00Z", due_at: null, created_at: "2026-08-22T10:00:00Z",
    updated_at: "2026-08-22T10:00:00Z",
    ...partial,
  };
}

describe("tri", () => {
  it("nouvelle colonne → sens par défaut (dates du plus récent d'abord), même colonne → inversion", () => {
    expect(toggleSort(DEFAULT_SORT, "subject")).toEqual({ key: "subject", dir: "asc" });
    expect(toggleSort({ key: "subject", dir: "asc" }, "subject")).toEqual({ key: "subject", dir: "desc" });
    expect(toggleSort({ key: "subject", dir: "asc" }, "received_at")).toEqual({ key: "received_at", dir: "desc" });
    expect(toggleSort(DEFAULT_SORT, "received_at")).toEqual({ key: "received_at", dir: "asc" });
  });

  it("la référence se trie par année puis numéro, avec un départage stable", () => {
    expect(orderClauses({ key: "reference", dir: "desc" }, null)).toEqual([
      { column: "reference_year", ascending: false },
      { column: "reference_seq", ascending: false },
      { column: "created_at", ascending: false },
    ]);
    expect(orderClauses(DEFAULT_SORT, null)).toEqual([{ column: "received_at", ascending: false }]);
  });

  it("la clé de groupe passe devant le tri (groupes contigus entre pages)", () => {
    expect(orderClauses({ key: "subject", dir: "asc" }, "status")[0]).toEqual({ column: "status", ascending: true });
  });
});

describe("vocabulaire", () => {
  // Décision du 2026-08-30 : ce que l'agent lit, c'est « Organisme » — sur le
  // tableau comme sur la liste. Les CLÉS, elles, restent `destinataire` : elles
  // circulent (état d'écran, URL de la liste) et les renommer casserait les
  // liens existants. Ce test fige le libellé, pas la clé.
  it("le regroupement par organisation s'intitule « Organisme »", () => {
    expect(GROUP_LABELS.destinataire).toBe("Organisme");
    expect(groupLabelOf(item({ socle_organization_label: null }), "destinataire"))
      .toBe("Sans organisme");
  });
});

describe("regroupement", () => {
  it("regroupe dans l'ordre d'apparition avec libellés FR et valeurs vides nommées", () => {
    const rows = [
      item({ id: "1", status: "en_instruction", socle_organization_label: "Voirie" }),
      item({ id: "2", status: "a_traiter", socle_organization_label: null }),
      item({ id: "3", status: "en_instruction", socle_organization_label: "Voirie" }),
    ];
    const byStatus = groupRows(rows, "status");
    expect(byStatus.map((g) => [g.label, g.items.length])).toEqual([
      ["En cours d'instruction", 2], ["À traiter", 1],
    ]);
    const byDest = groupRows(rows, "destinataire");
    expect(byDest.map((g) => g.label)).toEqual(["Voirie", "Sans organisme"]);
  });

  it("sans clé : un seul groupe sans libellé", () => {
    const g = groupRows([item({})], null);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("");
  });
});

describe("filtres", () => {
  const resolve = (key: string, value: string) =>
    key === "destinataire" && value === "org-1" ? "Voirie" : undefined;

  it("bascule une valeur, compte les critères (recherche comprise)", () => {
    let f = toggleFilterValue(EMPTY_FILTERS, "status", "a_traiter");
    f = toggleFilterValue(f, "status", "en_attente");
    expect(f.status).toEqual(["a_traiter", "en_attente"]);
    expect(activeFilterCount(f)).toBe(2);
    f = toggleFilterValue(f, "status", "a_traiter");
    expect(f.status).toEqual(["en_attente"]);
    expect(activeFilterCount({ ...f, q: "  " })).toBe(1);
    expect(activeFilterCount({ ...f, q: "élagage" })).toBe(2);
  });

  it("chips : recherche d'abord, statuts et priorités traduits, catalogue pour le reste", () => {
    const f = {
      ...EMPTY_FILTERS, q: " arbre ", status: ["a_traiter"], priority: ["haute"],
      destinataire: ["org-1", "org-2"],
    };
    expect(filterChips(f, resolve).map((c) => c.label)).toEqual([
      "Recherche : « arbre »",
      "Statut : À traiter",
      "Organisme : Voirie",
      "Organisme : org-2",
      "Priorité : Haute",
    ]);
  });

  it("retirer une chip ôte la valeur de son critère ; la chip de recherche vide la saisie", () => {
    const f = { ...EMPTY_FILTERS, q: "arbre", status: ["a_traiter", "en_attente"] };
    const chips = filterChips(f, resolve);
    expect(removeFilterChip(f, chips[0]).q).toBe("");
    expect(removeFilterChip(f, chips[1]).status).toEqual(["en_attente"]);
  });
});

describe("recherche", () => {
  it("rien à chercher sous deux caractères", () => {
    expect(searchClause("")).toBeNull();
    expect(searchClause(" a ")).toBeNull();
  });

  it("cherche l'objet ET la référence, jokers neutralisés, valeur citée", () => {
    expect(searchClause("élagage")).toBe('subject.ilike."%élagage%",reference.ilike."%élagage%"');
    expect(searchClause("50%_a")).toBe('subject.ilike."%50\\%\\_a%",reference.ilike."%50\\%\\_a%"');
    expect(searchClause('rue "A", (b)')).toBe(
      'subject.ilike."%rue \\"A\\", (b)%",reference.ilike."%rue \\"A\\", (b)%"',
    );
  });
});

describe("pagination", () => {
  it("toutes les pages jusqu'à 7, fenêtre avec ellipses au-delà", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 16, 17, 18, 19, 20]);
  });
});

describe("export", () => {
  it("colonnes FR, assigné résolu par nom, dates lisibles", () => {
    const cols = requestCsvColumns((id) => (id === "u1" ? "Camille Durand" : "?"));
    const row = item({ assigned_to: "u1", status: "resolue_positive", priority: "haute", due_at: "2026-09-01T00:00:00Z" });
    const values = Object.fromEntries(cols.map((c) => [c.header, c.accessor(row)]));
    expect(values["Statut"]).toBe("Résolue positivement");
    expect(values["Priorité"]).toBe("Haute");
    expect(values["Assignée à"]).toBe("Camille Durand");
    expect(values["Échéance"]).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(values["Organisme"]).toBe("");
  });

  it("nom de fichier épuré et daté", () => {
    expect(exportFilename("Mairie d'Arles — ACCM", new Date("2026-08-22T15:00:00Z")))
      .toBe("demandes-mairie-d-arles-accm-2026-08-22.csv");
    expect(exportFilename("", new Date("2026-08-22T15:00:00Z"))).toBe("demandes-tenant-2026-08-22.csv");
  });
});
