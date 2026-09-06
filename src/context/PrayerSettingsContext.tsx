import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import i18n from '../i18n';
import { setActiveClockFormat } from '../utils/activeClock';
import { loadSettings, saveSettings } from '../settings/storage';
import {
  DEFAULT_SETTINGS,
  type PrayerAppSettings,
} from '../settings/types';

/**
 * PrayerSettingsContext + domain-slice contexts — task #11.
 *
 * The persistence layer (`src/settings/storage.ts`) stores one merged blob
 * under `prayerapp.settings.v1`. That doesn't change. What changes is the
 * React surface: instead of a single fat context that re-renders every
 * subscriber when ANY field changes, we expose five domain-narrow contexts
 * stacked under the original. Each one's value object only changes identity
 * when its specific slice fields change, so consumers that subscribe via the
 * narrow hooks re-render only on the slice they care about.
 *
 * Migration plan:
 *   • The legacy `usePrayerSettings()` is preserved as a facade so existing
 *     consumers keep working.
 *   • Settings cards that touch a single domain migrate to the narrow hooks
 *     below. Cross-cutting consumers (HomeScreen, DataSourceCard,
 *     CalculationCard) can keep `usePrayerSettings()` until they're ready to
 *     subscribe to multiple narrow hooks individually.
 *   • Once every consumer is on a narrow hook, the legacy facade can be
 *     deleted. (Not in this task.)
 *
 * Storage shape is UNCHANGED. Existing user data loads via
 * `loadSettings()` exactly as before — the regression test
 * `__tests__/settingsContext.slices.test.ts` confirms this.
 */

// ── Slice types ───────────────────────────────────────────────────────────

export type AppearanceSlice = Pick<
  PrayerAppSettings,
  | 'appearance'
  | 'useSystemDynamicTheme'
  | 'pureBlackDark'
  | 'language'
  | 'appAccentId'
  | 'appAccentCustomHex'
  // Where a clock time is drawn 12- or 24-hour. It rides with `language`
  // for the same reason: it decides how a rendered string reads, and the
  // screens that care about one care about the other.
  | 'clockFormat'
  // Not a colour, but it is the "what Home looks like" switch and it is
  // rendered by AppearanceCard, so it rides in this slice rather than
  // making the card subscribe to a second one.
  | 'showPracticeOnHome'
>;

export type LocationSlice = Pick<
  PrayerAppSettings,
  | 'locationMode'
  | 'manualLatitude'
  | 'manualLongitude'
  | 'manualLocationLabel'
  | 'lastFetchedLatitude'
  | 'lastFetchedLongitude'
  | 'autoLocationLabel'
  | 'locationOnboardingComplete'
  | 'locationPresets'
  | 'activeLocationPresetId'
>;

export type NotificationsSlice = Pick<
  PrayerAppSettings,
  | 'notificationsEnabled'
  | 'prePrayerReminderMinutes'
  | 'notificationSound'
  | 'adhanUsesAlarmStream'
  | 'sunriseEnabled'
  | 'islamicMidnightEnabled'
  | 'lastThirdEnabled'
  | 'firstThirdEnabled'
  | 'malikiSecondTimesEnabled'
  | 'endOfDayLogReminderEnabled'
  | 'morningDuaReminderEnabled'
  | 'eveningDuaReminderEnabled'
  | 'ayahOfDayEnabled'
  | 'ayahOfDayHour'
  | 'ayahOfDayMinute'
  | 'khatmahReminderEnabled'
  | 'khatmahReminderHour'
  | 'khatmahReminderMinute'
>;

export type DataSourceSlice = Pick<
  PrayerAppSettings,
  'dataProvider' | 'dataProviderAuto' | 'calculationMethod' | 'school'
>;

export type WidgetSlice = Pick<
  PrayerAppSettings,
  | 'androidWidgetBackgroundOpacity'
  | 'widgetHighlightId'
  | 'widgetHighlightCustomHex'
>;

