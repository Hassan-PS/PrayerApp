/**
 * One tap, back into the recitation — issue #25.
 *
 * "The current process to resume reading is a little long. Each time, we
 * need to find the bookmarked position, load the audio, and then start the
 * playback manually." The Continue Reading widget already knew the
 * position; what it could not do was arrive out loud.
 *
 * The path has three parts. The widget sends `playFromAyah`, the route
 * table carries it (`linking.test.ts`), and the surah screen turns it into
 * sound — exactly once. Params outlive a render, and a queue that restarted
 * on every theme change or rotation would keep throwing a listener back to
 * where they came in.
 */
import * as React from 'react';
import { act } from 'react';
import { create } from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

const mockPlayFromAyah = jest.fn(async () => {});
let mockRouteParams: Record<string, unknown> = { surahNumber: 2 };

jest.mock('../src/quran/audio/playback', () => ({
  playFromAyah: (...args: unknown[]) => mockPlayFromAyah(...(args as [])),
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ params: mockRouteParams, key: 'QuranSurah-test' }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

jest.mock('../src/hooks/useAppPalette', () => ({
  useAppPalette: () => ({
    isDark: false,
    palette: { bg: '#fff', muted: '#666' },
  }),
}));

jest.mock('../src/context/PrayerSettingsContext', () => ({
  usePrayerSettings: () => ({
    settings: { quranReadingMode: 'mushaf' },
    updateSettings: jest.fn(),
  }),
}));

// The readers are not what is under test, and each drags in the page
// renderer, the font store and the audio sheet.
jest.mock('../src/screens/quran/MushafSurahScreen', () => ({
  MushafSurahScreen: () => null,
}));
jest.mock('../src/screens/quran/TranslationSurahScreen', () => ({
  TranslationSurahScreen: () => null,
}));
jest.mock('../src/quran/riwayahData', () => ({
  hydrateRiwayahData: jest.fn(async () => {}),
}));

// Wants a real navigator above it; the back gesture is not what is under
// test.
jest.mock('../src/navigation/useAndroidSubScreenBack', () => ({
  useAndroidSubScreenBack: () => {},
}));

import { QuranSurahScreen } from '../src/screens/QuranSurahScreen';

function render() {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<QuranSurahScreen />);
  });
  return tree;
}

