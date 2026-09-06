/**
 * Typed wrapper for the MihrabLiveActivity native module (Android).
 *
 * The Android Live Activity is rendered via a custom RemoteViews layout
 * declared in:
 *   • android/app/src/main/res/layout/live_activity_collapsed.xml
 *   • android/app/src/main/res/layout/live_activity_expanded.xml
 * Both layouts include a `Chronometer` view configured for count-down,
 * a `ProgressBar` showing fraction of time elapsed between the previous
 * and next prayer, and (in the expanded view) six row slots populated
 * from the payload.
 *
 * On Android 16+ the notification carries `android.shortCriticalText`
 * in its extras so the system shade can promote it to the status-bar
 * "Live Update" chip — Android's closest analogue to iOS's Dynamic
 * Island.
 *
 * `getMihrabLiveActivityModule()` returns null on platforms where the
 * module isn't linked (iOS, JS-only tests). Callers should fall through
 * to the notifee path when it returns null.
 */
import { NativeModules } from 'react-native';

export type MihrabLiveActivityPayload = {
  /** Localised prayer name for the upcoming prayer. */
  nextLabel: string;
  /**
   * CANONICAL 24-hour `HH:mm` for the upcoming prayer.
   *
   * Parsed natively: `MihrabLiveActivityModule` turns it into a
   * `LocalTime` for the Android 17 "At <time>" metric, which the SYSTEM
   * then formats to the device's own clock. Draw `nextTimeDisplay`.
   */
  nextTime: string;
  /**
   * The same time, written the way the user reads a clock (issue #18).
   * Equal to `nextTime` on a 24-hour clock — this one is small enough
   * that a copy costs nothing, unlike the per-row field.
   */
  nextTimeDisplay: string;
  /** Stable row key for the upcoming prayer (e.g. 'Fajr'). */
  nextKey: string;
  /** ms-since-epoch of the upcoming prayer — drives the Chronometer
   *  countdown and the progress-bar fraction calculation. */
  nextEpochMs: number;
  /** ms-since-epoch of the PREVIOUS prayer. The native foreground
   *  service uses (now - prev) / (next - prev) to recompute the
   *  progress bar on every minute-tick so the bar advances even when
   *  the app isn't open. */
  prevEpochMs: number;
  /** Already-localised title rendered in `setContentTitle`; mostly
   *  shown by Wear OS / connected devices that ignore RemoteViews. */
  title: string;
  /** Already-localised body for the same fallback path. */
  body: string;
  /** 0..1 — fraction of elapsed time between previous prayer and next.
   *  Computed JS-side; the native module just renders. */
  progressFraction: number;
  /** Chronological prayer list. Each row carries the stable `key`, the
   *  localised long `name`, and the HH:MM `time`. */
  rows: { key: string; name: string; time: string; display?: string }[];
  /** Sunrise row sent separately so the native module can splice it
   *  into slot 1 only when the user has the toggle on. */
  sunriseRow?: { key: string; name: string; time: string; display?: string };
  /** Enabled pre-dawn night rows (Islamic Midnight / Last Third) for the
   *  currently-shown day. Added as timeline markers + countdown candidates. */
  extraRows?: { key: string; name: string; time: string; display?: string }[];
  /** Multi-day schedule (index 0 = today). The foreground-service ticker
   *  uses this to recompute the next/previous prayer against the absolute
   *  dated schedule, so the countdown rolls onto the correct day's times
   *  without the app being reopened. Each day carries the localised long
   *  prayer names. Optional — when absent the service falls back to the
   *  single-day `rows` + HH:MM advance logic. */
  days?: {
    dateKey: string;
    /** Hijri label for this day; the native ticker promotes it to the
     *  top-level hijriLabel as the day rolls over. */
    hijriLabel?: string;
    rows: { key: string; name: string; time: string; display?: string }[];
    sunriseRow?: { key: string; name: string; time: string; display?: string };
    extraRows?: { key: string; name: string; time: string; display?: string }[];
  }[];
  /** Hijri caption, empty string → omit. */
  hijriLabel: string;
  /** Location caption — already shortened to the first comma-separated
   *  component by the JS side. */
  locationLabel: string;
  /** App accent hex (#RRGGBB) — drives the dot, chronometer text,
   *  progress-bar tint. */
  accentHex: string;
  /** When true, the native module re-resolves the live Material You system
   *  accent on each repost instead of using `accentHex` (Android system
   *  colours on), so the tint matches the app and auto-updates on wallpaper
   *  colour changes without reopening. */
  systemAccent?: boolean;
  /** Android Live Activity visual style (both keep the chip + AOD):
   *   'timeline'  — full prayer-day ProgressStyle timeline + inline countdown.
   *   'countdown' — countdown-focused: big countdown title + prayer name/time. */
  design?: 'timeline' | 'countdown' | 'markers';
  /** Display knobs. */
  compactMode: boolean;
  showSunrise: boolean;
  showHijri: boolean;
  showLocation: boolean;
  /** Localised "Prayer countdown active" text for the silent FGS
   *  placeholder notification — respects the app's selected language
   *  rather than the device OS locale. */
  fgsText?: string;
  // ── Android 17 enhancements ──────────────────────────────────────
  /** Optional second metric on the countdown (MetricStyle) design.
   *  'time' = prayer clock time, 'elapsed' = since previous prayer. */
  /**
   * Always 'time' now — the next prayer's clock time beside the countdown.
   * It was a setting with an 'off' choice; see settings/types.ts for why a
   * picker with one sensible answer stopped being a picker.
   */
  secondMetric?: 'time';
  /** When true, show the "Mute next adhan" toggle action (an adhan is
   *  selected and prayer notifications are enabled). */
  adhanActionEnabled?: boolean;
  /** Localised action labels for the mute toggle. */
  muteLabel?: string;
  unmuteLabel?: string;
  /** When true, show the second "hide/show on lock screen" toggle action that
   *  controls whether the ongoing Live Activity appears on the lock screen /
   *  always-on display (independent of the master on/off setting). */
  aodActionEnabled?: boolean;
  /** Localised labels for the lock-screen visibility toggle. `aodHideLabel`
   *  shows while the card is visible on the lock screen (press → hide);
   *  `aodShowLabel` shows while it is hidden (press → show). */
  aodHideLabel?: string;
  aodShowLabel?: string;
  /** Localised "now" word for the brief "it's <prayer>" arrival state. */
  nowWord?: string;
  /** Localised metric labels for the countdown design: "In" (countdown),
   *  "At" (prayer time), "Since" (elapsed). */
  inWord?: string;
  atWord?: string;
  sinceWord?: string;
  /** Data the native mute action forwards to the HeadlessJS reschedule
   *  task so it can re-create the next prayer's trigger silently / with
   *  the adhan. */
  atPrayerBody?: string;
  adhanChannelId?: string;
  adhanSoundId?: string;
  defaultChannelId?: string;
};

export interface MihrabLiveActivityInterface {
  display(payloadJson: string): Promise<void>;
  cancel(): Promise<void>;
}

export function getMihrabLiveActivityModule(): MihrabLiveActivityInterface | null {
  const mod = NativeModules.MihrabLiveActivity as
    | MihrabLiveActivityInterface
    | undefined;
  if (mod?.display) return mod;
  return null;
}
