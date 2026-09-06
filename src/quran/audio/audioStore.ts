/**
 * Offline recitation store — QR-18 (docs/quran-reader-plan.md).
 *
 * Per-surah MP3 downloads into the managed content store:
 *
 *   <Documents>/quran/audio/{reciterId}/{SSS}{AAA}.mp3
 *   <Documents>/quran/timings/{reciterId}.json
 *
 * Same worker-pool + `.part`-then-move pattern as the mushaf store
 * (`mushafDownload.ts`), so a killed app never leaves a truncated MP3
 * where the player would find it.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  CONTENT_DEADLINES,
  fetchContentOnce,
  withDownloadDeadline,
} from '../contentNetwork';
import { mkdirDeep } from '../mushafDownload';
import { SURAHS } from '../quran';
import {
  ayahAudioFileName,
  ayahAudioUrl,
  findReciter,
  reciterTimingsUrl,
  type Reciter,
} from './reciters';

function audioDir(reciterId: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/quran/audio/${reciterId}`;
}

function timingsDir(): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/quran/timings`;
}

export function timingsFilePath(reciterId: string): string {
  return `${timingsDir()}/${reciterId}.json`;
}

export function ayahAudioFilePath(
  reciterId: string,
  surah: number,
  ayah: number,
): string {
  return `${audioDir(reciterId)}/${ayahAudioFileName(surah, ayah)}`;
}

async function fileValid(path: string, minBytes = 1000): Promise<boolean> {
  try {
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return false;
    const stat = await ReactNativeBlobUtil.fs.stat(path);
    return Number(stat.size) > minBytes;
  } catch {
    return false;
  }
}

/** Is every ayah of a surah on disk for this reciter? */
export async function isSurahDownloaded(
  reciterId: string,
  surah: number,
): Promise<boolean> {
  const meta = SURAHS.find(s => s.number === surah);
  if (!meta) return false;
  for (let a = 1; a <= meta.ayahCount; a++) {
    if (!(await fileValid(ayahAudioFilePath(reciterId, surah, a)))) {
      return false;
    }
  }
  return true;
}

/** Which of an ayah's audio exists locally? Sync-ish helper for queueing. */
export async function localAudioPathIfAny(
  reciterId: string,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const path = ayahAudioFilePath(reciterId, surah, ayah);
  return (await fileValid(path)) ? path : null;
}

export type AudioDownloadProgress = {
  done: number;
  total: number;
  failed: number;
};

export type AudioDownloadHandle = {
  promise: Promise<boolean>;
  cancel: () => void;
};

/** Smallest believable MP3 — anything under this is a bad download. */
const MIN_AUDIO_BYTES = 1000;

/**
 * Last-resort transport: RN's own networking stack, via base64.
 *
 * `ReactNativeBlobUtil`'s streaming downloader is the one to want, but on
 * some networks EVERY request through it dies with "Download interrupted"
 * — the Android emulator's NAT does exactly that, and so do some
 * corporate proxies. The font store learned this and carries the fix; the
 * timings fetch learned it after that. The MP3s never did.
 *
 * An ayah is tens of kilobytes, so holding one in memory for the length of
 * one write is not the problem it would be for a font.
 */
async function fetchAyahViaRNFetch(url: string, dest: string): Promise<void> {
  // A deadline, because this is the path a broken network ROUTES TO. Once
  // `streamingAudioWorks` is false every ayah comes through here, and an
  // untimed fetch on a stalled connection never settles — the caller's
  // retry loop below never gets its turn.
  const response = await fetchContentOnce(
    url,
    undefined,
    CONTENT_DEADLINES.ayahAudio,
  );
  if (!response.ok) throw new Error(`ayah: HTTP ${response.status}`);
  const blob = await response.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ayah: read failed'));
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
  if (base64.length < MIN_AUDIO_BYTES) throw new Error('ayah: truncated');
  await ReactNativeBlobUtil.fs.unlink(dest).catch(() => undefined);
  await ReactNativeBlobUtil.fs.writeFile(dest, base64, 'base64');
}

