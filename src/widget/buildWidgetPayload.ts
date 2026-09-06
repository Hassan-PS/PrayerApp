import type { TimingsMap } from '../types/prayer';
import { activeClock } from '../utils/activeClock';
import i18n from '../i18n';
import type {
  WidgetExtras,
  WidgetHijriBlock,
  WidgetPracticeBlock,
  WidgetReadingBlock,
  WidgetTasbihBlock,
  WidgetTodayBlock,
} from './widgetBlocks';
import { shortPlaceLabel } from './shortPlaceLabel';
import {
  addDays,
  combineLocalDateAndTime,
  computeNextSalah,
  formatDisplayTime,
  formatLocalTime,
  getNextPrayerDisplay,
  startOfLocalDay,
} from '../utils/prayerTimes';

export type WidgetPrayerRow = {
  key: string;
  /**
   * CANONICAL 24-hour `HH:mm`. Machine data, never localised.
   *
   * Native parses this: the iOS widget's progress ring splits it on ":"
   * to place the prayer on a timeline, `logMinutesOfDay` turns it into
   * minutes-of-day, and Android's `epochForDayTime` matches it against
   * `^(\d{1,2}):(\d{2})$` to schedule the Live Activity. A "5:31 PM"
   * here would not fail loudly — it would silently stop the ring
   * advancing and the rollover happening.
   *
   * What the user reads is `display`.
   */
  time: string;
  /**
   * The same instant, written the way the user reads a clock — issue #18.
   *
   * ABSENT on a 24-hour clock, where it would be a byte-for-byte copy of
   * `time`. This payload is serialised into an app-group file and read
   * on every widget redraw, and duplicating six to forty times across a
   * week of days is real size for no information. Native falls back to
   * `time`, which is exactly right when the two agree.
   */
  display?: string;
  /** Short label for narrow / horizontal layouts (e.g. widget columns). */
  abbr: string;
  /** Full localized name (e.g. "Maghrib", "Sunrise") for layouts with room. */
  name: string;
};

/**
 * One day of prayer times in the multi-day schedule pushed to the native
 * renderers (home-screen widget + Android Live Activity). The native side
 * selects the entry whose `dateKey` matches the device's current local date
 * and rolls forward on its own — this is what stops the widget / Live Activity
 * going stale ~24h after the app was last opened (the times were previously a
 * single-day snapshot that only refreshed when the app was reopened).
 */
export type WidgetDay = {
  /** Local calendar date these times apply to, formatted YYYY-MM-DD. */
  dateKey: string;
  /** Short human label, e.g. "Wed, Apr 9". */
  dayLabel: string;
  /** Five salāh rows: Fajr, Dhuhr, Asr, Maghrib, Isha. */
  rows: WidgetPrayerRow[];
  /** Sunrise rendered separately (slot 1) — not a salāh. Omitted when the
   *  user has turned Sunrise off. */
  sunriseRow?: WidgetPrayerRow;
  /** Enabled pre-dawn night rows (Islamic Midnight / Last Third). Absent
   *  entirely when the user has both toggles off, which is the default. */
  extraRows?: WidgetPrayerRow[];
};

/** Five salāh shown as rows on the widget (Sunrise rendered separately at slot 1). */
export const WIDGET_ROW_KEYS = [
  'Fajr',
  'Dhuhr',
  'Asr',
  'Maghrib',
  'Isha',
] as const;

export type WidgetPrayerKey = (typeof WIDGET_ROW_KEYS)[number];

/**
 * Optional non-salāh night rows (Islamic Midnight / Last Third / First
 * Third). Sunrise has its own dedicated slot.
 *
 * Every surface carries these now, rows and countdown alike. The widget had
 * them stripped upstream at first, and then carried as rows a headline was
 * not allowed to name — a user who turned Islamic Midnight on saw it in the
 * app, in the notification and on the Lock Screen, and then watched the
 * widget beside them count down to something else. A toggle means one thing
 * everywhere or it means nothing.
 */
export const EXTRA_ROW_KEYS = ['Midnight', 'Lastthird', 'Firstthird'] as const;

