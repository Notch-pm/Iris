import { describe, expect, it } from "vitest";
import {
  addressKey,
  cardAnchor,
  distinctAddresses,
  EMPTY_MAP_FILTERS,
  filterRequests,
  geocodeBatchPlan,
  isResolved,
  locatableRequests,
  recentResolvedSince,
  resolvedCount,
  locationHint,
  mapCard,
  NO_PROCEDURE,
  priorityCounts,
  procedureFacets,
  spreadByPoint,
  spreadOffset,
  toggleValue,
  type MapRequestRow,
} from "./carte";

const FORM_SCHEMA = {
  version: 1,
  content: [
    {
      id: "sec-lieu",
      kind: "section",
      title: "Lieu d'intervention",
      fields: [
        { id: "f1", key: "intervention_numero", label: "Numéro", type: "text" },
        { id: "f2", key: "intervention_voie", label: "Voie", type: "text" },
        { id: "f3", key: "intervention_code_postal", label: "Code postal", type: "text" },
        { id: "f4", key: "intervention_ville", label: "Ville", type: "text" },
      ],
    },
  ],
};

function row(over: Partial<MapRequestRow> = {}): MapRequestRow {
  return {
    id: "r1",
    reference: "DEM-2026-000001",
    subject: "Nid-de-poule",
    status: "a_traiter",
    priority: "haute",
    socle_procedure_id: "proc-voirie",
    socle_procedure_label: "Demande d'intervention voirie",
    socle_category_label: "Cadre de vie",
    socle_organization_label: "Services techniques",
    assigned_to: null,
    received_at: "2026-08-21T09:00:00Z",
    closed_at: null,
    identity_status: "rapprochee",
    requester_snapshot: { declared: { display_name: "Marie Durand" } },
    form_data: {
      intervention_numero: "6",
      intervention_voie: "Rue de la République",
      intervention_code_postal: "69001",
      intervention_ville: "Lyon",
    },
    form_schema: FORM_SCHEMA,
    ...over,
  };
}

describe("locatableRequests", () => {
  it("sépare les demandes situables de celles sans adresse", () => {
    const { located, withoutAddress } = locatableRequests([
      row(),
      row({ id: "r2", form_schema: null, form_data: { autre: "x" } }),
      row({ id: "r3", form_data: {} }),
    ]);
    expect(located.map((l) => l.row.id)).toEqual(["r1"]);
    expect(withoutAddress).toBe(2);
    expect(located[0]!.lieu.query).toBe("6 Rue de la République, 69001 Lyon");
  });
});

describe("distinctAddresses", () => {
  it("ne géocode qu'une fois une adresse partagée par plusieurs demandes", () => {
    const { located } = locatableRequests([row(), row({ id: "r2" }), row({
      id: "r3",
      form_data: {
        intervention_voie: "Place Bellecour",
        intervention_code_postal: "69002",
        intervention_ville: "Lyon",
      },
    })]);
    const addresses = distinctAddresses(located);
    expect(addresses).toHaveLength(2);
    expect(addresses[0]).toEqual({
      key: addressKey(located[0]!.lieu),
      query: "6 Rue de la République, 69001 Lyon",
      postcode: "69001",
    });
  });
  it("ignore la casse pour dédoublonner", () => {
    const { located } = locatableRequests([
      row(),
      row({ id: "r2", form_data: { ...(row().form_data as object), intervention_ville: "LYON" } }),
    ]);
    expect(distinctAddresses(located)).toHaveLength(1);
  });
});

describe("geocodeBatchPlan", () => {
  const addresses = [
    { key: "b", query: "Place Bellecour, 69002 Lyon", postcode: "69002" },
    { key: "a", query: "6 Rue de la République, 69001 Lyon", postcode: "69001" },
  ];

  it("garde la MÊME clé de requête quand le cache se remplit", () => {
    // Régression 2026-08-23 : une clé indexée sur les seules adresses
    // manquantes change au retour du service, et la réponse arrive sur une clé
    // que plus personne n'observe — la carte reste vide.
    const froid = geocodeBatchPlan(addresses, () => false);
    const tiede = geocodeBatchPlan(addresses, (key) => key === "a");
    const chaud = geocodeBatchPlan(addresses, () => true);
    expect(tiede.signature).toBe(froid.signature);
    expect(chaud.signature).toBe(froid.signature);
  });

  it("ne demande que ce qui manque, et rien quand tout est connu", () => {
    expect(geocodeBatchPlan(addresses, () => false).missing.map((m) => m.key)).toEqual(["b", "a"]);
    expect(geocodeBatchPlan(addresses, (key) => key === "a").missing.map((m) => m.key)).toEqual(["b"]);
    expect(geocodeBatchPlan(addresses, () => true).missing).toEqual([]);
  });

  it("donne la même clé quel que soit l'ordre des adresses", () => {
    expect(geocodeBatchPlan([...addresses].reverse(), () => false).signature).toBe(
      geocodeBatchPlan(addresses, () => false).signature,
    );
  });
});