/**
 * WHY A WHOLE-QURAN DOWNLOAD APPEARED TO HANG.
 *
 * Reported 2026-09-04: it gets stuck every time. It was not stuck — it was
 * failing 6,236 times in the slowest possible way.
 *
 * On a network where the streaming transport cannot work, every ayah spent
 * two doomed requests, a 60-second watchdog apiece, and 1.2 s of backoff
 * before falling over. Four workers doing that in parallel is a progress
 * bar that moves a few files a minute and a screen that looks frozen. The
 * font store hit exactly this and wrote it down: "the whole reason the
 * download crawled and appeared to freeze in blocks."
 *
 * So the same cure. One streaming failure condemns the transport for the
 * rest of the session and everything after it goes straight to the
 * fallback; the next launch gives streaming another chance, in case it was
 * the network that was wrong rather than the device.
 */
let streamingAudioWorks = true;

/** Rate-limited telemetry, so a slow run can be diagnosed from a log. */
const audioStats = { retries: 0, failures: 0, lastLog: 0, startedAt: 0 };

function noteAudioProgress(done: number, total: number): void {
  const now = Date.now();
  if (audioStats.startedAt === 0) audioStats.startedAt = now;
  if (now - audioStats.lastLog < 5000) return;
  audioStats.lastLog = now;
  const secs = Math.max(0.001, (now - audioStats.startedAt) / 1000);
  console.log(
    `[quranAudio] ${done}/${total} · ${(done / secs).toFixed(1)} files/s · ` +
      `streaming=${streamingAudioWorks} · retries=${audioStats.retries} · ` +
      `failed=${audioStats.failures}`,
  );
}

/** One ayah's audio, on disk, or a throw. Up to 3 attempts. */
async function fetchAyahFile(
  reciter: Reciter,
  surah: number,
  ayah: number,
  path: string,
): Promise<void> {
  // Transient stream resets are common on multiplexed CDN connections
  // (same pattern as mushafDownload).
  let lastError: unknown = null;
  const url = ayahAudioUrl(reciter, surah, ayah);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tmp = `${path}.part`;
    try {
      if (attempt > 1) audioStats.retries += 1;
      // Straight to the fallback once streaming has been condemned, and
      // on the last attempt regardless — a file worth three tries is
      // worth trying the other transport at least once.
      if (attempt === 3 || !streamingAudioWorks) {
        await fetchAyahViaRNFetch(url, path);
        return;
      }
      // No RNBlobUtil `timeout` config — it breaks Android downloads
      // outright; `withDownloadDeadline` races it in JS instead.
      const res = await withDownloadDeadline(
        ReactNativeBlobUtil.config({ path: tmp, overwrite: true }).fetch(
          'GET',
          url,
        ),
        CONTENT_DEADLINES.ayahAudio,
        'audio fetch',
      );
      const stat = await ReactNativeBlobUtil.fs.stat(tmp).catch(() => null);
      if (
        res.info().status !== 200 ||
        !stat ||
        Number(stat.size) <= MIN_AUDIO_BYTES
      ) {
        throw new Error(`ayah ${surah}:${ayah}`);
      }
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
      await ReactNativeBlobUtil.fs.mv(tmp, path);
      return;
    } catch (e) {
      lastError = e;
      // The streaming transport just failed. It is condemned for the rest
      // of the session rather than retried 6,235 more times.
      if (streamingAudioWorks && attempt < 3) {
        streamingAudioWorks = false;
        console.warn(
          '[quranAudio] streaming transport failed; using RN fetch for the rest of this session',
          e,
        );
      }
      await ReactNativeBlobUtil.fs.unlink(tmp).catch(() => undefined);
      if (attempt < 3) {
        await new Promise<void>(r => setTimeout(r, 400 * attempt));
      }
    }
  }
  audioStats.failures += 1;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** For tests: a fresh session's optimism about the transport. */
export function _resetAudioTransportForTests(): void {
  streamingAudioWorks = true;
  audioStats.retries = 0;
  audioStats.failures = 0;
  audioStats.lastLog = 0;
  audioStats.startedAt = 0;
}

/** How many workers pull from a download queue at once. */
const WORKERS = 4;

/**
 * Work a queue of ayahs down to nothing, four at a time.
 *
 * Shared by the one-surah download and the whole-Quran one, which differ
 * only in the length of the list. A file already on disk and big enough to
 * be real is skipped, and THAT is the whole of the resume story: a run
 * that was cancelled at ayah four thousand starts again from the top and
 * spends a few seconds walking past what it already has. No index, no
 * checkpoint, nothing to get out of step with the files themselves.
 *
 * A failure is counted, never thrown — six thousand files over a phone
 * connection will drop some, and losing the other five thousand nine
 * hundred over it would be absurd. What failed is left for the next run to
 * find missing.
 */
