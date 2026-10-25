import { describe, expect, it } from "vitest";
import { NOTICE_REASON_LABELS, deliveryNotice, noticeReasonLabel, sentNotice } from "./remise";
import { SKIP_REASONS } from "@fn/_shared/citizenNotices/decision";

describe("deliveryNotice", () => {
  it("publié : dit où, et que l'usager recevra un avis avec lien", () => {
    expect(deliveryNotice({ delivery: "espace", target: "compte" }, "Mme Martin")).toContain("son espace sur le portail");
    expect(deliveryNotice({ delivery: "espace", target: "invite" }, "Mme Martin")).toContain("son suivi en ligne");
    expect(deliveryNotice({ delivery: "espace", target: "invite" }, "Mme Martin")).toContain("premiers mots et un lien");
  });

  it("courriel, aucune adresse, ou aperçu absent : le texte d'avant", () => {
    for (const preview of [{ delivery: "courriel" as const, target: null }, { delivery: "aucune" as const, target: null }, undefined]) {
      expect(deliveryNotice(preview, "Mme Martin")).toContain("l'usager reçoit le texte affiché");
    }
  });
});

describe("sentNotice", () => {
  it("dit ce que le serveur a fait, pas ce que l'aperçu annonçait", () => {
    expect(sentNotice({ delivery: "espace" })).toContain("publié dans l'espace");
    expect(sentNotice({ delivery: "courriel" })).toBe("Message envoyé à l'usager.");
    expect(sentNotice(undefined)).toBe("Message envoyé à l'usager.");
  });
});

describe("raisons d'un avis non parti", () => {
  it("chaque raison du catalogue serveur a son libellé", () => {
    expect(Object.keys(NOTICE_REASON_LABELS).sort()).toEqual([...SKIP_REASONS].sort());
  });

  it("un échec dit son erreur ; une raison inconnue ne casse rien", () => {
    expect(noticeReasonLabel({ status: "failed", reason: null, error: "relais muet" })).toBe("échec de l'envoi (relais muet)");
    expect(noticeReasonLabel({ status: "skipped", reason: "preference", error: null })).toBe("l'usager a demandé à ne plus être prévenu");
    expect(noticeReasonLabel({ status: "skipped", reason: "nouvelle", error: null })).toBe("raison inconnue");
  });
});
