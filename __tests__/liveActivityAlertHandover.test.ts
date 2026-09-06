/**
 * The button and the scheduler have to be talking about the same alert.
 *
 * The card's action re-creates ONE notification, by id, from a payload
 * the card was built from. The scheduler re-creates ALL of them, by id,
 * from prayer times it computes itself. The two never meet — they run in
 * different processes, often on different days — and the only thing that
 * makes them agree is that they arrive at the same id and the same
 * channel for the same prayer.
 *
 * Get the id wrong by a second and the tap leaves the original alert
 * standing and adds a duplicate beside it. Get the channel wrong and the
 * prayer still fires, but not the way the user asked: on the ordinary
 * stream when they had asked for an alarm, or on a channel that does not
 * exist, which Android drops in silence.
 *
 * Three cases with teeth:
 *   - tomorrow's Fajr, chosen from the card after Isha tonight;
 *   - "Play adhan as an alarm", which is a different channel and not a
 *     flag;
 *   - a week of it, with the app never opened.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { Platform } from 'react-native';
import {
  buildUpcomingSalahEvents,
  combineLocalDateAndTime,
  addDays,
} from '../src/utils/prayerTimes';
import {
  resolveSoundTargets,
  alarmChannelId,
} from '../src/notifications/notificationSounds';

const mockDisplay = jest.fn(async (_json: string) => {});

jest.mock('../src/native/PrayerLiveActivity', () => ({
  getPrayerLiveActivityModule: jest.fn(() => null),
}));
jest.mock('../src/native/MihrabLiveActivity', () => ({
  getMihrabLiveActivityModule: jest.fn(() => ({
    display: mockDisplay,
    stop: jest.fn(async () => {}),
  })),
}));
const settings: Record<string, unknown> = {
  notificationsEnabled: true,
  notificationSound: 'adhan_makkah',
  liveActivityLockButton: true,
  adhanUsesAlarmStream: false,
  prayerAlertModes: {},
};
jest.mock('../src/settings/storage', () => ({
  loadSettings: jest.fn(async () => settings),
}));

import notifee from '@notifee/react-native';
import { syncLiveActivity } from '../src/liveActivity/syncLiveActivity';
import { adhanMuteToggleTask } from '../src/notifications/adhanMute';
import { preReminderId } from '../src/notifications/scheduling';

/** Must match PRAYER_NOTIFICATION_ID_PREFIX in prayerNotifications.ts. */
const PREFIX = 'pt-';

const day = {
  Fajr: '03:36',
  Sunrise: '05:48',
  Dhuhr: '12:51',
  Asr: '16:26',
  Maghrib: '19:44',
  Isha: '21:51',
};
const sent = () => JSON.parse(mockDisplay.mock.calls.at(-1)![0]);

const run = async (now: Date) => {
  mockDisplay.mockClear();
  await syncLiveActivity({
    options: { enabled: true },
    today: day,
    tomorrow: day,
    week: [day, day, day, day, day],
    locationName: 'Stockholm',
    now,
  } as never);
};

