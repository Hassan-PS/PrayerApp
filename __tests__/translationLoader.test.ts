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


describe('the editions stay out of the JS bundle', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

  it('is not reachable by a require, which is what would re-bundle it', () => {
    // A single static `require()` of one of these files puts ALL of it
    // back: Metro follows a require in any branch unconditionally, which
    // is exactly how thirteen editions came to ship in a bundle that
    // Android then refuses to compress.
    const src = read('src/quran/translations.ts');
    expect(src).not.toMatch(/require\(['"]\.\/data\/translations/);
    expect(src).not.toMatch(/from ['"]\.\/data\/translations/);
    expect(src).toContain('ReactNativeBlobUtil.fs.readFile');
  });

  it('has no source tree left for anything to import', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/quran/data/translations'))).toBe(
      false,
    );
  });

  it('ships every registered edition, and only those', () => {
    // An edition in the registry with no file is a reader with no
    // translation; a file with no registry entry is weight nobody asked
    // for — which is how a 2.4 MB Arabic tafsir sat in the repo for a
    // release after being retired from the list.
    const onDisk = fs
      .readdirSync(path.join(ROOT, 'assets/quran/translations'))
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.replace(/\.json$/, ''))
      .sort();
    const registered = QURAN_TRANSLATIONS.map(e => e.id).sort();
    expect(onDisk).toEqual(registered);
  });

  it('is wired into the Android build as an asset root', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toMatch(/assets\.srcDirs \+= \["\$rootDir\/\.\.\/assets"\]/);
  });

  it('is wired into the iOS build as a copied folder', () => {
    // A folder reference, so the tree lands in the bundle at the same
    // path Android's asset root produces — one loader, two platforms.
    const pbx = read('ios/PrayerApp.xcodeproj/project.pbxproj');
    expect(pbx).toMatch(
      /isa = PBXFileReference; lastKnownFileType = folder; name = quran; path = "\.\.\/assets\/quran"/,
    );
    expect(pbx).toMatch(/[0-9A-F]{24} \/\* quran in Resources \*\//);
  });

  it('asks each platform for its own path', () => {
    const src = read('src/quran/translations.ts');
    expect(src).toMatch(/ReactNativeBlobUtil\.fs\.asset\(file\)/);
    expect(src).toMatch(/ReactNativeBlobUtil\.fs\.dirs\.MainBundleDir/);
  });
});


describe('the Qur’an’s own text stays out of the bundle too', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

  it('reaches a surah by filename, not by a hundred requires', () => {
    // The switch had one `require` per surah under a comment explaining
    // that Metro needs literal paths. It does — and it follows every one
    // of them unconditionally, which is how 2.4 MB of Qur'an ended up in
    // a bundle Android stores without compressing.
    const src = read('src/quran/quran.ts');
    expect(src).not.toMatch(/require\(['"]\.\/data\/surahs/);
    expect(src).toContain(
      "`quran/surahs/${String(n).padStart(3, '0')}.json`",
    );
  });

  it('ships every surah that is not inline', () => {
    // 2..114; al-Fatihah is inline, so the reader's first page needs no
    // read at all.
    const files = fs
      .readdirSync(path.join(ROOT, 'assets/quran/surahs'))
      .filter((f: string) => /^\d{3}\.json$/.test(f))
      .map((f: string) => Number(f.slice(0, 3)))
      .sort((a: number, b: number) => a - b);
    expect(files[0]).toBe(1);
    expect(files[files.length - 1]).toBe(114);
    expect(files).toHaveLength(114);
  });

  it('warms explicitly for the one caller that cannot await', () => {
    // `verifyRiwayahDataset` walks a downloaded muṣḥaf against our corpus
    // inside loops it cannot await, and its callers skip a surah they
    // have no reference for. Unwarmed, that check skips everything —
    // which passes everything, and installs a broken muṣḥaf quietly.
    const dl = read('src/quran/riwayahDownload.ts');
    expect(dl).toMatch(/await warmSurahCache\(\);/);
    expect(dl).toMatch(/finally \{\s*\n\s*releaseSurahCache\(\);/);
  });

  it('counts the holds, so a nested release cannot empty it', () => {
    const src = read('src/quran/quran.ts');
    expect(src).toMatch(/warmHolds = Math\.max\(0, warmHolds - 1\);/);
    expect(src).toMatch(/if \(warmHolds === 0\) warmed\.clear\(\);/);
  });

  it('leaves no source tree behind', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/quran/data/surahs'))).toBe(false);
    // Raw Tanzil input for the import script: reproducible, and the
    // script's own closing instruction is to gitignore it.
    expect(fs.existsSync(path.join(ROOT, 'src/quran/data/source'))).toBe(false);
    expect(read('.gitignore')).toContain('src/quran/data/source/');
  });
});
