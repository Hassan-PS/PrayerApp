package com.prayer_times

import android.content.SharedPreferences
import org.json.JSONObject

/**
 * How the upcoming event announces itself, and what one tap on the card
 * changes it to.
 *
 * This is the native half of `src/settings/alertModes.ts`. The home rows
 * cycle a prayer through adhan → alert → silent; the Live Activity's
 * action button is now the same control, so the two have to agree about
 * three things — which modes a row may hold, what order they cycle in,
 * and that Sunrise and the night marks never reach the adhan. They are
 * stated once on each side and pinned against each other by
 * `__tests__/liveActivityAlertCycle.test.ts`, because a mismatch here
 * would not fail a build: it would just make the button do something
 * different from the row above it.
 *
 * ── WHY THE MODE TRAVELS ON EVERY ROW ───────────────────────────────
 *
 * The card advances to the next event by itself, in the foreground
 * service, with no JS running — that is the whole reason it can count
 * down for a day without the app being opened. So the payload cannot
 * say "the next one is set to X": within minutes that sentence is about
 * the previous prayer. Every row of every day carries its own `mode`
 * instead, and the lookup below is by key, which is safe precisely
 * because a mode belongs to the prayer rather than to the day.
 *
 * ── AND WHY THE OVERRIDE IS AN OCCURRENCE, NOT A NAME ───────────────
 *
 * The button is temporary by design: it speaks for THIS Fajr and not for
 * Fajr. What identifies "this Fajr" was the instant, and an instant is
 * the one thing about a prayer that is not fixed — the time is recomputed
 * whenever its inputs move, and the override, pinned to the old
 * millisecond, then matched nothing. Failing quietly would be one thing;
 * this failed loudly, because no match means the prayer falls back to its
 * standing setting and that is usually the adhan.
 *
 * So it is the event and the local day it falls on: "Fajr, on the
 * eighth", which is what the user meant and which survives the clock time
 * underneath being recalculated. The epoch is still carried, for
 * scheduling — but it no longer decides anything.
 */
object LiveActivityAlertModes {
  const val ADHAN = "adhan"
  const val NOTIFICATION = "notification"
  const val SILENT = "silent"

  /** Mirrors SALAH_ALERT_MODES in src/settings/alertModes.ts. */
  val SALAH_MODES: List<String> = listOf(ADHAN, NOTIFICATION, SILENT)

  /** Mirrors EVENT_ALERT_MODES — Sunrise and the night marks get two of
   *  the three. The call to prayer is not theirs to make. */
  val EVENT_MODES: List<String> = listOf(NOTIFICATION, SILENT)

  /** Mirrors OPTIONAL_TIME_KEYS in src/types/prayer.ts. */
  private val NON_PRAYER_KEYS: Set<String> =
    setOf("Sunrise", "Midnight", "Lastthird", "Firstthird")

  /** SharedPreferences keys, in MihrabLiveActivityModule.PREFS_NAME. */
  const val KEY_OVERRIDE_EPOCH = "alert_override_epoch"
  const val KEY_OVERRIDE_MODE = "alert_override_mode"
  /** The occurrence: which event, on which local day. See `dayOf`. */
  const val KEY_OVERRIDE_NAME = "alert_override_name"
  const val KEY_OVERRIDE_DATE = "alert_override_date"

  fun isNonPrayerKey(key: String): Boolean = NON_PRAYER_KEYS.contains(key)

  fun modesFor(key: String): List<String> =
    if (isNonPrayerKey(key)) EVENT_MODES else SALAH_MODES

  /** The next mode in this row's cycle. An unknown current mode starts the
   *  cycle from the top rather than falling off the end of the list. */
  fun nextMode(key: String, current: String): String {
    val modes = modesFor(key)
    val i = modes.indexOf(current)
    return if (i < 0) modes[0] else modes[(i + 1) % modes.size]
  }

  /** Refuses a mode the row may not hold — the adhan on Sunrise, above
   *  all. Reached by anything that has crossed a process boundary. */
  fun coerce(key: String, mode: String): String =
    if (modesFor(key).contains(mode)) mode else modesFor(key)[0]

  /**
   * The standing mode the payload says this key is set to.
   *
   * Empty string when the payload does not say — which happens for
   * exactly one case, a card rebuilt from a payload persisted by a build
   * that predates this field. The caller falls back to the head of the
   * cycle and the next JS sync corrects it.
   */
  fun baseModeFor(p: JSONObject, key: String): String {
    if (key.isEmpty()) return ""
    modeIn(p, key)?.let { return it }
    val days = p.optJSONArray("days") ?: return ""
    for (i in 0 until days.length()) {
      val day = days.optJSONObject(i) ?: continue
      modeIn(day, key)?.let { return it }
    }
    return ""
  }

