/**
 * Live Activity — pinned prayer-countdown notification (Android).
 * (iOS uses ActivityKit via the PrayerLiveActivity native module —
 * see `src/native/PrayerLiveActivity.ts` and `src/liveActivity/`.)
 *
 * Design notes (v2.1.0-beta.2):
 *  - **InboxStyle** for the expanded view. Each prayer renders as its own
 *    visible row. The previous BigText approach was rendering as a wall
 *    of wrapped paragraph text on MIUI/OxygenOS/ColorOS — those shells
 *    auto-flow the bigText paragraph and visibly collapse embedded
 *    newlines. InboxStyle's `lines: string[]` is the platform-native way
 *    to render a list and behaves identically across vendors.
 *  - **Chronometer** stays. notifee maps it to the system metadata row
 *    next to the app name, so the live countdown ticks without us
 *    re-posting; the small icon stays in the status bar.
 *  - **Accent color** drives the small-icon tint and the chronometer
 *    text colour on Android 12+ Material You shells.
 *  - **Friendly countdown text** ("in 3h 47m") in the body line so even
 *    shells that don't render the chronometer prominently still
 *    communicate the duration at a glance.
 *  - **Short location** — the geocoded label can be a full address
 *    ("Stockholm, Stockholm Municipality, Stockholm County, 111 29,
 *    Sweden"). We render the first comma-separated component, which is
 *    virtually always the locality.
 *
 * Lifecycle:
 *  - `startOrUpdateLiveActivity()` is idempotent — call it whenever the
 *    prayer-day payload, settings, or locale change. notifee replaces
 *    in place when the id matches.
 *  - `stopLiveActivity()` cancels the pinned notification.
 *  - The OS clears ongoing notifications on reboot; index.js re-arms
 *    via `syncLiveActivity()` on next foreground.
 */

import { Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
} from '@notifee/react-native';
import { activeClock } from '../utils/activeClock';
import i18n from '../i18n';
import type { WidgetPrayerPayload } from '../widget/buildWidgetPayload';
import {
  getMihrabLiveActivityModule,
  type MihrabLiveActivityPayload,
} from '../native/MihrabLiveActivity';
import { loadSettings } from '../settings/storage';
import {
  getNotificationSoundOption,
  resolveSoundTargets,
} from './notificationSounds';
import { OPTIONAL_TIME_KEYS } from '../types/prayer';
import { formatHijriLabel } from '../hijri/formatHijriLabel';

/** Hijri label for a "yyyy-MM-dd" day key (parsed in local time). */
function hijriLabelForDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return '';
  return formatHijriLabel(new Date(y, m - 1, d));
}

/** Stable notifee id — fixed so updates replace in place, not stack. */
export const LIVE_ACTIVITY_NOTIFICATION_ID =
  'mihrab.live_activity.prayer_countdown';

/** Dedicated channel for the Live Activity.
 *   v1 — IMPORTANCE_LOW → Silent section.
 *   v2 — IMPORTANCE_DEFAULT → main section but no chip on Android 16.
 *   v3 — IMPORTANCE_HIGH (sound + vibration explicitly off) — required
 *        for the Android 16 status-bar "Live Update" chip on most
 *        shells. NotificationChannel importance is immutable after
 *        first create, so the bump needed a new id. */
const CHANNEL_ID = 'mihrab_live_activity_v3';
const CHANNEL_ID_LEGACY_V1 = 'mihrab_live_activity_v1';
const CHANNEL_ID_LEGACY_V2 = 'mihrab_live_activity_v2';

export type LiveActivityRenderInput = {
  payload: WidgetPrayerPayload;
  /** ms-since-epoch of the upcoming prayer. */
  nextPrayerTimestamp: number | null;
  /** Already-localised label for the next prayer. */
  nextPrayerLabel: string;
  /** Hijri caption, e.g. "12 Dhul-Qa'dah 1447" — empty = omit. */
  hijriLabel: string;
  /** Active location caption — we shorten internally. */
  locationLabel: string;
  /** App accent color hex, e.g. "#6BC98A". */
  accentHex: string;
  /** When true (Android system colours on), the native module re-resolves the
   *  live Material You system accent on each repost instead of using
   *  `accentHex`, so the notification matches the app and auto-updates when the
   *  wallpaper colour changes. */
  systemAccent?: boolean;
  /** Enhanced Live Activity visual style (Android 16 ProgressStyle). */
  design?: 'timeline' | 'countdown' | 'markers';
  /** Display knobs from settings. */
  compactMode: boolean;
  showSunrise: boolean;
  showHijri: boolean;
  showLocation: boolean;
  /**
   * The raw today TimingsMap (HH:MM strings for the actual calendar day).
   * Used to compute prevEpochMs correctly after the payload rolls over to
   * tomorrow — payload.rows is tomorrow's data at that point, so looking
   * there would mis-identify tomorrow's Maghrib as the previous prayer
   * instead of today's Isha.
   */
  todayTimings?: Record<string, string> | null;
};

