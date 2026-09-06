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
import { OPTIONAL_TIME_KEYS, isNonPrayerEvent } from '../src/types/prayer';
import {
  COUNTDOWN_KEYS,
  WIDGET_ROW_KEYS,
  EXTRA_ROW_KEYS,
} from '../src/widget/buildWidgetPayload';
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
const SERVICE = read(
  'android/app/src/main/java/com/prayer_times/MihrabLiveActivityService.kt',
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

  it('accounts for every event the card can point at', () => {
    // The button is only ever aimed at `nextKey`, and `nextKey` is a
    // closed list. Whatever is on it is either one of the five — which
    // may sound the adhan — or a time, which may not. There is no third
    // case, and this is what says so: add a fifth optional time to the
    // payload without adding it to OPTIONAL_TIME_KEYS and it would
    // quietly inherit the prayer's three-mode cycle, and the card would
    // offer the call to prayer for it.
    for (const key of COUNTDOWN_KEYS) {
      const isSalah = (WIDGET_ROW_KEYS as readonly string[]).includes(key);
      expect(modesFor(key).includes('adhan')).toBe(isSalah);
    }
  });

  it('has no key on that list that nothing has an opinion about', () => {
    // The other direction: every key the payload can produce is either a
    // salah or a known non-prayer event, so none of them reaches the
    // cycle — or the headless task's channel choice — by accident.
    const salah = new Set<string>(WIDGET_ROW_KEYS);
    const times = new Set<string>(OPTIONAL_TIME_KEYS);
    for (const key of COUNTDOWN_KEYS) {
      expect(salah.has(key) || times.has(key)).toBe(true);
      expect(isNonPrayerEvent(key)).toBe(!salah.has(key));
    }
    // And the times the payload carries are exactly the times the app
    // calls optional — not a subset that leaves one unguarded.
    expect([...EXTRA_ROW_KEYS, 'Sunrise'].sort()).toEqual(
      [...OPTIONAL_TIME_KEYS].sort(),
    );
  });

  it.each([...OPTIONAL_TIME_KEYS])(
    '%s is offered two modes and neither is the adhan',
    key => {
      // Named one by one rather than only as a set: Sunrise is the one
      // anybody thinks of, and Islamic Midnight, the Last Third and the
      // First Third are the three that get forgotten. Each is a time
      // somebody asked to be told about, and none of them is a prayer.
      expect(modesFor(key)).toEqual([...EVENT_ALERT_MODES]);
      expect(modesFor(key)).toHaveLength(2);
      // A full lap comes back where it started, through no third state.
      const first = modesFor(key)[0];
      expect(nextAlertMode(key, nextAlertMode(key, first))).toBe(first);
    },
  );

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


describe('the card the button rebuilds is the card that is on screen', () => {
  /*
   * The service's walk to the next event lived entirely in `lastPayload`, a
   * field on the service. Everything that rebuilds the card from OUTSIDE it
   * — both action buttons, which re-post the instant they are pressed —
   * reads the PERSISTED payload, and that was whatever JS last wrote.
   *
   * Seen on the emulator before the fix: open the app at the First Third,
   * press HOME, let the card advance to Islamic Midnight, press the button.
   * The card fell back to "First Third · -40:19" — a countdown running
   * backwards past an event that had already gone — and the button went with
   * it, aiming the override at an instant nobody can be alerted at.
   *
   * The first fix covered the ticker and MISSED the alarm path, which is the
   * one that matters: in doze the handler ticker is suspended and the exact
   * wake alarm is the only thing that advances the card, so for a phone in a
   * pocket the alarm IS the normal case. These tests hold both.
   */
  it('decides from the stored payload, not from a field on the service', () => {
    // `lastAlarmEpoch` means "changed since this instance last looked", and
    // the alarm path can have advanced and set it already — which left the
    // tick with nothing to do and the write unmade. That was the hole.
    expect(code(SERVICE)).toMatch(
      /private fun persistIfAdvanced\(candidate: String\)[\s\S]*?loadPayload\(this\)[\s\S]*?if \(stored == next\) return[\s\S]*?savePayload\(this, candidate\)/,
    );
  });

  it('is called from the ticker', () => {
    const tick = code(SERVICE).split('private fun scheduleTicker').at(-1) ?? '';
    expect(tick).toContain('persistIfAdvanced(currentPayload)');
  });

  it('is called from the wake-alarm path too, which doze leaves alone', () => {
    const start = code(SERVICE).split('override fun onStartCommand').at(-1) ?? '';
    expect(start).toContain('persistIfAdvanced(payload)');
  });

  it('is not nested inside the alarm-rearm branch', () => {
    // Where the first attempt put it, and where it did not fire.
    const tick = code(SERVICE).split('private fun scheduleTicker').at(-1) ?? '';
    const branch = tick.indexOf('if (nextEpoch != lastAlarmEpoch)');
    const close = tick.indexOf('scheduleWakeAlarm(currentPayload)');
    const call = tick.indexOf('persistIfAdvanced(currentPayload)');
    expect(branch).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(close);
  });

  it('rebuilds from the persisted payload in the receiver', () => {
    // Which is only safe because of the above.
    expect(code(RECEIVER)).toContain('MihrabLiveActivityModule.loadPayload(ctx)');
  });
});

describe('a tap can only speak for an event that has not arrived', () => {
  it('ignores one aimed at a past instant', () => {
    // One PendingIntent is reused across re-posts, so between a prayer
    // arriving and the next rebuild the button still carries the epoch that
    // just passed. A tap there would write an override for a moment nobody
    // can be alerted at, and throw away one the user had set for it.
    expect(code(RECEIVER)).toMatch(
      /if \(epoch <= System\.currentTimeMillis\(\)\) \{[\s\S]{0,200}?return\s*\n\s*\}/,
    );
  });

  it('and the task refuses one too, on the other side of the boundary', () => {
    const ts = read('src/notifications/adhanMute.ts');
    expect(ts).toMatch(/if \(epoch <= Date\.now\(\)\) return;/);
  });
});

describe('the "once" marker means something', () => {
  it('is drawn from a comparison with the row, not from mere existence', () => {
    // An override is written against an instant and the standing setting can
    // move under it. Set Fajr to silent on the card, then set the Fajr row to
    // silent on the home screen, and the two agree — marking that "· once"
    // would tell the reader their permanent change had not taken.
    expect(code(KOTLIN)).toMatch(
      /fun isOverridden\([\s\S]*?val base = baseModeFor\(p, key\)[\s\S]*?base\.isEmpty\(\) \|\| o != coerce\(key, base\)/,
    );
    expect(code(MODULE)).toContain(
      'LiveActivityAlertModes.isOverridden(prefs, p, nextEpochMs, nextKey)',
    );
  });
});

describe('there is one list of what is not a prayer, on each side', () => {
  it('the service does not keep a third copy', () => {
    // It did, for a payload flag the walks no longer set — and the First
    // Third was missing from it, which made the evening mark the one event an
    // auto-advance could still hand the adhan. Three copies is how that
    // happens.
    expect(code(SERVICE)).not.toMatch(/fun isNonPrayerKey/);
    expect(code(SERVICE)).not.toContain('adhanActionEnabled');
  });

  it('and nothing clears a per-hop flag that no longer exists', () => {
    // The guard travels on the row now: the modes an event may hold are
    // decided from its own key, on every build. A hop cannot outrun that.
    expect(code(SERVICE)).not.toMatch(/put\("adhanActionEnabled"/);
    expect(code(SERVICE)).not.toMatch(/put\("alertActionEnabled"/);
  });
});
