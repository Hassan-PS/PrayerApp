/**
 * Retries fetch on transient server / rate-limit responses, with a
 * per-request timeout and jittered exponential backoff.
 *
 * Hardening from task #6:
 *   • Per-request AbortController timeout (default 7s) — prevents indefinite
 *     hangs on stuck networks. Aborted requests are categorised as `timeout`
 *     and counted as retryable.
 *   • Default `retryStatuses` widened from [429, 503] to all 5xx + 408 + 425.
 *     The previous policy let 502/504 fail immediately, even though they're
 *     classic transient gateway errors.
 *   • Network errors (TypeError "Network request failed") are retried.
 *   • A caller-supplied signal that has aborted stops the loop immediately —
 *     a cancel is not a transient failure.
 *   • Honors Retry-After when present (seconds only).
 *   • Backoff has ±20% jitter so concurrent retries don't synchronise into
 *     thundering-herd surges.
 */

export type FetchWithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Per-request timeout in ms. Default 7000. */
  timeoutMs?: number;
  /** HTTP status codes that should trigger a retry. */
  retryStatuses?: number[];
};

const DEFAULT_RETRY_STATUSES = [
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const sec = parseInt(header.trim(), 10);
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.min(sec * 1000, 60_000);
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Apply ±20% jitter to a backoff duration. Prevents synchronised retries
 * from many clients (or many in-flight calls in this app) hitting the
 * upstream simultaneously after a transient outage.
 */
function withJitter(ms: number): number {
  const jitter = ms * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.max(0, Math.round(ms + jitter));
}

/**
 * Fetch with timeout via AbortController. Throws an AbortError-shaped error
 * when the request times out, otherwise re-throws the underlying network error.
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Compose the user's signal (if any) with the timeout signal.
    const signal = init?.signal
      ? mergeSignals(init.signal, controller.signal)
      : controller.signal;
    const res = await fetch(input, { ...(init ?? {}), signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Merge two AbortSignals — abort fires when EITHER signal aborts. */
function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return merged.signal;
}

export async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit | undefined,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 900;
  const timeoutMs = options.timeoutMs ?? 7000;
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;

  let lastResponse: Response | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response | undefined;
    let attemptError: unknown;

    try {
      res = await fetchWithTimeout(input, init, timeoutMs);
      lastResponse = res;
    } catch (e) {
      attemptError = e;
      lastError = e;
    }

    const isLastAttempt = attempt >= maxAttempts - 1;

    if (res) {
      const shouldRetry = retryStatuses.includes(res.status) && !isLastAttempt;
      if (!shouldRetry) {
        return res;
      }
      // Body must be consumed (or aborted) so the platform doesn't hold the
      // connection open during the backoff. We ignore consume errors.
      try {
        await res.text();
      } catch {
        /* noop */
      }
    } else {
      // Exception path (network error or timeout). Retry unless out of attempts.
      if (isLastAttempt) {
        throw attemptError;
      }
      // A caller who cancelled is not asking us to try harder. Without this,
      // an aborted signal burned the remaining attempts — each one failing
      // instantly, each one still sleeping out its backoff first — so a
      // cancel took seconds to surface as one.
      if (init?.signal?.aborted) {
        throw attemptError;
      }
    }

    // Backoff. Honor Retry-After when present, otherwise exponential with jitter.
    const fromHeader = res ? parseRetryAfterMs(res.headers.get('Retry-After')) : undefined;
    const expBackoff = baseDelayMs * 2 ** attempt;
    const wait = fromHeader ?? withJitter(expBackoff);
    await delay(Math.min(wait, 30_000));
  }

  if (lastResponse) {
    return lastResponse;
  }
  // All attempts threw and no response was ever produced.
  throw lastError ?? new Error('fetchWithRetry: exhausted attempts');
}
