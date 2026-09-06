/**
 * Ayah of the day — v2.7.27.
 *
 * A daily notification at the user's chosen time carrying THE SAME ayah the
 * Quran screen shows that day, with its translation in the active edition —
 * the same "default tafsir" resolution the reader uses.
 *
 * The two used to disagree, which was the whole point of the feature going
 * wrong: the card drew from `verseOfTheDayRef` (date-seeded, so everyone
 * sees the same verse on the same day) while the notification drew a fresh
 * uniform random ayah per day. Open the app after reading the notification
 * and you were looking at a different verse. Both now come from
 * `verseOfTheDayRef`, seeded by the day the notification fires.
 *
 * Strategy mirrors `fastingReminders.ts`:
 *   • Schedule the next 14 days as individual TIMESTAMP triggers with
 *     stable ids (`ayah-day-YYYY-MM-DD`), each carrying that DAY's verse.
 *   • Re-sync (cancel + schedule) whenever the toggle/time/edition/
 *     language changes and on app foreground (see `useAyahOfDaySync`),
 *     so the 14-day window keeps rolling forward.
 *
 * Plain visible notification on the default sound — never the adhan.
 */

import notifee, {
  AndroidImportance,
  AndroidStyle,
  TriggerType,
} from '@notifee/react-native';
import i18n from '../i18n';
import { findSurah, loadSurah, SURAHS } from '../quran/quran';
import { verseOfTheDayRef } from '../quran/search';
import {
  defaultEditionForLocale,
  editionMatchesLocale,
  getAyahTranslation,
  type QuranTranslationId,
} from '../quran/translations';
import { loadTafsir, resolveTafsirEdition } from '../quran/tafsir';

const AYAH_DAY_ID_PREFIX = 'ayah-day-';
const AYAH_DAY_CHANNEL_ID = 'prayer_app_ayah_of_day';
const LOOK_AHEAD_DAYS = 14;

/** Resolve the active edition outside React (same rule as useActiveEdition). */
export function resolveEditionForNotification(
  quranTranslationEdition: string,
  language: string,
): QuranTranslationId {
  if (
    quranTranslationEdition &&
    editionMatchesLocale(quranTranslationEdition, language)
  ) {
    return quranTranslationEdition as QuranTranslationId;
  }
  return defaultEditionForLocale(language);
}

/**
 * Uniform random ayah reference over all 6,236 ayahs.
 *
 * No longer used for the daily notification — that follows the app's own
 * date-seeded verse of the day now — but kept (and tested) as the corpus
 * index→reference mapping.
 */
export function randomAyahRef(
  rand: () => number = Math.random,
): { surah: number; ayah: number } {
  const total = SURAHS.reduce((sum, s) => sum + s.ayahCount, 0);
  let n = Math.floor(rand() * total);
  for (const s of SURAHS) {
    if (n < s.ayahCount) return { surah: s.number, ayah: n + 1 };
    n -= s.ayahCount;
  }
  return { surah: 1, ayah: 1 };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The verse for one day, with its text — the SAME reference the Quran
 * screen's card shows on that date.
 *
 * A handful of ayahs (2:282, the "debt verse") run most of a page and can
 * never render whole in a notification. They are clipped in the body rather
 * than swapped for a shorter verse: a notification that quietly showed a
 * different ayah than the app is the bug this function exists to close.
 */
async function ayahForDay(
  day: Date,
  edition: QuranTranslationId,
): Promise<{
  ref: { surah: number; ayah: number };
  arabic: string;
  translation: string;
}> {
  const ref = verseOfTheDayRef(day);
  let arabic = '';
  try {
    const loaded = await loadSurah(ref.surah);
    arabic = loaded?.arabic[ref.ayah - 1] ?? '';
  } catch {
    // Arabic text unavailable — translation-only body still works.
  }
  const translation =
    (await getAyahTranslation(edition, ref.surah, ref.ayah)) ?? '';
  return { ref, arabic, translation };
}

/** Cancel every scheduled ayah-of-the-day notification. */
export async function cancelAllAyahOfDay(): Promise<void> {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    const ours = ids.filter(id => id.startsWith(AYAH_DAY_ID_PREFIX));
    if (ours.length > 0) {
      await Promise.all(ours.map(id => notifee.cancelTriggerNotification(id)));
    }
  } catch (e) {
    console.warn('cancelAllAyahOfDay failed:', e);
  }
}