/** ── Channel ─────────────────────────────────────────────────────── */

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Clean up legacy channels so upgraders don't see stale entries in
  // their app notification settings.
  for (const old of [CHANNEL_ID_LEGACY_V1, CHANNEL_ID_LEGACY_V2]) {
    try {
      await notifee.deleteChannel(old);
    } catch {
      // Non-fatal.
    }
  }
  try {
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: i18n.t('liveActivity.channelName', 'Prayer countdown'),
      description: i18n.t(
        'liveActivity.channelDesc',
        'Pinned ongoing notification with the next-prayer countdown.',
      ),
      // HIGH importance because Android 16's status-bar Live Update
      // chip eligibility requires the channel be HIGH+. We disable
      // sound + vibration explicitly so the notification stays
      // passive — no chime on first post, no buzz, no popup.
      importance: AndroidImportance.HIGH,
      sound: undefined,
      vibration: false,
      badge: false,
    });
  } catch {
    // Non-fatal.
  }
}

/** ── Helpers ─────────────────────────────────────────────────────── */

/** First comma-separated component, e.g. "Stockholm" from a full
 *  geocoded address. */
function shortLocation(label: string): string {
  if (!label) return '';
  const first = label.split(',')[0]?.trim();
  return first || label;
}

/**
 * CANONICAL 24-hour `HH:mm`. `MihrabLiveActivityModule` parses this
 * string into a `LocalTime` for the Android 17 "At <time>" metric, and
 * the foreground service matches it against `^(\d{1,2}):(\d{2})$` when
 * it advances the card on its own. What the card DRAWS is
 * `nextTimeDisplay` — see issue #18.
 */