  /** `rows` / `sunriseRow` / `extraRows` of one day — or of the payload
   *  itself, which carries the same three for the day on screen. */
  private fun modeIn(o: JSONObject, key: String): String? {
    o.optJSONObject("sunriseRow")?.let { r ->
      if (r.optString("key") == key) return r.optString("mode").ifEmpty { null }
    }
    for (field in arrayOf("rows", "extraRows")) {
      val arr = o.optJSONArray(field) ?: continue
      for (i in 0 until arr.length()) {
        val r = arr.optJSONObject(i) ?: continue
        if (r.optString("key") == key) {
          return r.optString("mode").ifEmpty { null }
        }
      }
    }
    return null
  }

  /**
   * The override, when there is one and it is for this exact instant.
   *
   * Also honours the key the "Mute next adhan" button used to write. That
   * button's mute meant "not the adhan" — it rescheduled onto the plain
   * channel rather than cancelling — so it reads as `notification` here.
   * Without this an install that updated between a mute and the prayer it
   * muted would have heard the adhan anyway.
   */
  fun overrideFor(prefs: SharedPreferences, epochMs: Long, key: String): String? {
    if (epochMs <= 0L || key.isEmpty()) return null
    val mode = prefs.getString(KEY_OVERRIDE_MODE, "") ?: ""
    if (mode.isNotEmpty()) {
      val name = prefs.getString(KEY_OVERRIDE_NAME, "") ?: ""
      val date = prefs.getString(KEY_OVERRIDE_DATE, "") ?: ""
      if (name.isNotEmpty() && date.isNotEmpty()) {
        if (name == key && date == dayOf(epochMs)) return coerce(key, mode)
      } else if (prefs.getLong(KEY_OVERRIDE_EPOCH, -1L) == epochMs) {
        // Written by the build where the instant WAS the identity. Exact
        // for those, so an override set just before an update keeps
        // working rather than lapsing into the adhan on the way through.
        return coerce(key, mode)
      }
    }
    val legacy = prefs.getLong(MihrabLiveActivityActionReceiver.KEY_MUTED_EPOCH, -1L)
    if (legacy > 0L && legacy == epochMs) return coerce(key, NOTIFICATION)
    return null
  }

  /**
   * The local day an instant falls on, as yyyy-MM-dd.
   *
   * Must agree with `ymdLocal` on the JS side for the same instant: the
   * two halves of one identity, computed in two languages. Both read the
   * device's own timezone, and both take the day of the EVENT rather than
   * of anything around it.
   */
  fun dayOf(epochMs: Long): String {
    val c = java.util.Calendar.getInstance()
    c.timeInMillis = epochMs
    return String.format(
      java.util.Locale.US,
      "%04d-%02d-%02d",
      c.get(java.util.Calendar.YEAR),
      c.get(java.util.Calendar.MONTH) + 1,
      c.get(java.util.Calendar.DAY_OF_MONTH),
    )
  }

  /** What the button should be showing: the override if one speaks for
   *  this instant, else what the row is set to. */
  fun effectiveMode(
    prefs: SharedPreferences,
    p: JSONObject,
    epochMs: Long,
    key: String,
  ): String {
    overrideFor(prefs, epochMs, key)?.let { return it }
    val base = baseModeFor(p, key)
    return if (base.isEmpty()) modesFor(key)[0] else coerce(key, base)
  }

  /**
   * Is this event sounding differently from what its row is set to?
   *
   * Not "is an override stored" — the standing setting can move under a
   * stored one until the two agree, and an override that agrees with the
   * row is not changing anything for the reader to be told about.
   */
  fun isOverridden(
    prefs: SharedPreferences,
    p: JSONObject,
    epochMs: Long,
    key: String,
  ): Boolean {
    val o = overrideFor(prefs, epochMs, key) ?: return false
    val base = baseModeFor(p, key)
    // With no base to compare against, a stored override is the only thing
    // saying anything, so it counts.
    return base.isEmpty() || o != coerce(key, base)
  }

  /**
   * Write the override for one instant — or clear it, when the cycle has
   * come back round to what the row was already set to.
   *
   * Clearing rather than storing "the same as the base" is what lets the
   * label drop its "· once" marker: a button that says a mode is
   * temporary when nothing temporary is happening is telling the reader
   * their permanent setting has changed.
   */
  fun store(
    prefs: SharedPreferences,
    epochMs: Long,
    key: String,
    mode: String,
    baseMode: String,
  ) {
    val e = prefs.edit()
    // The older keys are cleared on every write, whichever way this goes:
    // both are read as fallbacks above, and a stale one would outlive the
    // override that replaced it.
    e.remove(MihrabLiveActivityActionReceiver.KEY_MUTED_EPOCH)
    if (mode == baseMode) {
      e.remove(KEY_OVERRIDE_EPOCH)
        .remove(KEY_OVERRIDE_MODE)
        .remove(KEY_OVERRIDE_NAME)
        .remove(KEY_OVERRIDE_DATE)
    } else {
      e.putString(KEY_OVERRIDE_NAME, key)
        .putString(KEY_OVERRIDE_DATE, dayOf(epochMs))
        .putString(KEY_OVERRIDE_MODE, mode)
        // Carried, not consulted: the instant the card was counting down
        // to when this was pressed.
        .putLong(KEY_OVERRIDE_EPOCH, epochMs)
    }
    e.apply()
  }
}