/**
 * Re-schedule the rolling 14-day window. Replaces any existing triggers.
 * No-op (after cancelling) when disabled.
 */
export async function rescheduleAyahOfDay(opts: {
  enabled: boolean;
  hour: number;
  minute: number;
  /** Raw settings value; resolved against `language` internally. */
  quranTranslationEdition: string;
  language: string;
  /** App-wide companion mode (v2.7.40) — 'tafsir' swaps the second body
   *  paragraph for a tafsir excerpt in the chosen edition, falling back to
   *  the translation when the text isn't cached and can't be fetched. */
  companionMode?: 'translation' | 'tafsir';
  /** Raw stored tafsir edition id; resolved against `language` internally. */
  tafsirEditionId?: string;
  now?: Date;
}): Promise<void> {
  await cancelAllAyahOfDay();
  if (!opts.enabled) return;

  const hour = Math.max(0, Math.min(23, Math.floor(opts.hour)));
  const minute = Math.max(0, Math.min(59, Math.floor(opts.minute)));
  const now = opts.now ?? new Date();
  const edition = resolveEditionForNotification(
    opts.quranTranslationEdition,
    opts.language,
  );
  const wantsTafsir = opts.companionMode === 'tafsir';
  const tafsirEdition = wantsTafsir
    ? resolveTafsirEdition(opts.tafsirEditionId ?? '', opts.language)
    : null;

  try {
    await notifee.createChannel({
      id: AYAH_DAY_CHANNEL_ID,
      name: i18n.t('quran.ayahOfDayChannelName', 'Ayah of the day'),
      importance: AndroidImportance.DEFAULT,
    });
  } catch {
    // Non-fatal.
  }

  for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
    const fireAt = new Date(now);
    fireAt.setDate(fireAt.getDate() + i);
    fireAt.setHours(hour, minute, 0, 0);
    if (fireAt.getTime() <= now.getTime()) continue;

    const { ref, arabic, translation } = await ayahForDay(fireAt, edition);
    const surahMeta = findSurah(ref.surah);

    // Companion paragraph follows the app-wide mode (v2.7.40): tafsir when
    // chosen (network/cache — falls back to the translation on failure).
    let companion = translation;
    if (wantsTafsir && tafsirEdition) {
      try {
        const tafsir = await loadTafsir(tafsirEdition.id, ref.surah, ref.ayah);
        if (tafsir) companion = tafsir;
      } catch {
        // Keep the translation fallback.
      }
    }

    const refLabel = `${surahMeta?.romanized ?? ''} ${ref.surah}:${ref.ayah}`;
    // BigTextStyle renders the whole thing on expand (like a long chat message),
    // so keep the caps generous; a blank line separates Arabic from translation.
    const body = [clip(arabic, 400), clip(companion, 500)]
      .filter(Boolean)
      .join('\n\n');

    try {
      await notifee.createTriggerNotification(
        {
          id: `${AYAH_DAY_ID_PREFIX}${ymd(fireAt)}`,
          title: `${i18n.t('quran.ayahOfDayTitle', 'Ayah of the day')} · ${refLabel}`,
          body,
          data: { surah: String(ref.surah), ayah: String(ref.ayah) },
          android: {
            channelId: AYAH_DAY_CHANNEL_ID,
            smallIcon: 'ic_stat_prayer',
            // BigTextStyle — the full ayah + translation on expand.
            style: { type: AndroidStyle.BIGTEXT, text: body },
            pressAction: { id: 'default', launchActivity: 'default' },
          },
          ios: {
            sound: 'default',
          },
        },
        {
          type: TriggerType.TIMESTAMP,
          timestamp: fireAt.getTime(),
        },
      );
    } catch (e) {
      console.warn('Failed to schedule ayah of the day', ymd(fireAt), e);
    }
  }
}