export type LiveActivitySlice = Pick<
  PrayerAppSettings,
  | 'liveActivityEnabled'
  | 'liveActivityCompactMode'
  | 'liveActivityShowSunrise'
  | 'liveActivityShowHijri'
  | 'liveActivityShowLocation'
  | 'liveActivityDesign'
  | 'liveActivityLockButton'
>;

type SliceCtxValue<S> = {
  slice: S;
  /** Partial update against this slice only. */
  update: (patch: Partial<S>) => void;
  hydrated: boolean;
};

// ── Contexts ──────────────────────────────────────────────────────────────

type Ctx = {
  settings: PrayerAppSettings;
  hydrated: boolean;
  updateSettings: (patch: Partial<PrayerAppSettings>) => void;
};

const PrayerSettingsContext = createContext<Ctx | null>(null);
const AppearanceContext = createContext<SliceCtxValue<AppearanceSlice> | null>(null);
const LocationContext = createContext<SliceCtxValue<LocationSlice> | null>(null);
const NotificationsContext = createContext<SliceCtxValue<NotificationsSlice> | null>(null);
const DataSourceContext = createContext<SliceCtxValue<DataSourceSlice> | null>(null);
const WidgetContext = createContext<SliceCtxValue<WidgetSlice> | null>(null);
const LiveActivityContext = createContext<SliceCtxValue<LiveActivitySlice> | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────

