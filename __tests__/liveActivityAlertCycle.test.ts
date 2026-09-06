/**
 * The card's action button and the home row are the same control.
 *
 * They were not. The row cycles a prayer through adhan → alert → silent
 * and the card offered "Mute next adhan" — two states, and the only
 * thing it could say was "not the adhan". Someone whose Fajr was already
 * set to the plain alert was offered a mute for an adhan that was never
 * going to play, and someone who wanted silence could not get it from
 * the card at all: the old mute rescheduled onto the plain channel
 * rather than cancelling.
 *
 * So the button became the row. What has to hold for that to be true:
 *
 *   1. the card starts from what the prayer is actually set to;
 *   2. it offers the same modes in the same order, three for a prayer
 *      and two for Sunrise and the night marks;
 *   3. and it stays temporary — one occurrence, addressed by its
 *      instant, and never written back to the standing setting.
 *
 * Two of those are a claim about Kotlin, which has no JVM tests here, so
 * they are read out of the source. That is weaker than running it and it
 * is the reason the constants are stated in one place on each side: what
 * this file can do is refuse to let the two lists drift apart.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
  SALAH_ALERT_MODES,
  EVENT_ALERT_MODES,
  nextAlertMode,
  modesFor,
} from '../src/settings/alertModes';
import { OPTIONAL_TIME_KEYS } from '../src/types/prayer';
import {
  parseNextAlertOverride,
  overrideAppliesTo,
} from '../src/notifications/adhanMute';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf-8');
const KOTLIN = read(
  'android/app/src/main/java/com/prayer_times/LiveActivityAlertModes.kt',
);
const RECEIVER = read(
  'android/app/src/main/java/com/prayer_times/MihrabLiveActivityActionReceiver.kt',
);
const MODULE = read(
  'android/app/src/main/java/com/prayer_times/MihrabLiveActivityModule.kt',
);

/** Source with `//` comment lines dropped — a claim about what the code
 *  does must not be satisfied by a comment that mentions it. */
const code = (s: string) =>
  s
    .split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

