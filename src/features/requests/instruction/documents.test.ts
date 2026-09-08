import { describe, expect, it } from "vitest";
import type { RequestAttachment } from "../useRequests";
import {
  documentsOf, generatedMeta, isSendable, kindLabel, pdfWarningLine, previewValue,
  sendableDocuments,
} from "./documents";

function piece(partial: Partial<RequestAttachment>): RequestAttachment {
  return {
    id: "a1", organization_id: "o", request_id: "r", storage_path: "o/r/x.pdf",
    file_name: "x.pdf", mime_type: "application/pdf", file_size: 10, checksum: null,
    document_type_socle_id: null, document_type_label: null, copy_status: "copied",
    uploaded_by: null, created_at: "2026-09-01T10:00:00Z", compliance: null,
    compliance_at: null, compliance_by: null, compliance_motif: null, compliance_note: null,
    email_id: null, fetch_url: null, form_field_key: null,
    superseded_at: null, superseded_by: null,
    kind: "demande", template_socle_id: null, template_label: null,
    generated_at: null, generated_by: null, source_attachment_id: null,
    ...partial,
  } as RequestAttachment;
}

describe("natures", () => {
  it("un document interne ne sort jamais", () => {
    expect(isSendable("instruction_interne")).toBe(false);
    expect(isSendable("instruction_externe")).toBe(true);
    expect(isSendable("courrier")).toBe(true);
    // Une pièce de l'usager n'est pas un document d'instruction.
    expect(isSendable("demande")).toBe(false);
  });

  it("nomme les natures en français", () => {
    expect(kindLabel("courrier")).toBe("Courrier");
    expect(kindLabel("inconnu")).toBe("inconnu");
  });
});

describe("regroupement", () => {
  const list = [
    piece({ id: "interne", kind: "instruction_interne" }),
    piece({ id: "externe", kind: "instruction_externe" }),
    piece({ id: "courrier", kind: "courrier" }),
    piece({ id: "usager", kind: "demande" }),
    // Une copie déjà partie dans un échange : elle appartient à l'onglet Échanges.
    piece({ id: "envoyee", kind: "courrier", email_id: "e1" }),
  ];

  it("ne montre que les documents de la nature demandée", () => {
    expect(documentsOf(list, "courrier").map((a) => a.id)).toEqual(["courrier"]);
    expect(documentsOf(list, "instruction_interne").map((a) => a.id)).toEqual(["interne"]);
  });

  it("écarte les pièces déjà jointes à un échange", () => {
    expect(documentsOf(list, "courrier").some((a) => a.id === "envoyee")).toBe(false);
  });

  it("le plus récent d'abord", () => {
    const deux = [
      piece({ id: "vieux", kind: "courrier", created_at: "2026-08-01T10:00:00Z" }),
      piece({ id: "neuf", kind: "courrier", created_at: "2026-09-01T10:00:00Z" }),
    ];
    expect(documentsOf(deux, "courrier").map((a) => a.id)).toEqual(["neuf", "vieux"]);
  });

  it("le sélecteur de pièces jointes ne propose que l'externe et le courrier", () => {
    expect(sendableDocuments(list).map((a) => a.id)).toEqual(["externe", "courrier"]);
  });
});

describe("provenance", () => {
  it("dit quand et depuis quel modèle le document a été produit", () => {
    expect(generatedMeta(piece({
      generated_at: "2026-09-01T10:00:00Z", template_label: "Courrier usager.docx",
    }))).toBe("Généré le 01/09/2026 depuis « Courrier usager.docx »");
  });

  it("une pièce déposée à la main n'annonce rien", () => {
    expect(generatedMeta(piece({}))).toBe("");
  });
});

describe("aperçu", () => {
  it("une valeur vide se voit", () => {
    expect(previewValue("  ")).toBe("—");
    expect(previewValue("Marie")).toBe("Marie");
  });

  it("les limites du PDF se disent, et proposent Word", () => {
    expect(pdfWarningLine([])).toBe("");
    const line = pdfWarningLine(["les images du modèle ne sont pas reprises"]);
    expect(line).toContain("images");
    expect(line).toContain("Word");
  });
});
