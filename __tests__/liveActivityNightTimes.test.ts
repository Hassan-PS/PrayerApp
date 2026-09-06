/**
 * The Live Activity counts down to the night marks the user turned on.
 *
 * Reported as a lag: the card sat on the First Third long after it had
 * passed and only moved onto Fajr when the app was opened. The native
 * ticker advances itself from the payload, and the payload is where the
 * night marks have to be — they travel outside `rows` (the card draws them
 * differently), so a payload that dropped them left the service with no
 * way to land on one, and no way to step off it either.
 *
 * This is the JS half of that fix: the data the ticker needs is sent, for
 * today and for every day in the window.
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
jest.mock('../src/settings/storage', () => ({
  loadSettings: jest.fn(async () => ({
    notificationsEnabled: true,
    notificationSound: 'default',
    liveActivityLockButton: true,
  })),
}));

import { syncLiveActivity } from '../src/liveActivity/syncLiveActivity';

const day = (firstThird: string) => ({
  Fajr: '05:00',
  Sunrise: '06:30',
  Dhuhr: '12:00',
  Asr: '15:00',
  Maghrib: '18:00',
  Isha: '20:00',
  Firstthird: firstThird,
});

const sent = () => JSON.parse(mockDisplay.mock.calls.at(-1)![0]);

describe('the Live Activity payload carries the enabled night marks', () => {
  const ORIGINAL_OS = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => ORIGINAL_OS });
  });
  beforeEach(() => mockDisplay.mockClear());

  const run = (now: Date) =>
    syncLiveActivity({
      options: { enabled: true },
      today: day('22:00'),
      tomorrow: day('22:01'),
      week: [day('22:00'), day('22:01')],
      locationName: 'Stockholm',
      now,
    } as never);

  it('counts down to the First Third when it is the next event', async () => {
    await run(new Date(2026, 5, 14, 21, 0, 0, 0));
    const p = sent();
    expect(p.nextKey).toBe('Firstthird');
    expect(p.nextTime).toBe('22:00');
  });

  it('sends the night marks as extraRows, so the ticker can find them', async () => {
    await run(new Date(2026, 5, 14, 21, 0, 0, 0));
    const p = sent();
    expect(p.extraRows.map((r: { key: string }) => r.key)).toContain(
      'Firstthird',
    );
  });

  it('sends them on every day in the window, not just today', async () => {
    await run(new Date(2026, 5, 14, 21, 0, 0, 0));
    const p = sent();
    expect(p.days.length).toBeGreaterThan(0);
    for (const d of p.days) {
      expect(d.extraRows.map((r: { key: string }) => r.key)).toContain(
        'Firstthird',
      );
    }
  });

  it('never offers a night mark the adhan', async () => {
    await run(new Date(2026, 5, 14, 21, 0, 0, 0));
    const p = sent();
    // The action itself is not withheld any more — a night mark can be
    // set to the plain alert or to silence for one occurrence, same as a
    // prayer. What it may never carry is the call to prayer, and the
    // mode travelling on its row is where that is decided: the native
    // cycle is built from it, so a night mark that arrived marked
    // 'adhan' would be offered the adhan.
    expect(p.alertActionEnabled).toBe(true);
    const marks = [
      ...p.extraRows,
      ...p.days.flatMap((d: { extraRows: unknown[] }) => d.extraRows),
      ...(p.sunriseRow ? [p.sunriseRow] : []),
    ] as { key: string; mode: string }[];
    expect(marks.length).toBeGreaterThan(0);
    for (const r of marks) expect(r.mode).not.toBe('adhan');
  });

  it('leaves them out when the toggle is off', async () => {
    const noNight = { ...day('22:00'), Firstthird: undefined };
    delete noNight.Firstthird;
    await syncLiveActivity({
      options: { enabled: true },
      today: noNight,
      tomorrow: noNight,
      week: [noNight],
      locationName: 'Stockholm',
      now: new Date(2026, 5, 14, 21, 0, 0, 0),
    } as never);
    const p = sent();
    expect(p.nextKey).toBe('Fajr');
    expect(p.extraRows ?? []).toEqual([]);
  });
});
