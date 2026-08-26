import { describe, expect, it } from "vitest";
import { authEmailContent, authEmailKind, brandFor } from "./messages";
import { escapeHtml, renderEmailHtml } from "./template";

describe("authEmailKind", () => {
  it("reconnaît les types émis par GoTrue", () => {
    expect(authEmailKind("invite")).toBe("invite");
    expect(authEmailKind("signup")).toBe("signup");
    expect(authEmailKind("magiclink")).toBe("magiclink");
    expect(authEmailKind("reauthentication")).toBe("reauthentication");
    expect(authEmailKind("recovery")).toBe("recovery");
  });

  it("regroupe les deux faces du changement d'adresse", () => {
    expect(authEmailKind("email_change_current")).toBe("email_change");
    expect(authEmailKind("email_change_new")).toBe("email_change");
    expect(authEmailKind("email_change")).toBe("email_change");
  });

  it("retombe sur recovery pour un type inconnu", () => {
    expect(authEmailKind("quelque_chose")).toBe("recovery");
    expect(authEmailKind("")).toBe("recovery");
  });
});

describe("authEmailContent — invitation", () => {
  const c = authEmailContent("invite", {
    tenantName: "Ville de Test",
    recipientName: "Marie Durand",
    actionUrl: "https://iris.test/activer-compte?token_hash=abc",
  });

  it("porte un objet nommant le tenant", () => {
    expect(c.subject).toBe("Activez votre compte — Iris · Ville de Test");
  });

  it("salue le destinataire et annonce la définition du mot de passe", () => {
    expect(c.paragraphs[0]).toBe("Bonjour Marie Durand,");
    expect(c.paragraphs.join(" ")).toContain("définir votre mot de passe");
    expect(c.paragraphs.join(" ")).toContain("Ville de Test");
  });

  it("propose un bouton d'activation vers le lien fourni", () => {
    expect(c.cta).toEqual({
      label: "Activer mon compte",
      url: "https://iris.test/activer-compte?token_hash=abc",
    });
  });

  it("dit quoi faire si le lien a expiré, sans annoncer de durée", () => {
    expect(c.footnote).toContain("usage unique");
    expect(c.footnote).not.toMatch(/\d+\s*(heure|jour|minute)/);
  });
});

describe("authEmailContent — réinitialisation", () => {
  it("rassure sur l'absence de changement quand la demande n'est pas la sienne", () => {
    const c = authEmailContent("recovery", { actionUrl: "https://iris.test/x" });
    expect(c.subject).toBe("Réinitialisation de votre mot de passe — Iris");
    expect(c.paragraphs[0]).toBe("Bonjour,");
    expect(c.footnote).toContain("votre mot de passe reste inchangé");
  });

  it("est le repli d'un type inconnu", () => {
    const kind = authEmailKind("inconnu");
    expect(authEmailContent(kind, {}).heading).toBe("Réinitialisation de mot de passe");
  });
});

describe("authEmailContent — réauthentification", () => {
  it("transporte un code et aucun bouton", () => {
    const c = authEmailContent("reauthentication", { code: "482913" });
    expect(c.code).toBe("482913");
    expect(c.cta).toBeUndefined();
  });
});

describe("catalogue complet", () => {
  it("chaque message se rend sans laisser de trou dans le gabarit", () => {
    const kinds = ["recovery", "invite", "signup", "magiclink", "email_change", "reauthentication"] as const;
    for (const kind of kinds) {
      const content = authEmailContent(kind, {
        tenantName: "Ville de Test",
        actionUrl: "https://iris.test/x",
        code: "482913",
      });
      const html = renderEmailHtml(content, brandFor("Ville de Test"));
      expect(content.subject.length).toBeGreaterThan(0);
      expect(html).toContain(escapeHtml(content.heading));
      expect(html).not.toContain("undefined");
    }
  });
});
