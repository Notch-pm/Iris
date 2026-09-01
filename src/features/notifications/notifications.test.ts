import { describe, expect, it } from "vitest";
import {
  badgeLabel, groupKeyFor, groupNotifications, notificationMessage, notificationSubtitle,
  notificationTitle, readPayload, relativeAge, unreadCount,
  type NotificationItem,
} from "./notifications";

const NOW = new Date("2026-08-24T15:00:00Z");

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: over.id ?? "n1",
    kind: over.kind ?? "assigned",
    requestId: over.requestId ?? "r1",
    createdAt: over.createdAt ?? "2026-08-24T14:00:00Z",
    readAt: over.readAt ?? null,
    payload: over.payload ?? {},
  };
}

describe("readPayload", () => {
  it("réduit tout ce qui n'est pas un objet plat à un objet vide", () => {
    expect(readPayload(null)).toEqual({});
    expect(readPayload("texte")).toEqual({});
    expect(readPayload([1, 2])).toEqual({});
    expect(readPayload({ reference: "ACCM-2026-0001" })).toEqual({ reference: "ACCM-2026-0001" });
  });
});

describe("notificationTitle", () => {
  it("nomme les six motifs", () => {
    expect(notificationTitle("assigned")).toBe("Demande affectée");
    expect(notificationTitle("unassigned")).toBe("Affectation retirée");
    expect(notificationTitle("status_changed")).toBe("Changement de statut");
    expect(notificationTitle("note_added")).toBe("Nouvelle note interne");
    expect(notificationTitle("mentioned")).toBe("Vous êtes mentionné");
    expect(notificationTitle("new_request_in_scope")).toBe("Nouvelle demande");
    expect(notificationTitle("transferred_in")).toBe("Demande transférée");
  });

  it("reste affichable devant un motif inconnu (version antérieure)", () => {
    expect(notificationTitle("motif_du_futur")).toBe("Notification");
  });
});

describe("notificationMessage", () => {
  it("nomme l'acteur et traduit le statut d'une affectation", () => {
    expect(notificationMessage("assigned", { actor_name: "Alex Dupont", status: "a_traiter" }))
      .toBe("Alex Dupont vous a affecté cette demande (À traiter).");
  });

  it("distingue le retrait sec du passage de main", () => {
    expect(notificationMessage("unassigned", { actor_name: "Alex", reassigned: false }))
      .toBe("Alex vous a retiré cette demande.");
    expect(notificationMessage("unassigned", { actor_name: "Alex", reassigned: true }))
      .toBe("Alex a confié cette demande à quelqu'un d'autre.");
  });

  it("traduit les deux bornes d'une transition", () => {
    expect(notificationMessage("status_changed", {
      actor_name: "Camille", from: "a_traiter", to: "en_instruction",
    })).toBe("Camille a fait passer la demande de « À traiter » à « En cours d'instruction ».");
  });

  it("annonce la note SANS jamais en montrer le corps", () => {
    const msg = notificationMessage("note_added", { actor_name: "Camille" });
    expect(msg).toBe("Camille a ajouté une note interne.");
  });

  it("annonce une mention sans citer la note", () => {
    expect(notificationMessage("mentioned", { actor_name: "Alex" }))
      .toBe("Alex vous a mentionné dans une note interne.");
  });

  it("décrit une nouvelle demande par sa démarche et son destinataire", () => {
    expect(notificationMessage("new_request_in_scope", {
      procedure: "Signalement nid-de-poule", destinataire: "Voirie",
    })).toBe("Nouvelle demande dans votre périmètre : Signalement nid-de-poule — Voirie.");
  });

  it("se passe des détails absents", () => {
    expect(notificationMessage("new_request_in_scope", {}))
      .toBe("Nouvelle demande dans votre périmètre.");
  });

  it("nomme l'organisme QUITTÉ dans un transfert", () => {
    expect(notificationMessage("transferred_in", {
      actor_name: "Camille", from_destinataire: "Voirie", destinataire: "CCAS",
    })).toBe("Camille vous a transféré cette demande depuis Voirie.");
  });

  it("sait annoncer un transfert dont l'origine est inconnue", () => {
    expect(notificationMessage("transferred_in", { actor_name: "Camille" }))
      .toBe("Camille vous a transféré cette demande.");
  });

  it("attribue au système un geste sans acteur (ingestion)", () => {
    expect(notificationMessage("note_added", { actor_name: null }))
      .toBe("Le système a ajouté une note interne.");
    expect(notificationMessage("note_added", { actor_name: "   " }))
      .toBe("Le système a ajouté une note interne.");
  });

  it("reste lisible devant un motif inconnu", () => {
    expect(notificationMessage("motif_du_futur", {})).toBe("Cette demande a évolué.");
  });
});

