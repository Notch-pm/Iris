import { describe, expect, it } from "vitest";
import {
  formatPublicationDate,
  isoDay,
  isPublishedOn,
  parseProcedureStatus,
  parsePublication,
  portalAbsenceLabel,
  publicationPeriodLabel,
} from "./publication";

describe("parseProcedureStatus", () => {
  it("ne retient `production` que sur la valeur exacte", () => {
    expect(parseProcedureStatus("production")).toBe("production");
    expect(parseProcedureStatus("brouillon")).toBe("brouillon");
  });

  // *Fail closed* : un statut inconnu, absent ou d'un type inattendu ne doit
  // jamais ouvrir la démarche à la création.
  it("tout le reste est un brouillon", () => {
    for (const raw of [null, undefined, "", "Production", "archive", 1, {}]) {
      expect(parseProcedureStatus(raw)).toBe("brouillon");
    }
  });
});

describe("parsePublication", () => {
  it("lit le bloc `visibility` complet", () => {
    expect(parsePublication({
      visibility: {
        portalVisible: true,
        publicationPeriodEnabled: true,
        publicationStart: "2027-01-01",
        publicationEnd: "2027-05-03",
      },
    })).toEqual({
      portalVisible: true,
      publicationStart: "2027-01-01",
      publicationEnd: "2027-05-03",
    });
  });

  // Règle du contrat Socle : jamais paramétrée = valeurs par défaut, et la
  // valeur par défaut du portail est VISIBLE. L'inverse ferait disparaître du
  // portail toutes les démarches qu'on n'a pas encore touchées.
  it("`communication_config` absent vaut « portail, sans période »", () => {
    for (const raw of [null, undefined, {}, { visibility: null }, "n'importe quoi"]) {
      expect(parsePublication(raw)).toEqual({
        portalVisible: true,
        publicationStart: null,
        publicationEnd: null,
      });
    }
  });

  it("seul `portalVisible: false` retire du portail", () => {
    expect(parsePublication({ visibility: { portalVisible: false } }).portalVisible).toBe(false);
    expect(parsePublication({ visibility: { } }).portalVisible).toBe(true);
  });

  // Le Socle CONSERVE les dates quand le commutateur est éteint : les afficher
  // dirait à l'agent qu'une période s'applique alors que non.
  it("période désactivée : les dates conservées ne s'appliquent pas", () => {
    expect(parsePublication({
      visibility: {
        portalVisible: true,
        publicationPeriodEnabled: false,
        publicationStart: "2027-01-01",
        publicationEnd: "2027-05-03",
      },
    })).toEqual({ portalVisible: true, publicationStart: null, publicationEnd: null });
  });

  it("les deux bornes sont indépendantes et facultatives", () => {
    const debutSeul = parsePublication({
      visibility: { publicationPeriodEnabled: true, publicationStart: "2027-01-01", publicationEnd: null },
    });
    expect(debutSeul).toEqual({
      portalVisible: true, publicationStart: "2027-01-01", publicationEnd: null,
    });
    const finSeule = parsePublication({
      visibility: { publicationPeriodEnabled: true, publicationEnd: "2027-05-03" },
    });
    expect(finSeule.publicationStart).toBeNull();
    expect(finSeule.publicationEnd).toBe("2027-05-03");
  });

  it("refuse une date qui n'est pas au format AAAA-MM-JJ", () => {
    const p = parsePublication({
      visibility: { publicationPeriodEnabled: true, publicationStart: "03/05/2027", publicationEnd: 20270503 },
    });
    expect(p.publicationStart).toBeNull();
    expect(p.publicationEnd).toBeNull();
  });
});

