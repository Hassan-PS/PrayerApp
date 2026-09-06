/**
 * Quran translation registry — task #96.
 *
 * Multiple Tanzil-derived translation editions are bundled so the user
 * can pick the one that matches their preferred language. Default
 * follows the active app locale (see `defaultEditionForLocale`).
 *
 * Each edition's text lives at `./data/translations/{id}.json` as a
 * chapter-keyed object: `{ "1": { "1": "In the name…", … }, … }`.
 * Metro requires literal require paths so we enumerate explicitly.
 *
 * Source: alquran.cloud (Tanzil corpus). License notes:
 *   - Sahih International: public domain
 *   - Pickthall: public domain
 *   - Tanzil-distributed editions: respective translator licenses,
 *     redistributed under CC BY 3.0 by Tanzil.
 */

export type QuranTranslationEdition = {
  /** Stable id, also the data file name. */
  id: string;
  /** Translator / edition name. */
  label: string;
  /** ISO-style language label. */
  language: string;
  /** App locale code (en/ar/…) — used for default selection. */
  locale: string;
};

export const QURAN_TRANSLATIONS: ReadonlyArray<QuranTranslationEdition> = [
  { id: 'en.sahih', label: 'Sahih International', language: 'English', locale: 'en' },
  { id: 'en.pickthall', label: 'Pickthall', language: 'English', locale: 'en' },
  // NOTE (v2.7.40): 'ar.muyassar' (al-Tafsir al-Muyassar) was removed from
  // this registry — it is an Arabic TAFSIR, not a translation (the Quran is
  // Arabic; Tanzil ships it in the translation corpus slot, which is how it
  // snuck in). It remains available as 'ar-tafsir-muyassar' in the tafsir
  // registry. A stored 'ar.muyassar' pick falls back to the locale default.
  { id: 'sv.bernstrom', label: 'Bernström', language: 'Swedish', locale: 'sv' },
  { id: 'bn.bengali', label: 'Mujibur Rahman', language: 'Bengali', locale: 'bn' },
  { id: 'ur.jalandhry', label: 'Fateh Muhammad Jalandhry', language: 'Urdu', locale: 'ur' },
  { id: 'hi.hindi', label: 'Suhel Farooq Khan', language: 'Hindi', locale: 'hi' },
  { id: 'fr.hamidullah', label: 'Hamidullah', language: 'French', locale: 'fr' },
  { id: 'es.cortes', label: 'Cortés', language: 'Spanish', locale: 'es' },
  { id: 'de.bubenheim', label: 'Bubenheim & Elyas', language: 'German', locale: 'de' },
  { id: 'tr.diyanet', label: 'Diyanet İşleri', language: 'Turkish', locale: 'tr' },
  { id: 'id.indonesian', label: 'Indonesian Ministry', language: 'Indonesian', locale: 'id' },
  { id: 'ru.kuliev', label: 'Kuliev', language: 'Russian', locale: 'ru' },
  { id: 'zh.jian', label: 'Ma Jian', language: 'Chinese', locale: 'zh' },
] as const;

export type QuranTranslationId = (typeof QURAN_TRANSLATIONS)[number]['id'];

/** Pick the best default edition for an app locale. Falls back to en.sahih. */
export function defaultEditionForLocale(locale: string): QuranTranslationId {
  const exact = QURAN_TRANSLATIONS.find(e => e.locale === locale);
  if (exact) return exact.id as QuranTranslationId;
  return 'en.sahih';
}

/**
 * Is this saved edition id one we still ship? (v2.7.40)
 *
 * An EXPLICIT user pick is honoured regardless of the app language — the
 * selector deliberately lists every edition (a German speaker may want the
 * English Sahih text), so reverting cross-language picks silently was a
 * bug, not a feature. The app-locale default only applies when nothing
 * valid is stored (fresh installs, removed editions like 'ar.muyassar').
 */
export function isKnownEdition(
  edition: string | undefined | null,
): edition is QuranTranslationId {
  if (!edition) return false;
  return QURAN_TRANSLATIONS.some(e => e.id === edition);
}

/** Back-compat shim for older call sites: "usable" now simply means the
 *  edition exists — explicit picks survive app-language changes. */
export function editionMatchesLocale(
  edition: string | undefined | null,
  _locale: string,
): boolean {
  return isKnownEdition(edition);
}

