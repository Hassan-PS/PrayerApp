/**
 * The translation loader, now that it is a loader.
 *
 * Eighteen of the JS bundle's twenty-six megabytes are translation
 * editions, and `assets/index.android.bundle` is STORED in the APK —
 * Android does not compress a `.bundle`, so those megabytes are paid at
 * full price on every download. The same JSON as an ordinary asset gzips
 * to about a quarter of that.
 *
 * Moving them means reading a file, and reading a file is asynchronous.
 * This suite covers the step that has to come first: the signature
 * changing while the body still returns the bundled data, so every
 * caller can be moved and proven before the data goes anywhere.
 *
 * It also covers the thing that quietly disappears in the move. Metro's
 * require cache is what made a synchronous call in a render body free
 * after the first ayah; a disk read has no such cache, and three call
 * sites were doing exactly that.
 */
import {
  loadTranslation,
  getAyahTranslation,
  getSurahTranslation,
  _clearTranslationCache,
  QURAN_TRANSLATIONS,
  type QuranTranslationId,
} from '../src/quran/translations';

const EDITION = 'en.sahih' as QuranTranslationId;

beforeEach(() => _clearTranslationCache());

describe('the reads still return what they always did', () => {
  it('gives an ayah its text', async () => {
    // Al-Fatiha 1 — the one line every edition has.
    const text = await getAyahTranslation(EDITION, 1, 1);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(10);
  });

  it('gives a surah its ayahs, in order and complete', async () => {
    const fatiha = await getSurahTranslation(EDITION, 1);
    expect(fatiha).toHaveLength(7);
    for (const line of fatiha) expect(line.length).toBeGreaterThan(0);
  });

  it('is empty rather than throwing for an ayah that is not there', async () => {
    expect(await getAyahTranslation(EDITION, 1, 999)).toBe('');
    expect(await getSurahTranslation(EDITION, 999)).toEqual([]);
  });

  it('falls back rather than throwing for an edition that is not there', async () => {
    const map = await loadTranslation('not.an.edition' as QuranTranslationId);
    expect(map['1']?.['1']).toBeTruthy();
  });

  it('carries the whole Qur’an, not a sample', async () => {
    const map = await loadTranslation(EDITION);
    expect(Object.keys(map)).toHaveLength(114);
    const total = Object.values(map).reduce(
      (n, chapter) => n + Object.keys(chapter).length,
      0,
    );
    expect(total).toBe(6236);
  });
});

describe('the cache that Metro used to provide', () => {
  it('reads an edition once, however many ayahs are asked for', async () => {
    // The render-path callers asked per ayah. Without a cache that is a
    // megabyte re-read per render.
    const first = await loadTranslation(EDITION);
    await getAyahTranslation(EDITION, 2, 255);
    await getAyahTranslation(EDITION, 36, 1);
    const again = await loadTranslation(EDITION);
    expect(again).toBe(first);
  });

  it('does one read for callers that arrive together', async () => {
    // A screen can mount three components wanting the same edition in
    // the same tick.
    const [a, b, c] = await Promise.all([
      loadTranslation(EDITION),
      loadTranslation(EDITION),
      loadTranslation(EDITION),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('holds one edition, not a library of them', async () => {
    // A reader has a translation. Keeping every edition somebody ever
    // opened is the habit this whole change exists to break.
    const en = await loadTranslation(EDITION);
    const other = QURAN_TRANSLATIONS.find(e => e.id !== EDITION)!;
    await loadTranslation(other.id as QuranTranslationId);
    const enAgain = await loadTranslation(EDITION);
    expect(enAgain).toEqual(en);
  });

  it('can be emptied', async () => {
    await loadTranslation(EDITION);
    _clearTranslationCache();
    const after = await loadTranslation(EDITION);
    expect(after['1']?.['1']).toBeTruthy();
  });
});

describe('nothing reads a translation during a render any more', () => {
  const read = (p: string) =>
    require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf-8');

  it.each([
    'src/quran/mushaf/AyahActionSheet.tsx',
    'src/screens/home/QuranCard.tsx',
    'src/screens/QuranScreen.tsx',
  ])('%s fetches it into state instead', (file: string) => {
    const src = read(file);
    // Every call is awaited or thenned — none is assigned straight to a
    // const in a render body, which is what a promise rendered as text
    // looks like just before it is a bug.
    const calls = [...src.matchAll(/getAyahTranslation\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/const \w+ = getAyahTranslation\(/);
    expect(src).toMatch(/getAyahTranslation\([\s\S]{0,120}?\)\s*\n?\s*\.then|await getAyahTranslation\(/);
  });

  it('shares the fetched text rather than whatever state holds', () => {
    // An ayah shared without its translation cannot be corrected after
    // it has been sent.
    const src = read('src/quran/mushaf/AyahActionSheet.tsx');
    expect(src).toMatch(
      /const text =\s*\n?\s*translation \|\|\s*\n?\s*\(await getAyahTranslation\(/,
    );
  });
});