describe('the id the button writes is the id the scheduler owns', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
  });

  /** The id the headless task builds from what the card handed it. */
  const idFromCard = (p: { nextEpochMs: number; nextKey: string }) =>
    `${PREFIX}${p.nextEpochMs}-${p.nextKey}`;

  /** The id the scheduler builds, from its own arithmetic. */
  const idFromScheduler = (now: Date, key: string) => {
    const e = buildUpcomingSalahEvents(day, day, now, now, [day, day]).find(
      x => x.name === key,
    );
    return e ? `${PREFIX}${e.at.getTime()}-${e.name}` : null;
  };

  it("agrees about tomorrow's Fajr, chosen after Isha tonight", () => {
    // The case the whole design has to survive: it is 22:30, Isha has
    // been and gone, and the card is counting down to a Fajr that is on
    // the OTHER SIDE OF MIDNIGHT. Both sides have to land on the same
    // instant on the same date — the scheduler from `tomorrow`, the card
    // from its own multi-day walk.
    return run(new Date(2026, 8, 7, 22, 30, 0, 0)).then(() => {
      const p = sent();
      expect(p.nextKey).toBe('Fajr');
      const fajrTomorrow = combineLocalDateAndTime(
        addDays(new Date(2026, 8, 7), 1),
        day.Fajr,
      );
      expect(p.nextEpochMs).toBe(fajrTomorrow.getTime());
      expect(idFromCard(p)).toBe(
        idFromScheduler(new Date(2026, 8, 7, 22, 30, 0, 0), 'Fajr'),
      );
    });
  });

  it('carries no seconds for either of them to disagree about', () => {
    // A second of drift is a duplicate alert, not a missing one: the tap
    // creates its own trigger and leaves the scheduler's standing.
    return run(new Date(2026, 8, 7, 22, 30, 0, 0)).then(() => {
      const d = new Date(sent().nextEpochMs);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
    });
  });

  it.each([
    ['just before Fajr', new Date(2026, 8, 7, 3, 0, 0, 0), 'Fajr'],
    ['midday', new Date(2026, 8, 7, 13, 0, 0, 0), 'Asr'],
    ['after Isha', new Date(2026, 8, 7, 22, 30, 0, 0), 'Fajr'],
    ['past midnight', new Date(2026, 8, 8, 0, 30, 0, 0), 'Fajr'],
    ['a minute before Isha', new Date(2026, 8, 7, 21, 50, 0, 0), 'Isha'],
  ])('agrees at %s', (_label, now, key) =>
    run(now as Date).then(() => {
      const p = sent();
      expect(p.nextKey).toBe(key);
      expect(idFromCard(p)).toBe(idFromScheduler(now as Date, key as string));
    }),
  );
});

describe('a week of it, with the app never opened', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
  });

  it('keeps a mode on every row of every day it sends', async () => {
    // The card walks these natively for as long as it has them. A day in
    // the window whose rows arrived without modes would be a day whose
    // button had nothing to read.
    await run(new Date(2026, 8, 7, 22, 30, 0, 0));
    const p = sent();
    expect(p.days.length).toBeGreaterThan(1);
    for (const d of p.days) {
      for (const r of d.rows) expect(r.mode).toBeTruthy();
    }
  });

  it('says the same thing about Fajr on every day in the window', async () => {
    // The native lookup is by key, not by day — which is only safe
    // because the standing mode belongs to the prayer. If a day ever
    // disagreed, the button would answer for whichever row it found
    // first.
    settings.prayerAlertModes = { Fajr: 'silent' };
    await run(new Date(2026, 8, 7, 22, 30, 0, 0));
    const p = sent();
    const modes = new Set(
      p.days.map(
        (d: { rows: { key: string; mode: string }[] }) =>
          d.rows.find(r => r.key === 'Fajr')?.mode,
      ),
    );
    expect([...modes]).toEqual(['silent']);
    settings.prayerAlertModes = {};
  });
});

