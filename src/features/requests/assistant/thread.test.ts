import { describe, expect, it } from "vitest";
import {
  appendAssistant,
  appendError,
  appendUser,
  canSend,
  emptyThread,
  isFresh,
  MAX_TURNS,
  trimForSend,
} from "./thread";

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
