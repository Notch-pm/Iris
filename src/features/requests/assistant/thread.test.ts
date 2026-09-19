import { describe, expect, it } from "vitest";
import {
  appendAssistant,
  appendError,
  appendProposal,
  appendUser,
  approvalText,
  canSend,
  emptyThread,
  expireOpenProposals,
  isFresh,
  MAX_TURNS,
  mergeConsulted,
  openProposal,
  readingAnchor,
  resolveProposal,
  trimForSend,
} from "./thread";
import type { SourceRef } from "@fn/_shared/ai/sources/catalogue";

describe("construction du fil", () => {
  it("empile les tours avec des identifiants stables", () => {
    let t = emptyThread();
    t = appendUser(t, "q1");
    t = appendAssistant(t, "r1");
    expect(t.messages.map((m) => [m.id, m.role, m.content]))
      .toEqual([[1, "user", "q1"], [2, "assistant", "r1"]]);
  });

  it("sait si le fil est neuf", () => {
    expect(isFresh(emptyThread())).toBe(true);
    expect(isFresh(appendUser(emptyThread(), "q"))).toBe(false);
  });
});

describe("trimForSend", () => {
  it("ajoute toujours la question en cours à la fin", () => {
    const sent = trimForSend(emptyThread(), "  Quelles pièces ?  ");
    expect(sent).toEqual([{ role: "user", content: "Quelles pièces ?" }]);
  });

  it("renvoie les paires question/réponse", () => {
    let t = emptyThread();
    t = appendUser(t, "q1");
    t = appendAssistant(t, "r1");
    expect(trimForSend(t, "q2")).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "r1" },
      { role: "user", content: "q2" },
    ]);
  });

  // ⚠️ LE test du module. Sans cela le modèle relit « Le plafond est atteint »
  // comme sa propre réponse et enchaîne dessus.
  it("ne renvoie JAMAIS un tour en erreur", () => {
    let t = emptyThread();
    t = appendUser(t, "q1");
    t = appendError(t, "Le plafond d'utilisation de l'assistant IA est atteint.");
    const sent = trimForSend(t, "q2");
    expect(JSON.stringify(sent)).not.toContain("plafond");
    expect(sent.some((m) => m.role === "assistant")).toBe(false);
  });

  it("écarte une question restée sans réponse, mais garde celle qu'on pose", () => {
    let t = emptyThread();
    t = appendUser(t, "question ratée");
    t = appendError(t, "indisponible");
    t = appendUser(t, "question ok");
    t = appendAssistant(t, "réponse ok");
    const sent = trimForSend(t, "nouvelle question");
    expect(sent).toEqual([
      { role: "user", content: "question ok" },
      { role: "assistant", content: "réponse ok" },
      { role: "user", content: "nouvelle question" },
    ]);
  });

  it("garde les tours les plus récents au-delà de la borne", () => {
    let t = emptyThread();
    for (let i = 0; i < 20; i++) {
      t = appendUser(t, `q${i}`);
      t = appendAssistant(t, `r${i}`);
    }
    const sent = trimForSend(t, "derniere");
    expect(sent).toHaveLength(MAX_TURNS);
    expect(sent[sent.length - 1].content).toBe("derniere");
    expect(JSON.stringify(sent)).not.toContain("\"q0\"");
  });

  it("un fil entièrement en erreur ne renvoie que la question", () => {
    let t = emptyThread();
    t = appendUser(t, "q1");
    t = appendError(t, "e1");
    t = appendUser(t, "q2");
    t = appendError(t, "e2");
    expect(trimForSend(t, "q3")).toEqual([{ role: "user", content: "q3" }]);
  });
});

describe("canSend", () => {
  it("ferme le bouton sur un brouillon vide ou pendant un envoi", () => {
    expect(canSend("", false)).toBe(false);
    expect(canSend("   ", false)).toBe(false);
    expect(canSend("q", true)).toBe(false);
    expect(canSend("q", false)).toBe(true);
  });
});

// 2026-09-19 — la carte « l'assistant propose de consulter ces sources ».
const page: SourceRef = { id: "s-aaa", kind: "page", origin: "demarche", label: "Règlement", url: "https://www.arles.fr/r" };
const doc: SourceRef = { id: "s-bbb", kind: "document", origin: "demarche", label: "Guide.pdf" };
const reco: SourceRef = { id: "s-ccc", kind: "page", origin: "collectivite", label: "Légifrance" };

describe("propositions de consultation", () => {
  // ⚠️ Le pendant de « jamais un tour en erreur » : une carte n'est pas un tour.
  it("une carte de proposition n'est JAMAIS renvoyée au serveur", () => {
    let t = emptyThread();
    t = appendUser(t, "q1");
    t = appendAssistant(t, "r1");
    t = appendProposal(t, [page, doc]);
    const sent = trimForSend(t, approvalText([page, doc]));
    expect(sent).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "r1" },
      { role: "user", content: "Oui, consulte « Règlement » et « Guide.pdf »." },
    ]);
    expect(JSON.stringify(sent)).not.toContain("s-aaa");
  });

  it("sans source, aucune carte", () => {
    expect(appendProposal(emptyThread(), [])).toEqual(emptyThread());
  });

  it("seule une proposition ouverte se résout", () => {
    let t = appendProposal(emptyThread(), [page]);
    const id = t.messages[0].id;
    expect(openProposal(t, id)?.sources).toEqual([page]);
    t = resolveProposal(t, id, "accepted");
    expect(t.messages[0].proposal?.status).toBe("accepted");
    expect(openProposal(t, id)).toBeNull();
    // Une carte déjà close ne rouvre pas, ne change pas de verdict.
    expect(resolveProposal(t, id, "declined").messages[0].proposal?.status).toBe("accepted");
  });

  it("une nouvelle question fait expirer les propositions ouvertes, et elles seules", () => {
    let t = appendProposal(emptyThread(), [page]);
    t = resolveProposal(t, t.messages[0].id, "declined");
    t = appendProposal(t, [doc]);
    t = expireOpenProposals(t);
    expect(t.messages.map((m) => m.proposal?.status)).toEqual(["declined", "expired"]);
  });

  it("approvalText nomme une, deux ou trois sources", () => {
    expect(approvalText([page])).toBe("Oui, consulte « Règlement ».");
    expect(approvalText([page, doc, reco])).toBe("Oui, consulte « Règlement », « Guide.pdf » et « Légifrance ».");
  });

  it("mergeConsulted dédoublonne et, au-delà du plafond, fait céder les plus anciennes", () => {
    expect(mergeConsulted([page], [page, doc]).map((s) => s.id)).toEqual(["s-aaa", "s-bbb"]);
    const many = ["s-1", "s-2", "s-3"].map((id) => ({ ...page, id }));
    const merged = mergeConsulted(many, [doc, reco]);
    expect(merged).toHaveLength(4);
    expect(merged.map((s) => s.id)).toEqual(["s-2", "s-3", "s-bbb", "s-ccc"]);
  });

  it("readingAnchor : la réponse, même suivie d'une carte ; rien après une question", () => {
    let t = appendUser(emptyThread(), "q");
    expect(readingAnchor(t)).toBeNull();
    t = appendAssistant(t, "r");
    const answerId = t.messages[1].id;
    expect(readingAnchor(t)).toBe(answerId);
    t = appendProposal(t, [page]);
    expect(readingAnchor(t)).toBe(answerId);
    t = appendError(t, "e");
    expect(readingAnchor(t)).toBeNull();
  });
});