describe("filterRequests", () => {
  const { located } = locatableRequests([
    row(),
    row({ id: "r2", priority: "urgente", socle_procedure_id: "proc-eclairage", socle_procedure_label: "Éclairage" }),
    row({ id: "r3", priority: "basse", socle_procedure_id: null, socle_procedure_label: null }),
  ]);

  it("ne filtre rien quand aucune valeur n'est retenue", () => {
    expect(filterRequests(located, { showResolved: true, procedures: [], priorities: [] })).toHaveLength(3);
  });
  it("combine démarches (multi) et urgences (multi)", () => {
    expect(
      filterRequests(located, { showResolved: true, procedures: ["proc-voirie", "proc-eclairage"], priorities: [] })
        .map((l) => l.row.id),
    ).toEqual(["r1", "r2"]);
    expect(
      filterRequests(located, { showResolved: true, procedures: [], priorities: ["urgente", "basse"] }).map((l) => l.row.id),
    ).toEqual(["r2", "r3"]);
    expect(
      filterRequests(located, { showResolved: true, procedures: ["proc-voirie"], priorities: ["urgente"] }),
    ).toEqual([]);
  });
  it("range les demandes historiques sans démarche sous une valeur propre", () => {
    expect(filterRequests(located, { showResolved: true, procedures: [NO_PROCEDURE], priorities: [] }).map((l) => l.row.id))
      .toEqual(["r3"]);
  });
});

describe("demandes résolues récemment sur la carte", () => {
  const located = locatableRequests([
    row({ id: "open", status: "en_instruction", priority: "urgente" }),
    row({ id: "done", status: "resolue_positive", priority: "urgente", closed_at: "2026-09-10T10:00:00Z" }),
    row({ id: "refused", status: "resolue_negative", priority: "basse", closed_at: "2026-09-12T10:00:00Z" }),
  ]).located;

  it("les montre par défaut, et les retire quand le commutateur est éteint", () => {
    expect(filterRequests(located, EMPTY_MAP_FILTERS).map((l) => l.row.id)).toEqual(["open", "done", "refused"]);
    expect(filterRequests(located, { ...EMPTY_MAP_FILTERS, showResolved: false }).map((l) => l.row.id))
      .toEqual(["open"]);
  });
  it("les compte pour le commutateur, mais pas dans la légende des urgences", () => {
    expect(resolvedCount(located)).toBe(2);
    expect(priorityCounts(located)).toEqual({ urgente: 1 });
  });
  it("reconnaît une résolue, jamais une annulée", () => {
    expect(isResolved({ status: "resolue_negative" })).toBe(true);
    expect(isResolved({ status: "annulee" })).toBe(false);
    expect(isResolved({ status: "archivee" })).toBe(false);
  });
  it("borne la fenêtre à minuit local, 30 jours en arrière", () => {
    const since = new Date(recentResolvedSince(new Date(2026, 8, 19, 15, 30)));
    expect([since.getFullYear(), since.getMonth(), since.getDate(), since.getHours()]).toEqual([2026, 7, 20, 0]);
  });
});

describe("facettes", () => {
  const { located } = locatableRequests([
    row(),
    row({ id: "r2" }),
    row({ id: "r3", priority: "urgente", socle_procedure_id: "proc-eclairage", socle_procedure_label: "Éclairage" }),
  ]);

  it("compte les démarches situées, dans l'ordre alphabétique FR", () => {
    expect(procedureFacets(located)).toEqual([
      { value: "proc-voirie", label: "Demande d'intervention voirie", count: 2 },
      { value: "proc-eclairage", label: "Éclairage", count: 1 },
    ]);
  });
  it("compte les urgences", () => {
    expect(priorityCounts(located)).toEqual({ haute: 2, urgente: 1 });
  });
});

