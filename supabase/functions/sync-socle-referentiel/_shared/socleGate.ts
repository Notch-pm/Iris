// Point de passage UNIQUE vers le Socle pendant une synchronisation : cadence
// les appels et encaisse les plafonds. Logique pure (fetch et horloge
// injectés), testée par vitest — aucune dépendance Deno.
//
// Pourquoi : la plateforme Supabase plafonne les appels d'une edge function
// vers d'autres edge functions PAR EXÉCUTION (« Rate limit exceeded for trace
// … Retry after N ms »). Une synchronisation enchaîne tous les tenants dans la
// même exécution : le 2026-10-15 à 04:00, 27 appels en rafale ont suffi à
// épuiser le budget — serveur d'envoi non relu pour les six tenants,
// activations pour trois. Décaler les crons n'y change rien (le budget n'est
// pas partagé entre exécutions) ; c'est la cadence DANS l'exécution qui compte.
// Même remède que la synchronisation de Clara (`socleFetch`), en file
// d'attente : des appels lancés en parallèle partent l'un après l'autre.

export interface SocleGateOptions {
  /** Écart minimal entre deux départs. */
  spacingMs: number;
  /** Plafonds encaissés par appel avant d'abandonner. */
  maxRetries: number;
  /** Attente maximale sur un plafond (au-delà, on attend ce maximum). */
  maxWaitMs: number;
  /** Délai d'expiration d'un appel, armé au DÉPART (jamais pendant l'attente). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Délai indiqué par un plafond de la plateforme (`retryAfterMs` ou « Retry after N ms »), sinon null. */
export function platformRetryAfterMs(err: unknown, maxWaitMs: number): number | null {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const property = (err as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  const isRateLimit = typeof property === "number" || /rate limit exceeded/i.test(message);
  if (!isRateLimit) return null;
  const match = message.match(/retry after (\d+)\s*ms/i);
  const hinted = typeof property === "number" ? property : match ? Number(match[1]) : NaN;
  if (!Number.isFinite(hinted) || hinted <= 0) return maxWaitMs;
  return Math.min(hinted + 500, maxWaitMs);
}

export function createSocleGate(options: SocleGateOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  let notBefore = 0;
  let queue: Promise<void> = Promise.resolve();

  /** Réserve le prochain créneau de départ ; les appelants passent un par un. */
  function slot(): Promise<void> {
    const turn = queue.then(async () => {
      const wait = notBefore - now();
      if (wait > 0) await sleep(wait);
      // Jamais en deçà d'une pause déjà posée par un plafond.
      notBefore = Math.max(notBefore, now() + options.spacingMs);
    });
    queue = turn.catch(() => {});
    return turn;
  }

  return async function socleFetch(url: string, headers: Record<string, string>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await slot();
      try {
        const response = await fetchImpl(url, {
          headers,
          ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
        });
        if (response.status === 429 && attempt < options.maxRetries) {
          const seconds = Number(response.headers.get("Retry-After"));
          const hinted = Number.isFinite(seconds) && seconds > 0
            ? Math.min(seconds * 1000 + 500, options.maxWaitMs)
            : options.maxWaitMs;
          await response.body?.cancel();
          notBefore = Math.max(notBefore, now() + hinted);
          continue;
        }
        return response;
      } catch (err) {
        const hinted = platformRetryAfterMs(err, options.maxWaitMs);
        if (hinted === null || attempt >= options.maxRetries) throw err;
        // Pause PARTAGÉE : tous les appels suivants l'attendent aussi.
        notBefore = Math.max(notBefore, now() + hinted);
      }
    }
  };
}
