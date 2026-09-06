/**
 * Taps on the Tasbih widget, waiting for the app to apply them.
 *
 * Same shape as `widgetLogQueue.ts` and for the same reason — the counter
 * lives in the app's own storage, which a widget process cannot reach — but
 * with one difference that changes everything about the rules: a journal
 * entry is a SET and a dhikr count is a SEQUENCE. Tapping Fajr twice means
 * Fajr; tapping +1 twice means two. So this is an ordered log that is
 * replayed, not a set that is merged, and "already queued" is not a case.
 *
 * That makes ordering load-bearing. `+1 +1 next +1` leaves two beads on one
 * dhikr and one on the next; any other order is a different result, and a
 * queue that reordered would silently mis-record someone's dhikr.
 *
 * THE RULES HERE ARE THE ONES THE SWIFT AND KOTLIN MIRRORS COPY. The tests
 * in `__tests__/widgetTasbihQueue.test.ts` are what say what they are.
 */

/** The three things the widget's buttons can ask for. */
export const TASBIH_ACTIONS = ['inc', 'reset', 'next'] as const;

export type WidgetTasbihAction = (typeof TASBIH_ACTIONS)[number];

export type WidgetTasbihEntry = {
  /** The action. */
  a: WidgetTasbihAction;
  /** Epoch ms, for ageing the queue out — not for ordering, which is
   *  array order: two taps in the same millisecond are still two taps in
   *  the order they arrived.
   *
   *  For a coalesced run this is the LAST tap in it, so a run someone is
   *  still adding to cannot age out from under them while they count. */
  t: number;
  /**
   * How many times this action was tapped in a row. Absent means once.
   *
   * ── WHY A COUNT AND NOT N ENTRIES ─────────────────────────────────
   *
   * Dhikr arrives in runs: a set is thirty-three beads, and a fortnight of
   * counting on the widget without opening the app is thousands. Every one
   * of them used to be its own record, and the widget process has no store
   * of its own — so each tap read the whole queue back out of shared
   * preferences, parsed the JSON, appended, re-serialized ALL of it and
   * wrote the file again, and then the redraw parsed it a third time to
   * project the number. Measured on an emulator at roughly the cap: 47ms a
   * tap on an empty queue, 182ms on a full one, and the arithmetic is worse
   * on a phone. Tapping at any speed then backs up the broadcast queue,
   * which is what turns a slow widget into "Mihrab isn't responding".
   *
   * A run is one entry whose count goes up, so the queue stays a handful of
   * records however long someone counts, and a tap costs the same on bead
   * three thousand as on bead one. Ordering still means what it meant —
   * `inc×2 next inc` is two beads then one on the next dhikr — because a
   * run is only ever coalesced with the tap immediately before it.
   */
  n?: number;
};

/**
 * The most taps one run will carry.
 *
 * Not a limit anyone counting can reach: it is a bound on what a corrupted
 * or hostile queue can ask the drain to replay, since the drain applies a
 * run one bead at a time into the real store.
 */
export const MAX_TASBIH_RUN = 100_000;

/** How many taps an entry stands for. */
export function tasbihRunLength(entry: WidgetTasbihEntry): number {
  const n = entry.n ?? 1;
  return Number.isFinite(n) ? Math.min(MAX_TASBIH_RUN, Math.max(1, Math.floor(n))) : 1;
}

/**
 * Anything older than this is dropped rather than applied.
 *
 * Same fortnight the log queue uses. A count from two weeks ago arriving as
 * a surprise is worse than a count quietly lost — the user has long since
 * stopped believing the widget was going to do anything.
 */
export const MAX_TASBIH_QUEUE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A queue read back from another process, with anything that could not have
 * come from a real tap removed. Unknown actions are dropped rather than
 * treated as one of the known ones: this ends up in someone's dhikr count.
 */
