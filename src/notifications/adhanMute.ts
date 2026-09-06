/**
 * The upcoming event's alert mode, overridden for one occurrence.
 *
 * ── WHAT THIS USED TO BE ────────────────────────────────────────────
 *
 * A "Mute next adhan" button: two states, and the only thing it could
 * say was "not the adhan". That was written before the five prayers had
 * modes of their own. They do now — a speaker, a bell, a struck bell on
 * each home row (`settings/alertModes.ts`) — and a button on the Live
 * Activity that knew nothing about them was answering a question the
 * user had already answered somewhere else. Someone whose Fajr was set
 * to the plain alert was still offered "Mute next adhan" for an adhan
 * that was never going to play.
 *
 * So the button became the same control as the home row: one tap cycles
 * adhan → alert → silent, and it starts from whatever that prayer is
 * actually set to.
 *
 * ── WHAT IT IS, AND WHAT IT IS NOT ──────────────────────────────────
 *
 * The home row is the standing answer for every Fajr. This is the
 * answer for THIS Fajr — one occurrence, addressed by its epoch, gone
 * the moment that time passes. Nothing here ever writes
 * `prayerAlertModes`: someone who silences one late Isha from the lock
 * screen has not said anything about the next one, and a temporary
 * control that quietly turns permanent is the worst of both.
 *
 * ── THE MECHANICS ───────────────────────────────────────────────────
 *
 * The Live Activity action button fires a native broadcast
 * (MihrabLiveActivityActionReceiver), which flips the label from state
 * it owns and starts a HeadlessJS task (AdhanMuteHeadlessService →
 * 'AdhanMuteToggle', registered in index.js). This module is that task.
 * The native names still say "mute" because they cross the manifest and
 * a persisted PendingIntent; renaming them buys nothing a comment
 * cannot.
 *
 * On Android the adhan is a notification-channel sound baked into a
 * pre-scheduled notifee trigger, so changing the mode means re-creating
 * that one trigger on the right channel — or, for silent, cancelling it
 * outright. Silent is an absence, not a muted alarm: that is what the
 * home row means by it, and it is the only version that also keeps the
 * prayer off the lock screen.
 *
 * The 15-minute heads-up is deliberately NOT touched here. It is a
 * separate alert on the plain tone, and rebuilding it would mean
 * rebuilding its copy from a card that may have advanced to a different
 * event since this payload was written — which is exactly how the old
 * button once handed Sunrise the call to prayer. The next full resync
 * applies the override to it, because that is where the audible list is
 * built.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import notifee, { AndroidImportance, AndroidStyle } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNonPrayerEvent } from '../types/prayer';
import i18n from '../i18n';
import { loadSettings } from '../settings/storage';
import { setActiveClockFormat, activeClock } from '../utils/activeClock';
import {
  buildTimestampTrigger,
  canUseExactAlarms,
  clampPrePrayerReminderMinutes,
  preReminderId,
  ymdLocal,
} from './scheduling';
import { modesFor, type PrayerAlertMode } from '../settings/alertModes';

/**
 * AsyncStorage key holding the override.
 *
 * The name is the old one on purpose: an install upgrading into this
 * may have a "<epochMs>-<PrayerName>" marker from the mute button
 * sitting in it, and that marker means something this module can still
 * honour (see `parseNextAlertOverride`). A new key would have silently
 * un-muted a prayer somebody had just muted.
 */
export const MUTED_NEXT_ADHAN_KEY = 'mihrab.muted_next_adhan';

/** Must match PRAYER_NOTIFICATION_ID_PREFIX in prayerNotifications.ts. */
const PRAYER_NOTIFICATION_ID_PREFIX = 'pt-';
const DEFAULT_CHANNEL = 'prayer-times-default';

/** One occurrence, and the mode it was given. */
export type NextAlertOverride = {
  /**
   * The event's instant, in epoch ms.
   *
   * NOT the identity — see `date`. This is here because the alert has to
   * be scheduled at some particular millisecond, and this is the one the
   * card was counting down to when the button was pressed.
   */
  epoch: number;
  /** Canonical English key: Fajr, Sunrise, Lastthird, … */
  name: string;
  /**
   * WHICH OCCURRENCE THIS IS: the local day the event falls on.
   *
   * The identity was the instant alone, and an instant is the one thing
   * about a prayer that is not fixed. A prayer's time is recomputed
   * whenever the inputs move — the user nudges a per-prayer offset,
   * switches calculation method or provider, or simply travels far enough
   * for automatic location to resolve somewhere new — and the new answer
   * is a minute or two away from the old one. The override, pinned to the
   * old millisecond, then matched nothing.
   *
   * Which would be tolerable if it failed quietly, and it does not: no
   * match means the prayer falls back to its STANDING setting, and that
   * is usually the adhan. The failure was "I silenced Fajr from the lock
   * screen and the adhan played anyway" — the precise complaint this
   * control exists to answer.
   *
   * "Fajr, on the eighth" is what the user meant, and it survives the
   * time being recalculated. Local day of the event's own instant, so
   * both sides derive it from the thing they already agree about.
   */
  date: string;
  mode: PrayerAlertMode;
};

