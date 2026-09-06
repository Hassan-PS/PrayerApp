/**
 * The Tasbih widget's queue. These rules are copied into Swift and Kotlin,
 * so this file is the one that decides what they are.
 */
import {
  appendTasbihAction,
  coerceTasbihQueue,
  drainWidgetTasbihQueue,
  partitionTasbihQueue,
  projectTasbih,
  tasbihRunLength,
  MAX_TASBIH_QUEUE_AGE_MS,
  MAX_TASBIH_RUN,
  type WidgetTasbihEntry,
} from '../src/widget/widgetTasbihQueue';

const NOW = 1_700_000_000_000;

const base = (over: Partial<Parameters<typeof projectTasbih>[0]> = {}) => ({
  index: 0,
  total: 6,
  counts: [0, 0, 0, 0, 0, 0],
  targets: [33, 33, 34, 100, 0, 0],
  unboundedFlags: [false, false, false, false, false, false],
  todayTotal: 0,
  ...over,
});

describe('coerceTasbihQueue', () => {
  it('keeps well-formed entries', () => {
    expect(
      coerceTasbihQueue([
        { a: 'inc', t: NOW },
        { a: 'next', t: NOW + 1 },
      ]),
    ).toEqual([
      { a: 'inc', t: NOW },
      { a: 'next', t: NOW + 1 },
    ]);
  });

  it('drops an action it does not know', () => {
    // Not "treat it as inc": this ends up in someone's dhikr count.
    expect(coerceTasbihQueue([{ a: 'decrement', t: NOW }])).toEqual([]);
  });

  it('drops junk shapes without throwing', () => {
    expect(coerceTasbihQueue(null)).toEqual([]);
    expect(coerceTasbihQueue('[]')).toEqual([]);
    expect(coerceTasbihQueue([null, 3, { a: 'inc' }, { t: NOW }])).toEqual([]);
    expect(coerceTasbihQueue([{ a: 'inc', t: -1 }])).toEqual([]);
  });
});

describe('a run count read back from another process', () => {
  it('treats a missing count as one tap', () => {
    // Every entry written before runs existed, and every entry the Swift
    // and Kotlin mirrors write for an action that does not coalesce.
    const [e] = coerceTasbihQueue([{ a: 'inc', t: NOW }]);
    expect(tasbihRunLength(e)).toBe(1);
    expect(e.n).toBeUndefined();
  });

  it('clamps a count that could not have come from tapping', () => {
    // The drain replays a run one bead at a time into the real store, so a
    // corrupted count is a number of writes, not just a wrong total.
    //
    // Asserted on the coerced ENTRY, not on what `tasbihRunLength` returns:
    // that function clamps too, so reading through it passed happily with
    // the clamp here deleted. The queue is what crosses a process boundary,
    // so the queue is what has to be clean.
    expect(coerceTasbihQueue([{ a: 'inc', t: NOW, n: 1e12 }])[0].n).toBe(
      MAX_TASBIH_RUN,
    );
    for (const bad of [0, -5, 1.5, NaN, Infinity, 'x', null]) {
      const [entry] = coerceTasbihQueue([{ a: 'inc', t: NOW, n: bad }]);
      const stored = entry.n ?? 1;
      expect(stored).toBeGreaterThanOrEqual(1);
      expect(stored).toBeLessThanOrEqual(MAX_TASBIH_RUN);
      expect(Number.isInteger(stored)).toBe(true);
    }
  });
});

