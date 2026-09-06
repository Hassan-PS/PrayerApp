package com.prayer_times

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Paint
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Streak & Practice — the Log screen's four stat tiles, minus three.
 *
 * A SEPARATE receiver rather than a size of the prayer-times widget. The 4x4
 * prayer widget already carries the graph, which is right for someone who
 * wants both facts together; this is for someone who wants only this one and
 * should not have to put a prayer table on their home screen to get it.
 *
 * The graph is a Bitmap (see PracticeGridBitmap). RemoteViews has no loops,
 * so seventy cells as views would mean seventy generated ids and seventy
 * actions crossing the process boundary on every update.
 *
 * Draws nothing but the placeholder when the payload has no `practice`
 * block. An absent block is not a zero streak: on a home screen those look
 * identical and mean opposite things.
 */
class PrayerWidgetStreakProvider : AppWidgetProvider() {

  // Every branch goes through PrayerWidgetProvider.requestUpdate rather than
  // this provider's own: one signal has to redraw every widget and re-arm the
  // alarm chain, or a home screen holding only this one stops moving. See the
  // comment on requestUpdate.
  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      Intent.ACTION_USER_PRESENT,
      Intent.ACTION_BOOT_COMPLETED,
      PrayerWidgetProvider.ACTION_PRAYER_TIME_ELAPSED ->
        PrayerWidgetProvider.requestUpdate(context)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildViews(context, id, appWidgetManager))
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
    appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId, appWidgetManager))
  }

  companion object {

    fun requestUpdate(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, PrayerWidgetStreakProvider::class.java))
      for (id in ids) mgr.updateAppWidget(id, buildViews(context, id, mgr))
    }

    private fun practice(context: Context): JSONObject? {
      // Parsed once per version of the payload rather than once per
      // redraw — see PrayerWidgetProvider.payload.
      val root = PrayerWidgetProvider.payload(context) ?: return null
        // A streak from a payload written weeks ago is a claim about weeks
        // the app has not seen. See PrayerWidgetProvider.payloadHasExpired.
      if (PrayerWidgetProvider.payloadHasExpired(root)) return null
      return root.optJSONObject("practice")
    }

    /** 10dp top + 10dp bottom, from the layout's own padding. */
    private const val PADDING_DP = 20f

    /** A card exactly as tall as its text is a card with its text against
     *  both edges. Ask for a little more than the arithmetic. */
    private const val BREATHING_DP = 8f

    /** The 10sp label, plus the 2dp between it and the number. */
    private const val TITLE_LINE_DP = 15f

    /** The 30sp streak number. */
    private const val VALUE_LINE_DP = 36f

    /** One 11sp line, plus the 1dp above it. */
    private const val BODY_LINE_DP = 14f

    /**
     * How tall the card has to be to hold the number, `bodyLines` lines of
     * 11sp under it, and the title above if `title`.
     *
     * Computed rather than tabulated, because the text scales. The three
     * constants this replaced were each written for one font size, so at
     * 1.3x accessibility text the same card that was judged to fit three
     * lines fitted two, and the third was drawn through the card's edge.
     * Scaling the requirement is the only form of this that is right at
     * both ends of the range.
     */
    private fun requiredHeightDp(context: Context, title: Boolean, bodyLines: Int): Int {
      val scale = context.resources.configuration.fontScale.coerceIn(0.85f, 2f)
      val text = (if (title) TITLE_LINE_DP else 0f) +
        VALUE_LINE_DP + BODY_LINE_DP * bodyLines
      return Math.ceil((PADDING_DP + BREATHING_DP + text * scale).toDouble()).toInt()
    }

    fun buildViews(base: Context, appWidgetId: Int, mgr: AppWidgetManager): RemoteViews {
      // Every label below comes out of the string table, so the context has to
      // be the one that speaks Mihrab's language before anything is read from
      // it. See PrayerWidgetProvider.localized.
      val context = PrayerWidgetProvider.localized(base)
      val views = RemoteViews(context.packageName, R.layout.prayer_widget_streak)
      val (background, accent) = PrayerWidgetProvider.resolvedColors(context)
      WidgetCard.paint(views, background)

      val pr = practice(context)
      if (pr == null) {
        views.setViewVisibility(R.id.widget_content, View.GONE)
        views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
        views.setTextViewText(
          R.id.widget_placeholder,
          context.getString(R.string.widget_placeholder_open_app),
        )
        views.setOnClickPendingIntent(R.id.widget_root, openLogIntent(context))
        return views
      }

      views.setViewVisibility(R.id.widget_placeholder, View.GONE)
      views.setViewVisibility(R.id.widget_content, View.VISIBLE)

      val (widthDp, heightDp) = PrayerWidgetProvider.sizeDp(context, mgr, appWidgetId)

      // How many lines the card can actually hold.
      //
      // These used to stack one after another regardless of height, so at
      // 2x1 the make-up line was drawn half inside the card and half past
      // its bottom edge — text cut through the middle, which reads as a
      // rendering fault rather than as a widget with more to say than room
      // to say it. Each optional line has to earn its place from the
      // measured height.
      //
      // 0 means the launcher has not measured yet. Draw the card's own
      // design — title, number, one line — and nothing optional: that is
      // what the layout is sized for, so it cannot overflow, and the first
      // onAppWidgetOptionsChanged corrects it.
      val measured = heightDp > 0
      val showTitle = !measured || heightDp >= requiredHeightDp(context, true, 1)
      val roomForOwed = measured && heightDp >= requiredHeightDp(context, showTitle, 2)
      val roomForFasts = measured && heightDp >= requiredHeightDp(context, showTitle, 3)

      views.setViewVisibility(
        R.id.streak_title,
        if (showTitle) View.VISIBLE else View.GONE,
      )

      val streak = pr.optInt("streak", 0)
      views.setTextViewText(R.id.streak_title, context.getString(R.string.widget_streak_title))
      views.setTextViewText(R.id.streak_value, streak.toString())
      views.setTextColor(R.id.streak_value, accent)
      views.setTextViewText(
        R.id.streak_unit,
        context.resources.getQuantityString(R.plurals.widget_streak_days, streak, streak),
      )
      // Sixteen columns at 4x2, eight at 2x2 — measured, not assumed. A grid
      // sized for the wide case and drawn into the narrow one is what makes
      // cells 4px and the whole thing a texture rather than a record. Three
      // rows now, so a column is three days: forty-eight days and twenty-four.
      val columns = if (widthDp >= 220) 16 else 8
      val density = context.resources.displayMetrics.density
      val cell = (7 * density).toInt().coerceAtLeast(3)
      val gap = (2 * density).toInt().coerceAtLeast(1)

      val owed = pr.optInt("owed", 0)
      val fasts = pr.optInt("fastsThisMonth", 0)

      // A make-up count is never simply dropped.
      //
      // At one row — the size this widget ships at — the card holds the
      // title, the number and ONE line beneath it, and a fifth line was
      // drawn through the card's bottom edge. The response to that was to
      // hide the make-up count, which is the wrong thing to lose: it is the
      // only line on the card that asks the reader to do something, and a
      // widget that quietly stops mentioning three owed prayers is worse
      // than one that never mentioned them.
      //
      // So when it cannot have a line of its own it joins the summary line,
      // first and in the danger colour, and the softer facts give way to it
      // in turn. The line is measured against the column it has to fit in
      // rather than guessed at, because the parts are localized and their
      // widths are not knowable from here.
      val inlineOwed = owed > 0 && !roomForOwed
      val inlineFasts = fasts > 0 && !roomForFasts
      views.setTextViewText(
        R.id.streak_second,
        summaryLine(
          context = context,
          pr = pr,
          owed = if (inlineOwed) owed else 0,
          fasts = if (inlineFasts) fasts else 0,
          widthPx = summaryWidthPx(context, widthDp, columns, cell, gap),
        ),
      )

      if (owed > 0 && roomForOwed) {
        views.setViewVisibility(R.id.streak_owed, View.VISIBLE)
        views.setTextViewText(
          R.id.streak_owed,
          context.resources.getQuantityString(R.plurals.widget_streak_make_up, owed, owed),
        )
      } else {
        views.setViewVisibility(R.id.streak_owed, View.GONE)
      }

      if (fasts > 0 && roomForFasts) {
        views.setViewVisibility(R.id.streak_fasts, View.VISIBLE)
        views.setTextViewText(
          R.id.streak_fasts,
          context.resources.getQuantityString(R.plurals.widget_streak_fasts, fasts, fasts),
        )
      } else {
        views.setViewVisibility(R.id.streak_fasts, View.GONE)
      }
      views.setImageViewBitmap(
        R.id.streak_grid,
        PracticeGridBitmap.render(
          pr.optJSONArray("days"),
          PracticeGridBitmap.MAX_ROWS,
          columns,
          cell,
          cell,
          gap,
          accent,
          pr.optString("since").ifEmpty { null },
        ),
      )

      views.setOnClickPendingIntent(R.id.widget_root, openLogIntent(context))
      return views
    }

    private const val SEPARATOR = " · "

    /** The danger colour the make-up line carries when it has one. */
    private const val OWED_COLOR = "#F87171"

    /**
     * The width the summary line has to live in: the card, less its padding,
     * less the graph and the gap before it.
     *
     * The graph is measured from the bitmap that is about to be drawn rather
     * than from a nominal size, so the two can never disagree about how much
     * room is left.
     */
    private fun summaryWidthPx(
      context: Context,
      widthDp: Int,
      columns: Int,
      cell: Int,
      gap: Int,
    ): Float {
      if (widthDp <= 0) return 0f
      val density = context.resources.displayMetrics.density
      val gridPx = columns * cell + (columns - 1) * gap
      // 10dp padding either side, and the 8dp margin before the graph.
      return widthDp * density - 28 * density - gridPx
    }

    /**
     * "3 to make up · Best 31 · 2 of 5 today · Sunnah 68%", dropping the
     * empty halves — and, when the line is wider than the column it has,
     * dropping the softest fact still in it until the rest fits.
     *
     * Order is priority order. The make-up count leads because it is the
     * one part that must survive the trimming; the month's fasts trail
     * because a pat on the back is what a crowded card can most afford to
     * lose. `widthPx` of 0 means the launcher has not measured the card
     * yet — nothing is trimmed, and `ellipsize="end"` on the view is the
     * backstop until it has.
     */
    private fun summaryLine(
      context: Context,
      pr: JSONObject,
      owed: Int,
      fasts: Int,
      widthPx: Float,
    ): CharSequence {
      val parts = mutableListOf<CharSequence>()
      if (owed > 0) {
        val text = context.resources
          .getQuantityString(R.plurals.widget_streak_make_up, owed, owed)
        parts.add(
          SpannableStringBuilder(text).apply {
            setSpan(
              ForegroundColorSpan(android.graphics.Color.parseColor(OWED_COLOR)),
              0,
              length,
              Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
          },
        )
      }
      val best = pr.optInt("bestStreak", 0)
      if (best > 0) parts.add(context.getString(R.string.widget_streak_best, best))
      parts.add(context.getString(R.string.widget_streak_logged, pr.optInt("loggedToday", 0)))
      val rate = pr.optDouble("sunnahRate", 0.0)
      if (rate > 0) {
        parts.add(context.getString(R.string.widget_streak_sunnah, Math.round(rate * 100).toInt()))
      }
      if (fasts > 0) {
        parts.add(context.resources.getQuantityString(R.plurals.widget_streak_fasts, fasts, fasts))
      }

      if (widthPx > 0) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          textSize = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP,
            11f,
            context.resources.displayMetrics,
          )
        }
        // Never below two: the make-up count and whatever follows it still
        // read as a sentence, and one part alone on a card this wide looks
        // like something failed rather than something was omitted.
        while (parts.size > 2 && paint.measureText(join(parts).toString()) > widthPx) {
          parts.removeAt(parts.size - 1)
        }
      }
      return join(parts)
    }

    /** `joinToString` on CharSequences would flatten the spans to text. */
    private fun join(parts: List<CharSequence>): CharSequence {
      val out = SpannableStringBuilder()
      for ((i, part) in parts.withIndex()) {
        if (i > 0) out.append(SEPARATOR)
        out.append(part)
      }
      return out
    }

    /**
     * Opens the Log, through the same mihrab:// route the iOS widgets use.
     *
     * A VIEW intent rather than a bare launcher intent so the app lands on
     * the Log rather than on whatever screen it was last showing — which is
     * the entire reason a streak widget is worth tapping.
     */
    private fun openLogIntent(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mihrab://log")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3100,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
