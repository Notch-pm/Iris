import { describe, expect, it } from "vitest";
import { emptyRights, type MyRights, type RightsProfile } from "@/features/rights/rights";
import {
  activeFilterCount, AGENT_FACET, BOARD_COLUMNS, boardCard, boardCards, boardContent,
  boardRightsResolver, closedSince, dropTargets, EMPTY_BOARD_FILTERS, facetsOf, filterCards,
  isMineOnly, NO_AGENT, NO_PROCEDURE, PROCEDURE_FACET, refusalHint, toggleMine, toggleValue,
  transitionToast, type BoardRow,
} from "./tableau";

const SCOPE = "org-socle-1";

function row(over: Partial<BoardRow> = {}): BoardRow {
  return {
    id: "r1",
    reference: "DEM-2026-000001",
    subject: "Nid-de-poule rue des Lilas",
    status: "a_traiter",
    priority: "normale",
    socle_procedure_id: "proc-1",
    socle_procedure_label: "Signalement voirie",
    socle_organization_id: "org-1",
    socle_organization_label: "Voirie",
    socle_scope_org_id: SCOPE,
    assigned_to: null,
    received_at: "2026-08-21T09:00:00Z",
    updated_at: "2026-08-21T09:00:00Z",
    identity_status: "rapprochee",
    requester_snapshot: { declared: { first_name: "Marie", last_name: "Durand" } },
    ...over,
  };
}

describe("BOARD_COLUMNS — une colonne par statut, jamais un regroupement", () => {
  it("couvre les 7 statuts du workflow, dans l'ordre du cycle de vie", () => {
    expect(BOARD_COLUMNS.map((c) => c.status)).toEqual([
      "a_traiter", "en_instruction", "en_attente",
      "resolue_positive", "resolue_negative", "annulee", "archivee",
    ]);
  });

  it("ne borne à une fenêtre récente que les statuts finaux", () => {
    const recent = BOARD_COLUMNS.filter((c) => c.recent).map((c) => c.status);
    expect(recent).toEqual(["resolue_positive", "resolue_negative", "annulee", "archivee"]);
  });
});

describe("closedSince", () => {
  it("rend le début de journée d'il y a N jours — stable sur toute la journée", () => {
    const matin = closedSince(new Date(2026, 7, 28, 6, 12), 30);
    const soir = closedSince(new Date(2026, 7, 28, 23, 59), 30);
    expect(matin).toBe(soir);
    expect(new Date(matin).getTime()).toBe(new Date(2026, 6, 29).getTime());
  });
});

describe("boardCard", () => {
  it("porte l'identité FIGÉE AU DÉPÔT, la démarche et le destinataire", () => {
    const card = boardCard(row(), null);
    expect(card.usager).toBe("Marie Durand");
    expect(card.usagerInitials).toBe("MD");
    expect(card.procedureLabel).toBe("Signalement voirie");
    expect(card.destinataireLabel).toBe("Voirie");
    expect(card.deposited).toBe("21 août 2026");
    expect(card.priority.label).toBe("Normale");
  });

  it("replie une demande non affectée sur la facette « Non affectée »", () => {
    const card = boardCard(row(), null);
    expect(card.agentId).toBe(NO_AGENT);
    expect(card.agentLabel).toBe("Non affectée");
    expect(card.agentInitials).toBe("?");
    expect(card.assignedTo).toBeNull();
  });

  it("nomme l'agent assigné et en tire ses initiales", () => {
    const card = boardCard(row({ assigned_to: "u1" }), "Claire Lemoine");
    expect(card.agentId).toBe("u1");
    expect(card.agentLabel).toBe("Claire Lemoine");
    expect(card.agentInitials).toBe("CL");
  });

  it("replie une demande historique sans démarche ni destinataire", () => {
    const card = boardCard(
      row({ socle_procedure_id: null, socle_procedure_label: null, socle_organization_id: null, socle_organization_label: null }),
      null,
    );
    expect(card.procedureId).toBe(NO_PROCEDURE);
    expect(card.procedureLabel).toBe("Sans démarche");
    expect(card.destinataireLabel).toBe("Sans destinataire");
  });

  it("indexe la recherche sans accents et en minuscules", () => {
    const card = boardCard(row({ subject: "Éclairage défectueux" }), null);
    expect(card.search).toContain("eclairage defectueux");
    expect(card.search).toContain("dem-2026-000001");
  });
});

