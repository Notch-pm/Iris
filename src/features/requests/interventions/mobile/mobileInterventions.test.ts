import { describe, expect, it } from "vitest";
import type { InterventionRow } from "../interventions";
import {
  addDays, bucketOf, counts, filterByStatus, groupInterventions, isImageFile, photoLabel,
  requestedByLine, type MobileFilter,
} from "./mobileInterventions";

const TODAY = "2026-09-10";

function row(overrides: Partial<InterventionRow> = {}): InterventionRow {
  return {
    id: "int-1",
    request_id: "req-1",
    organization_id: "org-1",
    intervenant_id: "user-1",
    requested_by: "agent-1",
    requested_at: "2026-09-01T10:00:00Z",
    requested_for: TODAY,
    request_comment: "Enlever les encombrants.",
    status: "demandee",
    completed_at: null,
    completed_on: null,
    completion_comment: null,
    ...overrides,
  };
}

describe("addDays", () => {
  it("avance dans le même mois", () => {
    expect(addDays("2026-09-10", 6)).toBe("2026-09-16");
  });

  it("franchit une fin de mois", () => {
    expect(addDays("2026-09-28", 5)).toBe("2026-10-03");
  });

  it("rend l'entrée telle quelle si elle n'est pas AAAA-MM-JJ", () => {
    expect(addDays("n-importe-quoi", 3)).toBe("n-importe-quoi");
  });
});

describe("bucketOf", () => {
  it("réalisée → 'realisees', même une date passée", () => {
    expect(bucketOf(row({ status: "realisee", requested_for: "2026-01-01" }), TODAY)).toBe("realisees");
  });

  it("jour passé → 'en_retard'", () => {
    expect(bucketOf(row({ requested_for: "2026-09-09" }), TODAY)).toBe("en_retard");
  });

  it("jour même → 'aujourdhui'", () => {
    expect(bucketOf(row({ requested_for: TODAY }), TODAY)).toBe("aujourdhui");
  });

  it("dans les six jours suivants (borne incluse) → 'cette_semaine'", () => {
    expect(bucketOf(row({ requested_for: "2026-09-16" }), TODAY)).toBe("cette_semaine");
  });

  it("au-delà de six jours → 'plus_tard'", () => {
    expect(bucketOf(row({ requested_for: "2026-09-17" }), TODAY)).toBe("plus_tard");
  });
});

describe("groupInterventions", () => {
  it("ordonne en_retard, aujourdhui, cette_semaine, plus_tard, realisees et omet les groupes vides", () => {
    const rows = [
      row({ id: "a", requested_for: "2026-09-20" }), // plus_tard
      row({ id: "b", requested_for: TODAY }), // aujourdhui
      row({ id: "c", status: "realisee", completed_at: "2026-09-05T00:00:00Z" }), // realisees
    ];
    const groups = groupInterventions(rows, TODAY);
    expect(groups.map((g) => g.bucket)).toEqual(["aujourdhui", "plus_tard", "realisees"]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("trie chaque groupe avec sortInterventions (le plus urgent d'abord)", () => {
    const rows = [
      row({ id: "late-2", requested_for: "2026-09-01" }),
      row({ id: "late-1", requested_for: "2026-08-20" }),
    ];
    const groups = groupInterventions(rows, TODAY);
    expect(groups[0]!.items.map((r) => r.id)).toEqual(["late-1", "late-2"]);
  });
});

describe("filterByStatus", () => {
  const rows = [row({ id: "a", status: "demandee" }), row({ id: "b", status: "realisee" })];

  it("'a_faire' ne garde que les interventions non réalisées", () => {
    expect(filterByStatus(rows, "a_faire" satisfies MobileFilter).map((r) => r.id)).toEqual(["a"]);
  });

  it("'realisees' ne garde que les interventions réalisées", () => {
    expect(filterByStatus(rows, "realisees").map((r) => r.id)).toEqual(["b"]);
  });
});

describe("counts", () => {
  it("compte les deux catégories", () => {
    const rows = [
      row({ status: "demandee" }), row({ status: "demandee" }), row({ status: "realisee" }),
    ];
    expect(counts(rows)).toEqual({ aFaire: 2, realisees: 1 });
  });
});

describe("requestedByLine", () => {
  const nameOf = (userId: string | null) => (userId === "agent-1" ? "Dominique Simon" : "Système / intégration");

  it("aujourd'hui", () => {
    expect(requestedByLine(row({ requested_for: TODAY }), nameOf, TODAY))
      .toBe("Sollicitée par Dominique Simon pour aujourd'hui");
  });

  it("date future", () => {
    expect(requestedByLine(row({ requested_for: "2026-09-12" }), nameOf, TODAY))
      .toBe("Sollicitée par Dominique Simon pour le 12/09/2026");
  });

  it("date passée : mention 'en retard'", () => {
    expect(requestedByLine(row({ requested_for: "2026-09-08" }), nameOf, TODAY))
      .toBe("Sollicitée par Dominique Simon pour le 08/09/2026 — en retard");
  });
});

describe("isImageFile", () => {
  it("reconnaît une image", () => {
    expect(isImageFile({ type: "image/jpeg" })).toBe(true);
  });

  it("rejette un document", () => {
    expect(isImageFile({ type: "application/pdf" })).toBe(false);
  });
});

describe("photoLabel", () => {
  it("numérote à partir de 1", () => {
    expect(photoLabel(1)).toBe("Photo 1");
    expect(photoLabel(2)).toBe("Photo 2");
  });
});
