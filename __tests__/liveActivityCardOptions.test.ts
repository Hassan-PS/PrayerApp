/**
 * The two Live Activity settings, end to end.
 *
 * Both were asked for, both were built, and neither had a line of test
 * behind it — which is the state in which a feature quietly stops
 * existing. A setting is only real if it survives the whole chain: the
 * stored value, the row that changes it, the payload that carries it,
 * and the Kotlin that acts on it.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), 'utf8');

const types = read('src', 'settings', 'types.ts');
const card = read('src', 'screens', 'settings', 'LiveActivityCard.tsx');
const bridge = read('src', 'notifications', 'liveActivity.ts');
const kotlin = read(
  'android', 'app', 'src', 'main', 'java', 'com', 'prayer_times',
  'MihrabLiveActivityModule.kt',
);

describe('the lock-screen button can be turned off', () => {
  it('is a stored setting, on by default', () => {
    expect(types).toMatch(/liveActivityLockButton: boolean;/);
    expect(types).toMatch(/liveActivityLockButton: true,/);
  });

  it('has a row in Settings, and only on Android', () => {
    expect(card).toMatch(
      /Platform\.OS === 'android' && settings\.liveActivityEnabled \?/,
    );
    expect(card).toMatch(/update\(\{ liveActivityLockButton: v \}\)/);
    // Absent means on: a stored `false` is the only thing that hides it,
    // so an install from before the toggle existed keeps the button.
    expect(card).toMatch(/settings\.liveActivityLockButton !== false/);
  });

  it('reaches the card as aodActionEnabled', () => {
    expect(bridge).toMatch(/lockButton = s\.liveActivityLockButton !== false/);
    expect(bridge).toMatch(/aodActionEnabled: lockButton,/);
  });

  it('and the card only draws the button when it is on', () => {
    expect(kotlin).toMatch(/if \(p\.optBoolean\("aodActionEnabled", false\)\) \{/);
  });
});

/**
 * The second metric stopped being a question.
 *
 * It was a picker on the countdown design with three choices, then two: a
 * stopwatch counting up since the previous prayer (retired — on a card whose
 * point is one number falling to zero, a second clock climbing away from it
 * reads as a contradiction), 'None', and the next prayer's clock time.
 *
 * The clock time is the one fact a countdown does not carry, and it costs a
 * line the card already has. Nobody chooses to know less, so 'None' went too
 * — and a picker with one answer left is a question that should not have
 * been asked. The setting is gone; the clock time is always there.
 */
describe('the countdown always shows the prayer time', () => {
  it('there is no stored setting for it any more', () => {
    expect(types).not.toMatch(/liveActivitySecondMetric:/);
    // The reasoning stays behind in a comment where the field was, so the
    // next person does not re-add the picker.
    expect(types).toMatch(/`liveActivitySecondMetric` used to live here/);
  });

  it('and no picker in Settings', () => {
    expect(card).not.toMatch(/liveActivitySecondMetric/);
    expect(card).not.toMatch(/laSecondMetric/);
  });

  it('the bridge sends it unconditionally', () => {
    expect(bridge).not.toMatch(/liveActivitySecondMetric/);
    expect(bridge).toMatch(/secondMetric: 'time',/);
  });

  it('and the Kotlin defaults to it, so an old payload gets it too', () => {
    // The default matters on its own: a card rebuilt from a payload written
    // by a build that still sent "off" would otherwise keep hiding it.
    expect(kotlin).toMatch(/p\.optString\("secondMetric", "time"\)/);
  });

  it('the Kotlin has no stopwatch branch left', () => {
    // "time" is the only second metric it knows how to build; everything
    // else is no second metric at all.
    expect(kotlin).toMatch(/val second: Any\? = when \(secondKind\) \{\s*"time" ->/);
    expect(kotlin).not.toMatch(/"elapsed"/);
    expect(kotlin).not.toMatch(/setBase\(/);
  });

  it('leaves no orphaned strings in any locale', () => {
    const locales = require('fs')
      .readdirSync(path.join(ROOT, 'src', 'i18n', 'locales'))
      .filter((f: string) => f.endsWith('.json'));
    expect(locales.length).toBeGreaterThan(1);
    for (const f of locales) {
      expect(read('src', 'i18n', 'locales', f)).not.toContain('laSecondMetric');
    }
  });
});

/**
 * One prayer, one countdown.
 *
 * Every card runs `setUsesChronometer(true)` with
 * `setChronometerCountDown(true)` — the platform ticking the seconds down to
 * the prayer in the header slot, for free, and on the always-on display too.
 * The timeline and markers designs ALSO baked a countdown into the title,
 * built in JS at minute resolution and only moving when the service
 * re-posted. So the card carried two countdowns to the same instant that
 * disagreed with each other for most of every minute.
 *
 * The title is the prayer's name now — the one thing the chronometer cannot
 * say.
 */
describe('timeline and markers show one countdown, not two', () => {
  it('the title is the prayer name, with no countdown appended', () => {
    expect(kotlin).toMatch(
      /val inlineTitle = if \(nextLabel\.isNotEmpty\(\)\) nextLabel else title/,
    );
    expect(kotlin).toMatch(
      /nextLabel\.isNotEmpty\(\) -> nextLabel\s*\n\s*else -> title/,
    );
    // The interpolation that put the countdown in the title, in either
    // builder, is what must not come back.
    expect(kotlin).not.toContain('"$nextLabel · $countdown"');
  });

  it('and the platform chronometer is still the thing that ticks', () => {
    // Removing the title countdown is only correct because this stays.
    expect(kotlin).toMatch(/setUsesChronometer\(true\)/);
    expect(kotlin).toMatch(/setChronometerCountDown\(true\)/);
    expect(kotlin).toMatch(/setShowWhen\(true\)/);
  });

  it('the countdown design still puts the countdown in its title', () => {
    // That design has no duplicate to remove: its whole point is the
    // countdown as the largest text on the card.
    expect(kotlin).toMatch(/builder\.setContentTitle\(countdown\)/);
  });

  it('and the Settings previews show the card that is actually built', () => {
    // The three thumbnails in Settings are the only place someone compares
    // the designs, so a preview drawing the old two-countdown shape would
    // sell a card that no longer exists. Timeline and markers show the
    // countdown in the header slot with the prayer name as the title,
    // which is the hierarchy the notification has.
    expect(card).not.toContain('Maghrib · 2:18');
    expect(card).toMatch(/styles\.previewHeader[\s\S]{0,60}2:18:42/);
    expect(card).toMatch(/styles\.previewRow[\s\S]{0,40}>Maghrib</);
  });
});
