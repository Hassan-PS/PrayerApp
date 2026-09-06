package com.prayer_times

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Taps on the Tasbih widget, waiting for the app to apply them.
 *
 * Same shape as `WidgetLogQueue` and for the same reason — the counter lives
 * in the app's own storage, which a widget process cannot reach — but with
 * one difference that changes the rules: a journal entry is a SET and a
 * dhikr count is a SEQUENCE. Tapping Fajr twice means Fajr; tapping +1 twice
 * means two. So nothing is de-duplicated and order is the answer.
 *
 * THE RULES BELOW MUST MATCH `src/widget/widgetTasbihQueue.ts`, whose tests
 * are what say what they are, and `TasbihWidget.swift`, which is the third
 * copy.
 */
object WidgetTasbihQueue {
  const val PREFS_QUEUE_KEY = "widget_tasbih_queue"

  const val ACTION_INC = "inc"
  const val ACTION_RESET = "reset"
  const val ACTION_NEXT = "next"

  private val ACTIONS = setOf(ACTION_INC, ACTION_RESET, ACTION_NEXT)

  /**
   * One action, and how many times it was tapped in a row.
   *
   * ── WHY A RUN AND NOT N ENTRIES ───────────────────────────────────
   *
   * Dhikr arrives in runs — a set is thirty-three beads — and this process
   * has no store of its own, so every tap read the whole queue back out of
   * shared preferences, parsed it, appended, re-serialized ALL of it and
   * rewrote the file, and then the redraw parsed it again to project the
   * number. Measured on an emulator: 47ms a tap on an empty queue and 182ms
   * near the cap, and a phone is slower. Tapping at any speed then backs the
   * broadcast queue up behind a receiver that cannot keep pace, which is how
   * a slow widget becomes "Mihrab isn't responding".
   *
   * A run is one record whose count goes up, so bead three thousand costs
   * what bead one did. `at` is the run's NEWEST tap, so a sitting that
   * crosses the fortnight cutoff is not thrown away while it is still being
   * counted.
   */
  data class Entry(val action: String, val at: Long, val n: Int = 1)

  /**
   * The most taps one run will carry — a bound on what a corrupted queue can
   * ask the drain to replay, not a limit anyone counting can reach.
   * Mirrors MAX_TASBIH_RUN in widgetTasbihQueue.ts.
   */
  const val MAX_RUN = 100_000

  /** How many taps an entry stands for. */
  fun runLength(entry: Entry): Int = entry.n.coerceIn(1, MAX_RUN)

  private fun prefs(context: Context) =
    context.getSharedPreferences(PrayerWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)

  fun read(context: Context): List<Entry> {
    val raw = prefs(context).getString(PREFS_QUEUE_KEY, null) ?: return emptyList()
    return parse(raw)
  }