type ChapterMap = { [chapter: string]: { [ayah: string]: string } };

/**
 * All 6,236 ayahs of one edition, as a lookup map.
 *
 * ── WHY THIS IS ASYNC WHEN ITS BODY IS NOT ──────────────────────────
 *
 * The body still returns a bundled `require`, synchronously, and this
 * still resolves on the first tick. The signature has moved ahead of it
 * on purpose, because the thirteen editions are about to stop being part
 * of the JS bundle.
 *
 * They are ~18 MB of the bundle's 26, and `assets/index.android.bundle`
 * is STORED in the APK — zero compression, because Android does not
 * compress a `.bundle`. The same JSON as an ordinary asset gzips to
 * about 4.5 MB. Moving it is roughly thirteen megabytes off a fifty
 * megabyte download, and it costs nothing anybody can see: the files
 * still ship inside the app, so nothing about reading the Qur'an
 * offline changes.
 *
 * Reading a file is asynchronous, and three of the call sites read a
 * translation in a component's render body — where a promise cannot go.
 * So the signature changes first, on its own, with the body untouched:
 * every caller is moved and proven while the data is still coming from
 * the same place it always did. `loadSurah` in `quran.ts` has had
 * exactly this shape for a while — an async façade over a sync require
 * switch — which is what makes this a small step rather than a leap.
 */
/**
 * One edition at a time, and the read that is fetching it.
 *
 * Metro's require cache used to do this for free — that is the only
 * reason `getAyahTranslation` could sit in a render body and cost
 * nothing after the first ayah. A read from disk has no such cache, and
 * the render-path callers would have re-read a megabyte per render
 * without one.
 *
 * The in-flight promise is held as well as the result, so a screen that
 * mounts three components asking for the same edition at once does one
 * read rather than three. Same shape as `ensureSearchCorpus`.
 *
 * Bounded to ONE edition. A reader has a translation, not a library of
 * them, and the whole point of this move is to stop carrying editions
 * nobody asked for.
 */
let cached: { edition: QuranTranslationId; map: ChapterMap } | null = null;
let loading: { edition: QuranTranslationId; work: Promise<ChapterMap> } | null =
  null;

/** Test seam, and what a low-memory warning would call. */
export function _clearTranslationCache(): void {
  cached = null;
  loading = null;
}

export async function loadTranslation(
  edition: QuranTranslationId,
): Promise<ChapterMap> {
  if (cached?.edition === edition) return cached.map;
  if (loading?.edition === edition) return loading.work;
  const work = readEdition(edition).then(map => {
    cached = { edition, map };
    if (loading?.edition === edition) loading = null;
    return map;
  });
  loading = { edition, work };
  return work;
}

async function readEdition(edition: QuranTranslationId): Promise<ChapterMap> {
  switch (edition) {
    case 'en.sahih':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/en.sahih.json');
    case 'en.pickthall':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/en.pickthall.json');
    case 'sv.bernstrom':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/sv.bernstrom.json');
    case 'bn.bengali':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/bn.bengali.json');
    case 'ur.jalandhry':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/ur.jalandhry.json');
    case 'hi.hindi':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/hi.hindi.json');
    case 'fr.hamidullah':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/fr.hamidullah.json');
    case 'es.cortes':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/es.cortes.json');
    case 'de.bubenheim':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/de.bubenheim.json');
    case 'tr.diyanet':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/tr.diyanet.json');
    case 'id.indonesian':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/id.indonesian.json');
    case 'ru.kuliev':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/ru.kuliev.json');
    case 'zh.jian':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/zh.jian.json');
    default:
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./data/translations/en.sahih.json');
  }
}

/** Fetch a single ayah's translation. Returns empty string if missing. */
export async function getAyahTranslation(
  edition: QuranTranslationId,
  surah: number,
  ayah: number,
): Promise<string> {
  const map = await loadTranslation(edition);
  return map[String(surah)]?.[String(ayah)] ?? '';
}

/** Fetch the whole surah's translation as an ordered ayah array. */
export async function getSurahTranslation(
  edition: QuranTranslationId,
  surah: number,
): Promise<string[]> {
  const map = await loadTranslation(edition);
  const ayahs = map[String(surah)] ?? {};
  const keys = Object.keys(ayahs)
    .map(k => Number(k))
    .sort((a, b) => a - b);
  return keys.map(k => ayahs[String(k)]);
}