function runAyahQueue(
  reciterId: string,
  queue: Array<{ surah: number; ayah: number }>,
  onProgress?: (p: AudioDownloadProgress) => void,
): AudioDownloadHandle {
  const reciter: Reciter = findReciter(reciterId);
  const total = queue.length;
  const pending = [...queue];
  let cancelled = false;
  let done = 0;
  let failed = 0;

  const run = async (): Promise<boolean> => {
    if (total === 0) return false;
    await mkdirDeep(audioDir(reciterId));

    const worker = async (): Promise<void> => {
      while (!cancelled) {
        const next = pending.shift();
        if (next == null) return;
        const path = ayahAudioFilePath(reciterId, next.surah, next.ayah);
        try {
          if (!(await fileValid(path))) {
            await fetchAyahFile(reciter, next.surah, next.ayah, path);
          }
        } catch {
          failed += 1;
        } finally {
          done += 1;
          noteAudioProgress(done, total);
          onProgress?.({ done, total, failed });
        }
      }
    };

    await Promise.all(Array.from({ length: WORKERS }, () => worker()));
    return !cancelled && failed === 0;
  };

  return {
    promise: run(),
    cancel: () => {
      cancelled = true;
    },
  };
}

/** Download one surah's ayah files for a reciter (skips valid files). */
export function downloadSurahAudio(
  reciterId: string,
  surah: number,
  onProgress?: (p: AudioDownloadProgress) => void,
): AudioDownloadHandle {
  const meta = SURAHS.find(s => s.number === surah);
  if (!meta) {
    return { promise: Promise.resolve(false), cancel: () => undefined };
  }
  const queue = Array.from({ length: meta.ayahCount }, (_, i) => ({
    surah,
    ayah: i + 1,
  }));
  return runAyahQueue(reciterId, queue, onProgress);
}

/** Every ayah in the book, in recitation order. */
export function allAyahRefs(): Array<{ surah: number; ayah: number }> {
  const refs: Array<{ surah: number; ayah: number }> = [];
  for (const s of SURAHS) {
    for (let a = 1; a <= s.ayahCount; a++) refs.push({ surah: s.number, ayah: a });
  }
  return refs;
}

/** 6,236. Computed rather than written down, so it cannot drift. */
export function totalAyahCount(): number {
  return SURAHS.reduce((sum, s) => sum + s.ayahCount, 0);
}

/**
 * The whole Quran in one reciter's voice.
 *
 * The same files the reader already streams and prefetches, into the same
 * folder — `<Documents>/quran/audio/{reciterId}/` — so this is not a
 * second copy of anything. Someone who downloads a reciter to listen to on
 * a flight has, by the same act, made the mushaf's play-from-here work
 * without a connection, and someone who has been reading with recitation
 * for a month finds this download already part-done.
 */
export function downloadReciterAudio(
  reciterId: string,
  onProgress?: (p: AudioDownloadProgress) => void,
): AudioDownloadHandle {
  return runAyahQueue(reciterId, allAyahRefs(), onProgress);
}

/**
 * Prefetch a single ayah MP3 for gapless playback — v2.7.28. Called by
 * the playback orchestrator for upcoming queue items so long listening
 * sessions turn local (no network gap between ayahs) after warmup.
 * Best-effort: one attempt with a 30 s watchdog; resolves the local
 * path or null.
 */
export async function prefetchAyahAudio(
  reciterId: string,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const path = ayahAudioFilePath(reciterId, surah, ayah);
  try {
    if (await fileValid(path)) return path;
    await mkdirDeep(audioDir(reciterId));
    const reciter = findReciter(reciterId);
    const tmp = `${path}.part`;
    const res = await withDownloadDeadline(
      ReactNativeBlobUtil.config({ path: tmp, overwrite: true }).fetch(
        'GET',
        ayahAudioUrl(reciter, surah, ayah),
      ),
      CONTENT_DEADLINES.ayahPrefetch,
      'prefetch',
    );
    const stat = await ReactNativeBlobUtil.fs.stat(tmp).catch(() => null);
    if (res.info().status !== 200 || !stat || Number(stat.size) <= 1000) {
      await ReactNativeBlobUtil.fs.unlink(tmp).catch(() => undefined);
      return null;
    }
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
    await ReactNativeBlobUtil.fs.mv(tmp, path);
    return path;
  } catch {
    return null;
  }
}