  fun parse(raw: String): List<Entry> {
    val out = mutableListOf<Entry>()
    try {
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val a = o.optString("a")
        val t = o.optLong("t", 0L)
        // An unknown action is dropped rather than treated as one of the
        // known ones: this ends up in someone's dhikr count.
        if (!ACTIONS.contains(a)) continue
        if (t <= 0L) continue
        // A missing count is one tap — every entry written before runs
        // existed, and every entry any mirror writes for an action that
        // does not coalesce.
        val n = o.optInt("n", 1).coerceIn(1, MAX_RUN)
        out.add(Entry(a, t, n))
      }
    } catch (_: Exception) {
      return emptyList()
    }
    return out
  }

  fun serialize(entries: List<Entry>): String {
    val arr = JSONArray()
    for (e in entries) {
      val o = JSONObject().put("a", e.action).put("t", e.at)
      // Only when it is a run. A single tap stays the shape it has always
      // been, which is what any reader that predates runs expects.
      if (e.n > 1) o.put("n", e.n)
      arr.put(o)
    }
    return arr.toString()
  }

  /**
   * The most taps this queue will hold before it starts forgetting the
   * oldest.
   *
   * Unlike the Log queue, whose ceiling is five prayers a day, this one grows
   * a bead at a time — a single round is thirty-three. Someone who counts on
   * the widget and does not open the app for a fortnight can put tens of
   * thousands of entries in here, and every one of them is re-serialized on
   * the next tap and carried across a Binder transaction on every read. The
   * drain discards anything older than fourteen days anyway, so entries past
   * this point were never going to be written; dropping them at the front
   * costs nothing and keeps a tap O(a home screen) rather than O(a fortnight).
   */
  private const val MAX_ENTRIES = 4000

  /**
   * Append one action.
   *
   * Still no de-duplication — two taps are two beads. What this does is
   * record them TOGETHER: a `+1` on the back of a `+1` bumps the run rather
   * than starting a second record, so the stored queue stops growing with
   * the count. The replayed result is identical by construction.
   *
   * Only `inc` coalesces: two Nexts move two presets on, and neither Next
   * nor Reset is something anyone taps in bursts.
   */
  fun append(context: Context, action: String, now: Long = System.currentTimeMillis()) {
    if (!ACTIONS.contains(action)) return
    val next = compact(read(context) + Entry(action, now)).takeLast(MAX_ENTRIES)
    prefs(context).edit().putString(PREFS_QUEUE_KEY, serialize(next)).apply()
  }

  /**
   * Fold every run of adjacent `+1`s into one entry.
   *
   * ADJACENT is the whole rule: `inc inc next inc` is two beads on one
   * dhikr and one on the next, and merging across the Next would make it
   * three on one.
   *
   * Run over the whole queue on every append rather than only over the
   * newest tap, because a queue written by an older build is a record per
   * bead — thousands of them — and the first tap after an update should
   * leave it compact rather than inheriting the old cost for as long as
   * the queue survives. Mirrors compactTasbihQueue in widgetTasbihQueue.ts.
   */
  fun compact(entries: List<Entry>): List<Entry> {
    val out = mutableListOf<Entry>()
    for (e in entries) {
      val last = out.lastOrNull()
      if (e.action == ACTION_INC && last?.action == ACTION_INC) {
        out[out.size - 1] = Entry(
          ACTION_INC,
          maxOf(last.at, e.at),
          (runLength(last) + runLength(e)).coerceAtMost(MAX_RUN),
        )
      } else {
        out.add(e)
      }
    }
    return out
  }

  /** Hand the queue over and clear it in one step — see WidgetLogQueue.take. */
  fun take(context: Context): List<Entry> {
    val entries = read(context)
    if (entries.isNotEmpty()) {
      prefs(context).edit().remove(PREFS_QUEUE_KEY).apply()
    }
    return entries
  }

  /** What the count IS, given what the app published and what has been tapped. */
  data class Projection(val index: Int, val counts: List<Int>, val todayTotal: Int)

  /**
   * Mirrors `projectTasbih` in widgetTasbihQueue.ts.
   *
   * Two behaviours worth naming because they are invisible when wrong: a
   * bounded preset stops at its target (the preset's own
   * `unboundedAfterTarget`, carried on the payload, says which are which),
   * and Next keeps a part-finished count rather than discarding it.
   */
  fun project(
    index: Int,
    total: Int,
    counts: List<Int>,
    targets: List<Int>,
    unboundedFlags: List<Boolean>,
    todayTotal: Int,
    queue: List<Entry>,
  ): Projection {
    var idx = index
    val out = counts.toMutableList()
    var today = todayTotal
    for (e in queue) {
      val times = runLength(e)
      when (e.action) {
        ACTION_INC -> {
          val current = out.getOrElse(idx) { 0 }
          // The rules that apply are the CURRENT index's, which Next may
          // have moved inside this very loop.
          val target = targets.getOrElse(idx) { 0 }
          val unbounded = unboundedFlags.getOrElse(idx) { false }
          // Arithmetic rather than a loop, landing on exactly what the loop
          // landed on: a run of a thousand against a target three away adds
          // three. This runs on every redraw, so a run has to cost the same
          // to draw as one tap — otherwise the queue stops growing and the
          // drawing does not.
          val room = if (!unbounded && target > 0) (target - current).coerceAtLeast(0) else times
          val applied = minOf(times, room)
          if (applied > 0) {
            if (idx in out.indices) out[idx] = current + applied
            today += applied
          }
        }
        // Resetting twice is resetting.
        ACTION_RESET -> if (idx in out.indices) out[idx] = 0
        ACTION_NEXT -> if (total > 0) idx = (idx + times) % total
      }
    }
    return Projection(idx, out, today)
  }
}
