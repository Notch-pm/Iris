import { describe, expect, it } from "vitest";
import { buildCsv } from "@/lib/csv";
import type { SocleContact } from "./rapprochement";
import {
  activeFilterCount, buildRows, contactPhone, DEFAULT_SORT, EMPTY_FILTERS, filterChips,
  filterUsagers, groupUsagers, matchesSearch, NO_QUARTIER, normalize, orderByGroup, PAGE_SIZE,
  pageCount, paginate, partageState, quartierOptions, removeFilterChip, sortUsagers,
  toggleMultiFilter, toggleSingleFilter, toggleSort, usagerCsvColumns, usagersExportFilename,
  type UsagerFilters, type UsagerRow,
} from "./usagers";

function contact(partial: Partial<SocleContact> & { id: string }): SocleContact {
  return {
    contact_type: "personne", status: "active", display_name: null,
    civility: null, first_name: null, last_name: null, usage_name: null, birth_date: null,
    legal_name: null, siret: null,
    email: null, mobile_phone: null, landline_phone: null, preferred_channel: null,
    address_line1: null, address_line2: null, postal_code: null, city: null, country: "France",
    quartier: null,
    ...partial,
  };
}

function row(partial: Partial<SocleContact> & { id: string }, total = 0, open = 0): UsagerRow {
  return { contact: contact(partial), total, open };
}

const filters = (over: Partial<UsagerFilters> = {}): UsagerFilters => ({ ...EMPTY_FILTERS, ...over });

describe("buildRows", () => {
  it("associe chaque fiche à ses compteurs, 0 par défaut", () => {
    const counts = new Map([["a", { total: 3, open: 1 }]]);
    const rows = buildRows([contact({ id: "a" }), contact({ id: "b" })], counts);
    expect(rows).toEqual([
      { contact: expect.objectContaining({ id: "a" }), total: 3, open: 1 },
      { contact: expect.objectContaining({ id: "b" }), total: 0, open: 0 },
    ]);
  });
});

describe("contactPhone", () => {
  it("préfère le mobile, replie sur le fixe, sinon vide", () => {
    expect(contactPhone(contact({ id: "a", mobile_phone: "0612", landline_phone: "0299" }))).toBe("0612");
    expect(contactPhone(contact({ id: "a", landline_phone: "0299" }))).toBe("0299");
    expect(contactPhone(contact({ id: "a" }))).toBe("");
  });
});

describe("matchesSearch", () => {
  const marie = row({
    id: "a", display_name: "Marie Dupont-Léger", email: "marie@exemple.fr",
    mobile_phone: "06 12 34 56 78", city: "Arles", postal_code: "13200",
    quartier: { id: "q1", name: "Trinquetaille", color: null },
  });

  it("ignore accents et casse", () => {
    expect(matchesSearch(marie, "leger")).toBe(true);
    expect(matchesSearch(marie, "LÉGER")).toBe(true);
    expect(normalize("Léger")).toBe("leger");
  });

  it("exige TOUS les mots, dans n'importe quel ordre", () => {
    expect(matchesSearch(marie, "dupont marie")).toBe(true);
    expect(matchesSearch(marie, "marie arles")).toBe(true);
    expect(matchesSearch(marie, "marie nantes")).toBe(false);
  });

  it("cherche aussi le quartier et le courriel", () => {
    expect(matchesSearch(marie, "trinquetaille")).toBe(true);
    expect(matchesSearch(marie, "exemple.fr")).toBe(true);
  });

  it("compare les chiffres sans la ponctuation du téléphone", () => {
    expect(matchesSearch(marie, "0612345678")).toBe(true);
    expect(matchesSearch(marie, "06 12 34")).toBe(true);
    expect(matchesSearch(marie, "13200")).toBe(true);
    expect(matchesSearch(marie, "9999")).toBe(false);
  });

  it("une requête entièrement numérique n'est PAS découpée en mots", () => {
    // « 06 01 25 » découpé donnerait « 06 » ET « 01 » ET « 25 », présents dans
    // presque toutes les fiches (29 résultats en navigateur avant correction).
    const autre = row({ id: "b", display_name: "Paul", mobile_phone: "06 01 98 76 69", postal_code: "13990" });
    expect(matchesSearch(autre, "06 01 25")).toBe(false);
    expect(matchesSearch(autre, "0601 98")).toBe(true);
  });

  it("un mot de moins de 4 chiffres dans une requête mixte ne matche pas par chiffres", () => {
    expect(matchesSearch(marie, "marie 612")).toBe(false);
    expect(matchesSearch(marie, "marie 1234")).toBe(true);
  });

  it("une recherche vide ne filtre rien", () => {
    expect(matchesSearch(marie, "   ")).toBe(true);
  });
});

