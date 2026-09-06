/**
 * Every Qur'an content fetch has a deadline.
 *
 * The prayer-times providers were hardened long ago — one helper, one
 * retry policy, a circuit breaker, tests. The content sources were not,
 * and the gap had a nasty shape: the audio and font stores condemn
 * `ReactNativeBlobUtil`'s streaming downloader for the rest of the
 * session on its first failure and fall back to RN's own `fetch` — and
 * the fallback was the one path with no timeout at all. So the networks
 * that break the streaming transport are precisely the networks that
 * routed every later request onto a promise that could never settle.
 * Two of the streaming downloads (the page fonts, the reciter timings)
 * had no watchdog either.
 *
 * These tests hold the fix in place: the source scan below fails if a new
 * content source is added without a deadline, and the behavioural tests
 * check that each deadline actually fires and that a deadline is never
 * silently turned into a second retry loop.
 */
import fs from 'fs';
import path from 'path';
import {
  CONTENT_DEADLINES,
  fetchContentOnce,
  withDownloadDeadline,
} from '../src/quran/contentNetwork';
import { fetchWithRetry } from '../src/utils/fetchWithRetry';
import { loadTafsir } from '../src/quran/tafsir';
import { installRiwayahFromUrl } from '../src/quran/riwayahDownload';

// ─── the source invariant ───────────────────────────────────────────────

const QURAN_DIR = path.join(__dirname, '..', 'src', 'quran');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Comments talk ABOUT fetch a great deal in this codebase; only code counts. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const QURAN_SOURCES = walk(QURAN_DIR).map(file => ({
  file: path.relative(path.join(__dirname, '..'), file),
  code: stripComments(fs.readFileSync(file, 'utf8')),
}));

