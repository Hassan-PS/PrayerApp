/**
 * Iconography system — task #37.
 *
 * The app uses `react-native-svg` (already a dep) for icons rather than a
 * pre-built icon library — keeps the bundle slim and lets us hand-tune
 * a small set for the unique islamic-art accents (crescent, mihrab arch,
 * geometric star).
 *
 * Two layers:
 *
 *   • Generic-utility icons (calendar, compass, settings) — already in
 *     `src/components/HeaderToolbarIcons.tsx`. Style = stroked,
 *     2 px width, 24 px viewBox, monochrome via `color` prop.
 *
 *   • App-specific motifs — declared here as inline SVG component factories.
 *     Used for the seasonal treatments (#41) and the empty-state
 *     illustrations (#42).
 *
 * Style guide:
 *   • All icons rendered as 24 × 24 by default.
 *   • Stroke width 2, line caps round, line joins round.
 *   • Single-color via `color` prop — never multi-color (principle 4:
 *     "the app shouldn't shout").
 *   • Triangle-trick borders (`borderLeftWidth + transparent`) require a
 *     `// rtl-safe: triangle geometry` comment per task #14 conventions.
 */

import * as React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

/**
 * Settings gear — the ONE gear in the app (v2.8.5).
 *
 * There used to be two: this cog in the Home header toolbar, and a
 * sun-burst approximation drawn inline for the Settings tab. Side by side
 * in the same app they read as two different destinations, and the burst
 * reads as brightness before it reads as settings. The header gear is now
 * the shared one; the tab uses it too.
 *
 * Lucide's cog outline — a toothed ring, not a flower, which survives
 * being drawn at 22pt on a tab bar.
 */
export function SettingsGearIcon({
  size = 24,
  color = '#000',
  strokeWidth = 2,
}: IconProps & { strokeWidth?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no">
      <Path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Open mushaf — the Quran shortcut's hero icon (v2.7.30). An open book
 *  with soft text-line hints on each page and a rehl-style base notch so
 *  it reads as a mushaf, not a generic book. Stroked, single-color, per
 *  the style guide. */
export function QuranBookIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Open covers, drawn as one mirrored outline. */}
      <Path
        d="M12 6C10.6 4.6 8.6 4 6.4 4 5 4 3.7 4.3 2.5 4.8V19c1.2-.5 2.5-.8 3.9-.8 2.2 0 4.2.7 5.6 2 1.4-1.3 3.4-2 5.6-2 1.4 0 2.7.3 3.9.8V4.8C20.3 4.3 19 4 17.6 4 15.4 4 13.4 4.6 12 6Z"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Spine */}
      <Path
        d="M12 6v14.2"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      {/* Ayah-line hints, two per page. */}
      <Path
        d="M5.2 8.5c1.3-.25 2.6-.15 3.9.3M5.2 11.3c1.3-.25 2.6-.15 3.9.3M18.8 8.5c-1.3-.25-2.6-.15-3.9.3M18.8 11.3c-1.3-.25-2.6-.15-3.9.3"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Crescent moon — used for Ramadan banner, dynamic icon variant.
 *  Geometric, never decorative wallpaper (principle 2: reverent, not heavy). */
export function CrescentIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
        fill={color}
      />
    </Svg>
  );
}

/** Mihrab arch — used as a quiet header accent. */
export function MihrabArchIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5 21V14a7 7 0 0114 0v7"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 21h14"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Mihrab logo icon — matches the actual app launcher icon geometry.
 *
 * Outer pointed arch minus inner cutout rendered with evenodd fill rule so the
 * interior is transparent (shows the header/theme background through it).
 * An eight-pointed star sits inside the niche.
 *
 * Paths derived from branding/01_mihrab.svg (1024×1024 canvas), scaled to a
 * 24×24 viewBox with 14 px arch width and 1.5 px top padding.
 *
 * Use when the full brand mark is needed — e.g. the home screen header title.
 */
export function MihrabLogoIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Arch frame: outer arch - inner cutout (evenodd → centre is transparent) */}
      <Path
        // Outer: M5 22.5 ... Z  Inner: M6.7 21.4 ... Z
        d="M5 22.5 L5 10.2 Q5 6.5 8.4 4.3 L12 1.5 L15.6 4.3 Q19 6.5 19 10.2 L19 22.5 Z M6.7 21.4 L6.7 10.5 Q6.7 7.4 9.6 5.6 L12 3.7 L14.4 5.6 Q17.3 7.4 17.3 10.5 L17.3 21.4 Z"
        fillRule="evenodd"
        fill={color}
      />
      {/* Eight-pointed star — two overlapping squares rotated 45° apart.
          Centred at (12, 13.7), half-side 2.5 px. */}
      <Path
        d="M9.5 11.2 H14.5 V16.2 H9.5 Z"
        fill={color}
      />
      <Path
        d="M9.5 11.2 H14.5 V16.2 H9.5 Z"
        fill={color}
        transform="rotate(45, 12, 13.7)"
      />
    </Svg>
  );
}

