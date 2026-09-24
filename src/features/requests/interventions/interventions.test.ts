import { describe, expect, it } from "vitest";
import {
  addFiles, canComplete, defaultCompletion, ERROR_COMPLETED_FUTURE, ERROR_TOO_MANY_FILES, filesCountLabel, MAX_INTERVENTION_FILES, photoFileName,
  ERROR_COMPLETED_REQUIRED, ERROR_DATE_PAST, ERROR_DATE_REQUIRED, ERROR_INTERVENANT_REQUIRED,
  formatDay, interventionStatusLabel, interventionTone, isLate, isoDay, pendingCount,
  solicitGate, sortInterventions, validateCompletion, validateSollicitation,
  type InterventionRow,
} from "./interventions";

const TODAY = "2026-09-14";

function row(over: Partial<InterventionRow> = {}): InterventionRow {
  return {
    id: over.id ?? "i1",
    request_id: "r1",
    organization_id: "o1",
    intervenant_id: over.intervenant_id ?? "u-inter",
    requested_by: "u-agent",
    requested_at: over.requested_at ?? "2026-09-10T09:00:00Z",
    requested_for: over.requested_for ?? "2026-09-20",
    request_comment: "Vérifier le nid-de-poule",
    status: over.status ?? "demandee",
    completed_at: over.completed_at ?? null,
    completed_on: over.completed_on ?? null,
    completion_comment: over.completion_comment ?? null,
  };
}

describe("isoDay / formatDay", () => {
  it("écrit le jour LOCAL, pas l'UTC", () => {
    // 23 h 30 heure de Paris un 14 septembre : toISOString dirait déjà le 15 en été (UTC+2).
    const d = new Date(2026, 8, 14, 23, 30);
    expect(isoDay(d)).toBe("2026-09-14");
  });

  it("formate AAAA-MM-JJ en JJ/MM/AAAA sans passer par Date", () => {
    expect(formatDay("2026-03-12")).toBe("12/03/2026");
    expect(formatDay("2026-03-12T00:00:00+00:00")).toBe("12/03/2026");
    expect(formatDay(null)).toBe("—");
    expect(formatDay("n'importe quoi")).toBe("n'importe quoi");
  });
});