/** The mode a row may never reach through an override, per row. */
function allowedMode(name: string, mode: PrayerAlertMode): PrayerAlertMode {
  // Sunrise and the night marks are times, not prayers. The cycle native
  // offers them is already two long, but this is the last place that can
  // still be sure: the value crossed a process boundary to get here.
  return (modesFor(name) as readonly string[]).includes(mode)
    ? mode
    : 'notification';
}

/**
 * Read whatever is on disk, in either shape.
 *
 * `{"epoch":…,"name":…,"mode":…}` is what this module writes.
 * `"<epoch>-<name>"` is the old mute marker, and it meant "this one does
 * not play the adhan" — which is the plain alert, not silence: the old
 * mute rescheduled onto the default channel rather than cancelling.
 */
export function parseNextAlertOverride(
  raw: string | null | undefined,
): NextAlertOverride | null {
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw) as Partial<NextAlertOverride>;
      const epoch = Number(o.epoch);
      const name = String(o.name ?? '');
      const mode = String(o.mode ?? '') as PrayerAlertMode;
      if (!Number.isFinite(epoch) || epoch <= 0 || !name) return null;
      if (!['adhan', 'notification', 'silent'].includes(mode)) return null;
      // Records written before the identity moved off the instant carry no
      // date. Deriving it from the epoch is exact for them — the epoch WAS
      // the instant — so an override set just before an update keeps
      // working rather than lapsing into the adhan on the way through.
      const date = o.date ? String(o.date) : ymdLocal(new Date(epoch));
      return { epoch, name, date, mode: allowedMode(name, mode) };
    } catch {
      return null;
    }
  }
  const m = /^(\d+)-(.+)$/.exec(raw);
  if (!m) return null;
  const epoch = Number(m[1]);
  return {
    epoch,
    name: m[2],
    date: ymdLocal(new Date(epoch)),
    mode: 'notification',
  };
}

/** The override currently stored, or null. */
export async function getNextAlertOverride(): Promise<NextAlertOverride | null> {
  try {
    return parseNextAlertOverride(
      await AsyncStorage.getItem(MUTED_NEXT_ADHAN_KEY),
    );
  } catch {
    return null;
  }
}

/**
 * Does this override speak for this event?
 *
 * Both halves have to match. The day alone would carry an override onto
 * every prayer of that day; the name alone would make it permanent,
 * which is the one thing it must not be. Together they name one
 * occurrence — and go on naming it after the clock time underneath has
 * been recalculated, which the instant could not.
 */
export function overrideAppliesTo(
  o: NextAlertOverride | null,
  epochMs: number,
  name: string,
): boolean {
  return !!o && o.name === name && o.date === ymdLocal(new Date(epochMs));
}

/**
 * ── THE APP HAS TO BE ABLE TO SEE THIS ──────────────────────────────
 *
 * An override is written by a broadcast receiver and a headless task —
 * neither of which the app is part of — and until it could be read back,
 * the home screen went on showing the standing setting while the card
 * showed something else. The app held two answers about the same prayer
 * and offered no way to reconcile them, which is the exact complaint the
 * whole three-mode button was built to answer.
 *
 * So it is a store. The row for the affected occurrence renders what will
 * actually happen at that time, says that it is only this once, and
 * carries the way back.
 *
 * Two things move it: the task itself, which runs in this process when
 * the app is alive (`allowedInForeground`), and coming back to the
 * foreground, which covers every tap made while the app was not.
 */
let current: NextAlertOverride | null = null;
let currentRaw: string | null = null;
const listeners = new Set<() => void>();

function publish(raw: string | null): void {
  // Compared as the raw string so the snapshot keeps its identity when
  // nothing moved — `useSyncExternalStore` re-renders on reference change,
  // and a fresh object per read would re-render every row on every check.
  if (raw === currentRaw) return;
  currentRaw = raw;
  current = parseNextAlertOverride(raw);
  for (const l of listeners) l();
}

