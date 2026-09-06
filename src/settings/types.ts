import type { PrePrayerReminderMinutes } from './prePrayerReminder';
import type { NotificationSoundId } from '../notifications/notificationSounds';
import type { PrayerOffsetMinutes } from './prayerOffsets';
import type { AlertModeMap } from './alertModes';
import type { ClockFormat } from '../utils/clockFormat';

export type LocationMode = 'automatic' | 'manual';

export type PrayerDataProviderId =
  | 'aladhan'
  | 'prayertimes_dev'
  | 'islamiska_forbundet'
  | 'habous'
  | 'local_adhan';

export type AppearancePreference = 'system' | 'light' | 'dark';

export type AppLanguage = 'en' | 'sv' | 'ar' | 'bn' | 'ur' | 'hi' | 'fr' | 'es' | 'de' | 'tr' | 'id' | 'ru' | 'zh';

/**
 * Next-prayer row colour on the home screen widget: a preset or a custom
 * hex.
 *
 * 'dynamic' was removed on 2026-08-27. The Android widget does not follow
 * Material You any more — the app still may — and no picker on any
 * platform offered it. A stored 'dynamic' from an older build fails
 * `coerceWidgetHighlightId` and lands on the default, which is the colour
 * it was already being drawn in.
 */
export type WidgetHighlightId =
  | 'green'
  | 'teal'
  | 'blue'
  | 'amber'
  | 'custom';

/**
 * App accent color id — task #127.
 *
 * Drives the in-app accent (`palette.accent`) AND, when dynamic colors
 * are OFF, also drives the widget highlight (so the user picks a color
 * once and both follow). Dynamic colors flips both to OS Material You /
 * iOS dynamic; the picker is hidden in that mode.
 *
 * Note: 'dynamic' is intentionally absent here — the unified
 * dynamic-color toggle on AppearanceCard handles that case.
 */
export type AppAccentId =
  | 'green'
  | 'teal'
  | 'blue'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'custom';

/**
 * A user-saved location preset — task #18.
 *
 * Lets the user keep "Home", "Work", "Trip to Mecca" etc. as named snapshots
 * and switch between them with one tap. Coordinates are PII so the entire
 * preset list lives in encrypted storage (see `secureStorage.ts`).
 *
 * The active preset's coordinates are also copied into `manualLatitude` /
 * `manualLongitude` / `manualLocationLabel` so the rest of the app keeps
 * reading those fields without needing to know about presets — the preset
 * system is purely additive.
 */
export type LocationPreset = {
  /** Stable opaque id (uuid-like string). */
  id: string;
  /** User-given name, e.g. "Home", "Office". */
  name: string;
  latitude: number;
  longitude: number;
  /** Optional place-name label captured at save time, e.g. "Stockholm, Sweden". */
  label?: string;
};