describe("solicitGate — miroir de la garde serveur", () => {
  it("s'ouvre en instruction avec le droit d'instruction", () => {
    expect(solicitGate("en_instruction", true)).toEqual({ ok: true, reason: null });
  });

  it("se ferme sans le droit, et le dit", () => {
    const g = solicitGate("en_instruction", false);
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/droit d'instruction/);
  });

  it("se ferme hors instruction, et le dit", () => {
    for (const s of ["a_traiter", "en_attente", "resolue_positive", "archivee"]) {
      const g = solicitGate(s, true);
      expect(g.ok).toBe(false);
      expect(g.reason).toMatch(/en cours d'instruction/);
    }
  });
});

describe("validateSollicitation", () => {
  const ok = { intervenantId: "u-inter", requestedFor: "2026-09-20", comment: "Voir sur place" };

  it("accepte un brouillon complet, aujourd'hui compris", () => {
    expect(validateSollicitation(ok, TODAY)).toEqual([]);
    expect(validateSollicitation({ ...ok, requestedFor: TODAY }, TODAY)).toEqual([]);
  });

  it("exige l'intervenant et la date", () => {
    expect(validateSollicitation({ intervenantId: "", requestedFor: "", comment: "Voir" }, TODAY))
      .toEqual([ERROR_INTERVENANT_REQUIRED, ERROR_DATE_REQUIRED]);
  });

  it("n'exige pas « ce qui est attendu » (facultatif depuis le 2026-09-24)", () => {
    expect(validateSollicitation({ ...ok, comment: "  " }, TODAY)).toEqual([]);
  });

  it("refuse une date passée", () => {
    expect(validateSollicitation({ ...ok, requestedFor: "2026-09-13" }, TODAY)).toEqual([ERROR_DATE_PAST]);
  });
});

describe("validateCompletion / defaultCompletion", () => {
  it("propose le jour courant", () => {
    expect(defaultCompletion(TODAY)).toEqual({ completedOn: TODAY, comment: "", files: [] });
    expect(validateCompletion(defaultCompletion(TODAY), TODAY)).toEqual([]);
  });

  it("accepte une date passée (déclaration après coup), refuse le futur", () => {
    expect(validateCompletion({ completedOn: "2026-09-01", comment: "", files: [] }, TODAY)).toEqual([]);
    expect(validateCompletion({ completedOn: "2026-09-15", comment: "", files: [] }, TODAY)).toEqual([ERROR_COMPLETED_FUTURE]);
    expect(validateCompletion({ completedOn: "", comment: "", files: [] }, TODAY)).toEqual([ERROR_COMPLETED_REQUIRED]);
  });

  it("le commentaire est facultatif", () => {
    expect(validateCompletion({ completedOn: TODAY, comment: "", files: [] }, TODAY)).toEqual([]);
  });
});

describe("présentation", () => {
  it("nomme les deux états, et laisse passer l'inconnu", () => {
    expect(interventionStatusLabel("demandee")).toBe("À réaliser");
    expect(interventionStatusLabel("realisee")).toBe("Réalisée");
    expect(interventionStatusLabel("etat_du_futur")).toBe("etat_du_futur");
  });

  it("colore : réalisée = ok, à venir = en attente, jour souhaité passé = retard", () => {
    expect(interventionTone(row({ status: "realisee" }), TODAY)).toBe("ok");
    expect(interventionTone(row({ requested_for: "2026-09-20" }), TODAY)).toBe("pending");
    expect(interventionTone(row({ requested_for: TODAY }), TODAY)).toBe("pending");
    expect(interventionTone(row({ requested_for: "2026-09-13" }), TODAY)).toBe("error");
    expect(isLate(row({ requested_for: "2026-09-13" }), TODAY)).toBe(true);
    // Une réalisée n'est jamais « en retard », même déclarée après la date souhaitée.
    expect(isLate(row({ status: "realisee", requested_for: "2026-09-01" }), TODAY)).toBe(false);
  });

  it("trie : à réaliser d'abord (la plus proche en tête), puis réalisées (la plus récente en tête)", () => {
    const rows = [
      row({ id: "done-old", status: "realisee", completed_at: "2026-09-01T10:00:00Z" }),
      row({ id: "p-late", requested_for: "2026-09-25" }),
      row({ id: "done-new", status: "realisee", completed_at: "2026-09-12T10:00:00Z" }),
      row({ id: "p-soon", requested_for: "2026-09-15" }),
    ];
    expect(sortInterventions(rows).map((r) => r.id)).toEqual(["p-soon", "p-late", "done-new", "done-old"]);
  });

  it("compte les interventions à réaliser", () => {
    expect(pendingCount([row(), row({ status: "realisee" }), row()])).toBe(2);
  });

  it("seul l'intervenant sollicité déclare, et seulement tant que c'est à réaliser", () => {
    expect(canComplete(row(), "u-inter")).toBe(true);
    expect(canComplete(row(), "u-agent")).toBe(false);
    expect(canComplete(row(), null)).toBe(false);
    expect(canComplete(row({ status: "realisee" }), "u-inter")).toBe(false);
  });
});

describe("justificatifs — quatre au plus (jumeau de intervention_max_attachments)", () => {
  const f = (name: string) => new File(["x"], name, { type: "image/jpeg" });

  it("ajoute dans l'ordre reçu et s'arrête au plafond, en comptant ce qui a été refusé", () => {
    const r1 = addFiles([], [f("a"), f("b")]);
    expect(r1.files.map((x) => x.name)).toEqual(["a", "b"]);
    expect(r1.refused).toBe(0);
    const r2 = addFiles(r1.files, [f("c"), f("d"), f("e"), f("f")]);
    expect(r2.files.map((x) => x.name)).toEqual(["a", "b", "c", "d"]);
    expect(r2.refused).toBe(2);
    expect(addFiles(r2.files, [f("g")]).refused).toBe(1);
  });

  it("la validation refuse une sélection au-delà du plafond", () => {
    const files = Array.from({ length: MAX_INTERVENTION_FILES + 1 }, (_, i) => f(`p${i}`));
    expect(validateCompletion({ completedOn: TODAY, comment: "", files }, TODAY)).toEqual([ERROR_TOO_MANY_FILES]);
    expect(validateCompletion({ completedOn: TODAY, comment: "", files: files.slice(0, 4) }, TODAY)).toEqual([]);
  });

  it("compte ce qui reste possible", () => {
    expect(filesCountLabel(0)).toBe("0 fichier sur 4");
    expect(filesCountLabel(3)).toBe("3 fichiers sur 4");
  });

  it("nomme une photo par son horodatage local et son rang", () => {
    expect(photoFileName(new Date(2026, 8, 14, 9, 5, 7), 2)).toBe("photo-2026-09-14-090507-2.jpg");
  });
});