/** Re-read the stored override and tell anyone watching. */
export async function refreshNextAlertOverride(): Promise<void> {
  try {
    publish(await AsyncStorage.getItem(MUTED_NEXT_ADHAN_KEY));
  } catch {
    // Leave the last known answer standing rather than claiming there is
    // none: "no override" is a visible state, and flickering out of it on
    // a transient read error would take the way back with it.
  }
}

/**
 * Forget the override — the row's reset.
 *
 * Only half the job: the native side keeps its own copy, which is what
 * the card's button reads, so the caller clears that too. See
 * `clearNativeAlertOverride` in native/MihrabLiveActivity.
 */
export async function clearNextAlertOverride(): Promise<void> {
  try {
    await AsyncStorage.setItem(MUTED_NEXT_ADHAN_KEY, '');
  } finally {
    publish('');
  }
}

/** The override as the UI sees it, or null. Re-read on foreground. */
export function useNextAlertOverride(): NextAlertOverride | null {
  const value = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
  useEffect(() => {
    refreshNextAlertOverride();
    const sub = AppState.addEventListener('change', s => {
      // The tap that set it usually happened on the lock screen, with the
      // app not running. This is when we find out.
      if (s === 'active') refreshNextAlertOverride();
    });
    return () => sub.remove();
  }, []);
  return value;
}

/** What the native side sends across the HeadlessJS boundary. */
export type AdhanMuteTaskData = {
  epoch: number | string;
  name: string;
  /** 'adhan' | 'notification' | 'silent'. */
  mode?: string;
  /** The old boolean, still read so a queued intent from the previous
   *  build lands somewhere sensible rather than nowhere. */
  muted?: boolean | string;
  adhanChannelId?: string;
  defaultChannelId?: string;
  title?: string;
  body?: string;
  adhanSoundId?: string;
};

function modeFromTaskData(data: AdhanMuteTaskData, name: string): PrayerAlertMode {
  const raw = String(data.mode ?? '');
  if (raw === 'adhan' || raw === 'notification' || raw === 'silent') {
    return allowedMode(name, raw);
  }
  // Pre-cycle intent: muted meant the plain alert, not silence.
  const muted = data.muted === true || data.muted === 'true';
  return muted ? 'notification' : allowedMode(name, 'adhan');
}

const plainChannelOf = (data: AdhanMuteTaskData) =>
  data.defaultChannelId || DEFAULT_CHANNEL;

/**
 * Cancel or re-create the heads-up that belongs to this occurrence.
 *
 * Its instant is arithmetic on the event's — the scheduler subtracts the
 * same offset — so this can address the very alert the scheduler wrote,
 * by id, without being told which one it is.
 *
 * The copy is built here rather than carried in the payload. A prayer's
 * reminder reads the same whichever prayer it is; a night mark's carries
 * its own clock time, and this is the only place that reliably knows
 * WHICH event is being changed — the payload's copy was written for
 * whatever was next when the app last synced, and the card walks on
 * without it.
 */
async function syncPreReminder(
  epoch: number,
  name: string,
  mode: PrayerAlertMode,
  channelId: string,
  exactAlarms: boolean,
): Promise<void> {
  try {
    const settings = await loadSettings();
    // The non-React edge, same as the widget's headless republish: the
    // provider that normally mirrors this preference never mounts here.
    setActiveClockFormat(settings.clockFormat);
    const minutes = clampPrePrayerReminderMinutes(
      settings.prePrayerReminderMinutes,
    );
    // Nothing to keep in step when the reminder is switched off, which is
    // the default.
    if (minutes <= 0) return;
    const id = preReminderId(epoch, name, minutes);
    const at = epoch - minutes * 60_000;

    if (mode === 'silent') {
      await notifee.cancelTriggerNotification(id).catch(() => undefined);
      return;
    }
    // Coming off silent. Past its own moment there is nothing to put
    // back — and scheduling into the past would fire it immediately.
    if (at <= Date.now()) return;

    const body = isNonPrayerEvent(name)
      ? `${activeClock().fromDate(new Date(epoch))} · ${i18n.t(
          'alertCopy.prePrayer',
          { count: minutes },
        )}`
      : i18n.t('alertCopy.prePrayer', { count: minutes });

    await notifee.createTriggerNotification(
      {
        id,
        title: i18n.t(`prayer.${name}`, { defaultValue: name }),
        body,
        android: {
          channelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          style: { type: AndroidStyle.BIGTEXT, text: body },
          timeoutAfter: Math.max(60_000, minutes * 60_000),
        },
      },
      buildTimestampTrigger(at, exactAlarms),
    );
  } catch (e) {
    // Never the reason the mode itself fails to apply.
    console.warn('[adhanMute] pre-reminder sync failed', e);
  }
}

