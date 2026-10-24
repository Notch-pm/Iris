import { describe, expect, it } from "vitest";
import type { PieceRequirement } from "./conformite";
import { filedCitizenPieceIds, filingTargets, OUTSIDE_FORM_LABEL } from "./versement";

const att = (id: string, extra: Partial<{ email_id: string | null; citizen_message_id: string | null; source_attachment_id: string | null }> = {}) => ({
  id, email_id: null, citizen_message_id: null, source_attachment_id: null, ...extra,
});

describe("filedCitizenPieceIds", () => {
  it("retient les originaux dont une copie est AU DOSSIER", () => {
    const ids = filedCitizenPieceIds([
      att("orig", { citizen_message_id: "m1" }),
      att("copie", { source_attachment_id: "orig" }),
      att("orig2", { citizen_message_id: "m1" }),
    ]);
    expect([...ids]).toEqual(["orig"]);
  });

  it("une copie jointe à un e-mail n'est pas un versement", () => {
    expect(filedCitizenPieceIds([att("x", { email_id: "e1", source_attachment_id: "doc" })]).size).toBe(0);
  });
});

describe("filingTargets", () => {
  const piece = { id: "p1", file_name: "ancien.pdf", form_field_key: "domicile", compliance: "non_conforme", compliance_motif: "illisible" };
  const requirements: PieceRequirement[] = [{
    key: "domicile", label: "Justificatif de domicile", required: true,
    attachments: [piece], superseded: [], state: "non_conforme", motifs: ["illisible"],
  }];

  it("chaque champ pièce, avec ce qu'il remplacera, puis « hors formulaire »", () => {
    const targets = filingTargets(
      [{ key: "domicile", label: "Justificatif de domicile", required: true }, { key: "rib", label: "RIB", required: false }],
      requirements,
    );
    expect(targets.map((t) => [t.key, t.label, t.replaces.map((a) => a.id)])).toEqual([
      ["domicile", "Justificatif de domicile", ["p1"]],
      ["rib", "RIB", []],
      [null, OUTSIDE_FORM_LABEL, []],
    ]);
  });

  it("sans formulaire : seulement « hors formulaire »", () => {
    expect(filingTargets([], []).map((t) => t.key)).toEqual([null]);
  });
});