describe('appendTasbihAction', () => {
  // The rule this has always protected is about BEADS, not about records.
  // It used to be written as "two taps make two entries", which stopped
  // being the storage shape when runs arrived and was never the point.
  it('does not de-duplicate — two taps are two beads', () => {
    let q: WidgetTasbihEntry[] = [];
    q = appendTasbihAction(q, 'inc', NOW);
    q = appendTasbihAction(q, 'inc', NOW);
    expect(projectTasbih(base(), q).counts[0]).toBe(2);
    expect(projectTasbih(base(), q).todayTotal).toBe(2);
  });

  it('records a run of taps as one entry', () => {
    // The fix for the slow widget. Every tap used to re-read, re-parse and
    // re-write the whole queue; a thousand beads now cost what one did.
    let q: WidgetTasbihEntry[] = [];
    for (let i = 0; i < 1000; i++) q = appendTasbihAction(q, 'inc', NOW + i);
    expect(q).toHaveLength(1);
    expect(tasbihRunLength(q[0])).toBe(1000);
  });

  it('collapses a queue an older build wrote, on the first tap', () => {
    // The upgrade path. Before runs existed every bead was its own record,
    // and a long backlog would have gone on costing a full re-parse and
    // re-serialize per tap until the app was next opened.
    const legacy: WidgetTasbihEntry[] = [];
    for (let i = 0; i < 2000; i++) legacy.push({ a: 'inc', t: NOW + i });
    const after = appendTasbihAction(legacy, 'inc', NOW + 2000);
    expect(after).toHaveLength(1);
    expect(tasbihRunLength(after[0])).toBe(2001);
    // And it still says exactly what it said before.
    expect(
      projectTasbih(
        base({ unboundedFlags: [true, false, false, false, false, false] }),
        after,
      ).counts[0],
    ).toBe(2001);
  });

  it('keeps the run as fresh as its newest bead', () => {
    // Otherwise a sitting that crosses the fortnight cutoff would be thrown
    // away halfway through, while someone was still counting it.
    let q: WidgetTasbihEntry[] = [];
    q = appendTasbihAction(q, 'inc', NOW);
    q = appendTasbihAction(q, 'inc', NOW + 60_000);
    expect(q[0].t).toBe(NOW + 60_000);
  });

  it('does not run a tap into one it did not follow', () => {
    // Ordering is the answer. `inc inc next inc` is two beads here and one
    // there, and coalescing across the Next would merge them into three.
    let q: WidgetTasbihEntry[] = [];
    q = appendTasbihAction(q, 'inc', NOW);
    q = appendTasbihAction(q, 'inc', NOW);
    q = appendTasbihAction(q, 'next', NOW);
    q = appendTasbihAction(q, 'inc', NOW);
    expect(q).toHaveLength(3);
    const out = projectTasbih(base(), q);
    expect(out.counts[0]).toBe(2);
    expect(out.counts[1]).toBe(1);
  });

  it('never coalesces Next or Reset into a run', () => {
    // Two Nexts move two presets on; folding them together would move one.
    let q: WidgetTasbihEntry[] = [];
    q = appendTasbihAction(q, 'next', NOW);
    q = appendTasbihAction(q, 'next', NOW);
    expect(q).toHaveLength(2);
    expect(projectTasbih(base(), q).index).toBe(2);
  });
});

describe('a run replays exactly as the taps would have', () => {
  // The arithmetic in projectTasbih replaced a loop. These pin it to the
  // loop's answer rather than to my arithmetic.
  const replayOneByOne = (
    over: Partial<Parameters<typeof projectTasbih>[0]>,
    n: number,
  ) => {
    let out = base(over);
    for (let i = 0; i < n; i++) {
      const step = projectTasbih(out, [{ a: 'inc', t: NOW }]);
      out = { ...out, ...step };
    }
    return step0(out);
  };
  const step0 = (o: {
    counts: number[];
    todayTotal: number;
    index: number;
  }) => ({
    counts: o.counts,
    todayTotal: o.todayTotal,
    index: o.index,
  });

  it('lands where a bounded preset would have, mid-target', () => {
    const over = { counts: [30, 0, 0, 0, 0, 0], todayTotal: 30 };
    const run = projectTasbih(base(over), [{ a: 'inc', t: NOW, n: 1000 }]);
    expect(step0(run)).toEqual(replayOneByOne(over, 1000));
    // And the number itself: three left of thirty-three.
    expect(run.counts[0]).toBe(33);
    expect(run.todayTotal).toBe(33);
  });

  it('lands where an unbounded preset would have', () => {
    const over = {
      index: 4,
      counts: [0, 0, 0, 0, 5, 0],
      unboundedFlags: [false, false, false, false, true, false],
      todayTotal: 5,
    };
    const run = projectTasbih(base(over), [{ a: 'inc', t: NOW, n: 500 }]);
    expect(step0(run)).toEqual(replayOneByOne(over, 500));
    expect(run.counts[4]).toBe(505);
  });

  it('adds nothing once the target is already met', () => {
    const over = { counts: [33, 0, 0, 0, 0, 0], todayTotal: 33 };
    const run = projectTasbih(base(over), [{ a: 'inc', t: NOW, n: 900 }]);
    expect(run.counts[0]).toBe(33);
    expect(run.todayTotal).toBe(33);
  });
});