describe("filterUsagers", () => {
  const rows = [
    row({ id: "a", display_name: "Marie", quartier: { id: "q1", name: "Nord", color: null } }, 5, 2),
    row({ id: "b", display_name: "Association Sud", contact_type: "association" }, 0, 0),
    row({ id: "c", display_name: "Paul", quartier: { id: "q2", name: "Sud", color: null } }, 1, 0),
  ];

  it("filtre par public (plusieurs valeurs = OU)", () => {
    expect(filterUsagers(rows, filters({ type: ["association"] })).map((r) => r.contact.id)).toEqual(["b"]);
    expect(filterUsagers(rows, filters({ type: ["association", "personne"] }))).toHaveLength(3);
  });

  it("filtre par quartier, y compris « sans quartier »", () => {
    expect(filterUsagers(rows, filters({ quartier: ["q2"] })).map((r) => r.contact.id)).toEqual(["c"]);
    expect(filterUsagers(rows, filters({ quartier: [NO_QUARTIER] })).map((r) => r.contact.id)).toEqual(["b"]);
    expect(filterUsagers(rows, filters({ quartier: ["q1", NO_QUARTIER] })).map((r) => r.contact.id)).toEqual(["a", "b"]);
  });

  it("filtre par consentement au partage : opt-in, opt-out, jamais demandé", () => {
    const withConsent = [
      row({ id: "in", consent_partage: true, consent_partage_at: "2026-09-21T10:00:00Z" }),
      row({ id: "out", consent_partage: false, consent_partage_at: "2026-09-21T10:00:00Z" }),
      row({ id: "jamais", consent_partage: false, consent_partage_at: null }),
    ];
    const ids = (partage: string[]) => filterUsagers(withConsent, filters({ partage })).map((r) => r.contact.id);
    expect(ids(["accepte"])).toEqual(["in"]);
    // Jamais demandé n'est PAS un refus : la date tranche.
    expect(ids(["refuse"])).toEqual(["out"]);
    expect(ids(["jamais_demande"])).toEqual(["jamais"]);
    expect(ids(["refuse", "jamais_demande"])).toEqual(["out", "jamais"]);
  });

  it("filtre par volumétrie de demandes et de demandes en cours", () => {
    expect(filterUsagers(rows, filters({ total: "0" })).map((r) => r.contact.id)).toEqual(["b"]);
    expect(filterUsagers(rows, filters({ total: "2" })).map((r) => r.contact.id)).toEqual(["a"]);
    expect(filterUsagers(rows, filters({ open: "1" })).map((r) => r.contact.id)).toEqual(["a"]);
    expect(filterUsagers(rows, filters({ open: "0" })).map((r) => r.contact.id)).toEqual(["b", "c"]);
  });

  it("combine les filtres et la recherche", () => {
    expect(filterUsagers(rows, filters({ search: "sud", total: "0" })).map((r) => r.contact.id))
      .toEqual(["b"]);
  });

  it("un palier inconnu ne filtre rien (valeur d'URL périmée)", () => {
    expect(filterUsagers(rows, filters({ total: "42" }))).toHaveLength(3);
  });
});

describe("quartierOptions", () => {
  it("trie par nom et ajoute « Sans quartier » seulement s'il y en a", () => {
    const rows = [
      row({ id: "a", quartier: { id: "q2", name: "Sud", color: null } }),
      row({ id: "b", quartier: { id: "q1", name: "Nord", color: null } }),
      row({ id: "c", quartier: { id: "q2", name: "Sud", color: null } }),
      row({ id: "d" }),
    ];
    expect(quartierOptions(rows)).toEqual([
      { value: "q1", label: "Nord" },
      { value: "q2", label: "Sud" },
      { value: NO_QUARTIER, label: "Sans quartier" },
    ]);
    expect(quartierOptions(rows.slice(0, 3))).toHaveLength(2);
  });
});

