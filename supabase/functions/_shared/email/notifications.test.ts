import { describe, expect, it } from "vitest";
import {
  notificationEmail, requestLabel, requestPermalink, statusLabel,
  type NotificationEmailInput,
} from "./notifications.ts";
import { renderEmailHtml, renderEmailText } from "./template.ts";

function input(over: Partial<NotificationEmailInput> = {}): NotificationEmailInput {
  return {
    kind: over.kind ?? "assigned",
    payload: over.payload ?? { reference: "DEM-2026-000042", subject: "Nid-de-poule rue des Lilas" },
    // `??` avalerait un null EXPLICITE, que plusieurs cas testent.
    recipientName: "recipientName" in over ? over.recipientName : "Camille Martin",
    tenantName: over.tenantName ?? "ACCM",
    requestUrl: over.requestUrl ?? "https://iris.exemple.fr/demandes/abc-123",
  };
}

describe("requestPermalink", () => {
  it("compose le permalien de la fiche", () => {
    expect(requestPermalink("https://iris.exemple.fr", "abc-123"))
      .toBe("https://iris.exemple.fr/demandes/abc-123");
  });

  it("tolère une base terminée par des barres obliques", () => {
    expect(requestPermalink("https://iris.exemple.fr///", "abc-123"))
      .toBe("https://iris.exemple.fr/demandes/abc-123");
  });
});

describe("statusLabel", () => {
  it("traduit les statuts du workflow", () => {
    expect(statusLabel("a_traiter")).toBe("À traiter");
    expect(statusLabel("en_instruction")).toBe("En cours d'instruction");
  });

  it("laisse passer un statut inconnu plutôt que de casser un envoi", () => {
    expect(statusLabel("statut_du_futur")).toBe("statut_du_futur");
    expect(statusLabel(null)).toBe("—");
    expect(statusLabel(42)).toBe("—");
  });
});

describe("requestLabel", () => {
  it("joint référence et objet", () => {
    expect(requestLabel({ reference: "DEM-2026-000042", subject: "Nid-de-poule" }))
      .toBe("DEM-2026-000042 — Nid-de-poule");
  });

  it("se rabat sur ce qui reste", () => {
    expect(requestLabel({ reference: "DEM-2026-000042" })).toBe("DEM-2026-000042");
    expect(requestLabel({})).toBe("une demande");
  });
});

describe("notificationEmail — objet du message", () => {
  it("préfixe la référence pour le tri en boîte de réception", () => {
    expect(notificationEmail(input()).subject)
      .toBe("DEM-2026-000042 — Une demande vous a été affectée — Iris · ACCM");
  });

  it("se passe de la référence quand elle manque", () => {
    const mail = notificationEmail(input({ payload: { subject: "Objet seul" } }));
    expect(mail.subject).toBe("Une demande vous a été affectée — Iris · ACCM");
  });

  it("porte le statut d'arrivée pour un changement de statut", () => {
    const mail = notificationEmail(input({
      kind: "status_changed",
      payload: { reference: "DEM-2026-000042", from: "a_traiter", to: "en_instruction" },
    }));
    expect(mail.subject).toBe("DEM-2026-000042 — Statut : En cours d'instruction — Iris · ACCM");
  });
});

