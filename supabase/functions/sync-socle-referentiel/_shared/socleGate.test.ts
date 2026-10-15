import { describe, expect, it } from "vitest";

import { createSocleGate, platformRetryAfterMs } from "./socleGate.ts";

/** Horloge virtuelle : `sleep` avance le temps au lieu d'attendre. */
function virtualClock() {
  let t = 0;
  const departures: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    departures,
    stamp() { departures.push(t); },
  };
}

const ok = () => new Response("[]", { status: 200 });

describe("platformRetryAfterMs", () => {
  it("lit le délai du message de la plateforme, plafonné, avec une marge", () => {
    const err = new Error("Rate limit exceeded for trace abc. Retry after 39116ms.");
    expect(platformRetryAfterMs(err, 60_000)).toBe(39_616);
    expect(platformRetryAfterMs(err, 10_000)).toBe(10_000);
  });

  it("préfère retryAfterMs quand l'erreur le porte", () => {
    const err = Object.assign(new Error("Rate limit exceeded"), { retryAfterMs: 1000 });
    expect(platformRetryAfterMs(err, 60_000)).toBe(1500);
  });

  it("une autre erreur n'est pas un plafond", () => {
    expect(platformRetryAfterMs(new Error("network down"), 60_000)).toBeNull();
  });
});

describe("createSocleGate", () => {
  it("espace les départs, même lancés en parallèle", async () => {
    const clock = virtualClock();
    const gate = createSocleGate({
      spacingMs: 250, maxRetries: 2, maxWaitMs: 60_000, now: clock.now, sleep: clock.sleep,
      fetchImpl: (async () => { clock.stamp(); return ok(); }) as typeof fetch,
    });
    await Promise.all([gate("u", {}), gate("u", {}), gate("u", {}), gate("u", {})]);
    expect(clock.departures).toEqual([0, 250, 500, 750]);
  });

  it("sur un plafond de la plateforme, attend le délai indiqué puis réessaie — et les suivants aussi", async () => {
    const clock = virtualClock();
    let calls = 0;
    const gate = createSocleGate({
      spacingMs: 250, maxRetries: 2, maxWaitMs: 60_000, now: clock.now, sleep: clock.sleep,
      fetchImpl: (async () => {
        clock.stamp();
        calls++;
        if (calls === 1) throw new Error("Rate limit exceeded for trace x. Retry after 1000ms.");
        return ok();
      }) as typeof fetch,
    });
    const [a, b] = await Promise.all([gate("u", {}), gate("u", {})]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // 0 : plafond. Le second appel, déjà parti à 250 (la pause n'était pas
    // encore connue), aboutit ; le plafond, constaté à 250, pose une pause de
    // 1 500 ms que son départ n'écourte pas : la reprise part à 1 750.
    expect(clock.departures).toEqual([0, 250, 1750]);
  });

  it("un 429 du Socle suit Retry-After", async () => {
    const clock = virtualClock();
    let calls = 0;
    const gate = createSocleGate({
      spacingMs: 0, maxRetries: 1, maxWaitMs: 60_000, now: clock.now, sleep: clock.sleep,
      fetchImpl: (async () => {
        clock.stamp();
        calls++;
        return calls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : ok();
      }) as typeof fetch,
    });
    expect((await gate("u", {})).status).toBe(200);
    expect(clock.departures).toEqual([0, 2500]);
  });

  it("au-delà des reprises permises, l'erreur remonte", async () => {
    const clock = virtualClock();
    const gate = createSocleGate({
      spacingMs: 0, maxRetries: 1, maxWaitMs: 60_000, now: clock.now, sleep: clock.sleep,
      fetchImpl: (async () => { throw new Error("Rate limit exceeded. Retry after 10ms"); }) as typeof fetch,
    });
    await expect(gate("u", {})).rejects.toThrow(/Rate limit/);
  });
});