describe("toggleSort", () => {
  it("nouvelle colonne : sens par défaut, volumétries du plus grand au plus petit", () => {
    expect(toggleSort(DEFAULT_SORT, "city")).toEqual({ key: "city", dir: "asc" });
    expect(toggleSort(DEFAULT_SORT, "total")).toEqual({ key: "total", dir: "desc" });
  });

  it("même colonne : inversion, jamais de retour à « non trié »", () => {
    expect(toggleSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(toggleSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("sortUsagers", () => {
  const rows = [
    row({ id: "c", display_name: "Zoé", city: "Arles" }, 1, 0),
    row({ id: "a", display_name: "Émile", city: null }, 7, 3),
    row({ id: "b", display_name: "Adèle", city: "Nîmes" }, 3, 1),
  ];

  it("trie par nom sans tenir compte des accents", () => {
    expect(sortUsagers(rows, { key: "name", dir: "asc" }).map((r) => r.contact.id))
      .toEqual(["b", "a", "c"]);
  });

  it("trie par volumétrie", () => {
    expect(sortUsagers(rows, { key: "total", dir: "desc" }).map((r) => r.contact.id))
      .toEqual(["a", "b", "c"]);
    expect(sortUsagers(rows, { key: "open", dir: "asc" }).map((r) => r.contact.id))
      .toEqual(["c", "b", "a"]);
  });

  it("laisse les cases vides en fin de liste dans LES DEUX sens", () => {
    expect(sortUsagers(rows, { key: "city", dir: "asc" }).map((r) => r.contact.id))
      .toEqual(["c", "b", "a"]);
    expect(sortUsagers(rows, { key: "city", dir: "desc" }).map((r) => r.contact.id))
      .toEqual(["b", "c", "a"]);
  });

  it("départage les ex æquo par nom (tri stable et reproductible)", () => {
    const tied = [
      row({ id: "z", display_name: "Zoé" }, 2, 0),
      row({ id: "a", display_name: "Adèle" }, 2, 0),
    ];
    expect(sortUsagers(tied, { key: "total", dir: "desc" }).map((r) => r.contact.id))
      .toEqual(["a", "z"]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const before = rows.map((r) => r.contact.id);
    sortUsagers(rows, { key: "total", dir: "desc" });
    expect(rows.map((r) => r.contact.id)).toEqual(before);
  });
});

describe("partageState", () => {
  it("distingue accepté, refusé et jamais demandé (la date tranche)", () => {
    expect(partageState(contact({ id: "a", consent_partage: true, consent_partage_at: "2026-09-21T10:00:00Z" }))).toBe("accepte");
    expect(partageState(contact({ id: "a", consent_partage: false, consent_partage_at: "2026-09-21T10:00:00Z" }))).toBe("refuse");
    expect(partageState(contact({ id: "a", consent_partage: false, consent_partage_at: null }))).toBe("jamais_demande");
    expect(partageState(contact({ id: "a" }))).toBe("jamais_demande");
  });

  it("trie opt-in, opt-out, puis jamais demandé", () => {
    const rows = [
      row({ id: "j", display_name: "A" }),
      row({ id: "r", display_name: "B", consent_partage: false, consent_partage_at: "2026-09-21T10:00:00Z" }),
      row({ id: "i", display_name: "C", consent_partage: true, consent_partage_at: "2026-09-21T10:00:00Z" }),
    ];
    expect(sortUsagers(rows, { key: "partage", dir: "asc" }).map((r) => r.contact.id)).toEqual(["i", "r", "j"]);
  });

  it("figure à l'export", () => {
    const csv = buildCsv([row({ id: "a", consent_partage: true, consent_partage_at: "2026-09-21T10:00:00Z" })], usagerCsvColumns());
    expect(csv).toContain("Partage d'informations");
    expect(csv).toContain("Accepté");
  });
});

describe("filtres actifs", () => {
  it("compte les critères, le statut par défaut exclu", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(filters({ type: ["personne", "entreprise"], partage: ["accepte"], status: "all", total: "1" }))).toBe(5);
  });

  it("bascule une valeur multiple, et une valeur exclusive re-cliquée se retire", () => {
    const f = toggleMultiFilter(EMPTY_FILTERS, "partage", "accepte");
    expect(f.partage).toEqual(["accepte"]);
    expect(toggleMultiFilter(f, "partage", "accepte").partage).toEqual([]);
    const g = toggleSingleFilter(EMPTY_FILTERS, "total", "2");
    expect(g.total).toBe("2");
    expect(toggleSingleFilter(g, "total", "2").total).toBe("");
  });

  it("pastilles libellées et retirables une à une", () => {
    const f = filters({ partage: ["refuse"], quartier: ["q1", NO_QUARTIER], status: "archived" });
    const chips = filterChips(f, (id) => (id === "q1" ? "Nord" : undefined));
    expect(chips.map((c) => c.label)).toEqual(["Fiches : archivés", "Partage : refusé", "Nord", "Sans quartier"]);
    const after = chips.reduce((acc, c) => removeFilterChip(acc, c), f);
    expect(after).toEqual(EMPTY_FILTERS);
  });
});

describe("regroupement", () => {
  const rows = [
    row({ id: "a", display_name: "Anne", city: "Rosny" }),
    row({ id: "b", display_name: "Bruno", city: null, contact_type: "association" }),
    row({ id: "c", display_name: "Chloé", city: "Arles", consent_partage: true, consent_partage_at: "2026-09-21T10:00:00Z" }),
    row({ id: "d", display_name: "Denis", city: "rosny" }),
  ];

  it("ordonne toute la sélection par groupe, non renseigné en dernier, l'ordre du tri conservé dedans", () => {
    expect(orderByGroup(rows, "city").map((r) => r.contact.id)).toEqual(["c", "a", "d", "b"]);
    expect(orderByGroup(rows, "partage").map((r) => r.contact.id)).toEqual(["c", "a", "b", "d"]);
    expect(orderByGroup(rows, "type").map((r) => r.contact.id)).toEqual(["a", "c", "d", "b"]);
    expect(orderByGroup(rows, null)).toEqual(rows);
  });

  it("groupe la page affichée et compte chaque groupe sur toute la sélection", () => {
    const ordered = orderByGroup(rows, "city");
    const groups = groupUsagers(ordered.slice(0, 2), ordered, "city");
    expect(groups.map((g) => [g.label, g.items.length, g.total])).toEqual([["Arles", 1, 1], ["Rosny", 1, 2]]);
    const partage = groupUsagers(rows, rows, "partage");
    expect(partage.map((g) => g.label)).toEqual(["Partage jamais demandé", "Partage accepté"]);
  });
});

describe("pagination", () => {
  const rows = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => row({ id: `c${i}` }));

  it("compte au moins une page, même vide", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
  });

  it("ramène une page hors bornes dans les bornes", () => {
    expect(paginate(rows, 1)).toHaveLength(PAGE_SIZE);
    expect(paginate(rows, 2)).toHaveLength(3);
    expect(paginate(rows, 99)).toHaveLength(3);
    expect(paginate(rows, 0)).toHaveLength(PAGE_SIZE);
  });
});

describe("export CSV", () => {
  it("rend les libellés FR, le quartier et les compteurs", () => {
    const rows = [row({
      id: "a", display_name: "Marie Dupont", contact_type: "personne", email: "marie@exemple.fr",
      city: "Arles", quartier: { id: "q1", name: "Nord", color: "#123456" },
    }, 4, 2)];
    const csv = buildCsv(rows, usagerCsvColumns());
    const [header, line] = csv.split("\r\n");
    expect(header).toContain("Demandes visibles");
    expect(line).toContain("Citoyen");
    expect(line).toContain("Marie Dupont");
    expect(line).toContain("Nord");
    expect(line?.endsWith("4;2;a")).toBe(true);
  });

  it("nomme le fichier d'après le tenant et le jour", () => {
    expect(usagersExportFilename("Mairie d'Arles — ACCM", new Date("2026-08-23T15:00:00Z")))
      .toBe("usagers-mairie-d-arles-accm-2026-08-23.csv");
  });
});
