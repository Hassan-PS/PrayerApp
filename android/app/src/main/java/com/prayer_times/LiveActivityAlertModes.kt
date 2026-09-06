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
 * ── AND WHY THE OVERRIDE IS AN INSTANT, NOT A NAME ──────────────────
 *
 * The button is temporary by design: it speaks for THIS Fajr and not
 * for Fajr. Storing the epoch is what makes that true — the override
 * stops matching the moment the card walks past it, with nothing to
 * expire and nothing to clean up.
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
    if (epochMs <= 0L) return null
    val epoch = prefs.getLong(KEY_OVERRIDE_EPOCH, -1L)
    if (epoch == epochMs) {
      val mode = prefs.getString(KEY_OVERRIDE_MODE, "") ?: ""
      if (mode.isNotEmpty()) return coerce(key, mode)
    }
    val legacy = prefs.getLong(MihrabLiveActivityActionReceiver.KEY_MUTED_EPOCH, -1L)
    if (legacy > 0L && legacy == epochMs) return coerce(key, NOTIFICATION)
    return null
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
    // The old key is cleared on every write, whichever way this goes: it
    // is read as a fallback above, and a stale one would outlive the
    // override that replaced it.
    e.remove(MihrabLiveActivityActionReceiver.KEY_MUTED_EPOCH)
    if (mode == baseMode) {
      e.remove(KEY_OVERRIDE_EPOCH).remove(KEY_OVERRIDE_MODE)
    } else {
      e.putLong(KEY_OVERRIDE_EPOCH, epochMs).putString(KEY_OVERRIDE_MODE, mode)
    }
    e.apply()
  }
}