/**
 * The bitrate the reciter's files were encoded at, from the folder name.
 *
 * Every EveryAyah folder ends in it — `Husary_128kbps`, `Ghamadi_40kbps` —
 * and the spread is wide enough to matter: the same book is 1.4 GB in one
 * voice and 350 MB in another. Someone deciding whether to put this on
 * their phone is really asking about that number, so it is worth reading
 * rather than assuming.
 */
export function reciterBitrateKbps(reciter: Reciter): number {
  const match = /_(\d+)kbps$/.exec(reciter.folder);
  const kbps = match ? Number(match[1]) : NaN;
  // 64 is the middle of the catalog and the safe thing to say when a
  // folder ever stops following the convention.
  return Number.isFinite(kbps) && kbps > 0 ? kbps : 64;
}

/**
 * Roughly how long a whole recitation runs, in hours.
 *
 * Murattal readings of the whole book sit between about twenty and thirty
 * hours depending on the reciter's pace, and nothing in the catalog
 * carries its own duration. Twenty-four is the middle of that, and every
 * number derived from it is presented as "about" for exactly this reason —
 * it is the right order of magnitude for deciding whether a download fits
 * on a phone, and it is not a promise.
 */
const RECITATION_HOURS = 24;

/** About how many bytes a reciter's whole Quran will take. */
export function estimatedReciterBytes(reciterId: string): number {
  const kbps = reciterBitrateKbps(findReciter(reciterId));
  return Math.round((RECITATION_HOURS * 3600 * kbps * 1000) / 8);
}

export type ReciterAudioStats = {
  /** Ayah files on disk for this reciter. */
  files: number;
  bytes: number;
  /** Every ayah in the book is here. */
  complete: boolean;
};

/**
 * What this reciter has on disk — one directory listing, not 6,236 stats.
 *
 * `lstat` on the folder returns every entry with its size in one call,
 * which is the difference between a screen that opens and one that thinks
 * about it for ten seconds. `.part` files are excluded: a half-written
 * ayah is not a downloaded one, and counting it would make a cancelled run
 * look further along than it is.
 */
export async function reciterAudioStats(
  reciterId: string,
): Promise<ReciterAudioStats> {
  const empty: ReciterAudioStats = { files: 0, bytes: 0, complete: false };
  try {
    const dir = audioDir(reciterId);
    if (!(await ReactNativeBlobUtil.fs.exists(dir))) return empty;
    const entries = await ReactNativeBlobUtil.fs.lstat(dir).catch(() => []);
    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
      const name = String(entry.filename ?? '');
      if (!name.endsWith('.mp3')) continue;
      const size = Number(entry.size) || 0;
      // Same floor the downloader validates against, so "on disk" means
      // the same thing to both.
      if (size <= 1000) continue;
      files += 1;
      bytes += size;
    }
    return { files, bytes, complete: files >= totalAyahCount() };
  } catch {
    return empty;
  }
}

/**
 * Every reciter with anything on disk, keyed by id.
 *
 * For the picker, which has to decide per row whether to offer a download
 * or a delete — and cannot ask forty-two times. One `ls` of the audio
 * folder names the reciters that have a directory at all, which on a real
 * device is nought to three of them, and only those are measured.
 */
export async function downloadedReciters(): Promise<
  Record<string, ReciterAudioStats>
> {
  const out: Record<string, ReciterAudioStats> = {};
  try {
    const base = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/quran/audio`;
    if (!(await ReactNativeBlobUtil.fs.exists(base))) return out;
    const dirs = await ReactNativeBlobUtil.fs.ls(base).catch(() => []);
    for (const id of dirs) {
      const stats = await reciterAudioStats(id);
      // A directory with nothing usable in it is not a download. It is
      // what a cancelled run leaves behind, and offering to delete it
      // would be offering to delete nothing.
      if (stats.files > 0) out[id] = stats;
    }
  } catch {
    /* an unreadable folder is an empty one, for this purpose */
  }
  return out;
}

/** Delete all downloaded audio for one reciter. */
export async function deleteReciterAudio(reciterId: string): Promise<void> {
  try {
    await ReactNativeBlobUtil.fs.unlink(audioDir(reciterId));
  } catch {
    /* already gone */
  }
}

/** Bytes on disk across all reciters (Manage downloads UI). */
export async function audioDiskUsage(): Promise<number> {
  try {
    const base = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/quran/audio`;
    if (!(await ReactNativeBlobUtil.fs.exists(base))) return 0;
    let sum = 0;
    const reciterDirs = await ReactNativeBlobUtil.fs.ls(base);
    for (const dir of reciterDirs) {
      const files = await ReactNativeBlobUtil.fs
        .lstat(`${base}/${dir}`)
        .catch(() => []);
      for (const f of files) sum += Number(f.size) || 0;
    }
    return sum;
  } catch {
    return 0;
  }
}

