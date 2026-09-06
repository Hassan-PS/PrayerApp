import {
  useFocusEffect,
  useNavigation,
  useScrollToTop,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import notifee, {
  AndroidNotificationSetting,
  AuthorizationStatus,
} from '@notifee/react-native';
import { ProviderPickerModal } from '../components/ProviderPickerModal';
import { usePrayerSettings } from '../context/PrayerSettingsContext';
import { useAppPalette } from '../hooks/useAppPalette';
import { useIsActive } from '../hooks/useIsActive';
import {
  dayTzFingerprint,
  markResynced,
  shouldResync,
} from '../utils/resyncGate';
import { usePrayerDay } from '../hooks/usePrayerDay';
import { getCacheStatus } from '../prayer/prayerStorage';
import { usePrefetchSavedLocations } from '../hooks/usePrefetchSavedLocations';
import { syncPrayerNotifications } from '../notifications/prayerNotifications';
import { syncPrayerWidget } from '../widget/syncPrayerWidget';
import { collectWidgetExtras } from '../widget/collectWidgetExtras';
import { useWidgetDataRevision } from '../widget/useWidgetDataRevision';
import { syncLiveActivity } from '../liveActivity/syncLiveActivity';
import {
  getEffectiveDataProvider,
  resolveCoordsForProvider,
} from '../settings/effectiveProvider';
import {
  addDays,
  getNextPrayerDisplay,
} from '../utils/prayerTimes';
import { filterOptionalTimes } from '../utils/nightTimes';
import { injectDaruriTimes } from '../prayer/daruriTimes';
import { useClockFormatter } from '../hooks/useClockFormatter';
import { qiblaBearingFrom } from '../utils/qibla';
import type { RootStackParamList } from '../navigation/types';
import { computeSeasonalTreatment } from '../seasonal/treatments';
import { TodayCard } from './home/TodayCard';
import { formatHijriLabel } from '../hijri/formatHijriLabel';
import { QuranCard } from './home/QuranCard';
import { PermissionBanners } from './home/PermissionBanners';
import { ProviderFooter } from './home/ProviderFooter';
import { DataStatsPanel } from './home/DataStatsPanel';
import { PracticeCard } from './home/PracticeCard';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TodaySummary } from './home/TodaySummary';
import { CenteredColumn } from '../responsive/CenteredColumn';
import { isMacCatalyst } from '../responsive/breakpoints';
import { HeaderPlaybackBar } from '../quran/audio/HeaderPlaybackBar';
import { HomeHeaderControls } from '../navigation/HomeHeaderControls';
import { MihrabHeaderTitle } from '../navigation/MihrabHeaderTitle';
import { RamadanCountdownCard } from './home/RamadanCountdownCard';
import { useNonReadyPhaseElement } from './home/usePhaseRouting';
import { HOME_SCREEN_PADDING } from './home/tokens';
import { useTabBarInset } from '../navigation/tabBarInset';
import { useTabBarScroll } from '../navigation/tabBarVisibility';
import { rescheduleEndOfDayLogReminders } from '../notifications/endOfDayLog';
import { rescheduleDuaReminders } from '../notifications/duaReminders';
import {
  FeatureTourModal,
  hasSeenFeatureTour,
} from '../polish/FeatureTourModal';

/**
 * HomeScreen orchestrator — task #8 split.
 *
 * Owns hooks, effects, and orchestration; delegates rendering to children
 * under `src/screens/home/`. Two big perf wins land here:
 *
 *  1. The 30-second clock tick lives inside `TodayCard`'s hero (the only
 *     component that displays the countdown). Previously the tick triggered
 *     `setNow(...)` in this file, forcing an 800-line tree to re-render every
 *     30 seconds. Now only the countdown re-renders — not even the day strip
 *     or the eight prayer rows beside it.
 *
 *  2. `nextInfo` (the next prayer's name + Date) is recomputed only when a
 *     prayer actually passes — not every tick. The local "watchdog" effect
 *     polls every 30s but only calls `setNextInfo(...)` when the result has
 *     genuinely changed, so the day table re-renders only when the
 *     highlighted row should move.
 *
 * Anything else this file does (notification sync, widget sync, last-fetched
 * coord persistence, locale-aware day labels) is unchanged behavior — same
 * effects, same call shapes, just lifted out of the rendering hot path.
 */
/** Gate keys — see src/utils/resyncGate.ts. */
const NOTIF_RESYNC_KEY = 'home.prayerNotifications';
const EOD_RESYNC_KEY = 'home.endOfDayReminders';
const DUA_RESYNC_KEY = 'home.duaReminders';