export type PrayerAppSettings = {
  /** Follow OS light/dark, or force one mode. */
  appearance: AppearancePreference;
  /**
   * When theme is System, use platform semantic colors (iOS system colors,
   * Android Material / dynamic color). Ignored when appearance is not system.
   */
  useSystemDynamicTheme: boolean;
  /** When dark, use #000 background (OLED); ignored in light mode. */
  pureBlackDark: boolean;
  dataProvider: PrayerDataProviderId;
  /**
   * When true, coordinates in Sweden use Sweden (city-list) prayer times; outside Sweden, AlAdhan.
   * Choosing a provider from the list sets this to false.
   */
  dataProviderAuto: boolean;
  /** Whether the hidden data-statistics toggle has been revealed (unlocked by
   *  tapping the version 5× in Settings, like Android developer mode). */
  dataStatsUnlocked: boolean;
  /** Show the data-statistics card at the bottom of Home (source, coverage,
   *  refresh timing, last server-run status). Diagnostic; default off. */
  showDataStats: boolean;
  /**
   * Put the practice graph on Home as well as the Log tab. Off by default:
   * Home is the screen you open to find out when to pray, and a record of
   * how the last three months went is not that question.
   */
  showPracticeOnHome: boolean;
  calculationMethod: number | 'auto';
  school: number;
  locationMode: LocationMode;
  manualLatitude: number;
  manualLongitude: number;
  /** Set when the user picks a place from search (optional). */
  manualLocationLabel?: string;
  /** False until the user picks GPS or manual setup on first launch. */
  locationOnboardingComplete: boolean;
  /** UI language (English, Swedish, Arabic). */
  language: AppLanguage;
  /**
   * How clock times are drawn — issue #18.
   *
   * 'auto' follows the device's own 12/24-hour switch, which is what a
   * clock on the same screen does. '12' and '24' are the user saying
   * they want something other than that, and are honoured over both the
   * device and the app language.
   *
   * Display only. Every stored and transmitted time stays canonical
   * 24-hour `HH:mm` — the widgets parse it. See `utils/clockFormat.ts`.
   */
  clockFormat: ClockFormat;
  /**
   * True once the user has chosen a language themselves.
   *
   * The difference matters: an app that has never been told which language
   * to speak should follow the phone, and one that has been told should not
   * change its mind because the phone did. Without this flag the two cases
   * are the same stored string.
   */
  languagePicked: boolean;
  /** Last coordinates used for API/GPS (for month view when GPS). */
  lastFetchedLatitude?: number;
  lastFetchedLongitude?: number;
  /** Reverse-geocoded city name for the CURRENT automatic-mode location.
   *  Surfaced on the location chip so automatic mode names the city (not just
   *  coords). Derived from location, so stored in the encrypted slice. */
  autoLocationLabel?: string;
  notificationsEnabled: boolean;
  /**
   * Extra notification this many minutes before each prayer (0 = off).
   * Only applies when `notificationsEnabled` is true.
   */
  prePrayerReminderMinutes: PrePrayerReminderMinutes;
  /** Notification sound profile for prayer alerts/reminders. */
  notificationSound: NotificationSoundId;
  /**
   * How each prayer and each optional time announces itself — adhan,
   * notification or silent. Keyed by row (`Fajr`, `Sunrise`, …).
   *
   * Sparse on purpose. A key that is absent means "whatever the app did
   * before this setting existed" — see `alertModeFor` — so an upgrade
   * sounds identical until somebody actually changes a row, and the
   * global sound picker keeps working for everyone who never does.
   */
  prayerAlertModes: AlertModeMap;
  /**
   * ANDROID: play the adhan through the alarm stream, so the ringer switch
   * does not silence it (issue #9).
   *
   * A notification channel's audio carries `USAGE_NOTIFICATION`, which
   * Android routes to the notification stream — the one the ringer
   * silences. That is correct behaviour and useless to someone who
   * silences their phone and still wants to be called to prayer.
   * `USAGE_ALARM` goes to the alarm stream, which the ringer does not
   * touch, for the same reason an alarm clock still goes off.
   *
   * Off by default: it is louder than what the user agreed to when they
   * turned notifications on, and a prayer alert that ignores a silenced
   * phone should be asked for rather than assumed.
   *
   * Does nothing on iOS. Notification sounds there obey the physical
   * silent switch and only the Critical Alerts entitlement overrides it,
   * which Apple grants to health and public-safety apps.
   */
  adhanUsesAlarmStream: boolean;
  /** Android: widget background opacity 0–100. */
  androidWidgetBackgroundOpacity: number;
  /** Highlight style for the widget next-prayer row. */
  widgetHighlightId: WidgetHighlightId;
  /** When `widgetHighlightId` is `custom`, #RRGGBB (e.g. #6BC98A). */
  widgetHighlightCustomHex: string;
  /**
   * User's saved location presets — task #18. Always-present (never
   * undefined); empty array means no presets saved yet.
   */
  locationPresets: LocationPreset[];
  /**
   * Id of the preset currently in use. When set, `manualLatitude` /
   * `manualLongitude` / `manualLocationLabel` mirror the matching preset's
   * fields (the rest of the app still reads from `manual*`). When the user
   * edits coords directly or picks a new place, this is cleared.
   */
  activeLocationPresetId?: string;
  /**
   * Per-prayer offsets in minutes — task #22. Allows the user to nudge
   * each prayer ±N minutes to match a local mosque schedule. Empty object
   * (default) means no offsets are applied. See `applyOffsets()` in
   * `src/settings/prayerOffsets.ts` for the math; the values are applied
   * AFTER provider validation but BEFORE caching/widget push so a buggy
   * offset never poisons the cache.
   */
  prayerOffsets: PrayerOffsetMinutes;
  /**
   * Onboarding flow completion flag — task #30 + follow-up #60.
   *
   * False on first launch; flipped true when the user completes (or
   * skips) the OnboardingScreen flow. Distinct from
   * `locationOnboardingComplete` which gates only the location step —
   * this gates the wider welcome / notifications / exact-alarms flow.
   */
  onboardingComplete: boolean;
  /**
   * Active Quran translation edition — task #96.
   *
   * Empty string means "follow app language" (the default). When set,
   * the QuranSurahScreen reads that edition regardless of locale. The
   * text ships as an app asset at `assets/quran/translations/{id}.json`
   * rather than inside the JS bundle; see `src/quran/translations.ts`
   * for the registry and the loader.
   */
  quranTranslationEdition: string;
  /**
   * Reading mode for the QuranSurahScreen — task #97.
   *
   * `mushaf` (default since v2.7.27) is the interactive Arabic page
   * reader — opening a surah lands on the raw mushaf. `withTranslation`
   * shows ayah-by-ayah cards with Arabic + translation. The header
   * toggle persists the user's last choice.
   */
  quranReadingMode: 'withTranslation' | 'mushaf';
  /**
   * Migration marker (v2.7.27): set once the mushaf-as-default reading
   * mode has been applied to this install. Never removed — additive
   * schema. See `storage.ts`.
   */
  quranModeMushafDefault: boolean;
  /**
   * Day-before fasting reminder — task #98.
   *
   * When true, schedules a notifee notification the evening before
   * each Monday, Thursday, and curated special day (Ashura, Arafah,
   * White Days, 6 of Shawwal, 1 Ramadan).
   */
  fastingRemindersEnabled: boolean;
  /** Hour of the day (0-23) the day-before fasting reminder fires. */
  fastingReminderHour: number;
  /**
   * Journal log-from-notification — task #99.
   *
   * When true, the prayer-time notification gets a "Log prayer" action
   * that opens the journal pre-targeted to today's row for that prayer.
   */
  journalNotificationActionsEnabled: boolean;
  /**
   * End-of-day "log all as complete" reminder — v2.8.5.
   *
   * Fires ten minutes after Isha and offers a single action that marks
   * the whole day's five prayers on-time. It exists because the day's
   * logging is otherwise five separate acts of bookkeeping performed
   * while you are trying to pray, and most days the honest answer is
   * "all five, yes".
   *
   * The notification carries the DATE IT WAS FOR in its payload, so a
   * reminder answered the next morning still logs the night it belongs
   * to — a 10pm prompt is one people sleep through.
   */
  endOfDayLogReminderEnabled: boolean;
  /**
   * App accent color id — task #127. Drives the in-app accent and (when
   * `useSystemDynamicTheme` is off) also the widget highlight via the
   * sync logic in `syncWidgetUiHints.ts`. When `useSystemDynamicTheme`
   * is on, this is ignored and both app + widget use Material You.
   */
  appAccentId: AppAccentId;
  /** When `appAccentId` is 'custom', the user-typed #RRGGBB hex. */
  appAccentCustomHex: string;
  /**
   * Live Activity / persistent prayer-countdown notification — task #128.
   *
   * When ON, the app pins an ongoing notification (Android) or starts an
   * ActivityKit Live Activity (iOS 16.1+) showing the countdown to the
   * next prayer plus the rest of the day's times. Off by default so
   * notifications don't surprise upgraders.
   */
  liveActivityEnabled: boolean;
  // ── Retained-but-unused (since v2.1.0-beta.5) ──────────────────────────
  // These Live Activity display knobs were removed from the UI: Sunrise is
  // always shown and the Hijri/location captions are always omitted. The
  // fields are kept because the settings schema is additive-only (removing a
  // field breaks upgraders, see CLAUDE.md §12). Nothing reads them anymore.
  liveActivityCompactMode: boolean;
  liveActivityShowSunrise: boolean;
  liveActivityShowHijri: boolean;
  liveActivityShowLocation: boolean;
  /**
   * Visual style for the Android Live Activity. Both preserve the Android 16
   * status-bar chip + the always-on ongoing notification.
   *   'timeline'  — the full prayer-day ProgressStyle timeline with a marker at
   *                 each prayer and an inline countdown in the title (default).
   *   'countdown' — countdown-focused: the live countdown is the prominent title,
   *                 with the next prayer's name + clock time beneath it.
   * Android only; ignored on iOS.
   */
  liveActivityDesign: 'timeline' | 'countdown' | 'markers';
  /*
   * `liveActivitySecondMetric` used to live here: a picker on the countdown
   * design offering 'off', 'time' (the next prayer's clock time beside the
   * countdown) and, before that, a stopwatch counting up since the previous
   * prayer.
   *
   * The stopwatch went first — on a card whose whole point is one number
   * falling to zero, a second clock climbing away from it reads as a
   * contradiction rather than as more information. That left two choices,
   * and then the answer to "should the card also say what time the prayer
   * is" turned out to be yes, always: it is the one fact the countdown does
   * not carry, it costs a line the card already has room for, and nobody
   * chooses to know less. A picker with one sensible answer is a question
   * that should not have been asked, so the setting is gone and the clock
   * time is simply always there. Anything an old install stored is ignored.
   */
  /**
   * Whether the Live Activity card carries its lock-screen toggle button.
   *
   * Android only, and on by default because that is the behaviour it had.
   * The card has room for two actions and the other one — muting the next
   * adhan — is the one people reach for; someone who never hides the card
   * from their lock screen is carrying a button they will never press,
   * on a surface where space is the scarce thing.
   */
  liveActivityLockButton: boolean;
  /**
   * Non-prayer time toggles. Each gates one optional entry across the prayer
   * table, notifications, home-screen widget, and Live Activity. All three use
   * the default notification sound (never the adhan).
   *
   *  - `sunriseEnabled` — kill-switch for Sunrise (defaults ON: existing
   *    behaviour). When off, Sunrise disappears everywhere.
   *  - `islamicMidnightEnabled` — Islamic Midnight, the midpoint of the night
   *    (Maghrib → Fajr). Defaults OFF.
   *  - `lastThirdEnabled` — start of the last third of the night (Qiyām
   *    al-Layl). Defaults OFF.
   *  - `firstThirdEnabled` — the END of the first third of the night, which
   *    in the Mālikī reckoning is where Ishāʾ leaves its preferred window
   *    for its late one (issue #14). Unlike the other two it belongs to the
   *    night that BEGINS today, so it sits after Ishāʾ. Defaults OFF.
   */
  sunriseEnabled: boolean;
  islamicMidnightEnabled: boolean;
  lastThirdEnabled: boolean;
  firstThirdEnabled: boolean;
  /**
   * Mālikī second times — issue #19. Defaults OFF.
   *
   * In the Mālikī reckoning each prayer has a preferred window
   * (*ikhtiyārī*) and a late one (*ḍarūrī*) that is still valid but
   * entered without excuse only at a cost. When this is on, each prayer
   * on the Today card says when its preferred window closes.
   *
   * Not a row and not a notification: five more rows would double the
   * card, and the useful fact is an annotation on a prayer, not an event
   * of its own. See `src/prayer/daruriTimes.ts` for the boundaries, which
   * of them are geometry and which are a model of a colour, and why the
   * shadow is always 1:1 whatever `school` says.
   */
  malikiSecondTimesEnabled: boolean;
  /**
   * Which of the five second-time boundaries send a notification —
   * issue #19. A subset of `DARURI_KEYS`; empty by default, and empty is
   * the whole point.
   *
   * Five more alerts a day, on top of the five prayers, the advance
   * reminders and whichever of Sunrise and the night marks are on, is
   * how an app teaches people to swipe its notifications away — which
   * costs more than these are worth, including for the prayer alerts
   * that were already working. So showing the times and announcing them
   * are separate decisions, and the second one is made a prayer at a
   * time.
   */
  malikiSecondTimeAlerts: string[];
  /**
   * Whether the boundaries are DRAWN in the day's times — issue #19.
   *
   * Separate from the feature switch above, because the reporter asked
   * for the alerts and specifically not the rows: *"Having an additional
   * time in the rows will just make the UI compact and bad looking."*
   * Until this existed the only way to get the notifications was to turn
   * on the thing he had asked not to have, since both the card and the
   * alert schedule hung off one switch.
   *
   * Defaults to true, so turning the feature on gives what it always
   * gave and nobody who already had the rows loses them.
   */
  malikiSecondTimeRows: boolean;
  /**
   * Also announce the far end of each chosen window — the instant the
   * prayer becomes qaḍāʾ (issue #19).
   *
   * The start alert says the preferred time is over and the second
   * window has opened; this one says the window has shut. *"I would also
   * love to add the end of it as a QOL improvement so I can know when the
   * prayer is considered missed and I should pray qadhaa'."* One switch
   * over the boundaries already chosen rather than a second list to keep
   * in step with the first.
   */
  malikiSecondTimeEndAlerts: boolean;
  /**
   * How long before a boundary its alert fires. 0 means at the boundary.
   *
   * The default is 15: the row on the card is the reference, and the
   * alert is the thing a person acts on — by the moment a window closes
   * there is nothing left to act on.
   */
  malikiSecondTimeAlertMinutes: PrePrayerReminderMinutes;
  /**
   * Ayah of the day notification — v2.7.27.
   *
   * When on, a daily notification fires at the chosen time with a
   * randomly drawn ayah (uniform over all 6,236) plus its translation in
   * the user's active edition ("default tafsir" — the same resolution
   * the reader uses). Scheduled 14 days ahead, each day's ayah drawn at
   * scheduling time; re-synced on app foreground and settings change.
   */
  /**
   * Morning adhkār reminder — a notification inside the window the duas
   * themselves name: after Fajr and before sunrise.
   *
   * No hour to pick, deliberately. The window moves with the sun by
   * hours over a year, so a fixed clock time is right for a fortnight
   * and wrong after that; the time is derived from the day's own prayer
   * times instead. See notifications/duaReminders.ts.
   */
  morningDuaReminderEnabled: boolean;
  /** Evening adhkār reminder: after ʿAṣr and before sunset. */
  eveningDuaReminderEnabled: boolean;
  ayahOfDayEnabled: boolean;
  /** Hour (0–23) the ayah-of-the-day notification fires. */
  ayahOfDayHour: number;
  /** Minute (0–59) the ayah-of-the-day notification fires. */
  ayahOfDayMinute: number;
  /**
   * Khatmah daily reminder — v2.7.28. A gentle daily notification with
   * today's portion while a khatmah plan is active. Same scheduling
   * pattern as the ayah of the day (rolling window, foreground resync).
   */
  khatmahReminderEnabled: boolean;
  khatmahReminderHour: number;
  khatmahReminderMinute: number;
};

