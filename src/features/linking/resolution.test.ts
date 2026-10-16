import { describe, expect, it } from "vitest";
import {
  memberNotes, notifiableCount, propagatesToGroup, resolutionSummary, resolvableMembers,
  type LinkedResolutionResult,
} from "./resolution";
import type { GroupMember } from "./useLinking";

function member(over: Partial<GroupMember> = {}): GroupMember {
  return {
    id: "m", reference: "DEM-2026-000002", subject: "Nid-de-poule", status: "en_instruction",
    procedureLabel: "Signalement voirie", organisme: "Voirie", receivedAt: "2026-10-14T09:00:00Z",
    source: "iris", assignedTo: "u-autre", ...over,
  };
}

describe("propagatesToGroup", () => {
  it("seule une résolution se propage", () => {
    expect(propagatesToGroup("resolue_positive")).toBe(true);
    expect(propagatesToGroup("resolue_negative")).toBe(true);
    expect(propagatesToGroup("annulee")).toBe(false);
    expect(propagatesToGroup("en_attente")).toBe(false);
  });
});

describe("resolvableMembers", () => {
  it("écarte la demande résolue elle-même et les demandes déjà closes", () => {
    const list = [
      member({ id: "source" }), member({ id: "ouverte" }), member({ id: "close", status: "resolue_negative" }),
      member({ id: "attente", status: "en_attente" }),
    ];
    expect(resolvableMembers(list, "source").map((m) => m.id)).toEqual(["ouverte", "attente"]);
  });
});

describe("memberNotes — ce qui se passera, dit AVANT de confirmer", () => {
  it("une demande à traiter sans instructeur : instruction faite par le serveur, et vous l'instruisez", () => {
    expect(memberNotes(member({ status: "a_traiter", assignedTo: null }))).toEqual([
      "à traiter : mise en instruction puis résolue", "vous en deviendrez l'instructeur",
    ]);
  });

  it("une demande en instruction déjà affectée : rien de plus à dire", () => {
    expect(memberNotes(member())).toEqual([]);
  });

  it("une demande issue de Clara ne reçoit aucun avis", () => {
    expect(memberNotes(member({ source: "clara", status: "en_attente" }))).toEqual([
      "en attente : remise en instruction puis résolue", "issue de Clara : aucun avis",
    ]);
  });
});

describe("notifiableCount", () => {
  it("ne compte que les demandes cochées qui recevront un avis", () => {
    const list = [member({ id: "a" }), member({ id: "b", source: "clara" }), member({ id: "c" })];
    expect(notifiableCount(list, new Set(["a", "b"]))).toBe(1);
  });
});

describe("resolutionSummary — un résultat partiel honnête", () => {
  const ok = (id: string): LinkedResolutionResult =>
    ({ request_id: id, reference: id.toUpperCase(), ok: true, error: null, took_over: false, chained: false });

  it("tout passe", () => {
    const s = resolutionSummary([ok("a"), ok("b")]);
    expect(s.headline).toBe("2 demandes liées résolues avec elle");
    expect(s.failures).toBeNull();
    expect(s.okIds).toEqual(["a", "b"]);
  });

  it("une partie seulement : le chiffre, et le motif de chaque refus", () => {
    const s = resolutionSummary([
      ok("a"),
      { request_id: "b", reference: "DEM-B", ok: false, error: "Résolution positive : pièce(s) obligatoire(s) à qualifier", took_over: false, chained: false },
    ]);
    expect(s.headline).toBe("1 demande liée résolue sur 2");
    expect(s.failures).toBe("Non résolue : DEM-B — Résolution positive : pièce(s) obligatoire(s) à qualifier");
  });
});
