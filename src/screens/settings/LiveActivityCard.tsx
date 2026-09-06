import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLiveActivitySettings } from '../../context/PrayerSettingsContext';
import { useAppPalette } from '../../hooks/useAppPalette';
import { isMacCatalyst } from '../../responsive/breakpoints';
import {
  SettingsBlock,
  SettingsGroup,
  SettingsToggleRow,
} from './SettingsGroup';
import { sharedSettingsStyles as s } from './sharedStyles';

type LADesign = 'timeline' | 'countdown' | 'markers';

/**
 * Mini mock of the Android Live Activity notification for each design, so the
 * user can see the difference before choosing. Not pixel-perfect — just enough
 * to convey the layout (timeline bar vs. big countdown).
 */
function DesignPreview({
  design,
  accent,
  text,
  muted,
  surface,
}: {
  design: LADesign;
  accent: string;
  text: string;
  muted: string;
  surface: string;
}) {
  if (design === 'countdown') {
    return (
      <View style={[styles.preview, { backgroundColor: surface }]}>
        <Text style={[styles.previewCountdown, { color: text }]}>2:18:42</Text>
        <Text style={[styles.previewSub, { color: muted }]}>Maghrib · 22:12</Text>
      </View>
    );
  }
  if (design === 'markers') {
    // markers — the same day timeline, but with a dot at each prayer and a
    // tracker thumb at "now" (native ProgressStyle points + tracker icon).
    return (
      <View style={[styles.preview, { backgroundColor: surface }]}>
        <Text style={[styles.previewHeader, { color: muted }]}>2:18:42</Text>
        <Text style={[styles.previewRow, { color: text }]}>Maghrib</Text>
        <View style={styles.segRow}>
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <View key={i} style={styles.markerSegWrap}>
              <View
                style={[
                  styles.seg,
                  i < 4
                    ? { backgroundColor: accent }
                    : { backgroundColor: muted, opacity: 0.4 },
                ]}
              />
              {i < 6 ? (
                <View
                  style={[
                    styles.markerDot,
                    {
                      backgroundColor: i < 4 ? accent : muted,
                      opacity: i < 4 ? 1 : 0.55,
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
          <View style={[styles.markerTracker, { borderColor: accent }]} />
        </View>
      </View>
    );
  }
  // timeline — segmented bar, one gap per prayer (no dots/circles); the
  // filled segments up to "now", the rest dimmed.
  return (
    <View style={[styles.preview, { backgroundColor: surface }]}>
      <Text style={[styles.previewHeader, { color: muted }]}>2:18:42</Text>
      <Text style={[styles.previewRow, { color: text }]}>Maghrib</Text>
      <View style={styles.segRow}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <View
            key={i}
            style={[
              styles.seg,
              i < 4
                ? { backgroundColor: accent }
                : { backgroundColor: muted, opacity: 0.4 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Live Activity card — task #128.
 *
 * Master toggle pins an ongoing notification (Android) or starts an ActivityKit
 * Live Activity (iOS). On Android the user can also pick between two designs
 * (both keep the status-bar chip + always-on display):
 *   • Timeline  — the prayer-day ProgressStyle timeline + inline countdown.
 *   • Countdown — a big countdown with the next prayer's name + time.
 *
 * Off by default — existing users see no change unless they opt in.
 */
function LiveActivityCardImpl() {
  const { t } = useTranslation();
  const { slice: settings, update } = useLiveActivitySettings();
  const { palette } = useAppPalette();

  // Mac Catalyst has no Live Activity surface, so hide the whole card there.
  if (isMacCatalyst) return null;

  // Coerce any legacy stored value to the current options.
  const design: LADesign =
    settings.liveActivityDesign === 'countdown'
      ? 'countdown'
      : settings.liveActivityDesign === 'markers'
        ? 'markers'
        : 'timeline';

  const options: { id: LADesign; labelKey: string }[] = [
    { id: 'timeline', labelKey: 'settings.laDesignTimeline' },
    { id: 'markers', labelKey: 'settings.laDesignMarkers' },
    { id: 'countdown', labelKey: 'settings.laDesignCountdown' },
  ];

  return (
    <SettingsGroup
      title={t('settings.liveActivity')}
      footer={
        Platform.OS === 'ios'
          ? t('settings.liveActivityExperimental')
          : undefined
      }>
      <SettingsToggleRow
        title={t('settings.liveActivity')}
        help={t('settings.liveActivityHelp')}
        value={settings.liveActivityEnabled}
        onValueChange={v => update({ liveActivityEnabled: v })}
      />

      {/* Design picker — Android only (the iOS Live Activity has its own,
          fixed layout). Shown when the Live Activity is enabled. */}
      {Platform.OS === 'android' && settings.liveActivityEnabled ? (
        <SettingsBlock>
          <Text style={[s.label, { color: palette.muted }]}>
            {t('settings.laDesignLabel', { defaultValue: 'Style' })}
          </Text>
          <View style={styles.optionRow}>
            {options.map(opt => {
              const selected = design === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => update({ liveActivityDesign: opt.id })}
                  style={[
                    styles.option,
                    {
                      borderColor: selected ? palette.accent : palette.border,
                      backgroundColor: selected ? palette.accentBg : 'transparent',
                      borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}>
                  <DesignPreview
                    design={opt.id}
                    accent={palette.accent as string}
                    text={palette.text as string}
                    muted={palette.muted as string}
                    surface={palette.bg as string}
                  />
                  <Text
                    style={[
                      styles.optionLabel,
                      { color: selected ? palette.accent : palette.text },
                    ]}>
                    {t(opt.labelKey, {
                      defaultValue:
                        opt.id === 'countdown'
                          ? 'Countdown'
                          : opt.id === 'markers'
                            ? 'Markers'
                            : 'Timeline',
                    })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

        </SettingsBlock>
      ) : null}

      {/* Lock-screen button — Android only. The card has room for two
          actions and the other one, muting the next adhan, is the one
          people reach for; someone who has decided the card belongs on
          their lock screen is carrying a button they will never press. */}
      {Platform.OS === 'android' && settings.liveActivityEnabled ? (
        <SettingsToggleRow
          title={t('settings.laLockButtonLabel', {
            defaultValue: 'Lock-screen button',
          })}
          help={t('settings.laLockButtonHelp', {
            defaultValue:
              'Show a button on the card for hiding it from the lock screen and always-on display.',
          })}
          value={settings.liveActivityLockButton !== false}
          onValueChange={v => update({ liveActivityLockButton: v })}
        />
      ) : null}
    </SettingsGroup>
  );
}

export const LiveActivityCard = memo(LiveActivityCardImpl);

const styles = StyleSheet.create({
  optionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  option: {
    flex: 1,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: { fontSize: 13, fontWeight: '600' },
  preview: {
    width: '100%',
    height: 64,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 4,
  },
  previewCountdown: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  previewSub: { fontSize: 11, fontWeight: '500' },
  previewRow: { fontSize: 13, fontWeight: '700' },
  /* The header slot, where the platform's own chronometer ticks. */
  previewHeader: { fontSize: 10, fontWeight: '600' },
  segRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 6,
    alignItems: 'center',
  },
  seg: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  markerSegWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  markerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  markerTracker: {
    position: 'absolute',
    left: '56%',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
});
