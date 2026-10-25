import { describe, expect, it } from "vitest";
import { isCitizenMessageEmail, isCitizenVisibleAttachment, ownEmails, serializeCitizenRequest } from "./citizenView";

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
    expect(Object.keys(view.messages[1]).sort()).toEqual(["attachments", "body", "direction", "id", "sent_at", "subject"]);
    expect(view.messages.every((m) => m.direction === "agent")).toBe(true);
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

describe("messages de l'usager (L4b, 2.9.0)", () => {
  const OWN = [{ id: "m1", body: "Voici le justificatif.", created_at: "2026-10-03T09:00:00Z", author_kind: "invite", socle_contact_id: null }];
  const PIECES = [
    ...ATTACHMENTS,
    { id: "a7", file_name: "justificatif.pdf", mime_type: "application/pdf", file_size: 30, kind: "demande", email_id: null, citizen_message_id: "m1", superseded_by: null, storage_path: "o/r/a7" },
    { id: "a8", file_name: "autre-canal.pdf", mime_type: "application/pdf", file_size: 30, kind: "demande", email_id: null, citizen_message_id: "m9", superseded_by: null, storage_path: "o/r/a8" },
  ];
  const view = serializeCitizenRequest(REQUEST, EMAILS, PIECES, OWN);

  it("intercalés par date avec les envois, direction « usager », sans objet ni rien d'autre", () => {
    expect(view.messages.map((m) => [m.id, m.direction])).toEqual([["e1", "agent"], ["m1", "usager"], ["e2", "agent"]]);
    const mine = view.messages[1];
    expect(mine).toEqual({
      id: "m1", direction: "usager", subject: null, body: "Voici le justificatif.", sent_at: "2026-10-03T09:00:00Z",
      attachments: [{ id: "a7", file_name: "justificatif.pdf", mime_type: "application/pdf", size: 30 }],
    });
    expect(JSON.stringify(view)).not.toContain("author_kind");
  });

  it("ses pièces restent dans SON message : jamais dans les pièces de la demande ; celles d'un message d'un autre canal, nulle part", () => {
    expect(view.attachments.map((a) => a.id)).toEqual(["a1"]);
    expect(JSON.stringify(view)).not.toContain("autre-canal.pdf");
  });

  it("isCitizenVisibleAttachment : la pièce d'un message ne se voit qu'avec ce message", () => {
    expect(isCitizenVisibleAttachment(PIECES[6], new Set(), new Set(["m1"]))).toBe(true);
    expect(isCitizenVisibleAttachment(PIECES[6], new Set(), new Set())).toBe(false);
    expect(isCitizenVisibleAttachment({ ...PIECES[6], kind: "instruction_interne" }, new Set(), new Set(["m1"]))).toBe(false);
  });
});

describe("avis automatiques (B12, ADR-11)", () => {
  const AVIS = {
    id: "n1", subject: "Votre demande a avancé", body: "Votre demande est en instruction.",
    sent_at: "2026-10-03T08:00:00Z", status: "envoye", sent_by: null, nature: "avis",
  };

  it("un avis n'est pas un message de l'espace, même envoyé", () => {
    const view = serializeCitizenRequest(REQUEST, [...EMAILS, AVIS], ATTACHMENTS);
    expect(view.messages.map((m) => m.id)).toEqual(["e1", "e2"]);
  });

  it("liste blanche : nature absente = message, valeur inconnue écartée", () => {
    expect(isCitizenMessageEmail({ nature: "message" })).toBe(true);
    expect(isCitizenMessageEmail({})).toBe(true);
    expect(isCitizenMessageEmail({ nature: "avis" })).toBe(false);
    expect(isCitizenMessageEmail({ nature: "autre" })).toBe(false);
  });
});
