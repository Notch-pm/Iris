import { describe, expect, it } from "vitest";
import defaults from "./__fixtures__/socleDefaults.json";
import {
  PORTAL_TRACKING_FALLBACK,
  SYSTEM_KEYS,
  bodyParagraphs,
  composeFromTemplate,
  renderTemplateText,
  systemTemplatesFromRows,
  type SocleSystemTemplate,
} from "./socleTemplates.ts";
import { receiptEmail, receiptEmailFromTemplate, type ReceiptInput } from "./accuse.ts";
import { accessCodeEmail, accessCodeEmailFromTemplate } from "./codeAcces.ts";
import { CLOSURE_TEMPLATE_KEYS, closureEmail, closureEmailFromTemplate } from "./cloture.ts";
import {
  NOTICE_TEMPLATE_KEYS,
  messageNoticeEmail,
  messageNoticeFromTemplate,
  shouldUseMessageTemplate,
  statusNoticeEmail,
  statusNoticeFromTemplate,
  type NoticeEvent,
} from "./avisUsager.ts";

/**
 * Le catalogue d'origine du Socle (`email_template_defaults`, après les
 * renommages du 2026-11-12). Ses textes ont été repris d'Iris : rendus avec les
 * mêmes données, ils doivent donner EXACTEMENT le message d'aujourd'hui — c'est
 * ce qui permet de basculer sans que l'usager voie la différence.
 */
const TEMPLATES = systemTemplatesFromRows(
  (defaults as { key: string; subject: string; body: string }[]).map((d) => ({
    system_key: d.key, subject: d.subject, body: d.body, is_customized: false,
  })),
);
const tpl = (key: string): SocleSystemTemplate => {
  const t = TEMPLATES.get(key);
  if (!t) throw new Error(`modèle ${key} absent de la fixture`);
  return t;
};

describe("renderTemplateText", () => {
  it("sections : rendue si la variable a une valeur, retirée sinon ; ^ = l'inverse", () => {
    expect(renderTemplateText("a{{#x}}[{{x}}]{{/x}}b", { x: "1" })).toBe("a[1]b");
    expect(renderTemplateText("a{{#x}}[{{x}}]{{/x}}b", {})).toBe("ab");
    expect(renderTemplateText("a{{^x}}rien{{/x}}b", {})).toBe("arienb");
    expect(renderTemplateText("a{{^x}}rien{{/x}}b", { x: "1" })).toBe("ab");
  });

  it("sections imbriquées et jeton orphelin (jamais montré à l'usager)", () => {
    expect(renderTemplateText("{{#a}}A{{#b}}B{{/b}}{{/a}}", { a: "1" })).toBe("A");
    expect(renderTemplateText("x{{#a}}y", {})).toBe("xy");
  });

  it("une valeur blanche compte comme absente", () => {
    expect(renderTemplateText("{{#a}}A{{/a}}", { a: "  " })).toBe("");
  });
});

describe("composeFromTemplate / bodyParagraphs", () => {
  it("objet sur une ligne, corps sans pavés de lignes vides", () => {
    const out = composeFromTemplate({ subject: "Objet\n{{a}}", body: "A\n{{#b}}\nB\n{{/b}}\n\n\n\nC" }, { a: "x" });
    expect(out.subject).toBe("Objet x");
    expect(out.body).toBe("A\n\nC");
    expect(bodyParagraphs("A\nA2\n\nB")).toEqual(["A\nA2", "B"]);
  });

  it("le miroir n'apporte que des modèles complets", () => {
    const map = systemTemplatesFromRows([
      { system_key: "a", subject: "s", body: "b", is_customized: true },
      { system_key: "b", subject: " ", body: "b", is_customized: false },
      { system_key: null, subject: "s", body: "b", is_customized: false },
    ]);
    expect([...map.keys()]).toEqual(["a"]);
    expect(map.get("a")?.isCustomized).toBe(true);
  });

  it("la fixture couvre les dix courriels système", () => {
    expect([...TEMPLATES.keys()].sort()).toEqual(Object.values(SYSTEM_KEYS).sort());
  });
});

