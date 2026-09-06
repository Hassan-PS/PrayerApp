import notifee, {
  AndroidImportance,
  AndroidStyle,
  AuthorizationStatus,
  TriggerType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { makeClockFormatter } from '../utils/clockFormat';
import { alertModeFor, type AlertModeMap } from '../settings/alertModes';
import {
  buildDaruriAlertEvents,
  buildDaruriEndEvents,
  DARURI_KEYS,
  DARURI_OF,
  localYmd,
  type DaruriKey,
  type LoggedByDate,
} from '../prayer/daruriTimes';
import i18n from '../i18n';
import {
  getNotificationSoundOption,
  NOTIFICATION_SOUND_OPTIONS,
  registerCustomAdhan,
  resolveSoundTargets,
  alarmChannelId,
  type NotificationSoundId,
} from './notificationSounds';
import {
  ensureCustomAdhanChannel,
  ensureAlarmAdhanChannel,
  deleteAdhanChannel,
  syncCustomAdhan,
} from '../native/CustomAdhan';
import { ADHAN_CONTROLS_CATEGORY_ID } from './adhanActionIds';
import { prayerAlertActions } from './prayerAlertActions';
import { JOURNAL_LOG_ACTION_ID } from './prayerLogAction';
import { AdhanPlayer } from '../native/AdhanPlayer';
import { getNextAlertOverride, overrideAppliesTo } from './adhanMute';
import {
  buildTimestampTrigger,
  canUseExactAlarms,
  clampPrePrayerReminderMinutes,
} from './scheduling';

// Re-exported: this was its home before the Live Activity's button became
// a second writer of the same alerts and the primitives had to move
// somewhere neither module imports the other from.
export { clampPrePrayerReminderMinutes };
import type { TimingsMap } from '../types/prayer';
import {
  loggedByDate,
  storedJournalEntries,
} from '../journal/loggedPrayers';
import { isNonPrayerEvent } from '../types/prayer';
import {
  buildPrePrayerReminderEvents,
  buildUpcomingSalahEvents,
} from '../utils/prayerTimes';

/** Sunrise + the two night times are not salāh: default sound, no adhan, no
 *  journal action. The predicate lives in types/prayer beside the list, so
 *  every path that has to ask asks the same question — this file used to own
 *  the only copy, and the mute task did not have one. */

/** The days a second-time schedule can reach: today and the cached week. */
function daruriDatesFrom(base: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push(localYmd(d));
  }
  return out;
}

/**
 * The id of an end-of-window notification, carrying the prayers it covers.
 *
 * The keys are IN THE ID on purpose. Ẓuhr and ʿAṣr expire together at
 * Maghrib and are therefore one notification, so when only one of them is
 * logged the right move is not to cancel it but to redraw it naming the
 * other — and the code that does that runs from a journal write, in a
 * background handler that has no prayer times and no schedule in front of
 * it. Everything it needs is the instant and the keys, and both are here.
 */
export function daruriEndId(ms: number, keys: readonly DaruriKey[]): string {
  return `${PRAYER_NOTIFICATION_ID_PREFIX}daruri-end-${ms}-${keys.join('+')}`;
}

/** Read an end-of-window id back. Null for anything else. */
export function parseDaruriEndId(
  id: string,
): { ms: number; keys: DaruriKey[] } | null {
  const m = new RegExp(
    `^${PRAYER_NOTIFICATION_ID_PREFIX}daruri-end-(\\d+)-(.+)$`,
  ).exec(id);
  if (!m) return null;
  const keys = m[2]
    .split('+')
    .filter((k): k is DaruriKey =>
      (DARURI_KEYS as readonly string[]).includes(k),
    );
  return keys.length ? { ms: Number(m[1]), keys } : null;
}

/** Read a boundary (start) alert id back. Null for anything else. */
export function parseDaruriStartId(
  id: string,
): { ms: number; key: DaruriKey } | null {
  const m = new RegExp(
    `^${PRAYER_NOTIFICATION_ID_PREFIX}daruri-(\\d+)-(\\w+)$`,
  ).exec(id);
  if (!m) return null;
  const key = m[2];
  return (DARURI_KEYS as readonly string[]).includes(key)
    ? { ms: Number(m[1]), key: key as DaruriKey }
    : null;
}

/** Safety cap for how long a delivered prayer notification lingers before it
 *  auto-dismisses, when the next prayer is unusually far off (e.g. Isha→Fajr). */
const MAX_LINGER_MS = 12 * 60 * 60 * 1000;
/** A delivered prayer/reminder notification older than this (its scheduled time
 *  is this far in the past) is considered stale and cleared on the next sync. */
const STALE_DISPLAYED_GRACE_MS = 60 * 60 * 1000;

/** Extract the scheduled epoch-ms encoded in one of our notification ids
 *  (`pt-<ms>-<name>` or `pt-pre-<ms>-<name>`). Returns null for foreign ids. */
