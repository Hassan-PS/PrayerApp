/**
 * Home's single "today" card (design review 2a).
 *
 * Replaces four floating slabs — hero, day table, carousel dots, month link —
 * with one object, in the order a person actually reads it:
 *
 *   how long have I got  →  which day am I looking at  →  the times
 *
 * That ordering is the whole point of the change. The old hero answered the
 * wrong question (64pt "12:59", a 14pt "in 3h 24m" pill) and then the table
 * repeated the same prayer one row down; the day switcher was six 6-px dots
 * wedged between two cards, which nobody swipes because they cannot see its
 * edge.
 *
 * The hero adapts rather than lies: a countdown only means something for
 * today, so on any other day that slot becomes the date, the hijri date and
 * the day's first prayer — same position, honest content. For the same
 * reason the next-prayer highlight and its rail appear only on today; on
 * Saturday nothing is next, so nothing is emphasised.
 *
 * Both gestures drive one selection: tap a chip, or swipe the card body the
 * way the carousel used to work.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsActive } from '../../hooks/useIsActive';
import { useAppPalette } from '../../hooks/useAppPalette';
import { useClockFormatter } from '../../hooks/useClockFormatter';
import { usePrayerSettings } from '../../context/PrayerSettingsContext';
import {
  cycleAlertModePatch,
  shownAlertMode,
  type PrayerAlertMode,
} from '../../settings/alertModes';
import { GlassSurface } from '../../components/GlassSurface';
import { cardEdgeStyle } from '../../theme/chrome';
import {
  TABULAR_MAX_FONT_SCALE,
  TITLE_BAND_MAX_FONT_SCALE,
  tabularNumeralStyle,
} from '../../theme/textScale';
import { DISPLAY_ORDER, OPTIONAL_TIME_KEYS } from '../../types/prayer';
import {
  DARURI_CONFIDENCE,
  type DaruriKey,
} from '../../prayer/daruriTimes';
import type { TimingsMap } from '../../types/prayer';
import {
  addDays,
  combineLocalDateAndTime,
  countdownParts,
  eventAt,
  startOfLocalDay,
} from '../../utils/prayerTimes';
import { isRtlLanguage } from '../../i18n/layoutDirection';
import { DayStrip, type DayStripEntry } from './DayStrip';
import { PrayerRow } from './PrayerRow';
import {
  useNextAlertOverride,
  clearNextAlertOverride,
} from '../../notifications/adhanMute';
import { clearNativeAlertOverride } from '../../native/MihrabLiveActivity';
import { ymdLocal } from '../../notifications/scheduling';
import { QiblaChipCorner } from './QiblaChip';
import { HOME_TABLE_RADIUS } from './tokens';

/** The five salāh — the only rows a "first prayer of the day" can name. */
const SALAH_ORDER = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

export type TodayCardProps = {
  /** Today first, then the next six days. */
  week: TimingsMap[];
  nextInfo: { name: string; at: Date } | null;
  /** Changing this returns the strip to today (e.g. the user moved city). */
  resetKey: string;
  getDayLabel: (dayOffset: number) => string;
  getDayDate: (dayOffset: number) => string;
  getHijriDate?: (dayOffset: number) => string;
  /** Two-letter weekday for the strip chips. */
  getDayShort: (dayOffset: number) => string;
  /** Day of month for the strip chips. */
  getDayNumber: (dayOffset: number) => string;
  onOpenMonth?: () => void;
  /**
   * Qibla bearing in degrees from true north, or null when there is no
   * fix yet. Passed in rather than computed here because this card is
   * presentational and the coordinates live in settings.
   */
  qiblaBearing?: number | null;
  /** Opens the compass screen from the hero chip. */
  onOpenQibla?: () => void;
  /** Data-freshness whisper under the hero. */
  dataStatus?: { lastFetchedAt: Date | null; totalDaysCached: number } | null;
  /** Wide iPad/Mac dashboard: the hero gets more presence. */
  expanded?: boolean;
};

/**
 * The countdown half of the hero, isolated so the clock tick re-renders one
 * small component instead of the strip and eight rows with it — the same
 * containment `NextPrayerCard` was built for.
 *
 * ── WHY IT TICKS EVERY SECOND, AND ONLY WHEN LOOKED AT ────────────────
 *
 * It used to tick every thirty, which is all minutes need. Seconds are
 * shown now, so the interval has to match them — and a second-by-second
 * setState on a tab nobody is looking at is a wake-up per second for
 * nothing. The interval exists only while this screen has focus, and the
 * clock is re-read on the way back in so the number is never stale for a
 * frame.
 */
