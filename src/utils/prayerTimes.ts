import type { NextSalahName, TimingsMap } from '../types/prayer';
import { NEXT_SALAH_ORDER } from '../types/prayer';

export function extractClock(timeStr: string): { hour: number; minute: number } {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    throw new Error(`Unrecognized time format: ${timeStr}`);
  }
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
}

export function formatDisplayTime(timeStr: string): string {
  const { hour, minute } = extractClock(timeStr);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatLocalTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function combineLocalDateAndTime(day: Date, timeStr: string): Date {
  const { hour, minute } = extractClock(timeStr);
  const out = new Date(day);
  out.setHours(hour, minute, 0, 0);
  return out;
}

export function addDays(day: Date, days: number): Date {
  const out = new Date(day);
  out.setDate(out.getDate() + days);
  return out;
}

export function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * The date a day's entry actually falls on.
 *
 * Every row of a day card is that day's clock time on that day — with one
 * exception. The first third of the night belongs to the night the day
 * BEGINS (see `nightTimes.ts`), and at high latitude in midsummer that
 * night's first third can land past local midnight: Maghrib 22:00 with
 * Fajr 02:00 gives 23:20, which is fine, but push Maghrib to 23:10 and it
 * reads 00:23 — the small hours of the NEXT day, not of this one. Pinned
 * to this day it would be counted down to, and announced, some twenty-three
 * hours early.
 *
 * Any night mark whose clock falls before Maghrib's is therefore on the
 * other side of midnight. Nothing else on the card needs this: Islamic
 * Midnight and the Last Third belong to the night that ENDS here, and
 * their pre-dawn times are already this day's.
 */
/**
 * When an event on `base`'s card actually happens.
 *
 * Exported because it is the one place that knows the First Third of the
 * night belongs to the evening it starts in and not to the date its clock
 * time falls on. Anything asking "which occurrence is this row" has to
 * ask the same way the scheduler does, or the two name different
 * instants for the same row.
 */
export function eventAt(name: string, timings: TimingsMap, base: Date): Date {
  const at = combineLocalDateAndTime(base, timings[name]);
  if (name !== 'Firstthird' || !timings.Maghrib) return at;
  return at < combineLocalDateAndTime(base, timings.Maghrib)
    ? addDays(at, 1)
    : at;
}

export function computeNextSalah(
  timings: TimingsMap,
  now: Date,
): { name: NextSalahName; at: Date } | null {
  const dayStart = startOfLocalDay(now);
  for (const name of NEXT_SALAH_ORDER) {
    const raw = timings[name];
    if (!raw) {
      continue;
    }
    const at = eventAt(name, timings, dayStart);
    if (at > now) {
      return { name, at };
    }
  }
  return null;
}

export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return '0m';
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

/**
 * The same countdown, split so the seconds can be drawn differently.
 *
 * Seconds belong in a quieter colour at a smaller size: they are the part
 * that moves, and at the size of the hours they would pull the eye away
 * from the number the screen exists to show. Kept zero-padded so the line
 * does not jump a pixel every ten seconds.
 */
export type CountdownParts = {
  /** Hours and minutes, exactly as `formatCountdown` writes them. */
  main: string;
  /** Two digits, no unit. */
  seconds: string;
};

export function countdownParts(totalSeconds: number): CountdownParts {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return {
    main: h > 0 ? `${h}h ${m}m` : `${m}m`,
    seconds: String(safe % 60).padStart(2, '0'),
  };
}

export function getNextPrayerDisplay(
  today: TimingsMap,
  tomorrow: TimingsMap | undefined,
  now: Date,
): { name: string; at: Date } | null {
  // Gather every still-upcoming event from today plus every event tomorrow,
  // then return the chronologically earliest. This is order-agnostic, so it
  // correctly surfaces a pre-dawn night time (Islamic Midnight / Last Third)
  // as the next event after Isha when those toggles are on — they sit before
  // tomorrow's Fajr. For the default five-salāh-plus-sunrise map it behaves
  // exactly as before (next salāh during the day; tomorrow's Fajr after Isha).
  const dayStart = startOfLocalDay(now);
  const candidates: { name: string; at: Date }[] = [];
  for (const name of NEXT_SALAH_ORDER) {
    const raw = today[name];
    if (!raw) continue;
    const at = eventAt(name, today, dayStart);
    if (at > now) candidates.push({ name, at });
  }
  if (tomorrow) {
    const tomorrowDay = addDays(dayStart, 1);
    for (const name of NEXT_SALAH_ORDER) {
      const raw = tomorrow[name];
      if (!raw) continue;
      candidates.push({ name, at: eventAt(name, tomorrow, tomorrowDay) });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0];
}

const NOTIFICATION_BUFFER_MS = 15_000;

export function buildUpcomingSalahEvents(
  today: TimingsMap,
  tomorrow: TimingsMap | undefined,
  now: Date,
  /**
   * The LOCAL calendar day the `today` map was fetched for (v2.7.38).
   * Defaults to `now`'s day for backward compatibility, but callers that
   * can hold stale state across midnight (the notification scheduler)
   * MUST pass it: anchoring a yesterday-fetched map to "now" pins
   * yesterday's clock times onto today's date — the schedule then fires
   * 1–2 min off and a later resync adds a second alert at the true time.
   * With the anchor, a stale `today` map yields correctly-dated (past,
   * filtered) events and the `tomorrow` map covers the actual today.
   */
  baseDay: Date = now,
  /**
   * Cached days AFTER tomorrow (i.e. `week[2..]`), scheduled at day offsets
   * 2, 3, … from `baseDay` (v2.7.40). Extends alert coverage so the adhan
   * still fires when the app hasn't been opened for a couple of days —
   * previously coverage was exactly today+tomorrow, so 2 days without an
   * app open meant every alert silently lapsed. (The Live Activity's
   * foreground service used to mask this by keeping the app alive; users
   * who turned it off hit the gap directly.)
   */
  extraDays: TimingsMap[] = [],
): { name: string; at: Date }[] {
  const dayStart = startOfLocalDay(baseDay);
  const events: { name: string; at: Date }[] = [];
  const pushDay = (timings: TimingsMap, dayOffset: number) => {
    const base = dayOffset === 0 ? dayStart : addDays(dayStart, dayOffset);
    for (const name of NEXT_SALAH_ORDER) {
      const raw = timings[name];
      if (raw) {
        events.push({ name, at: eventAt(name, timings, base) });
      }
    }
  };
  pushDay(today, 0);
  if (tomorrow) pushDay(tomorrow, 1);
  extraDays.forEach((t, i) => pushDay(t, 2 + i));
  const cutoff = now.getTime() + NOTIFICATION_BUFFER_MS;
  return events
    .filter(e => e.at.getTime() > cutoff)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Advance reminders N minutes before each upcoming prayer.
 * Skips reminders that would fall in the past or after the prayer time.
 */
export function buildPrePrayerReminderEvents(
  salahEvents: { name: string; at: Date }[],
  minutesBefore: number,
  now: Date,
): { name: string; at: Date }[] {
  if (minutesBefore <= 0) {
    return [];
  }
  const ms = minutesBefore * 60_000;
  const cutoff = now.getTime() + NOTIFICATION_BUFFER_MS;
  const out: { name: string; at: Date }[] = [];
  for (const e of salahEvents) {
    const atReminder = new Date(e.at.getTime() - ms);
    if (atReminder.getTime() <= cutoff) {
      continue;
    }
    if (atReminder.getTime() >= e.at.getTime()) {
      continue;
    }
    out.push({ name: e.name, at: atReminder });
  }
  return out;
}