/**
 * Every key that can become `nextKey` — and so every key the Live
 * Activity's alert-mode button can be pointed at.
 *
 * Exported because that button offers three modes to a prayer and two to
 * a time, and `settings/alertModes.ts` decides which by asking whether a
 * key is one of `OPTIONAL_TIME_KEYS`. Those two lists have no reason to
 * stay in step on their own: add a fifth optional time here and it would
 * quietly inherit the prayer's cycle, and the card would offer the call
 * to prayer for it. `__tests__/liveActivityAlertCycle.test.ts` reads this
 * and refuses.
 */
export const COUNTDOWN_KEYS = [
  ...WIDGET_ROW_KEYS,
  'Sunrise',
  ...EXTRA_ROW_KEYS,
] as const;

export type WidgetPrayerPayload = {
  /** Calendar day these times apply to (e.g. Wed, Apr 9). */
  dayLabel: string;
  rows: WidgetPrayerRow[];
  /**
   * Sunrise row rendered at display slot 1 (between Fajr and Dhuhr).
   * Kept separate from salāh rows because Sunrise is not a prayer. Omitted
   * when the user has turned Sunrise off (the kill-switch).
   */
  sunriseRow?: WidgetPrayerRow;
  /** Enabled night rows for the currently-shown day. */
  extraRows?: WidgetPrayerRow[];
  /** Row `key` to highlight as the next event (salāh, Sunrise, or a night time). */
  nextKey: string | null;
  /** Name of the next prayer */
  nextPrayerName?: string;
  /** Time of the next prayer, canonical 24-hour `HH:mm` — parsed natively. */
  nextPrayerTime?: string;
  /** The same time as the user reads it — absent when identical (issue #18). */
  nextPrayerDisplay?: string;
  /** Location name */
  locationName?: string;
  /**
   * The language Mihrab is running in (an i18n tag such as `sv` or `ar`).
   *
   * The block contents are already localized here in JS, but the widget's own
   * chrome — "NEXT", "day streak", "Tap to log" — is drawn natively from each
   * platform's string table, which follows the *phone's* language. Without
   * this the two halves of one widget can disagree: a user whose phone is in
   * English but who set Mihrab to Swedish gets Swedish prayer names under an
   * English heading. Native reads this and resolves its own strings against
   * it, so the whole widget speaks whatever the app speaks.
   */
  language?: string;
  /**
   * True when after-Isha and no `tomorrow` data was available — the next-day
   * times are estimated by re-applying today's strings to tomorrow's calendar
   * date. The widget can render a subtle indicator (e.g., a soft dot or italic
   * label) so users know the times will refresh once the app reconnects.
   */
  tomorrowEstimated?: boolean;
  /**
   * Seasonal treatment flags — task #67. Allows the iOS Lock Screen +
   * home-screen widgets to subtly accent Fridays (Jumu'ah) and Ramadan,
   * matching the in-app HomeScreen treatments. Optional so the
   * home-screen widget on Android can ignore them without a schema bump.
   */
  seasonal?: WidgetSeasonalFlags;
  /**
   * Multi-day schedule (index 0 = today). Lets the native renderers roll the
   * displayed times forward day-by-day without the app being reopened. Optional
   * for backward compatibility — when absent, native falls back to the
   * single-day `rows`. Built from the `week` argument; defaults to today
   * (+ tomorrow when supplied) so the field is always at least a short window.
   */
  days?: WidgetDay[];
  /**
   * Practice history — streak, the grid, this month's sunnah and fasts.
   * Absent when the app has not supplied it; renderers must treat absent as
   * "do not draw the section", never as zero.
   */
  practice?: WidgetPracticeBlock;
  /** Today's five with their journal status — the Log Today widget. */
  today?: WidgetTodayBlock;
  /** Where the reader left off, and what the khatmah asks of today. */
  reading?: WidgetReadingBlock;
  /** Today's Hijri date and the month after it. */
  hijri?: WidgetHijriBlock;
  /** The dhikr counter, for the interactive Tasbih widget. */
  tasbih?: WidgetTasbihBlock;
};

/** Seasonal flags consumed by the iOS widget extension to tint the
 *  Lock Screen views — see PrayerWidgetExtension.swift. */
export type WidgetSeasonalFlags = {
  /** Friday before Maghrib — accent the Dhuhr row (Jumu'ah). */
  jumuah: boolean;
  /** Anywhere inside Ramadan — show a tiny crescent glyph. */
  ramadan: boolean;
  /** Eid day — show greeting tint. Null on non-eid days. */
  eid: 'fitr' | 'adha' | null;
};

