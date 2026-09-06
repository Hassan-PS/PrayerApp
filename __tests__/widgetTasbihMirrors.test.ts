/**
 * The two mirrors of the tasbih queue.
 *
 * `widgetTasbihQueue.ts` decides the rules; `WidgetTasbihQueue.kt` and
 * `TasbihWidget.swift` copy them, because the widget process cannot reach
 * the app's store and has to answer "what is the number" on the same frame
 * as the tap. Three copies of a rule is three chances to drift, and a drift
 * here is a bead that the widget counts and the app does not.
 *
 * Runs made that worse, so it is pinned here. A mirror that kept writing a
 * record per bead would still be correct — and still slow, which is the
 * whole point of the change. A mirror that coalesced the wrong action, or
 * replayed a run one bead at a time on every redraw, would be neither.
 */
import fs from 'fs';
import path from 'path';
import { MAX_TASBIH_RUN } from '../src/widget/widgetTasbihQueue';

const REPO = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const KOTLIN = read(
  'android/app/src/main/java/com/prayer_times/WidgetTasbihQueue.kt',
);
const SWIFT = read('ios/PrayerWidgetExtension/TasbihWidget.swift');

describe('every mirror records a run instead of a record per bead', () => {
  it('carries a count on the entry', () => {
    expect(KOTLIN).toMatch(/data class Entry\(.*val n: Int = 1\)/);
    expect(SWIFT).toMatch(/var n: Int\?/);
  });

  it('coalesces a tap onto the run before it', () => {
    expect(KOTLIN).toContain(
      'e.action == ACTION_INC && last?.action == ACTION_INC',
    );
    expect(SWIFT).toContain(
      'e.a == "inc", let last = out.last, last.a == "inc"',
    );
  });

  it('compacts the whole queue, not just the newest tap', () => {
    // A queue written by an older build is a record per bead — thousands of
    // them. The first tap after an update has to leave it compact, or the
    // old cost is inherited for as long as that queue survives.
    expect(KOTLIN).toContain('compact(read(context) + Entry(action, now))');
    expect(SWIFT).toContain('compact(read() + [Entry(a: action, t: now)])');
  });

  it('coalesces nothing but the counter', () => {
    // Two Nexts move two presets on and two Resets are one Reset. Folding
    // either would change what the queue means, not just how it is stored.
    for (const src of [KOTLIN, SWIFT]) {
      expect(src).not.toMatch(
        /ACTION_NEXT\s*&&\s*last\?\.action\s*==\s*ACTION_NEXT/,
      );
      expect(src).not.toMatch(/action == "next", let last/);
      expect(src).not.toMatch(/action == "reset", let last/);
    }
  });
});

describe('every mirror draws a run in constant time', () => {
  // A redraw happens on every tap. If the projection replayed a run bead by
  // bead, the queue would stop growing and the drawing would not — which is
  // half of the bug still in place.
  it('applies a run with arithmetic, not a loop', () => {
    expect(KOTLIN).toContain('val applied = minOf(times, room)');
    expect(SWIFT).toContain('let applied = min(times, room)');
  });

  it('advances Next by the run length rather than by one', () => {
    expect(KOTLIN).toContain('idx = (idx + times) % total');
    expect(SWIFT).toContain(
      'index = t.total > 0 ? (index + times) % t.total : index',
    );
  });
});

describe('the mirrors agree with the rules file', () => {
  it('bounds a run at the same number everywhere', () => {
    expect(MAX_TASBIH_RUN).toBe(100_000);
    expect(KOTLIN).toContain('const val MAX_RUN = 100_000');
    expect(SWIFT).toContain('static let maxRun = 100_000');
  });

  it('treats a missing count as one tap', () => {
    // What every entry written before runs existed looks like, and what a
    // mirror writes for an action that does not coalesce.
    expect(KOTLIN).toContain('o.optInt("n", 1)');
    expect(SWIFT).toContain('e.n ?? 1');
  });

  it('writes the count only when it is a run', () => {
    // So a single tap keeps the shape any reader that predates runs expects.
    expect(KOTLIN).toContain('if (e.n > 1) o.put("n", e.n)');
  });
});
