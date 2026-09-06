/**
 * The row that shows an override, and the way back off it.
 *
 * The Live Activity's button can put one occurrence on a different alert.
 * Until now the home screen could not see that: silence Fajr from the
 * lock screen at midnight, open the app, and the row still said Adhan.
 * The app held two answers about the same prayer and offered no way to
 * reconcile them — the complaint the three-mode button was built to
 * answer, arriving from the other direction.
 *
 * What has to hold:
 *   - the app can read an override written by a process it is not part of;
 *   - the row shows the temporary answer, not the standing one;
 *   - the marker lands on the OCCURRENCE, which after Isha is on
 *     tomorrow's card, and never on the same prayer on another day;
 *   - reset clears BOTH copies, or the card keeps saying "· once" for a
 *     prayer the app has just put back;
 *   - and the alarm is actually rewritten, which means the resync has to
 *     be able to see the override move.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MUTED_NEXT_ADHAN_KEY,
  refreshNextAlertOverride,
  clearNextAlertOverride,
  parseNextAlertOverride,
  getNextAlertOverride,
} from '../src/notifications/adhanMute';
import {
  combineLocalDateAndTime,
  addDays,
  eventAt,
  startOfLocalDay,
} from '../src/utils/prayerTimes';
import { ymdLocal } from '../src/notifications/scheduling';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf-8');

describe('the app can see an override it did not write', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('reads one back off storage', async () => {
    const o = {
      epoch: new Date(2026, 8, 8, 3, 37).getTime(),
      name: 'Fajr',
      date: '2026-09-08',
      mode: 'silent',
    };
    await AsyncStorage.setItem(MUTED_NEXT_ADHAN_KEY, JSON.stringify(o));
    await refreshNextAlertOverride();
    // The store's snapshot is what the row renders from; parse is the
    // same road it travels.
    expect(parseNextAlertOverride(JSON.stringify(o))).toEqual(o);
  });

  it('clears it', async () => {
    await AsyncStorage.setItem(
      MUTED_NEXT_ADHAN_KEY,
      JSON.stringify({ epoch: 1, name: 'Fajr', mode: 'silent' }),
    );
    await clearNextAlertOverride();
    // The contract is "there is no override", not any particular empty
    // value — a cleared key reads back as '' on a device and null under
    // some storage mocks, and both mean the same thing to every reader.
    expect(await getNextAlertOverride()).toBeNull();
    expect(
      parseNextAlertOverride(await AsyncStorage.getItem(MUTED_NEXT_ADHAN_KEY)),
    ).toBeNull();
  });

  it('keeps the last answer when the read throws', async () => {
    // "No override" is a visible state — the row's way back disappears
    // with it. Flickering out of it on a transient read error would take
    // the reset button away while the override was still live.
    const ts = read('src/notifications/adhanMute.ts');
    expect(ts).toMatch(
      /export async function refreshNextAlertOverride[\s\S]*?\} catch \{[\s\S]{0,400}?\n\s*\}\n\}/,
    );
    expect(ts).not.toMatch(
      /refreshNextAlertOverride[\s\S]{0,300}?catch \{\s*\n\s*publish\(null\)/,
    );
  });
});

describe('the marker belongs to an occurrence, not to a name', () => {
  // The arithmetic TodayCard does, restated: this day's midnight plus the
  // row's clock time, which is the number the alert was written against.
  const epochOf = (dayOffset: number, hhmm: string) =>
    combineLocalDateAndTime(
      addDays(startOfLocalDay(new Date(2026, 8, 7, 12, 0, 0, 0)), dayOffset),
      hhmm,
    ).getTime();

  it("puts an override set after Isha on tomorrow's Fajr, not today's", () => {
    const tomorrowFajr = epochOf(1, '03:36');
    expect(epochOf(0, '03:36')).not.toBe(tomorrowFajr);
    // Same key, same clock time, different day — and only one of them is
    // the instant the button spoke for.
    expect(tomorrowFajr - epochOf(0, '03:36')).toBe(86_400_000);
  });

  it('is matched on the instant in the card', () => {
    const ts = read('src/screens/home/TodayCard.tsx');
    expect(ts).toMatch(
      /if \(ymdLocal\(eventAt\(key, timings, base\)\) !== override\.date\) continue;/,
    );
    // Built from the selected day, so it follows the occurrence onto
    // whichever card holds it.
    expect(ts).toMatch(
      /const base = addDays\(startOfLocalDay\(new Date\(\)\), selected\);/,
    );
  });
});

describe('the row shows what will actually happen', () => {
  const card = read('src/screens/home/TodayCard.tsx');

  it('renders the override on the bell, not the standing setting', () => {
    expect(card).toMatch(
      /alertMode=\{[\s\S]{0,200}?overrideKey === key && override\s*\n?\s*\? override\.mode\s*\n?\s*: alertModeOf\(key\)/,
    );
  });

  it('offers the reset on the overridden row only', () => {
    expect(card).toMatch(
      /onResetAlertMode=\{overrideKey === key \? resetOverride : undefined\}/,
    );
    expect(card).toMatch(
      /overrideMode=\{overrideKey === key \? override\?\.mode : undefined\}/,
    );
  });

  it("shows it on a day that is not today, where there is no bell", () => {
    // The cycling control is today-only on purpose: a tap there changes
    // every Fajr. This one is an instant, and after Isha that instant is
    // tomorrow's — so it must not inherit that gate.
    const line = card.match(/overrideMode=\{[^}]*\}/)?.[0] ?? '';
    expect(line).not.toContain('isToday');
    const resetLine = card.match(/onResetAlertMode=\{[^}]*\}/)?.[0] ?? '';
    expect(resetLine).not.toContain('isToday');
  });

  it('names the mode in the line rather than leaning on the bell', () => {
    // Because on that non-today card there is no bell to read it off.
    const chip = read('src/screens/home/AlertOverrideChip.tsx');
    expect(chip).toMatch(/defaultValue: '\{\{mode\}\} just this once · Reset'/);
    expect(chip).toMatch(/mode: word\(mode\)/);
  });

  it('says what reset restores, for a screen reader', () => {
    const chip = read('src/screens/home/AlertOverrideChip.tsx');
    expect(chip).toMatch(
      /accessibilityHint=\{t\('home\.alertOverrideResetHint'[\s\S]{0,120}?mode: word\(standingMode\)/,
    );
  });

  it('draws its glyph instead of setting an emoji', () => {
    const chip = read('src/screens/home/AlertOverrideChip.tsx');
    expect(chip).toContain('react-native-svg');
    expect(chip).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{27F0}-\u{27FF}]/u);
  });
});

describe('the row does not disturb the column beside it', () => {
  const row = read('src/screens/home/PrayerRow.tsx');

  it('puts the chip under the name, inside nameWrap', () => {
    // The trailing edge is a column aligned across every row of the card
    // — the dot's slot is drawn even when there is no dot, and the time
    // column is sized by the card's longest time. A control appearing on
    // one row there would push that row's bell and time out of line,
    // which is the defect both of those exist to prevent.
    const nameWrap = row.split('styles.nameWrap')[1]?.split('styles.trailing')[0] ?? '';
    expect(nameWrap).toContain('AlertOverrideChip');
    const trailing = row.split('styles.trailing')[1] ?? '';
    expect(trailing).not.toContain('AlertOverrideChip');
  });
});

describe('reset reaches both copies, and the schedule', () => {
  it('clears the native one as well as its own', () => {
    const card = read('src/screens/home/TodayCard.tsx');
    expect(card).toMatch(
      /await clearNextAlertOverride\(\);\s*\n\s*await clearNativeAlertOverride\(\);/,
    );
  });

  it('has a native method to clear, which repaints the card', () => {
    const kt = read(
      'android/app/src/main/java/com/prayer_times/MihrabLiveActivityModule.kt',
    );
    expect(kt).toMatch(/fun clearAlertOverride\(promise: Promise\)/);
    expect(kt).toMatch(
      /remove\(LiveActivityAlertModes\.KEY_OVERRIDE_EPOCH\)[\s\S]{0,300}?\.remove\(LiveActivityAlertModes\.KEY_OVERRIDE_DATE\)[\s\S]{0,120}?\.remove\(MihrabLiveActivityActionReceiver\.KEY_MUTED_EPOCH\)/,
    );
    expect(kt).toMatch(
      /fun clearAlertOverride[\s\S]{0,900}?buildNotificationFromPayload\(reactContext, payload\)/,
    );
  });

  it('never throws out of the native call', () => {
    // The half that decides what the prayer sounds like has already run.
    const native = read('src/native/MihrabLiveActivity.ts');
    expect(native).toMatch(
      /export async function clearNativeAlertOverride[\s\S]*?try \{[\s\S]*?\} catch \(e\) \{/,
    );
  });

  it('is in the notification fingerprint, or reset would change nothing', () => {
    // Nothing else in the screen's dependency graph moves when an
    // override does: it is written by a broadcast, and cleared by a row.
    // Left out, pressing reset would look like "nothing changed" and the
    // alarm would keep whatever the card gave it.
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toMatch(/alertOverridePrint,\s*\n\s*state\.baseDate\.getTime\(\),/);
    expect(home).toMatch(
      /const alertOverridePrint = alertOverride\s*\n?\s*\? `\$\{alertOverride\.epoch\}-\$\{alertOverride\.name\}-\$\{alertOverride\.mode\}`/,
    );
    // And in both dependency lists, or the effects keep their identity.
    expect(home.match(/^\s*alertOverridePrint,$/gm)?.length).toBe(3);
  });
});

describe('every language can say it', () => {
  const codes: string[] = readdirSync(
    path.join(ROOT, 'src/i18n/locales'),
  ).filter(f => f.endsWith('.json'));

  it.each(codes)('%s', f => {
    const j = JSON.parse(read(path.join('src/i18n/locales', f)));
    for (const k of [
      'alertOverrideOnce',
      'alertOverrideA11y',
      'alertOverrideResetHint',
    ]) {
      expect(typeof j.home[k]).toBe('string');
      expect(j.home[k].length).toBeGreaterThan(0);
    }
    // The line has to carry the mode word, or it says nothing about what
    // this occurrence is set to.
    expect(j.home.alertOverrideOnce).toContain('{{mode}}');
    expect(j.home.alertOverrideA11y).toContain('{{prayer}}');
    expect(j.home.alertOverrideResetHint).toContain('{{mode}}');
  });
});


describe('the row and the card agree about whether anything is temporary', () => {
  const card = read('src/screens/home/TodayCard.tsx');
  const kt = read(
    'android/app/src/main/java/com/prayer_times/LiveActivityAlertModes.kt',
  );

  it('drops the line when the standing setting has caught up with it', () => {
    // The override is written against an instant and the standing setting
    // can move under it: silence one Fajr from the card, then set the
    // Fajr row to silent here, and the two now say the same thing.
    // Calling that "just this once" would tell the reader their permanent
    // change had not taken.
    expect(card).toMatch(
      /return override\.mode === alertModeOf\(key\) \? null : key;/,
    );
  });

  it('is the same test the card applies to its own marker', () => {
    // Two places deciding "is anything temporary here" have to decide it
    // the same way, or the row says once and the button does not.
    expect(kt).toMatch(/fun isOverridden\([\s\S]*?o != coerce\(key, base\)/);
  });

  it('says nothing at all while the master switch is off', () => {
    // Every row reads silent then, so a line promising an alert would be
    // promising one that cannot happen. Inert, not gone: turning the
    // switch back on before that instant brings it back.
    expect(card).toMatch(/if \(!alertsEnabled\) return null;/);
    expect(card).toContain('alertsEnabled,');
    expect(card).toContain('alertModeOf,');
  });
});


describe('the boundary alerts go through the same rule as everything else', () => {
  const ts = read('src/notifications/prayerNotifications.ts');

  it('asks modeAt, so the one-occurrence override reaches them', () => {
    // Not the standing mode: silencing tonight's Isha from the card has
    // to silence tonight's boundary and say nothing about tomorrow's.
    expect(ts).toMatch(
      /const prayerSpeaksAt = \(name: string, atMs: number\) =>\s*\n?\s*modeAt\(name, atMs\) !== 'silent';/,
    );
  });

  it('is passed to both builders, not just the lead-in one', () => {
    // The end of a window is still an alert about that prayer.
    const lead = ts.split('buildDaruriAlertEvents(')[1] ?? '';
    expect(lead.slice(0, 400)).toContain('prayerSpeaksAt,');
    const end = ts.split('buildDaruriEndEvents(')[1] ?? '';
    expect(end.slice(0, 400)).toContain('prayerSpeaksAt,');
  });
});


describe('an occurrence survives its own clock time changing', () => {
  /*
   * The identity was the instant, and an instant is the one thing about a
   * prayer that is not fixed. A per-prayer offset, a change of
   * calculation method or provider, or automatic location resolving
   * somewhere new all move a prayer by a minute or two — and the override
   * then matched nothing.
   *
   * Failing quietly would be one thing. No match means the prayer falls
   * back to its STANDING setting, and that is usually the adhan: "I
   * silenced Fajr from the lock screen and it played anyway", which is
   * the precise complaint this control exists to answer.
   */
  const card = read('src/screens/home/TodayCard.tsx');
  const ts = read('src/notifications/adhanMute.ts');
  const kt = read(
    'android/app/src/main/java/com/prayer_times/LiveActivityAlertModes.kt',
  );

  it('is the day, not the millisecond, on the JS side', () => {
    expect(ts).toMatch(
      /return !!o && o\.name === name && o\.date === ymdLocal\(new Date\(epochMs\)\);/,
    );
  });

  it('and on the native side', () => {
    expect(kt).toMatch(/if \(name == key && date == dayOf\(epochMs\)\) return coerce/);
  });

  it('derives the day the same way in both languages', () => {
    // Two halves of one identity, computed in two languages, from the
    // device's own timezone and from the event's own instant.
    expect(read('src/notifications/scheduling.ts')).toMatch(
      /export function ymdLocal\(d: Date\): string \{[\s\S]*?\$\{d\.getFullYear\(\)\}-\$\{m\}-\$\{day\}/,
    );
    expect(kt).toMatch(/"%04d-%02d-%02d"/);
    expect(kt).toMatch(/Calendar\.YEAR/);
  });

  it('keeps the instant, but only to schedule with', () => {
    // Something still has to be put on a clock; it just no longer decides
    // which occurrence this is.
    expect(kt).toMatch(/Carried, not consulted/);
    expect(ts).toMatch(/NOT the identity/);
  });

  it('reads a record from the older build rather than dropping it', () => {
    expect(ts).toMatch(/const date = o\.date \? String\(o\.date\) : ymdLocal\(new Date\(epoch\)\)/);
    expect(kt).toMatch(/getLong\(KEY_OVERRIDE_EPOCH, -1L\) == epochMs/);
  });

  it('asks the scheduler when a row happens, not the card', () => {
    // The First Third of the night belongs to the evening it starts in,
    // so at a long summer latitude it sits on this card while its instant
    // is tomorrow's. Computing the row's day any other way named a
    // different occurrence than the alert was written against — and the
    // marker never appeared for that row at all.
    expect(card).toMatch(
      /ymdLocal\(eventAt\(key, timings, base\)\) !== override\.date/,
    );
  });
});

describe('the row a night mark lands on', () => {
  it('is the evening it starts in, both here and in the scheduler', () => {
    const timings = {
      Maghrib: '23:10',
      Firstthird: '00:23',
    } as Record<string, string>;
    const base = new Date(2026, 5, 14, 0, 0, 0, 0);
    const at = eventAt('Firstthird', timings, base);
    // The instant is the 15th...
    expect(at.getDate()).toBe(15);
    // ...so the occurrence's day is the 15th, and the row showing it is
    // on the 14th's card. Matching on the card's date would have missed.
    expect(ymdLocal(at)).toBe('2026-06-15');
    expect(ymdLocal(base)).toBe('2026-06-14');
  });
});