describe('"Play adhan as an alarm" is a different channel, not a flag', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
    settings.adhanUsesAlarmStream = false;
  });

  it('hands the button the alarm twin when the setting is on', async () => {
    // It handed over the ordinary channel before. Cycling a prayer back
    // to Adhan from the lock screen then re-created its adhan on the
    // stream a silenced phone silences — undoing, quietly, the one thing
    // that setting exists to do.
    settings.adhanUsesAlarmStream = true;
    await run(new Date(2026, 8, 7, 13, 0, 0, 0));
    const p = sent();
    const expected = resolveSoundTargets('adhan_makkah', true).androidChannelId;
    expect(p.adhanChannelId).toBe(expected);
    expect(p.adhanChannelId).toBe(alarmChannelId('prayer-times-adhan-makkah'));
    expect(p.adhanChannelId).toMatch(/-alarm$/);
  });

  it('hands over the ordinary one when it is off', async () => {
    settings.adhanUsesAlarmStream = false;
    await run(new Date(2026, 8, 7, 13, 0, 0, 0));
    const p = sent();
    expect(p.adhanChannelId).toBe(
      resolveSoundTargets('adhan_makkah', false).androidChannelId,
    );
    expect(p.adhanChannelId).not.toMatch(/-alarm$/);
  });

  it('never puts the alarm twin on the plain-alert channel', async () => {
    // The alarm stream is for the CALL TO PRAYER. A prayer cycled to the
    // ordinary tone, a night mark, a reminder — none of them may override
    // a silenced phone, whatever this setting says.
    settings.adhanUsesAlarmStream = true;
    await run(new Date(2026, 8, 7, 13, 0, 0, 0));
    expect(sent().defaultChannelId).not.toMatch(/-alarm$/);
  });

  it('asks for the plain channel rather than spelling it out', async () => {
    // It was the literal string in two places, true until the day the
    // default option's channel is renamed and the button starts posting
    // to one that does not exist.
    await run(new Date(2026, 8, 7, 13, 0, 0, 0));
    expect(sent().defaultChannelId).toBe(
      resolveSoundTargets('default').androidChannelId,
    );
  });
});


describe('the alert still arrives when the channel does not', () => {
  const created = () =>
    (notifee.createTriggerNotification as jest.Mock).mock.calls.at(-1)?.[0];

  beforeEach(() => {
    (notifee.createTriggerNotification as jest.Mock).mockClear();
    (notifee.getChannel as jest.Mock).mockReset();
  });
  afterAll(() => {
    (notifee.getChannel as jest.Mock).mockImplementation(id =>
      Promise.resolve({ id }),
    );
  });

  const future = Date.now() + 3_600_000;
  const base = {
    epoch: future,
    name: 'Fajr',
    mode: 'adhan',
    adhanChannelId: 'prayer-times-adhan-makkah-alarm',
    defaultChannelId: 'prayer-times-default',
    title: 'Fajr',
    body: 'Prayer time',
    adhanSoundId: 'adhan_makkah',
  };

  it('uses the alarm twin when it is there', async () => {
    (notifee.getChannel as jest.Mock).mockImplementation(id =>
      Promise.resolve({ id }),
    );
    await adhanMuteToggleTask(base as never);
    expect(created().android.channelId).toBe(
      'prayer-times-adhan-makkah-alarm',
    );
    expect(created().data.usesAdhan).toBe('1');
  });

  it('falls back to a plain alert rather than posting into nothing', async () => {
    // Turning "Play adhan as an alarm" on creates that channel on the NEXT
    // sync. Press the button before then and the id the card is carrying
    // names a channel that does not exist yet — which Android drops in
    // silence, so the prayer would not arrive at all. It arrives.
    (notifee.getChannel as jest.Mock).mockImplementation(id =>
      Promise.resolve(id === 'prayer-times-default' ? { id } : null),
    );
    await adhanMuteToggleTask(base as never);
    expect(created().android.channelId).toBe('prayer-times-default');
    expect(created()).toBeTruthy();
  });

  it('survives the lookup throwing', async () => {
    (notifee.getChannel as jest.Mock).mockImplementation(() => {
      throw new Error('no such method on this build');
    });
    await adhanMuteToggleTask(base as never);
    expect(created().android.channelId).toBe('prayer-times-default');
  });
});