describe('arriving with recitation asked for', () => {
  beforeEach(() => {
    mockPlayFromAyah.mockClear();
    mockRouteParams = { surahNumber: 2 };
  });

  it('recites from the ayah the link named', () => {
    mockRouteParams = { surahNumber: 7, initialPage: 154, playFromAyah: 22 };
    render();
    expect(mockPlayFromAyah).toHaveBeenCalledTimes(1);
    // The ayah, not the page. A muṣḥaf link opens on a page and recites
    // from an ayah; confusing the two would start the audio in the wrong
    // place entirely.
    expect(mockPlayFromAyah).toHaveBeenCalledWith(7, 22);
  });

  it('stays silent when the link did not ask', () => {
    mockRouteParams = { surahNumber: 2, initialPage: 3 };
    render();
    expect(mockPlayFromAyah).not.toHaveBeenCalled();
  });

  it('does not start again when the effect is run twice', () => {
    // StrictMode mounts an effect, tears it down and mounts it again — the
    // shape of every "why did this fire twice" bug, and here it would mean
    // the queue rebuilding from the top a moment after it started. The ref
    // is what makes the second run a no-op; the dependency array alone
    // would not, because nothing about the request has changed.
    mockRouteParams = { surahNumber: 7, initialPage: 154, playFromAyah: 22 };
    act(() => {
      create(
        <React.StrictMode>
          <QuranSurahScreen />
        </React.StrictMode>,
      );
    });
    expect(mockPlayFromAyah).toHaveBeenCalledTimes(1);
  });

  it('never lets recitation break the page', async () => {
    // Best-effort by design: an ayah the network will not give up is the
    // audio layer's problem to report, not a reason to leave a reader
    // looking at nothing.
    mockPlayFromAyah.mockRejectedValueOnce(new Error('no audio'));
    mockRouteParams = { surahNumber: 7, initialPage: 154, playFromAyah: 22 };
    expect(() => render()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
  });
});

// ── the two widgets that send it ────────────────────────────────────────

const REPO = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('the Android reading widget', () => {
  const kotlin = read(
    'android/app/src/main/java/com/prayer_times/PrayerWidgetReadingProvider.kt',
  );

  it('sends the play position from the play control', () => {
    const play = kotlin.slice(kotlin.indexOf('private fun playIntent'));
    expect(play).toContain('playFromAyah=$ayah');
  });

  it('leaves the card’s own tap silent', () => {
    // The whole design: a tap opens the page as it always did, and only
    // the disc beside the surah name makes a sound. Pinned as the two URL
    // templates rather than by slicing the file between functions — the
    // prose around these explains the param, and prose is not behaviour.
    expect(kotlin).toContain('Uri.parse("mihrab://read/$surah?$position")');
    expect(kotlin).toContain(
      'Uri.parse("mihrab://read/$surah?$position&playFromAyah=$ayah")',
    );
    // One sender, so the card's tap cannot have quietly grown one.
    expect(kotlin.match(/playFromAyah=\$ayah/g)).toHaveLength(1);
  });

  it('offers nothing to resume when there is nothing to resume', () => {
    // Two dead ends: a stale payload with no position in it, and a reader
    // who has never opened the Quran. A play button in either would recite
    // Al-Fatiha at someone who asked for nothing.
    const hides = kotlin.match(
      /setViewVisibility\(R\.id\.reading_play, View\.GONE\)/g,
    );
    expect(hides).toHaveLength(2);
  });

  it('draws the control in the layout, hidden until it is earned', () => {
    const layout = read(
      'android/app/src/main/res/layout/prayer_widget_reading.xml',
    );
    expect(layout).toContain('@+id/reading_play');
    expect(layout).toContain('@drawable/ic_widget_play');
    const control = layout.slice(layout.indexOf('@+id/reading_play'));
    expect(control.slice(0, control.indexOf('/>'))).toContain(
      'android:visibility="gone"',
    );
  });
});

describe('the iOS reading widget', () => {
  const swift = read('ios/PrayerWidgetExtension/ReadingWidget.swift');

  it('sends the play position too', () => {
    const play = swift.slice(swift.indexOf('private func playURL'));
    expect(play).toContain('playFromAyah=');
  });

  it('leaves its own tap silent', () => {
    expect(swift).toContain(
      'return URL(string: "mihrab://read/\\(r.surah)?\\(position)")',
    );
    expect(swift).toContain(
      'return URL(string: "mihrab://read/\\(r.surah)?\\(position)&playFromAyah=\\(r.ayah)")',
    );
    expect(swift.match(/playFromAyah=/g)).toHaveLength(1);
  });

  it('puts the control only where a Link is honoured', () => {
    // systemSmall and both accessory families route every tap to
    // `widgetURL`, so a play button drawn there would quietly open the
    // reader instead of playing. It exists on systemMedium alone.
    const medium = swift.slice(
      swift.indexOf('private var mediumBody'),
      swift.indexOf('private func progressBar'),
    );
    expect(medium).toContain('Link(destination: play)');

    const small = swift.slice(
      swift.indexOf('private var smallBody'),
      swift.indexOf('private var mediumBody'),
    );
    expect(small).not.toContain('Link(');
  });
});

describe('the label it is announced by', () => {
  const LOCALE_DIRS = [
    'values',
    'values-ar',
    'values-bn',
    'values-de',
    'values-es',
    'values-fr',
    'values-hi',
    'values-in',
    'values-ru',
    'values-sv',
    'values-tr',
    'values-ur',
    'values-zh',
  ];

  it('exists in all thirteen languages', () => {
    // A widget control with no content description is a button a screen
    // reader calls "image".
    const missing = LOCALE_DIRS.filter(
      dir =>
        !read(`android/app/src/main/res/${dir}/strings.xml`).includes(
          'name="widget_reading_play"',
        ),
    );
    expect(missing).toEqual([]);
  });

  it('borrows the wording the app already uses', () => {
    // `quran.playFromHere` is what the ayah action sheet says. One
    // vocabulary, translated once, so the two cannot drift.
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(
      `<string name="widget_reading_play">${en.quran.playFromHere}</string>`,
    );
  });
});
