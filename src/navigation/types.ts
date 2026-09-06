/**
 * The six tabs (design review 2e). They are the app; the stack below is
 * everything pushed on top of them.
 */
export type MainTabParamList = {
  TodayTab: undefined;
  QuranTab: undefined;
  TasbihTab: undefined;
  DuasTab: undefined;
  LogTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  /** The tab navigator. */
  Home: undefined;
  MonthTimes: undefined;
  ShareMonth: { year: number; month: number };
  Compass: undefined;
  QuranSurah: {
    surahNumber: number;
    /** Mushaf mode: open at this exact page (Juz/Page/Bookmark deep links). */
    initialPage?: number;
    /** Translation mode: scroll to this ayah (search / bookmark deep links). */
    scrollToAyah?: number;
    /**
     * Start reciting from this ayah on arrival — issue #25.
     *
     * An ayah rather than a flag, because the two params above are a
     * reader-mode fork and this is not: the muṣḥaf is opened by page and
     * the translation reader by ayah, but recitation always begins at an
     * ayah whichever of them is on screen. One param answers for both,
     * and it carries its own position rather than depending on which
     * fork happened to be taken.
     *
     * Only the widget sends it. Opening the reader from inside the app
     * leaves it undefined, and silence stays the default everywhere it
     * already was.
     */
    playFromAyah?: number;
  };
  /** Manage downloads: mushaf pages, recitation audio, tafsir cache. */
  QuranDownloads: undefined;
  /**
   * Tilāwah: the recitation as a player, not as part of the reader.
   *
   * On the root stack rather than inside the Quran tab for the same
   * reason the settings subpages are — the platform header, the back
   * control beside the title, and the swipe-back gesture come free there
   * and would have to be drawn by hand in a nested navigator.
   */
  QuranListen: undefined;
  Onboarding: undefined;
  Backup: undefined;
  Sync: undefined;
  Fasting: undefined;
  /**
   * The settings subpages — one destination per section, pushed from the
   * Settings index.
   *
   * Routes on the ROOT stack rather than a nested stack inside the tab,
   * because that is what gives them the platform header: a real title
   * with the system's own back control beside it, the swipe-back gesture
   * on iOS, and the predictive-back animation on Android. A nested
   * navigator would have meant drawing all of that by hand.
   */
  SettingsAppearance: undefined;
  SettingsPrayerTimes: undefined;
  /** `highlight` flashes the saved-locations card after a deep link from Home. */
  SettingsLocation: { highlight?: 'savedLocations' } | undefined;
  SettingsNotifications: undefined;
  SettingsWidgets: undefined;
  SettingsQuran: undefined;
  SettingsAbout: undefined;
  /**
   * Pages nested under a section rather than under the index. They are
   * on the same stack — only the row that opens them differs — so they
   * are declared here beside their parents.
   */
  SettingsExtraTimes: undefined;
  SettingsDailyReminders: undefined;
  SettingsAttributions: undefined;
};