describe("filtres", () => {
  const cards = boardCards(
    [
      row({ id: "a", reference: "DEM-1", assigned_to: "u1", priority: "haute" }),
      row({ id: "b", reference: "DEM-2", subject: "Acte de naissance", socle_procedure_id: "proc-2", socle_procedure_label: "État civil" }),
      row({ id: "c", reference: "DEM-3", assigned_to: "u1", socle_organization_id: "org-2", socle_organization_label: "État civil — annexe" }),
    ],
    () => "Claire Lemoine",
  );

  it("croise agent, démarche, destinataire et urgence", () => {
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, agents: ["u1"] }).map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, agents: [NO_AGENT] }).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, procedures: ["proc-2"] }).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, destinataires: ["org-2"] }).map((c) => c.id)).toEqual(["c"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, priorities: ["haute"] }).map((c) => c.id)).toEqual(["a"]);
    expect(
      filterCards(cards, { ...EMPTY_BOARD_FILTERS, agents: ["u1"], priorities: ["haute"] }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("cherche sans tenir compte des accents ni de la casse, sur tout ce que porte la carte", () => {
    // « b » par sa démarche, « c » par son destinataire : la recherche couvre
    // référence, objet, démarche, destinataire, usager et agent.
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, query: "ETAT civil" }).map((c) => c.id)).toEqual(["b", "c"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, query: "acte de naissance" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterCards(cards, { ...EMPTY_BOARD_FILTERS, query: "  " }).length).toBe(3);
  });

  it("compte les critères posés, recherche comprise", () => {
    expect(activeFilterCount(EMPTY_BOARD_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_BOARD_FILTERS, query: "  " })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_BOARD_FILTERS, query: "x", agents: ["u1", "u2"] })).toBe(3);
  });

  it("bascule une valeur dans une sélection multiple", () => {
    expect(toggleValue([], "a")).toEqual(["a"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("« Mes demandes » — le filtre agent posé sur moi seul", () => {
  const moi = "u1";

  it("ne s'allume que si la sélection d'agents est EXACTEMENT l'utilisateur courant", () => {
    expect(isMineOnly(EMPTY_BOARD_FILTERS, moi)).toBe(false);
    expect(isMineOnly({ ...EMPTY_BOARD_FILTERS, agents: [moi] }, moi)).toBe(true);
    expect(isMineOnly({ ...EMPTY_BOARD_FILTERS, agents: ["u2"] }, moi)).toBe(false);
    // Un autre agent coché en plus : ce ne sont plus « mes demandes ».
    expect(isMineOnly({ ...EMPTY_BOARD_FILTERS, agents: [moi, "u2"] }, moi)).toBe(false);
  });

  it("remplace la sélection d'agents, puis la vide au second clic", () => {
    const on = toggleMine(EMPTY_BOARD_FILTERS, moi);
    expect(on.agents).toEqual([moi]);
    expect(toggleMine(on, moi).agents).toEqual([]);
    // Depuis une autre sélection, le raccourci prend la main plutôt que de s'y ajouter.
    expect(toggleMine({ ...EMPTY_BOARD_FILTERS, agents: ["u2", NO_AGENT] }, moi).agents).toEqual([moi]);
  });

  it("laisse les autres critères intacts", () => {
    const before = { ...EMPTY_BOARD_FILTERS, query: "voirie", priorities: ["haute"] };
    const after = toggleMine(before, moi);
    expect(after.query).toBe("voirie");
    expect(after.priorities).toEqual(["haute"]);
  });

  it("ne fait rien sans utilisateur connu (session absente)", () => {
    expect(isMineOnly({ ...EMPTY_BOARD_FILTERS, agents: [""] }, "")).toBe(false);
    expect(toggleMine(EMPTY_BOARD_FILTERS, "")).toBe(EMPTY_BOARD_FILTERS);
  });
});

describe("facetsOf", () => {
  it("compte, trie en français et remonte « Non affectée » en tête", () => {
    const cards = boardCards(
      [
        row({ id: "a", assigned_to: "u2" }),
        row({ id: "b" }),
        row({ id: "c", assigned_to: "u2" }),
      ],
      () => "Zoé Bertin",
    );
    expect(facetsOf(cards, AGENT_FACET)).toEqual([
      { value: NO_AGENT, label: "Non affectée", count: 1 },
      { value: "u2", label: "Zoé Bertin", count: 2 },
    ]);
  });

  it("remonte « Sans démarche » avant les démarches nommées", () => {
    const cards = boardCards(
      [
        row({ id: "a", socle_procedure_id: "p2", socle_procedure_label: "Acte de naissance" }),
        row({ id: "b", socle_procedure_id: null, socle_procedure_label: null }),
      ],
      () => "",
    );
    expect(facetsOf(cards, PROCEDURE_FACET).map((f) => f.value)).toEqual([NO_PROCEDURE, "p2"]);
  });
});

describe("boardContent", () => {
  const cards = boardCards(
    [
      row({ id: "vieille", received_at: "2026-08-01T09:00:00Z" }),
      row({ id: "recente", received_at: "2026-08-25T09:00:00Z" }),
      row({ id: "instruction", status: "en_instruction" }),
    ],
    () => "",
  );

  it("répartit sur les 7 colonnes, même vides", () => {
    const content = boardContent(cards, "recent");
    expect(content.columns).toHaveLength(7);
    expect(content.columns[0]!.cards.map((c) => c.id)).toEqual(["recente", "vieille"]);
    expect(content.columns[1]!.cards.map((c) => c.id)).toEqual(["instruction"]);
    expect(content.columns[6]!.cards).toEqual([]);
  });

  it("trie du plus ancien au plus récent sur demande", () => {
    const content = boardContent(cards, "ancien");
    expect(content.columns[0]!.cards.map((c) => c.id)).toEqual(["vieille", "recente"]);
  });

  it("ne fait pas disparaître une demande au statut inconnu : elle est signalée", () => {
    const content = boardContent(boardCards([row({ id: "x", status: "en_orbite" })], () => ""), "recent");
    expect(content.orphans.map((c) => c.id)).toEqual(["x"]);
    expect(content.columns.every((c) => c.cards.length === 0)).toBe(true);
  });
});

// ---- Droits et cibles de dépôt ----------------------------------------------

function profile(over: Partial<RightsProfile> = {}): RightsProfile {
  return {
    id: "p1",
    name: "Instructeur voirie",
    status: "active",
    is_admin: false,
    scope_organization_ids: [SCOPE],
    procedures: {},
    default: ["instruction"],
    ...over,
  };
}

function myRights(profiles: RightsProfile[]): MyRights {
  return { ...emptyRights("tenant-1"), profiles };
}

describe("boardRightsResolver / dropTargets — miroir de requests_guard_write", () => {
  it("n'ouvre au droit d'instruction que les allers-retours d'instruction", () => {
    const resolve = boardRightsResolver(myRights([profile()]));
    const card = boardCard(row(), null);
    expect([...dropTargets(card, resolve(card)).keys()]).toEqual(["en_instruction"]);

    const enCours = boardCard(row({ status: "en_instruction" }), null);
    expect([...dropTargets(enCours, resolve(enCours)).keys()].sort()).toEqual(["a_traiter", "en_attente"]);
  });

  it("ouvre les résolutions au droit de clôture, sans l'administration", () => {
    const resolve = boardRightsResolver(myRights([profile({ default: ["instruction", "cloture"] })]));
    const enCours = boardCard(row({ status: "en_instruction" }), null);
    expect([...dropTargets(enCours, resolve(enCours)).keys()].sort()).toEqual([
      "a_traiter", "annulee", "en_attente", "resolue_negative", "resolue_positive",
    ]);
    // Réouverture et archivage exigent EN PLUS l'administration sur l'organisation.
    const close = boardCard(row({ status: "resolue_positive" }), null);
    expect([...dropTargets(close, resolve(close)).keys()]).toEqual([]);
  });

  it("ouvre la réouverture et l'archivage à l'administrateur porteur du droit de clôture", () => {
    const resolve = boardRightsResolver(
      myRights([profile({ is_admin: true, default: ["instruction", "cloture"] })]),
    );
    const close = boardCard(row({ status: "resolue_positive" }), null);
    expect([...dropTargets(close, resolve(close)).keys()].sort()).toEqual(["archivee", "en_instruction"]);
  });

  it("ne laisse bouger aucune carte sans droit d'écriture (fail closed)", () => {
    const resolve = boardRightsResolver(myRights([profile({ default: ["consultation"] })]));
    for (const status of ["a_traiter", "en_instruction", "en_attente", "archivee"] as const) {
      const card = boardCard(row({ status }), null);
      expect(dropTargets(card, resolve(card)).size).toBe(0);
    }
  });

  it("résout le couple par organisation porteuse ET démarche", () => {
    const resolve = boardRightsResolver(
      myRights([profile({ procedures: { "proc-1": [], "proc-2": ["instruction"] }, default: [] })]),
    );
    const bloquee = boardCard(row(), null);
    const ouverte = boardCard(row({ socle_procedure_id: "proc-2", socle_procedure_label: "Autre" }), null);
    expect(dropTargets(bloquee, resolve(bloquee)).size).toBe(0);
    expect([...dropTargets(ouverte, resolve(ouverte)).keys()]).toEqual(["en_instruction"]);
  });

  it("rend le même verdict à la deuxième carte du même couple (mémoïsation)", () => {
    const resolve = boardRightsResolver(myRights([profile()]));
    const first = resolve(boardCard(row({ id: "a" }), null));
    const second = resolve(boardCard(row({ id: "b" }), null));
    expect(second).toBe(first);
  });
});

describe("messages", () => {
  it("explique un refus de dépôt sans jargon de statut", () => {
    const card = boardCard(row(), null);
    expect(refusalHint(card, "a_traiter")).toBe("La demande est déjà dans cette colonne.");
    expect(refusalHint(card, "archivee")).toBe(
      "« À traiter » → « Archivée » n'est pas une transition ouverte ici.",
    );
  });

  it("annonce la transition appliquée par la référence de la demande", () => {
    expect(transitionToast(boardCard(row(), null), "en_instruction")).toBe(
      "DEM-2026-000001 → En cours d'instruction",
    );
  });
});