/**
 * HeadlessJS task body. Puts the upcoming event's alert on the channel
 * its new mode asks for — or takes the alarm away entirely — and
 * persists the choice so a later full resync does not undo it.
 */
export async function adhanMuteToggleTask(
  data: AdhanMuteTaskData,
): Promise<void> {
  try {
    const epoch = Number(data.epoch);
    const name = String(data.name ?? '');
    if (!Number.isFinite(epoch) || epoch <= 0 || !name) return;
    const mode = modeFromTaskData(data, name);

    const raw = JSON.stringify({
      epoch,
      name,
      date: ymdLocal(new Date(epoch)),
      mode,
    } satisfies NextAlertOverride);
    await AsyncStorage.setItem(MUTED_NEXT_ADHAN_KEY, raw);
    // Same process as the app when it is alive, so the row that shows this
    // updates while the shade is still open over it.
    publish(raw);

    // Past events can't be changed; the marker alone is enough for any resync.
    if (epoch <= Date.now()) return;

    const id = `${PRAYER_NOTIFICATION_ID_PREFIX}${epoch}-${name}`;
    // Asked for here rather than assumed: Android can revoke
    // SCHEDULE_EXACT_ALARM at runtime, and this task can run days after
    // the app last checked.
    const exactAlarms = await canUseExactAlarms();

    // ── THE HEADS-UP GOES WITH IT ───────────────────────────────────
    //
    // The 15-minute reminder is a separate alert with its own id, and it
    // used to be left alone here — the resync would catch up eventually.
    // Eventually is the problem: the case this whole control exists for is
    // silencing an early Fajr the night before, and the phone then stays
    // locked until morning. The prayer was silent and the reminder went
    // off fifteen minutes before it anyway, which is the opposite of what
    // the user asked for and louder than doing nothing.
    await syncPreReminder(epoch, name, mode, plainChannelOf(data), exactAlarms);

    if (mode === 'silent') {
      // Not a muted alarm — no alarm. Same as the home row, and the only
      // reading of "silent" that also keeps the prayer off the lock screen.
      await notifee.cancelTriggerNotification(id).catch(() => undefined);
      return;
    }

    // THE CHANNEL HAS TO EXIST, and this task is the one place that cannot
    // assume it does.
    //
    // Everywhere else that schedules a prayer has just run `ensureChannel`
    // in the same pass. This runs from a broadcast, with the app closed,
    // against an id that was resolved when the card was last built — and
    // "Play adhan as an alarm" is a SEPARATE channel (`-alarm`), created
    // only on the sync that follows turning the setting on. Post to a
    // channel that is not there and Android drops the notification with no
    // error and no sound: the prayer the user just asked to hear the adhan
    // for would simply not arrive. A plain alert on a channel that exists is
    // the better failure, and it is recoverable — the next full resync puts
    // the right channel back.
    const usable = async (id: string, fallback: string) => {
      try {
        return (await notifee.getChannel(id)) ? id : fallback;
      } catch {
        return fallback;
      }
    };

    // WHAT THIS TASK IS HANDED IS NOT NECESSARILY A PRAYER.
    //
    // The card advances itself natively when a time passes, and it walks
    // Sunrise and the night marks like anything else — so the button
    // visible after Fajr points at Sunrise, from a payload written before
    // the hop. `allowedMode` above already refused 'adhan' for those; this
    // is the second half of the same guard, on the channel itself.
    const isPrayer = !isNonPrayerEvent(name);
    const wantsAdhan = mode === 'adhan' && isPrayer;
    const plain = plainChannelOf(data);
    const channelId = wantsAdhan
      ? await usable(data.adhanChannelId || plain, plain)
      : await usable(plain, DEFAULT_CHANNEL);

    await notifee.createTriggerNotification(
      {
        id,
        title: data.title || name,
        body: data.body || '',
        data: {
          kind: 'prayer_time',
          usesAdhan: wantsAdhan ? '1' : '0',
          adhanSound: wantsAdhan ? data.adhanSoundId || 'default' : 'default',
        },
        android: {
          channelId,
          smallIcon: 'ic_stat_prayer',
          pressAction: { id: 'default' },
          importance: AndroidImportance.HIGH,
        },
      },
      buildTimestampTrigger(epoch, exactAlarms),
    );
  } catch (e) {
    console.warn('[adhanMute] override task failed', e);
  }
}
