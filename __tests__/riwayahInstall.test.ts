/**
 * Getting a muṣḥaf onto a device, and off it again.
 *
 * The app ships no riwayah text (`src/quran/riwayahStore.ts`), so this
 * path — verify, write, cache, read back, erase — IS the feature. Two
 * things in it are easy to get quietly wrong and expensive to discover:
 *
 *   • a half-written install that reads as present. The store writes the
 *     provenance LAST for exactly this reason, and hydration treats a
 *     dataset without one as absent.
 *   • a stored preference that gets overwritten because the data has not
 *     been read off disk yet. That is why `coerceRiwayahId` exists next
 *     to `resolveRiwayah`, and it is the last test here.
 */
import * as BlobUtil from 'react-native-blob-util';
import { TOTAL_AYAHS } from '../src/quran/ayahIndex';
import { MUSHAF_PAGES } from '../src/quran/pages';
import {
  SURAHS,
  bundledSurahArabic,
  warmSurahCache,
} from '../src/quran/quran';
import { installRiwayahFromText } from '../src/quran/riwayahDownload';
import {
  _resetRiwayahDataCacheForTests,
  hydrateRiwayahData,
  loadRiwayahPages,
  loadRiwayahText,
  riwayahProvenance,
  uninstallRiwayah,
} from '../src/quran/riwayahData';
import { riwayahDir } from '../src/quran/riwayahStore';
import {
  availableRiwayat,
  coerceRiwayahId,
  resolveRiwayah,
  riwayahAvailable,
  riwayahChoiceExists,
} from '../src/quran/riwayat';

/*
 * The Qur'an corpus is read from disk now rather than compiled into the
 * bundle, so a synchronous walk over it has to be warmed first — which is
 * exactly what `installRiwayahFromText` does around its own verification.
 * These suites build fixtures from the same corpus, so they warm it too.
 */
beforeAll(async () => {
  await warmSurahCache();
});


const BASMALAH = /^بِسْمِ\s*ٱللَّهِ\s*ٱلرَّحْمَٰنِ\s*ٱلرَّحِيمِ\s*/;

const cmp = (
  a: { surah: number; ayah: number },
  b: { surah: number; ayah: number },
) => (a.surah !== b.surah ? a.surah - b.surah : a.ayah - b.ayah);

function pageMeta(surah: number, ayah: number) {
  for (const p of MUSHAF_PAGES) {
    const afterStart = cmp(p.start, { surah, ayah }) <= 0;
    const beforeEnd = p.end ? cmp(p.end, { surah, ayah }) > 0 : true;
    if (afterStart && beforeEnd) return { page: p.page, juz: p.juz };
  }
  return { page: 604, juz: 30 };
}

/**
 * A dataset built from the Qur'an the app already ships.
 *
 * It used to be placeholder Arabic, and `juzCheck.ts` now refuses that —
 * correctly, and it caught this file on the first run. A test fixture that
 * is fake scripture is the same mistake as a dataset that is, just with
 * nobody reading it; the fix is to test the install path with the real
 * text rather than to exempt tests from the check.
 */
function wholeQuran(): string {
  const out = [];
  for (let s = 1; s <= 114; s++) {
    const arabic = bundledSurahArabic(s) ?? [];
    for (let a = 1; a <= SURAHS[s - 1].ayahCount; a++) {
      let text = arabic[a - 1] ?? '';
      if (a === 1 && s !== 9 && s !== 1) text = text.replace(BASMALAH, '');
      const meta = pageMeta(s, a);
      out.push({
        verse_key: `${s}:${a}`,
        text,
        page_number: meta.page,
        juz_number: meta.juz,
      });
    }
  }
  return JSON.stringify(out);
}

/**
 * The mock filesystem behind react-native-blob-util (jest.setup.js).
 *
 * Reached through the namespace, not the default export: the mock hangs
 * `__files` beside `default`, so importing the default alone gets the
 * store's API and none of the trapdoor these tests need.
 */
const files = (
  BlobUtil as unknown as { __files: Map<string, string> }
).__files;

beforeEach(() => {
  files?.clear();
  _resetRiwayahDataCacheForTests();
});

