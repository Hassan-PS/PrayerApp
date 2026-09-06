// hover-ok: list-row / settings-row / sheet pressables. Hover-state
// treatment would visually noise these dense surfaces; the touch
// feedback (pressed opacity / ripple) is the right affordance here.
/**
 * Quran index screen — Quran Reader v2
 * (docs/quran-reader-plan.md, QR-10/11/12/21/22/23).
 *
 * Four tabs: Surah / Juz / Bookmarks, plus search across surah names,
 * Arabic text (diacritic-insensitive) and the active translation.
 * Above the tabs: continue-reading resume card, khatmah progress, and
 * the verse of the day.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  FlatList,
  InteractionManager,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppPalette } from '../hooks/useAppPalette';
import { useBreakpoint } from '../responsive/breakpoints';
import { useAndroidSubScreenBack } from '../navigation/useAndroidSubScreenBack';
import type { RootStackParamList } from '../navigation/types';
import {
  findPageForAyah,
  MUSHAF_PAGES,
  totalPagesForRiwayah,
} from '../quran/pages';
import { hydrateRiwayahData } from '../quran/riwayahData';
import { warmMushafLayout } from '../quran/mushafLayout';
import { RIWAYAT } from '../quran/riwayat';
import { MUSHAF_TOTAL_PAGES } from '../quran/mushafImages';
import { findSurah, loadSurah, SURAHS, type SurahIndex } from '../quran/quran';
import { getAyahTranslation } from '../quran/translations';
import { useActiveEdition } from '../quran/useActiveEdition';
import {
  abandonKhatmah,
  activeKhatmah,
  finishKhatmahPortion,
  hydrateQuranState,
  khatmahAyahsRead,
  khatmahCurrentPage,
  khatmahCurrentPortion,
  khatmahDay,
  khatmahDaysLeft,
  khatmahPages,
  removeBookmark,
  resetKhatmahAll,
  resetKhatmahToday,
  setQuranPrefs,
  startKhatmah,
  stepKhatmahBack,
  toggleStar,
  useQuranState,
  BOOKMARK_COLORS,
  KHATMAH_COLOR,
  KHATMAH_EXTRA_COLOR,
  KHATMAH_TOTAL_AYAHS,
} from '../quran/quranState';
import { loadTafsir, resolveTafsirEdition } from '../quran/tafsir';
import {
  CompanionTextSheet,
  useCompanionChoice,
} from '../quran/CompanionTextControls';
import { searchQuran, type QuranSearchResult } from '../quran/search';
import {
  formatDayWhen,
  khatmahDayWhen,
} from '../quran/khatmahDayWhen';
import { useVerseOfTheDay } from '../quran/useVerseOfTheDay';
import { SyncHint } from './sync/SyncHint';
import { cardEdgeStyle } from '../theme/chrome';
import { arabicTextStyle } from '../theme/typography';
import { useTabBarInset } from '../navigation/tabBarInset';
import { useTabBarScroll } from '../navigation/tabBarVisibility';

type Tab = 'surah' | 'juz' | 'bookmarks';

/**
 * The surahs with a standing appointment — issue #23.
 *
 * Al-Kahf on Friday and Al-Mulk before sleep, both named in well-known
 * ḥadīth, are the two people open on a schedule rather than look up.
 * Deliberately just the two: a shortcut row grows into a second list the
 * moment it tries to be a favourites feature, and this one is meant to
 * cost nothing to skip.
 */
const OFTEN_READ = [18, 67] as const;

type JuzRow = { juz: number; page: number; startSurah: SurahIndex | undefined };

