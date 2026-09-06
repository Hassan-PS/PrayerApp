/**
 * The shopfront speaks the languages the app does.
 *
 * Both Play and F-Droid build their listing out of
 * `fastlane/metadata/android/<locale>/` — title, short description, full
 * description, screenshots. For a long time exactly one of those existed,
 * `en-US`, while the app itself shipped in thirteen languages. So someone
 * browsing F-Droid's Religion category in Arabic, or searching Play in
 * Turkish, met an English shopfront for an app that would have spoken to
 * them in their own language. The listing is the only part of the product
 * a person reads BEFORE installing, and it was the only part not
 * translated.
 *
 * Worse, the failure is silent in both directions: a missing folder falls
 * back to English and looks like a choice, and a folder present but copied
 * from English looks like a translation. Neither shows up anywhere except
 * by opening the store in that language.
 *
 * ── AND THE TITLE IS NOT A BRAND SLOT ─────────────────────────────────
 *
 * Play weights the title above every other indexed field, and this one
 * read `Mihrab` — six of the thirty characters, and not a word anybody
 * searches for. The comparable app with half a million installs is titled
 * *Namaz Vakti*: the search term, not the brand. Every title here now
 * carries the name AND what the thing is, in the language of the person
 * reading it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const I18N = path.join(ROOT, 'src', 'i18n', 'locales');
const STORE = path.join(ROOT, 'fastlane', 'metadata', 'android');

/**
 * App locale → the directory name Play and F-Droid read it from.
 *
 * Play wants a region on most of these (`de-DE`, not `de`) and refuses a
 * bare language for them; `ar`, `id` and `ur` are the ones it takes plain.
 * F-Droid is happy with either and follows whatever is here. Adding a
 * language to the app means adding a row here — and the first test below
 * is what says so out loud, rather than letting that locale's listing
 * quietly fall back to English.
 */
const STORE_DIR: Record<string, string> = {
  en: 'en-US',
  sv: 'sv-SE',
  ar: 'ar',
  bn: 'bn-BD',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  hi: 'hi-IN',
  id: 'id',
  ru: 'ru-RU',
  tr: 'tr-TR',
  ur: 'ur',
  zh: 'zh-CN',
};

/** Play's hard limits. Over them, the upload is rejected. */
const LIMITS = {
  title: 30,
  short_description: 80,
  full_description: 4000,
} as const;

type Field = keyof typeof LIMITS;
const FIELDS = Object.keys(LIMITS) as Field[];

const APP_LOCALES = readdirSync(I18N)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .sort();

const field = (dir: string, f: Field) =>
  readFileSync(path.join(STORE, dir, `${f}.txt`), 'utf8').trim();

describe('every language the app speaks has a listing', () => {
  it('maps each app locale to a store directory', () => {
    // The app's own locale files are the source of truth: add a language
    // and this fails until the shopfront learns it too.
    expect(APP_LOCALES.filter(l => !STORE_DIR[l])).toEqual([]);
  });

  it.each(APP_LOCALES)('%s has all three listing files', locale => {
    const dir = path.join(STORE, STORE_DIR[locale]);
    expect(existsSync(dir)).toBe(true);
    for (const f of FIELDS) {
      expect(existsSync(path.join(dir, `${f}.txt`))).toBe(true);
    }
  });

  it('has no store directory that belongs to no language', () => {
    // A directory Play uploads from but the app cannot display is a
    // listing nobody maintains.
    const known = new Set(Object.values(STORE_DIR));
    const dirs = readdirSync(STORE).filter(d =>
      statSync(path.join(STORE, d)).isDirectory(),
    );
    expect(dirs.filter(d => !known.has(d))).toEqual([]);
  });
});

describe('every field is inside the limit that would reject the upload', () => {
  it.each(APP_LOCALES.flatMap(l => FIELDS.map(f => [l, f] as const)))(
    '%s %s',
    (locale, f) => {
      const text = field(STORE_DIR[locale], f);
      // Report the overflow rather than a bare false — a failure here is
      // fixed by cutting a specific number of characters.
      expect({
        locale,
        field: f,
        over: Math.max(0, text.length - LIMITS[f]),
      }).toEqual({ locale, field: f, over: 0 });
    },
  );

  it.each(APP_LOCALES)('%s says something in every field', locale => {
    for (const f of FIELDS) {
      expect(field(STORE_DIR[locale], f).length).toBeGreaterThan(10);
    }
  });
});

describe('nothing is silently still in English', () => {
  const nonEnglish = APP_LOCALES.filter(l => l !== 'en');

  it.each(nonEnglish.flatMap(l => FIELDS.map(f => [l, f] as const)))(
    '%s %s is not the English text',
    (locale, f) => {
      // A copied English file is the one failure that looks exactly like
      // success from the outside: the folder is there, the upload works,
      // and the reader gets English anyway.
      expect(field(STORE_DIR[locale], f)).not.toBe(field('en-US', f));
    },
  );
});

describe('the title is not just the app name', () => {
  it.each(APP_LOCALES)('%s carries the name and what it is', locale => {
    const title = field(STORE_DIR[locale], 'title');
    expect(title).not.toBe('Mihrab');
    // Half the field is the floor, not the target: `Mihrab` alone was six
    // characters of thirty and indexed for nothing.
    expect(title.length).toBeGreaterThanOrEqual(12);
  });
});

describe('the per-release translation cost stays at three languages', () => {
  // Play and F-Droid fall back to en-US for "What's New" when a locale has
  // no changelog, which is the right trade: the listing is written once and
  // the changelog is written every release. release.sh gates on these three
  // and only these three.
  it.each(['en-US', 'sv-SE', 'ar'])('%s keeps its changelogs', dir => {
    expect(existsSync(path.join(STORE, dir, 'changelogs'))).toBe(true);
  });

  it('does not quietly acquire a fourth', () => {
    const withChangelogs = Object.values(STORE_DIR)
      .filter(d => existsSync(path.join(STORE, d, 'changelogs')))
      .sort();
    // If this grows, release.sh's LOCALES has to grow with it — otherwise a
    // locale carries a changelog that stops being written.
    expect(withChangelogs).toEqual(['ar', 'en-US', 'sv-SE']);
  });
});
