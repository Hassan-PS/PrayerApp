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
import notifee, { AndroidImportance, TriggerType } from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNonPrayerEvent } from '../types/prayer';
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
  /** The event's instant, in epoch ms — what makes this ONE occurrence. */
  epoch: number;
  /** Canonical English key: Fajr, Sunrise, Lastthird, … */
  name: string;
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
      return { epoch, name, mode: allowedMode(name, mode) };
    } catch {
      return null;
    }
  }
  const m = /^(\d+)-(.+)$/.exec(raw);
  if (!m) return null;
  return { epoch: Number(m[1]), name: m[2], mode: 'notification' };
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
 * Both halves have to match. The epoch alone would carry an override
 * across a schedule change that moved a different prayer onto the same
 * minute; the name alone would make it permanent, which is the one
 * thing it must not be.
 */
export function overrideAppliesTo(
  o: NextAlertOverride | null,
  epochMs: number,
  name: string,
): boolean {
  return !!o && o.epoch === epochMs && o.name === name;
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

    await AsyncStorage.setItem(
      MUTED_NEXT_ADHAN_KEY,
      JSON.stringify({ epoch, name, mode } satisfies NextAlertOverride),
    );

    // Past events can't be changed; the marker alone is enough for any resync.
    if (epoch <= Date.now()) return;

    const id = `${PRAYER_NOTIFICATION_ID_PREFIX}${epoch}-${name}`;

    if (mode === 'silent') {
      // Not a muted alarm — no alarm. Same as the home row, and the only
      // reading of "silent" that also keeps the prayer off the lock screen.
      await notifee.cancelTriggerNotification(id).catch(() => undefined);
      return;
    }

    // WHAT THIS TASK IS HANDED IS NOT NECESSARILY A PRAYER.
    //
    // The card advances itself natively when a time passes, and it walks
    // Sunrise and the night marks like anything else — so the button
    // visible after Fajr points at Sunrise, from a payload written before
    // the hop. `allowedMode` above already refused 'adhan' for those; this
    // is the second half of the same guard, on the channel itself.
    const isPrayer = !isNonPrayerEvent(name);
    const wantsAdhan = mode === 'adhan' && isPrayer;
    const channelId = wantsAdhan
      ? data.adhanChannelId || DEFAULT_CHANNEL
      : data.defaultChannelId || DEFAULT_CHANNEL;

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
      {
        type: TriggerType.TIMESTAMP,
        timestamp: epoch,
        alarmManager: { allowWhileIdle: true },
      },
    );
  } catch (e) {
    console.warn('[adhanMute] override task failed', e);
  }
}
