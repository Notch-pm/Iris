import { describe, expect, it } from "vitest";
import { ACCESS_CODE_SUBJECT, accessCodeEmail } from "./codeAcces.ts";
import { revealAccessCode } from "./accuse.ts";
import { ACCESS_CODE_ALPHABET, MASKED_ACCESS_CODE } from "../access/accessCode.ts";

const base = {
  reference: "DEM-2026-000042",
  requestSubject: "Acte de naissance",
  trackingUrl: "https://sceaux.edilumen.fr/suivi",
  tenantName: "Ville de Sceaux",
  reason: "renvoi_usager" as const,
};

describe("accessCodeEmail", () => {
  it("objet figé ; référence, objet, code MASQUÉ, ancien code périmé, page de suivi, signature", () => {
    const { subject, body } = accessCodeEmail(base);
    expect(subject).toBe(ACCESS_CODE_SUBJECT);
    expect(body).toContain("« Acte de naissance » (référence DEM-2026-000042)");
    expect(body).toContain(`Votre code d'accès : ${MASKED_ACCESS_CODE}`);
    expect(body).toContain("Il remplace le précédent, qui ne fonctionne plus.");
    expect(body).toContain("rendez-vous sur https://sceaux.edilumen.fr/suivi");
    expect(body.trimEnd().endsWith("Cordialement,\nVille de Sceaux")).toBe(true);
  });

  it("jamais un code en clair dans le texte composé (celui qu'enregistre l'onglet Échanges)", () => {
    const { body } = accessCodeEmail(base);
    expect(body).not.toMatch(new RegExp(`[${ACCESS_CODE_ALPHABET}]{4}-[${ACCESS_CODE_ALPHABET}]{4}-[${ACCESS_CODE_ALPHABET}]{2}`));
    // Le clair n'apparaît qu'au moment d'envoyer, à la place du masque.
    const sent = revealAccessCode(body, "WXYZ-WXYZ-WX");
    expect(sent).toContain("Votre code d'accès : WXYZ-WXYZ-WX");
    expect(sent).not.toContain(MASKED_ACCESS_CODE);
  });

  it("deux motifs : l'usager l'a demandé (avec « si ce n'est pas vous »), ou un agent l'a créé", () => {
    const usager = accessCodeEmail(base).body;
    expect(usager).toContain("Vous avez demandé un nouveau code d'accès");
    expect(usager).toContain("Si vous n'êtes pas à l'origine de cette demande");
    const agent = accessCodeEmail({ ...base, reason: "agent" }).body;
    expect(agent).toContain("Un nouveau code d'accès a été créé");
    expect(agent).not.toContain("Si vous n'êtes pas à l'origine");
  });

  it("replis : sans page de suivi, la rubrique du portail ; sans nom de collectivité, pas de ligne vide ; sans objet, pas de guillemets", () => {
    const { body } = accessCodeEmail({ ...base, trackingUrl: null, tenantName: "  ", requestSubject: null });
    expect(body).toContain("rubrique « Suivre une demande »");
    expect(body.trimEnd().endsWith("Cordialement,")).toBe(true);
    expect(body).toContain("votre demande (référence DEM-2026-000042)");
    expect(body).not.toContain("« »");
  });

  it("le contenu du formulaire ne sort pas : rien d'autre que la référence et l'objet", () => {
    const { body } = accessCodeEmail(base);
    expect(body).not.toMatch(/undefined|null/);
  });
});