describe('projectTasbih', () => {
  it('counts up', () => {
    const out = projectTasbih(base(), [
      { a: 'inc', t: NOW },
      { a: 'inc', t: NOW },
    ]);
    expect(out.counts[0]).toBe(2);
    expect(out.todayTotal).toBe(2);
  });

  it('stops a bounded preset at its target', () => {
    const out = projectTasbih(
      base({ counts: [32, 0, 0, 0, 0, 0], todayTotal: 32 }),
      [
        { a: 'inc', t: NOW },
        { a: 'inc', t: NOW },
        { a: 'inc', t: NOW },
      ],
    );
    expect(out.counts[0]).toBe(33);
    expect(out.todayTotal).toBe(33);
  });

  it('lets an unbounded preset carry on past it', () => {
    const out = projectTasbih(
      base({
        counts: [33, 0, 0, 0, 0, 0],
        unboundedFlags: [true, false, false, false, false, false],
        todayTotal: 33,
      }),
      [{ a: 'inc', t: NOW }],
    );
    expect(out.counts[0]).toBe(34);
  });

  it('treats target 0 as no target', () => {
    const out = projectTasbih(
      base({ targets: [0, 33, 34, 100, 0, 0], counts: [99, 0, 0, 0, 0, 0] }),
      [{ a: 'inc', t: NOW }],
    );
    expect(out.counts[0]).toBe(100);
  });

  it('reset clears the active set only', () => {
    const out = projectTasbih(base({ counts: [10, 7, 0, 0, 0, 0] }), [
      { a: 'reset', t: NOW },
    ]);
    expect(out.counts[0]).toBe(0);
    expect(out.counts[1]).toBe(7);
  });

  it('reset does not take the day back down', () => {
    // The day's total is a record of beads counted, not of beads showing.
    const out = projectTasbih(
      base({ counts: [10, 0, 0, 0, 0, 0], todayTotal: 10 }),
      [{ a: 'reset', t: NOW }],
    );
    expect(out.todayTotal).toBe(10);
  });

  it("applies the NEW preset's target after Next", () => {
    // The widget's own Next moves the index in this process, before the app
    // has run — so the rules that apply from that point are the new dhikr's.
    // Preset 2 has a target of 34 here; stopping at 33 would be the old
    // one's rule following the user across.
    const out = projectTasbih(base({ index: 1, counts: [0, 0, 33, 0, 0, 0] }), [
      { a: 'next', t: NOW },
      { a: 'inc', t: NOW },
    ]);
    expect(out.index).toBe(2);
    expect(out.counts[2]).toBe(34);
  });

  it('next wraps and keeps every count', () => {
    const out = projectTasbih(base({ index: 5, counts: [4, 0, 0, 0, 0, 9] }), [
      { a: 'next', t: NOW },
    ]);
    expect(out.index).toBe(0);
    expect(out.counts[5]).toBe(9);
  });

  it('replays in order, because order is the answer', () => {
    // +1 +1 next +1 → two on the first dhikr and one on the second. Any
    // other order is a different result.
    const out = projectTasbih(base(), [
      { a: 'inc', t: NOW },
      { a: 'inc', t: NOW },
      { a: 'next', t: NOW },
      { a: 'inc', t: NOW },
    ]);
    expect(out.counts[0]).toBe(2);
    expect(out.counts[1]).toBe(1);
    expect(out.index).toBe(1);
    expect(out.todayTotal).toBe(3);
  });
});

describe('partitionTasbihQueue', () => {
  it('drops taps older than a fortnight', () => {
    const { apply, stale } = partitionTasbihQueue(
      [
        { a: 'inc', t: NOW - MAX_TASBIH_QUEUE_AGE_MS - 1 },
        { a: 'inc', t: NOW - 1000 },
      ],
      NOW,
    );
    expect(apply).toHaveLength(1);
    expect(stale).toHaveLength(1);
  });
});

describe('drainWidgetTasbihQueue', () => {
  it('replays each action into the store, in order', async () => {
    const calls: string[] = [];
    const result = await drainWidgetTasbihQueue({
      take: async () => [
        { a: 'inc', t: NOW },
        { a: 'next', t: NOW },
        { a: 'reset', t: NOW },
      ],
      increment: () => calls.push('inc'),
      reset: () => calls.push('reset'),
      next: () => calls.push('next'),
      now: NOW,
    });
    expect(calls).toEqual(['inc', 'next', 'reset']);
    expect(result).toEqual({ applied: 3, dropped: 0, failed: 0 });
  });

  it('replays a run bead by bead', async () => {
    // The entry is one record; it stands for five taps, and the store's own
    // rules — the target, the round counter, the day roll — are applied one
    // increment at a time. Every other test here uses single taps, so
    // without this one a drain that read the run as a single bead passed.
    const calls: string[] = [];
    const result = await drainWidgetTasbihQueue({
      take: async () => [
        { a: 'inc', t: NOW, n: 5 },
        { a: 'next', t: NOW },
      ],
      increment: () => calls.push('inc'),
      reset: () => calls.push('reset'),
      next: () => calls.push('next'),
      now: NOW,
    });
    expect(calls).toEqual(['inc', 'inc', 'inc', 'inc', 'inc', 'next']);
    // Beads, not records.
    expect(result).toEqual({ applied: 6, dropped: 0, failed: 0 });
  });

  it('counts a failing write instead of throwing', async () => {
    const result = await drainWidgetTasbihQueue({
      take: async () => [{ a: 'inc', t: NOW }],
      increment: () => {
        throw new Error('storage full');
      },
      reset: () => {},
      next: () => {},
      now: NOW,
    });
    expect(result.failed).toBe(1);
    expect(result.applied).toBe(0);
  });

  it('survives a take that returns nonsense', async () => {
    const result = await drainWidgetTasbihQueue({
      take: async () => 'not a queue',
      increment: () => {},
      reset: () => {},
      next: () => {},
      now: NOW,
    });
    expect(result).toEqual({ applied: 0, dropped: 0, failed: 0 });
  });
});
