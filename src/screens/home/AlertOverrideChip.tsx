/**
 * "This one time is not what you set it to" — and the way back.
 *
 * The Live Activity's button can put the upcoming prayer on a different
 * alert for that occurrence only. Before this, the home row went on
 * showing the standing setting: silence Fajr from the lock screen at
 * midnight, open the app, and the row still said Adhan. The app held two
 * answers about the same prayer and offered no way to reconcile them —
 * which is the complaint the three-mode button was built to answer, in
 * reverse.
 *
 * So the row now shows what will ACTUALLY happen at that time, and this
 * line under the name is what stops that from reading as a permanent
 * change: it names the exception, and pressing it takes the exception
 * away.
 *
 * ── WHY IT IS UNDER THE NAME AND NOT BESIDE THE TIME ─────────────────
 *
 * The trailing edge of a row is a column, not a place: the control, the
 * chosen-dot's held slot and the time are aligned across every row of the
 * card, and this file's neighbours go to some length to keep them that
 * way — the dot's slot is drawn even when there is no dot, and the time
 * column is sized by the longest time on the card rather than its own.
 * A control that appears on ONE row would push that row's bell and time
 * out of line with the other six, which is the exact defect both of those
 * mechanisms exist to prevent. The name column flexes, so a second line
 * under the name costs nothing anybody is scanning — the same argument
 * the Mālikī boundary line already makes two lines further up.
 *
 * ── AND WHY IT SAYS BOTH THINGS ──────────────────────────────────────
 *
 * "Reset" alone does not say why the row looks wrong. "Just this once"
 * alone does not offer a way out. A reader who has never seen this before
 * needs the pair, in that order: what happened, then what to do about it.
 * It NAMES the mode rather than leaning on the bell beside it, because
 * on tomorrow's card there is no bell: the cycling control only appears
 * on today's, since a tap there changes every Fajr rather than one. An
 * override set after Isha belongs to tomorrow's Fajr, so this line has to
 * stand on its own. Two lines are allowed for it — the languages that
 * need a whole clause for "just this once" should wrap rather than
 * ellipsise away the half that says what to do.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';
import type { AppPalette } from '../../theme/appPalette';
import type { PrayerAlertMode } from '../../settings/alertModes';

const SIZE = 12;

/**
 * An arrow curling back on itself — undo, not refresh.
 *
 * Drawn rather than set in a font: the app carries no icon set, and an
 * emoji would be a different shape, weight and colour on every device
 * that rendered it.
 */
function RevertGlyph({ color }: { color: ColorValue }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
      {/* Three-quarter arc, opening at the top left. */}
      <Path
        d="M4 12a8 8 0 1 0 2.6-5.9"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
      {/* The head, on the tail of the arc rather than beside it, so the
          two read as one stroke that turned around. */}
      <Path
        d="M4 3.5V8h4.5"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

type Props = {
  /** What this occurrence is set to right now — the temporary answer. */
  mode: PrayerAlertMode;
  /** What it goes back to: the row's standing setting. */
  standingMode: PrayerAlertMode;
  palette: AppPalette;
  onPress: () => void;
  /** Localised prayer name, for the accessibility label. */
  prayerLabel: string;
};

function AlertOverrideChipImpl({
  mode,
  standingMode,
  palette,
  onPress,
  prayerLabel,
}: Props) {
  const { t } = useTranslation();
  const word = (m: PrayerAlertMode) =>
    m === 'adhan'
      ? t('settings.alertModeAdhan', 'Adhan')
      : m === 'notification'
        ? t('settings.alertModeNotification', 'Alert')
        : t('settings.alertModeSilent', 'Silent');

  return (
    <Pressable
      accessibilityRole="button"
      // Spells out all three things the line implies but has no room to
      // say: which prayer, what it is on just now, and what pressing does.
      accessibilityLabel={t('home.alertOverrideA11y', {
        defaultValue: '{{prayer}} is set to {{mode}} just this once',
        prayer: prayerLabel,
        mode: word(mode),
      })}
      accessibilityHint={t('home.alertOverrideResetHint', {
        defaultValue: 'Restores {{mode}}',
        mode: word(standingMode),
      })}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <View style={styles.glyph}>
        <RevertGlyph color={palette.accentSolid} />
      </View>
      <Text
        numberOfLines={2}
        style={[styles.label, { color: palette.accentSolid }]}>
        {t('home.alertOverrideOnce', {
          defaultValue: '{{mode}} just this once · Reset',
          mode: word(mode),
        })}
      </Text>
    </Pressable>
  );
}

export const AlertOverrideChip = memo(AlertOverrideChipImpl);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    // Its own row, so the press target is the line rather than the text's
    // exact width — with hitSlop that is a comfortable target without
    // drawing a button-shaped box on a card that has none.
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.55 },
  glyph: { marginEnd: 5, height: SIZE, justifyContent: 'center' },
  // Shrinks rather than pushing the row wider when a locale needs a whole
  // clause for "just this once".
  label: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
});
