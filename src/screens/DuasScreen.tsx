// hover-ok: list-row / settings-row / sheet pressables. Hover-state
// treatment would visually noise these dense surfaces; the touch
// feedback (pressed opacity / ripple) is the right affordance here.
import { memo, useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { useScrollToTop } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppPalette } from '../hooks/useAppPalette';
import { useBreakpoint } from '../responsive/breakpoints';
import { CenteredColumn } from '../responsive/CenteredColumn';
import { useAndroidSubScreenBack } from '../navigation/useAndroidSubScreenBack';
import {
  DUA_CATEGORIES,
  duasByCategory,
  type Dua,
  type DuaCategory,
} from '../duas/duas';
import { cardEdgeStyle } from '../theme/chrome';
import { ShareIcon } from '../theme/icons';
import { duaShareText } from '../share/shareText';
import { arabicTextStyle } from '../theme/typography';
import { TITLE_BAND_MAX_FONT_SCALE, tabularNumeralStyle } from '../theme/textScale';
import { useTabBarInset } from '../navigation/tabBarInset';
import { useTabBarScroll } from '../navigation/tabBarVisibility';

/**
 * Dua library screen — task #26.
 *
 * Vertical scroll of category sections. Tap a category chip at the top to
 * jump-scroll to that section. Each dua row shows Arabic + transliteration
 * + translation + source + repeat count.
 */
