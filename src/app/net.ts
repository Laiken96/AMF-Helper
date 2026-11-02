// Zeitlimits für Abrufe. AbortSignal.timeout gibt es ab iOS Safari 16, AbortSignal.any erst ab 17.4,
// darum für beide ein eigener Ersatz.

/** Zeitlimit für Dateien unter data/. */
export const DATA_TIMEOUT_MS = 15_000;
/** Zeitlimit für Live Abrufe bei ESPN. */
export const LIVE_TIMEOUT_MS = 10_000;

interface SignalApi {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
}

/**
 * Signal, das nach ms abbricht und zusätzlich, wenn outer abbricht. api nur für Tests, um den Ersatz
 * ohne native Funktionen zu prüfen.
 */
export function timeoutSignal(ms: number, outer?: AbortSignal | null, api: SignalApi = AbortSignal as SignalApi): AbortSignal {
  const timeout =
    typeof api.timeout === "function" ? api.timeout.call(AbortSignal, ms) : fallbackTimeout(ms);
  if (!outer) return timeout;
  if (typeof api.any === "function") return api.any.call(AbortSignal, [outer, timeout]);
  return fallbackAny([outer, timeout]);
}

function fallbackTimeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(timeoutError()), ms);
  return ctrl.signal;
}

function fallbackAny(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
  }
  const onAbort = (e: Event) => {
    ctrl.abort((e.target as AbortSignal).reason);
    for (const s of signals) s.removeEventListener("abort", onAbort);
  };
  for (const s of signals) s.addEventListener("abort", onAbort);
  return ctrl.signal;
}

function timeoutError(): Error {
  try {
    return new DOMException("Zeitüberschreitung", "TimeoutError");
  } catch {
    const err = new Error("Zeitüberschreitung");
    err.name = "TimeoutError";
    return err;
  }
}

/** Abbruch wegen Zeitlimit, nicht wegen Aufräumen. */
export const isTimeout = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError";
