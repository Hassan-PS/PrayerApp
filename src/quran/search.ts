/**
 * Quran search — QR-22 (docs/quran-reader-plan.md).
 *
 * Diacritic-insensitive Arabic search + translation search over the
 * bundled corpus. No persisted index: a normalized in-memory cache is
 * built lazily (one pass over the 114 surah JSONs, ~6 MB of text) and
 * a linear scan answers queries in a few ms on-device. The cache
 * builds chunked so the UI thread never blocks for long.
 */
import { loadSurah, SURAHS } from './quran';
import { getSurahTranslation, type QuranTranslationId } from './translations';

export type QuranSearchResult = {
  surah: number;
  ayah: number;
  /** Original Arabic ayah text. */
  arabic: string;
  /** Translation snippet in the active edition ('' for Arabic-only hits). */
  translation: string;
  /** Which field matched. */
  matched: 'arabic' | 'translation';
};

/**
 * Fold Arabic text for matching: strip tashkeel + Quranic annotation
 * marks, tatweel; normalize alef/hamza forms, alef maqsura, ta marbuta.
 * Exported for tests.
 */
export function normalizeArabic(text: string): string {
  return (
    text
      // Tashkeel + Quranic annotation ranges.
      .replace(/[ً-ٰٟۖ-ۭؐ-ؚ]/g, '')
      // Tatweel.
      .replace(/ـ/g, '')
      // Alef variants (incl. wasla) → bare alef.
      .replace(/[آأإٱ]/g, 'ا')
      // Alef maqsura → ya.
      .replace(/ى/g, 'ي')
      // Ta marbuta → ha.
      .replace(/ة/g, 'ه')
      .toLowerCase()
  );
}

type CorpusEntry = {
  surah: number;
  ayah: number;
  arabic: string;
  normalized: string;
};

let corpus: CorpusEntry[] | null = null;
let building: Promise<CorpusEntry[]> | null = null;

async function buildCorpus(): Promise<CorpusEntry[]> {
  const entries: CorpusEntry[] = [];
  for (const s of SURAHS) {
    const loaded = await loadSurah(s.number);
    if (!loaded) continue;
    loaded.arabic.forEach((text, i) => {
      entries.push({
        surah: s.number,
        ayah: i + 1,
        arabic: text,
        normalized: normalizeArabic(text),
      });
    });
    // Yield between surahs so a foreground animation never stutters.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return entries;
}

export function ensureSearchCorpus(): Promise<CorpusEntry[]> {
  if (corpus) return Promise.resolve(corpus);
  if (building) return building;
  building = buildCorpus().then(c => {
    corpus = c;
    return c;
  });
  return building;
}

/**
 * Search Arabic (normalized) and the active translation edition.
 * Returns up to `limit` results, Arabic matches first in mushaf order.
 */
export async function searchQuran(
  query: string,
  edition: QuranTranslationId,
  limit = 50,
): Promise<QuranSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const entries = await ensureSearchCorpus();
  const results: QuranSearchResult[] = [];

  const hasArabic = /[؀-ۿ]/.test(q);
  if (hasArabic) {
    const nq = normalizeArabic(q);
    for (const e of entries) {
      if (e.normalized.includes(nq)) {
        results.push({
          surah: e.surah,
          ayah: e.ayah,
          arabic: e.arabic,
          translation: '',
          matched: 'arabic',
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  // Latin-script query → translation search, surah by surah.
  const lq = q.toLowerCase();
  for (const s of SURAHS) {
    const texts = await getSurahTranslation(edition, s.number);
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].toLowerCase().includes(lq)) {
        const entry = entries.find(
          e => e.surah === s.number && e.ayah === i + 1,
        );
        results.push({
          surah: s.number,
          ayah: i + 1,
          arabic: entry?.arabic ?? '',
          translation: texts[i],
          matched: 'translation',
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/**
 * Verse of the day — QR-23. Deterministic date-seeded pick over the
 * whole corpus (6236 ayahs): same verse for everyone on the same day,
 * no network, no randomness across re-renders.
 */
export function verseOfTheDayRef(date: Date = new Date()): {
  surah: number;
  ayah: number;
} {
  const seed =
    date.getFullYear() * 372 + date.getMonth() * 31 + (date.getDate() - 1);
  // Multiplicative hash → stable pseudo-uniform pick.
  const idx = Math.abs((seed * 2654435761) % 6236);
  let remaining = idx;
  for (const s of SURAHS) {
    if (remaining < s.ayahCount) return { surah: s.number, ayah: remaining + 1 };
    remaining -= s.ayahCount;
  }
  return { surah: 1, ayah: 1 };
}
