/**
 * The card is told what every prayer is set to.
 *
 * The action button on the Live Activity is the home row's control now
 * (see `liveActivityAlertCycle.test.ts` for the cycle itself), and a
 * control that does not know the current state cannot be one: the button
 * it replaced offered "Mute next adhan" over prayers that were already
 * set to the plain alert, because nothing in the payload said otherwise.
 *
 * The mode rides on every row of every day rather than on one field at
 * the head of the payload. That is not tidiness — the card walks to the
 * next event by itself, in the foreground service, with no JS running,
 * so a single "the next one is set to X" would be describing the
 * previous prayer within minutes. It is the same hop that once let an
 * unmute aimed at Sunrise hand it the call to prayer.
 */
import { Platform } from 'react-native';

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
  prayerAlertModes: { Fajr: 'silent', Dhuhr: 'notification' },
};
jest.mock('../src/settings/storage', () => ({
  loadSettings: jest.fn(async () => settings),
}));

import { syncLiveActivity } from '../src/liveActivity/syncLiveActivity';

const day = {
  Fajr: '05:00',
  Sunrise: '06:30',
  Dhuhr: '12:00',
  Asr: '15:00',
  Maghrib: '18:00',
  Isha: '20:00',
};
const sent = () => JSON.parse(mockDisplay.mock.calls.at(-1)![0]);

describe('the payload the card is built from', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
  });

  const run = async () => {
    mockDisplay.mockClear();
    await syncLiveActivity({
      options: { enabled: true },
      today: day,
      tomorrow: day,
      week: [day, day],
      locationName: 'Stockholm',
      now: new Date(2026, 5, 14, 9, 0, 0, 0),
    } as never);
  };

  beforeEach(run);

  it('stamps a mode on every row of every day', () => {
    const p = sent();
    const rows = [
      ...p.rows,
      ...p.days.flatMap((d: { rows: { mode?: string }[] }) => d.rows),
    ];
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect(r.mode).toBeTruthy();
  });

  it('carries the home screen’s answer, not a default', () => {
    const p = sent();
    const modeOf = (key: string) =>
      p.rows.find((r: { key: string }) => r.key === key)?.mode;
    expect(modeOf('Fajr')).toBe('silent');
    expect(modeOf('Dhuhr')).toBe('notification');
    // Never touched, and an adhan is chosen — the old global answer,
    // which is still what an untouched row means.
    expect(modeOf('Asr')).toBe('adhan');
  });

  it('says the same thing about tomorrow’s Fajr as about today’s', () => {
    // The standing mode belongs to the prayer, not to the day, which is
    // what makes the native lookup by key safe.
    const p = sent();
    for (const d of p.days) {
      const fajr = d.rows.find((r: { key: string }) => r.key === 'Fajr');
      expect(fajr.mode).toBe('silent');
    }
  });

  it('sends the three state words the home rows print', () => {
    const p = sent();
    expect(p.alertLabelAdhan).toBe('Adhan');
    expect(p.alertLabelNotification).toBe('Alert');
    expect(p.alertLabelSilent).toBe('Silent');
    expect(p.alertOnceWord).toBe('once');
  });

  it('has no trace of the two-state button left in it', () => {
    const p = sent();
    expect(p.muteLabel).toBeUndefined();
    expect(p.unmuteLabel).toBeUndefined();
    expect(p.adhanActionEnabled).toBeUndefined();
  });

  it('offers the action with no adhan chosen', () => {
    // The old gate withheld the button unless an adhan was selected,
    // because the only thing it could do was mute one. Three modes are
    // worth offering either way — and the home row offers them either
    // way, which is the whole point of the two being one control.
    expect(sent().alertActionEnabled).toBe(true);
  });
});

describe('the master switch still has the last word', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
    settings.notificationsEnabled = true;
  });

  it('withholds the action and reads every row silent when it is off', async () => {
    // Cycling would either do nothing audible or quietly turn the master
    // back on — which is what the home row does, and exactly what a
    // control meant to last one prayer must not do.
    settings.notificationsEnabled = false;
    mockDisplay.mockClear();
    await syncLiveActivity({
      options: { enabled: true },
      today: day,
      tomorrow: day,
      week: [day, day],
      locationName: 'Stockholm',
      now: new Date(2026, 5, 14, 9, 0, 0, 0),
    } as never);
    const p = sent();
    expect(p.alertActionEnabled).toBe(false);
    for (const r of p.rows) expect(r.mode).toBe('silent');
  });
});