describe('the heads-up goes with the prayer it belongs to', () => {
  /*
   * The 15-minute reminder is a separate alert with its own id, and the
   * task used to leave it alone — the next full resync would catch up.
   * Eventually is the problem: the case this control exists for is
   * silencing an early Fajr the night before, and the phone then stays
   * locked until morning. The prayer was silent and the reminder went off
   * fifteen minutes before it anyway.
   */
  const calls = () =>
    (notifee.createTriggerNotification as jest.Mock).mock.calls.map(c => c[0]);
  const cancelled = () =>
    (notifee.cancelTriggerNotification as jest.Mock).mock.calls.map(c => c[0]);

  const FAJR = new Date(2026, 8, 8, 3, 36, 0, 0).getTime();
  const base = {
    epoch: FAJR,
    name: 'Fajr',
    adhanChannelId: 'prayer-times-adhan-makkah',
    defaultChannelId: 'prayer-times-default',
    title: 'Fajr',
    body: 'Prayer time',
    adhanSoundId: 'adhan_makkah',
  };

  beforeEach(() => {
    (notifee.createTriggerNotification as jest.Mock).mockClear();
    (notifee.cancelTriggerNotification as jest.Mock).mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(
      new Date(2026, 8, 7, 22, 30, 0, 0).getTime(),
    );
    settings.prePrayerReminderMinutes = 15;
  });
  afterEach(() => {
    (Date.now as jest.Mock).mockRestore?.();
    settings.prePrayerReminderMinutes = 0;
  });

  it('cancels it when the occurrence goes silent', async () => {
    await adhanMuteToggleTask({ ...base, mode: 'silent' } as never);
    expect(cancelled()).toContain(preReminderId(FAJR, 'Fajr', 15));
    // And the prayer's own alert, which is what silent means.
    expect(cancelled()).toContain(`pt-${FAJR}-Fajr`);
  });

  it('puts it back when the occurrence comes off silent', async () => {
    await adhanMuteToggleTask({ ...base, mode: 'adhan' } as never);
    const pre = calls().find(n => n.id === preReminderId(FAJR, 'Fajr', 15));
    expect(pre).toBeTruthy();
    // The plain tone, never the adhan: a heads-up is not the call to prayer.
    expect(pre.android.channelId).toBe('prayer-times-default');
  });

  it('addresses the id the scheduler wrote', () => {
    // The scheduler names it after the REMINDER's own instant; this is
    // the same subtraction, in the one place both can reach.
    expect(preReminderId(FAJR, 'Fajr', 15)).toBe(
      `pt-pre-${FAJR - 15 * 60_000}-Fajr`,
    );
  });

  it('does nothing at all when the reminder is switched off', async () => {
    // Which is the default.
    settings.prePrayerReminderMinutes = 0;
    await adhanMuteToggleTask({ ...base, mode: 'silent' } as never);
    expect(cancelled().filter(id => String(id).startsWith('pt-pre-'))).toEqual(
      [],
    );
  });

  it('does not schedule one into the past', async () => {
    (Date.now as jest.Mock).mockReturnValue(FAJR - 60_000);
    await adhanMuteToggleTask({ ...base, mode: 'adhan' } as never);
    expect(
      calls().find(n => String(n.id).startsWith('pt-pre-')),
    ).toBeUndefined();
  });
});

describe('both writers put an alert on the clock the same way', () => {
  it('the task rides the scheduler’s own trigger builder', () => {
    // The scheduler asks AlarmManager for the exact type when the
    // permission is granted and the inexact allow-while-idle type when it
    // is not. The task passed a hand-written `{ allowWhileIdle: true }`
    // that asked for neither — so a prayer re-created by the card's button
    // could be less punctual than the same prayer scheduled a minute
    // earlier by the app.
    const ts = readFileSync(
      path.join(__dirname, '..', 'src/notifications/adhanMute.ts'),
      'utf-8',
    );
    expect(ts).toContain('buildTimestampTrigger(epoch, exactAlarms)');
    expect(ts).not.toContain('allowWhileIdle');
    expect(ts).toContain('await canUseExactAlarms()');
  });

  it('and neither module imports the other to get it', () => {
    // `prayerNotifications` already reads the override out of
    // `adhanMute`; exporting the trigger back the other way would close a
    // cycle between them.
    const sched = readFileSync(
      path.join(__dirname, '..', 'src/notifications/scheduling.ts'),
      'utf-8',
    );
    expect(sched).not.toContain("from './prayerNotifications'");
    expect(sched).not.toContain("from './adhanMute'");
  });
});