function formatHHMM(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Compact human duration: "3h 47m" / "47m" / "30s". */
function formatRemaining(ms: number): string {
  if (ms <= 0) return i18n.t('liveActivity.now', 'Now');
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.floor(ms / 1000)}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * Look up the long localised prayer name (e.g. "Maghrib" not "Magh"),
 * falling back to the supplied abbreviation, then to the canonical row
 * key. Row keys are stable (Fajr/Sunrise/Dhuhr/Asr/Maghrib/Isha) so the
 * fallback is always meaningful.
 */
function localizedPrayerName(key: string, abbrFallback?: string): string {
  // Keys in the locale files are capitalised exactly as the row key
  // (e.g. prayer.Fajr, prayer.Maghrib). Try exact case first, then
  // lowercase as a fallback so older locale structures still work.
  const kExact = `prayer.${key}`;
  if (i18n.exists(kExact)) return i18n.t(kExact);
  const kLower = `prayer.${key.toLowerCase()}`;
  if (i18n.exists(kLower)) return i18n.t(kLower);
  return abbrFallback || key;
}

/**
 * Build the InboxStyle line list. One entry per prayer in chronological
 * order, with the next prayer carrying a leading "›" marker so the eye
 * lands on it.
 */
function buildInboxLines(input: LiveActivityRenderInput): string[] {
  const { payload } = input;
  const ordered = [...payload.rows];
  if (input.showSunrise && payload.sunriseRow) {
    if (ordered.length > 0) ordered.splice(1, 0, payload.sunriseRow);
    else ordered.push(payload.sunriseRow);
  }
  // Enabled pre-dawn night times (Islamic Midnight / Last Third) appended after
  // Isha so they read as "later tonight" in the expanded list.
  if (payload.extraRows && payload.extraRows.length > 0) {
    ordered.push(...payload.extraRows);
  }
  return ordered.map(r => {
    const isNext = r.key === payload.nextKey;
    const marker = isNext ? '›' : ' ';
    const name = localizedPrayerName(r.key);
    // Use NBSP between marker/name/time so the shell doesn't collapse
    // the leading marker indent — InboxStyle treats each line as a
    // single CharSequence and trims leading whitespace.
    return `${marker}  ${name}  ${r.time}`;
  });
}

/** ── Public API ──────────────────────────────────────────────────── */

/** ms-since-epoch of the prayer that most recently passed before
 *  `now`. Returns 0 when we can't infer one (very first use, before Fajr).
 *
 *  Prefers `todayTimings` (the raw TimingsMap for the actual calendar day)
 *  over `payload.rows`, because `payload.rows` rolls over to tomorrow's data
 *  after Isha — at that point iterating the rows would mis-identify
 *  tomorrow's Maghrib (applied to today's date) as the previous prayer
 *  instead of today's Isha, producing an inflated progress % at rollover. */
function computePrevPrayerEpoch(
  payload: WidgetPrayerPayload,
  now: number,
  todayTimings?: Record<string, string> | null,
): number {
  // Build the list of HH:MM strings to scan.  Prefer the raw today-timings
  // (stable salah keys + Sunrise) over the widget rows which may be tomorrow.
  const SALAH_KEYS = [
    'Midnight',
    'Lastthird',
    'Fajr',
    'Sunrise',
    'Dhuhr',
    'Asr',
    'Maghrib',
    'Isha',
    'Firstthird',
  ];
  const times: string[] = todayTimings
    ? SALAH_KEYS.map(k => todayTimings[k]).filter(
        (v): v is string => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v),
      )
    : (() => {
        const ordered = [...payload.rows];
        if (payload.sunriseRow) {
          if (ordered.length > 0) ordered.splice(1, 0, payload.sunriseRow);
          else ordered.push(payload.sunriseRow);
        }
        return ordered.map(r => r.time).filter(t => /^\d{1,2}:\d{2}$/.test(t));
      })();

  let prevEpoch: number | null = null;
  for (const hhmm of times) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) continue;
    const candidate = new Date(now);
    candidate.setHours(Number(m[1]), Number(m[2]), 0, 0);
    let t = candidate.getTime();
    if (t > now) {
      t -= 24 * 60 * 60 * 1000;
    }
    if (t <= now && (prevEpoch == null || t > prevEpoch)) prevEpoch = t;
  }
  return prevEpoch ?? 0;
}

/**
 * Compute fraction (0..1) of time elapsed since the PREVIOUS prayer
 * vs. the wait until the NEXT prayer.
 */
function computeProgressFraction(
  payload: WidgetPrayerPayload,
  nextEpochMs: number | null,
  now: number,
  todayTimings?: Record<string, string> | null,
): number {
  if (nextEpochMs == null) return 0;
  const prev = computePrevPrayerEpoch(payload, now, todayTimings);
  if (prev <= 0) return 0;
  const span = nextEpochMs - prev;
  if (span <= 0) return 0;
  const done = now - prev;
  return Math.max(0, Math.min(1, done / span));
}