describe('the two sides agree on what the modes are', () => {
  const listOf = (name: string) => {
    const m = new RegExp(`val ${name}: List<String> = listOf\\(([^)]*)\\)`).exec(
      KOTLIN,
    );
    return m
      ? m[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [];
  };
  // Kotlin names the constants; map them back to the strings they hold.
  const constOf = (name: string) =>
    new RegExp(`const val ${name} = "([a-z]+)"`).exec(KOTLIN)?.[1] ?? '';
  const resolve = (names: string[]) => names.map(constOf);

  it('offers a prayer the same three, in the same order', () => {
    expect(resolve(listOf('SALAH_MODES'))).toEqual([...SALAH_ALERT_MODES]);
  });

  it('offers Sunrise and the night marks the same two', () => {
    expect(resolve(listOf('EVENT_MODES'))).toEqual([...EVENT_ALERT_MODES]);
  });

  it('calls the same times "not a prayer"', () => {
    const m = /NON_PRAYER_KEYS: Set<String> =\s*\n?\s*setOf\(([^)]*)\)/.exec(
      KOTLIN,
    );
    const keys = (m?.[1] ?? '')
      .split(',')
      .map(s => s.trim().replace(/"/g, ''))
      .filter(Boolean)
      .sort();
    expect(keys).toEqual([...OPTIONAL_TIME_KEYS].sort());
  });

  it('never lets the adhan reach one of them', () => {
    // Both directions of the same guard: the list a night mark cycles
    // through, and the coercion applied to anything that arrives from
    // outside the process.
    for (const key of OPTIONAL_TIME_KEYS) {
      expect(modesFor(key)).not.toContain('adhan');
      let mode = modesFor(key)[0];
      // Walk the whole cycle twice; 'adhan' must not appear anywhere in it.
      for (let i = 0; i < 5; i++) {
        expect(mode).not.toBe('adhan');
        mode = nextAlertMode(key, mode);
      }
    }
    expect(code(KOTLIN)).toMatch(
      /fun coerce\(key: String, mode: String\): String =\s*\n?\s*if \(modesFor\(key\)\.contains\(mode\)\) mode else modesFor\(key\)\[0\]/,
    );
  });
});

describe('the button starts from what the prayer is set to', () => {
  it('reads the mode off the row rather than off the payload head', () => {
    // The card walks to the next event natively, with no JS running. A
    // single "the next one is set to X" field would be describing the
    // previous prayer within minutes.
    expect(code(KOTLIN)).toContain('fun baseModeFor(p: JSONObject, key: String)');
    expect(code(KOTLIN)).toContain('optJSONArray("days")');
    expect(code(KOTLIN)).toMatch(/arrayOf\("rows", "extraRows"\)/);
    expect(code(KOTLIN)).toContain('optJSONObject("sunriseRow")');
  });

  it('prefers the override, and falls back to the row', () => {
    expect(code(KOTLIN)).toMatch(
      /fun effectiveMode\([\s\S]*?overrideFor\(prefs, epochMs, key\)\?\.let \{ return it \}[\s\S]*?baseModeFor\(p, key\)/,
    );
  });

  it('labels the button with the state, not with a verb', () => {
    // "Mute next adhan" could not answer the question the reader has —
    // what happens at Fajr? The three state words can, and they are the
    // home row's own, so the two never name one mode differently.
    expect(code(MODULE)).toContain('alertLabelAdhan');
    expect(code(MODULE)).toContain('alertLabelSilent');
    expect(code(MODULE)).toContain('alertLabelNotification');
    expect(code(MODULE)).not.toContain('muteLabel');
    expect(code(MODULE)).not.toContain('unmuteLabel');
  });

  it('marks the label temporary only while it is', () => {
    expect(code(MODULE)).toMatch(
      /if \(alertOverridden\) joinDot\(stateWord, p\.optString\("alertOnceWord"/,
    );
    expect(code(MODULE)).toMatch(/else stateWord/);
  });
});

describe('one tap is one step, and the step is recomputed at tap time', () => {
  it('carries only the instant and the key in the PendingIntent', () => {
    // FLAG_UPDATE_CURRENT keeps one PendingIntent alive across re-posts.
    // A mode baked into its extras could be applied long after the card
    // had moved on; the receiver reads the current one back instead.
    const action = code(MODULE).split('alertActionEnabled')[1] ?? '';
    expect(action).toContain('EXTRA_EPOCH, nextEpochMs');
    expect(action).toContain('EXTRA_NAME, nextKey');
    expect(action).not.toContain('EXTRA_MODE');
  });

  it('reads the current mode back before stepping', () => {
    expect(code(RECEIVER)).toMatch(
      /val current =[\s\S]*?LiveActivityAlertModes\.effectiveMode\(prefs, payload, epoch, name\)/,
    );
    expect(code(RECEIVER)).toMatch(
      /val next = LiveActivityAlertModes\.nextMode\(name, current\)/,
    );
  });

  it('clears the override when the cycle comes back round', () => {
    expect(code(KOTLIN)).toMatch(
      /if \(mode == baseMode\) \{\s*\n?\s*e\.remove\(KEY_OVERRIDE_EPOCH\)\.remove\(KEY_OVERRIDE_MODE\)/,
    );
  });

  it('still tells JS about it when it clears', () => {
    // An earlier step may have cancelled or re-channelled the alert;
    // dropping the override alone would not put it back.
    const dispatch =
      code(RECEIVER).split('Intent(ctx, AdhanMuteHeadlessService')[1] ?? '';
    expect(dispatch).toContain('putExtra(EXTRA_MODE, next)');
    // Unconditionally: no `if` between the store and the dispatch.
    expect(code(RECEIVER)).not.toMatch(/if \(next != base\)[\s\S]{0,200}startService/);
  });

  it('never writes the standing setting', () => {
    // The whole difference between this control and the home row.
    for (const src of [KOTLIN, RECEIVER, MODULE]) {
      expect(code(src)).not.toContain('prayerAlertModes');
    }
  });
});

describe('an override speaks for one occurrence', () => {
  const o = { epoch: 1_800_000_000_000, name: 'Fajr', mode: 'silent' as const };

  it('matches only its own instant', () => {
    expect(overrideAppliesTo(o, o.epoch, 'Fajr')).toBe(true);
    expect(overrideAppliesTo(o, o.epoch + 86_400_000, 'Fajr')).toBe(false);
  });

  it('matches only its own event', () => {
    // The epoch alone would carry an override across a schedule change
    // that moved another event onto the same minute.
    expect(overrideAppliesTo(o, o.epoch, 'Sunrise')).toBe(false);
  });

  it('is nothing at all when there is none', () => {
    expect(overrideAppliesTo(null, o.epoch, 'Fajr')).toBe(false);
  });

  it('round-trips what the task writes', () => {
    expect(parseNextAlertOverride(JSON.stringify(o))).toEqual(o);
  });

  it('reads the old mute marker as the plain alert', () => {
    // The two-state button's mute rescheduled onto the default channel
    // rather than cancelling, so it meant "alert", not "silent". An
    // install that updated between a mute and the prayer it muted would
    // otherwise have heard the adhan anyway.
    expect(parseNextAlertOverride('1800000000000-Fajr')).toEqual({
      epoch: 1_800_000_000_000,
      name: 'Fajr',
      mode: 'notification',
    });
  });

  it('refuses the adhan for a time that is not a prayer', () => {
    expect(
      parseNextAlertOverride(
        JSON.stringify({ epoch: 1, name: 'Sunrise', mode: 'adhan' }),
      ),
    ).toEqual({ epoch: 1, name: 'Sunrise', mode: 'notification' });
  });

  it('refuses nonsense rather than guessing', () => {
    for (const raw of ['', null, undefined, 'nope', '{', '{"epoch":0}']) {
      expect(parseNextAlertOverride(raw)).toBeNull();
    }
  });
});

describe('silent means no alarm, not a quiet one', () => {
  it('cancels the trigger instead of re-channelling it', () => {
    // Same as the home row, and the only reading that also keeps the
    // prayer off the lock screen.
    const ts = read('src/notifications/adhanMute.ts');
    expect(ts).toMatch(
      /if \(mode === 'silent'\) \{[\s\S]*?cancelTriggerNotification\(id\)/,
    );
  });

  it('drops the occurrence from the audible list on a resync', () => {
    const ts = read('src/notifications/prayerNotifications.ts');
    expect(ts).toMatch(
      /audibleEvents = salahEvents\.filter\(\s*\n?\s*e => modeAt\(e\.name, e\.at\.getTime\(\)\) !== 'silent',?\s*\n?\s*\)/,
    );
  });

  it('leaves the standing mode alone when the override does not match', () => {
    const ts = read('src/notifications/prayerNotifications.ts');
    expect(ts).toMatch(
      /overrideAppliesTo\(nextAlertOverride, atMs, name\)[\s\S]{0,200}?standingModeOf\(name\)/,
    );
  });
});

describe('no locale is still carrying the retired strings', () => {
  const LOCALES = 'src/i18n/locales';
  const codes: string[] = readdirSync(path.join(ROOT, LOCALES)).filter(f =>
    f.endsWith('.json'),
  );

  it.each(codes)('%s has the once marker and neither mute string', f => {
    const j = JSON.parse(read(path.join(LOCALES, f)));
    expect(typeof j.liveActivity.justThisOne).toBe('string');
    expect(j.liveActivity.justThisOne.length).toBeGreaterThan(0);
    expect(j.liveActivity.muteNext).toBeUndefined();
    expect(j.liveActivity.unmuteNext).toBeUndefined();
  });
});
