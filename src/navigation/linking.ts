/**
 * Where a `mihrab://` link lands.
 *
 * Widgets are the only sender. Before this existed a widget tap opened the
 * app on whatever screen it was last on, which is fine for a prayer table —
 * the answer is on the widget already — and useless for the ones whose whole
 * promise is a destination: Continue Reading means page 3 of Al-Baqarah, and
 * a streak card means the Log.
 *
 * Declared rather than hand-rolled: React Navigation's own linking config
 * knows how to build the nested state for "the Quran surah screen, pushed on
 * top of the Quran tab", which a manual `navigate()` from a URL listener has
 * to reconstruct by hand and gets wrong on a cold start.
 *
 * The scheme is app-private. Nothing outside the app is expected to send one,
 * and nothing a link can ask for is destructive — the worst a forged
 * `mihrab://` does is change which tab is showing.
 */
import { isMacCatalyst } from '../responsive/breakpoints';
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const MIHRAB_SCHEME = 'mihrab://';

/** Only a positive integer is a surah, a page or an ayah. */
function positiveInt(value: string): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [MIHRAB_SCHEME],
  config: {
    screens: {
      Home: {
        screens: {
          TodayTab: 'today',
          QuranTab: 'quran',
          TasbihTab: 'tasbih',
          DuasTab: 'duas',
          LogTab: 'log',
          SettingsTab: 'settings',
        },
      },
      /**
       * mihrab://read/2?page=3&ayah=5
       *
       * `page` drives the mushaf, `ayah` the translation reader, and the
       * screen already decides between them from what it is given — which is
       * why the widget sends whichever the user last had open rather than
       * this table trying to pick.
       *
       * `playFromAyah` is neither: it says begin reciting here, and it is
       * sent alongside whichever of the two positions the reader needs
       * (issue #25). A link without it opens silently, as every link did
       * before it existed.
       */
      QuranSurah: {
        path: 'read/:surahNumber',
        parse: {
          surahNumber: positiveInt as (v: string) => number,
          initialPage: positiveInt as (v: string) => number,
          scrollToAyah: positiveInt as (v: string) => number,
          playFromAyah: positiveInt as (v: string) => number,
        },
      },
      /**
       * mihrab://sync
       *
       * Pairing is the one settings destination worth reaching directly:
       * it is what a "sync could not finish" notice would link to, and it
       * is the screen someone is sent to when they are standing next to
       * the other device with its code on screen.
       */
      Sync: 'sync',
      MonthTimes: 'month',
      /**
       * Absent on a Mac, where `RootNavigator` does not register the
       * screen. A path that maps to a route the navigator has never
       * heard of is not a no-op — React Navigation warns and the link
       * dies somewhere unhelpful — so the map has to agree with the
       * navigator about what exists.
       */
      ...(isMacCatalyst ? {} : { Compass: 'qibla' as const }),
      Fasting: 'fasting',
    },
  },
};
