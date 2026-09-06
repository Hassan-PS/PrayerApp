/**
 * The bells on the Today card line up, whatever the times say.
 *
 * The alert control sits beside the time on the inner side, and the time
 * column used to be as wide as its own time. On a 12-hour clock that is
 * not one width: "11:09 PM" is a digit wider than "5:36 AM", so the one
 * row with a two-digit hour pushed its bell a digit to the left of the
 * other six, and a column of controls read as a ragged edge.
 *
 * The fix is a sizing sample — the longest time on the card, rendered
 * invisibly on every row — with the real time laid over it at the
 * trailing edge. What is pinned here is that the column is the same width
 * on every row of a card, that the chosen dot's slot is held whether or
 * not the dot is drawn, and that the sample never reaches a screen
 * reader.
 *
 * ── AND THEN LONGEST STOPPED MEANING WIDEST (issue #26) ───────────────
 *
 * The card picks the sample by string LENGTH, which is a stand-in for
 * width only while the numerals are tabular. `tabular-nums` is a request
 * to the font, and Android lets people choose a system font that ships no
 * `tnum` table. On a handwriting font the column was sized by "00:46" and
 * had to hold "02:23" — wider in that face — so the clock wrapped mid-value
 * onto a second line, on those rows only. Reported with a screenshot,
 * 2026-09-06.
 *
 * So a row now uses the sample only when it is genuinely longer than the
 * row's own time, and neither text may wrap. The last three tests hold
 * that.
 */
import * as React from 'react';
import { act } from 'react';
import { Text, View } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('../src/hooks/useAppPalette', () => ({
  useAppPalette: () => ({
    isDark: false,
    palette: {
      isDark: false,
      bg: '#FFFFFF',
      card: '#F5F5F5',
      text: '#111111',
      muted: '#666666',
      border: '#DDDDDD',
      accent: '#0F5132',
      accentSolid: '#0F5132',
      accentBg: '#E7F0EA',
      overlay: 'rgba(0,0,0,0.4)',
      danger: '#B91C1C',
    },
  }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A 12-hour clock, because that is the format the column had to be built
// for: the 24-hour one is the same width on every row and never showed
// the bug.
jest.mock('../src/hooks/useClockFormatter', () => ({
  useClockFormatter: () => {
    const fmt = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      const suffix = h < 12 ? 'AM' : 'PM';
      const hour = h % 12 === 0 ? 12 : h % 12;
      return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
    };
    return Object.assign(fmt, { fromDate: () => '' });
  },
}));

import { PrayerRow } from '../src/screens/home/PrayerRow';

const SAMPLE = '11:09 PM';

function renderRow(over: Record<string, unknown> = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <PrayerRow
        prayerKey="Fajr"
        rawTime="05:36"
        isNext={false}
        isSecondary={false}
        isLast={false}
        alertMode="notification"
        onCycleAlertMode={() => {}}
        timeSample={SAMPLE}
        {...over}
      />,
    );
  });
  return tree;
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const texts = (tree: ReactTestRenderer) => tree.root.findAllByType(Text);

describe('the time column is the card’s width, not the row’s', () => {
  it('sizes every row with the same sample, whatever that row shows', () => {
    for (const rawTime of ['05:36', '23:09', '13:34']) {
      const tree = renderRow({ rawTime });
      const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
      expect(sample).toBeDefined();
      expect(sample!.props.children).toBe(SAMPLE);
    }
  });

  it('falls back to its own time when no sample is given', () => {
    // A row rendered outside a card — the share sheet, a test — must not
    // collapse to a zero-width column.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <PrayerRow
          prayerKey="Fajr"
          rawTime="05:36"
          isNext={false}
          isSecondary={false}
          isLast={false}
        />,
      );
    });
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    expect(sample!.props.children).toBe('5:36 AM');
  });

  it('lays the real time on the trailing edge, not the right one', () => {
    // `end`, so Arabic and Urdu flush it left without a second rule.
    const tree = renderRow();
    const real = texts(tree).find(
      n => flat(n.props.style).position === 'absolute',
    );
    expect(real).toBeDefined();
    expect(flat(real!.props.style).end).toBe(0);
    expect(flat(real!.props.style)).not.toHaveProperty('right');
    expect(real!.props.children).toBe('5:36 AM');
  });

  it('sizes the sample at the heaviest weight the column ever uses', () => {
    // The next prayer's time is bold. A sample measured at the lighter
    // weight could be narrower than the text laid over it.
    const tree = renderRow({ isNext: true });
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    const real = texts(tree).find(
      n => flat(n.props.style).position === 'absolute',
    );
    expect(flat(sample!.props.style).fontWeight).toBe('700');
    expect(flat(real!.props.style).fontWeight).toBe('700');
  });

  it('keeps the sample away from a screen reader', () => {
    const tree = renderRow();
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    expect(sample!.props.accessible).toBe(false);
    expect(sample!.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  // ── issue #26 ──────────────────────────────────────────────────────

  it('sizes to its own time when the sample is no longer than it', () => {
    // "10:23 PM" and "11:09 PM" are the same LENGTH and, in a font with
    // no tnum table, not the same width. Sizing this row by the sample
    // is what pushed the real time onto a second line, so at equal
    // length the row measures what it is actually going to draw.
    const tree = renderRow({ rawTime: '22:23' });
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    expect(sample!.props.children).toBe('10:23 PM');
    expect(sample!.props.children).not.toBe(SAMPLE);
  });

  it('still defers to the sample when the sample really is longer', () => {
    // The original defect must not come back: at unequal lengths the
    // card's sample is the one that decides, so the bells stay in line.
    const tree = renderRow({ rawTime: '05:36' });
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    expect(sample!.props.children).toBe(SAMPLE);
  });

  it('never lets a clock wrap onto a second line', () => {
    // The backstop. Whatever the font does with the request for tabular
    // figures, a prayer time is one line or it is wrong.
    const tree = renderRow({ rawTime: '22:23' });
    const sample = texts(tree).find(n => flat(n.props.style).opacity === 0);
    const real = texts(tree).find(
      n => flat(n.props.style).position === 'absolute',
    );
    expect(sample!.props.numberOfLines).toBe(1);
    expect(real!.props.numberOfLines).toBe(1);
  });

  it('holds the chosen dot’s slot on a row that has no dot', () => {
    // The slot carries the spacing between the control and the time. If
    // it appeared only on the chosen row, that row's control would sit
    // 13pt left of every other — the bug, in a second guise.
    const slotOf = (tree: ReactTestRenderer) => {
      const found = tree.root
        .findAllByType(View)
        .map(n => flat(n.props.style))
        .find(s => s.width === 6 && s.height === 6);
      expect(found).toBeDefined();
      return found!;
    };
    const plain = slotOf(renderRow());
    const chosen = slotOf(renderRow({ isChosen: true }));
    expect(plain.marginStart).toBe(chosen.marginStart);
    expect(plain.marginEnd).toBe(chosen.marginEnd);
    expect(plain.backgroundColor).toBe('transparent');
    expect(chosen.backgroundColor).toBe('#0F5132');
  });
});