export function PrayerSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] =
    useState<PrayerAppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    loadSettings()
      .then(loaded => setSettings(loaded))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void i18n.changeLanguage(settings.language);
  }, [hydrated, settings.language]);

  // The widget and Live Activity payloads are built outside React and
  // cannot subscribe to this context, so the clock preference is mirrored
  // into a module singleton beside `i18n` — see `utils/activeClock.ts`.
  // Set before hydration too: the default is what the first payload of a
  // cold start would be built with anyway.
  useEffect(() => {
    setActiveClockFormat(settings.clockFormat);
  }, [settings.clockFormat]);

  const updateSettings = useCallback((patch: Partial<PrayerAppSettings>) => {
    setSettings(prev => {
      let next = { ...prev, ...patch };
      // When switching location mode, drop the cached GPS coordinates so
      // screens never briefly display times for the old location.
      if (
        patch.locationMode !== undefined &&
        patch.locationMode !== prev.locationMode
      ) {
        next = {
          ...next,
          lastFetchedLatitude: undefined,
          lastFetchedLongitude: undefined,
          autoLocationLabel: undefined,
        };
      }
      saveSettings(next).catch(e => console.error('Failed to save settings', e));
      return next;
    });
  }, []);

  // ── Slice memoisation. Each slice's value object only gets a new identity
  //    when one of ITS fields changes. The consumer subscribed via the narrow
  //    hook below sees a stable value when other slices change → no re-render.

  const appearance = useMemo<AppearanceSlice>(
    () => ({
      appearance: settings.appearance,
      useSystemDynamicTheme: settings.useSystemDynamicTheme,
      pureBlackDark: settings.pureBlackDark,
      language: settings.language,
      clockFormat: settings.clockFormat,
      appAccentId: settings.appAccentId,
      appAccentCustomHex: settings.appAccentCustomHex,
      showPracticeOnHome: settings.showPracticeOnHome,
    }),
    [
      settings.appearance,
      settings.useSystemDynamicTheme,
      settings.pureBlackDark,
      settings.language,
      settings.clockFormat,
      settings.appAccentId,
      settings.appAccentCustomHex,
      settings.showPracticeOnHome,
    ],
  );

  const location = useMemo<LocationSlice>(
    () => ({
      locationMode: settings.locationMode,
      manualLatitude: settings.manualLatitude,
      manualLongitude: settings.manualLongitude,
      manualLocationLabel: settings.manualLocationLabel,
      lastFetchedLatitude: settings.lastFetchedLatitude,
      lastFetchedLongitude: settings.lastFetchedLongitude,
      autoLocationLabel: settings.autoLocationLabel,
      locationOnboardingComplete: settings.locationOnboardingComplete,
      locationPresets: settings.locationPresets,
      activeLocationPresetId: settings.activeLocationPresetId,
    }),
    [
      settings.locationMode,
      settings.manualLatitude,
      settings.manualLongitude,
      settings.manualLocationLabel,
      settings.lastFetchedLatitude,
      settings.lastFetchedLongitude,
      settings.autoLocationLabel,
      settings.locationOnboardingComplete,
      settings.locationPresets,
      settings.activeLocationPresetId,
    ],
  );

  const notifications = useMemo<NotificationsSlice>(
    () => ({
      notificationsEnabled: settings.notificationsEnabled,
      prePrayerReminderMinutes: settings.prePrayerReminderMinutes,
      notificationSound: settings.notificationSound,
      adhanUsesAlarmStream: settings.adhanUsesAlarmStream,
      sunriseEnabled: settings.sunriseEnabled,
      islamicMidnightEnabled: settings.islamicMidnightEnabled,
      lastThirdEnabled: settings.lastThirdEnabled,
      firstThirdEnabled: settings.firstThirdEnabled,
      malikiSecondTimesEnabled: settings.malikiSecondTimesEnabled,
      endOfDayLogReminderEnabled: settings.endOfDayLogReminderEnabled,
      morningDuaReminderEnabled: settings.morningDuaReminderEnabled,
      eveningDuaReminderEnabled: settings.eveningDuaReminderEnabled,
      ayahOfDayEnabled: settings.ayahOfDayEnabled,
      ayahOfDayHour: settings.ayahOfDayHour,
      ayahOfDayMinute: settings.ayahOfDayMinute,
      khatmahReminderEnabled: settings.khatmahReminderEnabled,
      khatmahReminderHour: settings.khatmahReminderHour,
      khatmahReminderMinute: settings.khatmahReminderMinute,
    }),
    [
      settings.notificationsEnabled,
      settings.prePrayerReminderMinutes,
      settings.notificationSound,
      settings.adhanUsesAlarmStream,
      settings.sunriseEnabled,
      settings.islamicMidnightEnabled,
      settings.lastThirdEnabled,
      settings.firstThirdEnabled,
      settings.malikiSecondTimesEnabled,
      settings.endOfDayLogReminderEnabled,
      settings.morningDuaReminderEnabled,
      settings.eveningDuaReminderEnabled,
      settings.ayahOfDayEnabled,
      settings.ayahOfDayHour,
      settings.ayahOfDayMinute,
      settings.khatmahReminderEnabled,
      settings.khatmahReminderHour,
      settings.khatmahReminderMinute,
    ],
  );

  const dataSource = useMemo<DataSourceSlice>(
    () => ({
      dataProvider: settings.dataProvider,
      dataProviderAuto: settings.dataProviderAuto,
      calculationMethod: settings.calculationMethod,
      school: settings.school,
    }),
    [
      settings.dataProvider,
      settings.dataProviderAuto,
      settings.calculationMethod,
      settings.school,
    ],
  );

  const widget = useMemo<WidgetSlice>(
    () => ({
      androidWidgetBackgroundOpacity: settings.androidWidgetBackgroundOpacity,
      widgetHighlightId: settings.widgetHighlightId,
      widgetHighlightCustomHex: settings.widgetHighlightCustomHex,
    }),
    [
      settings.androidWidgetBackgroundOpacity,
      settings.widgetHighlightId,
      settings.widgetHighlightCustomHex,
    ],
  );

  const liveActivity = useMemo<LiveActivitySlice>(
    () => ({
      liveActivityEnabled: settings.liveActivityEnabled,
      liveActivityCompactMode: settings.liveActivityCompactMode,
      liveActivityShowSunrise: settings.liveActivityShowSunrise,
      liveActivityShowHijri: settings.liveActivityShowHijri,
      liveActivityShowLocation: settings.liveActivityShowLocation,
      liveActivityDesign: settings.liveActivityDesign,
      liveActivityLockButton: settings.liveActivityLockButton,
    }),
    [
      settings.liveActivityEnabled,
      settings.liveActivityCompactMode,
      settings.liveActivityShowSunrise,
      settings.liveActivityShowHijri,
      settings.liveActivityShowLocation,
      settings.liveActivityDesign,
      settings.liveActivityLockButton,
    ],
  );

  // The narrow `update` callbacks are stable because `updateSettings` is
  // stable. They simply forward to the root updater.
  const appearanceCtx = useMemo<SliceCtxValue<AppearanceSlice>>(
    () => ({ slice: appearance, update: updateSettings, hydrated }),
    [appearance, updateSettings, hydrated],
  );
  const locationCtx = useMemo<SliceCtxValue<LocationSlice>>(
    () => ({ slice: location, update: updateSettings, hydrated }),
    [location, updateSettings, hydrated],
  );
  const notificationsCtx = useMemo<SliceCtxValue<NotificationsSlice>>(
    () => ({ slice: notifications, update: updateSettings, hydrated }),
    [notifications, updateSettings, hydrated],
  );
  const dataSourceCtx = useMemo<SliceCtxValue<DataSourceSlice>>(
    () => ({ slice: dataSource, update: updateSettings, hydrated }),
    [dataSource, updateSettings, hydrated],
  );
  const widgetCtx = useMemo<SliceCtxValue<WidgetSlice>>(
    () => ({ slice: widget, update: updateSettings, hydrated }),
    [widget, updateSettings, hydrated],
  );
  const liveActivityCtx = useMemo<SliceCtxValue<LiveActivitySlice>>(
    () => ({ slice: liveActivity, update: updateSettings, hydrated }),
    [liveActivity, updateSettings, hydrated],
  );

  const fullValue = useMemo<Ctx>(
    () => ({ settings, hydrated, updateSettings }),
    [settings, hydrated, updateSettings],
  );

  return (
    <PrayerSettingsContext.Provider value={fullValue}>
      <AppearanceContext.Provider value={appearanceCtx}>
        <LocationContext.Provider value={locationCtx}>
          <NotificationsContext.Provider value={notificationsCtx}>
            <DataSourceContext.Provider value={dataSourceCtx}>
              <WidgetContext.Provider value={widgetCtx}>
                <LiveActivityContext.Provider value={liveActivityCtx}>
                  {children}
                </LiveActivityContext.Provider>
              </WidgetContext.Provider>
            </DataSourceContext.Provider>
          </NotificationsContext.Provider>
        </LocationContext.Provider>
      </AppearanceContext.Provider>
    </PrayerSettingsContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────

/** Legacy facade. Returns the full settings object — re-renders on ANY change. */
export function usePrayerSettings(): Ctx {
  const ctx = useContext(PrayerSettingsContext);
  if (!ctx) {
    throw new Error('usePrayerSettings must be used within PrayerSettingsProvider');
  }
  return ctx;
}

function useSliceCtx<S>(
  ctx: React.Context<SliceCtxValue<S> | null>,
  name: string,
): SliceCtxValue<S> {
  const value = useContext(ctx);
  if (!value) {
    throw new Error(`${name} must be used within PrayerSettingsProvider`);
  }
  return value;
}

/** Subscribe only to appearance fields (theme, dynamic colors, OLED, language). */
export function useAppearanceSettings() {
  return useSliceCtx(AppearanceContext, 'useAppearanceSettings');
}

/** Subscribe only to location fields (mode, manual coords, last-fetched, onboarding). */
export function useLocationSettings() {
  return useSliceCtx(LocationContext, 'useLocationSettings');
}

/** Subscribe only to notifications fields (enabled, sound, pre-prayer minutes). */
export function useNotificationsSettings() {
  return useSliceCtx(NotificationsContext, 'useNotificationsSettings');
}

/** Subscribe only to data-source fields (provider, method, madhab). */
export function useDataSourceSettings() {
  return useSliceCtx(DataSourceContext, 'useDataSourceSettings');
}

/** Subscribe only to widget fields (opacity, highlight color). */
export function useWidgetSettings() {
  return useSliceCtx(WidgetContext, 'useWidgetSettings');
}

/** Subscribe only to live-activity fields (enabled flag + display options). */
export function useLiveActivitySettings() {
  return useSliceCtx(LiveActivityContext, 'useLiveActivitySettings');
}
