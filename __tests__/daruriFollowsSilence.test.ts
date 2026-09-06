/**
 * A boundary belongs to its prayer, and follows it into silence.
 *
 * `silent` on a home row means no alarm is registered — not a muted one.
 * That is the reading which also keeps the prayer off the lock screen,
 * and the pre-prayer reminder already obeys it. The Mālikī
 * ikhtiyārī-window alerts did not: they were built from their own
 * opt-in list and never asked what the prayer was set to. So someone who
 * silenced Fajr to avoid being woken at 04:30 was woken at 05:00 instead
 * by "Fajr's first time ends at 05:15" — an alert about the prayer they
 * had just switched off, in the same sleep.
 *
 * The two opt-ins pull in opposite directions and the more specific one
 * wins: turning a boundary alert on is a standing choice about a
 * boundary; silencing a prayer is a choice about that prayer. The app
 * ends up with one meaning for silence instead of two.
 *
 * This is what the Live Activity's one-occurrence override rides on top
 * of — the predicate is asked per prayer AND per instant, so silencing
 * tonight's Ishāʾ silences tonight's boundary and says nothing about
 * tomorrow's.
 */
import {
  buildDaruriAlertEvents,
  buildDaruriEndEvents,
  DARURI_OF,
  type DaruriKey,
} from '../src/prayer/daruriTimes';
import type { TimingsMap } from '../src/types/prayer';

const day: TimingsMap = {
  Fajr: '05:00',
  Sunrise: '06:30',
  Dhuhr: '12:00',
  Asr: '15:00',
  Maghrib: '18:00',
  Isha: '20:00',
  FajrDaruri: '06:05',
  DhuhrDaruri: '15:00',
  AsrDaruri: '17:20',
  MaghribDaruri: '20:00',
  IshaDaruri: '21:40',
};

const BASE = new Date(2026, 5, 14, 12);
const EARLY = new Date(2026, 5, 14, 0, 30);
const ALL: DaruriKey[] = [
  'FajrDaruri',
  'DhuhrDaruri',
  'AsrDaruri',
  'MaghribDaruri',
  'IshaDaruri',
];

/** Every prayer speaks except the ones named. */
const silence =
  (...quiet: string[]) =>
  (prayerName: string) =>
    !quiet.includes(prayerName);

const leadIn = (
  isAudible?: (n: string, at: number) => boolean,
  days: TimingsMap[] = [day],
) =>
  buildDaruriAlertEvents(days, BASE, ALL, 0, EARLY, undefined, isAudible).map(
    e => e.name,
  );

const ends = (isAudible?: (n: string, at: number) => boolean) =>
  buildDaruriEndEvents([day, day], BASE, ALL, EARLY, undefined, isAudible)
    .flatMap(e => e.keys)
    .filter((v, i, a) => a.indexOf(v) === i);

describe('a silenced prayer takes its boundary with it', () => {
  it('drops the lead-in alert', () => {
    expect(leadIn()).toContain('FajrDaruri');
    expect(leadIn(silence('Fajr'))).not.toContain('FajrDaruri');
  });

  it('drops the window-end alert', () => {
    expect(ends()).toContain('AsrDaruri');
    expect(ends(silence('Asr'))).not.toContain('AsrDaruri');
  });

  it('takes only its own, and leaves the rest standing', () => {
    const kept = leadIn(silence('Fajr'));
    for (const k of ALL) {
      if (DARURI_OF[k] === 'Fajr') continue;
      expect(kept).toContain(k);
    }
  });

  it('drops each of the five when it is the one silenced', () => {
    for (const k of ALL) {
      expect(leadIn(silence(DARURI_OF[k]))).not.toContain(k);
    }
  });

  it('empties a grouped end event rather than leaving a hollow one', () => {
    // Boundaries can share an instant — Dhuhr's is Asr's row. When every
    // key at one instant is silenced there must be no event left at it,
    // not an event carrying an empty list.
    const all = buildDaruriEndEvents([day], BASE, ALL, EARLY);
    const quiet = buildDaruriEndEvents(
      [day],
      BASE,
      ALL,
      EARLY,
      undefined,
      () => false,
    );
    expect(all.length).toBeGreaterThan(0);
    expect(quiet).toEqual([]);
  });
});