/** 8-pointed star — Islamic geometric motif used as Eid flourish.
 *  Reverent accent only — never tiled, never used as background. */
export function EightPointStarIcon({ size = 24, color = '#000' }: IconProps) {
  // Two overlaid squares rotated 45° → 8-point star.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2l3 6 6 1.5-4.5 4.5 1.5 6-6-3-6 3 1.5-6L3 9.5 9 8z"
        fill={color}
      />
    </Svg>
  );
}

/** Tasbih beads — small line of 5 dots used for the Tasbih nav button. */
export function TasbihIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {[4, 8, 12, 16, 20].map((cx, i) => (
        <Circle
          key={i}
          cx={cx}
          cy={12}
          r={2}
          fill={i === 2 ? color : 'none'}
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
    </Svg>
  );
}

/** Open book — used for Quran nav button and reading-streak badge. */
export function BookIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M2 4.5A2.5 2.5 0 014.5 2H10v18H4.5A2.5 2.5 0 012 17.5V4.5z"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M22 4.5A2.5 2.5 0 0019.5 2H14v18h5.5a2.5 2.5 0 002.5-2.5V4.5z"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Two cupped hands raised in dua — used for the duas/supplications nav
 *  tile. Stylised as two slightly-opened palms meeting at the base, the
 *  classic Islamic dua gesture. */
export function DuaHandsIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Left palm */}
      <Path
        d="M11.5 21V11.5a2 2 0 00-4 0v3.2c-1.4-.4-2.5-.4-2.5 1 0 1.4 1.5 5.3 4 5.3"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right palm (mirrored) */}
      <Path
        d="M12.5 21V11.5a2 2 0 014 0v3.2c1.4-.4 2.5-.4 2.5 1 0 1.4-1.5 5.3-4 5.3"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Three small accents above the hands — abstract "ascending dua" hint */}
      <Path
        d="M12 5v2M9 6.5l.5 1.5M15 6.5l-.5 1.5"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Pen — used for the journal nav tile (writing entries). Classic
 *  pen-tilted-up silhouette. */
export function PenIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Pen body */}
      <Path
        d="M14.5 4l5.5 5.5-11 11H3v-6L14.5 4z"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Nib hint — diagonal line near the tip */}
      <Path
        d="M13 5.5l5.5 5.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Map pin / location marker — used for the "Use device location" CTA on
 *  the welcome / location-setup screen. */
export function MapPinIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 22s7-7.58 7-13a7 7 0 10-14 0c0 5.42 7 13 7 13z"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={12}
        cy={9}
        r={2.5}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
    </Svg>
  );
}

/** Magnifying glass — used for the "Search city or coords" CTA. */
export function SearchIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={11}
        cy={11}
        r={7}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
      <Path
        d="M16.5 16.5L21 21"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Mosque silhouette — used for the mosque-finder nav button and as the
 *  empty-state illustration for "no mosques found nearby." */
export function MosqueIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* dome */}
      <Path
        d="M6 12a6 6 0 1112 0"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      {/* crescent atop dome */}
      <Circle cx={12} cy={3.5} r={1} fill={color} />
      {/* base wall */}
      <Path
        d="M3 12v9h18v-9"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* archway */}
      <Path
        d="M10 21v-3a2 2 0 014 0v3"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Share — the node graph, not the box-and-arrow.
 *
 * Two conventions exist and they are platform-bound: iOS draws a square
 * with an arrow leaving the top, Android draws three connected nodes.
 * Mihrab ships one icon on both, so the question is which one is legible
 * to someone who does not use the other platform — and the node graph is,
 * because it depicts the idea (one thing going to others) rather than a
 * gesture out of one OS's visual language.
 *
 * Stroked at 2, round caps, single colour: the house style above.
 */
export function ShareIcon({
  size = 24,
  color = '#000',
}: {
  size?: number;
  // Wider than the shared `IconProps`, which types colour as a string.
  // This one is drawn in `palette.muted`, and on iOS that is a real
  // `PlatformColor('secondaryLabel')` rather than a hex — the whole
  // reason the palette types it as `ColorValue`.
  color?: ColorValue;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={18}
        cy={5}
        r={3}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={6}
        cy={12}
        r={3}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={18}
        cy={19}
        r={3}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8.59 13.51L15.42 17.49"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15.41 6.51L8.59 10.49"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