describe("toggleValue", () => {
  it("ajoute puis retire une valeur", () => {
    expect(toggleValue([], "a")).toEqual(["a"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("spreadOffset", () => {
  it("laisse une épingle seule sur son point", () => {
    expect(spreadOffset(0, 1)).toEqual({ dx: 0, dy: 0 });
    expect(spreadOffset(0, 5)).toEqual({ dx: 0, dy: 0 });
  });
  it("écarte les suivantes autour du point, en anneaux", () => {
    const first = spreadOffset(1, 3);
    expect(Math.hypot(first.dx, first.dy)).toBeCloseTo(13);
    const secondRing = spreadOffset(9, 12);
    expect(Math.hypot(secondRing.dx, secondRing.dy)).toBeCloseTo(26);
  });
  it("groupe par point : deux demandes à la même adresse ne se superposent pas", () => {
    const offsets = spreadByPoint([
      { id: "a", pointKey: "45.7,4.8" },
      { id: "b", pointKey: "45.7,4.8" },
      { id: "c", pointKey: "45.9,4.9" },
    ]);
    expect(offsets.a).toEqual({ dx: 0, dy: 0 });
    expect(offsets.b).not.toEqual({ dx: 0, dy: 0 });
    expect(offsets.c).toEqual({ dx: 0, dy: 0 });
  });
});

describe("cardAnchor", () => {
  const container = { width: 900, height: 500 };
  const card = { width: 320, height: 330 };

  it("ouvre la fiche à droite de l'épingle quand la place le permet", () => {
    const anchor = cardAnchor({ left: 200, top: 250 }, container, card);
    expect(anchor.flipped).toBe(false);
    expect(anchor.left).toBe(216);
    expect(anchor.top).toBe(85);
  });
  it("bascule à gauche près du bord droit", () => {
    const anchor = cardAnchor({ left: 850, top: 250 }, container, card);
    expect(anchor.flipped).toBe(true);
    expect(anchor.left).toBe(514);
  });
  it("maintient la fiche dans le cadre, haut comme bas", () => {
    expect(cardAnchor({ left: 400, top: 10 }, container, card).top).toBe(8);
    expect(cardAnchor({ left: 400, top: 490 }, container, card).top).toBe(162);
    // Conteneur plus court que la fiche : elle reste accrochée en haut.
    expect(cardAnchor({ left: 400, top: 100 }, { width: 900, height: 200 }, card).top).toBe(8);
  });
});

describe("locationHint", () => {
  it("ne dit rien sur un numéro sûrement localisé", () => {
    expect(locationHint({ precision: "adresse", score: 0.96 })).toBeNull();
  });
  it("annonce la maille atteinte quand ce n'est pas le numéro", () => {
    expect(locationHint({ precision: "voie", score: 0.9 })).toMatch(/voie/);
    expect(locationHint({ precision: "commune", score: 0.9 })).toMatch(/commune/);
  });
  it("met en garde sur un score faible — le géocodeur rend toujours un candidat", () => {
    expect(locationHint({ precision: "adresse", score: 0.5 })).toMatch(/approximative/);
    expect(locationHint({ precision: "voie", score: 0.2 })).toMatch(/approximative/);
  });
});

describe("mapCard", () => {
  it("réunit l'essentiel de la demande pour le survol", () => {
    const { located } = locatableRequests([row({ assigned_to: "u1" })]);
    const card = mapCard(located[0]!, "Claire Martin");
    expect(card).toMatchObject({
      reference: "DEM-2026-000001",
      subject: "Nid-de-poule",
      status: "a_traiter",
      priorityKey: "haute",
      usager: "Marie Durand",
      address: ["6 Rue de la République", "69001 Lyon"],
    });
    expect(card.rows).toEqual([
      { label: "Usager", value: "Marie Durand" },
      { label: "Déposée le", value: "21 août 2026" },
      { label: "Urgence", value: "Haute" },
      { label: "Démarche", value: "Demande d'intervention voirie" },
      { label: "Catégorie", value: "Cadre de vie" },
      { label: "Destinataire", value: "Services techniques" },
      { label: "Agent instructeur", value: "Claire Martin" },
    ]);
  });
  it("annonce une demande non affectée et un dépôt anonyme", () => {
    const { located } = locatableRequests([row({ identity_status: "anonyme", requester_snapshot: null })]);
    const card = mapCard(located[0]!, null);
    expect(card.usager).toBe("Dépôt anonyme");
    expect(card.rows.at(-1)).toEqual({ label: "Agent instructeur", value: "Non affectée" });
  });
});

describe("champ `location` — une demande déposée avec un point n'est pas géocodée", () => {
  const SCHEMA_LIEU = {
    version: 1,
    content: [{ id: "f-ou", key: "intervention_lieu", label: "Où ?", type: "location" }],
  };
  const AT = { address: "10 Avenue de Frémeur 44000 Nantes", lat: 47.223, lon: -1.573, precision: "adresse", adjusted: true };

  it("porte le point déclaré, et distinctAddresses l'ignore ; une saisie libre reste à géocoder", () => {
    const { located, withoutAddress } = locatableRequests([
      row({ id: "p1", form_schema: SCHEMA_LIEU, form_data: { intervention_lieu: AT } }),
      row({ id: "p2", form_schema: SCHEMA_LIEU, form_data: { intervention_lieu: { address: "Chemin des Vignes, Nantes" } } }),
      row({ id: "p3", form_schema: SCHEMA_LIEU, form_data: {} }),
    ]);
    expect(withoutAddress).toBe(1);
    expect(located.map((l) => l.row.id)).toEqual(["p1", "p2"]);
    expect(located[0]!.point).toEqual({ lat: 47.223, lon: -1.573, label: AT.address, precision: "adresse", score: 1, adjusted: true });
    expect(located[1]!.point).toBeNull();
    expect(distinctAddresses(located).map((a) => a.query)).toEqual(["Chemin des Vignes, Nantes"]);
  });

  it("locationHint : un point ajusté par l'usager se dit avant toute réserve du géocodeur", () => {
    expect(locationHint({ precision: "voie", score: 1, adjusted: true })).toBe("Point ajusté par l'usager");
    expect(locationHint({ precision: "adresse", score: 1, adjusted: false })).toBeNull();
    expect(locationHint({ precision: "voie", score: 1 })).toBe("Localisée à la voie — numéro non trouvé");
  });
});