export function coerceTasbihQueue(input: unknown): WidgetTasbihEntry[] {
  if (!Array.isArray(input)) return [];
  const out: WidgetTasbihEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { a, t, n } = raw as { a?: unknown; t?: unknown; n?: unknown };
    if (typeof a !== 'string') continue;
    if (!(TASBIH_ACTIONS as readonly string[]).includes(a)) continue;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue;
    // A missing count is one tap — which is every entry written before runs
    // existed, and every entry a Swift or Kotlin mirror writes for an action
    // that does not coalesce.
    const runs =
      typeof n === 'number' && Number.isFinite(n)
        ? Math.min(MAX_TASBIH_RUN, Math.max(1, Math.floor(n)))
        : 1;
    out.push(
      runs > 1
        ? { a: a as WidgetTasbihAction, t, n: runs }
        : { a: a as WidgetTasbihAction, t },
    );
  }
  return out;
}

/**
 * Fold every run of adjacent `+1`s into one entry.
 *
 * ADJACENT is the whole rule. `inc inc next inc` is two beads on one dhikr
 * and one on the next, and merging across the Next would make it three on
 * one — so a run is only ever joined to the tap immediately before it.
 * Nothing else folds: two Nexts move two presets on, and two Resets are one
 * Reset but are not worth a special case.
 *
 * Run on every append rather than only on the newest tap, because a queue
 * written by an older build is a record per bead — thousands of them — and
 * the first tap after an update should leave it compact rather than
 * inheriting the cost for as long as the queue survives.
 */
export function compactTasbihQueue(
  queue: WidgetTasbihEntry[],
): WidgetTasbihEntry[] {
  const out: WidgetTasbihEntry[] = [];
  for (const e of queue) {
    const last = out[out.length - 1];
    if (e.a === 'inc' && last && last.a === 'inc') {
      const n = Math.min(
        MAX_TASBIH_RUN,
        tasbihRunLength(last) + tasbihRunLength(e),
      );
      // The run is as fresh as its newest bead, so a sitting that spans the
      // fortnight cutoff is not thrown away mid-count.
      out[out.length - 1] = { a: 'inc', t: Math.max(last.t, e.t), n };
      continue;
    }
    out.push(e);
  }
  return out;
}

/**
 * Append one action.
 *
 * Still no de-duplication — two taps are two beads, and always were. What
 * this does instead is RECORD them together: a `+1` on the back of a `+1`
 * bumps the run rather than starting a second record. The replayed result
 * is identical by construction (see `n` on the entry type); what changes is
 * that the queue stops growing with the count.
 */
export function appendTasbihAction(
  queue: WidgetTasbihEntry[],
  action: WidgetTasbihAction,
  now: number,
): WidgetTasbihEntry[] {
  return compactTasbihQueue([...queue, { a: action, t: now }]);
}

/** Split a queue into what to replay and what has gone stale. */
export function partitionTasbihQueue(
  queue: WidgetTasbihEntry[],
  now: number,
  maxAgeMs: number = MAX_TASBIH_QUEUE_AGE_MS,
): { apply: WidgetTasbihEntry[]; stale: WidgetTasbihEntry[] } {
  const apply: WidgetTasbihEntry[] = [];
  const stale: WidgetTasbihEntry[] = [];
  for (const e of queue) {
    // A run's `t` is its newest bead, so a sitting that started before the
    // cutoff and continued after it survives whole. Splitting a run at the
    // boundary would mean deciding which of somebody's beads were too old,
    // and they were all tapped in one sitting.
    if (now - e.t > maxAgeMs) stale.push(e);
    else apply.push(e);
  }
  return { apply, stale };
}

/**
 * What the widget should DRAW, given the counter the app last published and
 * the taps this device has queued since.
 *
 * A projection, not a write. The widget has to answer "what is the number"
 * on the same frame as the tap, and the real store is in another process —
 * so both the widget and this function replay the queue over the payload,
 * and the app replays it over the store. Same input, same rules, so the two
 * cannot show different numbers.
 *
 * `unbounded` is the preset's own `unboundedAfterTarget`, which the widget
 * must honour rather than inventing a rule: some dhikr stop at their target
 * and some carry on, and the screen already knows which.
 */
