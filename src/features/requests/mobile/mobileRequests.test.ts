import { describe, expect, it } from "vitest";
import {
  dueTodayCount,
  deadlineBanner,
  defaultEmailSubject,
  FILTER_LABELS,
  isDueToday,
  matchesQuery,
  mobileCounts,
  parseFilter,
  relativeTime,
  requesterLine,
  stageDots,
  transitionHint,
} from "./mobileRequests";
import type { StageView } from "../instruction/instruction";

describe("parseFilter", () => {
  it("retombe sur « affectees » par défaut", () => {
    expect(parseFilter(null)).toBe("affectees");
    expect(parseFilter(undefined)).toBe("affectees");
    expect(parseFilter("")).toBe("affectees");
    expect(parseFilter("inconnu")).toBe("affectees");
  });

  it("reconnaît les trois statuts filtrables", () => {
    expect(parseFilter("a_traiter")).toBe("a_traiter");
    expect(parseFilter("en_instruction")).toBe("en_instruction");
    expect(parseFilter("en_attente")).toBe("en_attente");
  });

  it("porte les quatre libellés attendus", () => {
    expect(FILTER_LABELS.affectees).toBe("Affectées");
    expect(FILTER_LABELS.a_traiter).toBe("À traiter");
    expect(FILTER_LABELS.en_instruction).toBe("En instruction");
    expect(FILTER_LABELS.en_attente).toBe("En attente");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-10T14:00:00");

  it("dit « à l'instant » sous la minute", () => {
    expect(relativeTime(new Date("2026-09-10T13:59:30").toISOString(), now)).toBe("à l'instant");
  });

  it("compte les minutes sous l'heure", () => {
    expect(relativeTime(new Date("2026-09-10T13:48:00").toISOString(), now)).toBe("il y a 12 min");
  });

  it("compte les heures sous 24 h", () => {
    expect(relativeTime(new Date("2026-09-10T12:00:00").toISOString(), now)).toBe("il y a 2 h");
  });

  it("dit « hier » pour la veille calendaire", () => {
    expect(relativeTime(new Date("2026-09-09T20:00:00").toISOString(), now)).toBe("hier");
  });

  it("compte les jours entre 2 et 6", () => {
    expect(relativeTime(new Date("2026-09-07T09:00:00").toISOString(), now)).toBe("il y a 3 j");
  });

  it("retombe sur une date compacte au-delà d'une semaine", () => {
    expect(relativeTime(new Date("2026-08-01T09:00:00").toISOString(), now)).toBe("01/08/2026");
  });

  it("rend une chaîne vide pour une date illisible", () => {
    expect(relativeTime("pas une date", now)).toBe("");
  });
});

describe("isDueToday / dueTodayCount / deadlineBanner", () => {
  const today = "2026-09-10";

  it("reconnaît une échéance du jour même avec une heure", () => {
    expect(isDueToday("2026-09-10T08:00:00", today)).toBe(true);
  });

  it("refuse une échéance d'un autre jour", () => {
    expect(isDueToday("2026-09-11T08:00:00", today)).toBe(false);
  });

  it("refuse l'absence d'échéance", () => {
    expect(isDueToday(null, today)).toBe(false);
  });

  it("compte les demandes du jour dans une liste", () => {
    const items = [
      { due_at: "2026-09-10T08:00:00" },
      { due_at: "2026-09-11T08:00:00" },
      { due_at: null },
      { due_at: "2026-09-10T20:00:00" },
    ];
    expect(dueTodayCount(items, today)).toBe(2);
  });

  it("deadlineBanner rend null sans échéance", () => {
    expect(deadlineBanner(0)).toBeNull();
  });

  it("deadlineBanner accorde le singulier", () => {
    expect(deadlineBanner(1)).toBe("1 demande arrive à échéance aujourd'hui");
  });

  it("deadlineBanner accorde le pluriel", () => {
    expect(deadlineBanner(3)).toBe("3 demandes arrivent à échéance aujourd'hui");
  });
});

describe("requesterLine", () => {
  it("compose nom et référence pour une identité connue (ordre de requesterIdentity : prénom puis nom)", () => {
    const snapshot = { declared: { first_name: "Laurent", last_name: "Jacquot" } };
    expect(requesterLine(snapshot, "rapprochee", "DEM-2026-000052")).toBe("Laurent Jacquot · DEM-2026-000052");
  });

  it("omet le nom pour un dépôt anonyme", () => {
    expect(requesterLine({ declared: { anonymous: true } }, "anonyme", "DEM-2026-000009")).toBe("DEM-2026-000009");
  });

  it("omet le nom pour une identité déclarée sans aucun champ connu", () => {
    expect(requesterLine({ declared: {} }, "non_rapprochee", "DEM-2026-000010")).toBe("DEM-2026-000010");
  });
});

describe("matchesQuery", () => {
  const item = {
    reference: "DEM-2026-000052",
    subject: "Acte de mariage",
    socle_procedure_label: "État civil",
    requester_snapshot: { declared: { first_name: "Laurent", last_name: "Jacquot" } },
    identity_status: "rapprochee",
  };

  it("accepte tout avec une requête vide", () => {
    expect(matchesQuery(item, "")).toBe(true);
  });

  it("trouve sur la référence", () => {
    expect(matchesQuery(item, "000052")).toBe(true);
  });

  it("trouve sur l'objet, en ignorant les accents", () => {
    expect(matchesQuery(item, "etat civil")).toBe(true);
  });

  it("trouve sur le nom de l'usager", () => {
    expect(matchesQuery(item, "jacquot")).toBe(true);
  });

  it("refuse ce qui ne correspond à rien", () => {
    expect(matchesQuery(item, "voirie")).toBe(false);
  });
});

describe("stageDots", () => {
  const base: StageView[] = [
    { key: "a_traiter", label: "À traiter", hint: "le 8 sept.", state: "done" },
    { key: "en_instruction", label: "En instruction", hint: "depuis le 10 sept.", state: "current" },
    { key: "en_attente", label: "En attente d'information", hint: "sans mise en attente", state: "skipped" },
    { key: "cloturee", label: "Clôturée", hint: "résolue ou annulée", state: "todo" },
    { key: "archivee", label: "Archivée", hint: "par un administrateur", state: "todo" },
  ];

  it("retire l'étape Archivée quand elle n'est ni en cours ni atteinte", () => {
    const dots = stageDots(base);
    expect(dots).toHaveLength(4);
    expect(dots.some((s) => s.key === "archivee")).toBe(false);
  });

  it("garde l'étape Archivée quand elle est la courante", () => {
    const archived: StageView[] = base.map((s) =>
      s.key === "archivee" ? { ...s, state: "current" } : { ...s, state: "done" },
    );
    const dots = stageDots(archived);
    expect(dots).toHaveLength(5);
    expect(dots.at(-1)?.key).toBe("archivee");
  });
});

describe("transitionHint", () => {
  it("donne une conséquence par statut cible", () => {
    expect(transitionHint("a_traiter")).toBe("remise en file du service");
    expect(transitionHint("en_instruction")).toBe("prise en charge par un agent");
    expect(transitionHint("en_attente")).toBe("pièce ou précision demandée à l'usager");
    expect(transitionHint("resolue_positive")).toContain("l'usager est prévenu");
    expect(transitionHint("resolue_negative")).toContain("l'usager est prévenu");
    expect(transitionHint("annulee")).toBe("sans suite");
    expect(transitionHint("archivee")).toBe("sortie des listes");
  });
});

describe("mobileCounts", () => {
  const rows = [
    { status: "a_traiter", assigned_to: null },
    { status: "en_instruction", assigned_to: "u1" },
    { status: "en_instruction", assigned_to: "u2" },
    { status: "en_attente", assigned_to: "u1" },
  ];

  it("compte l'agent courant sur tous les statuts ouverts", () => {
    expect(mobileCounts(rows, "u1")).toEqual({ affectees: 2, a_traiter: 1, en_instruction: 2, en_attente: 1 });
  });

  it("rend des zéros pour un agent sans aucune affectation ouverte", () => {
    expect(mobileCounts(rows, "u9").affectees).toBe(0);
  });
});

describe("defaultEmailSubject", () => {
  it("préfixe la référence", () => {
    expect(defaultEmailSubject("DEM-2026-000052")).toBe("Votre demande DEM-2026-000052");
  });
});
