import { describe, expect, it } from "vitest";
import { planReconciliation } from "./plan";

const NOW = new Date("2026-09-08T12:00:00Z");
const old = "2026-09-08T09:00:00Z";
const fresh = "2026-09-08T11:50:00Z";

describe("planReconciliation", () => {
  it("un objet connu d'une ligne — pièce ou attente — n'est jamais un orphelin", () => {
    const plan = planReconciliation({
      now: NOW,
      objects: [{ name: "o/r/a.pdf", createdAt: old }, { name: "o/_staging/u1", createdAt: old }],
      known: [{ path: "o/r/a.pdf", source: "attachment" }, { path: "o/_staging/u1", source: "upload" }],
    });
    expect(plan).toEqual({ orphans: [], missing: [], deferred: 0 });
  });

  it("un objet sans ligne part à l'outbox, mais seulement passé le délai de grâce", () => {
    const plan = planReconciliation({
      now: NOW,
      objects: [{ name: "o/r/vieux.pdf", createdAt: old }, { name: "o/r/neuf.pdf", createdAt: fresh }],
      known: [],
    });
    expect(plan.orphans).toEqual(["o/r/vieux.pdf"]);
    expect(plan.deferred).toBe(1);
  });

  it("une pièce sans objet est signalée ; une ligne d'attente sans objet ne l'est pas (la purge s'en charge)", () => {
    const plan = planReconciliation({
      now: NOW,
      objects: [],
      known: [
        { path: "o/r/perdu.pdf", source: "attachment" },
        { path: "o/r/perdu.pdf", source: "attachment" },
        { path: "o/_staging/u9", source: "upload" },
      ],
    });
    expect(plan.missing).toEqual(["o/r/perdu.pdf"]);
    expect(plan.orphans).toEqual([]);
  });

  it("un objet à la date illisible n'est jamais déclaré orphelin", () => {
    const plan = planReconciliation({
      now: NOW,
      objects: [{ name: "o/r/x.pdf", createdAt: "n'importe quoi" }],
      known: [],
    });
    expect(plan.orphans).toEqual([]);
    expect(plan.deferred).toBe(1);
  });
});
