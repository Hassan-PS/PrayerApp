/**
 * Handing a widget queue over is not the moment to redraw the widget.
 *
 * Both interactive widgets — Log Today and Tasbih — work the same way: a tap
 * cannot reach the app's storage from a widget process, so it is appended to
 * a queue and the widget draws the queue PROJECTED over the last payload.
 * That projection is what makes the number move under a thumb.
 *
 * A tap therefore lives in exactly one of two places, and there is a window
 * between them:
 *
 *   1. `take` clears the queue and hands the entries to JS
 *   2. the app applies them to its store          (a promise, not yet resolved)
 *   3. the app republishes the payload            (later, and debounced)
 *
 * Between 1 and 3 the tap is in neither: gone from the queue the widget
 * projects, absent from the payload it projects onto. Both `take` methods
 * used to call `requestUpdate` right after clearing — reasoning that the app
 * now owned the taps, which is not true until 3 — and so drew that empty
 * window on screen.
 *
 * On the Tasbih widget that is the whole of a reported bug: press +, the
 * count goes up (projection), snaps back down (this redraw), then up again
 * when the payload lands. On a counter just started that snap-back is
 * literally zero, and after Next it is the previous dhikr's count.
 *
 * The redraw was never needed either: step 3 ends in `setData`, which fans
 * `requestUpdate` out to every widget kind, so the correct redraw already
 * happens at the only moment it is correct.
 */
import { readFileSync } from 'fs';
import path from 'path';

const KOTLIN = path.join(
  __dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'prayer_times',
);
const src = (name: string) => readFileSync(path.join(KOTLIN, `${name}.kt`), 'utf8');

const module_ = src('PrayerWidgetModule');

/** The body of one @ReactMethod, from its signature to the catch. */
const method = (name: string) => {
  const at = module_.indexOf(`fun ${name}(promise: Promise)`);
  expect(at).toBeGreaterThan(-1);
  const end = module_.indexOf('} catch', at);
  expect(end).toBeGreaterThan(at);
  return module_.slice(at, end);
};

/**
 * The same body with the comments taken out.
 *
 * The comments explain why the redraw is gone, and saying so requires
 * naming `requestUpdate` — so an assertion about the CODE has to read only
 * the code, or the explanation trips the check it is explaining.
 */
const code = (name: string) =>
  method(name)
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');

describe('taking a queue does not redraw the widget', () => {
  it.each(['takeLogQueue', 'takeTasbihQueue'])('%s', name => {
    const body = code(name);
    // It must still hand the entries over and clear them...
    expect(body).toMatch(/\.take\(reactContext\)/);
    expect(body).toMatch(/promise\.resolve\(/);
    // ...and it must not draw the window in which they exist nowhere.
    expect(body).not.toMatch(/requestUpdate/);
  });

  it('keeps the reason next to the code, not only in this file', () => {
    // A bare missing line invites someone to add it back for the same
    // plausible reason it was there the first time.
    expect(method('takeTasbihQueue')).toMatch(/NO REDRAW HERE/);
    expect(method('takeLogQueue')).toMatch(/NO REDRAW HERE/);
  });
});

describe('the redraw that replaces it', () => {
  it('setData tells every widget kind, which is what closes the window', () => {
    const body = module_.slice(module_.indexOf('fun setData('));
    expect(body).toMatch(/PrayerWidgetProvider\.requestUpdate\(reactContext\)/);
  });

  it('and requestUpdate reaches the Tasbih widget', () => {
    // If it ever stopped fanning out to this provider, removing the redraw
    // above would strand the count until the next unrelated update.
    expect(src('PrayerWidgetProvider')).toMatch(
      /PrayerWidgetTasbihProvider\.requestUpdate\(context\)/,
    );
  });
});

describe('the tap itself still redraws immediately', () => {
  // The projection is the only feedback a tap has — nothing is written
  // until the app runs — so this redraw is the one that must stay.
  const tasbih = src('PrayerWidgetTasbihProvider');

  it('appends, signals the app, and redraws, in that order', () => {
    const at = tasbih.indexOf('private fun handleTap');
    const body = tasbih.slice(at, tasbih.indexOf('\n    }', at));
    const append = body.indexOf('WidgetTasbihQueue.append');
    const post = body.indexOf('WidgetQueueEvents.postChanged');
    const draw = body.indexOf('requestUpdate(context)');
    expect(append).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(append);
    expect(draw).toBeGreaterThan(post);
  });
});
