/**
 * Sending a dua or a tafsir passage out of the app — issue #24.
 *
 * "There are times when we may want to share the text with a friend or
 * family member, or simply send it to another app." An ayah could already
 * be sent as text; a dua and a tafsir passage could not.
 *
 * What is held here is mostly one rule. CLAUDE.md §4 says religious
 * content must be sourced and attributed, and that rule is easy to keep on
 * a screen — the source line is drawn beside the text and nobody has to
 * remember it. It is easy to LOSE in a share body, which is assembled by
 * hand and then travels without the app around it. A dua pasted into a
 * family group with no source is a claim about the religion with nothing
 * behind it, and the person who receives it has no way back to where it
 * came from.
 */
import * as React from 'react';
import { act } from 'react';
import { create } from 'react-test-renderer';
import { Share } from 'react-native';
import fs from 'fs';
import path from 'path';
import {
  ayahShareText,
  duaShareText,
  tafsirShareText,
} from '../src/share/shareText';

const DUA = {
  title: 'Ayat al-Kursi',
  arabic: 'ٱللَّهُ لَا إِلَٰهَ إِلَّا هُوَ',
  transliteration: 'Allāhu lā ilāha illā huwa',
  translation: 'Allah — there is no god but He',
  source: 'Quran 2:255 — narrated by al-Hakim and Ibn Hibban',
};

describe('attribution is not optional', () => {
  it('refuses to build a dua body with no source', () => {
    expect(() => duaShareText({ ...DUA, source: '' })).toThrow(/unattributed/);
    // Whitespace is not a source either.
    expect(() => duaShareText({ ...DUA, source: '   ' })).toThrow();
  });

  it('refuses an ayah with no reference', () => {
    expect(() =>
      ayahShareText({ arabic: 'ا', translation: 'a', reference: '' }),
    ).toThrow(/unattributed/);
  });

  it('refuses a tafsir passage crediting nobody', () => {
    // Both halves are required by construction: the edition alone does not
    // say which ayah is explained, and the ayah alone credits a classical
    // commentary to no one.
    expect(() =>
      tafsirShareText({ text: 'x', edition: '', reference: '' }),
    ).toThrow(/unattributed/);
  });
});

describe('what a dua looks like when it arrives', () => {
  const body = duaShareText(DUA);

  it('carries the title, the Arabic, the pronunciation and the meaning', () => {
    for (const part of [
      DUA.title,
      DUA.arabic,
      DUA.transliteration,
      DUA.translation,
    ]) {
      expect(body).toContain(part);
    }
  });

  it('takes the transliteration with it', () => {
    // It is an aid behind a toggle on screen, not part of the text. But
    // the point of sending a dua is that the recipient can say it, and
    // someone who does not read Arabic cannot say it from the Arabic.
    expect(body).toContain(DUA.transliteration);
  });

  it('ends with the source, behind an em dash', () => {
    expect(body.trimEnd().endsWith(`— ${DUA.source}`)).toBe(true);
  });

  it('drops an empty field rather than leaving a hole', () => {
    const noTranslit = duaShareText({ ...DUA, transliteration: '' });
    expect(noTranslit).not.toMatch(/\n\n\n/);
    expect(noTranslit).toContain(DUA.arabic);
  });
});

describe('what a tafsir passage looks like when it arrives', () => {
  const body = tafsirShareText({
    text: 'The Throne Verse is the greatest verse in the Quran.',
    edition: 'Ibn Kathir (abridged)',
    reference: 'Al-Baqarah 2:255',
  });

  it('names the edition and the ayah it explains', () => {
    expect(body).toContain('Ibn Kathir (abridged)');
    expect(body).toContain('Al-Baqarah 2:255');
  });

  it('puts both in one attribution line at the end', () => {
    expect(
      body.trimEnd().endsWith('— Ibn Kathir (abridged), Al-Baqarah 2:255'),
    ).toBe(true);
  });
});

describe('the ayah body the refactor inherited', () => {
  // The ayah share already existed and its format is what the other two
  // were written to match. It must not have changed shape on the way into
  // the shared builder.
  it('is still arabic, translation, then the reference', () => {
    expect(
      ayahShareText({
        arabic: 'ا',
        translation: 'a translation',
        reference: 'Al-Baqarah 2:255',
      }),
    ).toBe('ا\n\na translation\n\n— Al-Baqarah 2:255');
  });
});

// ── the screens that call them ──────────────────────────────────────────

jest.mock('../src/hooks/useAppPalette', () => ({
  useAppPalette: () => ({
    isDark: false,
    palette: {
      bg: '#fff',
      card: '#eee',
      text: '#111',
      muted: '#666',
      border: '#ddd',
      accent: '#0F5132',
      accentSolid: '#0F5132',
      accentBg: '#E7F0EA',
    },
  }),
}));
jest.mock('../src/navigation/useAndroidSubScreenBack', () => ({
  useAndroidSubScreenBack: () => {},
}));
// A deterministic `t`: the bundled English falls through, so the body
// under test is the one an English reader would actually send.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useScrollToTop: () => {},
}));
jest.mock('../src/navigation/tabBarInset', () => ({ useTabBarInset: () => 0 }));
jest.mock('../src/navigation/tabBarVisibility', () => ({
  useTabBarScroll: () => ({}),
}));

import { DuasScreen } from '../src/screens/DuasScreen';
import { DUAS } from '../src/duas/duas';

describe('the dua card’s share control', () => {
  it('hands the system sheet a body with the dua’s own source in it', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({
      action: 'sharedAction',
    } as never);
    try {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<DuasScreen />);
      });
      // By label and handler, not by `findAllByType(Pressable)`: RN's
      // Pressable renders through a wrapper, so the exported component is
      // not the type the tree carries. The node that owns the press is the
      // one with an `onPress`.
      const buttons = tree.root.findAll(
        n =>
          String(n.props?.accessibilityLabel ?? '').startsWith('Share ') &&
          typeof n.props?.onPress === 'function',
      );
      expect(buttons.length).toBeGreaterThan(0);

      await act(async () => {
        buttons[0].props.onPress();
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const message = (spy.mock.calls[0][0] as { message: string }).message;
      // Whichever dua the first card is, its own citation has to be in
      // there — the field the data model marks "NEVER omit".
      const first = DUAS.find(d => message.includes(d.arabic));
      expect(first).toBeDefined();
      expect(message).toContain(first!.source);
      expect(message).toContain(first!.transliteration);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the tafsir share control', () => {
  const sheet = fs.readFileSync(
    path.join(__dirname, '..', 'src/quran/mushaf/AyahActionSheet.tsx'),
    'utf8',
  );

  it('shares the passage, credited to the edition on screen', () => {
    const fn = sheet.slice(sheet.indexOf('const shareTafsir'));
    expect(fn).toContain('tafsirShareText({');
    // The edition the reader actually has selected, not the default —
    // the chips above the passage can change it.
    expect(fn.slice(0, fn.indexOf('};'))).toContain(
      'edition: tafsirEdition.label',
    );
    expect(fn.slice(0, fn.indexOf('};'))).toContain('reference,');
  });

  it('is its own action, not a third format of the ayah share', () => {
    // The ayah share is deliberately "one action with two FORMATS".
    // Tafsir is not another format of the ayah; it is a different text by
    // a different author that happens to be shown underneath.
    const share = sheet.slice(
      sheet.indexOf('const share = () =>'),
      sheet.indexOf('const shareText = async'),
    );
    expect(share).not.toContain('tafsir');
  });
});