describe("notificationSubtitle", () => {
  it("joint référence et objet", () => {
    expect(notificationSubtitle({ reference: "ACCM-2026-0042", subject: "Nid-de-poule" }))
      .toBe("ACCM-2026-0042 · Nid-de-poule");
  });

  it("omet la partie manquante sans laisser de séparateur orphelin", () => {
    expect(notificationSubtitle({ reference: "ACCM-2026-0042" })).toBe("ACCM-2026-0042");
    expect(notificationSubtitle({})).toBe("");
  });
});

describe("unreadCount et badgeLabel", () => {
  it("ne compte que les non lues", () => {
    expect(unreadCount([
      item({ id: "a", readAt: null }),
      item({ id: "b", readAt: "2026-08-24T10:00:00Z" }),
      item({ id: "c", readAt: null }),
    ])).toBe(2);
  });

  it("plafonne la pastille", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(250)).toBe("9+");
  });
});

describe("relativeAge", () => {
  it("passe de la minute au jour puis à la date", () => {
    expect(relativeAge("2026-08-24T14:59:40Z", NOW)).toBe("à l'instant");
    expect(relativeAge("2026-08-24T14:55:00Z", NOW)).toBe("il y a 5 min");
    expect(relativeAge("2026-08-24T12:00:00Z", NOW)).toBe("il y a 3 h");
    expect(relativeAge("2026-08-23T12:00:00Z", NOW)).toBe("hier");
    expect(relativeAge("2026-08-21T12:00:00Z", NOW)).toBe("il y a 3 jours");
    expect(relativeAge("2026-07-01T12:00:00Z", NOW)).toMatch(/01\/07\/2026/);
  });

  it("ne jette pas sur une date illisible", () => {
    expect(relativeAge("pas-une-date", NOW)).toBe("");
  });
});

describe("groupKeyFor", () => {
  it("range par tranche de jour calendaire", () => {
    expect(groupKeyFor("2026-08-24T09:00:00Z", NOW)).toBe("today");
    expect(groupKeyFor("2026-08-23T12:00:00Z", NOW)).toBe("yesterday");
    expect(groupKeyFor("2026-08-20T10:00:00Z", NOW)).toBe("week");
    expect(groupKeyFor("2026-08-01T10:00:00Z", NOW)).toBe("older");
  });
});

describe("groupNotifications", () => {
  it("n'émet que les groupes non vides, du plus récent au plus ancien", () => {
    const groups = groupNotifications([
      item({ id: "a", createdAt: "2026-08-24T09:00:00Z" }),
      item({ id: "b", createdAt: "2026-08-01T09:00:00Z" }),
      item({ id: "c", createdAt: "2026-08-24T08:00:00Z" }),
    ], NOW);
    expect(groups.map((g) => g.key)).toEqual(["today", "older"]);
    expect(groups[0].label).toBe("Aujourd'hui");
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["b"]);
  });

  it("conserve l'ordre reçu à l'intérieur d'un groupe", () => {
    const groups = groupNotifications([
      item({ id: "recent", createdAt: "2026-08-24T14:00:00Z" }),
      item({ id: "ancien", createdAt: "2026-08-24T08:00:00Z" }),
    ], NOW);
    expect(groups[0].items.map((i) => i.id)).toEqual(["recent", "ancien"]);
  });

  it("rend un tableau vide sans notification", () => {
    expect(groupNotifications([], NOW)).toEqual([]);
  });
});