export function QuranScreen() {
  const quranWide = useBreakpoint() !== 'compact';
  const listCap = quranWide ? styles.listWide : null;
  const { t, i18n } = useTranslation();
  const { palette } = useAppPalette();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  useAndroidSubScreenBack();
  /**
   * Pressing the Quran tab while already on it returns to the top — the
   * same rule as Today, the Log, Duas and Settings, and the one this
   * screen most needs: the surah list is 114 rows and the juz list 30, so
   * "back to the top" was otherwise a long swipe with no shortcut.
   *
   * ONE ref for all three lists. The tab renders exactly one of them at a
   * time, so at any moment this holds whichever is mounted; React detaches
   * the outgoing list before it attaches the incoming one, so a switch
   * never leaves the ref pointing at a list that is gone.
   */
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);
  const isArabic = i18n.language === 'ar';
  const quran = useQuranState();
  // What is playing is no longer this screen's business: the bar under
  // the title names it and opens both the player and the reader, on
  // every screen. The card that used to do that here sat forty points
  // under the bar saying the same surah and ayah.
  /**
   * Is there a second muṣḥaf to offer at all?
   *
   * The TABLE, not what this device has installed — the link's job is to
   * lead someone to the screen where they can get one, so it has to be
   * there before they have it. It disappears only in a build that knows
   * one recitation, which is a build with nothing to link to.
   */
  const riwayahOffered = RIWAYAT.some(r => r.render === 'unicode' && r.source);
  const edition = useActiveEdition();

  useEffect(() => {
    void hydrateQuranState();
    void hydrateRiwayahData();
  }, []);

  // Whoever is on this tab is one tap from the reader. Its page-layout
  // data — the largest file in the app — comes in now, once the list has
  // settled, instead of during the push transition of the surah they tap.
  const riwayahForWarm = quran.prefs.riwayah;
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() =>
      warmMushafLayout(riwayahForWarm),
    );
    return () => task.cancel();
  }, [riwayahForWarm]);

  const [tab, setTab] = useState<Tab>('surah');
  const [khatmahMenuVisible, setKhatmahMenuVisible] = useState(false);
  // Custom khatmah length (v2.7.31) — the 30/60/90 presets plus a
  // free-form day count entered in a small modal.
  const [customDaysVisible, setCustomDaysVisible] = useState(false);
  const [customDaysText, setCustomDaysText] = useState('');
  // Blank means "from the opening", which is what most khatmahs are.
  const [customFromText, setCustomFromText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuranSearchResult[] | null>(null);
  // Go-to-page (v2.8.5) — a page number typed here opens the mushaf there.
  const tabBarInset = useTabBarInset();
  // The bar gets out of the way while reading — see tabBarVisibility.ts.
  const tabBarScroll = useTabBarScroll();
  const [pageJumpVisible, setPageJumpVisible] = useState(false);
  const [pageJumpText, setPageJumpText] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced full-text search (QR-22).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchQuran(q, edition, 50).then(setResults);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, edition]);

  // Verse of the day (QR-23). The hook re-reads the date at midnight and on
  // resume, so the card and the daily notification — which now schedules the
  // same date-seeded verse — never show different ayahs.
  const votdRef = useVerseOfTheDay();
  const [votdArabic, setVotdArabic] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadSurah(votdRef.surah).then(loaded => {
      if (cancelled || !loaded) return;
      setVotdArabic(loaded.arabic[votdRef.ayah - 1] ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [votdRef]);
  // Fetched, not read: the editions live on disk now rather than in the
  // JS bundle. Empty for the first frame, which the card already handles
  // — it falls back to the reference alone.
  const [votdTranslation, setVotdTranslation] = useState('');
  useEffect(() => {
    let cancelled = false;
    getAyahTranslation(edition, votdRef.surah, votdRef.ayah)
      .then(text => {
        if (!cancelled) setVotdTranslation(text);
      })
      .catch(() => {
        if (!cancelled) setVotdTranslation('');
      });
    return () => {
      cancelled = true;
    };
  }, [edition, votdRef]);
  const votdSurah = findSurah(votdRef.surah);
  // Second row of the card follows the app-wide companion mode (v2.7.40) —
  // the toggle here IS the global switch, and the edition caption below
  // opens the shared companion-text sheet.
  const votdMode = quran.prefs.companionMode;
  const companionChoice = useCompanionChoice();
  const [companionSheetVisible, setCompanionSheetVisible] = useState(false);
  const [votdTafsir, setVotdTafsir] = useState<string | null>(null);
  // Tafsir can be long — show a few lines by default with a "Show more" expand.
  const [votdExpanded, setVotdExpanded] = useState(false);
  /**
   * Is the verse-of-the-day card open, and is the search field showing?
   *
   * The first is a preference, because the answer should survive leaving
   * the tab — someone who opened the card wants it open tomorrow too. The
   * second is not: a search is a thing you are doing right now, and coming
   * back to the tab a day later to find a stale query in a field you
   * forgot about is worse than one tap.
   */
  const votdOpen = quran.prefs.verseOfDayOpen;
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (votdMode !== 'tafsir') return;
    let cancelled = false;
    // The user's chosen tafsir edition — not the locale default (v2.7.40).
    const ed = resolveTafsirEdition(
      quran.prefs.tafsirEditionId,
      (i18n.language || 'en').slice(0, 2),
    );
    if (!ed) return;
    setVotdTafsir(null);
    void loadTafsir(ed.id, votdRef.surah, votdRef.ayah).then(text => {
      if (!cancelled) setVotdTafsir(text);
    });
    return () => {
      cancelled = true;
    };
  }, [votdMode, votdRef, i18n.language, quran.prefs.tafsirEditionId]);

  const openSurah = (surahNumber: number, scrollToAyah?: number, page?: number) => {
    navigation.navigate('QuranSurah', {
      surahNumber,
      scrollToAyah,
      initialPage: page,
    });
  };

  /**
   * Open the mushaf at a typed page. The reader is addressed by surah, so
   * the page has to name the surah it starts inside — otherwise the header
   * and the khatmah bookkeeping would be talking about a different place
   * than the page on screen.
   */
  const goToPage = (text: string) => {
    const n = Number(text.trim());
    if (!Number.isFinite(n)) return;
    const page = Math.max(1, Math.min(MUSHAF_TOTAL_PAGES, Math.round(n)));
    const surah = MUSHAF_PAGES.find(p => p.page === page)?.start.surah ?? 1;
    setPageJumpVisible(false);
    openSurah(surah, undefined, page);
  };

  // ── Surah tab data (name filter applies instantly) ──────────────────
  const filteredSurahs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SURAHS;
    return SURAHS.filter(
      s =>
        s.romanized.toLowerCase().includes(q) ||
        s.english.toLowerCase().includes(q) ||
        s.arabic.includes(query.trim()) ||
        String(s.number) === q,
    );
  }, [query]);

  // ── Juz tab data ────────────────────────────────────────────────────
  const juzRows: JuzRow[] = useMemo(() => {
    const rows: JuzRow[] = [];
    for (let j = 1; j <= 30; j++) {
      const firstPage = MUSHAF_PAGES.find(p => p.juz === j);
      if (!firstPage) continue;
      rows.push({
        juz: j,
        page: firstPage.page,
        startSurah: findSurah(firstPage.start.surah),
      });
    }
    return rows;
  }, []);

  // ── Header (cards + tabs + search) ──────────────────────────────────
  // Bar widths. Clamped because a plan synced from another device can
  // claim more read than the book holds, and a negative width crashes.
  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
  const plan = activeKhatmah(quran);
  // The day's portion, how much of it is read, and anything read past it.
  const day = plan ? khatmahDay(plan) : null;
  // And the same thing in pages, of the muṣḥaf this reader is in — see
  // `khatmahPages`. A page is the unit a reader plans in; an ayah count
  // is a number nobody can picture.
  const pages = plan ? khatmahPages(plan, quran.prefs.riwayah) : null;
  const daysLeft = plan ? khatmahDaysLeft(plan) : 0;
  const readAyahs = plan ? khatmahAyahsRead(plan) : 0;

  /**
   * Start the plan the sheet describes.
   *
   * A blank or unusable page means "from the opening" rather than an
   * error: the field is an addition to the sheet, not a hurdle in front
   * of it, and a khatmah nobody could start because they typed the wrong
   * thing in an optional box is worse than one that starts at page one.
   */
  const startCustomKhatmah = useCallback(() => {
    const n = Number(customDaysText);
    if (!Number.isFinite(n) || n < 1) return;
    const total = totalPagesForRiwayah(quran.prefs.riwayah);
    const raw = Number(customFromText);
    const from =
      customFromText.trim() !== '' && Number.isFinite(raw) && raw >= 2
        ? { page: Math.min(total, Math.round(raw)), riwayah: quran.prefs.riwayah }
        : undefined;
    // A khatmah can't be shorter than a day per page-set beyond the
    // mushaf itself — clamp to 1..604 days.
    startKhatmah(Math.min(604, Math.round(n)), from);
    setCustomDaysVisible(false);
  }, [customDaysText, customFromText, quran.prefs.riwayah]);

  /**
   * An honest scroll indicator — v2.14.5.
   *
   * Without `getItemLayout` a virtualised list can only report the height
   * of what it has actually measured, and it says so: the tail spacer is
   * capped at the highest measured frame. So the content starts out
   * looking about a dozen rows long, the indicator is drawn huge, and it
   * shrinks all the way down the surah list as the real height arrives —
   * which means its POSITION was lying too, from the top, where it
   * matters most.
   *
   * Both numbers are measured rather than assumed, because both move
   * with the user's font-size setting: the header once (it holds the
   * search box, the tabs and the continue-reading card), and the first
   * row once. Until both have arrived `getItemLayout` is undefined and
   * the list behaves exactly as it did before.
   *
   * The rows are separated by the content container's `gap`, and it sits
   * inside its `padding`, so both belong in the offset — hence the two
   * named constants shared with the stylesheet rather than two numbers
   * typed twice.
   */
  const [headerH, setHeaderH] = useState(0);
  const [surahRowH, setSurahRowH] = useState(0);
  const [juzRowH, setJuzRowH] = useState(0);
  const itemLayoutFor = useCallback(
    (rowH: number) =>
      headerH > 0 && rowH > 0
        ? (_: unknown, index: number) => ({
            length: rowH,
            offset:
              LIST_PADDING + headerH + LIST_GAP + index * (rowH + LIST_GAP),
            index,
          })
        : undefined,
    [headerH],
  );

  const header = (
    <View
      style={[styles.headerWrap, listCap]}
      onLayout={e => setHeaderH(e.nativeEvent.layout.height)}>
      {/* Continue reading (QR-10) */}
      {quran.lastRead ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('quran.continueReading', 'Continue reading')}
          onPress={() => {
            const lr = quran.lastRead;
            if (!lr) return;
            openSurah(
              lr.surah,
              lr.mode === 'withTranslation' ? lr.ayah : undefined,
              lr.mode === 'mushaf' ? lr.page : undefined,
            );
          }}
          style={[
            styles.resumeCard,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.resumeLabel, { color: palette.muted }]}>
              {t('quran.continueReading', 'Continue reading')}
            </Text>
            <Text style={[styles.resumeTitle, { color: palette.text }]}>
              {`${findSurah(quran.lastRead.surah)?.romanized ?? ''} · ${t('quran.pageLabel', { page: quran.lastRead.page })}`}
            </Text>
          </View>
          <Text style={{ color: palette.accentSolid, fontSize: 18 }}>→</Text>
        </Pressable>
      ) : null}

      {/* Said where it lands: this card is the user's place in the mushaf,
          and the whole point of sync is that the place follows them. Shows
          only until sync works or they wave it away — see SyncHint. */}
      <SyncHint place="quran" />

      {/* Khatmah (QR-21) */}
      <View
        style={[
          styles.khatmahCard,
          { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
        ]}>
        {plan && pages && day ? (
          <>
            <View style={styles.khatmahTop}>
              <Text style={[styles.khatmahTitle, { color: palette.text }]}>
                {t('quran.khatmah', 'Khatmah')}
              </Text>
              <Text style={[styles.khatmahMeta, { color: palette.muted }]}>
                {t('quran.khatmahDaysLeft', {
                  defaultValue: '{{count}} days left',
                  count: daysLeft,
                })}
              </Text>
            </View>
            {/* The book. The gold at its end is reading done past the
                day's portion — see KHATMAH_EXTRA_COLOR. */}
            <View style={[styles.khatmahTrack, { backgroundColor: palette.accentBg }]}>
              <View
                style={[
                  styles.khatmahFill,
                  {
                    backgroundColor: palette.accentSolid,
                    width: `${pct(readAyahs - day.extra, KHATMAH_TOTAL_AYAHS)}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.khatmahFill,
                  {
                    backgroundColor: KHATMAH_EXTRA_COLOR,
                    width: `${pct(day.extra, KHATMAH_TOTAL_AYAHS)}%`,
                  },
                ]}
              />
            </View>
            {/* Pages, not ayahs. The bar above is drawn from the ayah
                count because that is what progress is KEPT in and what
                every riwayah agrees on; the sentence under it is for a
                person, and a person plans in pages. */}
            <Text style={[styles.khatmahMeta, { color: palette.muted }]}>
              {t('quran.khatmahPageProgress', {
                defaultValue:
                  '{{pages}} pages left · day {{day}} of {{days}}',
                pages: pages.remaining,
                day: day.portion.day,
                days: plan.targetDays,
              })}
            </Text>

            {/* The day. Its own portion, and anything read past it. */}
            <View style={styles.khatmahDayRow}>
              <Text
                style={[
                  styles.khatmahDayLabel,
                  { color: day.done ? KHATMAH_COLOR : palette.text },
                ]}>
                {day.done
                  ? t('quran.khatmahDayDone', {
                      defaultValue: "✓ Today's reading done",
                    })
                  : t('quran.khatmahPagesLeftToday', {
                      defaultValue: '{{count}} pages left today',
                      count: Math.max(1, pages.leftToday),
                    })}
              </Text>
              {pages.extraToday > 0 ? (
                <Text
                  style={[styles.khatmahMeta, { color: KHATMAH_EXTRA_COLOR }]}>
                  {t('quran.khatmahExtraPages', {
                    defaultValue: '+{{count}} pages extra',
                    count: pages.extraToday,
                  })}
                </Text>
              ) : null}
            </View>
            <View style={[styles.khatmahTrack, { backgroundColor: palette.accentBg }]}>
              <View
                style={[
                  styles.khatmahFill,
                  {
                    backgroundColor: day.done
                      ? KHATMAH_COLOR
                      : palette.accentSolid,
                    width: `${pct(day.read, day.length + day.extra)}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.khatmahFill,
                  {
                    backgroundColor: KHATMAH_EXTRA_COLOR,
                    width: `${pct(day.extra, day.length + day.extra)}%`,
                  },
                ]}
              />
            </View>
            {/* Continue + reset (v2.7.28) */}
            <View style={styles.khatmahActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quran.khatmahContinue', 'Continue')}
                onPress={() => {
                  // The reader's own muṣḥaf, like every other number on
                  // this card: `khatmahCurrentPage` defaults to Ḥafṣ, and
                  // taking that default sent a Warsh reader to the page
                  // of that NUMBER in their print, which is not the page
                  // the plan meant.
                  const page = khatmahCurrentPage(plan, quran.prefs.riwayah);
                  const startSurah =
                    plan.position?.surah ??
                    MUSHAF_PAGES.find(p => p.page === page)?.start.surah ??
                    1;
                  openSurah(startSurah, undefined, page);
                }}
                style={[
                  styles.khatmahBtn,
                  { backgroundColor: palette.accentSolid },
                ]}>
                <Text style={styles.khatmahBtnLabel}>
                  {`${t('quran.khatmahContinue', 'Continue')} · ${t('quran.pageLabel', { page: khatmahCurrentPage(plan, quran.prefs.riwayah) })}`}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quran.khatmahReset', 'Reset')}
                onPress={() => setKhatmahMenuVisible(true)}
                style={[styles.khatmahBtnGhost, { borderColor: palette.border }]}>
                <Text style={{ color: palette.muted, fontWeight: '600', fontSize: 13 }}>
                  {t('quran.khatmahReset', 'Reset')}
                </Text>
              </Pressable>
            </View>
            {/*
              The day's two controls.
              "Done" is the fallback for a reader who read past the marked
              ayah without tapping its pill; "Previous day" is its exact
              undo, and the way back into yesterday's portion. Both go
              through the same portion arithmetic the marker does, so
              nothing here can disagree with what the page shows.
            */}
            <View style={styles.khatmahActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quran.khatmahPrevDay', 'Previous day')}
                onPress={stepKhatmahBack}
                disabled={khatmahAyahsRead(plan) === 0}
                style={[
                  styles.khatmahBtnGhost,
                  {
                    borderColor: palette.border,
                    opacity: khatmahAyahsRead(plan) === 0 ? 0.4 : 1,
                  },
                ]}>
                <Text style={{ color: palette.muted, fontWeight: '600', fontSize: 13 }}>
                  {t('quran.khatmahPrevDay', '‹ Previous day')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quran.khatmahMarkDone', {
                  day: khatmahCurrentPortion(plan).day,
                  defaultValue: "Mark day {{day}}'s reading done",
                })}
                onPress={finishKhatmahPortion}
                style={[
                  styles.khatmahBtn,
                  styles.khatmahBtnWide,
                  { backgroundColor: KHATMAH_COLOR },
                ]}>
                <Text style={styles.khatmahBtnLabel}>
                  {day.done
                    ? t('quran.khatmahMarkNext', {
                        day: khatmahCurrentPortion(plan).day,
                        // Which day that is, in calendar terms — a plan's
                        // day number says nothing on its own.
                        when: formatDayWhen(
                          khatmahDayWhen(
                            plan.startedAt,
                            khatmahCurrentPortion(plan).day,
                          ),
                          (key: string, opts: { defaultValue: string }) =>
                            t(key, opts) as string,
                          i18n.language,
                        ),
                        defaultValue: '✓ Finish day {{day}} ({{when}}) too',
                      })
                    : t('quran.khatmahMarkToday', {
                        defaultValue: "✓ Today's reading done",
                      })}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.khatmahTitle, { color: palette.text }]}>
              {t('quran.startKhatmah', 'Start a khatmah')}
            </Text>
            <View style={styles.khatmahChips}>
              {[30, 60, 90].map(days => (
                <Pressable
                  key={days}
                  accessibilityRole="button"
                  accessibilityLabel={t('quran.khatmahDays', {
                    defaultValue: '{{count}} days',
                    count: days,
                  })}
                  onPress={() => startKhatmah(days)}
                  style={[styles.chip, { borderColor: palette.border }]}>
                  <Text style={{ color: palette.accentSolid, fontWeight: '600', fontSize: 13 }}>
                    {t('quran.khatmahDays', {
                      defaultValue: '{{count}} days',
                      count: days,
                    })}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('quran.khatmahCustom', 'Custom…')}
                onPress={() => {
                  setCustomDaysText('');
                  setCustomFromText('');
                  setCustomDaysVisible(true);
                }}
                style={[styles.chip, { borderColor: palette.border }]}>
                <Text style={{ color: palette.accentSolid, fontWeight: '600', fontSize: 13 }}>
                  {t('quran.khatmahCustom', 'Custom…')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* Verse of the day (QR-23).

          CLOSED TO BEGIN WITH, and the reader's choice is remembered.

          It was four to six lines of Arabic and tafsir sitting between
          someone and the surah list they opened the tab for, every single
          time — and a screen you scroll past the same block on every day
          is one whose top you stop reading. Collapsed, the row still
          carries the reference, which is the part that makes anyone want
          to open it. */}
      {votdArabic ? (
        <View
          style={[
            styles.votdCard,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: votdOpen }}
            accessibilityLabel={t('quran.verseOfDay', 'Verse of the day')}
            onPress={() => setQuranPrefs({ verseOfDayOpen: !votdOpen })}
            style={styles.votdHeaderRow}>
            <Text style={[styles.votdLabel, { color: palette.muted }]}>
              {t('quran.verseOfDay', 'Verse of the day')}
            </Text>
            <View style={styles.votdHeaderEnd}>
              <Text style={[styles.votdRef, { color: palette.accentSolid }]}>
                {`${votdSurah?.romanized ?? ''} ${votdRef.surah}:${votdRef.ayah}`}
              </Text>
              <Text style={[styles.votdChevron, { color: palette.muted }]}>
                {votdOpen ? '⌃' : '⌄'}
              </Text>
            </View>
          </Pressable>
          {votdOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('quran.openInReader', 'Open in the reader')}
            onPress={() =>
              openSurah(
                votdRef.surah,
                votdRef.ayah,
                findPageForAyah(votdRef.surah, votdRef.ayah),
              )
            }>
          {/* Row 1: the ayah. Row 2: translation or tafsir. */}
          <Text
            numberOfLines={2}
            style={[styles.votdArabic, { color: palette.text }]}>
            {votdArabic}
          </Text>
          {votdMode === 'tafsir' ? (
            <>
              <Text
                numberOfLines={votdExpanded ? undefined : 4}
                style={[styles.votdTranslation, { color: palette.muted }]}>
                {votdTafsir ??
                  t(
                    'quran.tafsirUnavailable',
                    'Tafsir unavailable — connect to the internet once to download it.',
                  )}
              </Text>
              {votdTafsir && votdTafsir.length > 220 ? (
                // Own Pressable — claims the touch so the card's open-in-reader
                // press doesn't also fire when expanding the tafsir.
                <Pressable
                  hitSlop={6}
                  accessibilityRole="button"
                  onPress={() => setVotdExpanded(v => !v)}>
                  <Text style={[styles.votdShowMore, { color: palette.accentSolid }]}>
                    {votdExpanded
                      ? t('quran.showLess', 'Show less')
                      : t('quran.showMore', 'Show more')}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : votdTranslation ? (
            <Text
              numberOfLines={3}
              style={[styles.votdTranslation, { color: palette.muted }]}>
              {votdTranslation}
            </Text>
          ) : null}
          </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Companion-text control (v2.7.40) — its OWN card so it reads as a
          proper setting, not a footnote of the verse card: the app-wide
          Translation⇄Tafsir mode plus the edition for the active mode
          (tap the edition to open the full picker sheet). */}
      <View
        style={[
          styles.companionCard,
          { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
        ]}>
        <Text style={[styles.votdLabel, { color: palette.muted }]}>
          {t('quran.companionTitle', 'Under each verse')}
        </Text>
        <View style={styles.companionCardRow}>
          <View
            style={[styles.votdCompanionBar, { borderColor: palette.border }]}>
            {(
              [
                ['translation', t('quran.viewToggleTranslation', 'Translation')],
                ['tafsir', t('quran.tafsir', 'Tafsir')],
              ] as Array<['translation' | 'tafsir', string]>
            ).map(([mode, label]) => {
              const selected = votdMode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  hitSlop={6}
                  onPress={() => {
                    setVotdExpanded(false);
                    // THE app-wide companion-mode switch (v2.7.40).
                    // votdMode kept in sync for downgrade safety.
                    setQuranPrefs({ companionMode: mode, votdMode: mode });
                  }}
                  style={[
                    styles.votdToggleSeg,
                    selected && { backgroundColor: palette.accentBg },
                  ]}>
                  <Text
                    style={{
                      color: selected ? palette.accentSolid : palette.muted,
                      fontWeight: '700',
                      fontSize: 12,
                    }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            <View
              style={[styles.votdBarDivider, { backgroundColor: palette.border }]}
            />
            <Pressable
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('quran.companionTitle', 'Under each verse')}
              onPress={() => setCompanionSheetVisible(true)}
              style={styles.votdEditionSeg}>
              <Text
                numberOfLines={1}
                style={[styles.votdEdition, { color: palette.text }]}>
                {companionChoice.editionLabel}
              </Text>
              <Text
                style={{
                  color: palette.accentSolid,
                  fontSize: 12,
                  fontWeight: '700',
                }}>
                {' ▾'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Search (QR-22) + go-to-page (v2.8.5), both BEHIND their glyphs.

          The field used to sit open across the screen whether or not
          anyone was searching — a permanent row of chrome above the list
          it filters. It is one tap now, and the tap puts the cursor in it,
          which is the same number of touches as before for the person who
          actually came to search and one fewer row of furniture for
          everyone else.

          Go-to-page is here for the reason it always was: someone who
          knows they want page 440 had to open a surah first and find the
          jump control inside the reader. The mushaf is paginated; a page
          number is a first-class address and belongs on the screen that
          lists everything else you can address. */}
      {searchOpen ? (
      <View style={styles.searchRow}>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={t('quran.searchPlaceholder', 'Search surahs, ayahs, translation…')}
          placeholderTextColor={String(palette.muted)}
          accessibilityLabel={t('quran.searchPlaceholder', 'Search surahs, ayahs, translation…')}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            styles.searchGrow,
            {
              color: palette.text,
              backgroundColor: palette.card,
              ...cardEdgeStyle(palette),
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close', 'Close')}
          onPress={() => {
            setQuery('');
            setSearchOpen(false);
          }}
          style={[
            styles.pageJumpBtn,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <Text style={[styles.pageJumpGlyph, { color: palette.muted }]}>
            ✕
          </Text>
        </Pressable>
      </View>
      ) : null}

      {/* Tabs (QR-11), with the two glyphs that open a field beside them. */}
      <View style={styles.tabsRow}>
      <View style={[styles.tabs, styles.tabsGrow, { backgroundColor: palette.card, ...cardEdgeStyle(palette) }]}>
        {(
          [
            ['surah', t('quran.tabSurah', 'Surah')],
            ['juz', t('quran.tabJuz', 'Juz')],
            ['bookmarks', t('quran.tabBookmarks', 'Bookmarks')],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => {
          const selected = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(key)}
              style={[
                styles.tab,
                selected && { backgroundColor: palette.accentBg },
              ]}>
              <Text
                style={{
                  color: selected ? palette.accentSolid : palette.muted,
                  fontWeight: '700',
                  fontSize: 13,
                }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
        {searchOpen ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              'quran.searchPlaceholder',
              'Search surahs, ayahs, translation…',
            )}
            onPress={() => setSearchOpen(true)}
            style={[
              styles.pageJumpBtn,
              { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
            ]}>
            <Text
              style={[styles.pageJumpGlyph, { color: palette.accentSolid }]}>
              ⌕
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('quran.jumpToPage', 'Go to page')}
          onPress={() => {
            setPageJumpText('');
            setPageJumpVisible(true);
          }}
          style={[
            styles.pageJumpBtn,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <Text style={[styles.pageJumpGlyph, { color: palette.accentSolid }]}>
            ⌗
          </Text>
        </Pressable>
      </View>

      {/* The two surahs with a place in the week — issue #23.
          
          Al-Kahf on Friday and Al-Mulk before sleep are read on a
          schedule rather than looked up, and reaching them meant
          scrolling 18 and 67 rows or typing a name that has four
          spellings in Latin letters. Only on the surah tab, and only
          while nothing is being searched: they are a shortcut past the
          list, so above a list that is already narrowed they would be in
          the way. */}
      {tab === 'surah' && !query.trim() && results == null ? (
        <View style={styles.oftenRow}>
          <Text style={[styles.oftenLabel, { color: palette.muted }]}>
            {t('quran.oftenRead', { defaultValue: 'Often read' })}
          </Text>
          {OFTEN_READ.map(number => {
            const surah = findSurah(number);
            if (!surah) return null;
            return (
              <Pressable
                key={number}
                accessibilityRole="button"
                accessibilityLabel={`${surah.romanized} — ${surah.english}`}
                onPress={() => openSurah(number)}
                style={[
                  styles.oftenChip,
                  {
                    backgroundColor: palette.card,
                    ...cardEdgeStyle(palette),
                  },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[styles.oftenChipText, { color: palette.text }]}>
                  {isArabic ? surah.arabic : surah.romanized}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Manage downloads (v2.7.28), and beside it the way to a second
          muṣḥaf.
          
          Both land on the same screen. "Manage downloads" is where you go
          when you already know something is on the device; nobody reads it
          as "and here is how to read Warsh", which is a feature that
          otherwise has no door on the screen it belongs to. The riwayah
          link is shown only when there is a riwayah to offer at all — a
          build that knows one recitation should not advertise a picker. */}
      <View style={styles.downloadsRow}>
        {riwayahOffered ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              'downloads.riwayat',
              'Reading traditions',
            )}
            onPress={() => navigation.navigate('QuranDownloads')}
            style={styles.downloadsLink}>
            <Text
              style={{
                color: palette.accentSolid,
                fontSize: 12,
                fontWeight: '700',
              }}>
              {t('downloads.riwayat', 'Reading traditions')} ›
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('downloads.title', 'Manage downloads')}
          onPress={() => navigation.navigate('QuranDownloads')}
          style={styles.downloadsLink}>
          <Text
            style={{ color: palette.muted, fontSize: 12, fontWeight: '600' }}>
            {t('downloads.title', 'Manage downloads')} ›
          </Text>
        </Pressable>
      </View>

      {/* Full-text results */}
      {results != null ? (
        <View style={styles.resultsWrap}>
          <Text style={[styles.resultsLabel, { color: palette.muted }]}>
            {t('quran.searchResults', {
              defaultValue: '{{count}} ayah matches',
              count: results.length,
            })}
          </Text>
          {results.map(r => (
            <Pressable
              key={`${r.surah}:${r.ayah}`}
              accessibilityRole="button"
              accessibilityLabel={`${findSurah(r.surah)?.romanized ?? ''} ${r.surah}:${r.ayah}`}
              onPress={() => openSurah(r.surah, r.ayah)}
              style={[
                styles.resultRow,
                { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
              ]}>
              <Text style={[styles.resultRef, { color: palette.accentSolid }]}>
                {`${findSurah(r.surah)?.romanized ?? ''} ${r.surah}:${r.ayah}`}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.resultArabic, { color: palette.text }]}>
                {r.arabic}
              </Text>
              {r.translation ? (
                <Text
                  numberOfLines={2}
                  style={[styles.resultTranslation, { color: palette.muted }]}>
                  {r.translation}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  // ── Rows per tab ────────────────────────────────────────────────────
  const renderSurahRow = ({
    item,
    index,
  }: {
    item: SurahIndex;
    index: number;
  }) => {
    const startPage = findPageForAyah(item.number, 1);
    return (
      <Pressable
        // One row is every row: the three lines below are clamped, so the
        // measurement taken here holds for all 114.
        onLayout={
          index === 0
            ? e => setSurahRowH(e.nativeEvent.layout.height)
            : undefined
        }
        accessibilityRole="button"
        accessibilityLabel={`${item.number}. ${item.romanized} — ${t('quran.pageLabel', { page: startPage })}`}
        onPress={() => openSurah(item.number)}
        style={[
          styles.row,
          listCap,
          { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
        ]}>
        <View style={[styles.numberBadge, { backgroundColor: palette.accentBg }]}>
          <Text style={[styles.numberText, { color: palette.accent }]}>
            {item.number}
          </Text>
        </View>
        <View style={styles.rowText}>
          {/* One line each, so every row is the same height and the
              measured one above speaks for all of them. Nothing is lost:
              the whole of it is in the row's accessibility label. */}
          {!isArabic ? (
            <Text
              numberOfLines={1}
              style={[styles.romanized, { color: palette.text }]}>
              {item.romanized}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.english, { color: palette.muted }]}>
            {isArabic ? '' : `${item.english} · `}
            {t('quran.ayahCount', { count: item.ayahCount })} ·{' '}
            {item.type === 'meccan' ? t('quran.meccan') : t('quran.medinan')}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.pageHint, { color: palette.muted }]}>
            {t('quran.pageLabel', { page: startPage })}
          </Text>
        </View>
        <Text
          // Multi-word names ("آل عمران") were wrapping at the space on
          // narrow rows and the second word vanished (reported:
          // Aal-i-Imran showing only "آل"). A no-break space makes the
          // name unwrappable, so Yoga measures the full single-line width
          // and the flexible left column shrinks instead. numberOfLines +
          // adjustsFontSizeToFit stay as a graceful-degradation net for
          // extreme font-scale settings.
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[styles.arabic, { color: palette.text }]}>
          {item.arabic.replace(/ /g, '\u00A0')}
        </Text>
      </Pressable>
    );
  };

  const renderJuzRow = ({ item, index }: { item: JuzRow; index: number }) => (
    <Pressable
      onLayout={
        index === 0 ? e => setJuzRowH(e.nativeEvent.layout.height) : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={`${t('quran.juzLabel', { defaultValue: 'Juz {{juz}}', juz: item.juz })} — ${t('quran.pageLabel', { page: item.page })}`}
      onPress={() =>
        item.startSurah && openSurah(item.startSurah.number, undefined, item.page)
      }
      style={[
        styles.row,
        listCap,
        { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
      ]}>
      <View style={[styles.numberBadge, { backgroundColor: palette.accentBg }]}>
        <Text style={[styles.numberText, { color: palette.accent }]}>
          {item.juz}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.romanized, { color: palette.text }]}>
          {t('quran.juzLabel', { defaultValue: 'Juz {{juz}}', juz: item.juz })}
        </Text>
        <Text style={[styles.english, { color: palette.muted }]}>
          {`${item.startSurah?.romanized ?? ''} · ${t('quran.pageLabel', { page: item.page })}`}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={[styles.arabic, { color: palette.text }]}>
        {(item.startSurah?.arabic ?? '').replace(/ /g, '\u00A0')}
      </Text>
    </Pressable>
  );

  const bookmarks = useMemo(
    () =>
      [...quran.bookmarks].sort(
        (a, b) => a.surah - b.surah || a.ayah - b.ayah,
      ),
    [quran.bookmarks],
  );
  const starredRefs = useMemo(
    () =>
      quran.starred
        .map(k => {
          const [s, a] = k.split(':').map(Number);
          return { surah: s, ayah: a };
        })
        .filter(r => Number.isFinite(r.surah) && Number.isFinite(r.ayah))
        .sort((a, b) => a.surah - b.surah || a.ayah - b.ayah),
    [quran.starred],
  );

  const bookmarksEmpty = bookmarks.length === 0 && starredRefs.length === 0;

  const renderBookmarks = () => (
    <View style={[{ gap: 8 }, listCap]}>
      {bookmarksEmpty ? (
        <View
          style={[
            styles.row,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <Text style={{ color: palette.muted, fontSize: 13, flex: 1 }}>
            {t(
              'quran.noBookmarks',
              'No bookmarks yet — tap any ayah while reading to bookmark or star it.',
            )}
          </Text>
        </View>
      ) : null}
      {bookmarks.map(b => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          accessibilityLabel={`${findSurah(b.surah)?.romanized ?? ''} ${b.surah}:${b.ayah}`}
          onPress={() => openSurah(b.surah, b.ayah, b.page)}
          style={[
            styles.row,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <View
            style={[
              styles.bookmarkDot,
              { backgroundColor: BOOKMARK_COLORS[b.color] },
            ]}
          />
          <View style={styles.rowText}>
            <Text style={[styles.romanized, { color: palette.text }]}>
              {`${findSurah(b.surah)?.romanized ?? ''} ${b.surah}:${b.ayah}`}
            </Text>
            <Text style={[styles.english, { color: palette.muted }]}>
              {t('quran.pageLabel', { page: b.page })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('quran.deleteBookmark', 'Delete bookmark')}
            hitSlop={10}
            onPress={() => removeBookmark(b.id)}
            style={styles.deleteBtn}>
            <Text style={[styles.deleteGlyph, { color: palette.muted }]}>
              ✕
            </Text>
          </Pressable>
        </Pressable>
      ))}
      {starredRefs.length > 0 ? (
        <Text style={[styles.starredHeading, { color: palette.muted }]}>
          {t('quran.starred', 'Starred')}
        </Text>
      ) : null}
      {starredRefs.map(r => (
        <Pressable
          key={`${r.surah}:${r.ayah}`}
          accessibilityRole="button"
          accessibilityLabel={`${findSurah(r.surah)?.romanized ?? ''} ${r.surah}:${r.ayah}`}
          onPress={() => openSurah(r.surah, r.ayah)}
          style={[
            styles.row,
            { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
          ]}>
          <Text style={{ color: '#e0a52e', fontSize: 16 }}>★</Text>
          <View style={styles.rowText}>
            <Text style={[styles.romanized, { color: palette.text }]}>
              {`${findSurah(r.surah)?.romanized ?? ''} ${r.surah}:${r.ayah}`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('quran.removeStar', 'Remove star')}
            hitSlop={10}
            onPress={() => toggleStar(r.surah, r.ayah)}
            style={styles.deleteBtn}>
            <Text style={[styles.deleteGlyph, { color: palette.muted }]}>
              ✕
            </Text>
          </Pressable>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      {tab === 'surah' ? (
        <FlatList<SurahIndex>
          ref={listRef}
          {...tabBarScroll}
          data={[...filteredSurahs]}
          keyExtractor={s => String(s.number)}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarInset }]}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={header}
          initialNumToRender={12}
          windowSize={7}
          renderItem={renderSurahRow}
          getItemLayout={itemLayoutFor(surahRowH)}
        />
      ) : tab === 'juz' ? (
        <FlatList<JuzRow>
          ref={listRef}
          {...tabBarScroll}
          data={juzRows}
          keyExtractor={j => String(j.juz)}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarInset }]}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={header}
          renderItem={renderJuzRow}
          getItemLayout={itemLayoutFor(juzRowH)}
        />
      ) : (
        <FlatList
          ref={listRef}
          {...tabBarScroll}
          data={[0]}
          keyExtractor={() => 'bookmarks'}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarInset }]}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={header}
          renderItem={renderBookmarks}
        />
      )}

      {/* Khatmah reset menu (v2.7.28): today / whole plan / delete. */}
      <Modal
        visible={khatmahMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setKhatmahMenuVisible(false)}>
        <Pressable
          style={[styles.menuBackdrop, { backgroundColor: palette.overlay }]}
          accessibilityLabel={t('common.close', 'Close')}
          onPress={() => setKhatmahMenuVisible(false)}
        />
        <View style={[styles.menuCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.menuTitle, { color: palette.text }]}>
            {t('quran.khatmahResetTitle', 'Reset khatmah')}
          </Text>
          {(
            [
              [
                t('quran.khatmahResetToday', "Reset today's reading"),
                t(
                  'quran.khatmahResetTodayHelp',
                  'Rewinds only the pages recorded today.',
                ),
                () => resetKhatmahToday(),
                false,
              ],
              [
                t('quran.khatmahResetAll', 'Restart the khatmah'),
                t(
                  'quran.khatmahResetAllHelp',
                  'Back to where the plan began, with a fresh schedule.',
                ),
                () => resetKhatmahAll(),
                false,
              ],
              [
                t('quran.khatmahDelete', 'Delete the khatmah'),
                t('quran.khatmahDeleteHelp', 'Removes the plan entirely.'),
                () => {
                  const p = activeKhatmah(quran);
                  if (p) abandonKhatmah(p.id);
                },
                true,
              ],
            ] as Array<[string, string, () => void, boolean]>
          ).map(([label, help, action, destructive]) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                setKhatmahMenuVisible(false);
                action();
              }}
              style={[styles.menuRow, { borderColor: palette.border }]}>
              <Text
                style={{
                  color: destructive ? '#d43f3f' : palette.text,
                  fontWeight: '600',
                  fontSize: 15,
                }}>
                {label}
              </Text>
              <Text style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>
                {help}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', 'Cancel')}
            onPress={() => setKhatmahMenuVisible(false)}
            style={styles.menuCancel}>
            <Text style={{ color: palette.accentSolid, fontWeight: '700' }}>
              {t('common.cancel', 'Cancel')}
            </Text>
          </Pressable>
        </View>
      </Modal>

      {/* Custom khatmah length (v2.7.31). */}
      <Modal
        visible={customDaysVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomDaysVisible(false)}>
        <Pressable
          style={[styles.menuBackdrop, { backgroundColor: palette.overlay }]}
          accessibilityLabel={t('common.close', 'Close')}
          onPress={() => setCustomDaysVisible(false)}
        />
        <View style={[styles.menuCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.menuTitle, { color: palette.text }]}>
            {t('quran.khatmahSetUpTitle', 'Start a khatmah')}
          </Text>
          <Text style={[styles.customFieldLabel, { color: palette.muted }]}>
            {t('quran.khatmahLengthTitle', 'Khatmah length (days)')}
          </Text>
          <TextInput
            value={customDaysText}
            onChangeText={setCustomDaysText}
            keyboardType="number-pad"
            autoFocus
            maxLength={3}
            accessibilityLabel={t('quran.khatmahLengthTitle', 'Khatmah length (days)')}
            placeholder="1–604"
            placeholderTextColor={String(palette.muted)}
            style={[
              styles.customDaysInput,
              { color: palette.text, borderColor: palette.border },
            ]}
            onSubmitEditing={startCustomKhatmah}
          />
          {/* Issue #17. A khatmah already under way has a place in it, and
              without somewhere to say so the tracker can only be started
              by someone at page one. Blank is the ordinary case, and the
              placeholder says so rather than making the reader work it
              out. The page is theirs — of the muṣḥaf they are reading —
              which is why the count beside it is `total`. */}
          <Text style={[styles.customFieldLabel, { color: palette.muted }]}>
            {t('quran.khatmahFromPageTitle', 'Already reading? Start at page')}
          </Text>
          <TextInput
            value={customFromText}
            onChangeText={setCustomFromText}
            keyboardType="number-pad"
            maxLength={3}
            accessibilityLabel={t(
              'quran.khatmahFromPageTitle',
              'Already reading? Start at page',
            )}
            placeholder={t('quran.khatmahFromPageHint', {
              defaultValue: 'From the beginning',
            })}
            placeholderTextColor={String(palette.muted)}
            style={[
              styles.customDaysInput,
              { color: palette.text, borderColor: palette.border },
            ]}
            onSubmitEditing={startCustomKhatmah}
          />
          <View style={styles.customDaysRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel', 'Cancel')}
              onPress={() => setCustomDaysVisible(false)}
              style={styles.menuCancel}>
              <Text style={{ color: palette.muted, fontWeight: '600' }}>
                {t('common.cancel', 'Cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('quran.khatmahStartCta', 'Start')}
              onPress={startCustomKhatmah}
              style={styles.menuCancel}>
              <Text style={{ color: palette.accentSolid, fontWeight: '700' }}>
                {t('quran.khatmahStartCta', 'Start')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Go to page (v2.8.5) — same shape as the reader's own jump sheet,
          reached from the index instead of from inside a surah. */}
      <Modal
        visible={pageJumpVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPageJumpVisible(false)}>
        <Pressable
          style={[styles.menuBackdrop, { backgroundColor: palette.overlay }]}
          accessibilityLabel={t('common.close', 'Close')}
          onPress={() => setPageJumpVisible(false)}
        />
        <View style={[styles.menuCard, { backgroundColor: palette.card }]}>
          <Text style={[styles.menuTitle, { color: palette.text }]}>
            {t('quran.jumpToPage', 'Go to page')}
          </Text>
          <TextInput
            value={pageJumpText}
            onChangeText={setPageJumpText}
            keyboardType="number-pad"
            autoFocus
            maxLength={3}
            accessibilityLabel={t('quran.jumpToPage', 'Go to page')}
            placeholder="1–604"
            placeholderTextColor={String(palette.muted)}
            style={[
              styles.customDaysInput,
              { color: palette.text, borderColor: palette.border },
            ]}
            onSubmitEditing={() => goToPage(pageJumpText)}
          />
          <View style={styles.customDaysRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel', 'Cancel')}
              onPress={() => setPageJumpVisible(false)}
              style={styles.menuCancel}>
              <Text style={{ color: palette.muted, fontWeight: '600' }}>
                {t('common.cancel', 'Cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('quran.jumpToPage', 'Go to page')}
              onPress={() => goToPage(pageJumpText)}
              style={styles.menuCancel}>
              <Text style={{ color: palette.accentSolid, fontWeight: '700' }}>
                {t('quran.goCta', 'Go')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* App-wide companion-text picker (v2.7.40): mode + edition. */}
      <CompanionTextSheet
        visible={companionSheetVisible}
        onClose={() => setCompanionSheetVisible(false)}
      />
    </View>
  );
}

/**
 * The content container's own padding and the gap between its children.
 *
 * Named because `getItemLayout` has to add both to every offset — the
 * rows sit inside the padding and are separated by the gap — and a
 * stylesheet and an offset formula disagreeing about them is a scroll
 * indicator that lies by exactly one gap per row.
 */
const LIST_PADDING = 16;
const LIST_GAP = 8;

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: LIST_PADDING, gap: LIST_GAP },
  // Center + cap the index column on iPad/Mac so surah rows stay readable.
  // Cap+center applied to the header and to EVERY row — NOT to the
  // FlatList contentContainerStyle. `alignSelf`/`maxWidth` on the content
  // container are ignored/pin to the flow-start edge, which under RTL
  // shoved the whole 720pt column against the RIGHT edge of a wide
  // window and left the other half empty (Mac audit, 2026-07-16).
  listWide: { maxWidth: 720, width: '100%', alignSelf: 'center' as const },
  headerWrap: { gap: 10, marginBottom: 8 },
  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  resumeLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  resumeTitle: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  khatmahCard: { padding: 14, borderRadius: 12, gap: 8 },
  khatmahTop: { flexDirection: 'row', justifyContent: 'space-between' },
  khatmahTitle: { fontSize: 14, fontWeight: '700' },
  khatmahMeta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  // A row, because a track carries TWO fills: the reading itself, and
  // the gold that is reading done past the day's portion.
  khatmahTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  khatmahFill: { height: '100%' },
  khatmahDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  khatmahDayLabel: { fontSize: 13, fontWeight: '700' },
  khatmahChips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  votdCard: { padding: 12, borderRadius: 12, gap: 6 },
  votdLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  votdArabic: {
    fontSize: 18,
    lineHeight: 40,
    textAlign: 'right',
    writingDirection: 'rtl',
    ...arabicTextStyle('quran'),
  },
  votdTranslation: { fontSize: 13, lineHeight: 19 },
  votdShowMore: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  votdRef: { fontSize: 12, fontWeight: '700' },
  /** The reference and the chevron travel together on the trailing edge. */
  votdHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  votdChevron: { fontSize: 15, fontWeight: '700' },
  companionCard: {
    padding: 14,
    borderRadius: 12,
  },
  companionCardRow: {
    marginTop: 8,
  },
  votdEdition: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  votdCompanionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  votdBarDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  votdEditionSeg: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 1,
  },
  votdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  votdToggle: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  votdToggleSeg: { paddingHorizontal: 10, paddingVertical: 4 },
  customDaysInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  customFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
  },
  customDaysRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 6,
  },
  search: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  searchGrow: { flex: 1 },
  pageJumpBtn: {
    width: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageJumpGlyph: { fontSize: 20, fontWeight: '700' },
  /** The three tabs, then the two glyphs that open a field. */
  tabsRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  tabsGrow: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  resultsWrap: { gap: 8 },
  resultsLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  resultRow: { padding: 12, borderRadius: 12, gap: 4 },
  resultRef: { fontSize: 12, fontWeight: '700' },
  resultArabic: {
    fontSize: 16,
    lineHeight: 36,
    textAlign: 'right',
    writingDirection: 'rtl',
    ...arabicTextStyle('quran'),
  },
  resultTranslation: { fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  numberBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowText: { flex: 1 },
  romanized: { fontSize: 16, fontWeight: '600' },
  english: { fontSize: 12, marginTop: 2 },
  pageHint: { fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  // flexShrink: 0 — the name keeps its intrinsic single-line width (made
  // unwrappable via NBSP); the flexible left column yields instead.
  arabic: { fontSize: 22, lineHeight: 42, flexShrink: 0, ...arabicTextStyle('body') },
  bookmarkDot: { width: 14, height: 14, borderRadius: 7 },
  deleteBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  deleteGlyph: { fontSize: 14, fontWeight: '700' },
  khatmahActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  khatmahBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  khatmahBtnLabel: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  khatmahBtnWide: { flex: 2 },
  khatmahBtnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menuCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '25%',
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  menuTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  menuRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  menuCancel: { alignItems: 'center', paddingVertical: 8 },
  downloadsLink: { paddingVertical: 2 },
  oftenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  oftenLabel: { fontSize: 12, fontWeight: '700' },
  oftenChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  oftenChipText: { fontSize: 13, fontWeight: '600' },
  /** Tilāwah leads as a chip; the two plain links trail behind it. */
  downloadsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  tilawahChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginEnd: 'auto',
  },
  starredHeading: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
  },
});