export function projectTasbih(
  base: {
    /** Index of the active preset in TASBIH_PRESETS. */
    index: number;
    /** How many presets there are, for wrapping. */
    total: number;
    /** Per-preset counts, indexed as `counts[index]`. */
    counts: number[];
    /**
     * Every preset's target and unbounded flag, in the same order.
     *
     * Per-preset rather than "the active one", because Next moves the index
     * inside this very function — after one press the rules that apply are
     * the NEW preset's, and using the old one's target would let a bounded
     * dhikr count past its own or stop short of it.
     */
    targets: number[];
    unboundedFlags: boolean[];
    todayTotal: number;
  },
  queue: WidgetTasbihEntry[],
): { index: number; counts: number[]; todayTotal: number } {
  let index = base.index;
  const counts = [...base.counts];
  let todayTotal = base.todayTotal;

  for (const e of queue) {
    const times = tasbihRunLength(e);
    switch (e.a) {
      case 'inc': {
        const current = counts[index] ?? 0;
        const target = base.targets[index] ?? 0;
        const unbounded = base.unboundedFlags[index] === true;
        // A bounded preset stops at its target. Counting past it on the
        // widget and not in the app is the one way these two can disagree
        // about a number the user is watching.
        //
        // Arithmetic rather than a loop, and it lands on exactly what the
        // loop landed on: a run of a thousand beads against a target three
        // away adds three. This runs on every redraw, so a run has to cost
        // the same to draw as a single tap — otherwise the queue stops
        // growing and the drawing does not.
        const room = !unbounded && target > 0 ? Math.max(0, target - current) : times;
        const applied = Math.min(times, room);
        if (applied > 0) {
          counts[index] = current + applied;
          todayTotal += applied;
        }
        break;
      }
      case 'reset':
        // Only the active set, matching the screen's "Reset set". The
        // day's total is a record of beads counted, not of beads still
        // showing, so it does not come back down.
        //
        // Repeats collapse: resetting twice is resetting.
        counts[index] = 0;
        break;
      case 'next':
        // Wraps, and keeps every count. Moving on from a part-finished
        // dhikr must not discard it — that is what the screen does, and a
        // widget that quietly threw it away would be the worse surprise.
        index = base.total > 0 ? (index + times) % base.total : index;
        break;
    }
  }

  return { index, counts, todayTotal };
}

export type TasbihDrainDeps = {
  /** Take the queue from the widget side and clear it, in one step. */
  take: () => Promise<unknown>;
  /** Add one bead to the active preset. */
  increment: () => void;
  /** Clear the active preset's count. */
  reset: () => void;
  /** Move to the next preset, keeping counts. */
  next: () => void;
  now?: number;
  maxAgeMs?: number;
};

export type TasbihDrainResult = {
  /** Taps replayed — beads, not records: a run of thirty-three counts 33. */
  applied: number;
  /** Taps too old to apply, counted the same way. */
  dropped: number;
  failed: number;
};

/**
 * Replay the queue into the real store.
 *
 * Never throws: the queue is already gone by the time anything in here can
 * fail, so there is nothing to retry and nothing to put back. A tasbih count
 * is not worth an unhandled rejection on app start.
 */
export async function drainWidgetTasbihQueue(
  deps: TasbihDrainDeps,
): Promise<TasbihDrainResult> {
  const now = deps.now ?? Date.now();
  const queue = coerceTasbihQueue(await deps.take());
  const { apply, stale } = partitionTasbihQueue(queue, now, deps.maxAgeMs);

  let applied = 0;
  let failed = 0;
  for (const e of apply) {
    // A run is replayed bead by bead. The store's own rules — the target,
    // the round counter, the day roll — are applied one increment at a
    // time, and shortcutting them here would be this file deciding things
    // that belong to the counter.
    const times = tasbihRunLength(e);
    for (let i = 0; i < times; i++) {
      try {
        if (e.a === 'inc') deps.increment();
        else if (e.a === 'reset') deps.reset();
        else deps.next();
        applied += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { applied, dropped: stale.length, failed };
}