describe('no Quran content source may reach the network without a deadline', () => {
  it('scans a plausible number of files (the walk itself still works)', () => {
    expect(QURAN_SOURCES.length).toBeGreaterThan(40);
  });

  // `fetch(` on its own — not `.fetch(`, not `fetchWithRetry(`, not
  // `fetchContentOnce(`. A bare global fetch has no timeout, and RN's
  // implementation will wait for a stalled socket indefinitely.
  it('calls no bare global fetch()', () => {
    const offenders = QURAN_SOURCES.filter(s =>
      /(?<![.\w$])fetch\s*\(/.test(s.code),
    ).map(s => s.file);
    expect(offenders).toEqual([]);
  });

  // The streaming downloader cannot take a `timeout` in its config — on
  // Android that makes every download fail instantly with "Download
  // interrupted" — so the deadline has to be the JS race in
  // `withDownloadDeadline`. Every one of these must be wrapped.
  it('wraps every blob-util download in withDownloadDeadline', () => {
    const offenders: string[] = [];
    for (const { file, code } of QURAN_SOURCES) {
      const pattern = /\.fetch\(\s*['"]GET['"]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const before = code.slice(Math.max(0, match.index - 300), match.index);
        if (!before.includes('withDownloadDeadline(')) {
          offenders.push(`${file}@${match.index}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every deadline a sane length', () => {
    for (const [name, ms] of Object.entries(CONTENT_DEADLINES)) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(`${name}:${ms}`).toBe(`${name}:${ms}`);
      expect(ms).toBeGreaterThanOrEqual(1_000);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });

  it('lets the reader-facing tafsir give up sooner than a bulk download', () => {
    expect(CONTENT_DEADLINES.tafsir).toBeLessThan(CONTENT_DEADLINES.timings);
    expect(CONTENT_DEADLINES.ayahPrefetch).toBeLessThan(
      CONTENT_DEADLINES.ayahAudio,
    );
  });
});

// ─── withDownloadDeadline ───────────────────────────────────────────────

describe('withDownloadDeadline', () => {
  it('returns the download when it beats the clock', async () => {
    const cancel = jest.fn();
    const task = Object.assign(Promise.resolve('landed'), { cancel });
    await expect(withDownloadDeadline(task, 5_000, 'font 1')).resolves.toBe(
      'landed',
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects, and cancels the native task, when the download stalls', async () => {
    const cancel = jest.fn();
    // A task that never settles — exactly what a stalled socket produces.
    const task = Object.assign(new Promise<string>(() => {}), { cancel });
    await expect(withDownloadDeadline(task, 20, 'font 1')).rejects.toThrow(
      /font 1: timed out after 20ms/,
    );
    // Cancelled, so the native side stops holding the socket open.
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('clears its watchdog on success (no timer left running)', async () => {
    jest.useFakeTimers();
    try {
      const task = Object.assign(Promise.resolve(1), { cancel: jest.fn() });
      await withDownloadDeadline(task, 60_000, 'timings');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // The jest blob-util mock returns a plain promise, and so does any task
  // that has already settled. A missing `cancel` must not become a crash
  // on the timeout path.
  it('survives a task with no cancel()', async () => {
    const task = new Promise<string>(() => {}) as Promise<string> & {
      cancel?: (cb: () => void) => void;
    };
    await expect(withDownloadDeadline(task, 20, 'ayah')).rejects.toThrow(
      /timed out/,
    );
  });
});

// ─── fetchContentOnce ───────────────────────────────────────────────────

describe('fetchContentOnce', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('aborts a stalled request at the deadline', async () => {
    let seen: AbortSignal | undefined;
    global.fetch = jest.fn(async (_input: RequestInfo, init?: RequestInit) => {
      seen = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err: Error & { name: string } = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    await expect(
      fetchContentOnce('https://example.test/x', undefined, 30),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });

  // The whole point of the "once" in the name. These callers already have
  // their own attempt loops; nesting `fetchWithRetry`'s would turn three
  // attempts into twelve and one stalled ayah into four minutes.
  it('does not retry — that is the caller’s job', async () => {
    const calls = jest.fn(async () => new Response('', { status: 503 }));
    global.fetch = calls as unknown as typeof fetch;
    const res = await fetchContentOnce(
      'https://example.test/y',
      undefined,
      500,
    );
    expect(res.status).toBe(503);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

// ─── a cancel is not a transient failure ────────────────────────────────

describe('fetchWithRetry: an aborted caller signal', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('stops at once instead of burning the remaining attempts', async () => {
    const calls = jest.fn(async () => {
      const err: Error & { name: string } = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    global.fetch = calls as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    const started = Date.now();
    await expect(
      fetchWithRetry(
        'https://example.test/z',
        { signal: controller.signal },
        // Four attempts and a five-second backoff: if the cancel were
        // treated as a transient failure this would sleep for 35 seconds.
        { maxAttempts: 4, baseDelayMs: 5_000, timeoutMs: 1_000 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// ─── tafsir ─────────────────────────────────────────────────────────────

describe('tafsir', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('retries a transient 502 once, then answers', async () => {
    let n = 0;
    const calls = jest.fn(async () => {
      n += 1;
      return n === 1
        ? new Response('', { status: 502 })
        : new Response(JSON.stringify({ text: 'the commentary' }), {
            status: 200,
          });
    });
    global.fetch = calls as unknown as typeof fetch;
    await expect(loadTafsir('en-tafisr-ibn-kathir', 2, 255)).resolves.toBe(
      'the commentary',
    );
    expect(calls).toHaveBeenCalledTimes(2);
  });

  // Two, not four. A reader is looking at an open sheet; "unavailable"
  // arriving late is worse than "unavailable" arriving.
  it('gives up after two attempts', async () => {
    const calls = jest.fn(async () => new Response('', { status: 503 }));
    global.fetch = calls as unknown as typeof fetch;
    await expect(loadTafsir('en-tafisr-ibn-kathir', 3, 7)).resolves.toBeNull();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('answers null when the origin stalls, instead of hanging the sheet', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      async (_input: RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err: Error & { name: string } = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const answer = loadTafsir('en-tafisr-ibn-kathir', 4, 9);
    // Both attempts' deadlines, plus the backoff between them.
    await jest.advanceTimersByTimeAsync(CONTENT_DEADLINES.tafsir);
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(CONTENT_DEADLINES.tafsir);
    await expect(answer).resolves.toBeNull();
  });
});

// ─── riwayah installs ───────────────────────────────────────────────────

describe('installRiwayahFromUrl', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('calls a stalled host unreachable, not cancelled', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      async (_input: RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err: Error & { name: string } = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const result = installRiwayahFromUrl(
      'warsh',
      'https://example.test/warsh.json',
    );
    // Every attempt's deadline, and the backoffs between them.
    for (let i = 0; i < 6; i++) {
      await jest.advanceTimersByTimeAsync(CONTENT_DEADLINES.riwayah);
    }
    const settled = await result;
    expect(settled.ok).toBe(false);
    // The distinction this test exists for: a timeout aborts too, so the
    // error's name alone can no longer tell these apart. Telling someone
    // they cancelled something they were waiting on is its own small lie.
    expect(settled.ok === false && settled.error.key).toBe(
      'quran.riwayahUnreachable',
    );
  });

  it('calls a reader’s cancel a cancel', async () => {
    global.fetch = jest.fn(async () => {
      const err: Error & { name: string } = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();
    const settled = await installRiwayahFromUrl(
      'warsh',
      'https://example.test/warsh.json',
      controller.signal,
    );
    expect(settled.ok).toBe(false);
    expect(settled.ok === false && settled.error.key).toBe('common.cancelled');
  });
});
