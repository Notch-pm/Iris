import { describe, expect, it } from "vitest";
import {
  buildClaraReplyPayload,
  claraReplyFailure,
  claraReplyOutcome,
  defaultReplyChannel,
  irisRequestUrl,
  parseReplyEvent,
  parseReplySubmission,
} from "./reply.ts";

const REQ = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const COUR = "33333333-3333-4333-8333-333333333333";

const valid = {
  request_id: REQ,
  submission_id: SUB,
  outcome: "resolue_positive",
  subject: " Votre demande ",
  body: " Madame, Monsieur… ",
  channel: "email",
};

describe("parseReplySubmission", () => {
  it("accepte un dépôt complet et nettoie les textes", () => {
    const r = parseReplySubmission({ ...valid, motif: "  ", closure_text: " Accordé. " });
    expect(r).toEqual({
      requestId: REQ,
      submissionId: SUB,
      outcome: "resolue_positive",
      motif: null,
      closureText: "Accordé.",
      subject: "Votre demande",
      body: "Madame, Monsieur…",
      channel: "email",
    });
  });

  it("refuse une clé inconnue, une issue ou un canal hors liste, un texte vide", () => {
    expect(parseReplySubmission({ ...valid, status: "x" })).toHaveProperty("error");
    expect(parseReplySubmission({ ...valid, outcome: "annulee" })).toHaveProperty("error");
    expect(parseReplySubmission({ ...valid, channel: "sms" })).toHaveProperty("error");
    expect(parseReplySubmission({ ...valid, body: "  " })).toHaveProperty("error");
    expect(parseReplySubmission({ ...valid, subject: "" })).toHaveProperty("error");
    expect(parseReplySubmission({ ...valid, request_id: "x" })).toHaveProperty("error");
    expect(parseReplySubmission(null)).toHaveProperty("error");
  });
});

describe("defaultReplyChannel", () => {
  it("courriel si une adresse est connue, papier sinon", () => {
    expect(defaultReplyChannel("a@b.fr")).toBe("email");
    expect(defaultReplyChannel(null)).toBe("paper");
    expect(defaultReplyChannel("")).toBe("paper");
  });
});

describe("buildClaraReplyPayload", () => {
  it("compose le dépôt sans l'issue (elle reste dans Iris)", () => {
    const submission = parseReplySubmission(valid);
    if ("error" in submission) throw new Error(submission.error);
    const payload = buildClaraReplyPayload({
      submission,
      request: { id: REQ, reference: "2026-00042", socle_organization_id: "org", socle_contact_id: "contact" },
      appUrl: "https://iris.edilumen.fr/",
      agent: { name: "Agent Test", email: "agent@x.fr" },
    });
    expect(payload.iris_request).toEqual({
      id: REQ,
      reference: "2026-00042",
      url: `https://iris.edilumen.fr/demandes/${REQ}`,
    });
    expect(JSON.stringify(payload)).not.toContain("resolue_");
  });

  it("n'invente pas d'URL hors https", () => {
    expect(irisRequestUrl("http://localhost:5174", REQ)).toBeNull();
    expect(irisRequestUrl(undefined, REQ)).toBeNull();
  });
});

describe("claraReplyOutcome / claraReplyFailure", () => {
  it("lit un dépôt réussi", () => {
    expect(
      claraReplyOutcome(201, { ok: true, courier_id: COUR, reference: "2026-S-00001", url: "https://clara/x" }),
    ).toEqual({ kind: "ok", courierId: COUR, reference: "2026-S-00001", url: "https://clara/x", duplicate: false });
  });

  it("distingue l'absence de circuit de réponse, une validation, une clé refusée", () => {
    expect(claraReplyOutcome(422, { error: "no_reply_workflow" })).toEqual({ kind: "no_reply_workflow" });
    expect(claraReplyOutcome(400, { message: "canal" })).toEqual({ kind: "validation", message: "canal" });
    expect(claraReplyOutcome(401, {})).toEqual({ kind: "unauthorized" });
    expect(claraReplyOutcome(200, { ok: true })).toEqual({ kind: "unexpected" });
    expect(claraReplyFailure({ kind: "unauthorized" }).message).not.toMatch(/clé/i);
  });
});

describe("parseReplyEvent", () => {
  it("accepte sent et cancelled", () => {
    expect(parseReplyEvent({ courier_id: COUR, event: "sent", occurred_at: "2026-11-12T10:00:00+01:00" }))
      .toEqual({ courierId: COUR, event: "sent", occurredAt: "2026-11-12T09:00:00.000Z" });
    expect(parseReplyEvent({ courier_id: COUR, event: "cancelled" }))
      .toEqual({ courierId: COUR, event: "cancelled", occurredAt: null });
  });

  it("refuse une clé inconnue, un événement inconnu, une date illisible", () => {
    expect(parseReplyEvent({ courier_id: COUR, event: "sent", status: "x" })).toHaveProperty("error");
    expect(parseReplyEvent({ courier_id: COUR, event: "visa" })).toHaveProperty("error");
    expect(parseReplyEvent({ courier_id: COUR, event: "sent", occurred_at: "hier" })).toHaveProperty("error");
    expect(parseReplyEvent({ courier_id: "x", event: "sent" })).toHaveProperty("error");
  });
});
