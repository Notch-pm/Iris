import { describe, expect, it } from "vitest";
import { citizenChannelLabel, isExchangePiece, mergeThread, piecesByExchange, unsentNotices } from "./citizenMessages";

// deno-lint-ignore no-explicit-any
const email = (id: string, created_at: string) => ({ id, created_at }) as any;
// deno-lint-ignore no-explicit-any
const message = (id: string, created_at: string, author_kind = "invite") => ({ id, created_at, author_kind }) as any;
// deno-lint-ignore no-explicit-any
const piece = (id: string, email_id: string | null, citizen_message_id: string | null) => ({ id, email_id, citizen_message_id }) as any;

describe("mergeThread", () => {
  it("intercale envois et réponses de l'usager par date", () => {
    const thread = mergeThread(
      [email("e2", "2026-10-05T08:00:00Z"), email("e1", "2026-10-01T08:00:00Z")],
      [message("m1", "2026-10-03T08:00:00Z")],
    );
    expect(thread.map((t) => (t.kind === "email" ? t.mail.id : t.kind === "citizen" ? t.message.id : t.notice.id))).toEqual(["e1", "m1", "e2"]);
    expect(thread.map((t) => t.kind)).toEqual(["email", "citizen", "email"]);
  });

  it("les avis non partis s'intercalent à leur date de règlement ; un avis parti ou en attente non", () => {
    // deno-lint-ignore no-explicit-any
    const notice = (id: string, status: string, settled_at: string | null, email_id: string | null = null) => ({ id, status, settled_at, created_at: "2026-10-01T00:00:00Z", email_id }) as any;
    const thread = mergeThread([email("e1", "2026-10-01T08:00:00Z")], [], [
      notice("n1", "skipped", "2026-10-02T08:00:00Z"),
      notice("n2", "sent", "2026-10-02T09:00:00Z", "e9"),
      notice("n3", "pending", null),
      notice("n4", "failed", "2026-10-03T08:00:00Z"),
      notice("n5", "failed", "2026-10-03T09:00:00Z", "e8"),
    ]);
    expect(thread.map((t) => t.kind === "notice" ? t.notice.id : t.kind)).toEqual(["email", "n1", "n4"]);
    expect(unsentNotices([])).toEqual([]);
  });

  it("sans réponse de l'usager, le fil est celui des envois", () => {
    expect(mergeThread([email("e1", "2026-10-01T08:00:00Z")], []).map((t) => t.kind)).toEqual(["email"]);
  });
});

describe("citizenChannelLabel", () => {
  it("dit par où l'usager a écrit", () => {
    expect(citizenChannelLabel("compte")).toBe("depuis son compte");
    expect(citizenChannelLabel("invite")).toBe("depuis le suivi en ligne");
  });
});

describe("pièces d'un échange", () => {
  const pieces = [piece("a1", null, null), piece("a2", "e1", null), piece("a3", null, "m1"), piece("a4", null, "m1")];

  it("une pièce jointe à un envoi OU à une réponse reste dans l'échange", () => {
    expect(pieces.map(isExchangePiece)).toEqual([false, true, true, true]);
    // Colonne absente d'une lecture ancienne : pas une pièce d'échange.
    expect(isExchangePiece({ email_id: null } as never)).toBe(false);
  });

  it("regroupées par envoi ou par message", () => {
    const map = piecesByExchange(pieces);
    expect(map.get("e1")?.map((p) => p.id)).toEqual(["a2"]);
    expect(map.get("m1")?.map((p) => p.id)).toEqual(["a3", "a4"]);
    expect(map.size).toBe(2);
  });
});