function prayerNotificationTime(id: string): number | null {
  const m = /^pt-(?:pre-)?(\d+)-/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Clear already-DELIVERED prayer/reminder notifications whose scheduled time is
 * well in the past. `cancelOwnedPrayerNotifications` only cancels pending
 * *triggers*; once a notification has fired it lingers in the shade / AOD until
 * dismissed — which is how a previous prayer's "Prayer time" alert stayed on
 * screen next to the next prayer's reminder (the reported "it says Isha when it
 * isn't"). Going forward `timeoutAfter` auto-dismisses each one when the next
 * prayer arrives; this pass also cleans up ones delivered before that fix.
 */
async function clearStaleDisplayedPrayerNotifications(
  now: number,
): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS delivered list isn't reliably enumerable
  let displayed;
  try {
    displayed = await notifee.getDisplayedNotifications();
  } catch {
    return;
  }
  for (const d of displayed) {
    const id = d.notification?.id;
    if (
      typeof id !== 'string' ||
      !id.startsWith(PRAYER_NOTIFICATION_ID_PREFIX)
    ) {
      continue;
    }
    const t = prayerNotificationTime(id);
    if (t != null && t < now - STALE_DISPLAYED_GRACE_MS) {
      await notifee.cancelDisplayedNotification(id).catch(() => {});
    }
  }
}

/** Prefix used for all prayer-time and pre-prayer trigger notification IDs.
 *  Used to identify "ours" vs other notifications (e.g. the adhan preview)
 *  in the diff-based cancellation pass.
 */
const PRAYER_NOTIFICATION_ID_PREFIX = 'pt-';

const PREVIEW_NOTIFICATION_ID = 'adhan_preview';
let _previewCancelTimeout: ReturnType<typeof setTimeout> | null = null;

async function ensureChannel(
  selectedSound: NotificationSoundId,
  alarmStream = false,
) {
  // BEFORE the Android-only part, because iOS needs this too: what it
  // registers is the converted clip's filename, which is how the notification
  // addresses the user's recording there.
  if (selectedSound === 'custom') {
    const imported = await syncCustomAdhan();
    if (imported) {
      const channelId = await ensureCustomAdhanChannel(
        `Prayer times (${imported.name})`,
      );
      registerCustomAdhan({ ...imported, channelId: channelId ?? undefined });
    }
  }
  if (Platform.OS !== 'android') {
    return;
  }
  const selected = getNotificationSoundOption(selectedSound);
  const defaultOption = getNotificationSoundOption('default');
  // Only two channels are ever used: the `default` channel (pre-prayer
  // reminders + Sunrise) and the selected adhan channel (the five daily
  // prayers). Previously ALL 17 adhan channels were created on every sync,
  // leaving users with 17 near-identical "Prayer times" entries in Android's
  // notification settings. We now create only what's needed and delete the
  // surplus so existing users' settings get cleaned up too. (Channel sound is
  // immutable after creation, which is why each sound still needs its own
  // channel rather than mutating one.)
  //
  // The user's own recording is handled above and is deliberately absent from
  // the loop below: its channel is built natively, around a token derived from
  // the file, because Notifee's channel `sound` only ever resolves a `res/raw`
  // resource. If its file has gone — a reinstall drops it while the setting
  // that selects it survives — `resolveSoundTargets` has already fallen back
  // to the default channel, which is what gets created here.
  const needed = new Set([
    defaultOption.androidChannelId,
    resolveSoundTargets(selectedSound).androidChannelId,
  ]);
  for (const option of NOTIFICATION_SOUND_OPTIONS) {
    // Notifee neither created nor owns the custom channel, and this entry's
    // ids are placeholders — deleting by them would take out the default
    // channel. The native module prunes its own stale channels on import.
    if (option.id === 'custom') continue;
    if (needed.has(option.androidChannelId)) {
      await notifee.createChannel({
        id: option.androidChannelId,
        name:
          option.id === selected.id
            ? `Prayer times (${i18n.t(option.labelKey)})`
            : 'Prayer times',
        importance: AndroidImportance.HIGH,
        vibration: true,
        ...(option.androidSound ? { sound: option.androidSound } : {}),
      });
    } else {
      // No-op when the channel was never created (e.g. fresh installs).
      await notifee.deleteChannel(option.androidChannelId).catch(() => {});
    }
  }

  // ── THE ALARM-STREAM TWIN (issue #9) ────────────────────────────────
  //
  // Built natively, because Notifee's `createChannel` cannot express audio
  // attributes and `USAGE_ALARM` is the entire point: it routes the adhan
  // to the alarm stream, which the ringer switch does not silence.
  //
  // Only ever ONE of these exists — the twin of whatever adhan is
  // selected. The ordinary channels above are still created either way:
  // the pre-prayer reminder and Sunrise keep using them, because a
  // reminder that overrides a silenced phone is not what was asked for.
  //
  // Turning the setting off deletes it, so Android's notification settings
  // do not keep an entry that nothing posts to any more.
  const selectedTargets = resolveSoundTargets(selectedSound);
  const alarmId = alarmChannelId(selectedTargets.androidChannelId);
  if (alarmStream) {
    const option = getNotificationSoundOption(selectedSound);
    await ensureAlarmAdhanChannel(
      alarmId,
      `Prayer times (${i18n.t(option.labelKey)}) — alarm`,
      // null means "the imported recording", which the native side reads
      // from disk. Bundled adhans name their res/raw resource.
      selectedSound === 'custom' ? null : (option.androidSound ?? null),
    );
  } else {
    await deleteAdhanChannel(alarmId);
  }
}

