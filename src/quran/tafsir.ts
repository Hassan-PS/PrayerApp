/**
 * Real tafsir — v2.7.28.
 *
 * Classical tafsir texts fetched per-ayah on demand and cached on disk,
 * shown in the ayah action sheet next to the translation. Source:
 * spa5k/tafsir_api (github.com/spa5k/tafsir_api), a public mirror of
 * Quran.com's tafsir corpus served via the jsDelivr CDN — the same
 * texts Quran.com displays. Every edition is attributed in
 * Settings → About (religious-content rule, CLAUDE.md §4).
 *
 * Cache layout: <Documents>/quran/tafsir/{editionId}/{surah}/{ayah}.json
 * (inside the managed `quran/` store so it is excluded from Android
 * Auto Backup and cleaned by the Manage-downloads screen).
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { CONTENT_DEADLINES } from './contentNetwork';
import { mkdirDeep } from './mushafDownload';

export type TafsirEdition = {
  id: string;
  /** Display label (proper noun — not translated). */
  label: string;
  /** App locale this edition serves. */
  locale: string;
  /** RTL text? */
  rtl: boolean;
  /** Display name of the edition's language (for the selector subtitle). */
  language: string;
};

/**
 * Verified live against the CDN on 2026-07-05 (HTTP 200 for 1:1).
 * Locales without a native edition fall back to Ibn Kathir (English).
 */
export const TAFSIR_EDITIONS: ReadonlyArray<TafsirEdition> = [
  {
    id: 'en-tafisr-ibn-kathir', // (sic — upstream id carries the typo)
    label: 'Ibn Kathir (abridged)',
    locale: 'en',
    rtl: false,
    language: 'English',
  },
  {
    id: 'en-tafsir-maarif-ul-quran',
    label: 'Maarif-ul-Quran',
    locale: 'en',
    rtl: false,
    language: 'English',
  },
  {
    id: 'ar-tafsir-muyassar',
    label: 'التفسير الميسر',
    locale: 'ar',
    rtl: true,
    language: 'Arabic',
  },
  {
    id: 'ar-tafsir-ibn-kathir',
    label: 'تفسير ابن كثير',
    locale: 'ar',
    rtl: true,
    language: 'Arabic',
  },
  {
    id: 'ur-tafseer-ibn-e-kaseer',
    label: 'تفسیر ابن کثیر (اردو)',
    locale: 'ur',
    rtl: true,
    language: 'Urdu',
  },
  {
    id: 'bn-tafseer-ibn-e-kaseer',
    label: 'তাফসীর ইবনে কাসীর',
    locale: 'bn',
    rtl: false,
    language: 'Bengali',
  },
] as const;

/** Editions offered for an app locale: native ones first, then English. */
export function tafsirEditionsForLocale(locale: string): TafsirEdition[] {
  const native = TAFSIR_EDITIONS.filter(e => e.locale === locale);
  const english = TAFSIR_EDITIONS.filter(e => e.locale === 'en');
  return locale === 'en' ? english : [...native, ...english];
}

export function findTafsirEdition(id: string): TafsirEdition | undefined {
  return TAFSIR_EDITIONS.find(e => e.id === id);
}

/**
 * Resolve the tafsir edition to show for a stored preference + app locale.
 * An EXPLICIT stored pick is honoured for ANY edition we ship — the
 * selector lists all of them (v2.7.40), so a cross-language pick must not
 * silently revert. The locale only chooses the DEFAULT when nothing valid
 * is stored (fresh installs, unknown/blank ids).
 */
export function resolveTafsirEdition(
  storedId: string,
  locale: string,
): TafsirEdition {
  return (
    TAFSIR_EDITIONS.find(e => e.id === storedId) ??
    tafsirEditionsForLocale(locale)[0]
  );
}

function tafsirUrl(edition: string, surah: number, ayah: number): string {
  return `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${edition}/${surah}/${ayah}.json`;
}

export function tafsirCacheDir(): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/quran/tafsir`;
}

function cachePath(edition: string, surah: number, ayah: number): string {
  return `${tafsirCacheDir()}/${edition}/${surah}/${ayah}.json`;
}

/**
 * Fetch (or read from cache) one ayah's tafsir text. Resolves null on
 * any failure — the UI shows a quiet "unavailable offline" note.
 */
export async function loadTafsir(
  edition: string,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const path = cachePath(edition, surah, ayah);
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      const raw = await ReactNativeBlobUtil.fs.readFile(path, 'utf8');
      const parsed = JSON.parse(String(raw)) as { text?: string };
      if (parsed.text) return parsed.text;
    }
  } catch {
    /* fall through to network */
  }
  try {
    // Two attempts, not four: a reader is looking at an open sheet, so a
    // CDN's transient 502 is worth exactly one more try and no more. The
    // deadline is what matters most here — before this, a stalled origin
    // left the sheet's spinner running with nothing to end it.
    const res = await fetchWithRetry(
      tafsirUrl(edition, surah, ayah),
      undefined,
      {
        maxAttempts: 2,
        baseDelayMs: 400,
        timeoutMs: CONTENT_DEADLINES.tafsir,
      },
    );
    if (!res.ok) return null;
    const parsed = (await res.json()) as { text?: string };
    const text = parsed.text?.trim();
    if (!text) return null;
    // Cache for offline re-reads (best effort).
    try {
      await mkdirDeep(`${tafsirCacheDir()}/${edition}/${surah}`);
      await ReactNativeBlobUtil.fs.writeFile(
        path,
        JSON.stringify({ text }),
        'utf8',
      );
    } catch {
      /* cache write is optional */
    }
    return text;
  } catch {
    return null;
  }
}

/** Bytes on disk in the tafsir cache (Manage-downloads screen). */
export async function tafsirDiskUsage(): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    try {
      const entries = await ReactNativeBlobUtil.fs.lstat(dir);
      let sum = 0;
      for (const e of entries) {
        if (e.type === 'directory') {
          sum += await walk(`${dir}/${e.filename}`);
        } else {
          sum += Number(e.size) || 0;
        }
      }
      return sum;
    } catch {
      return 0;
    }
  };
  if (!(await ReactNativeBlobUtil.fs.exists(tafsirCacheDir()))) return 0;
  return walk(tafsirCacheDir());
}

/** Delete the whole tafsir cache. */
export async function deleteTafsirCache(): Promise<void> {
  try {
    await ReactNativeBlobUtil.fs.unlink(tafsirCacheDir());
  } catch {
    /* already gone */
  }
}

export const TAFSIR_ATTRIBUTION =
  'Tafsir texts (Ibn Kathir, Maarif-ul-Quran, al-Muyassar) via the ' +
  'spa5k/tafsir_api mirror of the Quran.com tafsir corpus.';