/** Optional coordinates for the (0,0) assertion gate. */
export type WidgetCoords = { lat: number; lng: number };

/** Local YYYY-MM-DD for the given date (device-local, not UTC). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * `nextPrayerDisplay`, or nothing when it would repeat `nextPrayerTime`.
 * Same reasoning as `WidgetPrayerRow.display`.
 */
function nextPrayerDisplayField(at: Date | undefined): {
  nextPrayerDisplay?: string;
} {
  if (!at) return {};
  const canonical = formatLocalTime(at);
  const display = activeClock().fromDate(at);
  return display === canonical ? {} : { nextPrayerDisplay: display };
}

/** Build a single labelled row for a prayer/event key. */
function buildRow(key: string, timings: TimingsMap): WidgetPrayerRow {
  const raw = timings[key];
  const time = raw ? formatDisplayTime(raw) : '—';
  const display = raw ? activeClock()(time) : time;
  return {
    key,
    time,
    ...(display === time ? {} : { display }),
    abbr: i18n.t(`prayer.${key}_abbr`, {
      defaultValue: i18n.t(`prayer.${key}`),
    }),
    name: i18n.t(`prayer.${key}`),
  };
}

/**
 * Build the five salāh rows and the optional Sunrise row for one day's timings.
 * `sunriseRow` is undefined when Sunrise has been turned off (its key was
 * filtered out of `timings` upstream).
 */
function buildDayRows(timings: TimingsMap): {
  rows: WidgetPrayerRow[];
  sunriseRow?: WidgetPrayerRow;
  extraRows: WidgetPrayerRow[];
} {
  const rows = WIDGET_ROW_KEYS.map(key => buildRow(key, timings));
  const sunriseRow = timings['Sunrise'] ? buildRow('Sunrise', timings) : undefined;
  const extraRows = EXTRA_ROW_KEYS.filter(key => timings[key]).map(key =>
    buildRow(key, timings),
  );
  return { rows, sunriseRow, extraRows };
}

/**
 * Build the multi-day schedule (`days[]`). `week[0]` is today, `week[1]`
 * tomorrow, etc. Each entry is dated by adding its index to the start of the
 * local day containing `now`, so the native side can match by wall-clock date.
 */
