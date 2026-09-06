import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppPalette } from '../../hooks/useAppPalette';
import { rowDividerStyle } from '../../theme/chrome';
import {
  TABULAR_MAX_FONT_SCALE,
  tabularNumeralStyle,
} from '../../theme/textScale';
import { useClockFormatter } from '../../hooks/useClockFormatter';
import { HOME_ROW_PADDING_V } from './tokens';
import { AlertModeButton } from './AlertModeButton';
import { AlertOverrideChip } from './AlertOverrideChip';
import type { PrayerAlertMode } from '../../settings/alertModes';

/**
 * Single prayer row inside a day card.
 *
 * Memoized so DayCard re-renders don't cascade unless this row's specific
 * props changed (the `isNext` highlight is the only frequently-changing one).
 *
 * ── THE HIGHLIGHT MEANS "WHAT THE COUNTDOWN IS SHOWING" ───────────────
 *
 * It used to mean "next", which was the same thing until the countdown
 * could be pointed somewhere else. Now the emphasis follows the hero: pick
 * Isha in the morning and Isha is the row that lifts, because a highlight
 * that disagreed with the number above it would be worse than none.
 * `isChosen` adds the dot that says the choice was the user's.
 */
type PrayerRowProps = {
  prayerKey: string;
  rawTime: string;
  isNext: boolean;
  /** Picked by the user, rather than simply being the next one. */
  isChosen?: boolean;
  /** Absent for a row that cannot be aimed at — yesterday's, or passed. */
  onSelect?: () => void;
  /**
   * Non-salāh row (Sunrise, Islamic Midnight, Last Third) — rendered muted +
   * italic to read as a quieter, secondary entry beside the five daily prayers.
   */
  isSecondary: boolean;
  isLast: boolean;
  /**
   * When this prayer's preferred (ikhtiyārī) window closes — issue #19.
   *
   * Canonical `HH:mm`; the row formats it like every other clock. Absent
   * unless the user turned Mālikī second times on, and absent for a day
   * or a latitude where the sky does not produce the boundary.
   */
  daruriAt?: string;
  /**
   * True when that boundary is a model of something the eye judges — the
   * stars fading, the sun yellowing — rather than a solar position. The
   * row says "approx." for those, because printing all five in the same
   * confident type would claim more than the app knows.
   */
  daruriApprox?: boolean;
  /**
   * How this row announces itself, and the tap that cycles it. Absent
   * for a row that cannot be aimed at — yesterday's card, or the share
   * sheet — where a control that changes a setting has no business.
   */
  alertMode?: PrayerAlertMode;
  onCycleAlertMode?: () => void;
  /**
   * What THIS occurrence is set to, when the Live Activity's button has
   * put it on something other than the standing setting for this one
   * time. Absent — the usual case — means there is nothing to explain or
   * undo, and `alertMode` is the whole answer.
   *
   * Carried separately from `alertMode` because the two are shown in
   * different places and on different days. `alertMode` is the cycling
   * control, which only today's card has: a tap there changes every
   * Fajr, and that is not what a tap on tomorrow's row looks like it
   * does. This one belongs to a single instant, so it appears on
   * whichever day holds it — including tomorrow, which is where an
   * override set after Isha lands.
   */
  overrideMode?: PrayerAlertMode;
  /** What reset puts back: the row's standing setting. */
  standingAlertMode?: PrayerAlertMode;
  onResetAlertMode?: () => void;
  /**
   * The longest time on this card, which sizes the time column on EVERY
   * row of it.
   *
   * Without it the column is as wide as its own time, and the control
   * beside it moves with that width: on a 12-hour clock "11:09 PM" is a
   * digit wider than "5:36 AM", so one row's bell sat a digit to the left
   * of the other six. The card knows all the times, so it picks the
   * longest and hands the same string to every row.
   *
   * ── LONGEST IS NOT ALWAYS WIDEST ──────────────────────────────────
   *
   * The card compares string LENGTHS, which stands in for width only
   * while the numerals are tabular. `tabularNumeralStyle` asks for that,
   * but `fontVariant: ['tabular-nums']` is a request to the font, not a
   * guarantee: Android lets people choose a system font, and a
   * decorative one often ships no `tnum` table. The request then does
   * nothing, digits go back to their natural widths, and two times of
   * equal length no longer render equally wide.
   *
   * That is issue #26. On a handwriting system font the column was sized
   * by "00:46" and had to hold "02:23", which is wider in that face — so
   * the clock wrapped onto a second line mid-value ("02:2" / "3"), and
   * only on the rows whose digits happened to be the wide ones.
   *
   * So the sample is used only when it is genuinely longer than this
   * row's own time. At equal length the row sizes to its own time, which
   * is correct in any font. With tabular numerals every row's own time is
   * the same width and the column stays aligned exactly as before; with a
   * font that ignores the request, a row may sit a few pixels out of line
   * with its neighbours — which is the right thing to lose, because the
   * alternative is a prayer time broken across two lines.
   */
  timeSample?: string;
};

