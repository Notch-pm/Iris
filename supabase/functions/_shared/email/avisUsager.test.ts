import { describe, expect, it } from "vitest";
import { EXCERPT_LENGTH, messageExcerpt, messageNoticeEmail, statusNoticeEmail, type StatusNoticeInput } from "./avisUsager";

const INPUT: StatusNoticeInput = {
  event: "attente_information",
  status: "en_attente",
  reference: "DEM-2026-000061",
  procedureName: "Signaler un problème sur la voie publique",
  url: "https://demarches.sceaux.fr/suivi",
  unsubscribeUrl: "https://demarches.sceaux.fr/notifications/desinscription?jeton=t",
  tenantName: "Ville de Sceaux",
};

describe("statusNoticeEmail", () => {
  it("porte la référence, la démarche, le statut usager, le lien et la désinscription", () => {
    const n = statusNoticeEmail(INPUT);
    expect(n.subject).toBe("Votre demande DEM-2026-000061 attend votre réponse");
    expect(n.body).toContain("« Signaler un problème sur la voie publique »");
    expect(n.body).toContain("Statut : En attente de votre réponse.");
    expect(n.body).toContain("Pour la consulter : https://demarches.sceaux.fr/suivi");
    expect(n.body).toContain(INPUT.unsubscribeUrl);
    expect(n.content.cta).toEqual({ label: "Voir ma demande", url: INPUT.url });
    expect(n.content.footnote).toContain(INPUT.unsubscribeUrl);
  });

  it("chaque événement a son objet", () => {
    const subjects = (["prise_en_charge", "attente_information", "reprise_instruction", "annulation", "reouverture"] as const)
      .map((event) => statusNoticeEmail({ ...INPUT, event }).subject);
    expect(new Set(subjects).size).toBe(5);
    for (const s of subjects) expect(s).toContain("DEM-2026-000061");
  });

  it("sans démarche ni désinscription ni collectivité : un message correct, pas une ligne vide", () => {
    const n = statusNoticeEmail({ ...INPUT, event: "annulation", status: "annulee", procedureName: null, unsubscribeUrl: null, tenantName: " " });
    expect(n.body).toContain("Votre demande (référence DEM-2026-000061) a été annulée.");
    expect(n.body.endsWith("Cordialement,")).toBe(true);
    expect(n.content.footnote).toBeUndefined();
  });

  it("ne cite rien d'autre que ce que reçoit le composeur (ni objet, ni motif, ni agent)", () => {
    // Le type d'entrée est la garde : rien d'autre n'y entre. Ce test fige la liste.
    expect(Object.keys(INPUT).sort()).toEqual(["event", "procedureName", "reference", "status", "tenantName", "unsubscribeUrl", "url"]);
  });
});

describe("messageExcerpt", () => {
  it("coupe sur un mot, jamais au-delà de 140 caractères, puis « … »", () => {
    const long = "Nous avons bien examiné votre dossier et il nous manque encore le justificatif de domicile de moins de trois mois ainsi que la copie recto verso de votre pièce d'identité.";
    const e = messageExcerpt(long);
    expect(e.endsWith("…")).toBe(true);
    expect(e.length - 1).toBeLessThanOrEqual(EXCERPT_LENGTH);
    expect(long.startsWith(e.slice(0, -1))).toBe(true);
    expect(long.charAt(e.length - 1)).toBe(" ");
  });

  it("saute une salutation finissant par une virgule", () => {
    expect(messageExcerpt("Bonjour Madame Martin,\n\nVotre demande est complète.")).toBe("Votre demande est complète.");
    expect(messageExcerpt("Bonjour,")).toBe("Bonjour,");
  });

  it("un message court reste entier, espaces resserrés", () => {
    expect(messageExcerpt("  Merci   pour\nvotre envoi.  ")).toBe("Merci pour votre envoi.");
  });
});

describe("messageNoticeEmail", () => {
  const base = {
    reference: "DEM-2026-000061", procedureName: "Signaler un problème", excerpt: "Pouvez-vous nous transmettre…",
    messageCount: 1, statusPart: null, url: "https://x.fr/suivi", unsubscribeUrl: null, tenantName: "Ville de Sceaux",
  };

  it("cite l'extrait, jamais plus, et renvoie à l'espace", () => {
    const n = messageNoticeEmail(base);
    expect(n.subject).toBe("Nouveau message concernant votre demande DEM-2026-000061");
    expect(n.body).toContain("« Pouvez-vous nous transmettre… »");
    expect(n.content.cta).toEqual({ label: "Lire le message", url: "https://x.fr/suivi" });
  });

  it("plusieurs messages, et un statut de la même fenêtre", () => {
    const n = messageNoticeEmail({ ...base, messageCount: 2, statusPart: { event: "attente_information", status: "en_attente" } });
    expect(n.subject).toBe("Nouveaux messages concernant votre demande DEM-2026-000061");
    expect(n.body).toContain("2 nouveaux messages");
    expect(n.body).toContain("a aussi changé de statut : En attente de votre réponse.");
  });

  it("demande close : on renvoie à la lecture, jamais à une réponse que le portail refuserait", () => {
    expect(messageNoticeEmail(base).body).toContain("Pour le lire en entier et y répondre : https://x.fr/suivi");
    const closed = messageNoticeEmail({ ...base, closed: true });
    expect(closed.body).toContain("Pour le lire en entier : https://x.fr/suivi");
    expect(closed.body).not.toContain("répondre");
    expect(messageNoticeEmail({ ...base, closed: true, messageCount: 2 }).body).toContain("Pour les lire en entier : ");
  });
});