function iosNotificationsAllowed(status: AuthorizationStatus): boolean {
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Cancel any existing prayer-time / pre-prayer trigger notifications whose
 * IDs are NOT in `keepIds`. Preserves unrelated notifications (e.g. the
 * adhan preview).
 *
 * This replaces the previous `cancelTriggerNotifications()` bulk call. The
 * bulk call created a window where ALL prayer notifications vanished
 * between cancel and recreate; if the app was killed in that gap, prayer
 * alerts silently disappeared. The diff-based approach only cancels truly
 * obsolete IDs and lets `createTriggerNotification` replace existing IDs
 * atomically (notifee's documented behavior).
 */
async function cancelOwnedPrayerNotifications(
  keepIds: string[],
): Promise<void> {
  const keep = new Set(keepIds);
  let existing;
  try {
    existing = await notifee.getTriggerNotifications();
  } catch {
    // Older notifee versions / flaky native module — fall back to bulk cancel
    // so we at least don't leak orphan notifications. Better than skipping.
    await notifee.cancelTriggerNotifications().catch(() => {});
    return;
  }
  for (const t of existing) {
    const id = t.notification?.id;
    if (typeof id !== 'string') continue;
    if (id === PREVIEW_NOTIFICATION_ID) continue; // never cancel the preview
    if (!id.startsWith(PRAYER_NOTIFICATION_ID_PREFIX)) continue; // only ours
    if (keep.has(id)) continue;
    await notifee.cancelTriggerNotification(id).catch(() => {});
  }
}

/** Play a short preview of the given adhan/notification sound. */
export async function previewAdhanSound(
  soundId: NotificationSoundId,
): Promise<void> {
  // Cancel any in-flight preview
  if (_previewCancelTimeout !== null) {
    clearTimeout(_previewCancelTimeout);
    _previewCancelTimeout = null;
  }
  await notifee.cancelNotification(PREVIEW_NOTIFICATION_ID).catch(() => {});

  // iOS: play the FULL adhan in-app (the Settings screen is open, so this is
  // foreground playback). The notification sound is capped at 30s, so previewing
  // via a notification would only play a 29s clip — playing the bundled full
  // recording lets the user actually hear the complete adhan they're choosing.
  if (Platform.OS === 'ios' && soundId !== 'default') {
    if (soundId === 'custom') {
      // Not a bundle resource, so it is played by path — and by the FULL
      // original rather than the 29s clip the notification would get, which is
      // the whole reason the original is kept alongside it.
      const imported = await syncCustomAdhan();
      if (imported?.path) void AdhanPlayer.playPath(imported.path);
      return;
    }
    void AdhanPlayer.play(soundId);
    return;
  }

  await ensureChannel(soundId);
  const targets = resolveSoundTargets(soundId);

  await notifee.displayNotification({
    id: PREVIEW_NOTIFICATION_ID,
    title: i18n.t('settings.adhanPreviewTitle'),
    body: i18n.t('settings.adhanPreviewBody', { defaultValue: '' }),
    ios: { sound: targets.iosSound },
    android: {
      channelId: targets.androidChannelId,
      smallIcon: 'ic_stat_prayer',
      pressAction: { id: 'default' },
    },
  });

  // Auto-cancel after 30 s (adhan recordings are ~30–60 s; this clears the banner)
  _previewCancelTimeout = setTimeout(() => {
    _previewCancelTimeout = null;
    notifee.cancelNotification(PREVIEW_NOTIFICATION_ID).catch(() => {});
  }, 30000);
}

/** Cancel any in-flight adhan preview notification. */
export async function stopAdhanPreview(): Promise<void> {
  if (_previewCancelTimeout !== null) {
    clearTimeout(_previewCancelTimeout);
    _previewCancelTimeout = null;
  }
  void AdhanPlayer.stop();
  await notifee.cancelNotification(PREVIEW_NOTIFICATION_ID).catch(() => {});
}

/**
 * Result of a sync attempt. Exposed so callers (HomeScreen) can react —
 * e.g. show an "exact-alarm permission revoked" banner when
 * `status === 'scheduled'` and `exactAlarms === false` on Android.
 */
export type SyncPrayerNotificationsResult =
  | { status: 'disabled' }
  | { status: 'ios-permission-denied' }
  | {
      status: 'scheduled';
      scheduledCount: number;
      exactAlarms: boolean;
      reminderMinutes: number;
    };

/**
 * Stable id for the "Log prayer in journal" notification action — task #99.
 *
 * Every prayer-time notification carries this action. Pressing it RECORDS
 * the prayer — see `prayerLogAction`, which owns the write and works with
 * the app closed. It used only to hand a deep-link to the Log screen, which
 * meant it did nothing at all unless that screen happened to be open;
 * fixed 2026-08-07.
 */
export { JOURNAL_LOG_ACTION_ID };

/** Local ISO day key for the day an alert belongs to. Local, not UTC: the
 *  journal is keyed on the day the user is living in. */
function ymdLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * A prayer has just been recorded — take its boundaries off the schedule.
 *
 * The counterpart to `syncEndOfDayReminderForDay`, and it exists for the
 * same reason: the schedule was written before the journal knew anything,
 * and by the time a boundary fires the person may have answered the
 * question it is about. An alert saying ʿAṣr's preferred time has closed,
 * or that ʿAṣr is now qaḍāʾ, sent to someone who prayed ʿAṣr at 16:35 and
 * logged it, is the app contradicting its own records.
 *
 * Runs off the PENDING IDS rather than off the times, because this is
 * called from a journal write — including the one inside a notification
 * action handler, where there is no screen, no week of prayer times and
 * no settings in front of us. Everything needed is in the ids.
 *
 * The end-of-window notification is shared: Ẓuhr and ʿAṣr expire together
 * at Maghrib. Logging one of them must not cancel the other's warning, so
 * a partially-answered one is REDRAWN with the remaining prayers rather
 * than dropped — same instant, same trigger, one fewer name.
 */
export async function dropDaruriAlertsForLogged(
  date: string,
  prayers: readonly string[],
): Promise<void> {
  if (prayers.length === 0) return;
  const answered = new Set(prayers);
  // The same plain sound the schedule gives these: a boundary is not a
  // prayer and never speaks with the adhan.
  const sound = getNotificationSoundOption('default');
  const ids = await notifee.getTriggerNotificationIds().catch(() => []);

  for (const id of ids) {
    const start = parseDaruriStartId(id);
    if (start) {
      // The date the WINDOW belongs to, recovered from the instant. A
      // lead time can put the alert on the previous day, so the window's
      // own day is the one that has to match — and for Ishāʾ that is the
      // day before the boundary lands.
      if (
        answered.has(DARURI_OF[start.key]) &&
        localYmd(new Date(start.ms)) === date
      ) {
        await notifee.cancelTriggerNotification(id).catch(() => {});
      }
      continue;
    }

    const end = parseDaruriEndId(id);
    if (!end) continue;
    const keep = end.keys.filter(k => !answered.has(DARURI_OF[k]));
    if (keep.length === end.keys.length) continue;
    await notifee.cancelTriggerNotification(id).catch(() => {});
    if (keep.length === 0) continue;
    // Redrawn from the id alone: the instant is in it, and the body of
    // this notification never mentions a time.
    const names = keep
      .map(k => i18n.t(`prayer.${DARURI_OF[k]}`, { defaultValue: DARURI_OF[k] }))
      .join(i18n.t('common.listJoin', { defaultValue: ' & ' }));
    const body = i18n.t('alertCopy.daruriExpired', {
      defaultValue: 'The time has ended — pray it as qada',
    });
    await notifee
      .createTriggerNotification(
        {
          id: daruriEndId(end.ms, keep),
          title: names,
          body,
          ios: { sound: sound.iosSound },
          android: {
            style: { type: AndroidStyle.BIGTEXT, text: body },
            channelId: sound.androidChannelId,
            smallIcon: 'ic_stat_prayer',
            pressAction: { id: 'default' },
            timeoutAfter: MAX_LINGER_MS,
          },
        },
        { type: TriggerType.TIMESTAMP, timestamp: end.ms },
      )
      .catch(() => {});
  }
}

export async function syncPrayerNotifications(params: {
  enabled: boolean;
  prePrayerReminderMinutes: number;
  notificationSound: NotificationSoundId;
  /** Android: post the adhan to the alarm-stream channel, so the ringer
   *  switch does not silence it (issue #9). */
  adhanUsesAlarmStream?: boolean;
  today: TimingsMap;
  tomorrow?: TimingsMap;
  /** The local calendar day `today` was fetched for — see
   *  buildUpcomingSalahEvents. Pass whenever available. */
  baseDate?: Date;
  /** Consecutive cached days starting today (`week[0]` = today). Days beyond
   *  tomorrow extend alert coverage so alerts keep firing when the app isn't
   *  opened for a couple of days (v2.7.40) — capped internally. */
  week?: TimingsMap[];
  /** When true, the prayer-time alert gets a "Log prayer" action — task #99. */
  journalLogActionEnabled?: boolean;
  /**
   * Draw clock times in alert copy on a 12-hour clock — issue #18.
   *
   * Only Sunrise and the night marks print a time at all (a prayer alert
   * says "Prayer time"), but that time is read on a lock screen next to
   * the system clock, so it follows what the app shows. The RESOLVED
   * answer, not the stored preference: the caller has already asked the
   * device (via `useClockFormatter`), and resolving again here would be
   * a second place for the two to disagree. Defaults to 24-hour for
   * callers that predate the setting.
   */
  hour12?: boolean;
  /**
   * Which Mālikī second-time boundaries alert — issue #19. A subset of
   * `DARURI_KEYS`, empty by default. See `buildDaruriAlertEvents` for
   * why this is chosen a prayer at a time rather than by one switch.
   */
  daruriAlerts?: readonly string[];
  /** Minutes of warning before each of those; 0 means at the boundary. */
  daruriAlertMinutes?: number;
  /**
   * Also announce the far end of each chosen window — the instant the
   * prayer becomes qaḍāʾ (issue #19).
   *
   * One switch over the boundaries already chosen rather than a second
   * per-prayer list: someone who wants to know when ʿAṣr's preferred time
   * closes is the same person who wants to know when ʿAṣr runs out, and
   * two lists to keep in step would be two chances to disagree.
   */
  daruriEndAlerts?: boolean;
  /**
   * Which prayers are already recorded, by local date — issue #23.
   *
   * A boundary alert for a prayer the journal already holds is the app
   * telling someone they are late for something they have done.
   *
   * Optional, and read from storage when it is absent — the same shape
   * `rescheduleEndOfDayLogReminders` uses, and for the same reason: the
   * callers are screens that do not otherwise hold the journal, and
   * making each of them learn about it to schedule a notification is a
   * worse trade than one decrypt here. It is skipped entirely unless a
   * second-time alert is actually armed, which for almost everyone means
   * it never happens.
   */
  daruriLogged?: LoggedByDate;
  /**
   * How each row announces itself — adhan / notification / silent, keyed
   * by prayer. Sparse: a row that is absent keeps what the app did
   * before the setting existed. See `settings/alertModes.ts`.
   */
  alertModes?: AlertModeMap;
}): Promise<SyncPrayerNotificationsResult> {
  if (!params.enabled) {
    await cancelOwnedPrayerNotifications([]);
    return { status: 'disabled' };
  }
  if (Platform.OS === 'ios') {
    const n = await notifee.getNotificationSettings();
    if (!iosNotificationsAllowed(n.authorizationStatus)) {
      await cancelOwnedPrayerNotifications([]);
      return { status: 'ios-permission-denied' };
    }
  }
  const useAlarmStream = params.adhanUsesAlarmStream === true;
  const clock = makeClockFormatter(params.hour12 === true, i18n.language);
  await ensureChannel(params.notificationSound, useAlarmStream);
  const prayerTimeSound = getNotificationSoundOption(params.notificationSound);
  const reminderSound = getNotificationSoundOption('default');
  const exactAlarms = await canUseExactAlarms();
  const now = new Date();
  // The Live Activity's one-occurrence override — the card's action button
  // sets the upcoming event to adhan / alert / silent for that time only.
  // Read here so a full resync (app focus, a settings change, the daily
  // rearm) rebuilds that one alert the way the button left it instead of
  // flattening it back to the standing per-prayer mode.
  const nextAlertOverride = await getNextAlertOverride();
  // ── Per-row modes (v2.14.5) ─────────────────────────────────────────
  //
  // `adhanChosen` is the old global answer, and it is what a row falls
  // back to: an install that upgrades into this feature sounds exactly as
  // it did until somebody actually changes a row.
  const alertModes = params.alertModes ?? {};
  const adhanChosen = params.notificationSound !== 'default';
  const standingModeOf = (name: string) =>
    alertModeFor(name, alertModes, adhanChosen);
  /**
   * What this OCCURRENCE sounds like.
   *
   * The standing per-prayer mode, unless the Live Activity's button spoke
   * for this exact instant. Every consumer below goes through here — the
   * audible filter included, because "silent" has to mean no alarm is
   * registered rather than a quiet one, and that decision is made when
   * the list is built rather than when a row is written.
   */
  const modeAt = (name: string, atMs: number) =>
    overrideAppliesTo(nextAlertOverride, atMs, name)
      ? (nextAlertOverride as NonNullable<typeof nextAlertOverride>).mode
      : standingModeOf(name);

  const salahEvents = buildUpcomingSalahEvents(
    params.today,
    params.tomorrow,
    now,
    params.baseDate ?? now,
    // Two extra cached days beyond tomorrow (4 days of coverage total).
    // Capped so a sync stays a few dozen AlarmManager registrations, well
    // under the per-app alarm limit and quick enough for an on-focus sync.
    params.week?.slice(2, 4) ?? [],
  );
  const reminderMinutes = clampPrePrayerReminderMinutes(
    params.prePrayerReminderMinutes,
  );
  // Silent means no alarm is registered, not a muted one. It is the only
  // version of "silent" that also keeps the prayer off the lock screen,
  // and it is what someone who silenced Fajr is asking for.
  const audibleEvents = salahEvents.filter(
    e => modeAt(e.name, e.at.getTime()) !== 'silent',
  );
  const reminderEvents =
    reminderMinutes > 0
      ? buildPrePrayerReminderEvents(audibleEvents, reminderMinutes, now)
      : [];

  // The Mālikī second times, for whichever boundaries the reader asked to
  // be told about. Built from the same window the prayers are, so they
  // roll over with everything else; the boundaries themselves ride in the
  // timings maps under keys nothing else looks at (`daruriTimes.ts`).
  const daruriMinutes = clampPrePrayerReminderMinutes(
    params.daruriAlertMinutes ?? 0,
  );
  // Only when something is armed: with no boundary chosen there is
  // nothing for the journal to suppress, and this read decrypts.
  const daruriLogged =
    (params.daruriAlerts ?? []).length === 0
      ? undefined
      : (params.daruriLogged ??
        loggedByDate(
          await storedJournalEntries().catch(() => []),
          daruriDatesFrom(params.baseDate ?? now),
        ));

  /**
   * A boundary belongs to its prayer, and follows it into silence.
   *
   * `silent` means no alarm is registered — the reading that also keeps
   * the prayer off the lock screen, and the one the pre-prayer reminder
   * already obeys. The ikhtiyārī-window alerts did not, so someone who
   * silenced Fajr to avoid being woken at 04:30 was woken at 05:00
   * instead by an alert about the prayer they had just switched off.
   * Through `modeAt`, so the Live Activity's one-occurrence override
   * carries here too: silencing tonight's Isha silences tonight's
   * boundary and says nothing about tomorrow's.
   */
  const prayerSpeaksAt = (name: string, atMs: number) =>
    modeAt(name, atMs) !== 'silent';

  const daruriEvents = buildDaruriAlertEvents(
    [params.today, ...(params.tomorrow ? [params.tomorrow] : []), ...(params.week?.slice(2, 4) ?? [])],
    params.baseDate ?? now,
    params.daruriAlerts ?? [],
    daruriMinutes,
    now,
    daruriLogged,
    prayerSpeaksAt,
  );

  const daruriWeek = [
    params.today,
    ...(params.tomorrow ? [params.tomorrow] : []),
    ...(params.week?.slice(2, 5) ?? []),
  ];
  const daruriEndEvents = params.daruriEndAlerts
    ? buildDaruriEndEvents(
        daruriWeek,
        params.baseDate ?? now,
        params.daruriAlerts ?? [],
        now,
        daruriLogged,
        // Same rule as the lead-in alert above: the end of a window is
        // still an alert about that prayer.
        prayerSpeaksAt,
      )
    : [];

  // Nothing schedulable — the data is entirely in the past (e.g. a sync
  // fired with state fetched 2+ days ago, before the refetch landed).
  // Keep whatever is already scheduled rather than wiping the pending
  // alarms and leaving the user with NO alerts until the next good sync.
  if (
    audibleEvents.length === 0 &&
    reminderEvents.length === 0 &&
    daruriEvents.length === 0 &&
    daruriEndEvents.length === 0
  ) {
    return {
      status: 'scheduled',
      scheduledCount: 0,
      exactAlarms,
      reminderMinutes,
    };
  }

  // Compute desired ID set BEFORE cancelling, so we know which existing
  // notifications to keep. createTriggerNotification with the same ID
  // replaces atomically (no cancel/recreate gap).
  const desiredIds = new Set<string>();
  for (const e of audibleEvents) {
    desiredIds.add(
      `${PRAYER_NOTIFICATION_ID_PREFIX}${e.at.getTime()}-${e.name}`,
    );
  }
  for (const e of reminderEvents) {
    desiredIds.add(
      `${PRAYER_NOTIFICATION_ID_PREFIX}pre-${e.at.getTime()}-${e.name}`,
    );
  }
  for (const e of daruriEvents) {
    desiredIds.add(
      `${PRAYER_NOTIFICATION_ID_PREFIX}daruri-${e.at.getTime()}-${e.name}`,
    );
  }
  for (const e of daruriEndEvents) {
    desiredIds.add(daruriEndId(e.at.getTime(), e.keys));
  }
  await cancelOwnedPrayerNotifications([...desiredIds]);
  // Sweep up any previously-delivered prayer/reminder alerts that are now stale
  // (their time is well past) so an old prayer's banner can't sit next to the
  // current one in the shade / AOD.
  await clearStaleDisplayedPrayerNotifications(now.getTime());

  for (let i = 0; i < audibleEvents.length; i++) {
    const e = audibleEvents[i];
    const notificationId = `${PRAYER_NOTIFICATION_ID_PREFIX}${e.at.getTime()}-${
      e.name
    }`;
    // Sunrise, Islamic Midnight and the Last Third are NOT prayers, so they
    // must never play the adhan even when one is selected for the five daily
    // prayers. They fall back to the plain default notification sound; every
    // actual prayer uses the user's chosen adhan/sound.
    const isNonPrayer = isNonPrayerEvent(e.name);
    // The row's own mode decides, unless the card's button spoke for this
    // one instant. `isNonPrayer` stays in the condition rather than being
    // folded into the mode: Sunrise can never reach 'adhan' through the
    // setting, and it must not reach it through a stored value either.
    const wantsAdhan =
      !isNonPrayer && modeAt(e.name, e.at.getTime()) === 'adhan';
    const eventSound = wantsAdhan ? prayerTimeSound : reminderSound;
    // The alarm twin is for the CALL TO PRAYER only. Sunrise and the night
    // times are not prayers, and an occurrence the card's button has just
    // moved off the adhan was moved off it on purpose — neither should
    // override a silenced phone.
    const eventTargets = resolveSoundTargets(
      eventSound.id,
      useAlarmStream && wantsAdhan,
    );
    const usesAdhan = eventSound.id !== 'default';
    const atPrayerTitle = i18n.t(`prayer.${e.name}`, { defaultValue: e.name });
    // A prayer alert says "Prayer time"; Sunrise / the night times are NOT
    // prayers, so they show the clock time instead of the misleading
    // "Prayer time" line (reported for the Sunrise alert).
    const atPrayerBody = isNonPrayer
      ? clock.fromDate(e.at)
      : i18n.t('alertCopy.atPrayer');
    // Auto-dismiss this alert when the NEXT event is due, so a fired prayer's
    // notification never lingers into (or past) the following prayer. Capped
    // for the long Isha→Fajr gap. Android honours this even if the app is
    // killed, which is the case that produced the stale "Isha" alert.
    const nextAt = audibleEvents[i + 1]?.at.getTime();
    const timeoutAfterMs = Math.max(
      60_000,
      Math.min(nextAt ? nextAt - e.at.getTime() : MAX_LINGER_MS, MAX_LINGER_MS),
    );
    await notifee.createTriggerNotification(
      {
        id: notificationId,
        // Translate the prayer name through i18n so the notification reads
        // in the active app language ("الفجر" rather than "Fajr" for an
        // Arabic user). `e.name` is the canonical English key (Fajr,
        // Sunrise, …) which doubles as the i18n lookup key under
        // `prayer.<name>`. Falls back to the raw English name if the
        // active locale is missing the entry.
        title: atPrayerTitle,
        body: atPrayerBody,
        data: {
          kind: 'prayer_time',
          usesAdhan: usesAdhan ? '1' : '0',
          // The day this alert is FOR. The "Log prayer" action writes to it
          // rather than to whatever day it is when the button is pressed:
          // Isha fires at 23:40 in a Swedish winter and gets answered after
          // midnight, and crediting the wrong day is the one thing a record
          // must not do. `prayerLogAction` reads this, falling back to the
          // timestamp in the notification id.
          targetDate: ymdLocal(e.at),
          prayer: e.name,
          // The selected adhan's id doubles as the bundled audio base name
          // (e.g. 'adhan_makkah' → adhan_makkah.mp3). The iOS foreground handler
          // uses it to play the FULL adhan on tap / when the app is open, since
          // iOS caps the notification sound itself at 30s.
          adhanSound: eventSound.id,
        },
        ios: {
          sound: eventTargets.iosSound,
          // Every real prayer (adhan or plain) carries the Stop + Snooze
          // category so both actions are available; non-prayer events (Sunrise,
          // night times) get no actions.
          ...(isNonPrayer ? {} : { categoryId: ADHAN_CONTROLS_CATEGORY_ID }),
        },
        android: {
          channelId: eventTargets.androidChannelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          // Self-clear when the next prayer arrives (see timeoutAfterMs above).
          timeoutAfter: timeoutAfterMs,
          // BigText style: shows the body in full when the notification
          // is expanded, and gives Android more room in the collapsed
          // grouped-summary view than a single-line ticker. The text is
          // intentionally short; the style mostly fixes the case where a
          // longer prayer-name title squeezed the body to a single ellipsised
          // word (reported in v2.0.13 with Arabic locale).
          style: { type: AndroidStyle.BIGTEXT, text: atPrayerBody },
          // Built in prayerAlertActions so the alert and the copy a snooze
          // re-fires can never drift apart again. Non-prayer events
          // (Sunrise, the night times) carry none: there is nothing to log
          // and nothing to be late for.
          actions: isNonPrayer ? [] : prayerAlertActions(e.name),
        },
      },
      buildTimestampTrigger(e.at.getTime(), exactAlarms),
    );
  }

  for (const e of reminderEvents) {
    const notificationId = `${PRAYER_NOTIFICATION_ID_PREFIX}pre-${e.at.getTime()}-${
      e.name
    }`;
    // Sunrise and the three night marks get the warning too — a reader who
    // turned on the Last Third to be up for it wants the same fifteen
    // minutes' notice the five salāh get, and an alert at the moment itself
    // is no use to someone who needs to be awake before it. What they don't
    // get is being called a prayer: the alert AT the time shows their clock
    // time instead of "Prayer time", and the one ahead of it says the same
    // thing — "02:30 · starts in 15 min" — so the reader knows what is
    // coming without doing the arithmetic.
    const preBody = isNonPrayerEvent(e.name)
      ? `${clock.fromDate(
          new Date(e.at.getTime() + reminderMinutes * 60_000),
        )} · ${i18n.t('alertCopy.prePrayer', { count: reminderMinutes })}`
      : i18n.t('alertCopy.prePrayer', { count: reminderMinutes });
    await notifee.createTriggerNotification(
      {
        id: notificationId,
        title: i18n.t(`prayer.${e.name}`, { defaultValue: e.name }),
        body: preBody,
        ios: {
          sound: reminderSound.iosSound,
        },
        android: {
          style: { type: AndroidStyle.BIGTEXT, text: preBody },
          channelId: reminderSound.androidChannelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          // The "starts in N min" reminder auto-dismisses when the prayer
          // actually begins, so it never lingers past its own prayer.
          timeoutAfter: Math.max(60_000, reminderMinutes * 60_000),
        },
      },
      buildTimestampTrigger(e.at.getTime(), exactAlarms),
    );
  }

  // ── The Mālikī second times ─────────────────────────────────────────
  //
  // Never the adhan, never a log action, never a snooze: a boundary is
  // not a prayer, and the call to prayer belongs to the five. Same
  // reasoning as Sunrise and the night marks, and the same sound.
  for (const e of daruriEvents) {
    const notificationId = `${PRAYER_NOTIFICATION_ID_PREFIX}daruri-${e.at.getTime()}-${
      e.name
    }`;
    const prayerName = i18n.t(`prayer.${DARURI_OF[e.name]}`, {
      defaultValue: DARURI_OF[e.name],
    });
    const closesAt = clock.fromDate(
      new Date(e.at.getTime() + daruriMinutes * 60_000),
    );
    const body =
      daruriMinutes > 0
        ? i18n.t('alertCopy.daruriEndsIn', {
            defaultValue: 'First time ends at {{time}} — in {{count}} min',
            time: closesAt,
            count: daruriMinutes,
          })
        : i18n.t('alertCopy.daruriEnded', {
            defaultValue: 'First time has ended at {{until}}',
            until: closesAt,
          });
    await notifee.createTriggerNotification(
      {
        id: notificationId,
        title: prayerName,
        body,
        ios: { sound: reminderSound.iosSound },
        android: {
          style: { type: AndroidStyle.BIGTEXT, text: body },
          channelId: reminderSound.androidChannelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          // Gone by the time the window it is warning about has closed —
          // a banner still saying "ends in 15 min" an hour later is worse
          // than no banner. At zero lead it is a statement about a state
          // that lasts, so it gets the same floor as everything else.
          timeoutAfter: Math.max(60_000, daruriMinutes * 60_000),
        },
      },
      buildTimestampTrigger(e.at.getTime(), exactAlarms),
    );
  }

  // ── And the far end of those windows ────────────────────────────────
  //
  // "This prayer is now qaḍāʾ." Fired at the instant and never early —
  // see buildDaruriEndEvents for why the lead does not reach here — and
  // one notification per instant, because Ẓuhr and ʿAṣr run out together
  // at Maghrib and so do Maghrib and Ishāʾ at the next Fajr.
  for (const e of daruriEndEvents) {
    const names = e.keys
      .map(k => i18n.t(`prayer.${DARURI_OF[k]}`, { defaultValue: DARURI_OF[k] }))
      .join(i18n.t('common.listJoin', { defaultValue: ' & ' }));
    const body = i18n.t('alertCopy.daruriExpired', {
      defaultValue: 'The time has ended — pray it as qaḍāʾ',
    });
    await notifee.createTriggerNotification(
      {
        id: daruriEndId(e.at.getTime(), e.keys),
        title: names,
        body,
        ios: { sound: reminderSound.iosSound },
        android: {
          style: { type: AndroidStyle.BIGTEXT, text: body },
          channelId: reminderSound.androidChannelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          // A statement about a state that does not change back, so it
          // keeps the ordinary floor rather than a lead-shaped timeout.
          timeoutAfter: MAX_LINGER_MS,
        },
      },
      buildTimestampTrigger(e.at.getTime(), exactAlarms),
    );
  }

  return {
    status: 'scheduled',
    scheduledCount:
      audibleEvents.length +
      reminderEvents.length +
      daruriEvents.length +
      daruriEndEvents.length,
    exactAlarms,
    reminderMinutes,
  };
}
