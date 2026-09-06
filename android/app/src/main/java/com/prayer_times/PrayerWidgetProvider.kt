package com.prayer_times

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.RelativeSizeSpan
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

private data class WidgetStyle(
  val bgOpacityPercent: Int,
  val highlightId: String,
  val highlightHex: String,
) {
  fun backgroundArgb(): Int {
    val a = (bgOpacityPercent.coerceIn(0, 100) * 255 / 100f).toInt().coerceIn(0, 255)
    return Color.argb(a, BASE_BG_R, BASE_BG_G, BASE_BG_B)
  }

  /**
   * The colour that was CHOSEN, never the wallpaper's. `context` is kept in
   * the signature because every caller has one and the swatch table is the
   * kind of thing that wants a resource lookup again one day; it is
   * deliberately unused now that Material You is out of the widgets.
   */
  fun highlightColorInt(
    @Suppress("UNUSED_PARAMETER") context: Context,
  ): Int {
    if (highlightId.equals("custom", ignoreCase = true)) {
      val h = highlightHex.trim()
      if (h.matches(Regex("^#([0-9A-Fa-f]{6})$"))) {
        return try {
          Color.parseColor(h)
        } catch (_: Exception) {
          Color.parseColor("#46A081")
        }
      }
      return Color.parseColor("#46A081")
    }
    val hex =
      when (highlightId.lowercase()) {
        "green" -> "#46A081"
        "teal" -> "#4EC9B0"
        "blue" -> "#6BA3F5"
        "amber" -> "#E5C07B"
        else -> "#46A081"
      }
    return try {
      Color.parseColor(hex)
    } catch (_: Exception) {
      Color.parseColor("#46A081")
    }
  }
}

// `resolveDynamicHighlightColor` lived here. It read the platform's
// wallpaper-derived Material You accent, and it is gone rather than merely
// unreachable, so that no future branch can find it and switch it back on
// by accident. The widget's colour comes from `highlightColorInt` and
// nowhere else.
//
// The Live Activity notification still follows Material You when the app's
// System-colours setting is on. That is a notification, not a widget, and
// it was not part of what was asked for.

private fun readWidgetStyle(prefs: SharedPreferences): WidgetStyle {
  val opacity = prefs.getInt(PrayerWidgetProvider.PREFS_WIDGET_BG_OPACITY, 88)
  val hid =
    prefs.getString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_ID, "green")?.trim()
      ?: "green"
  val hex =
    prefs.getString(PrayerWidgetProvider.PREFS_WIDGET_HIGHLIGHT_HEX, "")?.trim()
      ?: ""
  // DYNAMIC COLOUR IS GONE FROM THE WIDGETS (2026-08-27, by request).
  //
  // Material You gave the widget whatever hue the wallpaper happened to
  // produce, which on a lot of wallpapers is nothing like the app and on
  // some is barely distinguishable from the card it sits on. The widget
  // now takes the colour the user actually chose — the accent from the
  // widget settings, or green.
  //
  // The stored flag is not read at all: a widget can be drawn before JS has
  // ever run (boot, a restore, an unlock straight to the home screen), so
  // ignoring it HERE is what makes the change true immediately rather than
  // after the app is next opened. The KEY is left in the store so that a
  // downgrade still finds what it wrote.
  //
  // `hid` of "dynamic" is a value only older builds could have stored; it
  // resolves to green like any other unknown id.
  return WidgetStyle(
    opacity.coerceIn(0, 100),
    hid.ifEmpty { "green" },
    hex,
  )
}

/** Neutral dark surface (#1C1C1E), opacity from settings. */
private const val BASE_BG_R = 28
private const val BASE_BG_G = 28
private const val BASE_BG_B = 30

/**
 * Neutral dark widget: only the next prayer row uses an accent color.
 * Background opacity and accent are configurable from app settings (Android).
 */
