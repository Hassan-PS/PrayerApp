/**
 * The surah route — one route, two readers.
 *
 * `settings.quranReadingMode` says which one is on screen, and the header
 * of each carries the toggle to the other. This screen hydrates what both
 * need, finds the surah, and renders one of them; everything either reader
 * knows about the navigator — header controls, orientation, fullscreen,
 * content colour, the Mac's back gesture — lives with that reader.
 *
 * It used to be all one component, 980 lines switching on `isMushaf` in
 * a shared header effect, content style, sheet guard and render. Each
 * muṣḥaf concern was a branch inside something the translation reader also
 * ran, and each platform edge case landed here as another one.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppPalette } from '../hooks/useAppPalette';
import { useBreakpoint } from '../responsive/breakpoints';
import { useAndroidSubScreenBack } from '../navigation/useAndroidSubScreenBack';
import { findSurah } from '../quran/quran';
import { hydrateRiwayahData } from '../quran/riwayahData';
import { hydrateQuranState } from '../quran/quranState';
import { playFromAyah as startReciting } from '../quran/audio/playback';
import { usePrayerSettings } from '../context/PrayerSettingsContext';
import type { RootStackParamList } from '../navigation/types';
import { MushafSurahScreen } from './quran/MushafSurahScreen';
import { TranslationSurahScreen } from './quran/TranslationSurahScreen';

export function QuranSurahScreen() {
  useBreakpoint();
  const { t } = useTranslation();
  const { palette } = useAppPalette();
  const { settings, updateSettings } = usePrayerSettings();
  const route = useRoute<RouteProp<RootStackParamList, 'QuranSurah'>>();
  const { surahNumber, initialPage, scrollToAyah, playFromAyah } = route.params;
  useAndroidSubScreenBack();

  const surah = findSurah(surahNumber);

  useEffect(() => {
    void hydrateQuranState();
    // The muṣḥaf a reader may have added is on disk, not in the bundle
    // (`riwayahStore.ts`). Read it here so the toggle and the reader both
    // know what this device has before the first page is drawn.
    void hydrateRiwayahData();
  }, []);

  /**
   * Arriving with recitation asked for — issue #25.
   *
   * The reporter's ask was to resume reading and listening in one tap
   * instead of opening the bookmark, finding the reciter and pressing
   * play. The widget's play control sends `playFromAyah`, and this is
   * where it becomes sound.
   *
   * Here rather than in either reader, because it is true of both: the
   * muṣḥaf and the translation screen open on different things and
   * recite the same one.
   *
   * ── ONCE, AND ONLY WHEN ASKED ─────────────────────────────────────
   *
   * Params outlive a render. Without the ref, every re-render of this
   * screen — a theme change, a rotation, a settings write — would start
   * the queue again from the top, which for a listener is the surah
   * jumping back to where they came in. The ref remembers the exact
   * request it has already honoured, so a second tap on the SAME
   * position is also a no-op: it is already playing, and restarting it
   * is not what the tap meant.
   *
   * Fire and forget: recitation must never be able to hold up the page.
   * `playFromAyah` already answers quietly for a surah it cannot find,
   * and a network that will not give up an ayah is the audio layer's
   * problem to report, not a reason to leave the reader blank.
   */
  const recited = useRef<string | null>(null);
  useEffect(() => {
    if (!playFromAyah) return;
    const request = `${surahNumber}:${playFromAyah}`;
    if (recited.current === request) return;
    recited.current = request;
    void startReciting(surahNumber, playFromAyah).catch(() => undefined);
  }, [surahNumber, playFromAyah]);

  const isMushaf = settings.quranReadingMode === 'mushaf';
  const toggleMode = useCallback(() => {
    updateSettings({
      quranReadingMode: isMushaf ? 'withTranslation' : 'mushaf',
    });
  }, [isMushaf, updateSettings]);

  if (!surah) {
    return (
      <View style={[styles.empty, { backgroundColor: palette.bg }]}>
        <Text style={{ color: palette.muted }}>{t('quran.notFound')}</Text>
      </View>
    );
  }

  return isMushaf ? (
    <MushafSurahScreen
      surah={surah}
      surahNumber={surahNumber}
      initialPage={initialPage}
      onToggleMode={toggleMode}
    />
  ) : (
    <TranslationSurahScreen
      surah={surah}
      surahNumber={surahNumber}
      scrollToAyah={scrollToAyah}
      onToggleMode={toggleMode}
    />
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