const HeroToday = memo(function HeroToday({
  target,
  chosen,
  onExpire,
  today,
  expanded,
  dateLine,
}: {
  /** What the countdown is aimed at: the next prayer, or the user's pick. */
  target: { name: string; at: Date };
  /** True when the user aimed it rather than it simply being next. */
  chosen: boolean;
  /** Called when a chosen prayer's time arrives, to hand the hero back. */
  onExpire: () => void;
  today: TimingsMap;
  expanded: boolean;
  /**
   * Today's date, Gregorian and Hijri — issue #23.
   *
   * Every other day's hero says which day it is; today's said only how
   * long until the next prayer, and the Hijri date was on the widget but
   * nowhere in the app. It goes at the foot of the hero rather than the
   * head: what someone opens this screen for is the number, and a date
   * above it would be a line to read past.
   */
  dateLine?: string;
}) {
  const { t } = useTranslation();
  const { palette } = useAppPalette();
  const clock = useClockFormatter();
  // Focus AND foreground. `useIsFocused()` on its own kept this ticking once
  // a second in the user's pocket: backgrounding the app from the Today tab
  // leaves Today the focused route, so the timer never stopped.
  const active = useIsActive();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return undefined;
    // Immediately, not on the first interval: coming back from the background
    // the displayed countdown is as stale as the time spent away.
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const remainingSeconds = Math.max(
    0,
    Math.floor((target.at.getTime() - now.getTime()) / 1000),
  );

  // A choice that has come and gone is not a choice any more. Handing the
  // hero back is better than counting down to zero forever, or than showing
  // a prayer that is now in the past.
  useEffect(() => {
    if (chosen && remainingSeconds <= 0) onExpire();
  }, [chosen, remainingSeconds, onExpire]);

  const parts = countdownParts(remainingSeconds);

  /**
   * The rail measures the CURRENT interval — from the prayer that has most
   * recently passed to the one being counted down to. Without a previous
   * time to anchor it (before Fajr, or when the day's earlier entries are
   * hidden by the optional-times toggles) there is no interval to be a
   * fraction of, so the rail is simply not drawn.
   */
  const rail = useMemo(() => {
    const passed = DISPLAY_ORDER.map(key => ({
      key,
      raw: today[key],
    }))
      .filter(e => e.raw)
      .map(e => ({ key: e.key, at: combineLocalDateAndTime(now, e.raw) }))
      .filter(e => e.at.getTime() <= now.getTime());
    const from = passed[passed.length - 1];
    if (!from) return null;
    const span = target.at.getTime() - from.at.getTime();
    if (span <= 0) return null;
    const pct = Math.max(
      0,
      Math.min(1, (now.getTime() - from.at.getTime()) / span),
    );
    return { from, pct };
  }, [today, now, target.at]);

  return (
    <View style={[styles.hero, expanded && styles.heroExpanded]}>
      <Text
        style={[styles.heroEyebrow, { color: palette.accent }]}
        numberOfLines={1}
        maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
        {t('home.nextPrayerIn', {
          defaultValue: '{{prayer}} in',
          prayer: t(`prayer.${target.name}`),
        })}
      </Text>
      <View style={styles.heroCountdownRow}>
        <Text
          style={[
            styles.heroCountdown,
            expanded && styles.heroCountdownExpanded,
            tabularNumeralStyle,
            { color: palette.accent },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}
          // Clock runs are a Latin-style left-to-right unit whatever the app
          // language; iOS bidi otherwise collapses the line in Arabic.
          accessibilityLanguage="en-US">
          {parts.main}
        </Text>
        <Text
          style={[
            styles.heroSeconds,
            expanded && styles.heroSecondsExpanded,
            tabularNumeralStyle,
            { color: palette.muted },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}
          accessibilityLanguage="en-US">
          {parts.seconds}s
        </Text>
        <Text
          style={[styles.heroAt, tabularNumeralStyle, { color: palette.muted }]}
          numberOfLines={1}
          maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}
          accessibilityLanguage="en-US">
          {clock.fromDate(target.at)}
        </Text>
      </View>
      {rail ? (
        <View style={styles.railWrap}>
          <View style={[styles.railTrack, { backgroundColor: palette.controlBg }]}>
            <View
              style={[
                styles.railFill,
                {
                  backgroundColor: palette.accentSolid,
                  width: `${Math.round(rail.pct * 100)}%`,
                },
              ]}
            />
          </View>
          <View style={styles.railLabels}>
            <Text
              style={[styles.railLabel, tabularNumeralStyle, { color: palette.muted }]}
              numberOfLines={1}
              maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
              {t(`prayer.${rail.from.key}`)}
            </Text>
            <Text
              style={[styles.railLabel, tabularNumeralStyle, { color: palette.muted }]}
              numberOfLines={1}
              maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
              {t(`prayer.${target.name}`)}
            </Text>
          </View>
        </View>
      ) : null}
      {dateLine ? (
        <Text
          style={[styles.heroTodayDate, { color: palette.muted }]}
          numberOfLines={1}
          maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
          {dateLine}
        </Text>
      ) : null}
    </View>
  );
});

/** The hero on any day that is not today: date, hijri date, first prayer. */
function HeroOtherDay({
  label,
  date,
  hijri,
  timings,
}: {
  label: string;
  date: string;
  hijri?: string;
  timings: TimingsMap;
}) {
  const { t } = useTranslation();
  const { palette } = useAppPalette();
  const clock = useClockFormatter();
  const first = SALAH_ORDER.find(key => timings[key]);
  return (
    <View style={styles.hero}>
      <Text
        style={[styles.heroEyebrow, { color: palette.muted }]}
        numberOfLines={1}
        maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
        {label}
      </Text>
      <Text
        style={[styles.heroDate, { color: palette.text }]}
        numberOfLines={1}
        maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
        {date}
      </Text>
      {hijri ? (
        <Text
          style={[styles.heroHijri, { color: palette.muted }]}
          numberOfLines={1}
          maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
          {hijri}
        </Text>
      ) : null}
      {first ? (
        <View style={[styles.firstPill, { backgroundColor: palette.controlBg }]}>
          <Text
            style={[styles.firstPillText, { color: palette.text }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {t('home.firstPrayer', {
              defaultValue: 'First prayer {{prayer}} · {{time}}',
              prayer: t(`prayer.${first}`),
              time: clock(timings[first]),
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TodayCardImpl({
  week,
  nextInfo,
  resetKey,
  getDayLabel,
  getDayDate,
  getHijriDate,
  getDayShort,
  getDayNumber,
  onOpenMonth,
  qiblaBearing,
  onOpenQibla,
  dataStatus,
  expanded = false,
}: TodayCardProps) {
  const { t, i18n } = useTranslation();
  const { palette } = useAppPalette();
  const clock = useClockFormatter();
  const { settings, updateSettings } = usePrayerSettings();
  const [selected, setSelected] = useState(0);
  /**
   * The prayer the user aimed the countdown at, or null for "whatever is
   * next".
   *
   * Null is not the same as pointing it at the next prayer: the next prayer
   * moves on its own, and someone who never chose should keep getting the
   * one that moves.
   */
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const rtl = isRtlLanguage(i18n.language);

  // A new city (or a fresh week of data) puts the strip back on today.
  useEffect(() => setSelected(0), [resetKey]);
  useEffect(() => setChosenKey(null), [resetKey]);
  // Never leave the selection pointing past the end of a shorter week.
  useEffect(() => {
    setSelected(s => (s < week.length ? s : 0));
  }, [week.length]);

  const days: DayStripEntry[] = useMemo(
    () =>
      week.map((_, offset) => ({
        offset,
        dow: getDayShort(offset),
        dom: getDayNumber(offset),
        a11yLabel: `${getDayLabel(offset)} — ${getDayDate(offset)}`,
      })),
    [week, getDayShort, getDayNumber, getDayLabel, getDayDate],
  );

  /**
   * Swiping the card body still turns the day, because that is the gesture
   * the carousel taught. It is a PanResponder rather than a paged ScrollView:
   * the hero and the rows both change with the day but the strip between them
   * does not, and a pager cannot hold two non-adjacent slices of one card.
   * The responder only claims clearly horizontal drags, so the vertical
   * scroll of the page underneath is untouched.
   */
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const lengthRef = useRef(week.length);
  lengthRef.current = week.length;
  const rtlRef = useRef(rtl);
  rtlRef.current = rtl;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < 40) return;
          // Dragging leftward advances in LTR and goes back in RTL, matching
          // the direction the strip itself runs.
          const forward = rtlRef.current ? g.dx > 0 : g.dx < 0;
          const next = selectedRef.current + (forward ? 1 : -1);
          if (next < 0 || next >= lengthRef.current) return;
          setSelected(next);
        },
      }),
    [],
  );

  // Memoised because the aim-and-countdown memos below depend on it, and a
  // fresh object every render would make them run every render.
  const timings = useMemo(
    () => week[selected] ?? week[0] ?? {},
    [week, selected],
  );
  const isToday = selected === 0;

  /**
   * How each row announces itself, and the tap that cycles it — v2.14.5.
   *
   * Read through `alertModeFor` rather than straight from the map: the
   * map is sparse, and an absent row means "whatever the app did before
   * this control existed", which depends on whether an adhan is chosen.
   * Writing is a merge for the same reason — one row's answer must not
   * become an answer for all five.
   */
  /**
   * The row and the master switch cannot disagree — see `shownAlertMode`
   * and `cycleAlertModePatch`, which is where the rule lives and where it
   * is tested. Both directions: off silences every row without forgetting
   * what it was, and switching a row on turns the master back on.
   */
  const alertsEnabled = settings.notificationsEnabled;
  const alertModeOf = useCallback(
    (key: string): PrayerAlertMode =>
      shownAlertMode(
        key,
        settings.prayerAlertModes,
        settings.notificationSound !== 'default',
        alertsEnabled,
      ),
    [alertsEnabled, settings.prayerAlertModes, settings.notificationSound],
  );
  const cycleAlertMode = useCallback(
    (key: string) => {
      updateSettings(
        cycleAlertModePatch(
          key,
          alertModeOf(key),
          settings.prayerAlertModes,
          alertsEnabled,
        ),
      );
    },
    [alertModeOf, alertsEnabled, settings.prayerAlertModes, updateSettings],
  );
  const visibleRows = useMemo(
    () => DISPLAY_ORDER.filter(key => timings[key]),
    [timings],
  );
  /**
   * The one occurrence the Live Activity's button has put on a different
   * alert — and which row of THIS day, if any, that is.
   *
   * Matched on the event AND the day it falls on, which is what an
   * occurrence is: silencing tonight's Ishāʾ says nothing about
   * tomorrow's, and the name alone would put the marker on both.
   *
   * The day comes from `eventAt`, the scheduler's own answer to "when
   * does this row happen" — not from the card's date. The First Third of
   * the night belongs to the evening it starts in, so at a long summer
   * latitude it sits on this card while its instant is tomorrow's; asking
   * any other way named a different occurrence than the one the alert was
   * written against, and the marker never appeared for it at all.
   *
   * It follows the occurrence onto whichever card holds it, which after
   * Ishāʾ is tomorrow's.
   */
  const override = useNextAlertOverride();
  const overrideKey = useMemo(() => {
    if (!override) return null;
    // WITH NOTIFICATIONS OFF THERE IS NOTHING TO EXPLAIN. The master
    // switch has already made every row silent, so a line promising
    // "Alert just this once" would be promising an alert that cannot
    // happen. The override is inert, not gone: turn the switch back on
    // before that instant and the line returns with it.
    if (!alertsEnabled) return null;
    const base = addDays(startOfLocalDay(new Date()), selected);
    for (const key of visibleRows) {
      if (key !== override.name) continue;
      if (ymdLocal(eventAt(key, timings, base)) !== override.date) continue;
      // AND ONLY WHEN IT STILL DIFFERS FROM THE ROW. An override is
      // written against an instant and the standing setting can move
      // under it: silence one Fajr from the card, then set the Fajr row
      // to silent here, and the two now say the same thing. Calling that
      // "just this once" would tell the reader their permanent change had
      // not taken. The card drops its own marker on the same test, and
      // the two must not disagree about whether anything is temporary.
      return override.mode === alertModeOf(key) ? null : key;
    }
    return null;
  }, [override, selected, visibleRows, timings, alertsEnabled, alertModeOf]);
  /**
   * What the row is set to when nobody has overridden it — what reset
   * puts back. Read the same way the cycling control reads it, master
   * switch included, so the word this promises matches the word that
   * appears once it is pressed.
   */
  const standingModeOf = alertModeOf;
  const resetOverride = useCallback(async () => {
    // Both copies. JS holds the one the scheduler reads; native holds the
    // one the card's button labels itself from, so clearing only this
    // side would leave the button still saying "· once" for a prayer the
    // app had just put back.
    await clearNextAlertOverride();
    await clearNativeAlertOverride();
  }, []);
  /**
   * The longest time on this card, which sizes the time column on all of
   * its rows — see `timeSample` in PrayerRow.
   *
   * Length is the right comparison because the numerals are tabular: two
   * times in the same locale and the same clock format differ only in
   * how many equal-width digits they carry.
   */
  const timeSample = useMemo(
    () =>
      visibleRows.reduce((widest, key) => {
        const shown = clock(timings[key]);
        return shown.length > widest.length ? shown : widest;
      }, ''),
    [visibleRows, timings, clock],
  );
  /**
   * Today's date on today's card — issue #23.
   *
   * Built from the same two callbacks the other days' hero already uses,
   * so the Gregorian half is formatted once for the whole card and the
   * Hijri half cannot drift from the one on the widget.
   */
  const todayDateLine = useMemo(() => {
    const gregorian = getDayDate(0);
    const hijri = getHijriDate?.(0);
    return hijri ? `${gregorian} · ${hijri}` : gregorian;
  }, [getDayDate, getHijriDate]);
  const handleSelect = useCallback((offset: number) => setSelected(offset), []);

  /**
   * What the hero counts down to, and which rows can be aimed at.
   *
   * Only today has either. A row is aimable only while it is still ahead —
   * counting down to a time that has passed is a negative number dressed up
   * as information — and the set is recomputed whenever the next prayer
   * changes, which is the moment one of them stops being ahead.
   */
  const now = nextInfo ? new Date() : null;
  const aimable = useMemo(() => {
    const out = new Set<string>();
    if (!isToday || !now) return out;
    for (const key of visibleRows) {
      const raw = timings[key];
      if (!raw) continue;
      if (combineLocalDateAndTime(now, raw).getTime() > now.getTime()) {
        out.add(key);
      }
    }
    return out;
    // `now` is deliberately not a dependency: it is re-read on every render
    // this memo would run for anyway, and adding it would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, timings, visibleRows.join(','), nextInfo?.name]);

  const target = useMemo(() => {
    if (!isToday || !nextInfo) return null;
    if (!chosenKey) return nextInfo;
    const raw = timings[chosenKey];
    if (!raw) return nextInfo;
    return {
      name: chosenKey,
      at: combineLocalDateAndTime(new Date(), raw),
    };
  }, [isToday, nextInfo, chosenKey, timings]);

  const clearChosen = useCallback(() => setChosenKey(null), []);
  const aimAt = useCallback(
    (key: string) => setChosenKey(current => (current === key ? null : key)),
    [],
  );

  return (
    <GlassSurface
      style={[
        styles.card,
        { borderRadius: HOME_TABLE_RADIUS, ...cardEdgeStyle(palette) },
      ]}
      {...pan.panHandlers}>
      <View
        style={[
          styles.heroWrap,
          {
            backgroundColor: isToday ? palette.accentBg : 'transparent',
          },
        ]}>
        {isToday && target ? (
          <HeroToday
            target={target}
            chosen={chosenKey !== null}
            onExpire={clearChosen}
            today={timings}
            expanded={expanded}
            dateLine={todayDateLine}
          />
        ) : (
          <HeroOtherDay
            label={getDayLabel(selected)}
            date={getDayDate(selected)}
            hijri={getHijriDate?.(selected)}
            timings={timings}
          />
        )}
        {/* Parked in the corner rather than in either hero's own markup:
            the Qibla does not depend on which day is selected, and a chip
            that vanished when the user scrolled to tomorrow would read as
            a bug.

            LAST among the wrapper's children on purpose. Rendered before
            the heroes it drew correctly and then swallowed every tap: the
            eyebrow above the countdown is a full-width `Text`, so it
            overlaps the corner, and a later sibling wins the hit test
            whatever `zIndex` says. */}
        {/* Keyed on the BEARING, not on the callback: on a Mac there is
            no compass screen to open and `onOpenQibla` is undefined, but
            the bearing is trigonometry on two coordinates and is just as
            true there. The chip becomes a readout. */}
        <QiblaChipCorner
          bearing={qiblaBearing ?? null}
          onPress={onOpenQibla}
        />
        {isToday && dataStatus && dataStatus.totalDaysCached > 0 ? (
          <Text
            style={[styles.dataStatus, { color: palette.muted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TABULAR_MAX_FONT_SCALE}>
            {(dataStatus.lastFetchedAt
              ? t('home.updatedAt', {
                  // LTR isolate: a Latin-digit run inside a possibly-RTL
                  // sentence scrambles without it.
                  when: `⁦${clock.fromDate(dataStatus.lastFetchedAt)}⁩`,
                }) + ' · '
              : '') +
              t('home.daysStored', { count: dataStatus.totalDaysCached })}
          </Text>
        ) : null}
      </View>

      <DayStrip days={days} selected={selected} onSelect={handleSelect} />

      {visibleRows.map((key, rowIndex) => (
        <PrayerRow
          key={key}
          prayerKey={key}
          rawTime={timings[key]}
          // Only today can have one — on Thursday nothing is next, and an
          // emphasis that means nothing is just decoration. It follows the
          // hero rather than the clock: see PrayerRow.
          isNext={isToday && target?.name === key}
          isChosen={chosenKey === key}
          onSelect={aimable.has(key) ? () => aimAt(key) : undefined}
          isSecondary={(OPTIONAL_TIME_KEYS as readonly string[]).includes(key)}
          isLast={rowIndex === visibleRows.length - 1}
          // Mālikī second times (issue #19). The boundaries ride in the
          // same map under keys nothing else iterates, so a row that has
          // one shows it and every other row is unchanged.
          daruriAt={timings[`${key}Daruri`]}
          daruriApprox={
            DARURI_CONFIDENCE[`${key}Daruri` as DaruriKey] === 'modelled'
          }
          // Only on today's card. On yesterday's or tomorrow's the
          // control would still change a setting for every day, which
          // is not what a tap on a past row looks like it does.
          // The bell shows what will ACTUALLY happen at this time, which
          // is the override when there is one. A row that showed the
          // standing setting while the card showed something else would
          // be the app holding two answers about one prayer — the thing
          // the alert-mode button exists to stop.
          alertMode={
            isToday
              ? overrideKey === key && override
                ? override.mode
                : alertModeOf(key)
              : undefined
          }
          onCycleAlertMode={
            isToday ? () => cycleAlertMode(key) : undefined
          }
          // Not gated on `isToday`: this one belongs to an instant, and
          // after Isha that instant is on tomorrow's card.
          overrideMode={overrideKey === key ? override?.mode : undefined}
          standingAlertMode={
            overrideKey === key ? standingModeOf(key) : undefined
          }
          onResetAlertMode={overrideKey === key ? resetOverride : undefined}
          timeSample={timeSample}
        />
      ))}

      {onOpenMonth ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.monthTimesLink')}
          accessibilityHint={t('a11y.openMonth')}
          onPress={onOpenMonth}
          style={[
            styles.monthRow,
            { borderTopColor: palette.border ?? palette.muted },
          ]}>
          <Text
            style={[styles.monthLabel, { color: palette.accent }]}
            numberOfLines={1}
            maxFontSizeMultiplier={TITLE_BAND_MAX_FONT_SCALE}>
            {t('home.monthTimesLink')}
          </Text>
          <Text style={[styles.monthChevron, { color: palette.accent }]}>
            {rtl ? '←' : '→'}
          </Text>
        </Pressable>
      ) : null}
    </GlassSurface>
  );
}

export const TodayCard = memo(TodayCardImpl);

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  heroWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  hero: {},
  heroExpanded: { paddingVertical: 10 },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroCountdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 2,
  },
  // The question the app is opened to answer, at the size that says so.
  heroCountdown: { fontSize: 54, fontWeight: '700' },
  heroCountdownExpanded: { fontSize: 78 },
  // Two thirds of the "at" line's weight and a third of the countdown's
  // size: present, readable, and never the thing the eye lands on first.
  heroSeconds: { fontSize: 20, fontWeight: '600', marginStart: -3 },
  heroSecondsExpanded: { fontSize: 28 },
  heroAt: { fontSize: 17, fontWeight: '600' },
  heroDate: { fontSize: 34, fontWeight: '700', marginTop: 2 },
  heroHijri: { fontSize: 14, marginTop: 2 },
  heroTodayDate: { fontSize: 13, marginTop: 10 },
  firstPill: {
    marginTop: 13,
    alignSelf: 'flex-start',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
  },
  firstPillText: { fontSize: 13, fontWeight: '600' },
  railWrap: { marginTop: 11 },
  railTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  railFill: { height: '100%', borderRadius: 3 },
  railLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  railLabel: { fontSize: 11.5, fontWeight: '600' },
  dataStatus: { marginTop: 10, fontSize: 11, fontWeight: '500' },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  monthLabel: { fontSize: 13.5, fontWeight: '600' },
  monthChevron: { fontSize: 15 },
});