function PrayerRowImpl({
  prayerKey,
  rawTime,
  isNext,
  isChosen = false,
  onSelect,
  isSecondary,
  isLast,
  daruriAt,
  daruriApprox = false,
  alertMode,
  onCycleAlertMode,
  overrideMode,
  standingAlertMode,
  onResetAlertMode,
  timeSample,
}: PrayerRowProps) {
  const { t } = useTranslation();
  const { palette } = useAppPalette();
  const clock = useClockFormatter();

  const shown = clock(rawTime);
  // The card's sample only when it really is longer — see `timeSample`.
  const sizingTime =
    timeSample && timeSample.length > shown.length ? timeSample : shown;

  const Row = onSelect ? Pressable : View;
  const interactive = onSelect
    ? {
        accessibilityRole: 'button' as const,
        accessibilityState: { selected: isChosen },
        accessibilityHint: isChosen
          ? t('a11y.countdownHere')
          : t('a11y.countdownTo'),
        onPress: onSelect,
      }
    : {};

  return (
    <Row
      {...interactive}
      style={[
        styles.row,
        !isLast && rowDividerStyle(palette),
        isNext && { backgroundColor: palette.accentBg },
      ]}>
      {isNext && (
        <View
          style={[styles.activeBar, { backgroundColor: palette.accent }]}
        />
      )}
      <View style={styles.nameWrap}>
        <Text
          style={[
            styles.name,
            {
              color: isSecondary && !isNext ? palette.muted : palette.text,
              fontStyle: isSecondary ? 'italic' : 'normal',
              fontWeight: isNext ? '600' : '500',
            },
          ]}
          maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
          {t(`prayer.${prayerKey}`)}
        </Text>
        {/* Under the name rather than beside the time: the time column is
            the one thing on this screen that is scanned rather than read,
            and a second number in it would cost more than this line is
            worth. */}
        {daruriAt ? (
          <Text
            style={[styles.daruri, { color: palette.muted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {t('prayer.firstTimeUntil', {
              defaultValue: 'First time until {{time}}',
              time: daruriApprox
                ? `${t('prayer.approx', { defaultValue: 'approx.' })} ${clock(
                    daruriAt,
                  )}`
                : clock(daruriAt),
            })}
          </Text>
        ) : null}
        {/* Under the name for the same reason the line above is, and for
            one more: the trailing edge is a COLUMN, aligned across every
            row of the card. A control that appeared on one row would push
            that row's bell and time out of line with the other six — the
            defect the held dot slot and the sizing sample below both
            exist to prevent. See AlertOverrideChip. */}
        {overrideMode && standingAlertMode && onResetAlertMode ? (
          <AlertOverrideChip
            mode={overrideMode}
            standingMode={standingAlertMode}
            palette={palette}
            onPress={onResetAlertMode}
            prayerLabel={t(`prayer.${prayerKey}`)}
          />
        ) : null}
      </View>
      {/* The control and the time travel together on the trailing edge.
          The row is `space-between`, so a third child left loose in the
          middle floats there — halfway between the name and the time,
          belonging to neither. Grouped, it reads as what it is: a
          setting about THIS time, next to it. */}
      <View style={styles.trailing}>
        {alertMode && onCycleAlertMode ? (
          <AlertModeButton
            mode={alertMode}
            palette={palette}
            onPress={onCycleAlertMode}
            prayerLabel={t(`prayer.${prayerKey}`)}
            secondary={isSecondary}
          />
        ) : null}
        {/* Only for a row the user aimed at. The next prayer is already
            emphasised, and marking it too would say nothing.

            Its slot is held on every row, dot or no dot: it sits between
            the control and the time, so a slot that appeared only on the
            chosen row would slide that row's control left — the same
            misalignment the sizing sample below exists to prevent. */}
        <View
          style={[
            styles.chosenDot,
            isChosen && { backgroundColor: palette.accent },
          ]}
        />
        <View style={styles.timeCol}>
          {/* Invisible, and hidden from screen readers: it is here only
              to give the column a width. It carries this row's own time,
              or the card's sample when that is longer, at the heaviest
              weight the column ever uses — so the real time below can
              never outgrow it whatever the font does with `tnum`. */}
          <Text
            aria-hidden
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.time, tabularNumeralStyle, styles.timeSample]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {sizingTime}
          </Text>
          <Text
            style={[
              styles.time,
              tabularNumeralStyle,
              styles.timeReal,
              {
                color: isNext
                  ? palette.accent
                  : isSecondary
                    ? palette.muted
                    : palette.text,
                fontWeight: isNext ? '700' : '500',
              },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {shown}
          </Text>
        </View>
      </View>
    </Row>
  );
}

export const PrayerRow = memo(PrayerRowImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: HOME_ROW_PADDING_V,
    paddingHorizontal: 16,
    paddingStart: 20,
    position: 'relative',
  },
  nameWrap: {
    flexShrink: 1,
  },
  // No `gap`: the dot's slot carries the spacing on both of its sides, so
  // the control-to-time distance is the same whether the dot is drawn or
  // not.
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  daruri: {
    fontSize: 11,
    marginTop: 2,
  },
  // Inset, rounded indicator pill instead of a full-bleed block — reads
  // as a quieter, more refined "current" marker against the tinted row.
  activeBar: {
    position: 'absolute',
    start: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderTopEndRadius: 3,
    borderBottomEndRadius: 3,
  },
  name: { fontSize: 17 },
  chosenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginStart: 12,
    marginEnd: 7,
    backgroundColor: 'transparent',
  },
  timeCol: { justifyContent: 'center' },
  timeSample: { opacity: 0, fontWeight: '700' },
  // Laid over the sample, flush with the trailing edge — `end`, so it is
  // the right edge in English and the left in Arabic.
  timeReal: { position: 'absolute', top: 0, end: 0 },
  time: { fontSize: 17 },
});