describe('installing a muṣḥaf', () => {
  it('offers Hafs and nothing else until one arrives', async () => {
    await hydrateRiwayahData();
    expect(riwayahAvailable('warsh')).toBe(false);
    expect(riwayahChoiceExists()).toBe(false);
    expect(availableRiwayat().map(r => r.id)).toEqual(['hafs']);
  });

  it('verifies, stores and makes it drawable', async () => {
    const result = await installRiwayahFromText(
      'warsh',
      wholeQuran(),
      'https://example.test/warsh.json',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.ayahs).toBe(TOTAL_AYAHS);
    expect(result.provenance.pages).toBe(604);
    expect(result.provenance.from).toBe('https://example.test/warsh.json');

    expect(riwayahAvailable('warsh')).toBe(true);
    expect(riwayahChoiceExists()).toBe(true);
    expect(loadRiwayahPages('warsh')?.pages).toHaveLength(604);
    expect(loadRiwayahText('warsh')?.['2:255']).toBeTruthy();
  });

  it('writes files a fresh process can read back', async () => {
    await installRiwayahFromText('warsh', wholeQuran(), 'https://a.test/x');
    // Forget everything in memory — this is the next cold start.
    _resetRiwayahDataCacheForTests();
    expect(loadRiwayahPages('warsh')).toBeNull();
    await hydrateRiwayahData();
    expect(loadRiwayahPages('warsh')?.pages).toHaveLength(604);
    expect(riwayahProvenance('warsh')?.from).toBe('https://a.test/x');
  });

  it('treats an install with no provenance as absent', async () => {
    await installRiwayahFromText('warsh', wholeQuran(), 'https://a.test/x');
    // Exactly what an interrupted write leaves behind: the data, but no
    // record of where it came from. A muṣḥaf nobody can account for is
    // not one to draw.
    files.delete(`${riwayahDir('warsh')}/source.json`);
    _resetRiwayahDataCacheForTests();
    await hydrateRiwayahData();
    expect(riwayahAvailable('warsh')).toBe(false);
  });

  it('treats a pagination with no text as absent', async () => {
    await installRiwayahFromText('warsh', wholeQuran(), 'https://a.test/x');
    files.delete(`${riwayahDir('warsh')}/text.json`);
    _resetRiwayahDataCacheForTests();
    await hydrateRiwayahData();
    expect(riwayahAvailable('warsh')).toBe(false);
  });

  it('stores nothing at all when the file is not a Qur’an', async () => {
    const short = JSON.parse(wholeQuran()).slice(0, 100);
    const result = await installRiwayahFromText(
      'warsh',
      JSON.stringify(short),
      'https://a.test/x',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.key).toBe('quran.riwayahNotAQuran');
    // The verifier's own words come through, because "it did not work" is
    // not something a reader can act on.
    expect(result.error.detail).toMatch(/expected 114 surahs, found 2/);
    expect(riwayahAvailable('warsh')).toBe(false);
    expect(files.size).toBe(0);
  });

  it('says so plainly when the file is not data at all', async () => {
    const result = await installRiwayahFromText('warsh', 'nonsense', 'x');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.key).toBe('quran.riwayahNotJson');
  });

  it('removes it completely', async () => {
    await installRiwayahFromText('warsh', wholeQuran(), 'https://a.test/x');
    await uninstallRiwayah('warsh');
    expect(riwayahAvailable('warsh')).toBe(false);
    expect(riwayahProvenance('warsh')).toBeNull();
    _resetRiwayahDataCacheForTests();
    await hydrateRiwayahData();
    expect(riwayahAvailable('warsh')).toBe(false);
  });
});

describe('a stored preference and what can be drawn', () => {
  it('keeps the choice when the data has not been read yet', () => {
    // The race this guards: the muṣḥaf is on disk, but hydration has not
    // finished. `resolveRiwayah` correctly says "draw Hafs for now";
    // `coerceRiwayahId` must NOT, because its answer is what gets written
    // back to storage, and writing Hafs here would revert the reader's
    // choice by a race they could never see.
    expect(resolveRiwayah('warsh')).toBe('hafs');
    expect(coerceRiwayahId('warsh')).toBe('warsh');
  });

  it('drops an id no version of the app knows', () => {
    expect(coerceRiwayahId('qaloon-typo')).toBe('hafs');
    expect(coerceRiwayahId(null)).toBe('hafs');
    expect(coerceRiwayahId(undefined)).toBe('hafs');
  });

  it('draws it once it is there', async () => {
    await installRiwayahFromText('warsh', wholeQuran(), 'https://a.test/x');
    expect(resolveRiwayah('warsh')).toBe('warsh');
  });
});