open class PrayerWidgetProvider : AppWidgetProvider() {

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    // SCREEN_ON and WALLPAPER_CHANGED used to be listed here and in the
    // manifest. Neither can arrive: SCREEN_ON is documented as deliverable
    // only to a receiver registered with registerReceiver, and
    // WALLPAPER_CHANGED has been dead since API 16. Declaring them made the
    // refresh story look far better covered than it was, which is how four
    // widgets ended up with no working unattended refresh at all while the
    // manifest suggested six triggers each.
    when (intent.action) {
      Intent.ACTION_USER_PRESENT,
      Intent.ACTION_BOOT_COMPLETED,
      ACTION_PRAYER_TIME_ELAPSED -> requestUpdate(context)
      ACTION_WIDGET_REFRESH -> onRefreshPressed(context)
    }
  }

  /**
   * The refresh glyph, pressed.
   *
   * REDRAW FIRST, THEN GO AND LOOK. The redraw is instant and uses what is
   * already on disk, so the card responds to the tap; the sync round behind
   * it is what makes the press mean anything.
   *
   * The button used to broadcast ACTION_APPWIDGET_UPDATE, which redrew the
   * same stored bytes and nothing else. That is a defensible reading of
   * "refresh" and not the one anybody has: a person taps it because what
   * they are looking at is not what they expect, and on a paired phone the
   * usual reason is that the other device's record has not arrived. It is
   * also the only way to sync without opening the app — auto-sync runs while
   * the app is open, and a widget is what people look at INSTEAD of opening
   * the app.
   *
   * Wrapped, because a HeadlessJS service can be refused: the process may be
   * starting, or the OS may be in a state that forbids it. A refresh that
   * only redraws is the old behaviour, which is worse than the new one and
   * much better than a crash inside a broadcast receiver.
   *
   * NOT WHAT THE SAME GLYPH DOES ON iOS. `RefreshIntent` over in
   * PrayerWidgetExtension.swift calls `reloadTimelines(ofKind:)` and stops
   * there: an iOS widget extension has no way to run a sync round, because
   * the round needs the record's encryption key and the key lives on the
   * JS side of the app. Android can do the second half only because a
   * HeadlessJS service is a way to run that JS without a foreground app.
   * So the two buttons genuinely mean different things, and the gap is not
   * an unfinished port.
   */
  private fun onRefreshPressed(context: Context) {
    requestUpdate(context)
    try {
      context.startService(
        Intent(context, WidgetRefreshHeadlessService::class.java),
      )
    } catch (t: Throwable) {
      Log.w(TAG, "widget refresh: could not start the sync task", t)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    refreshAll(context, appWidgetManager, appWidgetIds)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle
  ) {
    super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
    refreshAll(context, appWidgetManager, intArrayOf(appWidgetId))
  }

  companion object {
    private const val TAG = "MihrabWidget"

    const val PREFS_NAME = "prayer_widget"
    const val PREFS_KEY = "payload_v1"
    const val PREFS_UI_STYLE_KEY = "widget_ui_style"
    const val PREFS_UI_OLED = "widget_oled"
    const val PREFS_WIDGET_BG_OPACITY = "widget_bg_opacity"
    const val PREFS_WIDGET_HIGHLIGHT_ID = "widget_highlight_id"
    const val PREFS_WIDGET_HIGHLIGHT_HEX = "widget_highlight_hex"
    const val PREFS_WIDGET_HIGHLIGHT_DYNAMIC = "widget_highlight_dynamic"
    /**
     * The language tag Mihrab itself is running in, copied out of the payload
     * when JS saves it. See `localized`.
     */
    const val PREFS_LANGUAGE = "widget_language"
    /** Internal broadcast fired by AlarmManager at each prayer time transition. */
    const val ACTION_PRAYER_TIME_ELAPSED = "com.prayer_times.ACTION_PRAYER_TIME_ELAPSED"

    /**
     * The refresh glyph on the card. Its own action rather than
     * ACTION_APPWIDGET_UPDATE, so a press is distinguishable from the
     * system asking for a redraw — only the press should spend a sync
     * round, and every other update path arrives as APPWIDGET_UPDATE.
     */
    const val ACTION_WIDGET_REFRESH = "com.prayer_times.ACTION_WIDGET_REFRESH"

    /**
     * A context whose resources speak the language *Mihrab* is set to, rather
     * than the one the phone is set to.
     *
     * The two are usually the same — the app now defaults to the system
     * language — but a user who picked a different one in Settings would
     * otherwise get a widget in two languages at once: the rows and prayer
     * names come from the payload, which JS localizes before it sends, while
     * every label the provider draws itself came from the phone's string
     * table. Only the picker's own entry (the receiver's `android:label`) is
     * still out of reach; the launcher reads that without ever calling us.
     *
     * Returns the context unchanged when no language has been recorded yet,
     * which is the case until the app has run once.
     */
    fun localized(context: Context): Context {
      val tag =
        context
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
          .getString(PREFS_LANGUAGE, null)
          ?.trim()
          .orEmpty()
      if (tag.isEmpty()) return context
      val locale = java.util.Locale.forLanguageTag(tag)
      if (locale.language.isEmpty()) return context
      // Already speaking it — createConfigurationContext is not free, and this
      // runs on every widget redraw.
      val current = context.resources.configuration.locales
      if (!current.isEmpty && current[0].language == locale.language) return context
      val config = android.content.res.Configuration(context.resources.configuration)
      config.setLocale(locale)
      return context.createConfigurationContext(config)
    }

    private const val NEUTRAL_TEXT = "#E8EAED"
    private const val NEUTRAL_MUTED = "#9AA0A6"

    /** What the card spends on its own left and right padding, in dp. */
    private const val STRIP_CONTENT_INSET_DP = 20

    /** As many days as the payload carries. See PRACTICE_WINDOW_DAYS. */
    private const val MAX_GRID_DAYS = 210

    /**
     * The times row's type size, and why it is measured rather than declared.
     *
     * The layout asks for 17sp with `autoSizeTextType="uniform"` under it,
     * and auto-sizing is not honoured by every AppWidget host — on the ones
     * that ignore it a `TextView` simply draws its text at the size it was
     * given and lets it spill past its column. With 24-hour times nobody
     * noticed, because "05:36" fits a sixth of a 4x4 at 17sp with room to
     * spare. The 12-hour clock in 2.15.0 made every one of those strings
     * "5:36 AM" — half again as wide — and six of them ran into each other
     * across the top of the card.
     *
     * So the size is worked out here, where the strings and the column width
     * are both known, and set explicitly. Measured with the row's own
     * typeface, against the WIDEST of the times rather than each one on its
     * own: a row where Fajr is 17sp and Maghrib is 12sp would be a worse
     * answer than a row that is uniformly smaller.
     *
     * @param columnDp one column's share of the row, before its gutter
     */
    private fun stripTimeSizeSp(
      context: Context,
      times: List<String>,
      columnDp: Float,
    ): Float {
      if (times.isEmpty() || columnDp <= 0f) return TIME_MAX_SP
      val metrics = context.resources.displayMetrics
      // A gutter, not a hairline: text that stops exactly at its column's
      // edge still reads as two words with no space between them.
      val availablePx = (columnDp - TIME_GUTTER_DP) * metrics.density
      if (availablePx <= 0f) return TIME_MIN_SP
      val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      }
      var sp = TIME_MAX_SP
      while (sp > TIME_MIN_SP) {
        if (times.all { measureTimePx(paint, it, sp, metrics.scaledDensity) <= availablePx }) {
          break
        }
        sp -= 0.5f
      }
      return sp
    }

    /**
     * How wide one time is with the meridiem drawn small — the width the
     * size search has to agree with, or it would fit a string nobody draws.
     */
    private fun measureTimePx(
      paint: TextPaint,
      time: String,
      sp: Float,
      scaledDensity: Float,
    ): Float {
      val core = numericRange(time)
      paint.textSize = sp * scaledDensity
      var width = paint.measureText(time, core.first, core.last + 1)
      if (core.first > 0 || core.last < time.length - 1) {
        paint.textSize = sp * MERIDIEM_SCALE * scaledDensity
        width += paint.measureText(time, 0, core.first)
        width += paint.measureText(time, core.last + 1, time.length)
      }
      return width
    }

    /**
     * The clock itself, small-capped around the digits.
     *
     * A 12-hour time is two things: the number, which is what anyone
     * actually reads off a widget, and three characters saying which half
     * of the day it is. Shrinking the whole string to fit the column made
     * the number small to buy room for the part nobody looks at. The
     * meridiem is set at 62% instead, and the digits keep nearly the size
     * the 24-hour clock has.
     *
     * The span is applied to whatever falls OUTSIDE the digits rather than
     * to a trailing suffix, because the meridiem does not always trail:
     * Chinese writes 上午5:36 and reordering someone's clock to suit a
     * layout is not a fix.
     */
    @JvmStatic
    fun styledTime(time: String): CharSequence {
      val core = numericRange(time)
      if (core.first == 0 && core.last == time.length - 1) return time
      val out = SpannableString(time)
      if (core.first > 0) {
        out.setSpan(
          RelativeSizeSpan(MERIDIEM_SCALE),
          0,
          core.first,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
      if (core.last < time.length - 1) {
        out.setSpan(
          RelativeSizeSpan(MERIDIEM_SCALE),
          core.last + 1,
          time.length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
      }
      return out
    }

    /**
     * First and last index of the clock's own characters — digits in any
     * script the app ships, and the separators between them.
     */
    private fun numericRange(time: String): IntRange {
      val isDigit = { c: Char ->
        c.isDigit() || c in '٠'..'٩' || c in '۰'..'۹'
      }
      val first = time.indexOfFirst(isDigit)
      val last = time.indexOfLast(isDigit)
      if (first < 0) return 0..(time.length - 1)
      return first..last
    }

    /** The size the layout declares, and the floor below which it stops. */
    private const val TIME_MAX_SP = 17f
    private const val TIME_MIN_SP = 10f
    private const val TIME_GUTTER_DP = 4f
    private const val MERIDIEM_SCALE = 0.62f

    private val COL_WRAPPERS =
      intArrayOf(
        R.id.widget_col_0,
        R.id.widget_col_1,
        R.id.widget_col_2,
        R.id.widget_col_3,
        R.id.widget_col_4,
        R.id.widget_col_5,
        // The First Third, Islamic Midnight and the Last Third — drawn
        // only when the user has turned them on. Three slots because all
        // three can be on at once, and a row silently dropped off the end
        // is worse than a crowded list.
        R.id.widget_col_6,
        R.id.widget_col_7,
        R.id.widget_col_8,
      )
    /**
     * The inner box each column's highlight is painted on.
     *
     * Not the column itself. The column fills the row's height so the strip
     * can absorb slack, and painting the pill there stretched it into a tall
     * rounded slab behind two lines of centred text. The box wraps its
     * contents, which is the shape the highlight is meant to be.
     *
     * Slots 6 and 7 are the night rows, which are never highlighted; their
     * ids are here only to keep the arrays the same length.
     */
    private val COL_BOXES =
      intArrayOf(
        R.id.widget_col_0_box,
        R.id.widget_col_1_box,
        R.id.widget_col_2_box,
        R.id.widget_col_3_box,
        R.id.widget_col_4_box,
        R.id.widget_col_5_box,
        R.id.widget_col_6_box,
        R.id.widget_col_7_box,
      )
    private val COL_LABELS =
      intArrayOf(
        R.id.widget_col_0_label,
        R.id.widget_col_1_label,
        R.id.widget_col_2_label,
        R.id.widget_col_3_label,
        R.id.widget_col_4_label,
        R.id.widget_col_5_label,
        // The First Third, Islamic Midnight and the Last Third — drawn
        // only when the user has turned them on. Three slots because all
        // three can be on at once, and a row silently dropped off the end
        // is worse than a crowded list.
        R.id.widget_col_6_label,
        R.id.widget_col_7_label,
        R.id.widget_col_8_label,
      )
    private val COL_TIMES =
      intArrayOf(
        R.id.widget_col_0_time,
        R.id.widget_col_1_time,
        R.id.widget_col_2_time,
        R.id.widget_col_3_time,
        R.id.widget_col_4_time,
        R.id.widget_col_5_time,
        // The First Third, Islamic Midnight and the Last Third — drawn
        // only when the user has turned them on. Three slots because all
        // three can be on at once, and a row silently dropped off the end
        // is worse than a crowded list.
        R.id.widget_col_6_time,
        R.id.widget_col_7_time,
        R.id.widget_col_8_time,
      )

    /**
     * The background and accent colours the user has configured, for widgets
     * declared in other files.
     *
     * Exposed rather than duplicated: the configure screen writes one set of
     * preferences and every widget this app draws has to look like the same
     * app. A second reader that fell behind on, say, the dynamic-accent flag
     * would show one widget in Material You and the one beside it in green.
     */
    fun resolvedColors(context: Context): Pair<Int, Int> {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val style = readWidgetStyle(prefs)
      return Pair(style.backgroundArgb(), style.highlightColorInt(context))
    }

    /** Directly push updated RemoteViews to the given widget IDs — no broadcast. */
    fun refreshAll(base: Context, appWidgetManager: AppWidgetManager, ids: IntArray) {
      // Every label below comes out of the string table, so the context has to
      // be the one that speaks Mihrab's language before anything is read from
      // it. See PrayerWidgetProvider.localized.
      val context = localized(base)
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val json = prefs.getString(PREFS_KEY, null)
      val style = readWidgetStyle(prefs)
      for (id in ids) {
        val views = buildViews(context, appWidgetManager, id, json, style)
        appWidgetManager.updateAppWidget(id, views)
      }
    }

    /**
     * Redraw EVERY widget this app draws, and re-arm the clock that will ask
     * again.
     *
     * It used to reach three providers and Log Today. Streak, Continue
     * Reading, Hijri and Tasbih were left out — and because the alarm below
     * is an explicit intent, their manifest `ACTION_PRAYER_TIME_ELAPSED`
     * filters never fired either. All four also carry
     * `updatePeriodMillis="0"`, on the reasoning that they change only when
     * the app changes them. That reasoning assumed the app's own pushes
     * reached them, and nothing did: a Streak widget alone on a home screen
     * had no unattended refresh of any kind, so its graph did not roll onto
     * a new day until something else woke the app.
     *
     * One entry point, every provider, every time. Called from the RN module
     * after a payload write, from the alarm, from boot, and from an app
     * update.
     */
    /**
     * The widget's size IN THE ORIENTATION IT IS BEING DRAWN IN.
     *
     * `OPTION_APPWIDGET_MIN_HEIGHT` is not "the height". The options bundle
     * carries a size for each orientation, and the pairing is only what the
     * names suggest for width: MIN/MAX_WIDTH are portrait and landscape,
     * but MIN/MAX_HEIGHT are LANDSCAPE and PORTRAIT — a widget is shorter
     * lying down than standing up, so the smaller height is the landscape
     * one. Reading MIN_HEIGHT on a phone held upright answers a question
     * nobody asked: how tall this card would be if the phone were turned
     * sideways.
     *
     * That is why STREAK vanished from a one-row card with room to spare.
     * The launcher reports minH=52 / maxH=99 for the 4x1 placement on a
     * 420dpi phone; the label was measured against 52, found wanting, and
     * only came back when the card was dragged tall enough that even the
     * landscape figure cleared the bar — which is exactly the "expand it and
     * the missing part appears" symptom.
     *
     * Ask the configuration which way up we are and read the matching pair.
     * Either number is 0 when the launcher has not measured yet.
     */
    fun sizeDp(
      context: Context,
      mgr: AppWidgetManager,
      appWidgetId: Int,
    ): Pair<Int, Int> {
      val opts = try {
        mgr.getAppWidgetOptions(appWidgetId)
      } catch (_: Exception) {
        null
      } ?: return Pair(0, 0)
      val landscape =
        context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
      val width = opts.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
        else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,
        0,
      )
      val height = opts.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
        else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,
        0,
      )
      // A launcher that fills only the one pair still deserves an answer.
      return Pair(
        if (width > 0) width else opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
        if (height > 0) height else opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0),
      )
    }

    /** Where the "which device wrote these" marker lives. */
    private const val INSTALL_KEY = "widget_install_id"

    /**
     * Throw away taps that were queued on a DIFFERENT device.
     *
     * `prayer_widget.xml` is inside the `sharedpref` include in both backup
     * rule files, so a cloud restore or a device-to-device transfer carries
     * the widget's tap queues across with everything else. The log queue
     * survives that honestly enough — its entries name the date they belong
     * to, and the same person's prayers on the same days are the same facts.
     * The tasbih queue does not: its entries are counts, so a queue that had
     * already been drained on the old phone is counted a second time on the
     * new one, and the user's dhikr total quietly gains a few hundred beads
     * they never told anyone about.
     *
     * The payload itself is left alone deliberately: a restored one that has
     * gone stale is caught by `payloadHasExpired`, and one that has not is
     * still true.
     */
    fun dropQueuesFromAnotherDevice(context: Context) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val current = try {
        android.provider.Settings.Secure.getString(
          context.contentResolver,
          android.provider.Settings.Secure.ANDROID_ID,
        )
      } catch (_: Exception) {
        null
      } ?: return
      val seen = prefs.getString(INSTALL_KEY, null)
      if (seen == current) return
      // First run on this device — including the very first run ever, where
      // there is nothing to drop and this only writes the marker.
      prefs.edit()
        .remove(WidgetTasbihQueue.PREFS_QUEUE_KEY)
        .putString(INSTALL_KEY, current)
        .apply()
      if (seen != null) {
        Log.i(TAG, "Restored from another device — dropped the queued tasbih taps")
      }
    }

    /**
     * Every widget class this app ships. Kept in one place because two
     * different questions ask it: "is anything placed at all" below, and the
     * drawing fan-out further down.
     */
    private val ALL_WIDGET_CLASSES = arrayOf(
      PrayerWidgetProvider::class.java,
      PrayerWidgetSmallProvider::class.java,
      PrayerWidgetLargeProvider::class.java,
      PrayerWidgetLogProvider::class.java,
      PrayerWidgetLogLargeProvider::class.java,
      PrayerWidgetStreakProvider::class.java,
      PrayerWidgetReadingProvider::class.java,
      PrayerWidgetHijriProvider::class.java,
      PrayerWidgetTasbihProvider::class.java,
    )

    /** Whether the user has any Mihrab widget on a home screen at all. */
    private fun anyWidgetPlaced(context: Context): Boolean {
      val mgr = AppWidgetManager.getInstance(context)
      return ALL_WIDGET_CLASSES.any {
        try {
          mgr.getAppWidgetIds(ComponentName(context, it)).isNotEmpty()
        } catch (t: Throwable) {
          // A class the launcher cannot resolve is not a placed widget, and
          // is certainly not a reason to fail the whole check.
          false
        }
      }
    }

    fun requestUpdate(context: Context) {
      // FIRST, and outside everything that can fail. The chain that will ask
      // again must not be contingent on this round of drawing succeeding —
      // that contingency is exactly what used to make one bad payload
      // permanent.
      try {
        dropQueuesFromAnotherDevice(context)
      } catch (t: Throwable) {
        Log.w(TAG, "Could not check the restore marker", t)
      }
      // Nothing placed means nothing to draw and no boundary worth holding an
      // alarm for. This used to run regardless: every unlock armed two alarms
      // and made ~72 binder calls looking for widgets that were not there,
      // for every user who had never placed one
      // (docs/design/background-power.md).
      //
      // The check is "any widget of ANY class", not "any of this class" — the
      // alarms below refresh all of them at the prayer boundary, so a single
      // placed Hijri card still needs the chain armed.
      if (!anyWidgetPlaced(context)) return
      try {
        armWidgetAlarms(context)
      } catch (t: Throwable) {
        Log.w(TAG, "Could not arm the widget alarms", t)
      }

      val mgr = AppWidgetManager.getInstance(context)
      val classes = arrayOf(
        PrayerWidgetProvider::class.java,
        PrayerWidgetSmallProvider::class.java,
        PrayerWidgetLargeProvider::class.java
      )
      // Each widget is drawn behind its own guard. They share a payload, and
      // a field one of them cannot cope with must cost that one card rather
      // than take the other five down with it — the failure iOS still has,
      // where a single Codable means one bad field blanks the lot.
      for (cls in classes) {
        draw(context) {
          val ids = mgr.getAppWidgetIds(ComponentName(context, cls))
          if (ids.isNotEmpty()) refreshAll(context, mgr, ids)
        }
      }
      // These draw from the same payload with their own layouts, their own
      // size rules and, for two of them, their own tap queue — so none can
      // go through refreshAll. Each is a no-op when none is placed.
      draw(context) { PrayerWidgetLogProvider.requestUpdate(context) }
      draw(context) { PrayerWidgetStreakProvider.requestUpdate(context) }
      draw(context) { PrayerWidgetReadingProvider.requestUpdate(context) }
      draw(context) { PrayerWidgetHijriProvider.requestUpdate(context) }
      draw(context) { PrayerWidgetTasbihProvider.requestUpdate(context) }
    }

    /** One widget's redraw, contained. */
    private inline fun draw(context: Context, block: () -> Unit) {
      try {
        block()
      } catch (t: Throwable) {
        Log.w(TAG, "A widget failed to redraw", t)
      }
    }

    /**
     * Arm the next-boundary and midnight alarms, from the payload alone.
     *
     * This used to sit at the bottom of `applyJson`, which made the whole
     * chain contingent on a prayer-times widget being placed AND on its
     * render succeeding. Neither is safe to assume. Someone whose home
     * screen holds only a Streak widget never armed a single alarm, so
     * nothing on their phone ever moved the widget onto a new day. And
     * because `buildViews` catches a throwing `applyJson` and falls back to
     * the error card, one bad payload killed the chain permanently — the
     * card could not refresh, and nothing was scheduled to ask it to.
     *
     * Arming from the payload instead means it runs whatever is placed and
     * whatever went wrong, and re-arms on every signal that reaches us.
     */
    fun armWidgetAlarms(context: Context) {
      scheduleMidnightRollover(context)

      val json = context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREFS_KEY, null) ?: return
      val next = try {
        nextBoundaryMillis(JSONObject(json))
      } catch (_: Exception) {
        null
      } ?: return

      val intent = Intent(context, PrayerWidgetProvider::class.java).apply {
        action = ACTION_PRAYER_TIME_ELAPSED
      }
      val pi = PendingIntent.getBroadcast(
        context, 1001, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      // RTC_WAKEUP, and idle-allowed. Both matter, and neither used to be
      // set: a plain RTC alarm does not wake the device, and an exact one
      // is still held back by Doze. Fajr is the hour of the day a phone is
      // most reliably asleep, so the one boundary that most needed to land
      // was the one guaranteed not to — the countdown ran to zero and past
      // it, and the card kept naming a prayer that had already been called
      // until someone picked the phone up.
      //
      // This is ONE alarm at a time, re-armed by the refresh it triggers:
      // six wake-ups a day, at moments the adhan notification is usually
      // waking the device anyway. See docs/design/background-power.md.
      val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()) {
        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, next, pi)
      } else {
        am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, next, pi)
      }
    }

    /**
     * When the card next says something different: the first prayer or
     * sunrise still ahead, as epoch millis. WRAPS PAST MIDNIGHT.
     *
     * Night rows are skipped for the same reason they are never the
     * headline — the widget is called Next Prayer, and Islamic Midnight is
     * not one.
     *
     * IT USED TO RETURN NULL AFTER THE LAST PRAYER, and that null was the
     * hole the countdown fell through. Every card already wraps its
     * countdown to tomorrow's Fajr the moment Isha passes — the display was
     * fixed long ago — but nothing was scheduled to fire when that
     * countdown ran out. The only alarm left was the midnight backstop, so
     * a card counting down to Fajr reached zero and kept going, and the
     * "next prayer" line still read Fajr, until something else happened to
     * wake the app. Overnight, on a phone nobody is touching, that is the
     * whole stretch from Isha to whenever the owner picks it up.
     *
     * So: today's remaining boundaries first, and when there are none, the
     * first prayer of the next day in the window. Built by rolling the
     * calendar a day and setting the wall clock rather than by adding 24
     * hours, because on the two nights a year the clocks move, 24 hours and
     * "tomorrow at 05:12" are an hour apart.
     */
    private fun nextBoundaryMillis(o: JSONObject): Long? {
      val cal = java.util.Calendar.getInstance()
      val nowMinutes =
        cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)

      fun at(minutes: Int, daysAhead: Int): Long =
        (cal.clone() as java.util.Calendar).apply {
          if (daysAhead != 0) add(java.util.Calendar.DAY_OF_MONTH, daysAhead)
          set(java.util.Calendar.HOUR_OF_DAY, minutes / 60)
          set(java.util.Calendar.MINUTE, minutes % 60)
          set(java.util.Calendar.SECOND, 0)
          set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis

      val today = selectTodayDay(o)
      val todayNext = boundaryMinutes(today, o).filter { it > nowMinutes }.minOrNull()
      if (todayNext != null) return at(todayNext, 0)

      // Nothing left today. What the card is counting down to is on the
      // other side of midnight, so that is what has to be armed.
      val tomorrow = dayAfter(o, todayDateKey())
      val first = boundaryMinutes(tomorrow, o).minOrNull()
        // No window to read: fall back to today's own first row, which is
        // what the countdown itself falls back to. A minute or two out at
        // worst, and a wake-up a minute out beats none.
        ?: boundaryMinutes(today, o).minOrNull()
        ?: return null
      return at(first, 1)
    }

    /**
     * Every boundary in a day, as minutes since local midnight — the times
     * the widget has to wake up and redraw at.
     *
     * The night times are in here because they can be the headline: leave
     * them out and the card sits on "Isha" until something else happens to
     * wake it, which between Isha and Fajr can be hours.
     */
    private fun boundaryMinutes(day: JSONObject?, root: JSONObject): List<Int> {
      val rows = day?.optJSONArray("rows") ?: root.optJSONArray("rows") ?: return emptyList()
      val out = mutableListOf<Int>()
      val candidates = mutableListOf<org.json.JSONObject>()
      for (i in 0 until rows.length()) rows.optJSONObject(i)?.let { candidates.add(it) }
      (day?.optJSONObject("sunriseRow") ?: root.optJSONObject("sunriseRow"))
        ?.let { candidates.add(it) }
      (day?.optJSONArray("extraRows") ?: root.optJSONArray("extraRows"))?.let { extra ->
        for (i in 0 until extra.length()) extra.optJSONObject(i)?.let { candidates.add(it) }
      }
      for (row in candidates) {
        val parts = row.optString("time").split(":")
        if (parts.size != 2) continue
        val h = parts[0].toIntOrNull() ?: continue
        val m = parts[1].toIntOrNull() ?: continue
        if (h < 0 || m < 0) continue
        out.add(h * 60 + m)
      }
      return out
    }

    /** The day after `key` in the payload's window, or null past its end. */
    private fun dayAfter(o: JSONObject, key: String): JSONObject? {
      val days = o.optJSONArray("days") ?: return null
      if (key.isEmpty()) return null
      var found = false
      for (i in 0 until days.length()) {
        val day = days.optJSONObject(i) ?: continue
        if (found) return day
        if (day.optString("dateKey") == key) found = true
      }
      return null
    }

    /**
     * Below this the vertical six-row layout is squashed past legibility and
     * the horizontal strip is the honest rendering. Three launcher rows is
     * roughly 110dp; 100 leaves a little slack for launchers that report
     * their cells slightly short.
     */
    // 165dp, not 100. Every number in this block used to be compared against
    // the LANDSCAPE height, so they read like the card was half the size it
    // is: on a 420dpi phone the launcher reports 52dp for a one-row card that
    // is 99dp tall, and 116dp for a two-row card that is 210dp tall. The
    // constants were tuned by eye against those halved figures, so they
    // happened to land on the right row on the device they were tuned on and
    // on no promise at all anywhere else. Re-expressed as the real height,
    // measured at the same boundaries: one row 99, two 210, three 321,
    // four 432. Each threshold now sits mid-band.
    private const val ROWS_MIN_HEIGHT_DP = 165

    /**
     * Below this the strip does not fit and only the compact next-prayer
     * line does.
     *
     * The strip is three stacked sections — location, six two-line columns,
     * and the next-prayer footer. Squeezed into a single launcher row it
     * clipped the times off the columns entirely and left a row of labels
     * above a half-cut highlight pill, which is worse than not showing the
     * day at all. Measured on a 1080x2400 emulator: it needs about 90dp.
     *
     * 92, not the 145 it was. 145 sat mid-way between one launcher row and
     * two, which put a one-row card below the bar — so the widget that
     * opened at 4x1 drew the compact line and the six times only appeared
     * when it was dragged taller. The measurement above says the columns
     * and the next-prayer line fit in a row; what does not fit is the
     * header, and that is now its own threshold rather than a reason to
     * abandon the whole strip.
     */
    private const val STRIP_MIN_HEIGHT_DP = 92

    /*
     * THE THREE STRIP BUDGETS, and the bug they exist to end.
     *
     * Each number below is what one variant of the no-graph strip needs of
     * `heightDp` — the height the LAUNCHER reports, which is the height of
     * the host view, NOT of the card drawn inside it. That distinction is
     * the whole reason this section was rewritten.
     *
     * The old constants (132 for the content, 145 and 110 for the two
     * thresholds) were measured in August against the card, when the card
     * WAS the host view. `widget_card_inset` then gave every widget a 6dp
     * gutter on all four sides so two cards in adjacent cells could not
     * touch — 12dp of height that the layout no longer has and that none of
     * these numbers were told about. Everything downstream inherited the
     * error: a card was called roomy 12dp before it was, and the leftover
     * handed to `slack` was 12dp more than existed. LinearLayout does not
     * report an overflow, it takes it out of the last child, so on any phone
     * whose launcher row is around 147dp — every 480dpi Pixel — the strip
     * drew its full-height variant into a card 12dp too short and the
     * next-prayer line came out as a 7dp sliver of clipped text.
     *
     * So: measured on the device, host-view relative, at 480dpi. 12dp of
     * inset, 28 or 12dp of root padding, the header row at 19, the six
     * columns at 40, the rule and its two margins at 17, the next-prayer
     * line at 19, and the night row's margin at 4. Each is rounded UP —
     * `slack` is spent on padding, and padding that overshoots is exactly
     * how the footer went off the bottom.
     *
     * They are budgets and thresholds at once, which is the point: the
     * variant is chosen by asking which budget fits, and the slack is the
     * leftover against THAT SAME budget. A variant can no longer be picked
     * on one number and filled against another.
     */

    /** Header, rule, 14dp of root padding at each end. */
    private const val STRIP_ROOMY_CONTENT_DP = 150

    /** Header, no rule, 6dp of root padding: the tall-phone one-row card. */
    private const val STRIP_TIGHT_CONTENT_DP = 124

    /** No header either — the short one-row card. */
    private const val STRIP_BARE_CONTENT_DP = 96

    /**
     * The most the times row will grow to absorb a card's slack.
     *
     * A guard on arithmetic, not a design number: heightDp comes from the
     * launcher and a wrong one has already cost this widget its footer once.
     */
    private const val STRIP_SLACK_CAP_DP = 64

    /**
     * What the strip spends before the practice grid gets a say, in dp:
     * padding, the header line, the next-prayer footer and the divider above
     * the graph. The times row and the grid share what is left.
     *
     * 164, measured off a screenshot rather than reasoned about. On a 303dp
     * host view the card drew five rows at 87% scale, which puts the real
     * box at 135dp — so the true chrome was 168, against the 150 this number
     * claimed. Eighteen points of over-estimated box, and eighteen points is
     * most of a row. Evening up the margins around the band above the graph
     * (see prayer_widget_strip.xml) gave 8dp back, leaving the true chrome
     * at about 160; 164 is that, four points to the safe side.
     *
     * WHICH WAY TO BE WRONG, and it is the opposite of the old answer. This
     * number is only ever compared against the box the grid must fit inside,
     * and `fitStart`/`fitCenter` scale the bitmap by whichever axis binds
     * first. Claim more height than the card has and the grid comes out
     * taller than its ImageView, the HEIGHT binds, and the whole graph is
     * scaled down — smaller squares AND a gap against the right edge, which
     * is what a card an inch shorter than its neighbour looked like. Claim
     * less and the grid loses a row, which `fitCenter` then centres in the
     * slack. So: under-estimate the box, never over-estimate it.
     *
     * (It was 150 here, and briefly 108 on the reasoning that the streak's
     * old row no longer costs anything — true, but the figure had never been
     * only that row.)
     */
    private const val STRIP_CHROME_DP = 164

    /**
     * Three launcher cells of width. Below this the six-column strip gives
     * each column under 40dp, which is where the times start eliding, so a
     * tall-and-narrow widget stacks them into the list instead.
     */
    private const val STRIP_MIN_WIDTH_DP = 200

    /**
     * Which layout to draw.
     *
     * This used to be decided purely by WHICH PROVIDER CLASS the instance
     * belonged to, which meant a widget was frozen to whatever the user
     * happened to pick out of the picker. Drag the "large" one down to a
     * single row and it still tried to draw six vertical rows into it, and
     * the result was six unreadable slivers.
     *
     * So size gets a veto. The provider class still expresses the user's
     * INTENT — it is why they picked that entry — and is honoured whenever
     * the widget is big enough to honour it. It is only overridden downward,
     * when the space genuinely cannot hold what the class asks for. Nothing
     * gets promoted: a small widget stretched wide stays the compact line
     * rather than surprising someone with a layout they never chose.
     *
     * The useful side effect is that the three providers are now
     * interchangeable at render time, which is what any future collapse of
     * them into one picker entry needs.
     */
    private fun selectLayout(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int,
      providerName: String?,
    ): Int {
      val preferred = when (providerName) {
        PrayerWidgetSmallProvider::class.java.name -> R.layout.prayer_widget_small
        // The strip is the wide design at EVERY height now, per plan §2b:
        // 4x2 is header + strip + footer, 4x4 is the same with the practice
        // block underneath. It used to switch to the vertical two-column list
        // once it got tall, which is a different design from the one the plan
        // draws and left a void where the header belongs.
        //
        // The list survives for the narrow case only — under three cells wide
        // there is no room for six columns, and that is the one place the
        // plan's own layout rule asks for a list.
        else -> R.layout.prayer_widget_strip
      }
      if (preferred == R.layout.prayer_widget_small) return preferred

      // getAppWidgetOptions never returns null in practice, but a launcher
      // that has not measured the widget yet reports 0 — which must read as
      // "no opinion", not as "zero high", or every widget would collapse to
      // the compact line on first draw.
      val opts = try {
        appWidgetManager.getAppWidgetOptions(appWidgetId)
      } catch (_: Exception) {
        null
      }
      val landscape =
        context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
      // MIN_HEIGHT is the LANDSCAPE height — see sizeDp. Every threshold
      // below is a real card height in dp now, which is a number that means
      // the same thing on a launcher whose cells are a different shape.
      val height = opts?.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
        else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,
        0,
      ) ?: 0
      val width = opts?.getInt(
        if (landscape) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
        else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,
        0,
      ) ?: 0
      if (height <= 0) return preferred

      return when {
        height < STRIP_MIN_HEIGHT_DP -> R.layout.prayer_widget_small
        // Narrow and tall: six columns will not fit across, so stack them.
        width in 1 until STRIP_MIN_WIDTH_DP && height >= ROWS_MIN_HEIGHT_DP ->
          R.layout.prayer_widget
        else -> preferred
      }
    }

    private fun buildViews(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int,
      json: String?,
      style: WidgetStyle,
    ): RemoteViews {
      val providerName = appWidgetManager.getAppWidgetInfo(appWidgetId)?.provider?.className
      val layoutId = selectLayout(context, appWidgetManager, appWidgetId, providerName)

      val views = RemoteViews(context.packageName, layoutId)

      val click = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val pi =
        PendingIntent.getActivity(
          context, 0, click,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      views.setOnClickPendingIntent(R.id.widget_root, pi)

      val refreshIntent = Intent(context, PrayerWidgetProvider::class.java).apply {
        action = ACTION_WIDGET_REFRESH
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, intArrayOf(appWidgetId))
      }
      val refreshPi = PendingIntent.getBroadcast(
        context, appWidgetId, refreshIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.widget_refresh_btn, refreshPi)

      if (json.isNullOrBlank()) {
        showMessageOnly(views, context.getString(R.string.widget_placeholder_day), isError = false, style)
      } else {
        try {
          val root = JSONObject(json)
          if (payloadHasExpired(root)) {
            // ASK, DON'T GUESS.
            //
            // Every other widget this app draws — on both platforms — refuses
            // to render a payload whose schedule no longer reaches today. This
            // one did not, and the failure was the worst kind available: past
            // the window `selectTodayDay` returns null, the code fell back to
            // the top-level single-day `rows`, and the card rendered whatever
            // day the app was last opened on AS TODAY, complete with a
            // live-ticking countdown computed against the current clock. Times
            // stated with that much confidence are worse than no times, and a
            // widget standing beside a Streak widget that correctly says "Open
            // Mihrab" while itself claiming a Fajr from three weeks ago is not
            // a widget anyone should trust with a prayer.
            showMessageOnly(
              views,
              context.getString(R.string.widget_placeholder_day),
              isError = false,
              style,
            )
          } else {
            applyJson(
              views,
              root,
              style,
              context,
              layoutId,
              measuredHeightDp(context, appWidgetManager, appWidgetId),
              measuredWidthDp(context, appWidgetManager, appWidgetId),
            )
          }
        } catch (_: Exception) {
          showMessageOnly(views, context.getString(R.string.widget_error), isError = true, style)
        }
      }
      return views
    }

    private fun showMessageOnly(
      views: RemoteViews,
      message: String,
      isError: Boolean,
      style: WidgetStyle,
    ) {
      views.setViewVisibility(R.id.widget_content, View.GONE)
      views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
      views.setTextViewText(R.id.widget_placeholder, message)
      WidgetCard.paint(views, style.backgroundArgb())
      views.setTextColor(
        R.id.widget_placeholder,
        Color.parseColor(if (isError) "#F87171" else NEUTRAL_MUTED),
      )
    }

    /** Today's local date as yyyy-MM-dd, matching the JS `dateKey` format. */
    fun todayDateKey(): String {
      val cal = java.util.Calendar.getInstance()
      return String.format(
        java.util.Locale.US,
        "%04d-%02d-%02d",
        cal.get(java.util.Calendar.YEAR),
        cal.get(java.util.Calendar.MONTH) + 1,
        cal.get(java.util.Calendar.DAY_OF_MONTH),
      )
    }

    /**
     * Has this payload's schedule run out?
     *
     * The payload is only ever written from the foreground — there is no
     * background refresh on any platform — so it describes a window that
     * ends. This was reported on the Mac build, where an app installed from
     * Homebrew can sit unopened for weeks; a phone gets opened, so it is
     * rarer here, but "rarer" is not "never" and the consequences differ per
     * widget. Log Today is the one that matters: a stale payload still
     * carries a `today` block dated whenever the app was last opened, so it
     * would offer that day's prayers as today's AND queue a write against
     * that date. Putting a status on a day the user never touched is not a
     * cosmetic bug.
     *
     * True when there is no `days[]` at all: a payload from a build older
     * than the multi-day window cannot be checked and is by now certainly
     * older than this problem.
     */
    /**
     * The published payload, parsed at most once per version of it.
     *
     * Every widget that draws reads this string and calls `JSONObject(raw)`
     * on it, and a tap on the Tasbih widget redraws every one of them. The
     * payload carries a month of days, so that parse is the largest single
     * cost in a redraw, and it was being paid per widget per tap to produce
     * an object identical to the one produced a millisecond earlier.
     *
     * Keyed on the raw string by IDENTITY OF CONTENT, so a stale answer is
     * not possible: if the app has republished, the string differs and the
     * cache misses. That is the only invalidation rule there is, and it does
     * not depend on anyone remembering to clear anything.
     *
     * Widgets run in the app's own process here, so this is one field, not
     * an IPC. Synchronized because a broadcast receiver and the app's own
     * republish can both land on it.
     */
    private var cachedRaw: String? = null
    private var cachedPayload: JSONObject? = null

    @Synchronized
    fun payload(context: Context): JSONObject? {
      val raw = context
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREFS_KEY, null) ?: return null
      if (raw == cachedRaw) return cachedPayload
      val parsed = try {
        JSONObject(raw)
      } catch (_: Exception) {
        null
      }
      cachedRaw = raw
      cachedPayload = parsed
      return parsed
    }

    /** For tests, and for anything that must not see a previous parse. */
    @Synchronized
    fun clearPayloadCache() {
      cachedRaw = null
      cachedPayload = null
    }

    fun payloadHasExpired(o: JSONObject): Boolean {
      val days = o.optJSONArray("days") ?: return true
      if (days.length() == 0) return true
      val todayKey = todayDateKey()
      for (i in 0 until days.length()) {
        val key = days.optJSONObject(i)?.optString("dateKey") ?: continue
        // Lexicographic works on yyyy-MM-dd and avoids parsing 30 dates.
        if (key >= todayKey) return false
      }
      return true
    }

    /**
     * Does this payload's SINGLE-DAY content still describe today?
     *
     * `days[]` rolls; `today`, `hijri` and `dayLabel` do not — they are
     * stamped once, when the app last wrote the payload. `payloadHasExpired`
     * does not catch this, because it only asks whether the schedule still
     * reaches today, and a payload written three weeks ago with a thirty-day
     * window passes that test easily while every one of its single-day blocks
     * is three weeks old.
     *
     * Prefer the `today` block's own `dateKey`, which is exactly the day it
     * claims to be about. Fall back to the first `days[]` entry for payloads
     * that carry no `today` block at all.
     */
    private fun payloadDescribesToday(o: JSONObject): Boolean {
      val todayKey = todayDateKey()
      val stamped = o.optJSONObject("today")?.optString("dateKey")?.takeIf { it.isNotEmpty() }
      if (stamped != null) return stamped == todayKey
      val first = o.optJSONArray("days")?.optJSONObject(0)?.optString("dateKey")
      return first == todayKey
    }

    /** The entry in `days[]` that applies to the current local date, or null
     *  when there is no `days[]` / no match. */
    private fun selectTodayDay(o: JSONObject): JSONObject? {
      val days = o.optJSONArray("days") ?: return null
      if (days.length() == 0) return null
      val todayKey = todayDateKey()
      for (i in 0 until days.length()) {
        val day = days.optJSONObject(i) ?: continue
        if (day.optString("dateKey") == todayKey) return day
      }
      return null
    }

    /** Schedule a refresh just after the next local midnight so the date
     *  line, the Hijri date and the day's rows roll over by themselves.
     *
     *  Deliberately the weak one of the two alarms: inexact, no wake-up, and
     *  independent of the exact-alarm permission. It used to be the only
     *  thing standing between Isha and morning, which is why the countdown
     *  could sit at zero for hours; the boundary alarm now wraps past
     *  midnight and lands on tomorrow's Fajr, so this is what it was always
     *  described as — a backstop. Nobody is looking at a home screen at
     *  00:00:30, and anybody who does has just unlocked the phone, which
     *  refreshes every widget through ACTION_USER_PRESENT. */
    private fun scheduleMidnightRollover(context: Context) {
      val midnight = java.util.Calendar.getInstance().apply {
        add(java.util.Calendar.DAY_OF_MONTH, 1)
        set(java.util.Calendar.HOUR_OF_DAY, 0)
        set(java.util.Calendar.MINUTE, 0)
        set(java.util.Calendar.SECOND, 30)
        set(java.util.Calendar.MILLISECOND, 0)
      }
      val intent = Intent(context, PrayerWidgetProvider::class.java).apply {
        action = ACTION_PRAYER_TIME_ELAPSED
      }
      val pi = PendingIntent.getBroadcast(
        context, 1002, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      am.set(android.app.AlarmManager.RTC, midnight.timeInMillis, pi)
    }

    /**
     * Islamic Midnight and the Last Third as a pair on one line, plan §2b's
     * "Midnight 00:34 … Last third 02:22".
     *
     * On the strip they cannot be columns: eight across four launcher cells
     * is about 5pt type, which is the same argument the plan uses against a
     * monthly widget. On the list they ARE rows, drawn by the column binder
     * at slots 6 and 7, so this does nothing there.
     */
    private fun bindNightRow(
      views: RemoteViews,
      displayRows: List<org.json.JSONObject>,
      layoutId: Int,
    ) {
      if (layoutId != R.layout.prayer_widget_strip) return
      val night = displayRows.filter { isNightKey(it.optString("key")) }
      if (night.isEmpty()) {
        views.setViewVisibility(R.id.widget_night_row, View.GONE)
        return
      }
      views.setViewVisibility(R.id.widget_night_row, View.VISIBLE)
      fun label(o: org.json.JSONObject): String {
        val name = o.optString("name", "").trim().ifEmpty { o.optString("key") }
        return "$name ${displayTime(o)}"
      }
      // Two of them sit at the two ends of the line, which is how this has
      // always looked; a third goes between them rather than off the edge.
      views.setTextViewText(R.id.widget_night_left, label(night[0]))
      views.setTextViewText(
        R.id.widget_night_mid,
        if (night.size > 2) label(night[1]) else "",
      )
      views.setViewVisibility(
        R.id.widget_night_mid,
        if (night.size > 2) View.VISIBLE else View.GONE,
      )
      val last = if (night.size > 2) night[2] else night.getOrNull(1)
      views.setTextViewText(R.id.widget_night_right, last?.let { label(it) } ?: "")
      views.setViewVisibility(
        R.id.widget_night_right,
        if (last != null) View.VISIBLE else View.GONE,
      )
    }

    /**
     * "2 of 5 logged today", plan §2's layout rule: at three cells of height
     * the list gains the night times AND a logged line.
     *
     * Hidden when the app has sent no `today` block, because five unlogged
     * prayers is a claim and an absent block is not evidence for it.
     */
    private fun bindLoggedLine(
      views: RemoteViews,
      payload: org.json.JSONObject,
      context: Context,
      layoutId: Int,
      describesToday: Boolean,
    ) {
      if (layoutId == R.layout.prayer_widget_small) return
      val today = if (describesToday) payload.optJSONObject("today") else null
      if (today == null) {
        views.setViewVisibility(R.id.widget_logged, View.GONE)
        return
      }
      views.setViewVisibility(R.id.widget_logged, View.VISIBLE)
      // The strip's line sits opposite the countdown on one row, where the
      // plan reads "2 of 5 logged"; the list has it under the location with
      // room to say which day it means.
      val res = if (layoutId == R.layout.prayer_widget_strip) {
        R.string.widget_logged_short
      } else {
        R.string.widget_logged_line
      }
      views.setTextViewText(
        R.id.widget_logged,
        context.getString(res, today.optInt("logged", 0), today.optInt("loggable", 5)),
      )
    }

    /**
     * The practice merge, plan §2b: at four cells tall there is room for the
     * whole day AND the record of it, which is the pair people check
     * together — what is next, and whether this week has held.
     *
     * Only on the list layout, only when the launcher says there is room, and
     * only when the app has actually sent a practice block. An absent block
     * is NOT a zero streak: on a home screen those look identical and mean
     * opposite things, so absent draws nothing at all.
     *
     * `widget_practice_row` exists only in prayer_widget.xml. RemoteViews
     * actions against an id the current layout does not contain are quiet
     * no-ops, so the layout check below is for readers rather than for
     * safety — but a reader who does not know that would be right to worry.
     */
    /**
     * A one-row card draws everything a two-row card did, in less padding.
     *
     * The strip's content — the header, the six columns, the next-prayer
     * line — measures about 78dp, and a launcher row is 99. What did not
     * fit was the card's own 14dp of padding at each end, so that is what
     * gives: 6dp above and below, and nothing has to be dropped. The
     * header was hidden here for one build, which was the wrong thing to
     * take away — the widget is placed at one row now, so one row has to
     * be the whole card rather than a reduced version of it.
     *
     * A height of 0 is a launcher that has not measured yet and keeps the
     * roomy padding: the alternative is every first draw being tight and
     * then relaxing, which reads as a bug.
     */
    private fun bindStripHeader(
      context: Context,
      views: RemoteViews,
      layoutId: Int,
      heightDp: Int,
    ) {
      if (layoutId != R.layout.prayer_widget_strip) return
      // An unmeasured card (0) keeps the header: the times and the next line
      // survive being crowded, and a widget whose first draw silently loses
      // its date and city looks broken rather than tight.
      val oneRow = heightDp in 1 until STRIP_TIGHT_CONTENT_DP
      views.setViewVisibility(
        R.id.widget_header_row,
        if (oneRow) View.GONE else View.VISIBLE,
      )
      val tight = heightDp in 1 until STRIP_ROOMY_CONTENT_DP
      val density = context.resources.displayMetrics.density
      val side = (14 * density).toInt()
      val ends = ((if (tight) 6 else 14) * density).toInt()
      views.setViewPadding(R.id.widget_root, side, ends, side, ends)
      // The rule above the next-prayer line is the other thing that does
      // not fit: it costs ten points with its margin, and the line it
      // separates is legible without it on a card this short.
      views.setViewVisibility(
        R.id.widget_strip_divider,
        if (tight) View.GONE else View.VISIBLE,
      )

      // Two rows, and no graph to spend the second one on.
      //
      // The times row takes its own height, which is what stopped the graph
      // stealing the space the six times need — but it also means a card
      // taller than the content just ends early, and a 4x2 drew its three
      // lines against the top with a third of the card blank underneath.
      // The row grows into the gap instead: the header stays at the top, the
      // next-prayer line lands on the bottom, and the times sit in the middle
      // of the card rather than crowded against its lid.
      //
      // Nothing to do from three rows up, where the graph is the thing that
      // fills it.
      //
      // The budget below is the one that CHOSE the variant a few lines up,
      // which is the invariant this arithmetic lost once already: pick the
      // layout against one number and fill it against another and the
      // difference comes out of the last row on the card.
      val budget =
        if (oneRow) STRIP_BARE_CONTENT_DP
        else if (tight) STRIP_TIGHT_CONTENT_DP
        else STRIP_ROOMY_CONTENT_DP
      val slack =
        if (heightDp <= 0 || heightDp >= GRID_MIN_HEIGHT_DP) 0
        else ((heightDp - budget) / 2).coerceIn(0, STRIP_SLACK_CAP_DP)
      val slackPx = (slack * density).toInt()
      views.setViewPadding(R.id.widget_times_row, 0, slackPx, 0, slackPx)
    }

    private fun bindPracticeStrip(
      views: RemoteViews,
      payload: org.json.JSONObject,
      style: WidgetStyle,
      context: Context,
      layoutId: Int,
      heightDp: Int,
      widthDp: Int,
    ) {
      if (layoutId == R.layout.prayer_widget_small) return
      val practice = payload.optJSONObject("practice")
      // Two tiers rather than one. The graph earns its place from three
      // launcher rows up; the month footer needs a fourth. Gating both on the
      // taller number is what left a third of a 4x3 empty.
      // An unmeasured card (0) draws NO graph, where the rest of the
      // sizing treats 0 as "roomy". The two defaults point opposite ways on
      // purpose: dropping a line from a card that turns out to be tall
      // costs a line, while drawing a graph on a card that turns out to be
      // short takes the space from the row above it — and that row is the
      // prayer times, which came out as six names with nothing under them.
      val show = practice != null && heightDp >= GRID_MIN_HEIGHT_DP
      val showFoot = show && heightDp >= PRACTICE_MIN_HEIGHT_DP
      val vis = if (show) View.VISIBLE else View.GONE
      // The divider goes with the block it separates. Leaving it behind is
      // how a widget ends up with a rule drawn across an empty gap.
      views.setViewVisibility(R.id.widget_practice_divider, vis)
      views.setViewVisibility(R.id.widget_practice_row, vis)
      views.setViewVisibility(R.id.widget_practice_grid, vis)
      // In the strip these three live on the next-prayer line rather than in
      // a row of their own, so they are shown and hidden by name. In the tall
      // layout they are inside `widget_practice_row` and this is redundant —
      // a GONE parent wins — which is the cheaper of the two ways to keep one
      // binder honest about two layouts.
      views.setViewVisibility(R.id.widget_practice_streak, vis)
      views.setViewVisibility(R.id.widget_practice_second, vis)
      // "2 of 5 logged" and the summary's "2 of 5 today" are the same fact,
      // and on one line they would sit six points apart.
      views.setViewVisibility(
        R.id.widget_logged,
        if (show && layoutId == R.layout.prayer_widget_strip) View.GONE else View.VISIBLE,
      )
      views.setViewVisibility(
        R.id.widget_practice_foot,
        if (showFoot) View.VISIBLE else View.GONE,
      )
      if (!show || practice == null) return

      val accent = style.highlightColorInt(context)
      val streak = practice.optInt("streak", 0)
      // The plan draws "12  day streak · best 31": the number carries the
      // size and nothing else, and the words beside it stay muted. Putting
      // the unit in the big view too ("0 days") makes the eye read a phrase
      // where it should be reading one figure.
      views.setTextViewText(R.id.widget_practice_streak, streak.toString())
      views.setTextColor(
        R.id.widget_practice_streak,
        if (layoutId == R.layout.prayer_widget_strip) Color.parseColor(NEUTRAL_TEXT) else accent,
      )

      // The strip runs the unit inline with the rest ("12  day streak · Best
      // 31 · …"); the tall layout has a line of its own for it, next to the
      // number, the way the systemLarge mock sets it.
      val unit = context.resources.getQuantityString(
        R.plurals.widget_streak_day_label, streak, streak,
      )
      views.setTextViewText(R.id.widget_practice_unit, unit)

      val parts = mutableListOf<String>()
      if (layoutId == R.layout.prayer_widget_strip) parts.add(unit)
      val best = practice.optInt("bestStreak", 0)
      if (best > 0) parts.add(context.getString(R.string.widget_streak_best, best))
      parts.add(context.getString(R.string.widget_streak_logged, practice.optInt("loggedToday", 0)))
      val owed = practice.optInt("owed", 0)
      if (owed > 0) {
        parts.add(
          context.resources.getQuantityString(R.plurals.widget_streak_make_up, owed, owed),
        )
      }
      views.setTextViewText(R.id.widget_practice_second, parts.joinToString(" · "))

      val density = context.resources.displayMetrics.density
      val wide = layoutId == R.layout.prayer_widget_strip
      // The wide layout gives the grid the card's width and roughly two
      // thirds of what is left below the strip; the tall one sets it beside
      // the streak number, in half the width. The count of days, the cell
      // shape and the gap all come out of that one box — see `layoutFor`.
      val grid = PracticeGridBitmap.layoutFor(
        (if (wide) widthDp - STRIP_CONTENT_INSET_DP
        else (widthDp - STRIP_CONTENT_INSET_DP) / 2),
        // The times row and the grid split what is left, weighted 1:2 — but
        // only while the month footer is drawn under it. Without the footer
        // the grid keeps the whole remainder, and a box reckoned at two
        // thirds of it is a graph with a third of a card under it.
        ((heightDp - STRIP_CHROME_DP) * (if (heightDp >= PRACTICE_MIN_HEIGHT_DP) 2 else 3)) / 3,
        density,
        if (wide) MAX_GRID_DAYS else MAX_GRID_DAYS / 2,
      )
      views.setImageViewBitmap(
        R.id.widget_practice_grid,
        PracticeGridBitmap.render(
          practice.optJSONArray("days"),
          grid.rows,
          grid.columns,
          grid.cellWPx,
          grid.cellHPx,
          grid.gapPx,
          accent,
          practice.optString("since").ifEmpty { null },
        ),
      )

      // "Sunnah 68% this month" opposite "6 fasts" — the two facts the plan
      // puts at the foot of the 4x4, and the only place either appears on a
      // home screen. Each is dropped rather than zeroed when the payload has
      // nothing to say: "Sunnah 0%" reads as a judgement, and an absent
      // figure reads as nothing at all, which is what it is.
      val sunnah = practice.optDouble("sunnahRate", Double.NaN)
      val sunnahText = if (sunnah.isNaN()) "" else context.getString(
        R.string.widget_practice_sunnah_month,
        Math.round(sunnah * 100).toInt(),
      )
      views.setTextViewText(R.id.widget_practice_sunnah, sunnahText)
      views.setViewVisibility(
        R.id.widget_practice_sunnah,
        if (sunnahText.isEmpty()) View.INVISIBLE else View.VISIBLE,
      )

      val fasts = practice.optInt("fastsThisMonth", 0)
      val fastsText = if (fasts <= 0) "" else context.resources.getQuantityString(
        R.plurals.widget_practice_fasts, fasts, fasts,
      )
      views.setTextViewText(R.id.widget_practice_fasts, fastsText)
      views.setViewVisibility(
        R.id.widget_practice_fasts,
        if (fastsText.isEmpty()) View.GONE else View.VISIBLE,
      )
    }

    /**
     * The three optional night times. They can be the headline now — this
     * only decides how a row that is *not* the headline is painted: muted,
     * the way Sunrise has always been, so the five salāh stay the loudest
     * thing on the card.
     */
    /**
     * What to DRAW for a row — issue #18.
     *
     * `time` is canonical 24-hour `HH:mm` because this file, the Live
     * Activity service and the widget's own next-prayer walk all parse
     * it. `display` is the same instant written the way the user reads a
     * clock, and is absent from payloads written by app builds that
     * predate the setting — hence the fallback.
     */
    private fun displayTime(o: org.json.JSONObject): String =
      o.optString("display", "").ifEmpty { o.optString("time", "") }

    private fun isNightKey(key: String): Boolean =
      key.equals("Midnight", ignoreCase = true) ||
        key.equals("Lastthird", ignoreCase = true) ||
        key.equals("Firstthird", ignoreCase = true)

    /**
     * Minutes-since-midnight of the earliest salāh (or Sunrise) on display,
     * for the after-Isha wrap. Sunrise counts — whatever comes first
     * tomorrow is what the countdown is for.
     */
    private fun firstRowMinutes(displayRows: List<org.json.JSONObject>): Int? {
      var earliest: Int? = null
      for (row in displayRows) {
        val parts = row.optString("time").split(":")
        if (parts.size != 2) continue
        val h = parts[0].toIntOrNull() ?: continue
        val m = parts[1].toIntOrNull() ?: continue
        val mins = h * 60 + m
        if (earliest == null || mins < earliest!!) earliest = mins
      }
      return earliest
    }

    /** The launcher's own measurement, or 0 when it has not measured yet. */
    private fun measuredHeightDp(
      context: Context,
      mgr: AppWidgetManager,
      appWidgetId: Int,
    ): Int = sizeDp(context, mgr, appWidgetId).second

    /** The same, across. The grid needs both to know how many weeks fit. */
    private fun measuredWidthDp(
      context: Context,
      mgr: AppWidgetManager,
      appWidgetId: Int,
    ): Int = sizeDp(context, mgr, appWidgetId).first

    /**
     * Four launcher rows. Below this the practice strip would eat the space
     * the prayer times need, and the times are why the widget is there.
     */
    private const val PRACTICE_MIN_HEIGHT_DP = 375

    /**
     * Where the streak line and the practice graph start appearing.
     *
     * Lower than PRACTICE_MIN_HEIGHT_DP, which now gates only the month
     * footer, because there was a whole band between them — a 4x3 — that
     * showed the strip, the two footer lines, and then nothing at all for the
     * bottom third of the card. Three launcher rows is enough to draw a
     * graph; it is not enough to draw a graph AND two more lines under it.
     *
     * It was 265 — between two launcher rows (210dp on a 420dpi phone) and
     * three (321dp) — so the graph was what a third row bought. Seven rows
     * of week-columns needed that much: below it the days came out as specks
     * and the card was better off without them.
     *
     * Three rows need less than half the height, and a 4x2 is the size
     * people actually keep a prayer widget at. 200 puts the graph inside two
     * launcher rows, where it now has room to be read rather than merely
     * fitted. (It was 180 once, for a different reason and wrongly: a
     * weighted times row was pooling the card's slack, which was a layout
     * bug wearing this constant's clothes. The row takes its own height now,
     * so the number is free to mean what it says.)
     *
     * 198 now, which is `STRIP_CHROME_DP` plus one row: the graph is no
     * longer a block that needs three rows or nothing, it is however many
     * rows the card has room for, and the smallest useful answer to that is
     * one row rather than an absence. Below this there is not room for a
     * single square under the times, and a graph with no rows in it is a gap
     * with a description.
     */
    private const val GRID_MIN_HEIGHT_DP = 198

    /**
     * Bind the payload into whichever layout was chosen.
     *
     * Layout-agnostic by design: every layout it can be handed declares the
     * same ids, so this never needs to know which one it is filling — with
     * one exception now, the practice strip, which exists only in the list
     * layout and is passed `layoutId` rather than guessing.
     */
    private fun applyJson(
      views: RemoteViews,
      o: JSONObject,
      style: WidgetStyle,
      context: Context,
      layoutId: Int = R.layout.prayer_widget,
      heightDp: Int = 0,
      widthDp: Int = 0,
    ) {
      views.setViewVisibility(R.id.widget_placeholder, View.GONE)
      views.setViewVisibility(R.id.widget_content, View.VISIBLE)

      WidgetCard.paint(views, style.backgroundArgb())

      val nextKey =
        if (o.isNull("nextKey")) {
          null
        } else {
          o.optString("nextKey", "").trim().takeIf { it.isNotEmpty() }
        }

      var nextPrayerName = o.optString("nextPrayerName", "")
      var nextPrayerTime =
        o.optString("nextPrayerDisplay", "").ifEmpty { o.optString("nextPrayerTime", "") }
      val locationName = o.optString("locationName", "")

      // Prefer the entry from the multi-day `days[]` schedule whose dateKey
      // matches the device's current local date. This is what lets the widget
      // roll onto the correct day's times on its own — previously `rows` was a
      // single-day snapshot that only refreshed when the app was reopened, so
      // the times went stale ~24h later. Falls back to the top-level single-day
      // fields when no `days[]` is present (older payloads) or none matches.
      val todayDay = selectTodayDay(o)
      val rows = todayDay?.optJSONArray("rows") ?: o.getJSONArray("rows")
      // sunriseRow is a separate object (not in `rows`) rendered at display slot 1.
      val sunriseRowObj = todayDay?.optJSONObject("sunriseRow") ?: o.optJSONObject("sunriseRow")

      // Build the ordered display list: Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha
      val displayRows = mutableListOf<org.json.JSONObject>()
      if (rows.length() > 0) displayRows.add(rows.getJSONObject(0)) // Fajr at slot 0
      sunriseRowObj?.let { displayRows.add(it) }                     // Sunrise at slot 1
      for (i in 1 until rows.length()) displayRows.add(rows.getJSONObject(i)) // rest of salāh
      // ...then the night rows, after Isha. Absent entirely unless the user
      // turned them on — the payload only carries them when they are enabled,
      // so there is nothing to gate on here.
      val nightRows = todayDay?.optJSONArray("extraRows") ?: o.optJSONArray("extraRows")
      if (nightRows != null) {
        for (i in 0 until nightRows.length()) {
          nightRows.optJSONObject(i)?.let { displayRows.add(it) }
        }
      }

      // Dynamically calculate next event (prayer or sunrise) based on current time
      val cal = java.util.Calendar.getInstance()
      val currentMinutes = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)

      var dynamicNextKey: String? = null
      var dynamicNextName = ""
      var dynamicNextTime = ""
      var nextUpdateMinutes = -1

      // Every row on the card is a candidate, night times included. They are
      // only here because the user turned them on, and the hours between Isha
      // and Fajr are exactly when a home screen has nothing else to count
      // down to.
      //
      // The EARLIEST row still ahead, not the first one found: `displayRows`
      // is in display order, and display order is not the clock. Islamic
      // Midnight and the Last Third are drawn after Isha but belong to the
      // small hours of the same date, and the First Third is drawn last and
      // falls in the evening — so a walk that stopped at the first row later
      // than now would answer "Isha" at nine o'clock with the First Third
      // half an hour away.
      for (row in displayRows) {
        val timeStr = row.getString("time")
        val parts = timeStr.split(":")
        if (parts.size == 2) {
          val h = parts[0].toIntOrNull() ?: continue
          val m = parts[1].toIntOrNull() ?: continue
          val rowMinutes = h * 60 + m
          if (rowMinutes > currentMinutes &&
            (nextUpdateMinutes < 0 || rowMinutes < nextUpdateMinutes)
          ) {
            dynamicNextKey = row.getString("key")
            dynamicNextName = row.optString("name", "").trim()
              .ifEmpty { row.optString("abbr", "").trim() }
              .ifEmpty { dynamicNextKey!! }
            dynamicNextTime = displayTime(row)
            nextUpdateMinutes = rowMinutes
          }
        }
      }

      if (dynamicNextKey != null) {
        nextPrayerName = dynamicNextName
        nextPrayerTime = dynamicNextTime
      } else if (nextPrayerName.isEmpty() && nextKey != null) {
        for (row in displayRows) {
          if (row.getString("key") == nextKey) {
            nextPrayerName = row.optString("name", "").trim()
              .ifEmpty { row.optString("abbr", "").trim() }
              .ifEmpty { nextKey }
            nextPrayerTime = displayTime(row)
            break
          }
        }
      }
      val effectiveNextKey = dynamicNextKey ?: nextKey

      val normalColor = Color.parseColor(NEUTRAL_TEXT)
      val highlightColor = style.highlightColorInt(context)

      views.setTextViewText(R.id.widget_next_name, nextPrayerName)
      views.setViewVisibility(R.id.widget_next_name, if (nextPrayerName.isEmpty()) View.GONE else View.VISIBLE)

      views.setTextViewText(R.id.widget_next_time, nextPrayerTime)
      views.setViewVisibility(R.id.widget_next_time, if (nextPrayerTime.isEmpty()) View.GONE else View.VISIBLE)

      // On the strip the location shares a header line with the day, the way
      // the plan draws it ("Wed, 19 Aug · Makkah"), and the Hijri date sits
      // opposite. The list keeps the bare location it has always had.
      val headerText = if (layoutId == R.layout.prayer_widget_strip) {
        // The DAY'S OWN label, not the payload's.
        //
        // The times below this line roll with `days[]`; the top-level
        // `dayLabel` is stamped when the payload is written and never moves.
        // Read together, from day two onward the card stated one date above a
        // different day's times — the single most misleading thing a prayer
        // widget can do. Each entry in `days[]` already carries its own label;
        // it was simply never used.
        val day = (todayDay?.optString("dayLabel")?.trim().takeUnless { it.isNullOrEmpty() }
          ?: o.optString("dayLabel", "").trim())
        when {
          day.isEmpty() -> locationName
          locationName.isEmpty() -> day
          else -> "$day · $locationName"
        }
      } else {
        locationName
      }
      views.setTextViewText(R.id.widget_location, headerText)
      views.setViewVisibility(R.id.widget_location, if (headerText.isEmpty()) View.GONE else View.VISIBLE)

      // Both the Hijri date and "2 of 5 logged" describe the day the payload
      // was WRITTEN, and neither rolls the way `days[]` does. Once the card
      // has moved onto a later day they are simply someone else's facts, so
      // they go rather than mislead — the same call iOS makes in
      // `perDayPayload(isToday:)`. The dedicated Hijri and Log Today widgets
      // have their own, correctly gated, copies of both.
      val describesToday = payloadDescribesToday(o)
      val hijriLabel = if (!describesToday) "" else
        o.optJSONObject("hijri")?.optString("label", "")?.trim().orEmpty()
      views.setTextViewText(R.id.widget_hijri, hijriLabel)
      views.setViewVisibility(R.id.widget_hijri, if (hijriLabel.isEmpty()) View.GONE else View.VISIBLE)

      views.setTextColor(R.id.widget_next_name, normalColor)
      views.setTextColor(R.id.widget_next_time, highlightColor)
      views.setTextColor(R.id.widget_location, Color.parseColor(NEUTRAL_MUTED))

      // The countdown to the next event, ticked by the system.
      //
      // This used to be a string computed right here — "1h 54m" — which the
      // comment above it defended as "fresh whenever the user looks",
      // because the widget redraws on screen-on and at each prayer
      // transition. That is true and it was never badly wrong; it was also
      // frozen for anyone who looked at it for longer than a moment, and the
      // plan asks for a countdown "ticked by the system, not by us".
      //
      // A Chronometer is that, at zero refresh cost: hand it the moment the
      // next event lands and the view counts itself down. Chronometer is a
      // TextView, so the colour and visibility actions below are unchanged.
      //
      // `setChronometerCountDown` is API 24 and minSdk is 24.
      // Wraps past midnight. After Isha there is no row left today, and the
      // widget used to show no countdown at all until the small hours — six
      // silent hours, which is precisely the stretch where a home screen most
      // needs to say "Fajr, in six hours". The rows on display are already
      // tomorrow's by then (`selectTodayDay` rolls the day over), so the
      // first of them is the right target; it is just on the other side of
      // midnight. The same wrap the iOS ring does, for the same reason.
      val minutesLeft = when {
        nextUpdateMinutes != -1 && nextUpdateMinutes >= currentMinutes ->
          nextUpdateMinutes - currentMinutes
        else -> firstRowMinutes(displayRows)?.let { it + 24 * 60 - currentMinutes } ?: -1
      }
      if (minutesLeft >= 0) {
        // Base is on the elapsedRealtime clock, and the seconds of the
        // current minute have to come off it or the countdown is up to 59
        // seconds early — which is exactly long enough to show 00:00 while
        // the prayer has not arrived.
        val secondsIntoMinute = java.util.Calendar.getInstance().get(java.util.Calendar.SECOND)
        val base = android.os.SystemClock.elapsedRealtime() +
          minutesLeft * 60_000L - secondsIntoMinute * 1000L
        views.setChronometerCountDown(R.id.widget_remaining, true)
        views.setChronometer(
          R.id.widget_remaining,
          base,
          context.getString(R.string.widget_countdown_format),
          true,
        )
        views.setViewVisibility(R.id.widget_remaining, View.VISIBLE)
      } else {
        // Only reachable with no usable rows at all. Stopped as well as
        // hidden: a running Chronometer inside a hidden view is still a view
        // being invalidated once a second.
        views.setChronometer(R.id.widget_remaining, 0L, null, false)
        views.setViewVisibility(R.id.widget_remaining, View.GONE)
      }
      views.setTextColor(R.id.widget_remaining, Color.parseColor(NEUTRAL_MUTED))

      views.setViewVisibility(R.id.widget_times_row, View.VISIBLE)

      // How big the times can be set without the columns running into each
      // other — see `stripTimeSizeSp`. Measured across ALL the visible times
      // and applied to all of them, because a row where one column is 12sp
      // and the next is 17sp is worse than a row that is uniformly smaller.
      val shown = displayRows.take(COL_LABELS.size)
      val timeSizeSp = stripTimeSizeSp(
        context,
        shown.map { displayTime(it) },
        (widthDp - STRIP_CONTENT_INSET_DP).toFloat() / shown.size.coerceAtLeast(1),
      )

      for (i in COL_LABELS.indices) {
        if (i >= displayRows.size) {
          views.setViewVisibility(COL_WRAPPERS[i], View.GONE)
          continue
        }
        val row = displayRows[i]
        val key = row.getString("key")
        val time = displayTime(row)
        val label = row.optString("name", "").trim()
          .ifEmpty { row.optString("abbr", "").trim() }
          .ifEmpty { key }
        val isNight = isNightKey(key)
        val highlight = effectiveNextKey != null && effectiveNextKey == key
        val isSunrise = key.equals("Sunrise", ignoreCase = true)
        val col = when {
          highlight -> highlightColor
          // Secondary is what Sunrise has always been — on the card without
          // competing with the salāh — and it is what the night rows are too.
          isSunrise || isNight -> Color.parseColor(NEUTRAL_MUTED)
          else -> normalColor
        }

        views.setViewVisibility(COL_WRAPPERS[i], View.VISIBLE)
        views.setTextViewText(COL_LABELS[i], label)
        views.setTextViewText(COL_TIMES[i], styledTime(time))
        views.setTextViewTextSize(
          COL_TIMES[i],
          android.util.TypedValue.COMPLEX_UNIT_SP,
          timeSizeSp,
        )
        views.setTextColor(COL_LABELS[i], col)
        views.setTextColor(COL_TIMES[i], col)

        if (highlight) {
          views.setInt(COL_BOXES[i], "setBackgroundResource", R.drawable.widget_row_highlight)
        } else {
          views.setInt(COL_BOXES[i], "setBackgroundResource", 0)
        }
      }

      bindNightRow(views, displayRows, layoutId)
      bindLoggedLine(views, o, context, layoutId, describesToday)
      bindStripHeader(context, views, layoutId, heightDp)
      bindPracticeStrip(views, o, style, context, layoutId, heightDp, widthDp)

      // The alarms are NOT armed here any more — see `armWidgetAlarms`. A
      // render is the wrong place to schedule from: it only happens when a
      // prayer-times widget is placed, and only when it succeeds.
    }
  }
}