export const DEFAULT_SETTINGS: PrayerAppSettings = {
  appearance: 'system',
  useSystemDynamicTheme: false,
  pureBlackDark: false,
  dataProvider: 'aladhan',
  dataProviderAuto: true,
  dataStatsUnlocked: false,
  showDataStats: false,
  showPracticeOnHome: false,
  calculationMethod: 'auto',
  school: 0,
  // Default to GPS so first-run users in Sweden (or anywhere) don't get
  // stuck on a hardcoded "manual" placeholder if they skip onboarding.
  // Onboarding's manual-entry path explicitly switches this to 'manual'
  // when the user picks a city / coordinates.
  locationMode: 'automatic',
  // 0/0 is intentionally an "unset" sentinel — every consumer gates on
  // `locationOnboardingComplete` and falls back to GPS in automatic mode,
  // so these values are only ever read after the user has explicitly
  // chosen a manual location.
  manualLatitude: 0,
  manualLongitude: 0,
  locationOnboardingComplete: false,
  language: 'en',
  languagePicked: false,
  clockFormat: 'auto',
  notificationsEnabled: false,
  prePrayerReminderMinutes: 0,
  notificationSound: 'default',
  adhanUsesAlarmStream: false,
  prayerAlertModes: {},
  androidWidgetBackgroundOpacity: 88,
  widgetHighlightId: 'green',
  widgetHighlightCustomHex: '#6BC98A',
  locationPresets: [],
  prayerOffsets: {},
  onboardingComplete: false,
  // Empty string = follow app language (resolved at read time via
  // `defaultEditionForLocale`).
  quranTranslationEdition: '',
  // Raw Arabic mushaf is the default reading experience (v2.7.27);
  // toggling to translation view persists per user.
  quranReadingMode: 'mushaf',
  quranModeMushafDefault: true,
  fastingRemindersEnabled: false,
  // 8 PM by default — late enough to land after isha, early enough that
  // the user notices before sleeping.
  fastingReminderHour: 20,
  journalNotificationActionsEnabled: false,
  // Off until asked for: an unsolicited nightly notification is the kind
  // of thing people uninstall an app over.
  endOfDayLogReminderEnabled: false,
  // App accent defaults to brand green (matches the historical hardcoded
  // accent so users on existing installs see no visual diff after the
  // upgrade).
  appAccentId: 'green',
  appAccentCustomHex: '#22c55e',
  // Live Activity defaults: OFF; when enabled, the detail-rich layout
  // (full list + hijri + location) is the default — it's the more
  // useful version on the lock screen / shade. Sunrise included because
  // it's the most-requested data point not in the headline countdown.
  liveActivityEnabled: false,
  liveActivityCompactMode: false,
  liveActivityShowSunrise: true,
  liveActivityShowHijri: true,
  liveActivityShowLocation: true,
  liveActivityDesign: 'timeline',
  liveActivityLockButton: true,
  // Sunrise on by default (unchanged behaviour); the two night times off by
  // default so existing users see no new rows/notifications until they opt in.
  sunriseEnabled: true,
  islamicMidnightEnabled: false,
  lastThirdEnabled: false,
  firstThirdEnabled: false,
  malikiSecondTimesEnabled: false,
  malikiSecondTimeAlerts: [],
  malikiSecondTimeAlertMinutes: 15,
  // The rows are what this feature always drew, so they stay on by
  // default; the end-of-window alert is new and opts in like every other
  // notification the user did not ask for.
  malikiSecondTimeRows: true,
  malikiSecondTimeEndAlerts: false,
  // Ayah of the day: off by default (no surprise notifications); 9:00 AM
  // when enabled — a quiet mid-morning moment.
  // Adhkār reminders: off by default, like every other notification the
  // user did not ask for. No time to default — it comes from the sun.
  morningDuaReminderEnabled: false,
  eveningDuaReminderEnabled: false,
  ayahOfDayEnabled: false,
  ayahOfDayHour: 9,
  ayahOfDayMinute: 0,
  // Khatmah reminder: off by default; 6 PM when enabled — early evening,
  // with time left to read before the day ends.
  khatmahReminderEnabled: false,
  khatmahReminderHour: 18,
  khatmahReminderMinute: 0,
};
