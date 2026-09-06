/**
 * The surah read with its translation (or tafsir) under each āyah — a
 * virtualized list, one card per āyah (docs/quran-reader-plan.md,
 * QR-1/2/17/20).
 *
 *   • VIRTUALIZED: Al-Baqarah does not mount 286 cards at once (QR-1).
 *   • Arabic renders word-by-word so recitation can highlight the live
 *     word (QR-17); memorization hide/reveal masks Arabic or translation
 *     per āyah (QR-20).
 *   • Translation text loads asynchronously after first paint (QR-2) — the
 *     1–2 MB edition JSON no longer blocks the navigation transition.
 *
 * This and the muṣḥaf were one screen until 2 September, switching on
 * `isMushaf` in a shared header effect, content style and render. They
 * share a route and a toggle; `QuranSurahScreen` is the route now, and this
 * is the translation reader on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { TilawahIcon } from '../../quran/audio/PlaybackIcons';
import { desktopSize } from '../../responsive/desktop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppPalette } from '../../hooks/useAppPalette';
import { loadSurah, type SurahIndex } from '../../quran/quran';
import { getSurahTranslation } from '../../quran/translations';
import { useActiveEdition } from '../../quran/useActiveEdition';
import { loadTafsir, resolveTafsirEdition } from '../../quran/tafsir';
import {
  CompanionTextSheet,
  useCompanionChoice,
} from '../../quran/CompanionTextControls';
import {
  useOverlayDismissGuard,
  useSettledMeasure,
} from '../../quran/mushafReaderCore';
import { findPageForAyah } from '../../quran/pages';
import { surahName } from '../../quran/surahName';
import {
  findBookmark,
  isStarred,
  setLastRead,
  useQuranState,
  BOOKMARK_COLORS,
} from '../../quran/quranState';
import { usePlaybackStatus } from '../../quran/audio/playback';
import { useActiveWordIndex } from '../../quran/audio/useWordTiming';
import { countedWordIndices } from '../../quran/audio/countedWords';
import { AyahActionSheet } from '../../quran/mushaf/AyahActionSheet';
import { MiniPlayer } from '../../quran/audio/MiniPlayer';
import { usePrayerSettings } from '../../context/PrayerSettingsContext';
import type { RootStackParamList } from '../../navigation/types';
import { cardEdgeStyle } from '../../theme/chrome';
import { arabicTextStyle } from '../../theme/typography';

type AyahRow = {
  ayah: number; // 1-based
  arabic: string;
};

type Props = {
  surah: SurahIndex;
  surahNumber: number;
  /** Scroll to this āyah on open (deep links from bookmarks and search). */
  scrollToAyah?: number;
  /** Switch to the muṣḥaf. */
  onToggleMode: () => void;
};