function buildDays(week: TimingsMap[], now: Date): WidgetDay[] {
  const base = startOfLocalDay(now);
  return week.map((timings, i) => {
    const date = addDays(base, i);
    const { rows, sunriseRow, extraRows } = buildDayRows(timings);
    return {
      dateKey: localDateKey(date),
      dayLabel: date.toLocaleDateString(i18n.language, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      rows,
      ...(sunriseRow ? { sunriseRow } : {}),
      ...(extraRows.length > 0 ? { extraRows } : {}),
    };
  });
}

/**
 * After the last prayer of the day (Isha), uses tomorrow's timings so the widget
 * shows the next day's schedule. If `tomorrow` is unavailable, the function
 * estimates by re-applying today's strings to tomorrow's calendar date and
 * sets `tomorrowEstimated: true` on the payload.
 *
 * @throws if `coords` is provided AND both lat and lng are exactly 0. The
 * (0, 0) coordinate is the canonical bug surface — `lat ?? 0` shipping prayer
 * times for off the coast of Ghana. Callers that have coords MUST pass them so
 * this gate fires before bad data reaches the widget. Callers without coords
 * (legacy paths, tests) may omit the argument.
 */
export function buildWidgetPayload(
  today: TimingsMap,
  tomorrow: TimingsMap | undefined,
  now: Date,
  locationName?: string,
  coords?: WidgetCoords,
  seasonal?: WidgetSeasonalFlags,
  /**
   * Consecutive days starting today (index 0 = today). When supplied, drives
   * the `days[]` multi-day schedule so native renderers roll over on their own.
   * Falls back to `[today, tomorrow]` when omitted.
   */
  week?: TimingsMap[],
  /**
   * The non-prayer-times blocks (practice, today, reading, hijri, tasbih).
   * A bag rather than five more positional parameters — this signature is
   * already seven deep, and the next reader of a call site should not have
   * to count commas to find out which `undefined` is which.
   */
  extras?: WidgetExtras,
): WidgetPrayerPayload {
  if (coords && coords.lat === 0 && coords.lng === 0) {
    throw new Error(
      'buildWidgetPayload: refusing to build payload with (0, 0) coordinates ' +
        '— this is the "lat ?? 0" footgun that ships prayer times for off the ' +
        'coast of Ghana. Check the upstream coord pipeline.',
    );
  }

  const stillToday = computeNextSalah(today, now) != null;
  const haveTomorrow =
    tomorrow != null && Object.keys(tomorrow).length > 0;
  const useTomorrow = !stillToday && haveTomorrow;
  const tomorrowEstimated = !stillToday && !haveTomorrow;
  const timings = useTomorrow ? (tomorrow as TimingsMap) : today;

  const dayAnchor = useTomorrow || tomorrowEstimated ? addDays(now, 1) : now;
  const dayLabel = startOfLocalDay(dayAnchor).toLocaleDateString(i18n.language, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  // Whatever is next is next. An optional time only reaches this function
  // when the user has turned it on, and someone who has asked to be told
  // about the Last Third has asked for a countdown to it — on the widget
  // as much as on the Lock Screen.
  let next = getNextPrayerDisplay(today, tomorrow, now);
  // Soft fallback: after Isha + no tomorrow data, still surface "Fajr next" by
  // estimating from today's Fajr applied to tomorrow's calendar date. The
  // widget shows something useful instead of a null nextKey + stale times.
  if (!next && tomorrowEstimated) {
    const fajr = today.Fajr;
    if (fajr) {
      const tomorrowDay = addDays(startOfLocalDay(now), 1);
      next = { name: 'Fajr', at: combineLocalDateAndTime(tomorrowDay, fajr) };
    }
  }

  // nextKey is a salāh key, 'Sunrise', or a night time
  // (Midnight/Lastthird/Firstthird) — whichever the clock says comes next.
  const nextKey =
    next &&
    ((WIDGET_ROW_KEYS as readonly string[]).includes(next.name) ||
      next.name === 'Sunrise' ||
      (EXTRA_ROW_KEYS as readonly string[]).includes(next.name))
      ? next.name
      : null;

  // The visible single-day `rows` reflect the day currently being shown
  // (today, or tomorrow after Isha) — same as before. The new `days[]` field
  // below carries the full window so native can roll over on its own.
  const { rows, sunriseRow, extraRows } = buildDayRows(timings);

  // Multi-day schedule. Prefer the supplied `week`; otherwise synthesise the
  // shortest useful window from today (+ tomorrow when available).
  const weekSource =
    week && week.length > 0
      ? week
      : tomorrow
        ? [today, tomorrow]
        : [today];
  const days = buildDays(weekSource, now);

  return {
    dayLabel,
    rows,
    ...(sunriseRow ? { sunriseRow } : {}),
    ...(extraRows.length > 0 ? { extraRows } : {}),
    nextKey,
    nextPrayerName: next ? i18n.t(`prayer.${next.name}`) : undefined,
    nextPrayerTime: next ? formatLocalTime(next.at) : undefined,
    // Same instant as `nextPrayerTime`, written for a human. The
    // canonical one stays: Android's widget provider re-derives its own
    // `nextPrayerTime` from a row's `time`, and `syncLiveActivity`
    // parses it back into a Date.
    ...nextPrayerDisplayField(next?.at),
    // A saved location's label is a full postal address on every geocoder the
    // app reads; the widget header has room for a city. See shortPlaceLabel.
    locationName: shortPlaceLabel(locationName),
    language: i18n.language,
    ...(tomorrowEstimated ? { tomorrowEstimated: true } : {}),
    ...(seasonal ? { seasonal } : {}),
    days,
    // Spread one key at a time rather than `...extras`: an extras object
    // carrying an explicit `practice: undefined` would otherwise put the key
    // on the payload, and `JSON.stringify` drops it again — so the wire format
    // stays honest either way, but the in-memory object would not, and the
    // tests compare the object.
    ...(extras?.practice ? { practice: extras.practice } : {}),
    ...(extras?.today ? { today: extras.today } : {}),
    ...(extras?.reading ? { reading: extras.reading } : {}),
    ...(extras?.hijri ? { hijri: extras.hijri } : {}),
    ...(extras?.tasbih ? { tasbih: extras.tasbih } : {}),
  };
}

