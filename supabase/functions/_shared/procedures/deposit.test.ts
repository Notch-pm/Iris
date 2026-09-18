import { describe, expect, it } from "vitest";
import { admittedAudiences, formPieces } from "./deposit";

const attachment = (over: Record<string, unknown>) => ({
  id: String(over.id ?? "f"),
  key: String(over.id ?? "f"),
  type: "attachment",
  maxFiles: 1,
  acceptedFormats: ["pdf"],
  ...over,
});
const rule = { combinator: "and", rules: [{ fieldId: "motif", operator: "equals", value: "x" }] };

describe("formPieces", () => {
  it("libelle l'exigence d'une pièce sans rejouer de condition", () => {
    expect(formPieces({
      version: 1,
      content: [
        { id: "motif", key: "motif", label: "Motif", type: "text" },
        attachment({ id: "domicile", label: "Justificatif de domicile", required: true }),
        attachment({ id: "a", label: "Plan", requiredIf: rule }),
        attachment({ id: "b", label: "Photo" }),
        attachment({ id: "c", label: "Mandat", visibleIf: rule }),
        {
          id: "s", kind: "section", title: "Travaux", visibleIf: rule,
          fields: [attachment({ id: "d", label: "Devis", required: true })],
        },
      ],
    })).toEqual([
      { label: "Justificatif de domicile", requirement: "obligatoire", required: true },
      { label: "Plan", requirement: "obligatoire selon les réponses", required: false },
      { label: "Photo", requirement: "facultative", required: false },
      { label: "Mandat", requirement: "facultative, demandée selon les réponses", required: false },
      { label: "Devis", requirement: "obligatoire, demandée selon les réponses", required: false },
    ]);
  });

  it("formulaire absent ou illisible : `null`, jamais « aucune pièce »", () => {
    expect(formPieces(null)).toBeNull();
    expect(formPieces({ content: "cassé" })).toBeNull();
  });

  it("un vrai formulaire sans pièce dit « aucune » à raison", () => {
    expect(formPieces({ version: 1, content: [{ id: "a", key: "a", label: "A", type: "text" }] })).toEqual([]);
  });
});

describe("admittedAudiences", () => {
  it("rend les publics ACTIVÉS, avec les libellés de l'écran", () => {
    expect(admittedAudiences({ citoyen: { enabled: true }, entreprise: { enabled: false }, association: { enabled: true } }))
      .toEqual(["Citoyen", "Association"]);
  });

  it("aucun public activé : aucun public supposé (pas de repli sur « citoyen »)", () => {
    expect(admittedAudiences(null)).toEqual([]);
    expect(admittedAudiences({ citoyen: { enabled: false } })).toEqual([]);
  });
});
