/**
 * Deadlines for the Quran content sources.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * The prayer-times providers all reach the network through one hardened
 * helper (`src/utils/fetchWithRetry.ts`): timeout, retry policy, jittered
 * backoff, `Retry-After`, circuit breaker. The Quran content sources —
 * recitation MP3s, word timings, page fonts, tafsir, reader-supplied
 * riwayah datasets — grew up separately and never adopted it. Each one
 * hand-rolled its own retry loop, or none at all, and between them they
 * left every request without a deadline.
 *
 * That is worse than it sounds, because of how the transport is chosen.
 * The audio and font stores condemn `ReactNativeBlobUtil`'s streaming
 * downloader for the rest of the session on its first failure and fall
 * back to RN's own `fetch` — and the fallback was the one path with no
 * timeout at all. So the very networks that break the streaming transport
 * (a captive portal, a corporate proxy, a connection that is accepted and
 * then stalls) are exactly the networks that routed every subsequent
 * request onto a promise that can never settle. A reader on hotel wifi
 * got a spinner with no end and no error.
 *
 * Two rules follow, and this file holds both so a sixth content source
 * cannot quietly invent a third answer:
 *
 *   1. Every request has a deadline, named here rather than spelled as a
 *      number at the call site.
 *   2. A deadline is not a retry. These sources already carry their own
 *      attempt loops; adding `fetchWithRetry`'s would multiply them (three
 *      attempts becoming twelve) and turn one stalled ayah into four
 *      minutes. `fetchContentOnce` therefore fixes `maxAttempts: 1` and
 *      leaves the retrying to the caller that already does it.
 *
 * `__tests__/quranContentDeadlines.test.ts` fails if a file under
 * `src/quran/` calls `fetch(` or a blob-util `.fetch('GET', …)` without
 * going through one of these.
 */
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * How long each kind of content may take before it is a failure.
 *
 * Sized by what is on the wire and who is waiting, not by one blanket
 * number: a reader watching an ayah action sheet should be told the
 * tafsir is unavailable in a few seconds, while a 1.4 MB timings file on
 * a slow connection deserves a minute before anyone gives up on it.
 */
export const CONTENT_DEADLINES = {
  /** One ayah's MP3 — tens of kilobytes. Matches the streaming watchdog it stands in for. */
  ayahAudio: 60_000,
  /**
   * The gapless prefetch, which runs ahead of the listener and is pure
   * optimisation. It gives up sooner than a download someone asked for:
   * a prefetch still in flight when the ayah arrives has already lost.
   */
  ayahPrefetch: 30_000,
  /** A reciter's word-timing JSON — ~1.4 MB. */
  timings: 60_000,
  /** One page font — ~300 KB. */
  pageFont: 60_000,
  /**
   * Tafsir for one ayah — a few kilobytes, fetched while the reader looks
   * at an open sheet. Best-effort by design: it must fail fast and quietly
   * rather than hold the sheet.
   */
  tafsir: 8_000,
  /** A riwayah dataset from a link someone pasted; up to 48 MB. */
  riwayah: 30_000,
} as const;

export type ContentDeadline = keyof typeof CONTENT_DEADLINES;

/**
 * One attempt, with a deadline. No retry, on purpose — see rule 2 above.
 *
 * Delegates to `fetchWithRetry` rather than building a second
 * `AbortController` dance, so there is exactly one implementation of "a
 * fetch that cannot hang" in the app, and a caller's own `signal` is
 * still composed with the timeout.
 */
export function fetchContentOnce(
  input: RequestInfo,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  return fetchWithRetry(input, init, { maxAttempts: 1, timeoutMs });
}

/** A `ReactNativeBlobUtil` download task: a promise that can be cancelled. */
type CancellableTask<T> = Promise<T> & {
  cancel?: (callback: () => void) => void;
};

/**
 * Put a deadline on a `ReactNativeBlobUtil` download.
 *
 * The library's own `timeout` config cannot be used: on Android it makes
 * every download fail instantly with "Download interrupted" (learned by
 * the font store, then by the audio store, and noted at both call sites).
 * So the deadline is a race in JS, and the loser is cancelled so the
 * native side stops holding the socket.
 *
 * Extracted from the three copies the audio store had grown, and given to
 * the two streaming downloads — the fonts and the reciter timings — that
 * never had one at all.
 */
export async function withDownloadDeadline<T>(
  task: CancellableTask<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => {
          try {
            task.cancel?.(() => undefined);
          } catch {
            // A task that is already settled has nothing to cancel, and
            // the rejection below is the answer either way.
          }
          reject(new Error(`${label}: timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (watchdog != null) clearTimeout(watchdog);
  }
}