export function HomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t, i18n } = useTranslation();
  const { settings, hydrated, updateSettings } = usePrayerSettings();
  const { state, retry } = usePrayerDay(settings, hydrated);
  // Moves when a prayer is logged, a page is turned or a bead is counted —
  // none of which changes a prayer time, all of which change the widget.
  const widgetRevision = useWidgetDataRevision();
  // Background prefetch of 12 months for every saved location preset, so
  // switching presets is instant and doesn't wipe the previously-cached
  // months — task #145. Runs serially in the background, never blocks the
  // home render.
  usePrefetchSavedLocations();
  const { palette } = useAppPalette();
  /**
   * Tapping the tab you are already on returns this screen to the top —
   * the standard idiom on both platforms, and the only way back up a
   * long page without a lot of swiping. `useScrollToTop` listens for
   * `tabPress` and acts only while this screen is focused, so pressing a
   * DIFFERENT tab still just navigates.
   */
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  // The RESOLVED clock, not the stored preference. On 'auto' the answer
  // moves when the device's 12/24 switch does, and that has to re-sync
  // the widget, the Live Activity and the alert copy exactly as an
  // explicit change would — the screens already follow it through the
  // store, and a widget still saying "17:31" beside a Today card saying
  // "5:31 PM" is the split this dependency exists to prevent.
  const clockHour12 = useClockFormatter().hour12;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Cap the day-card width to the centered content column so the carousel
  // doesn't overflow the capped column on iPad/Mac windows.
  // Must equal the width the SIBLING cards actually render at — i.e. the
  // CenteredColumn inner width. The old `contentColumnWidth(w) - padding`
  // subtracted the screen padding AFTER the 720pt cap, so in the regular
  // band (window ≥ ~750pt) the day table came out 32pt narrower than the
  // hero/shortcut cards above and below it ("weird margins", Mac
  // 2026-07-16). The screen padding only eats into the column while the
  // window is narrower than cap + padding.
  // Expanded (wide iPad landscape / Mac window): lay Home out as a two-column
  // dashboard — a fixed "today" main column beside a flexible tools sidebar —
  // so the cards fill the window and fit without scrolling. The day carousel
  // is sized to the fixed main column so its pages stay crisp and aligned.
  // 1180 (not the 1100 'expanded' edge): below that the sidebar drops
  // under ~440pt and the tools grid crams — the centered single column
  // reads far better in that band (Mac audit 2026-07-16, plan v2 §B4).
  const isDashboard = screenWidth >= 1180;
  // Adapt to the window instead of a fixed cap: up to 1360pt of content
  // on big Mac windows, with the main column taking a proportional share
  // (clamped so the day table keeps a comfortable measure).
  const dashCap = Math.min(1360, screenWidth - 48);
  const HOME_MAIN_COL = isDashboard
    ? Math.max(620, Math.min(740, Math.round(dashCap * 0.54)))
    : 620;
  // Desktop zoom (Mac feedback 2026-07-16, "still a lot of empty
  // space"): past the width cap, ADAPT BY SCALING — the whole dashboard
  // zooms uniformly to the window, bounded by both axes and capped at
  // 1.45× so type never turns cartoonish. A pure width cap left the
  // dashboard floating tiny in a 2560×1440 fullscreen window.
  const DASH_BASE_HEIGHT = 940; // hero + day table + shortcut + padding
  const dashScale = isDashboard
    ? Math.min(
        1.45,
        Math.max(
          1,
          Math.min((screenWidth - 64) / dashCap, screenHeight / DASH_BASE_HEIGHT),
        ),
      )
    : 1;
  /**
   * How far the Mac top bar has to start below the window's own top.
   *
   * The Catalyst scene extends UNDER the window's title bar — the band the
   * red/yellow/green buttons live in. The navigation bar knew that and laid
   * its contents out below it; a plain view of ours does not, so the first
   * attempt drew the wordmark behind the traffic lights, with the window's
   * "Mihrab" title showing through it (reported 2026-08-24).
   *
   * The safe-area inset is the honest measure of that band, with a floor
   * under it: a scene that reports no top inset would put us straight back
   * behind the buttons, and a title bar is never shorter than this. 28
   * AppKit points over Catalyst's 0.77 canvas scale ≈ 36.
   */
  const insets = useSafeAreaInsets();
  const macTopBarInset = isMacCatalyst ? Math.max(insets.top, 36) + 6 : 0;
  /**
   * The scaled dashboard's real height, so the row above it survives.
   *
   * `transform: scale` does not change layout: the box still occupies its
   * UNSCALED height and the extra paints outside it, half above and half
   * below, over whatever is there. At 1.16× a ~700pt dashboard reaches
   * 55pt past its own top — straight over the Mac top bar, which is why
   * the wordmark and location chip vanished on wide windows and stayed
   * put on narrow ones (reported 2026-08-24).
   *
   * Measuring the row and spending the overflow as margin puts the box
   * back around what is actually painted: nothing overlaps, the vertical
   * centring is centring the real thing, and the bottom edge stops
   * running under the tab bar for the same reason.
   */
  const [dashRowH, setDashRowH] = useState(0);
  const dashOverflow =
    dashScale > 1 && dashRowH > 0 ? ((dashScale - 1) * dashRowH) / 2 : 0;
  const onDashRowLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    // Sub-pixel jitter would re-render forever; a whole point is finer
    // than anything this margin needs to be right about.
    setDashRowH(prev => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [exactAlarmDenied, setExactAlarmDenied] = useState(false);
  const [notifPermDenied, setNotifPermDenied] = useState(false);
  const [nextInfo, setNextInfo] = useState<{ name: string; at: Date } | null>(
    null,
  );

  // First-run feature walkthrough: shown once after onboarding completes.
  // Focus-scoped (not mount-scoped) so the Settings "Show the app tour"
  // replay — which clears the flag and pops back here — re-triggers it.
  const tabBarInset = useTabBarInset();
  // The bar gets out of the way while reading — see tabBarVisibility.ts.
  const tabBarScroll = useTabBarScroll();
  // Focus + foreground; see the watchdog effect below and useIsActive.
  const homeActive = useIsActive();
  const [tourVisible, setTourVisible] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!settings.onboardingComplete) return;
      let cancelled = false;
      void hasSeenFeatureTour().then(seen => {
        if (!cancelled && !seen) setTourVisible(true);
      });
      return () => {
        cancelled = true;
      };
    }, [settings.onboardingComplete]),
  );

  // Reactive gating of the optional non-prayer entries, so flipping a toggle
  // updates the surfaces immediately without a re-fetch. usePrayerDay always
  // derives Sunrise + the three night times into the raw `week`; here we strip
  // by the user's toggles, the same four for every surface — table,
  // notifications, Live Activity and widget alike.
  //
  // The widget used to keep Sunrise whatever the toggle said, and to carry the
  // night times as rows its headline was not allowed to name. Both are gone: a
  // toggle that means "remind me about the Last Third" means the widget counts
  // down to it too, and one turned off means the row is not there to explain
  // away. The only surface-level difference left is the window — the widget
  // gets the long one, because it has to stay true while the app is closed.
  const view = useMemo(() => {
    if (state.phase !== 'ready') return null;
    const { today, tomorrow, week } = state;
    const mk = (tg: {
      Sunrise: boolean;
      Midnight: boolean;
      Lastthird: boolean;
      Firstthird: boolean;
    }) => ({
      today: filterOptionalTimes(today, tg),
      tomorrow: tomorrow ? filterOptionalTimes(tomorrow, tg) : undefined,
      week: week.map(d => filterOptionalTimes(d, tg)),
    });
    const table = mk({
      Sunrise: settings.sunriseEnabled,
      Midnight: settings.islamicMidnightEnabled,
      Lastthird: settings.lastThirdEnabled,
      Firstthird: settings.firstThirdEnabled,
    });
    // Mālikī second times (issue #19), derived HERE rather than in
    // `usePrayerDay` for the same reason the toggles above are: flipping
    // the setting must change the card at once, and making the fetch
    // depend on it would cost a round trip to learn something the device
    // can work out from coordinates and a date. The table only — the
    // widget and the alert schedule do not carry these yet, and a payload
    // grown by fields nothing reads is size for nothing.
    // Computed whenever the FEATURE is on, not whenever the rows are.
    // The alert schedule reads the boundaries out of this same week, so
    // gating the injection on the rows meant the only way to be told
    // about a boundary was to also draw it — which is what #19's reporter
    // asked not to have. `malikiSecondTimeRows` decides the drawing; the
    // week below always carries them so the schedule can find them.
    const tableWithDaruri = settings.malikiSecondTimesEnabled
      ? injectDaruriTimes(
          table.week,
          state.baseDate,
          state.latitude,
          state.longitude,
          // `school` is 1 for Ḥanafī ʿAṣr (the 2:1 shadow), 0 otherwise.
          settings.school === 1 ? 2 : 1,
        )
      : null;
    const drawDaruri =
      tableWithDaruri != null && settings.malikiSecondTimeRows;
    return {
      table: drawDaruri
        ? {
            today: tableWithDaruri[0],
            tomorrow: tableWithDaruri[1],
            week: tableWithDaruri,
          }
        : table,
      /**
       * The week the ALERT schedule reads, which is not always the one
       * the card draws: with the rows off these two differ by exactly the
       * five boundaries, and that difference is the whole feature.
       */
      alertWeek: tableWithDaruri ?? table.week,
      la: mk({
        Sunrise: settings.sunriseEnabled,
        Midnight: settings.islamicMidnightEnabled,
        Lastthird: settings.lastThirdEnabled,
        Firstthird: settings.firstThirdEnabled,
      }),
      // The widget gets the LONG window, not the carousel's week — its copy
      // has to stay true across however long the app goes unopened.
      widget: {
        ...mk({
          Sunrise: settings.sunriseEnabled,
          Midnight: settings.islamicMidnightEnabled,
          Lastthird: settings.lastThirdEnabled,
          Firstthird: settings.firstThirdEnabled,
        }),
        week: (state.widgetWeek ?? week).map(d =>
          filterOptionalTimes(d, {
            Sunrise: settings.sunriseEnabled,
            Midnight: settings.islamicMidnightEnabled,
            Lastthird: settings.lastThirdEnabled,
            Firstthird: settings.firstThirdEnabled,
          }),
        ),
      },
    };
  }, [
    state,
    settings.sunriseEnabled,
    settings.islamicMidnightEnabled,
    settings.lastThirdEnabled,
    settings.firstThirdEnabled,
    settings.malikiSecondTimesEnabled,
    settings.malikiSecondTimeRows,
    settings.school,
  ]);

  const loadedDateKeyRef = useRef<string | null>(null);
  const loadedTzOffsetRef = useRef<number | null>(null);

  // Track the loaded date+tz so the watchdog interval can detect a day or
  // time-zone shift since the last successful fetch and trigger a retry().
  useEffect(() => {
    if (state.phase === 'ready') {
      loadedDateKeyRef.current = new Date().toDateString();
      loadedTzOffsetRef.current = new Date().getTimezoneOffset();
    }
  }, [state]);

  // Watchdog interval: detects day/tz change and recomputes nextInfo only when
  // the next prayer has actually changed. Crucially, this effect does NOT
  // schedule any per-tick state update — `now` lives inside TodayCard's hero.
  useEffect(() => {
    function tick() {
      if (state.phase !== 'ready') return;
      const current = new Date();
      const dateChanged =
        loadedDateKeyRef.current !== null &&
        current.toDateString() !== loadedDateKeyRef.current;
      const tzChanged =
        loadedTzOffsetRef.current !== null &&
        current.getTimezoneOffset() !== loadedTzOffsetRef.current;
      if (dateChanged || tzChanged) {
        retry();
        return;
      }
      const next = view
        ? getNextPrayerDisplay(view.table.today, view.table.tomorrow, current)
        : null;
      setNextInfo(prev => {
        if (
          prev?.name === next?.name &&
          prev?.at.getTime() === next?.at.getTime()
        ) {
          return prev;
        }
        return next;
      });
    }
    // Immediately, so nextInfo is ready on the first render after a fetch —
    // and so that returning from the background catches up in one step
    // whatever the clock did while the timer was stopped. A day that rolled
    // over, or a flight that crossed a timezone, is noticed here rather than
    // up to thirty seconds later.
    tick();
    // Only while someone is looking. This used to run every thirty seconds
    // for the life of the process, backgrounded included — and `tick()` can
    // call `retry()`, which is a GPS fix and a network fetch, so a day
    // rollover at midnight woke the phone up to do real work nobody asked
    // for (docs/design/background-power.md).
    if (!homeActive) return undefined;
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [state, retry, view, homeActive]);

  useEffect(() => {
    if (!hydrated || state.phase !== 'ready' || !view) return;
    syncPrayerNotifications({
      enabled: settings.notificationsEnabled,
      prePrayerReminderMinutes: settings.prePrayerReminderMinutes,
      notificationSound: settings.notificationSound,
      adhanUsesAlarmStream: settings.adhanUsesAlarmStream,
      today: view.table.today,
      tomorrow: view.table.tomorrow,
      // Anchor the schedule to the day the maps were FETCHED for — if this
      // sync fires with stale state just after midnight, yesterday's map
      // must not be pinned onto today's date (early-adhan bug, v2.7.38).
      baseDate: state.baseDate,
      // Extra cached days extend coverage past tomorrow so alerts keep
      // firing when the app isn't opened for a couple of days (v2.7.40).
      week: view.alertWeek,
      // Only when the times themselves are on: an alert about a boundary
      // the card is not showing would be the app announcing something the
      // reader cannot go and look at.
      daruriAlerts: settings.malikiSecondTimesEnabled
        ? settings.malikiSecondTimeAlerts
        : [],
      daruriAlertMinutes: settings.malikiSecondTimeAlertMinutes,
      daruriEndAlerts: settings.malikiSecondTimeEndAlerts,
      alertModes: settings.prayerAlertModes,
      journalLogActionEnabled: settings.journalNotificationActionsEnabled,
      hour12: clockHour12,
    }).catch(e => console.warn('syncPrayerNotifications (effect):', e));
    // The end-of-day prompt is scheduled from the same data and the same
    // moment as the prayer alerts: it needs Isha for every day it covers,
    // and this is the one place in the app that holds a week of times
    // anchored to the day they were fetched for.
    // This one DECRYPTS THE WHOLE JOURNAL on every run — its own comment in
    // endOfDayLog.ts says "this runs on every foreground resync", and it did.
    // It depends on the week's Isha times and one setting; when those are the
    // same, the seven reminders it would write are the seven already there.
    const eodPrint = dayTzFingerprint(
      new Date(),
      String(settings.endOfDayLogReminderEnabled),
      state.baseDate.getTime(),
    );
    if (shouldResync(EOD_RESYNC_KEY, eodPrint)) {
      rescheduleEndOfDayLogReminders({
        enabled: settings.endOfDayLogReminderEnabled,
        week: view.table.week,
        baseDate: state.baseDate,
      })
        .then(() => markResynced(EOD_RESYNC_KEY, eodPrint))
        .catch(e => console.warn('rescheduleEndOfDayLogReminders:', e));
    }

    // The adhkār reminders, from the same week and the same anchor.
    //
    // They belong here rather than on the Duas tab for the reason the
    // end-of-day prompt does: this is the one place in the app holding
    // real prayer times for future days, tied to the day they were
    // fetched for. A reminder whose whole definition is "after Fajr,
    // before sunrise" cannot be scheduled anywhere that does not know
    // when Fajr is.
    const duaPrint = dayTzFingerprint(
      new Date(),
      `${settings.morningDuaReminderEnabled}:${settings.eveningDuaReminderEnabled}`,
      state.baseDate.getTime(),
    );
    if (shouldResync(DUA_RESYNC_KEY, duaPrint)) {
      rescheduleDuaReminders({
        morning: settings.morningDuaReminderEnabled,
        evening: settings.eveningDuaReminderEnabled,
        week: view.table.week,
        baseDate: state.baseDate,
      })
        .then(() => markResynced(DUA_RESYNC_KEY, duaPrint))
        .catch(e => console.warn('rescheduleDuaReminders:', e));
    }
  }, [
    hydrated,
    settings.notificationsEnabled,
    settings.prePrayerReminderMinutes,
    settings.notificationSound,
    settings.adhanUsesAlarmStream,
    clockHour12,
    settings.malikiSecondTimesEnabled,
    settings.malikiSecondTimeAlerts,
    settings.malikiSecondTimeAlertMinutes,
    settings.malikiSecondTimeEndAlerts,
    settings.prayerAlertModes,
    settings.journalNotificationActionsEnabled,
    settings.endOfDayLogReminderEnabled,
    settings.morningDuaReminderEnabled,
    settings.eveningDuaReminderEnabled,
    state,
    view,
  ]);

  /**
   * What the widget and Live Activity call this place.
   *
   * The reverse-geocoded city comes FIRST. It used to be absent entirely, so
   * every user on automatic location had `59.3293°, 18.0686°` sitting on
   * their home screen — coordinates to four decimal places, which is about
   * eleven metres, readable by anyone who glances at the phone. The app's own
   * header has said "Stockholm" the whole time; it just never told the widget.
   *
   * Coordinates remain the last resort rather than being dropped: before
   * geocoding resolves, a widget that says where it thinks you are is more
   * useful than one that says nothing, and a wrong city is worse than a
   * blunt number.
   */
  const locationLabel = useMemo(() => {
    if (settings.locationMode === 'manual' && settings.manualLocationLabel) {
      return settings.manualLocationLabel;
    }
    if (state.phase === 'ready') {
      if (state.cityName) return state.cityName;
      return `${state.latitude.toFixed(4)}°, ${state.longitude.toFixed(4)}°`;
    }
    return '';
  }, [settings.locationMode, settings.manualLocationLabel, state]);

  useFocusEffect(
    useCallback(() => {
      if (!hydrated || state.phase !== 'ready' || !view) return;
      // Every focus of the Today tab used to tear down and rewrite the whole
      // ~48-alarm set, plus a `getDisplayedNotifications` round-trip and a
      // cancel-diff. The schedule is a function of the times, the sound and
      // the reminder offset — so when none of those changed, neither did the
      // answer (docs/design/background-power.md).
      const notifPrint = dayTzFingerprint(
        new Date(),
        String(settings.notificationsEnabled),
        settings.prePrayerReminderMinutes,
        settings.notificationSound,
        // In the fingerprint because it changes which CHANNEL every prayer
        // is scheduled against. Left out, flipping the setting would look
        // like "nothing changed" and the alarms would keep pointing at the
        // old channel until something else forced a rewrite.
        String(settings.adhanUsesAlarmStream),
        // Sunrise and the night marks print a clock time in their copy,
        // so a 12/24 change has to rewrite them — same reason as above.
        // The resolved answer rather than the setting, so 'auto' following
        // the device counts as a change too.
        String(clockHour12),
        // The second-time alerts are part of the same schedule, so a
        // change to which of them fire has to rewrite it.
        settings.malikiSecondTimesEnabled
          ? settings.malikiSecondTimeAlerts.join(',')
          : '',
        String(settings.malikiSecondTimeAlertMinutes),
        // The end-of-window alert doubles the set this schedule writes,
        // so turning it on has to rewrite rather than read as no change.
        String(settings.malikiSecondTimeEndAlerts),
        // Which prayers speak, and how. A row cycled from adhan to silent
        // has to take its alarm away, so the schedule is rewritten.
        JSON.stringify(settings.prayerAlertModes),
        state.baseDate.getTime(),
      );
      if (shouldResync(NOTIF_RESYNC_KEY, notifPrint)) {
        syncPrayerNotifications({
          enabled: settings.notificationsEnabled,
          prePrayerReminderMinutes: settings.prePrayerReminderMinutes,
          notificationSound: settings.notificationSound,
          adhanUsesAlarmStream: settings.adhanUsesAlarmStream,
          today: view.table.today,
          tomorrow: view.table.tomorrow,
          baseDate: state.baseDate,
          // The alert week, not the drawn one — with the rows off they
          // differ by exactly the boundaries this schedule is for.
          week: view.alertWeek,
          hour12: clockHour12,
          daruriAlerts: settings.malikiSecondTimesEnabled
            ? settings.malikiSecondTimeAlerts
            : [],
          daruriAlertMinutes: settings.malikiSecondTimeAlertMinutes,
          daruriEndAlerts: settings.malikiSecondTimeEndAlerts,
          alertModes: settings.prayerAlertModes,
        })
          // Marked on success only: a rewrite that threw must not suppress
          // the next attempt, or one bad round leaves the alarms as they are
          // for a whole minute of retries that never run.
          .then(() => markResynced(NOTIF_RESYNC_KEY, notifPrint))
          .catch(e => console.warn('syncPrayerNotifications (focus):', e));
      }
      {
        const t = computeSeasonalTreatment(
          view.table.today,
          view.table.tomorrow,
          new Date(),
        );
        collectWidgetExtras({ timings: view.widget.today, now: new Date() })
          .then(extras =>
            syncPrayerWidget(
              view.widget.today,
              view.widget.tomorrow,
              new Date(),
              locationLabel,
              { lat: state.latitude, lng: state.longitude },
              { jumuah: t.jumuah, ramadan: t.ramadan, eid: t.eid },
              view.widget.week,
              extras,
            ),
          )
          .catch(e => console.warn('syncPrayerWidget (focus):', e));
        // Live activity — task #128. Same cadence as the widget so the
        // notification stays in sync with what's on the home screen.
        syncLiveActivity({
          options: { enabled: settings.liveActivityEnabled },
          today: view.la.today,
          tomorrow: view.la.tomorrow,
          week: view.la.week,
          now: new Date(),
          locationName: locationLabel,
          coords: { lat: state.latitude, lng: state.longitude },
          seasonal: { jumuah: t.jumuah, ramadan: t.ramadan, eid: t.eid },
          // Use the app's actual current accent so the notification matches the
          // app exactly (standard theme → the brand emerald; system colours →
          // the live Material You colour). When systemAccent is set, the native
          // side re-resolves the live system colour on each repost.
          accentHex: palette.accentSolid,
          // Android: follow the live Material You system colour (re-resolved
          // natively on each repost) only when system colours are enabled.
          systemAccent:
            Platform.OS === 'android' &&
            settings.appearance === 'system' &&
            settings.useSystemDynamicTheme,
          // iOS Liquid Glass: let the Live Activity use the dynamic system
          // tint instead of the brand accent so it matches the system theme.
          systemTinted:
            Platform.OS === 'ios' &&
            settings.appearance === 'system' &&
            settings.useSystemDynamicTheme,
          design: settings.liveActivityDesign,
        }).catch(e => console.warn('syncLiveActivity (focus):', e));
      }

      if (settings.notificationsEnabled) {
        notifee
          .getNotificationSettings()
          .then(s => {
            if (Platform.OS === 'android') {
              setExactAlarmDenied(
                s.android.alarm !== AndroidNotificationSetting.ENABLED,
              );
            } else if (Platform.OS === 'ios') {
              setNotifPermDenied(
                s.authorizationStatus !== AuthorizationStatus.AUTHORIZED &&
                  s.authorizationStatus !== AuthorizationStatus.PROVISIONAL,
              );
            }
          })
          .catch(e => console.warn('getNotificationSettings:', e));
      } else {
        setExactAlarmDenied(false);
        setNotifPermDenied(false);
      }
    }, [
      hydrated,
      settings.notificationsEnabled,
      settings.prePrayerReminderMinutes,
      settings.notificationSound,
      settings.adhanUsesAlarmStream,
      clockHour12,
      settings.malikiSecondTimesEnabled,
      settings.malikiSecondTimeAlerts,
      settings.malikiSecondTimeAlertMinutes,
      settings.malikiSecondTimeEndAlerts,
      settings.prayerAlertModes,
      state,
      view,
      locationLabel,
      settings.liveActivityEnabled,
      // `palette.accentSolid` is derived from the accent id and its custom
      // hex, so it moves whenever either of them does — listing all three
      // said the same thing three times, and hid the linter's real
      // complaints about this hook behind an "unnecessary dependency" one.
      palette.accentSolid,
      settings.appearance,
      settings.useSystemDynamicTheme,
      settings.liveActivityDesign,
    ]),
  );

  // Push the widget payload whenever displayable data changes. We don't
  // include `now` in the deps any more — the widget doesn't need a tick-by-tick
  // refresh; it updates when the underlying data does.
  useEffect(() => {
    if (!hydrated || state.phase !== 'ready' || !view) return;
    const seasonal = computeSeasonalTreatment(
      view.table.today,
      view.table.tomorrow,
      new Date(),
    );
    collectWidgetExtras({ timings: view.widget.today, now: new Date() })
      .then(extras =>
        syncPrayerWidget(
          view.widget.today,
          view.widget.tomorrow,
          new Date(),
          locationLabel,
          { lat: state.latitude, lng: state.longitude },
          {
            jumuah: seasonal.jumuah,
            ramadan: seasonal.ramadan,
            eid: seasonal.eid,
          },
          view.widget.week,
          extras,
        ),
      )
      .catch(e => console.warn('syncPrayerWidget (effect):', e));
  }, [
    hydrated,
    state,
    view,
    locationLabel,
    // A prayer logged, a page turned or a bead counted changes what the
    // widget should say without changing any prayer time — so the payload
    // has to be rebuilt on those too, not only on `view`.
    widgetRevision,
    // Every name in the payload is localized — the prayers, the surah, the
    // dhikr. The Live Activity effect has always listed this and the widget
    // effect did not, so a language change left the widget in the old one
    // until something unrelated moved.
    i18n.language,
    // Every time in the payload is drawn in the user's clock format, and
    // the payload is built outside React from a mirror of the answer —
    // so the effect has to know when the answer changed.
    clockHour12,
  ]);

  // Live Activity sync — runs whenever prayer data changes OR whenever the
  // "next prayer" pointer advances (nextInfo change is detected by the 30-second
  // watchdog above). Including nextInfo here is the key fix for the countdown
  // reaching zero without advancing: when Fajr passes and nextInfo flips to
  // Dhuhr, this effect re-fires with `now: new Date()`, so syncLiveActivity
  // recomputes the correct next prayer and pushes updated content.
  useEffect(() => {
    if (!hydrated || state.phase !== 'ready' || !view) return;
    const seasonal = computeSeasonalTreatment(
      view.table.today,
      view.table.tomorrow,
      new Date(),
    );
    syncLiveActivity({
      options: { enabled: settings.liveActivityEnabled },
      today: view.la.today,
      tomorrow: view.la.tomorrow,
      week: view.la.week,
      now: new Date(),
      locationName: locationLabel,
      coords: { lat: state.latitude, lng: state.longitude },
      seasonal: {
        jumuah: seasonal.jumuah,
        ramadan: seasonal.ramadan,
        eid: seasonal.eid,
      },
      // App's actual current accent (see focus-effect note above).
      accentHex: palette.accentSolid,
      // Android: follow the live Material You system colour only when system
      // colours are enabled (re-resolved natively on each repost).
      systemAccent:
        Platform.OS === 'android' &&
        settings.appearance === 'system' &&
        settings.useSystemDynamicTheme,
      // iOS Liquid Glass: dynamic system tint instead of the brand accent.
      systemTinted:
        Platform.OS === 'ios' &&
        settings.appearance === 'system' &&
        settings.useSystemDynamicTheme,
      design: settings.liveActivityDesign,
    }).catch(e => console.warn('syncLiveActivity (effect):', e));
  }, [
    hydrated,
    state,
    view,
    // nextInfo is the computed "which prayer is next right now" value.
    // The 30-second watchdog updates it whenever a prayer passes, triggering
    // this effect to re-sync the Live Activity with the new next prayer.
    nextInfo,
    locationLabel,
    settings.liveActivityEnabled,
    palette.accentSolid,
    settings.appAccentId,
    settings.appAccentCustomHex,
    settings.appearance,
    settings.useSystemDynamicTheme,
    settings.liveActivityDesign,
    // Re-push the Live Activity the instant the user changes its options
    // (HomeScreen stays mounted, so this fires even from the Settings screen).
    settings.liveActivityLockButton,
    // Re-push when the app language changes so the notification's localised
    // labels (In/At, mute toggle, Hijri month) update. Using i18n.language
    // (not settings.language) guarantees i18n has already switched before we
    // rebuild the payload via i18n.t.
    i18n.language,
    // Same reason as the widget effect: the card's times follow the clock
    // format, and the format can change without any setting changing.
    clockHour12,
  ]);

  // Persist last-fetched coords so MonthScreen and offline use can fall back to
  // them, plus the reverse-geocoded city name so the location chip can name the
  // automatic location (and keep naming it across restarts).
  const readyLat = state.phase === 'ready' ? state.latitude : undefined;
  const readyLng = state.phase === 'ready' ? state.longitude : undefined;
  const readyCity = state.phase === 'ready' ? state.cityName : undefined;
  useEffect(() => {
    if (readyLat == null || readyLng == null) return;
    const coordsSame =
      settings.lastFetchedLatitude === readyLat &&
      settings.lastFetchedLongitude === readyLng;
    // Only track the auto city name in automatic mode; manual mode uses
    // manualLocationLabel instead.
    const nextCity =
      settings.locationMode === 'automatic' ? readyCity : undefined;
    const citySame = settings.autoLocationLabel === nextCity;
    if (coordsSame && citySame) return;
    const patch: {
      lastFetchedLatitude: number;
      lastFetchedLongitude: number;
      autoLocationLabel?: string;
    } = {
      lastFetchedLatitude: readyLat,
      lastFetchedLongitude: readyLng,
    };
    if (!citySame) patch.autoLocationLabel = nextCity;
    updateSettings(patch);
  }, [
    readyLat,
    readyLng,
    readyCity,
    settings.locationMode,
    settings.lastFetchedLatitude,
    settings.lastFetchedLongitude,
    settings.autoLocationLabel,
    updateSettings,
  ]);

  const coordsForProviderUi = useMemo(
    () => resolveCoordsForProvider(settings, state),
    [settings, state],
  );
  const effectiveProvider = useMemo(
    () =>
      getEffectiveDataProvider(
        settings.dataProviderAuto,
        settings.dataProvider,
        coordsForProviderUi,
      ),
    [settings.dataProviderAuto, settings.dataProvider, coordsForProviderUi],
  );

  const getDayLabel = useCallback(
    (dayOffset: number): string => {
      if (dayOffset === 0) return t('home.today');
      if (dayOffset === 1) return t('home.tomorrow');
      return addDays(new Date(), dayOffset).toLocaleDateString(i18n.language, {
        weekday: 'long',
      });
    },
    [t, i18n.language],
  );
  const getDayDate = useCallback(
    (dayOffset: number): string =>
      addDays(new Date(), dayOffset).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'short',
      }),
    [i18n.language],
  );
  /**
   * Short weekday for a strip chip.
   *
   * Whatever the locale's own "short" form is, and no truncation on top of
   * it: cutting to three characters turned the Arabic week into الس/الأ/الا/
   * الث/الأ/الخ/الج — where الأحد (Sunday) and الأربعاء (Wednesday) both
   * became "الأ". Scripts that do not abbreviate keep their whole word, and
   * the strip scrolls if the week is wider than the card.
   */
  const getDayShort = useCallback(
    (dayOffset: number): string =>
      addDays(new Date(), dayOffset)
        .toLocaleDateString(i18n.language, { weekday: 'short' })
        .replace(/[.,]\s*$/, ''),
    [i18n.language],
  );
  /** Day of month for a strip chip, in the app language's numerals. */
  const getDayNumber = useCallback(
    (dayOffset: number): string =>
      addDays(new Date(), dayOffset).toLocaleDateString(i18n.language, {
        day: 'numeric',
      }),
    [i18n.language],
  );
  const getHijriDate = useCallback(
    (dayOffset: number): string => formatHijriLabel(addDays(new Date(), dayOffset)),
    // i18n.language drives the localised Hijri month name inside the formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language],
  );

  const pickerPalette = useMemo(
    () => ({
      card: palette.card,
      text: palette.text,
      muted: palette.muted,
      border: palette.border,
      bg: palette.bg,
      overlay: palette.overlay,
      flatChrome: palette.flatChrome,
      accent: palette.accent,
      accentBg: palette.accentBg,
      danger: palette.danger,
    }),
    [palette],
  );

  const handleOpenMonth = useCallback(
    () => navigation.navigate('MonthTimes'),
    [navigation],
  );
  /**
   * Undefined on a Mac, where the compass screen is not registered at all
   * — see `RootNavigator`. The chip still renders; it just stops being a
   * button rather than pushing a route that does not exist.
   */
  const handleOpenQibla = useMemo(
    () =>
      isMacCatalyst
        ? undefined
        : () => {
            navigation.navigate('Compass');
          },
    [navigation],
  );

  /**
   * The Qibla bearing for wherever we are, for the hero chip.
   *
   * Null until there is a fix, so the chip shows nothing rather than a
   * confident bearing computed from a placeholder coordinate — 0,0 is in
   * the Atlantic and its Qibla is a real number that would be wrong
   * everywhere.
   */
  const qiblaBearing = useMemo(() => {
    const lat =
      settings.locationMode === 'automatic'
        ? settings.lastFetchedLatitude
        : settings.manualLatitude;
    const lng =
      settings.locationMode === 'automatic'
        ? settings.lastFetchedLongitude
        : settings.manualLongitude;
    if (lat == null || lng == null) return null;
    return qiblaBearingFrom(lat, lng);
  }, [
    settings.locationMode,
    settings.lastFetchedLatitude,
    settings.lastFetchedLongitude,
    settings.manualLatitude,
    settings.manualLongitude,
  ]);
  const handleOpenQuran = useCallback(
    // The Quran is a TAB now, not a pushed page — jump to it rather than
    // stacking a second copy on top of Today (design review 2e).
    () => navigation.navigate('QuranTab' as never),
    [navigation],
  );
  /** Continue reading exactly where the card says — surah, page, ayah. */
  const handleOpenQuranAt = useCallback(
    (surahNumber: number, page?: number, ayah?: number) =>
      navigation.navigate('QuranSurah', {
        surahNumber,
        initialPage: page,
        scrollToAyah: ayah,
      }),
    [navigation],
  );
  const handleOpenLog = useCallback(
    () => navigation.navigate('LogTab' as never),
    [navigation],
  );

  // Data-freshness status for the hero indicator (v2.7.30): when timings
  // last landed from the provider + how many days sit in the on-device
  // cache. Re-checked whenever the fetch state changes (a background
  // refresh completing flips `state`, which re-runs this).
  const [dataStatus, setDataStatus] = useState<{
    lastFetchedAt: Date | null;
    totalDaysCached: number;
  } | null>(null);
  useEffect(() => {
    if (state.phase !== 'ready') return;
    let cancelled = false;
    getCacheStatus({
      provider: effectiveProvider,
      latitude: state.latitude,
      longitude: state.longitude,
      calculationMethod: settings.calculationMethod,
      school: settings.school,
    })
      .then(s => {
        if (cancelled) return;
        setDataStatus({
          lastFetchedAt: s.lastFetchedAt ? new Date(s.lastFetchedAt) : null,
          totalDaysCached: s.totalDaysCached,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    state,
    effectiveProvider,
    settings.calculationMethod,
    settings.school,
  ]);
  const handleOpenProviderPicker = useCallback(
    () => setProviderPickerOpen(true),
    [],
  );
  const handleCloseProviderPicker = useCallback(
    () => setProviderPickerOpen(false),
    [],
  );

  // ── Phase routing: any non-ready phase short-circuits here. ───────────────
  const nonReadyEl = useNonReadyPhaseElement({
    hydrated,
    locationOnboardingComplete: settings.locationOnboardingComplete,
    state,
    retry,
  });
  if (nonReadyEl) return nonReadyEl;
  if (state.phase !== 'ready' || !view) return null; // narrowing for TS

  // ── Ready layout ──────────────────────────────────────────────────────────
  const carouselResetKey = `${state.latitude}-${state.longitude}`;

  return (
    <View style={styles.homeRoot}>
      {/* Mac Catalyst: the app's top bar — wordmark leading, location chip
          trailing — ABOVE the scroll view, not inside it.

          Not the navigation bar, which is what a Mac would normally use: on
          Catalyst it is transparent and sits inside the window's title-bar
          DRAG REGION, where clicks were intermittently swallowed as window
          drags. That is why the chip left the header in the first place.

          Not a row of content either, which is where it went instead. Two
          things went wrong there, both only at some window sizes, which is
          what made them look like ghosts. The dashboard zooms itself with a
          centred `transform: scale`, and a transform does not change layout
          — so past ~1.1x the cards painted straight over the row above them
          and the bar disappeared. And the dashboard's content is CENTRED
          vertically to fill the window, which carried the bar down with it:
          a title bar sitting two thirds of the way down the window
          (reported 2026-08-24, both).

          Above the ScrollView it is chrome: pinned to the top, spanning the
          window rather than the card column, and unaffected by any zoom —
          held clear of the window's own title bar by `macTopBarInset`. */}
      {isMacCatalyst ? (
        <>
          <View style={[styles.macTopBar, { paddingTop: macTopBarInset }]}>
            <MihrabHeaderTitle />
            <HomeHeaderControls />
          </View>
          {/* The playback bar every other screen gets from the navigator's
              layout. Here it has to come AFTER the top bar above, which
              is why the layout copy stands down for this tab on Catalyst
              — see `HeaderPlaybackBar`. */}
          <HeaderPlaybackBar surface={palette.bg} inline />
        </>
      ) : null}
    <ScrollView
      ref={scrollRef}
      {...tabBarScroll}
      style={[styles.scroll, { backgroundColor: palette.bg }]}
      contentContainerStyle={[
        styles.scrollContent,
        // Breathing room under the last card — and NOTHING for the tab
        // bar or the safe area. The bar is in flow, so the scroll view
        // already ends above it, and the bar's own bottom margin already
        // spends `insets.bottom`. Adding it here as well cost ~54pt of
        // dead air at the foot of the page, which on iPad was most of
        // the reason the dashboard overflowed and had to scroll at all.
        { paddingBottom: 24 + tabBarInset },
        // Fill the viewport on the dashboard: when the two columns are
        // shorter than the window, center them vertically instead of
        // leaving the bottom half of a Mac/iPad window empty (§B1).
        isDashboard && styles.scrollContentDash,
      ]}
      contentInsetAdjustmentBehavior="automatic">
      {/* gap must live INSIDE CenteredColumn: the wrapper collapses all
          cards into one child of the scroll container, so the container's
          own gap:12 stopped separating them (2.7.36 regression — the
          carousel dots overlapped the day table and the Quran button). */}
      <CenteredColumn
        maxWidth={isDashboard ? dashCap : undefined}
        style={styles.homeColumn}
        innerStyle={styles.homeColumn}>
      <PermissionBanners
        usingLocalFallback={state.usingLocalFallback ?? false}
        exactAlarmDenied={exactAlarmDenied}
        notifPermDenied={notifPermDenied}
        onRetryFetch={retry}
      />


      {(() => {
        // One card: countdown → day strip → times → month link (2a). The
        // hero and the table were the same data at two sizes, and the day
        // switcher was six invisible dots between them.
        const dayTable = (
          <TodayCard
            week={view.table.week}
            nextInfo={nextInfo}
            resetKey={carouselResetKey}
            getDayLabel={getDayLabel}
            getDayDate={getDayDate}
            getHijriDate={getHijriDate}
            getDayShort={getDayShort}
            getDayNumber={getDayNumber}
            onOpenMonth={handleOpenMonth}
            qiblaBearing={qiblaBearing}
            onOpenQibla={handleOpenQibla}
            dataStatus={dataStatus}
            expanded={isDashboard}
          />
        );
        const ramadanCard = (
          <RamadanCountdownCard today={state.today} tomorrow={state.tomorrow} />
        );
        const quranShortcut = (
          <QuranCard onOpenAt={handleOpenQuranAt} onOpenQuran={handleOpenQuran} />
        );
        const toolsGrid = <TodaySummary onOpenLog={handleOpenLog} />;
        const providerFooter = (
          <ProviderFooter
            effectiveProvider={effectiveProvider}
            calculationMethod={settings.calculationMethod}
            school={settings.school}
            dataProviderAuto={settings.dataProviderAuto}
            locationLabel={locationLabel}
            backgroundRefreshing={state.backgroundRefreshing ?? false}
            onPress={handleOpenProviderPicker}
          />
        );
        const practiceCard = settings.showPracticeOnHome ? (
          <ErrorBoundary label="PracticeCard">
            <PracticeCard />
          </ErrorBoundary>
        ) : null;
        const statsPanel = settings.showDataStats ? (
          <ErrorBoundary label="DataStatsPanel">
            <DataStatsPanel />
          </ErrorBoundary>
        ) : null;

        if (isDashboard) {
          return (
            // transform-scale zoom: layout stays at the capped size (so
            // the carousel paging math is untouched); the rendered
            // result grows around the centered box to fill the window.
            <View
              onLayout={onDashRowLayout}
              style={[
                styles.dashRow,
                dashScale > 1 && {
                  transform: [{ scale: dashScale }],
                  // What the scale paints outside the box — see dashOverflow.
                  marginVertical: dashOverflow,
                },
              ]}>
              {/* The main column carries the day table AND NOTHING ELSE.
                  It is the tallest thing on the screen by a wide margin —
                  hero, day strip, six rows and the month link — and on an
                  11" iPad in landscape it uses essentially the whole
                  window on its own. Anything stacked under it therefore
                  falls off the bottom, which is exactly what happened to
                  the Quran card: the one card on Home you are meant to
                  ACT on was the one card you had to scroll to find
                  (reported 2026-08-02).

                  So the Quran card moves across to the side column, and
                  goes FIRST in it — the side column was half empty, and
                  a shortcut outranks a read-only summary. Home now fits
                  the window on iPad with nothing to scroll to. */}
              <View style={{ width: HOME_MAIN_COL, gap: 12 }}>{dayTable}</View>
              <View style={styles.dashSide}>
                {quranShortcut}
                {toolsGrid}
                {practiceCard}
                {ramadanCard}
                {providerFooter}
                {statsPanel}
              </View>
            </View>
          );
        }
        return (
          <>
            {dayTable}
            {ramadanCard}
            {quranShortcut}
            {toolsGrid}
            {practiceCard}
            {providerFooter}
            {statsPanel}
          </>
        );
      })()}
      </CenteredColumn>

      <ProviderPickerModal
        visible={providerPickerOpen}
        onClose={handleCloseProviderPicker}
        settings={settings}
        updateSettings={updateSettings}
        palette={pickerPalette}
      />

      <FeatureTourModal
        visible={tourVisible}
        onClose={() => setTourVisible(false)}
      />
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Expanded-width dashboard: fixed "today" main column + flexible tools
  // sidebar, so Home fills a wide window and fits without scrolling.
  dashRow: {
    flexDirection: 'row',
    // Stretch (not flex-start): the sidebar's last card can breathe to
    // the main column's height, so the two columns read as one piece.
    alignItems: 'stretch',
    gap: 20,
  },
  dashSide: {
    flex: 1,
    gap: 12,
  },
  homeRoot: { flex: 1 },
  // Mac Catalyst top bar (see the render site). `row` + `space-between`
  // rather than fixed corners, so Arabic and the other right-to-left
  // languages get the mirror of this and not the same arrangement: the
  // wordmark takes the leading edge either way.
  //
  // It spans the WINDOW, not the card column: this is the navigation bar's
  // job, and a bar that stops where the cards stop is a row, not chrome.
  // Padded to the screen's own gutter so the wordmark lines up with the
  // left edge of the cards underneath it at the widths where they meet it.
  macTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: HOME_SCREEN_PADDING,
    // paddingTop is `macTopBarInset`, applied at the render site: it depends
    // on the window's title-bar band, which is not a constant.
    paddingBottom: 6,
    minHeight: 34,
  },
  scroll: { flex: 1 },
  // Inter-card rhythm for BOTH CenteredColumn variants (compact uses the
  // outer `style`, wide uses the capped inner column).
  homeColumn: { gap: 12 },
  scrollContent: {
    padding: HOME_SCREEN_PADDING,
    paddingBottom: 36,
    gap: 12,
  },
  // Dashboard: let the content grow to the viewport and center it
  // vertically when shorter (§B1 — kills the dead bottom half).
  scrollContentDash: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
