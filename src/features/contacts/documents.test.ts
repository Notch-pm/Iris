import { describe, expect, it } from "vitest";
import type { RequestAttachment, RequestListItem } from "@/features/requests/useRequests";
import {
  groupAttachmentsByRequest,
  isUsagerDocument,
  usagerDocumentNature,
  usagerDocumentsSummary,
} from "./documents";

function att(over: Partial<RequestAttachment>): RequestAttachment {
  return {
    id: over.id ?? crypto.randomUUID(),
    organization_id: "org",
    request_id: "r1",
    storage_path: "org/r1/x.pdf",
    file_name: "x.pdf",
    mime_type: "application/pdf",
    file_size: 10,
    checksum: null,
    document_type_socle_id: null,
    document_type_label: null,
    copy_status: "copied",
    uploaded_by: null,
    created_at: "2026-09-01T10:00:00Z",
    form_field_key: null,
    email_id: null,
    compliance: null,
    compliance_motif: null,
    compliance_note: null,
    compliance_by: null,
    compliance_at: null,
    superseded_by: null,
    superseded_at: null,
    kind: "demande",
    template_socle_id: null,
    template_label: null,
    generated_at: null,
    generated_by: null,
    source_attachment_id: null,
    socle_contact_id: "c1",
    ...over,
  } as RequestAttachment;
}

const requests = [
  { id: "r1", reference: "DEM-2026-000001", subject: "Nid-de-poule", status: "en_instruction" },
  { id: "r2", reference: "DEM-2026-000002", subject: "Élagage", status: "a_traiter" },
] as RequestListItem[];

describe("nature d'un document pour la fiche usager", () => {
  it("nomme chaque nature, et refuse l'interne et les copies d'échange", () => {
    expect(usagerDocumentNature(att({}))).toBe("Pièce déposée");
    expect(usagerDocumentNature(att({ kind: "courrier" }))).toBe("Courrier");
    expect(usagerDocumentNature(att({ kind: "instruction_externe" }))).toBe("Pièce d'instruction transmissible");
    expect(usagerDocumentNature(att({ email_id: "m1", kind: "courrier" }))).toBe("Jointe à un échange");
    expect(isUsagerDocument(att({ kind: "instruction_interne" }))).toBe(false);
    expect(isUsagerDocument(att({ email_id: "m1", source_attachment_id: "a0" }))).toBe(false);
    expect(isUsagerDocument(att({ email_id: "m1" }))).toBe(true);
  });
});

describe("groupAttachmentsByRequest", () => {
  it("groupe par demande, plus récentes d'abord, sans interne ni copie", () => {
    const groups = groupAttachmentsByRequest([
      att({ id: "a", request_id: "r1", created_at: "2026-09-01T10:00:00Z" }),
      att({ id: "b", request_id: "r2", created_at: "2026-09-03T10:00:00Z", kind: "courrier" }),
      att({ id: "c", request_id: "r1", created_at: "2026-09-02T10:00:00Z", superseded_by: "a" }),
      att({ id: "d", request_id: "r1", kind: "instruction_interne" }),
      att({ id: "e", request_id: "r2", email_id: "m", source_attachment_id: "b" }),
    ], requests);
    expect(groups.map((g) => g.reference)).toEqual(["DEM-2026-000002", "DEM-2026-000001"]);
    expect(groups[0].documents.map((d) => d.attachment.id)).toEqual(["b"]);
    expect(groups[1].documents.map((d) => d.attachment.id)).toEqual(["c", "a"]);
    expect(groups[1].documents[0].superseded).toBe(true);
    expect(groups[1].subject).toBe("Nid-de-poule");
  });

  it("garde une pièce dont la demande n'est pas dans la liste, sous un repère d'identifiant", () => {
    const groups = groupAttachmentsByRequest([att({ request_id: "9f8e7d6c-0000-4000-8000-000000000000" })], requests);
    expect(groups).toHaveLength(1);
    expect(groups[0].reference).toBe("Demande 9f8e7d6c");
    expect(groups[0].status).toBeNull();
  });

  it("résume", () => {
    expect(usagerDocumentsSummary([])).toBe("Aucun document visible");
    const groups = groupAttachmentsByRequest([att({ request_id: "r1" }), att({ request_id: "r2" })], requests);
    expect(usagerDocumentsSummary(groups)).toBe("2 documents visibles · 2 demandes");
  });
});