export async function startOrUpdateLiveActivity(
  input: LiveActivityRenderInput,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  await ensureChannel();

  // ── Text ────────────────────────────────────────────────────────
  const nextTime = input.nextPrayerTimestamp
    ? formatHHMM(input.nextPrayerTimestamp)
    : '';
  const remaining = input.nextPrayerTimestamp
    ? formatRemaining(input.nextPrayerTimestamp - Date.now())
    : i18n.t('liveActivity.soon', 'Starting soon');

  // The same instant as `nextTime`, written the way the user reads a
  // clock. Everything the card shows uses this; only the parsers use
  // `nextTime`.
  const nextTimeDisplay = nextTime ? activeClock()(nextTime) : '';

  // Title — what's next + when. Same in collapsed and expanded.
  const title = nextTimeDisplay
    ? `${input.nextPrayerLabel} · ${nextTimeDisplay}`
    : input.nextPrayerLabel || i18n.t('liveActivity.soon', 'Starting soon');

  // Body — countdown + optional location, separated by middle dots.
  const inLabel = i18n.t('liveActivity.in', 'in {{remaining}}', { remaining });
  const locShort =
    input.showLocation && input.locationLabel
      ? shortLocation(input.locationLabel)
      : '';
  const body = locShort ? `${inLabel} · ${locShort}` : inLabel;

  // Expanded — InboxStyle list. Compact mode skips the list entirely.
  const inboxLines = input.compactMode ? [] : buildInboxLines(input);

  // Summary — Hijri date when enabled. Lives below the InboxStyle list.
  const summary =
    input.showHijri && input.hijriLabel ? input.hijriLabel : undefined;

  // ── Native module first ─────────────────────────────────────────
  // When the MihrabLiveActivity native module is linked (always true
  // in builds from this repo on Android), we route through it for the
  // rich custom-RemoteViews layout: big chronometer + accent-tinted
  // progress bar + per-row visual list, plus the Android 16 status-bar
  // "Live Update" chip via Notification.ProgressStyle. The notifee
  // fallback below only runs when the module isn't available (older
  // builds or test harnesses).
  const native = getMihrabLiveActivityModule();
  if (native && input.nextPrayerTimestamp != null) {
    const nowMs = Date.now();
    const progressFraction = computeProgressFraction(
      input.payload,
      input.nextPrayerTimestamp,
      nowMs,
      input.todayTimings,
    );
    // The native foreground service uses prevEpochMs / nextEpochMs to
    // recompute progress on every minute tick — that's what makes the
    // bar advance without the app being open.
    const prevEpochMs = computePrevPrayerEpoch(
      input.payload,
      nowMs,
      input.todayTimings,
    );
    // Project rows to the shape the native module expects (key/name/time).
    // We send the localised long names so the expanded list isn't reading
    // as widget abbrevs ("Magh") — the widget payload uses short forms,
    // we want long forms here.
    const rows = input.payload.rows.map(r => ({
      key: r.key,
      name: localizedPrayerName(r.key, r.abbr),
      time: r.time,
      display: r.display,
    }));
    const sunriseRow = input.payload.sunriseRow
      ? {
          key: input.payload.sunriseRow.key,
          name: localizedPrayerName(
            input.payload.sunriseRow.key,
            input.payload.sunriseRow.abbr,
          ),
          time: input.payload.sunriseRow.time,
          display: input.payload.sunriseRow.display,
        }
      : undefined;
    const extraRows = (input.payload.extraRows ?? []).map(r => ({
      key: r.key,
      name: localizedPrayerName(r.key, r.abbr),
      time: r.time,
      display: r.display,
    }));
    // Project the multi-day schedule to the native shape with localised long
    // names. This is what lets the foreground-service ticker advance to the
    // right day's prayers (and overnight Isha→Fajr interval) on its own.
    const days = (input.payload.days ?? []).map(d => ({
      dateKey: d.dateKey,
      // Per-day Hijri label so the native ticker can roll the Hijri date across
      // midnight/days in step with the prayer times — without reopening the app.
      hijriLabel: hijriLabelForDateKey(d.dateKey),
      rows: d.rows.map(r => ({
        key: r.key,
        name: localizedPrayerName(r.key, r.abbr),
        time: r.time,
        display: r.display,
      })),
      sunriseRow: d.sunriseRow
        ? {
            key: d.sunriseRow.key,
            name: localizedPrayerName(d.sunriseRow.key, d.sunriseRow.abbr),
            time: d.sunriseRow.time,
            display: d.sunriseRow.display,
          }
        : undefined,
      extraRows: (d.extraRows ?? []).map(r => ({
        key: r.key,
        name: localizedPrayerName(r.key, r.abbr),
        time: r.time,
        display: r.display,
      })),
    }));
    // Android 17 extras: the lock-screen button and the "Mute next adhan"
    // toggle. Read from settings here (once per JS sync — the per-second
    // redraw is native) rather than threading through every layer.
    let lockButton = true;
    let adhanActionEnabled = false;
    let adhanChannelId = 'prayer-times-default';
    let adhanSoundId = 'default';
    try {
      const s = await loadSettings();
      lockButton = s.liveActivityLockButton !== false;
      const soundOpt = getNotificationSoundOption(s.notificationSound);
      // Resolved rather than read off the table: the user's own recording has
      // no fixed channel, and if its file has gone this lands on the default
      // one instead of a channel that does not exist.
      adhanChannelId = resolveSoundTargets(soundOpt.id).androidChannelId;
      adhanSoundId = soundOpt.id;
      const nextKey = input.payload.nextKey ?? '';
      const nextIsRealPrayer = !(
        OPTIONAL_TIME_KEYS as readonly string[]
      ).includes(nextKey);
      adhanActionEnabled =
        s.notificationsEnabled && soundOpt.id !== 'default' && nextIsRealPrayer;
    } catch {
      // Non-fatal — the Live Activity still renders without the extras.
    }

    const nativePayload: MihrabLiveActivityPayload = {
      nextLabel: input.nextPrayerLabel,
      nextTime,
      nextTimeDisplay,
      nextKey: input.payload.nextKey ?? '',
      nextEpochMs: input.nextPrayerTimestamp,
      prevEpochMs,
      title,
      body,
      progressFraction,
      rows,
      sunriseRow,
      extraRows,
      days,
      hijriLabel: input.hijriLabel,
      locationLabel: input.locationLabel,
      accentHex: input.accentHex,
      systemAccent: input.systemAccent === true,
      design: input.design ?? 'timeline',
      compactMode: input.compactMode,
      showSunrise: input.showSunrise,
      showHijri: input.showHijri,
      showLocation: input.showLocation,
      fgsText: i18n.t('liveActivity.fgsText', 'Prayer countdown active'),
      // Always. It was a setting once — see settings/types.ts on why the
      // clock time beside the countdown stopped being a question.
      secondMetric: 'time',
      adhanActionEnabled,
      muteLabel: i18n.t('liveActivity.muteNext', 'Mute next adhan'),
      unmuteLabel: i18n.t('liveActivity.unmuteNext', 'Unmute next adhan'),
      // Second action: toggle the card's lock-screen / always-on-display
      // visibility (native-only state; independent of the master on/off setting).
      // The lock-screen toggle is one of two actions the card has room
      // for, and someone who never hides it is carrying a button they
      // will never press. Off by choice, on by default.
      aodActionEnabled: lockButton,
      aodHideLabel: i18n.t('liveActivity.hideOnLock', 'Hide on lock screen'),
      aodShowLabel: i18n.t('liveActivity.showOnLock', 'Show on lock screen'),
      nowWord: i18n.t('liveActivity.now', 'Now'),
      inWord: i18n.t('liveActivity.inWord', 'In'),
      atWord: i18n.t('liveActivity.atWord', 'At'),
      atPrayerBody: i18n.t('alertCopy.atPrayer', 'Prayer time'),
      adhanChannelId,
      adhanSoundId,
      defaultChannelId: 'prayer-times-default',
    };
    try {
      await native.display(JSON.stringify(nativePayload));
      return;
    } catch (e) {
      // Native failed (e.g. POST_NOTIFICATIONS denied) — fall through
      // to the notifee path so the user still sees something.
      console.warn('[liveActivity] native module display failed', e);
    }
  }

  try {
    await notifee.displayNotification({
      id: LIVE_ACTIVITY_NOTIFICATION_ID,
      title,
      body,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_stat_prayer',
        // App accent tints the small icon on Android 8+ and the
        // chronometer text colour on Android 12+ Material You shells.
        color: input.accentHex || undefined,
        ongoing: true,
        autoCancel: false,
        // No Wear OS mirror — info-only surface, the wrist would
        // re-render on every update.
        localOnly: true,
        // Live countdown rendered by the system. timestamp = target
        // instant, chronometerDirection 'down' → ticks toward it.
        showChronometer: input.nextPrayerTimestamp != null,
        chronometerDirection: 'down',
        timestamp: input.nextPrayerTimestamp ?? undefined,
        showTimestamp: input.nextPrayerTimestamp != null,
        category: AndroidCategory.STATUS,
        visibility: AndroidVisibility.PUBLIC,
        importance: AndroidImportance.LOW,
        // InboxStyle = platform-native list-of-lines. Each line is a
        // separate visible row; the shell elides them per its own
        // density rules. Empty lines[] → fall back to the body.
        style:
          inboxLines.length > 0
            ? {
                type: AndroidStyle.INBOX,
                lines: inboxLines,
                title,
                summary,
              }
            : undefined,
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });
  } catch (e) {
    console.warn('[liveActivity] post failed', e);
  }
}

export async function stopLiveActivity(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // The two paths post their notifications to different ids
  // (NotificationManager int vs notifee string), so cancel both so we
  // don't leave a stray pinned banner around when the user flips off.
  const native = getMihrabLiveActivityModule();
  if (native) {
    try {
      await native.cancel();
    } catch {
      // Non-fatal.
    }
  }
  try {
    await notifee.cancelNotification(LIVE_ACTIVITY_NOTIFICATION_ID);
  } catch {
    // Non-fatal.
  }
}