describe('nothing changes for a prayer that still speaks', () => {
  it('keeps everything when no predicate is given at all', () => {
    // The parameter is optional, so every existing caller and every
    // other surface behaves exactly as before.
    expect(leadIn()).toEqual(leadIn(() => true));
    expect(ends()).toEqual(ends(() => true));
  });

  it('keeps them for a prayer on the plain alert', () => {
    // Only `silent` means "no alarm is registered". A prayer cycled to
    // the ordinary tone still wants to know its window is closing.
    expect(leadIn(silence('Dhuhr'))).toContain('AsrDaruri');
  });
});

describe('it asks about the prayer, not about the boundary', () => {
  it("judges Ishāʾ's past-midnight boundary by Ishāʾ's own day", () => {
    // The boundary is a third of the way into the night that BEGINS on
    // this day, so at a long summer latitude it lands after local
    // midnight and carries onto tomorrow's date. The prayer it belongs
    // to is still on the evening before, and that is the instant the
    // question is about.
    const late: TimingsMap = {
      Isha: '23:00',
      Maghrib: '23:10',
      IshaDaruri: '00:23',
    };
    const asked: number[] = [];
    buildDaruriAlertEvents(
      [late],
      new Date(2026, 5, 14, 12),
      ['IshaDaruri'],
      0,
      new Date(2026, 5, 14, 10),
      undefined,
      (_n, at) => {
        asked.push(at);
        return true;
      },
    );
    expect(asked).toHaveLength(1);
    const at = new Date(asked[0]);
    expect(at.getDate()).toBe(14);
    expect(at.getHours()).toBe(23);
  });

  it('asks with the prayer name, so an override can match on it', () => {
    const names: string[] = [];
    buildDaruriAlertEvents(
      [day],
      BASE,
      ALL,
      0,
      EARLY,
      undefined,
      n => {
        names.push(n);
        return true;
      },
    );
    // The five prayers, not the five boundary keys.
    expect(new Set(names)).toEqual(
      new Set(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']),
    );
  });

  it('answers per day, so an override reaches one occurrence only', () => {
    // Two identical days: silencing the first Fajr must not silence the
    // second. This is the whole reason the predicate takes an instant.
    const first = new Date(2026, 5, 14, 5, 0, 0, 0).getTime();
    const kept = buildDaruriAlertEvents(
      [day, day],
      BASE,
      ['FajrDaruri'],
      0,
      EARLY,
      undefined,
      (_n, at) => at !== first,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].at.getDate()).toBe(15);
  });
});

describe('silence is chosen, never stumbled into', () => {
  it('leaves the alert standing when the prayer time will not parse', () => {
    // Dropping an alert because a clock could not be read would be the
    // wrong way round: the reader asked for this boundary, and the app
    // should not go quiet by accident.
    const broken: TimingsMap = { ...day, Fajr: 'not a time' };
    const events = buildDaruriAlertEvents(
      [broken],
      BASE,
      ['FajrDaruri'],
      0,
      EARLY,
      undefined,
      () => false,
    );
    expect(events.map(e => e.name)).toEqual(['FajrDaruri']);
  });

  it('leaves it standing when the prayer is missing from the day', () => {
    const noFajr: TimingsMap = { ...day };
    delete (noFajr as Record<string, string>).Fajr;
    const events = buildDaruriAlertEvents(
      [noFajr],
      BASE,
      ['FajrDaruri'],
      0,
      EARLY,
      undefined,
      () => false,
    );
    expect(events.map(e => e.name)).toEqual(['FajrDaruri']);
  });
});