export function DuasScreen() {
  // Subscribe to width changes so future master-detail layouts pick up
  // the new breakpoint without a forced remount. iPad/Mac (#33) baseline.
  useBreakpoint();
  const { t, i18n } = useTranslation();
  const { palette } = useAppPalette();
  const tabBarInset = useTabBarInset();
  // The bar gets out of the way while reading — see tabBarVisibility.ts.
  const tabBarScroll = useTabBarScroll();
  /**
   * Tapping the tab you are already on returns this screen to the top —
   * the standard idiom on both platforms, and the only way back up a
   * long page without a lot of swiping. `useScrollToTop` listens for
   * `tabPress` and acts only while this screen is focused, so pressing a
   * DIFFERENT tab still just navigates.
   */
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  // Arabic readers don't need a Latin pronunciation guide or an English
  // meaning — they read the Arabic directly. Hide both supplementary
  // lines when the app language is Arabic so the row stays clean and
  // reverent.
  const isArabic = i18n.language === 'ar';
  const showTranslit = !isArabic;
  const showTranslation = !isArabic;
  useAndroidSubScreenBack();
  const [selected, setSelected] = useState<DuaCategory>('morning');
  // Per-dua tap-to-count state — task #94. Persists for the lifetime of
  // the screen so the user can navigate away from a dua and come back to
  // resume their count. Reset by tapping the inline reset affordance.
  const [counts, setCounts] = useState<Record<string, number>>({});
  /**
   * Which sections a reader has opened, keyed `<dua id>|<part>`.
   *
   * CLOSED TO BEGIN WITH. A category is up to a dozen duas and each was
   * showing Arabic, a Latin transliteration and an English translation at
   * once — three renderings of the same words, stacked, so the ONE you
   * came to read was never on screen by itself and the list took three
   * times the scrolling it needed. The Arabic is the dua; the other two
   * are aids, and an aid you have to scroll past is not aiding.
   *
   * Screen-lifetime state rather than a preference: which dua you need
   * the pronunciation of is a question you answer per dua, not once
   * forever, and it is one tap away.
   */
  const [openParts, setOpenParts] = useState<Record<string, boolean>>({});
  const togglePart = useCallback((key: string) => {
    setOpenParts(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onIncrement = useCallback((id: string, target: number) => {
    setCounts(prev => {
      const cur = prev[id] ?? 0;
      const next = cur + 1;
      Vibration.vibrate(target > 0 && next === target ? [0, 60, 80, 60, 80, 60] : 20);
      return { ...prev, [id]: next };
    });
  }, []);
  const onResetCount = useCallback((id: string) => {
    setCounts(prev => ({ ...prev, [id]: 0 }));
  }, []);

  /**
   * Hand a dua to whatever the phone can send it with — issue #24.
   *
   * The title and translation are the LOCALIZED ones, the same strings
   * the card is showing: someone reading Mihrab in Turkish and sending a
   * dua to their mother is sending it in Turkish, not in the bundled
   * English that happens to be the fallback.
   *
   * The Arabic, the transliteration and the source are the dua's own and
   * are not translated — the first two because they are the dua, the
   * third because a citation is a reference, not prose.
   */
  const onShare = useCallback(
    async (dua: Dua) => {
      try {
        await Share.share({
          message: duaShareText({
            title: t(`duas.${dua.id}.title`, { defaultValue: dua.titleEn }),
            arabic: dua.arabic,
            transliteration: dua.transliteration,
            translation: t(`duas.${dua.id}.translation`, {
              defaultValue: dua.translation,
            }),
            source: dua.source,
          }),
        });
      } catch {
        /* the sheet was dismissed */
      }
    },
    [t],
  );

  // No manual header offset (v2.8.5).
  //
  // This screen used to add the navigation header's own height to the top
  // of the chips row. That was correct when Duas was a page pushed onto the
  // root stack, whose header is `headerTransparent` on iOS so the blur can
  // extend behind content: without the padding the chips rendered behind
  // the title bar and were invisible.
  //
  // Duas is a TAB now (design review 2e), and the tab navigator's header is
  // opaque — it already sits above the content rather than over it. The
  // padding therefore counted the header twice and left a header's worth of
  // empty band under the title on every platform.
  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      {/* Tabs are wrapped in a fixed-height row pinned just under the
          system header, so when the active category has only one or two
          duas the chips stay at the top instead of vertically centering
          (#101 follow-up). The dua list ScrollView fills the rest of
          the screen and starts at a predictable y-offset. */}
      <View style={styles.tabsRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist">
        {DUA_CATEGORIES.map(c => {
          const isSel = c === selected;
          return (
            <Pressable
              key={c}
              accessibilityRole="tab"
              accessibilityLabel={t(`duas.cat.${c}`)}
              accessibilityState={{ selected: isSel }}
              onPress={() => setSelected(c)}
              style={[
                styles.tab,
                {
                  backgroundColor: isSel ? palette.accent : palette.card,
                  borderColor: isSel ? palette.accent : palette.border,
                },
              ]}>
              <Text
                style={[
                  styles.tabLabel,
                  { color: isSel ? '#fff' : palette.text },
                ]}>
                {t(`duas.cat.${c}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      </View>

      <ScrollView
        ref={scrollRef}
        {...tabBarScroll}
        style={styles.listScroll}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarInset }]}
        contentInsetAdjustmentBehavior="automatic">
        {/* The gap lives HERE, not on the ScrollView's content container.
            `contentContainerStyle`'s gap separates the ScrollView's DIRECT
            children, and since the column went in there has been exactly
            one of those — so it separated nothing and every dua sat flush
            against the next, one long slab of cards. The stack is the
            thing whose children need spacing, so the spacing belongs on
            the stack. Both props, because CenteredColumn is a plain
            pass-through on a phone and only grows its inner column on a
            tablet or a Mac. Same fix as LogScreen; see duaCardSpacing. */}
        <CenteredColumn innerStyle={styles.stack} style={styles.stack}>
        {duasByCategory(selected).map(dua => (
          <View
            key={dua.id}
            style={[
              styles.card,
              { backgroundColor: palette.card, ...cardEdgeStyle(palette) },
            ]}>
            {/* The title, and the one action on this card — issue #24.
                A reader wanted to send a dua to family. On the title line
                because it names what will be sent: a control at the foot
                of a card this tall is a long way from the thing it acts
                on, and further still once the Arabic has been read. */}
            <View style={styles.titleRow}>
              <Text
                style={[styles.title, { color: palette.text }]}
                maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
                {/* Per-dua localized title falls back to bundled English. */}
                {t(`duas.${dua.id}.title`, { defaultValue: dua.titleEn })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('duas.shareDua', {
                  defaultValue: 'Share {{title}}',
                  title: t(`duas.${dua.id}.title`, {
                    defaultValue: dua.titleEn,
                  }),
                })}
                hitSlop={10}
                onPress={() => onShare(dua)}
                style={({ pressed }) => [
                  styles.shareBtn,
                  { opacity: pressed ? 0.6 : 1 },
                ]}>
                <ShareIcon size={18} color={palette.muted} />
              </Pressable>
            </View>
            <Text
              style={[styles.arabic, { color: palette.text }]}
              accessibilityLabel={dua.arabic}>
              {dua.arabic}
            </Text>
            {/* The two aids, behind their own names.

                Pronunciation is a Latin transliteration for readers who
                cannot read the Arabic line; both are hidden outright for
                Arabic readers, who need neither. */}
            {showTranslit || showTranslation ? (
              <View style={styles.aidRow}>
                {showTranslit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      expanded: !!openParts[`${dua.id}|say`],
                    }}
                    onPress={() => togglePart(`${dua.id}|say`)}
                    style={[
                      styles.aidChip,
                      { backgroundColor: palette.controlBg },
                    ]}>
                    <Text
                      style={[styles.aidChipText, { color: palette.accentSolid }]}>
                      {`${openParts[`${dua.id}|say`] ? '▾' : '▸'} ${t(
                        'duas.pronunciation',
                        'Pronunciation',
                      )}`}
                    </Text>
                  </Pressable>
                ) : null}
                {showTranslation ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      expanded: !!openParts[`${dua.id}|mean`],
                    }}
                    onPress={() => togglePart(`${dua.id}|mean`)}
                    style={[
                      styles.aidChip,
                      { backgroundColor: palette.controlBg },
                    ]}>
                    <Text
                      style={[styles.aidChipText, { color: palette.accentSolid }]}>
                      {`${openParts[`${dua.id}|mean`] ? '▾' : '▸'} ${t(
                        'quran.viewToggleTranslation',
                        'Translation',
                      )}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {showTranslit && openParts[`${dua.id}|say`] ? (
              <Text
                style={[styles.translit, { color: palette.muted }]}
                accessibilityLabel={dua.transliteration}>
                {dua.transliteration}
              </Text>
            ) : null}
            {showTranslation && openParts[`${dua.id}|mean`] ? (
              <Text style={[styles.translation, { color: palette.text }]}>
                {/* Per-dua localized translation falls back to bundled
                    English. To add another locale, drop entries under
                    `duas.<id>.translation` in that locale's JSON. Hidden
                    entirely when the app language is Arabic. */}
                {t(`duas.${dua.id}.translation`, { defaultValue: dua.translation })}
              </Text>
            ) : null}
            {dua.repeat ? (
              // Tap-to-count counter for duas with a recommended
              // repetition (e.g. ×3, ×100). Mirrors the Tasbih pattern:
              // big number + target, haptic on each tap, reset
              // affordance, persists across the screen session.
              <View style={styles.counterRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('duas.tapToCount', 'Tap to count')}
                  accessibilityValue={{
                    now: counts[dua.id] ?? 0,
                    min: 0,
                    max: dua.repeat,
                    text: `${counts[dua.id] ?? 0} / ${dua.repeat}`,
                  }}
                  onPress={() => onIncrement(dua.id, dua.repeat ?? 0)}
                  style={[
                    styles.counterBtn,
                    {
                      backgroundColor:
                        (counts[dua.id] ?? 0) >= (dua.repeat ?? 0)
                          ? palette.accentBg
                          : palette.bg,
                      borderColor:
                        (counts[dua.id] ?? 0) >= (dua.repeat ?? 0)
                          ? palette.accent
                          : palette.border,
                    },
                  ]}>
                  <Text
                    style={[styles.counterValue, tabularNumeralStyle, { color: palette.text }]}>
                    {counts[dua.id] ?? 0}
                  </Text>
                  <Text style={[styles.counterTarget, { color: palette.muted }]}>
                    / {dua.repeat}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('tasbih.reset', 'Reset')}
                  onPress={() => onResetCount(dua.id)}
                  hitSlop={8}
                  style={styles.counterReset}>
                  <Text style={[styles.counterResetLabel, { color: palette.muted }]}>
                    {t('tasbih.reset', 'Reset')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              {dua.repeat ? (
                <Text style={[styles.meta, { color: palette.accent }]}>
                  {t('duas.repeat', { count: dua.repeat })}
                </Text>
              ) : null}
              <Text style={[styles.meta, styles.source, { color: palette.muted }]}>
                {dua.source}
              </Text>
            </View>
          </View>
        ))}
        </CenteredColumn>
      </ScrollView>
    </View>
  );
}

const _DuasScreenMemo = memo(DuasScreen);
export { _DuasScreenMemo as DuasScreenMemo };

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsRow: {
    // Fixed-height pinned row so single-dua categories don't vertically
    // center the chips. The list area below uses flex:1 underneath.
    flexShrink: 0,
  },
  listScroll: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, alignItems: 'center' },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 14, fontWeight: '600', lineHeight: 18, includeFontPadding: false },
  list: { padding: 16, paddingTop: 0 },
  stack: { gap: 12 },
  card: { borderRadius: 14, padding: 16, gap: 8 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // The title takes the room; the control keeps its own.
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // Pushed to the trailing edge, and `marginStart: 'auto'` rather than a
  // Spacer so a long title shrinks past it instead of pushing it off the
  // card. Never `Left`/`Right` — this screen is read in Arabic and Urdu.
  shareBtn: { marginStart: 'auto', padding: 2 },
  /**
   * The QURAN face, not the body one.
   *
   * A dua as this app prints it is fully vocalised — every harakah, the
   * quranic annotation marks, the small alif — and a good third of the
   * corpus is literal Quran (Ayat al-Kursi, the three quls). Amiri body
   * is a text face; AmiriQuran was cut for exactly this: taller
   * diacritics that stack without colliding, and mushaf letterforms.
   *
   * The leading was ALREADY the Quran face's (2.17x, per the note in
   * typography.ts), so the page had been paying the taller face's line
   * spacing while drawing with the shorter face — the worst of both, and
   * why it read as loose and slightly wrong.
   */
  arabic: { fontSize: 20, lineHeight: 44, textAlign: 'right', writingDirection: 'rtl', ...arabicTextStyle('quran') },
  /** The two aid toggles, side by side under the Arabic. */
  aidRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  aidChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  aidChipText: { fontSize: 12, fontWeight: '700' },
  translit: { fontSize: 14, fontStyle: 'italic' },
  translation: { fontSize: 15, lineHeight: 22 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  meta: { fontSize: 12 },
  source: { flexShrink: 1, textAlign: 'right' },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  counterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  counterValue: { fontSize: 28, fontWeight: '700' },
  counterTarget: { fontSize: 16, fontWeight: '500' },
  counterReset: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  counterResetLabel: { fontSize: 13, fontWeight: '600' },
});