describe("notificationEmail — corps par motif", () => {
  it("salue le destinataire par son nom, ou sobrement", () => {
    expect(notificationEmail(input()).paragraphs[0]).toBe("Bonjour Camille Martin,");
    expect(notificationEmail(input({ recipientName: null })).paragraphs[0]).toBe("Bonjour,");
    expect(notificationEmail(input({ recipientName: "  " })).paragraphs[0]).toBe("Bonjour,");
  });

  it("affectation : nomme l'auteur et le statut", () => {
    const mail = notificationEmail(input({
      payload: { reference: "DEM-2026-000042", subject: "Nid-de-poule", actor_name: "Alex Dupont", status: "a_traiter" },
    }));
    expect(mail.paragraphs.join(" ")).toContain("Alex Dupont vous a affecté la demande DEM-2026-000042 — Nid-de-poule.");
    expect(mail.paragraphs.join(" ")).toContain("« À traiter »");
  });

  it("retrait : distingue le passage de main du retrait sec", () => {
    const passe = notificationEmail(input({ kind: "unassigned", payload: { reference: "R1", reassigned: true } }));
    expect(passe.paragraphs.join(" ")).toContain("à quelqu'un d'autre");
    const sec = notificationEmail(input({ kind: "unassigned", payload: { reference: "R1", reassigned: false } }));
    expect(sec.paragraphs.join(" ")).toContain("n'a plus d'agent affecté");
  });

  it("changement de statut : les deux bornes, et le motif s'il existe", () => {
    const sans = notificationEmail(input({
      kind: "status_changed", payload: { reference: "R1", from: "a_traiter", to: "annulee" },
    }));
    expect(sans.paragraphs.join(" ")).toContain("de « À traiter » à « Annulée »");
    expect(sans.paragraphs.join(" ")).not.toContain("Motif enregistré");

    const avec = notificationEmail(input({
      kind: "status_changed", payload: { reference: "R1", from: "a_traiter", to: "annulee", motif: "abandon" },
    }));
    expect(avec.paragraphs.join(" ")).toContain("Motif enregistré : abandon.");
  });

  it("note interne : annonce la note et dit explicitement que le contenu reste dans Iris", () => {
    const mail = notificationEmail(input({
      kind: "note_added", payload: { reference: "R1", actor_name: "Dominique" },
    }));
    const corps = mail.paragraphs.join(" ");
    expect(corps).toContain("Dominique a ajouté une note interne");
    expect(corps).toContain("n'est consultable que dans Iris");
  });

  it("mention : nomme l'auteur et renvoie à Iris pour le contenu", () => {
    const mail = notificationEmail(input({
      kind: "mentioned", payload: { reference: "R1", subject: "Nid-de-poule", actor_name: "Alex Dupont" },
    }));
    expect(mail.subject).toBe("R1 — Vous êtes mentionné dans une note — Iris · ACCM");
    const corps = mail.paragraphs.join(" ");
    expect(corps).toContain("Alex Dupont vous a mentionné dans une note interne sur la demande R1 — Nid-de-poule.");
    expect(corps).toContain("n'est consultable que dans Iris");
  });

  it("nouvelle demande : démarche, destinataire et statut d'arrivée", () => {
    const mail = notificationEmail(input({
      kind: "new_request_in_scope",
      payload: {
        reference: "R1", subject: "Nid-de-poule", status: "a_traiter",
        procedure: "Signalement nid-de-poule", destinataire: "Voirie",
      },
    }));
    const corps = mail.paragraphs.join(" ");
    expect(corps).toContain("Démarche : Signalement nid-de-poule — Voirie.");
    expect(corps).toContain("pas encore d'agent affecté");
  });

  it("attribue à l'intégration un geste sans auteur, au système sinon", () => {
    expect(notificationEmail(input({ payload: { reference: "R1", source: "clara" } }))
      .paragraphs.join(" ")).toContain("L'intégration clara");
    expect(notificationEmail(input({ payload: { reference: "R1", source: "iris" } }))
      .paragraphs.join(" ")).toContain("Le système");
    expect(notificationEmail(input({ payload: { reference: "R1" } }))
      .paragraphs.join(" ")).toContain("Le système");
  });

  it("reste envoyable devant un motif inconnu", () => {
    const mail = notificationEmail(input({ kind: "motif_du_futur", payload: { reference: "R1" } }));
    expect(mail.heading).toBe("Une demande a évolué");
    expect(mail.cta?.url).toBe("https://iris.exemple.fr/demandes/abc-123");
  });
});

describe("notificationEmail — permalien et rendu", () => {
  it("porte le permalien en bouton d'action", () => {
    const mail = notificationEmail(input());
    expect(mail.cta).toEqual({ label: "Ouvrir la demande", url: "https://iris.exemple.fr/demandes/abc-123" });
  });

  it("le permalien apparaît dans le HTML comme dans le texte brut (repli)", () => {
    const mail = notificationEmail(input());
    const brand = { productName: "Iris", tenantName: "ACCM" };
    const html = renderEmailHtml(mail, brand);
    const txt = renderEmailText(mail, brand);
    expect(html).toContain("https://iris.exemple.fr/demandes/abc-123");
    expect(txt).toContain("Ouvrir la demande : https://iris.exemple.fr/demandes/abc-123");
  });

  it("un permalien non http retombe sur « # » dans le href (garde du gabarit)", () => {
    const mail = notificationEmail(input({ requestUrl: "javascript:alert(1)" }));
    const html = renderEmailHtml(mail, { productName: "Iris", tenantName: null });
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain('href="#"');
  });

  it("échappe l'objet de la demande dans le HTML", () => {
    const mail = notificationEmail(input({
      payload: { reference: "R1", subject: "<script>alert(1)</script>" },
    }));
    const html = renderEmailHtml(mail, { productName: "Iris", tenantName: null });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("explique pourquoi le message a été reçu", () => {
    expect(notificationEmail(input()).footnote).toContain("préférences de notification");
  });
});
