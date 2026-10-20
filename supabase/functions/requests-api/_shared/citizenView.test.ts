import { describe, expect, it } from "vitest";
import { isCitizenVisibleAttachment, ownEmails, serializeCitizenRequest } from "./citizenView";

const REQUEST = {
  id: "11111111-1111-4111-8111-111111111111",
  reference: "DEM-2026-000042",
  status: "resolue_negative",
  subject: "Stationnement gênant",
  procedure_snapshot: { id: "p1", name: "Signaler un problème", form_schema: { secret: true } },
  received_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-05T08:00:00Z",
  closed_at: "2026-10-05T08:00:00Z",
  closure_text: "Votre demande ne relève pas de nos services.",
  // Ce qui ne doit JAMAIS sortir, même si un select trop large le ramène :
  closure_motif: "reorientation",
  form_data: { plaque: "AB-123-CD" },
  requester_snapshot: { declared: { email: "a@b.fr" } },
  assigned_to: "agent-1",
  anomalies: [{ code: "x" }],
};

const EMAILS = [
  { id: "e2", subject: "Réponse", body: "Bonjour", sent_at: "2026-10-05T08:00:00Z", status: "envoye", sent_by: "agent-1", to_email: "a@b.fr" },
  { id: "e1", subject: "Nous avons bien reçu votre demande", body: "… ••••-••••-••", sent_at: "2026-10-01T08:01:00Z", status: "envoye", sent_by: null },
  { id: "e3", subject: "Brouillon parti en échec", body: "…", sent_at: null, status: "echec" },
];

const ATTACHMENTS = [
  { id: "a1", file_name: "photo.jpg", mime_type: "image/jpeg", file_size: 1000, kind: "demande", email_id: null, superseded_by: null, storage_path: "o/r/a1" },
  { id: "a2", file_name: "ancienne.jpg", mime_type: "image/jpeg", file_size: 1000, kind: "demande", email_id: null, superseded_by: "a1", storage_path: "o/r/a2" },
  { id: "a3", file_name: "note-instruction.pdf", mime_type: "application/pdf", file_size: 10, kind: "instruction_interne", email_id: null, superseded_by: null, storage_path: "o/r/a3" },
  { id: "a4", file_name: "courrier-reponse.pdf", mime_type: "application/pdf", file_size: 20, kind: "instruction_externe", email_id: "e2", superseded_by: null, storage_path: "o/r/a4" },
  { id: "a5", file_name: "joint-echec.pdf", mime_type: "application/pdf", file_size: 20, kind: "demande", email_id: "e3", superseded_by: null, storage_path: "o/r/a5" },
  { id: "a6", file_name: "rapport.pdf", mime_type: "application/pdf", file_size: 20, kind: "instruction_externe", email_id: null, superseded_by: null, storage_path: "o/r/a6" },
];

describe("serializeCitizenRequest", () => {
  const view = serializeCitizenRequest(REQUEST, EMAILS, ATTACHMENTS);

  it("ne laisse sortir que la liste blanche", () => {
    expect(Object.keys(view).sort()).toEqual([
      "attachments", "closed_at", "closure_text", "id", "messages", "procedure_name",
      "received_at", "reference", "status", "subject", "updated_at",
    ]);
    const text = JSON.stringify(view);
    for (const secret of ["reorientation", "AB-123-CD", "agent-1", "a@b.fr", "o/r/", "secret", "instruction"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("donne le nom de la démarche et le texte de clôture d'une demande close", () => {
    expect(view.procedure_name).toBe("Signaler un problème");
    expect(view.closure_text).toBe("Votre demande ne relève pas de nos services.");
  });

  it("tait le texte de clôture d'une demande rouverte", () => {
    const reopened = serializeCitizenRequest({ ...REQUEST, status: "en_instruction", closed_at: null }, [], []);
    expect(reopened.closure_text).toBeNull();
  });

  it("ses pièces : celles de la demande, sans les remplacées ni l'instruction", () => {
    expect(view.attachments.map((a) => a.id)).toEqual(["a1"]);
  });

  it("les messages envoyés seulement, dans l'ordre, avec leurs pièces", () => {
    expect(view.messages.map((m) => m.id)).toEqual(["e1", "e2"]);
    expect(view.messages[1].attachments.map((a) => a.id)).toEqual(["a4"]);
    expect(Object.keys(view.messages[1]).sort()).toEqual(["attachments", "body", "id", "sent_at", "subject"]);
  });
});

describe("isCitizenVisibleAttachment", () => {
  const sent = new Set(["e2"]);
  it("refuse toujours l'instruction interne, même jointe à un envoi", () => {
    expect(isCitizenVisibleAttachment({ ...ATTACHMENTS[2], email_id: "e2" }, sent)).toBe(false);
  });
  it("refuse une pièce sans fichier", () => {
    expect(isCitizenVisibleAttachment({ ...ATTACHMENTS[0], storage_path: null }, sent)).toBe(false);
  });
});

describe("ownEmails", () => {
  const hash = async (value: unknown) => (typeof value === "string" ? `h:${value.trim().toLowerCase()}` : null);

  it("ne garde que les messages envoyés à l'adresse déclarée", async () => {
    const emails = [
      { id: "e1", to_email: "Deposant@Example.fr" },
      { id: "e2", to_email: "autre.personne@example.fr" },
      { id: "e3", to_email: null },
    ];
    const own = await ownEmails(emails, "h:deposant@example.fr", hash);
    expect(own.map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("serializeCitizenRequestSummary", () => {
  it("une ligne de « Mes demandes » : ni texte de clôture, ni motif, ni formulaire", async () => {
    const { serializeCitizenRequestSummary } = await import("./citizenView");
    const line = serializeCitizenRequestSummary(REQUEST);
    expect(Object.keys(line).sort()).toEqual([
      "closed_at", "id", "procedure_name", "received_at", "reference", "status", "subject", "updated_at",
    ]);
    expect(JSON.stringify(line)).not.toContain("reorientation");
  });
});