type TimingsJson = { [key: string]: number[][] };

/** Smallest believable timings file — anything under this is a bad download. */
const MIN_TIMINGS_BYTES = 10_000;

/**
 * Last-resort transport: RN's own networking stack, straight to a string.
 *
 * `ReactNativeBlobUtil`'s streaming downloader is the one to want, but on
 * some networks EVERY request through it dies with "Download interrupted"
 * — the Android emulator's NAT does exactly that, and so do some corporate
 * proxies. The font store learned this and carries the same fallback
 * (`fetchFontViaRNFetch`); the timings fetch did not, which is why the
 * word highlight was dead on the emulator no matter how often it retried:
 * every attempt used the one transport that cannot work there.
 *
 * A timings file is ~1.4 MB of JSON, so holding it in memory for the
 * length of one parse is not the problem it would be for a font.
 */
async function fetchTimingsViaRNFetch(url: string): Promise<string> {
  const response = await fetchContentOnce(
    url,
    undefined,
    CONTENT_DEADLINES.timings,
  );
  if (!response.ok) throw new Error(`timings: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length < MIN_TIMINGS_BYTES) throw new Error('timings: truncated');
  return text;
}

/**
 * Fetch (once) and cache a reciter's word-timing JSON. Resolves null on
 * any failure — word highlighting is strictly best-effort and must never
 * block playback.
 */
export async function loadReciterTimings(
  reciterId: string,
): Promise<TimingsJson | null> {
  // No timing data published for this reciter — skip the network round
  // trip entirely; the UI falls back to ayah-level highlighting.
  if (!findReciter(reciterId).hasTimings) return null;
  const path = timingsFilePath(reciterId);
  const url = reciterTimingsUrl(findReciter(reciterId));

  // Cached, and readable. A file that is there but will not parse is a bad
  // download, and keeping it would answer null for ever — see the expiry
  // policy in useWordTiming, which cannot help if the file never changes.
  if (await fileValid(path, MIN_TIMINGS_BYTES)) {
    try {
      return JSON.parse(String(await ReactNativeBlobUtil.fs.readFile(path, 'utf8')));
    } catch (e) {
      console.warn('audioStore: cached timings unreadable, refetching', e);
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
    }
  }

  const tmp = `${path}.part`;
  try {
    await mkdirDeep(timingsDir());
    // No `timeout` in the config: on Android it makes every download fail
    // instantly with "Download interrupted" (same note as the font store).
    // This one had no watchdog either, so a stalled origin hung the word
    // highlight for the life of the session with nothing to fall back to.
    const res = await withDownloadDeadline(
      ReactNativeBlobUtil.config({ path: tmp, overwrite: true }).fetch(
        'GET',
        url,
      ),
      CONTENT_DEADLINES.timings,
      'timings fetch',
    );
    const stat = await ReactNativeBlobUtil.fs.stat(tmp).catch(() => null);
    if (res.info().status !== 200 || !stat) {
      throw new Error(`timings: HTTP ${res.info().status}`);
    }
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
    await ReactNativeBlobUtil.fs.mv(tmp, path);
    return JSON.parse(String(await ReactNativeBlobUtil.fs.readFile(path, 'utf8')));
  } catch (streamError) {
    await ReactNativeBlobUtil.fs.unlink(tmp).catch(() => undefined);
    try {
      const text = await fetchTimingsViaRNFetch(url);
      const parsed: TimingsJson = JSON.parse(text);
      // Cache it, but the answer does not depend on the write: a device
      // that cannot write here should still highlight this session.
      await ReactNativeBlobUtil.fs
        .writeFile(path, text, 'utf8')
        .catch(() => undefined);
      return parsed;
    } catch (e) {
      console.warn('audioStore: timings unavailable', streamError, e);
      return null;
    }
  }
}
