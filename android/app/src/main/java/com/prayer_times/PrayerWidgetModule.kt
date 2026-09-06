package com.prayer_times

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PrayerWidgetModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getAndroidWidgetAppearance(promise: Promise) {
    try {
      val prefs = reactContext.getSharedPreferences(PrayerWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
      if (!prefs.contains(PrayerWidgetProvider.PREFS_WIDGET_BG_OPACITY)) {
        promise.resolve(null)
        return
      }
      val map = Arguments.createMap()
      map.putInt("opacity", prefs.getInt(PrayerWidgetProvider.PREFS_WIDGET_BG_OPACITY, 88))
      map.putString("highlightId", prefs.getString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_ID, "green"))
      map.putString("highlightHex", prefs.getString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_HEX, ""))
      map.putBoolean("highlightDynamic", prefs.getBoolean(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_DYNAMIC, false))
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("E_WIDGET_APPEARANCE_GET", e.message, e)
    }
  }

  /**
   * Hand over every tap the Log Today widget has queued, and clear it.
   *
   * Returns a JSON string rather than a WritableArray so the JS side can run
   * it through the same `coerceLogQueue` it uses on anything else that
   * crosses a process boundary — a bridge array would arrive pre-shaped and
   * skip the validation, which is the wrong direction for something whose
   * contents end up in the journal.
   */
  @ReactMethod
  fun takeLogQueue(promise: Promise) {
    try {
      val entries = WidgetLogQueue.take(reactContext)
      promise.resolve(WidgetLogQueue.serialize(entries))
      // NO REDRAW HERE. See takeTasbihQueue below for the whole story: the
      // hand-over is not the moment the app owns these taps, it is the
      // moment the app has WRITTEN them, and redrawing in between shows a
      // card from which they have vanished.
    } catch (e: Exception) {
      promise.reject("E_WIDGET_LOG_QUEUE", e.message, e)
    }
  }

  /**
   * The same hand-over for the Tasbih widget's queue.
   *
   * A separate call rather than one queue with a `kind` field: the two have
   * different rules — a log tap is a set member and a dhikr tap is a
   * sequence — and one string that two sets of rules both parse is a string
   * that will eventually be parsed by the wrong one.
   */
  @ReactMethod
  fun takeTasbihQueue(promise: Promise) {
    try {
      val entries = WidgetTasbihQueue.take(reactContext)
      promise.resolve(WidgetTasbihQueue.serialize(entries))
      // NO REDRAW HERE, AND THIS IS THE WHOLE OF THE BUG IT USED TO CAUSE.
      //
      // There used to be a `requestUpdate` on this line, to stop the widget
      // counting the same taps twice — once from its own queue and once from
      // the payload the app was about to push. The reasoning was right and
      // the timing was wrong, because "the app owns these taps now" is not
      // true yet at this line. Three things have to happen for a tap to move
      // from the queue into the payload:
      //
      //   1. the queue is cleared            ← `take`, one line above
      //   2. the app applies it to the store ← a promise the JS side has not
      //                                        even resolved yet
      //   3. the app republishes the payload ← later still, and debounced
      //
      // Redrawing at 1 draws the one state in which the tap exists NOWHERE:
      // gone from the queue the widget projects, absent from the payload it
      // projects onto. So the number fell back to what it was before the
      // tap — to zero on a counter that had just been started, or to the
      // previous dhikr's count after Next — and stayed there for as long as
      // 2 and 3 took. Reported as "the count becomes zero for a second and
      // then reacts to the button".
      //
      // The redraw was also never needed. Step 3 ends in `setData`, which
      // fans `requestUpdate` out to every widget kind including this one, so
      // the correct redraw already happens at the only moment it is correct.
      // Until then the projection is right: the queue we just took is still
      // the truth about these taps as far as the payload is concerned.
    } catch (e: Exception) {
      promise.reject("E_WIDGET_TASBIH_QUEUE", e.message, e)
    }
  }

  @ReactMethod
  fun setData(json: String, promise: Promise) {
    try {
      // The language travels beside the payload rather than being dug back out
      // of it on every redraw: seven providers read this, several of them more
      // than once per update, and re-parsing the whole payload to find one
      // string is work the widget can least afford.
      val language =
        try {
          org.json.JSONObject(json).optString("language", "").trim()
        } catch (e: Exception) {
          ""
        }
      reactContext
        .getSharedPreferences(PrayerWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PrayerWidgetProvider.PREFS_KEY, json)
        .putString(PrayerWidgetProvider.PREFS_LANGUAGE, language)
        .apply()
      // Every widget kind reads the same payload, so every one of them has
      // to be told — and `requestUpdate` is the ONE place that knows the
      // full list. It fans out to Log, Streak, Reading, Hijri and Tasbih
      // itself, each behind its own guard.
      //
      // This used to name five of them again here, after the fan-out had
      // already drawn them: four redrew twice per payload, and the Log
      // widget — the only kind the list left out — was the one relying
      // entirely on the fan-out it was written to duplicate. A list of
      // widget kinds maintained in two places is a list that will be wrong
      // in one of them, and it already was.
      PrayerWidgetProvider.requestUpdate(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_WIDGET", e.message, e)
    }
  }

  @ReactMethod
  fun setAndroidWidgetAppearance(
    opacity: Int,
    highlightId: String,
    highlightHex: String?,
    highlightDynamic: Boolean,
    promise: Promise,
  ) {
    try {
      val o = opacity.coerceIn(0, 100)
      val hid = highlightId.trim().ifEmpty { "green" }
      val hex =
        highlightHex
          ?.trim()
          ?.takeIf { it.isNotEmpty() }
          ?: ""
      reactContext
        .getSharedPreferences(PrayerWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putInt(PrayerWidgetProvider.PREFS_WIDGET_BG_OPACITY, o)
        .putString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_ID, hid)
        .putString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_HEX, hex)
        .putBoolean(
          PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_DYNAMIC,
          highlightDynamic,
        )
        .apply()
      PrayerWidgetProvider.requestUpdate(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_WIDGET_APPEARANCE", e.message, e)
    }
  }

  @ReactMethod
  fun setUiHints(style: String, oledBackground: Boolean, promise: Promise) {
    try {
      reactContext
        .getSharedPreferences(PrayerWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PrayerWidgetProvider.PREFS_UI_STYLE_KEY, style)
        .putBoolean(PrayerWidgetProvider.PREFS_UI_OLED, oledBackground)
        .apply()
      PrayerWidgetProvider.requestUpdate(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_WIDGET_UI", e.message, e)
    }
  }

  companion object {
    const val NAME = "PrayerWidget"
  }
}
