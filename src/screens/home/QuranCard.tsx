/**
 * Home's Quran card (design review 2b) — four states, one card.
 *
 * It never disappears and never falls back to a generic "Open the Quran":
 * whichever of the four states is true, the card says something the reader
 * did not already know. The state itself is chosen by `selectQuranCardState`
 * so this file only has to draw.
 *
 * The progress bar exists only when a plan does. Without a khatmah there is
 * nothing to be a fraction of, and an empty bar would invent a goal the user
 * never set.
 */
import { memo, useEffect, useState } from 'react';
import {
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { QuranBookIcon } from '../../theme/icons';
import { useAppPalette } from '../../hooks/useAppPalette';
import { GlassSurface } from '../../components/GlassSurface';
import { cardEdgeStyle } from '../../theme/chrome';
import { TABULAR_MAX_FONT_SCALE } from '../../theme/textScale';
import { arabicTextStyle } from '../../theme/typography';
import { findSurah, loadSurah } from '../../quran/quran';
import { surahName } from '../../quran/surahName';
import { useQuranState } from '../../quran/quranState';
import { warmMushafLayout } from '../../quran/mushafLayout';
import { selectQuranCardState } from '../../quran/quranCardState';
import { useVerseOfTheDay } from '../../quran/useVerseOfTheDay';
import { getAyahTranslation } from '../../quran/translations';
import { useActiveEdition } from '../../quran/useActiveEdition';
import { HOME_TABLE_RADIUS } from './tokens';

type Props = {
  /** Continue reading — surah + optional page for the mushaf. */
  onOpenAt: (surah: number, page?: number, ayah?: number) => void;
  /** Opens the Quran home (surah list, khatmah controls). */
  onOpenQuran: () => void;
};

function ProgressBar({ value }: { value: number }) {
  const { palette } = useAppPalette();
  return (
    <View style={[styles.track, { backgroundColor: palette.controlBg }]}>
      <View
        style={[
          styles.fill,
          {
            backgroundColor: palette.accentSolid,
            width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
          },
        ]}
      />
    </View>
  );
}

function QuranCardImpl({ onOpenAt, onOpenQuran }: Props) {
  const { t, i18n } = useTranslation();
  const { palette } = useAppPalette();
  const quran = useQuranState();
  const card = selectQuranCardState(quran);
  const votd = useVerseOfTheDay();
  const edition = useActiveEdition();
  const [votdArabic, setVotdArabic] = useState('');
  // Fetched alongside the Arabic below rather than read in the render
  // body: the editions have moved off the JS bundle, so this is a read
  // from disk now. It also cannot be a hook down in the `card.kind ===
  // 'ayah'` branch where it used to be computed — that branch is
  // conditional, and hooks are not.
  const [votdTranslation, setVotdTranslation] = useState('');

  // A card that says "Continue" into the muṣḥaf is a reader about to open
  // it. Bring the page-layout data in now, after the home screen has
  // settled, rather than in the middle of the push transition when the
  // first page asks for it — see `warmMushafLayout`.
  const readsMushaf = quran.lastRead?.mode === 'mushaf';
  const riwayah = quran.prefs.riwayah;
  useEffect(() => {
    if (!readsMushaf) return;
    const task = InteractionManager.runAfterInteractions(() =>
      warmMushafLayout(riwayah),
    );
    return () => task.cancel();
  }, [readsMushaf, riwayah]);

  // Only the empty state shows the verse, so only it pays for the surah load.
  const needsVerse = card.kind === 'ayah';
  useEffect(() => {
    if (!needsVerse) return;
    let cancelled = false;
    void loadSurah(votd.surah).then(loaded => {
      if (cancelled || !loaded) return;
      setVotdArabic(loaded.arabic[votd.ayah - 1] ?? '');
    });
    getAyahTranslation(edition, votd.surah, votd.ayah)
      .then(text => {
        if (!cancelled) setVotdTranslation(text);
      })
      .catch(() => {
        if (!cancelled) setVotdTranslation('');
      });
    return () => {
      cancelled = true;
    };
  }, [needsVerse, votd, edition]);

  const surahLabel = (n: number) => {
    const meta = findSurah(n);
    return meta ? surahName(meta, i18n.language) : '';
  };

  const shell = (children: React.ReactNode, onPress: () => void, label: string) => (
    <GlassSurface
      style={[
        styles.card,
        { borderRadius: HOME_TABLE_RADIUS, ...cardEdgeStyle(palette) },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }) => [
          styles.pressable,
          pressed && { opacity: 0.75 },
        ]}>
        {children}
      </Pressable>
    </GlassSurface>
  );

  if (card.kind === 'ayah') {
    const verseRef = `${surahLabel(votd.surah)} ${votd.surah}:${votd.ayah}`;
    const translation = votdTranslation;
    return (
      <GlassSurface
        style={[
          styles.card,
          { borderRadius: HOME_TABLE_RADIUS, ...cardEdgeStyle(palette) },
        ]}>
        <View style={styles.verseBody}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>
            {t('quran.ayahOfDayTitle', 'Ayah of the day')}
          </Text>
          {votdArabic ? (
            <Text
              style={[styles.verseArabic, { color: palette.text }]}
              numberOfLines={3}>
              {votdArabic}
            </Text>
          ) : null}
          <Text
            style={[styles.verseMeaning, { color: palette.muted }]}
            numberOfLines={3}>
            {translation ? `${translation} — ${verseRef}` : verseRef}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.readItIn', {
            defaultValue: 'Read it in {{surah}}',
            surah: surahLabel(votd.surah),
          })}
          onPress={() => onOpenAt(votd.surah, undefined, votd.ayah)}
          style={({ pressed }: { pressed: boolean }) => [
            styles.verseAction,
            { borderTopColor: palette.border ?? palette.muted },
            pressed && { opacity: 0.75 },
          ]}>
          <QuranBookIcon color={palette.accentSolid} size={20} />
          <Text style={[styles.verseActionLabel, { color: palette.accent }]}>
            {t('home.readItIn', {
              defaultValue: 'Read it in {{surah}}',
              surah: surahLabel(votd.surah),
            })}
          </Text>
        </Pressable>
      </GlassSurface>
    );
  }

  if (card.kind === 'done') {
    return shell(
      <>
        <View style={[styles.tick, { backgroundColor: palette.accentSolid }]}>
          <Text style={[styles.tickGlyph, { color: palette.onAccent }]}>✓</Text>
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {t('home.readingDone', "Today's reading done")}
          </Text>
          <Text
            style={[styles.subtitle, { color: palette.muted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {t('home.khatmahDay', {
              defaultValue: 'Khatmah day {{day}} of {{total}}',
              day: card.dayNumber,
              total: card.targetDays,
            })}
            {' · '}
            {t('home.khatmahDaysToGo', {
              defaultValue: '{{count}} days to go',
              count: card.daysToGo,
            })}
          </Text>
          <ProgressBar value={card.progress} />
        </View>
        {/* Completion is worth stating plainly; "read on" keeps the door
            open without nagging. */}
        <Text style={[styles.trailingAction, { color: palette.accent }]}>
          {t('home.readOn', 'Read on')}
        </Text>
      </>,
      onOpenQuran,
      t('home.readingDone', "Today's reading done"),
    );
  }

  const lastRead = card.kind === 'khatmah' ? card.lastRead : card.lastRead;
  const continueLabel = lastRead
    ? t('home.continueAt', {
        defaultValue: 'Continue · {{surah}} {{ref}}',
        surah: surahLabel(lastRead.surah),
        ref: `${lastRead.surah}:${lastRead.ayah}`,
      })
    : t('home.quranShortcut', 'Open the Quran');

  return shell(
    <>
      <QuranBookIcon color={palette.accentSolid} size={26} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {continueLabel}
        </Text>
        {card.kind === 'khatmah' ? (
          <>
            <Text
              style={[styles.subtitle, { color: palette.muted }]}
              numberOfLines={1}
              maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
              {t('home.khatmahDay', {
                defaultValue: 'Khatmah day {{day}} of {{total}}',
                day: card.dayNumber,
                total: card.targetDays,
              })}
              {' · '}
              {t('home.pagesLeftToday', {
                defaultValue: '{{count}} pages left today',
                count: card.pagesLeftToday,
              })}
            </Text>
            <ProgressBar value={card.progress} />
          </>
        ) : (
          <Text
            style={[styles.subtitle, { color: palette.muted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {t('home.pageNumber', {
              defaultValue: 'page {{page}}',
              page: lastRead?.page ?? 1,
            })}
          </Text>
        )}
      </View>
      {/* A bookmark but no plan: the khatmah offer rides along as a chip
          rather than becoming its own empty-state screen. */}
      {card.kind === 'continue' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('quran.startKhatmah', 'Start a khatmah')}
          onPress={onOpenQuran}
          style={[styles.chip, { backgroundColor: palette.accentBg }]}>
          <Text style={[styles.chipLabel, { color: palette.accent }]} numberOfLines={1}>
            {t('quran.startKhatmah', 'Start a khatmah')}
          </Text>
        </Pressable>
      ) : null}
    </>,
    () =>
      lastRead
        ? onOpenAt(lastRead.surah, lastRead.page, lastRead.ayah)
        : onOpenQuran(),
    continueLabel,
  );
}

export const QuranCard = memo(QuranCardImpl);

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15.5, fontWeight: '700' },
  subtitle: { fontSize: 12.5, marginTop: 2 },
  track: { height: 4, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickGlyph: { fontSize: 14, fontWeight: '700' },
  trailingAction: { fontSize: 12.5, fontWeight: '700' },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999 },
  chipLabel: { fontSize: 11.5, fontWeight: '700' },
  eyebrow: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  verseBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  verseArabic: {
    fontSize: 22,
    lineHeight: 44,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 8,
    ...arabicTextStyle('body'),
  },
  verseMeaning: { fontSize: 13, marginTop: 4 },
  verseAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verseActionLabel: { flex: 1, fontSize: 14.5, fontWeight: '700' },
});