export function TranslationSurahScreen({
  surah,
  surahNumber,
  scrollToAyah,
  onToggleMode,
}: Props) {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language === 'ar';
  const { palette } = useAppPalette();
  const insets = useSafeAreaInsets();
  const { settings } = usePrayerSettings();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const quran = useQuranState();
  const playback = usePlaybackStatus();
  // Header closures read playback via a ref so the nav header doesn't
  // rebuild on every ayah change.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const activeWord = useActiveWordIndex();
  // The window's settled size, so the header row is rebuilt after a Mac
  // resize instead of answering the mouse where it used to be.
  const win = useWindowDimensions();
  const headerW = useSettledMeasure(Math.round(win.width));
  const headerH = useSettledMeasure(Math.round(win.height));
  const edition = useActiveEdition();
  // Current companion choice caption (mode + edition) for the header row.
  const companionChoice = useCompanionChoice();

  // ── Async data: Arabic + translation (QR-2) ─────────────────────────
  const [rows, setRows] = useState<AyahRow[] | null>(null);
  const [translations, setTranslations] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void loadSurah(surahNumber).then(loaded => {
      if (cancelled || !loaded) return;
      setRows(
        loaded.arabic.map((arabic, i) => ({ ayah: i + 1, arabic })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [surahNumber]);

  useEffect(() => {
    let cancelled = false;
    setTranslations(null);
    // Defer the (potentially first-time) 1–2 MB edition read until after
    // the transition/paint. The timeout stays now that the read is off
    // the bundle and onto the disk: it is what keeps the first frame of
    // the screen from waiting on it at all.
    const timer = setTimeout(() => {
      if (cancelled) return;
      getSurahTranslation(edition, surahNumber)
        .then(texts => {
          if (!cancelled) setTranslations(texts);
        })
        .catch(() => {
          if (!cancelled) setTranslations([]);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [edition, surahNumber]);

  // ── Selection / sheets ──────────────────────────────────────────────
  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetScrollAudio, setSheetScrollAudio] = useState(false);
  const [editionPickerVisible, setEditionPickerVisible] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Reset per-surah reveal state when hide mode or surah changes.
    setRevealed(new Set());
  }, [quran.prefs.hideMode, surahNumber]);

  const toggleMushaf = useCallback(() => {
    // The toggle swaps the ENTIRE screen (translation list ⇄ mushaf
    // reader), which would take any open <Modal> down with it while it is
    // still presented — an orphaned activity-window dialog that eats every
    // touch app-wide. Close the sheets first, then switch.
    setSheetVisible(false);
    setEditionPickerVisible(false);
    onToggleMode();
  }, [onToggleMode]);

  // ── Header ──────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      // Only the muṣḥaf rotates; everything else in the app stays portrait.
      orientation: 'portrait',
      // The navigator pads every screen's content by the bottom safe area
      // in the theme background (RootNavigator `contentStyle`); this list
      // is drawn on that background, so the pad is right here.
      contentStyle: { paddingBottom: insets.bottom, backgroundColor: palette.bg },
      // The NAME follows the app language.
      title: surahName(surah),
      headerRight: () => (
        // Wider gaps on the Mac: these are pointer targets on a desktop,
        // not thumb targets on a tablet, and Catalyst has already scaled
        // the whole row down (responsive/desktop.ts).
        <View
          // Keyed on the settled window size, and the size is in this
          // effect's inputs — a native header subview that RN laid out for
          // one window width answers the mouse at that width for ever. See
          // the long note in MushafSurahScreen; this row is the same row.
          key={`chips-${headerW}x${headerH}`}
          style={{
            flexDirection: 'row',
            gap: desktopSize(14),
            alignItems: 'center',
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('quran.playbackSettings', 'Recitation')}
            onPress={() => {
              // Unified sheet (v2.7.28): open the ayah panel scrolled to
              // the recitation controls — everything lives in one place.
              const active = playbackRef.current.active;
              setSelectedAyah(
                active?.surah === surahNumber ? active.ayah : 1,
              );
              setSheetScrollAudio(true);
              setSheetVisible(true);
            }}
            hitSlop={10}
            style={{ paddingHorizontal: 4 }}>
            {/* Drawn, not typed. `♪` is the system font's glyph: its
                size, weight and vertical placement are the platform's,
                and the "gap" after it was a space character. It is the
                same note the player's own controls carry. */}
            <View style={audioMark.row}>
              <TilawahIcon color={String(palette.accentSolid)} size={desktopSize(15)} />
              <Text
                style={{
                  color: palette.accentSolid,
                  fontSize: desktopSize(15),
                  fontWeight: '700',
                }}>
                {t('quran.audioButton', 'Audio')}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('quran.switchToMushaf', 'Switch to mushaf view')}
            onPress={toggleMushaf}
            hitSlop={10}
            style={{ paddingHorizontal: 4 }}>
            <Text
              style={{
                color: palette.accentSolid,
                fontSize: desktopSize(15),
                fontWeight: '700',
              }}>
              {t('quran.viewToggleMushaf', 'Mushaf')}
            </Text>
          </Pressable>
        </View>
      ),
    });
  }, [
    navigation,
    surah,
    surahNumber,
    isArabic,
    palette.accentSolid,
    palette.bg,
    insets.bottom,
    t,
    toggleMushaf,
    headerW,
    headerH,
  ]);

  // Translation mode owns its own two <Modal>s (ayah sheet + companion-text
  // sheet). Same rule as the reader's: they must be dismissed before the
  // screen is popped, never with it — see `useOverlayDismissGuard`.
  const closeSheets = useCallback(() => {
    setSheetVisible(false);
    setEditionPickerVisible(false);
  }, []);
  useOverlayDismissGuard(sheetVisible || editionPickerVisible, closeSheets);

  // ── Last-read for translation mode (QR-10) ──────────────────────────
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item: unknown; isViewable: boolean }> }) => {
      const first = info.viewableItems.find(v => v.isViewable);
      if (!first) return;
      const row = first.item as AyahRow;
      if (typeof row?.ayah !== 'number') return;
      setLastRead({
        surah: surahNumberRef.current,
        ayah: row.ayah,
        page: findPageForAyah(surahNumberRef.current, row.ayah),
        mode: 'withTranslation',
      });
    },
  );
  const surahNumberRef = useRef(surahNumber);
  surahNumberRef.current = surahNumber;

  // ── Auto-scroll to the playing ayah ─────────────────────────────────
  const listRef = useRef<FlatList<AyahRow>>(null);
  const lastAutoScrolled = useRef<number>(0);
  useEffect(() => {
    if (!playback.active || !playback.playing) return;
    if (playback.active.surah !== surahNumber) return;
    const idx = playback.active.ayah - 1;
    if (idx === lastAutoScrolled.current) return;
    lastAutoScrolled.current = idx;
    listRef.current?.scrollToIndex({
      index: idx,
      viewPosition: 0.3,
      animated: true,
    });
  }, [playback.active, playback.playing, surahNumber]);

  // ── Translation mode ────────────────────────────────────────────────
  const hideMode = quran.prefs.hideMode;
  // App-wide companion mode (v2.7.40): translation ⇄ tafsir under each ayah.
  const companionMode = quran.prefs.companionMode;
  const tafsirEdition = resolveTafsirEdition(
    quran.prefs.tafsirEditionId,
    settings.language,
  );

  const renderAyah = ({ item }: { item: AyahRow }) => {
    const { ayah, arabic } = item;
    const starred = isStarred(quran, surahNumber, ayah);
    const bookmark = findBookmark(quran, surahNumber, ayah);
    const isPlayingThis =
      playback.active?.surah === surahNumber &&
      playback.active?.ayah === ayah &&
      playback.playing;
    const wordIdx =
      activeWord &&
      activeWord.surah === surahNumber &&
      activeWord.ayah === ayah
        ? activeWord.wordIndex
        : -1;
    const translation = translations?.[ayah - 1] ?? '';
    const isRevealed = revealed.has(ayah);
    const maskArabic = hideMode === 'arabic' && !isRevealed;
    const maskTranslation = hideMode === 'translation' && !isRevealed;

    const words = arabic.split(' ');
    // The timing counts QPC's words; the text is Tanzil's. Map one onto
    // the other, or the lit word drifts by one past every pause mark and
    // the basmalah lights on every first ayah — see `countedWords.ts`.
    const litIndex =
      wordIdx >= 0
        ? (countedWordIndices(surahNumber, ayah, words)[wordIdx] ?? -1)
        : -1;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quran.ayahA11y', {
          defaultValue: 'Ayah {{ayah}} — tap for actions',
          ayah,
        })}
        onPress={() => {
          if (hideMode !== 'none' && !isRevealed) {
            setRevealed(prev => new Set(prev).add(ayah));
            return;
          }
          setSelectedAyah(ayah);
          setSheetScrollAudio(false);
          setSheetVisible(true);
        }}
        style={[
          styles.ayahCard,
          {
            backgroundColor: isPlayingThis ? palette.accentBg : palette.card,
            ...cardEdgeStyle(palette),
          },
        ]}>
        <View style={styles.ayahMetaRow}>
          {bookmark ? (
            <View
              style={[
                styles.bookmarkBar,
                { backgroundColor: BOOKMARK_COLORS[bookmark.color] },
              ]}
            />
          ) : null}
          {starred ? (
            <Text style={{ color: '#e0a52e', fontSize: 13 }}>★</Text>
          ) : null}
          <Text style={[styles.ayahNumber, { color: palette.accent }]}>
            {ayah}
          </Text>
        </View>
        {maskArabic ? (
          <Text style={[styles.masked, { color: palette.muted }]}>
            {t('quran.tapToReveal', 'Tap to reveal')}
          </Text>
        ) : (
          <Text
            style={[styles.ayahArabic, { color: palette.text }]}
            accessibilityLabel={arabic}>
            {litIndex >= 0
              ? words.map((w, i) => (
                  <Text
                    key={i}
                    style={
                      i === litIndex
                        ? {
                            color: palette.accentSolid,
                            backgroundColor: palette.accentBg,
                          }
                        : undefined
                    }>
                    {w}
                    {i < words.length - 1 ? ' ' : ''}
                  </Text>
                ))
              : arabic}
          </Text>
        )}
        {companionMode === 'tafsir' ? (
          maskTranslation ? (
            <Text style={[styles.masked, { color: palette.muted }]}>
              {t('quran.tapToReveal', 'Tap to reveal')}
            </Text>
          ) : (
            <TafsirRowText
              surah={surahNumber}
              ayah={ayah}
              editionId={tafsirEdition.id}
              rtl={tafsirEdition.rtl}
            />
          )
        ) : translations == null ? (
          <View
            style={[styles.skeleton, { backgroundColor: palette.accentBg }]}
          />
        ) : maskTranslation && translation ? (
          <Text style={[styles.masked, { color: palette.muted }]}>
            {t('quran.tapToReveal', 'Tap to reveal')}
          </Text>
        ) : translation ? (
          <Text style={[styles.ayahTranslation, { color: palette.muted }]}>
            {translation}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const header = (
    <View
      style={[
        styles.header,
        { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
      ]}>
      <Text style={[styles.surahArabic, { color: palette.text }]}>
        {surah.arabic}
      </Text>
      {!isArabic ? (
        <Text style={[styles.surahRomanized, { color: palette.text }]}>
          {surah.romanized}
        </Text>
      ) : null}
      <Text style={[styles.surahMeta, { color: palette.muted }]}>
        {isArabic ? '' : `${surah.english} · `}
        {t('quran.ayahCount', { count: surah.ayahCount })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('quran.companionTitle', 'Under each verse')}
        onPress={() => setEditionPickerVisible(true)}
        style={styles.editionRow}>
        <Text style={[styles.editionLabel, { color: palette.muted }]}>
          {/* Mode + edition, e.g. "Tafsir: Ibn Kathir (abridged)" — the
              app-wide companion choice (v2.7.40). */}
          {`${
            companionChoice.mode === 'tafsir'
              ? t('quran.tafsir', 'Tafsir')
              : t('quran.viewToggleTranslation', 'Translation')
          }: ${companionChoice.editionLabel}`}
        </Text>
        <Text style={[styles.editionHint, { color: palette.accent }]}>
          {t('quran.tapToPick', 'choose')}
        </Text>
      </Pressable>
      {hideMode !== 'none' ? (
        <Text style={[styles.hideHint, { color: palette.accentSolid }]}>
          {t('quran.hideModeActive', {
            defaultValue: 'Memorization mode: {{what}} hidden — tap an ayah to reveal',
            what:
              hideMode === 'arabic'
                ? t('quran.hideArabic', 'Arabic')
                : t('quran.hideTranslation', 'Translation'),
          })}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <FlatList
        ref={listRef}
        data={rows ?? []}
        keyExtractor={r => String(r.ayah)}
        renderItem={renderAyah}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View
            style={[
              styles.comingSoon,
              { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
            ]}>
            <Text style={[styles.comingSoonText, { color: palette.muted }]}>
              {rows == null ? t('quran.loading', 'Loading…') : t('quran.comingSoon')}
            </Text>
          </View>
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={9}
        initialScrollIndex={
          scrollToAyah && rows && scrollToAyah <= rows.length
            ? scrollToAyah - 1
            : undefined
        }
        onScrollToIndexFailed={info => {
          // Dynamic row heights: retry after the list settles.
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: Math.min(info.index, info.highestMeasuredFrameIndex),
              animated: false,
            });
          }, 120);
        }}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
      />
      <MiniPlayer />

      {selectedAyah != null ? (
        <AyahActionSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          surah={surahNumber}
          ayah={selectedAyah}
          page={findPageForAyah(surahNumber, selectedAyah)}
          scrollToAudio={sheetScrollAudio}
        />
      ) : null}

      {/* App-wide companion-text picker (v2.7.40, replaces the
          translation-only picker from task #124): mode + edition, shared
          with the Quran index page and Settings. */}
      <CompanionTextSheet
        visible={editionPickerVisible}
        onClose={() => setEditionPickerVisible(false)}
      />
    </View>
  );
}

/**
 * Per-row tafsir text (v2.7.40) — lazy: fetched (or read from the offline
 * cache) when the row mounts, so long surahs only load what scrolls into
 * view. Long tafsir collapses to a few lines with a Show-more expand.
 */
function TafsirRowText({
  surah,
  ayah,
  editionId,
  rtl,
}: {
  surah: number;
  ayah: number;
  editionId: string;
  rtl: boolean;
}) {
  const { t } = useTranslation();
  const { palette } = useAppPalette();
  // undefined = loading, null = unavailable (offline + uncached).
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setText(undefined);
    setExpanded(false);
    void loadTafsir(editionId, surah, ayah).then(loaded => {
      if (!cancelled) setText(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [editionId, surah, ayah]);

  if (text === undefined) {
    return (
      <View style={[styles.skeleton, { backgroundColor: palette.accentBg }]} />
    );
  }
  if (text === null) {
    return (
      <Text style={[styles.ayahTranslation, { color: palette.muted }]}>
        {t(
          'quran.tafsirUnavailable',
          'Tafsir unavailable — connect to the internet once to download it.',
        )}
      </Text>
    );
  }
  const long = text.length > 420;
  return (
    <>
      <Text
        numberOfLines={expanded ? undefined : 6}
        style={[
          styles.ayahTranslation,
          { color: palette.muted },
          rtl && { writingDirection: 'rtl', textAlign: 'right' },
        ]}>
        {text}
      </Text>
      {long ? (
        // Own Pressable — claims the touch so the row's action-sheet press
        // doesn't also fire when expanding the tafsir.
        <Pressable
          hitSlop={6}
          accessibilityRole="button"
          onPress={() => setExpanded(v => !v)}>
          <Text
            style={{
              color: palette.accentSolid,
              fontSize: 12,
              fontWeight: '700',
              marginTop: 4,
            }}>
            {expanded
              ? t('quran.showLess', 'Show less')
              : t('quran.showMore', 'Show more')}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}


const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  header: {
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  surahArabic: { fontSize: 32, lineHeight: 62, ...arabicTextStyle('body') },
  surahRomanized: { fontSize: 18, fontWeight: '700' },
  surahMeta: { fontSize: 12 },
  editionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps rather than squeezes. "Tafsir: التفسير الميسر" next to the
    // CHOOSE hint overruns a narrow header, and a row that cannot wrap
    // fits itself by shrinking its children — which truncated the
    // edition's name away and left the bare word "Tafsir". Same fault
    // as the chips in AyahActionSheet, same fix.
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
  },
  editionLabel: { fontSize: 12, flexShrink: 0 },
  editionHint: {
    fontSize: 11,
    flexShrink: 0,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  hideHint: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  ayahCard: { padding: 16, borderRadius: 12, gap: 10, marginTop: 12 },
  ayahMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  bookmarkBar: { width: 18, height: 5, borderRadius: 3 },
  ayahNumber: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ayahArabic: {
    fontSize: 24,
    // Amiri Quran carries tall stacked diacritics — ~2.2× line height
    // keeps fatha/kasra clusters unclipped (see arabicTextStyle docs).
    lineHeight: 54,
    textAlign: 'right',
    writingDirection: 'rtl',
    ...arabicTextStyle('quran'),
  },
  ayahTranslation: { fontSize: 15, lineHeight: 22 },
  masked: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  skeleton: { height: 14, borderRadius: 7, opacity: 0.5, marginTop: 4 },
  comingSoon: { padding: 24, borderRadius: 12, alignItems: 'center', gap: 8, marginTop: 12 },
  comingSoonText: { fontSize: 14, textAlign: 'center', fontWeight: '600' },
});


/** The mark and the word it labels, on one baseline. */
const audioMark = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
