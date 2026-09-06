/**
 * How this app puts a notification on a clock — in one place, because
 * two writers now do it.
 *
 * The scheduler owns the whole set and rewrites it wholesale. The Live
 * Activity's alert-mode button owns exactly one alert and rewrites that
 * from a headless task, with the app closed. Both are creating the same
 * kind of thing at the same kind of moment, and until this module existed
 * they disagreed about how: the scheduler rode AlarmManager with the
 * exact type when the permission was granted and the inexact
 * allow-while-idle type otherwise, and the task passed a hand-written
 * `{ allowWhileIdle: true }` that asked for neither.
 *
 * That is not a cosmetic difference. A prayer re-created by the card's
 * button could be scheduled less punctually than the same prayer
 * scheduled a minute earlier by the app — the one thing the comment
 * inside `buildTimestampTrigger` says must not happen, on the platform it
 * says it about.
 *
 * Extracted rather than exported from `prayerNotifications` because that
 * module already imports the override out of `adhanMute`, and importing
 * the trigger back the other way would close a cycle between the two.
 */
import { Platform } from 'react-native';
import notifee, {
  AlarmType,
  AndroidNotificationSetting,
  TriggerType,
} from '@notifee/react-native';

/** Re-check exact-alarm permission. Android can revoke SCHEDULE_EXACT_ALARM
 *  at runtime; this MUST be called close to scheduling, not just at boot.
 */
export async function canUseExactAlarms(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const settings = await notifee.getNotificationSettings();
  return settings.android.alarm === AndroidNotificationSetting.ENABLED;
}

export function buildTimestampTrigger(
  timestamp: number,
  exactAlarms: boolean,
): {
  type: typeof TriggerType.TIMESTAMP;
  timestamp: number;
  alarmManager?: { type: AlarmType };
} {
  const trigger = {
    type: TriggerType.TIMESTAMP as const,
    timestamp,
  };
  if (Platform.OS === 'android') {
    // Always ride AlarmManager on Android (v2.7.28). Without this,
    // notifee schedules through WorkManager, which aggressive OEM
    // battery managers (MIUI, One UI, etc.) defer by minutes — a late
    // adhan is a broken adhan. Exact when the user granted exact-alarm
    // access; otherwise the inexact allow-while-idle variant, which
    // needs no permission and is still far more punctual than WM.
    Object.assign(trigger, {
      alarmManager: {
        type: exactAlarms
          ? AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE
          : AlarmType.SET_AND_ALLOW_WHILE_IDLE,
      },
    });
  }
  return trigger;
}

/**
 * Clamp the pre-prayer reminder offset to a sane range.
 *
 * Defense-in-depth: settings.coercePrePrayerReminderMinutes already restricts
 * input to a discrete option list, but corrupted AsyncStorage, type-bypass
 * paths, or future callers might pass negative numbers, NaN, Infinity, or
 * absurdly large values. Negative reminders would fire AFTER the prayer
 * (the bug called out in task #3); huge values would create reminders many
 * hours before. Clamp to [0, 60] and reject non-finite input.
 *
 * @returns an integer in [0, 60]. Returns 0 for any invalid input.
 */
export function clampPrePrayerReminderMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const n = Math.floor(value);
  if (n <= 0) return 0;
  if (n >= 60) return 60;
  return n;
}

/** The id the scheduler gives the heads-up before an event, derived from
 *  the event's own instant so a second writer can address the same one.
 *  Must match the prefix and shape in `prayerNotifications`. */
export function preReminderId(
  eventEpochMs: number,
  name: string,
  minutesBefore: number,
): string {
  return `pt-pre-${eventEpochMs - minutesBefore * 60_000}-${name}`;
}