describe("libellés", () => {
  // Formatage purement textuel : `new Date("2027-01-01")` vaut minuit UTC et
  // reculerait d'un jour dans un fuseau négatif.
  it("formate la date sans passer par un fuseau", () => {
    expect(formatPublicationDate("2027-01-01")).toBe("01/01/2027");
  });

  // Seule l'ABSENCE du portail se dit : y être est la valeur par défaut du
  // contrat, donc le cas ordinaire, et l'écrire partout noierait l'exception.
  it("ne signale que l'absence du portail", () => {
    expect(portalAbsenceLabel({ portalVisible: true, publicationStart: null, publicationEnd: null }))
      .toBeNull();
    expect(portalAbsenceLabel({ portalVisible: false, publicationStart: null, publicationEnd: null }))
      .toBe("Non visible portail");
  });

  it("n'annonce une période que s'il y en a une", () => {
    expect(publicationPeriodLabel({ portalVisible: true, publicationStart: null, publicationEnd: null }))
      .toBeNull();
    expect(publicationPeriodLabel({ portalVisible: true, publicationStart: "2027-01-01", publicationEnd: "2027-05-03" }))
      .toBe("Publiée du 01/01/2027 au 03/05/2027");
    expect(publicationPeriodLabel({ portalVisible: true, publicationStart: "2027-01-01", publicationEnd: null }))
      .toBe("Publiée à partir du 01/01/2027");
    expect(publicationPeriodLabel({ portalVisible: true, publicationStart: null, publicationEnd: "2027-05-03" }))
      .toBe("Publiée jusqu'au 03/05/2027");
  });
});

describe("isPublishedOn", () => {
  const sansPeriode = { portalVisible: true, publicationStart: null, publicationEnd: null };
  const periode = {
    portalVisible: true,
    publicationStart: "2027-01-01",
    publicationEnd: "2027-05-03",
  };

  // Le cas ordinaire, et le défaut du contrat : rien ne borne, donc toujours.
  it("sans période, la démarche est publiée tous les jours", () => {
    expect(isPublishedOn(sansPeriode, "2020-01-01")).toBe(true);
    expect(isPublishedOn(sansPeriode, "2099-12-31")).toBe(true);
  });

  // Les deux bornes sont INCLUSES : le premier et le dernier jour comptent.
  it("les bornes sont incluses", () => {
    expect(isPublishedOn(periode, "2027-01-01")).toBe(true);
    expect(isPublishedOn(periode, "2027-05-03")).toBe(true);
  });

  it("hors période : la veille du début, le lendemain de la fin", () => {
    expect(isPublishedOn(periode, "2026-12-31")).toBe(false);
    expect(isPublishedOn(periode, "2027-05-04")).toBe(false);
  });

  it("une borne absente ne borne rien", () => {
    const depuis = { portalVisible: true, publicationStart: "2027-01-01", publicationEnd: null };
    expect(isPublishedOn(depuis, "2026-12-31")).toBe(false);
    expect(isPublishedOn(depuis, "2099-12-31")).toBe(true);
    const jusqua = { portalVisible: true, publicationStart: null, publicationEnd: "2027-05-03" };
    expect(isPublishedOn(jusqua, "2020-01-01")).toBe(true);
    expect(isPublishedOn(jusqua, "2027-05-04")).toBe(false);
  });

  // La comparaison est textuelle : sur AAAA-MM-JJ, l'ordre lexicographique EST
  // l'ordre chronologique — y compris au passage d'année et de mois.
  it("compare bien au changement d'année et de mois", () => {
    const janvier = { portalVisible: true, publicationStart: "2027-01-31", publicationEnd: "2027-02-01" };
    expect(isPublishedOn(janvier, "2027-01-30")).toBe(false);
    expect(isPublishedOn(janvier, "2027-02-01")).toBe(true);
    expect(isPublishedOn(janvier, "2027-02-02")).toBe(false);
  });
});

describe("isoDay", () => {
  it("rend le jour civil du calendrier local, sur deux chiffres", () => {
    expect(isoDay(new Date(2027, 0, 5))).toBe("2027-01-05");
    expect(isoDay(new Date(2027, 11, 31))).toBe("2027-12-31");
  });

  // Le serveur tourne en UTC : à 23 h 30 UTC, il est déjà DEMAIN à Paris. Sans
  // le fuseau, une période qui s'ouvre demain resterait fermée une demi-heure
  // de trop — et une qui se ferme aujourd'hui le resterait de même.
  it("suit le fuseau demandé, pas celui du runtime", () => {
    const veille = new Date("2027-06-30T23:30:00Z");
    expect(isoDay(veille, "Europe/Paris")).toBe("2027-07-01");
    expect(isoDay(veille, "UTC")).toBe("2027-06-30");
  });
});