describe("textes d'origine du Socle = messages actuels d'Iris", () => {
  const receipt: ReceiptInput = {
    reference: "DEM-2026-000042",
    requestSubject: "Nid-de-poule",
    receivedAt: "2026-10-09T08:30:00Z",
    organisme: "Direction de la voirie",
    recipient: { civility: "madame", fullName: "Marie Durand" },
    tenantName: "Ville de Saint-Aubin",
    access: { trackingUrl: "https://demarches.exemple.fr/suivi" },
  };

  it.each([
    ["complet", receipt],
    ["sans suivi en ligne", { ...receipt, access: null }],
    ["suivi sans adresse", { ...receipt, access: { trackingUrl: null } }],
    ["sans objet, organisme, date ni collectivité", {
      ...receipt, requestSubject: null, organisme: null, receivedAt: null, tenantName: null,
      recipient: {},
    }],
  ])("accusé de réception — %s", (_label, input) => {
    expect(receiptEmailFromTemplate(input, tpl(SYSTEM_KEYS.accuse))).toEqual(receiptEmail(input));
  });

  it("le lien de repli garde la phrase entière", () => {
    const out = receiptEmailFromTemplate({ ...receipt, access: { trackingUrl: null } }, tpl(SYSTEM_KEYS.accuse));
    expect(out.body).toContain(`rendez-vous sur ${PORTAL_TRACKING_FALLBACK}`);
  });

  it.each([
    ["positive avec commentaire", "resolue_positive", "Les travaux sont faits."],
    ["négative sans commentaire", "resolue_negative", null],
  ] as const)("avis de clôture — %s", (_label, outcome, closureText) => {
    const input = {
      outcome, reference: "DEM-1", requestSubject: "Lampadaire", closureText,
      recipient: { civility: "monsieur", fullName: "Paul Martin" }, tenantName: "Ville",
    };
    expect(closureEmailFromTemplate(input, tpl(CLOSURE_TEMPLATE_KEYS[outcome]))).toEqual(closureEmail(input));
  });

  it("nouveau code d'accès — le texte du Socle vaut pour les deux origines, code masqué", () => {
    const input = { reference: "DEM-1", requestSubject: "Lampadaire", trackingUrl: "https://x/suivi", tenantName: "Ville", reason: "renvoi_usager" as const };
    const out = accessCodeEmailFromTemplate(input, tpl(SYSTEM_KEYS.codeAcces));
    expect(out.subject).toBe(accessCodeEmail(input).subject);
    expect(out.body).toContain("Votre code d'accès : ••••-••••-••");
    expect(out.body).toContain("rendez-vous sur https://x/suivi");
  });

  it.each(Object.keys(NOTICE_TEMPLATE_KEYS) as NoticeEvent[])("avis de statut — %s : objet, texte et bouton identiques", (event) => {
    const input = {
      event, status: "en_instruction", reference: "DEM-1", procedureName: "Signalement",
      url: "https://x/demande", unsubscribeUrl: "https://x/stop", tenantName: "Ville",
    };
    expect(statusNoticeFromTemplate(input, tpl(NOTICE_TEMPLATE_KEYS[event]))).toEqual(statusNoticeEmail(input));
  });

  it("nouveau message (un seul) — identique", () => {
    const input = {
      reference: "DEM-1", procedureName: "Signalement", excerpt: "Pourriez-vous…", messageCount: 1,
      statusPart: null, url: "https://x/demande", unsubscribeUrl: null, tenantName: "Ville", repliesOpen: true,
    };
    expect(messageNoticeFromTemplate(input, tpl(SYSTEM_KEYS.nouveauMessage))).toEqual(messageNoticeEmail(input));
  });

  it("plusieurs messages : le texte d'origine (au singulier) laisse la main à Iris, sauf s'il a été réécrit", () => {
    const t = tpl(SYSTEM_KEYS.nouveauMessage);
    expect(shouldUseMessageTemplate(1, t)).toBe(true);
    expect(shouldUseMessageTemplate(2, t)).toBe(false);
    expect(shouldUseMessageTemplate(2, { ...t, isCustomized: true })).toBe(true);
  });

  it("un texte personnalisé dans le Socle part tel quel, habillage d'Iris conservé", () => {
    const input = {
      event: "prise_en_charge" as const, status: "en_instruction", reference: "DEM-1", procedureName: null,
      url: "https://x/demande", unsubscribeUrl: null, tenantName: "Ville",
    };
    const notice = statusNoticeFromTemplate(input, {
      subject: "Prise en charge de {{demande.reference}}",
      body: "Bonjour,\n\nNous traitons {{demande.reference}}.\n\nLa mairie",
      isCustomized: true,
    });
    expect(notice.subject).toBe("Prise en charge de DEM-1");
    expect(notice.content.paragraphs).toEqual(["Bonjour,", "Nous traitons DEM-1.", "La mairie"]);
    expect(notice.content.cta).toEqual({ label: "Voir ma demande", url: "https://x/demande" });
    expect(notice.body).toContain("Pour la consulter : https://x/demande");
  });
});
