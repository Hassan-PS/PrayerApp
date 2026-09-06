package com.prayer_times

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Tasbih — a counter, which is the best possible fit for an interactive
 * widget: one target, one number, no navigation.
 *
 * Like Log Today, a tap does not write. The counter lives in the app's own
 * storage and this process cannot reach it, so the tap is appended to a
 * queue and the app replays it — see WidgetTasbihQueue. The number moves on
 * the tap because the view projects the queue over the payload, which is the
 * same projection the app performs when it drains.
 *
 * The one rule that is easy to get wrong: a bounded preset stops at its
 * target. `unboundedAfterTarget` travels on the payload and this must honour
 * it rather than inventing its own — counting past the target here and not
 * in the app is the one way the two can disagree about a number the user is
 * actively watching.
 */
class PrayerWidgetTasbihProvider : AppWidgetProvider() {

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
      ACTION_TASBIH_TAP -> handleTap(context, intent)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, buildViews(context))
  }

  companion object {
    const val ACTION_TASBIH_TAP = "com.prayer_times.ACTION_WIDGET_TASBIH_TAP"
    const val EXTRA_ACTION = "tasbih_action"

    private val DOTS = intArrayOf(
      R.id.tasbih_dot_0, R.id.tasbih_dot_1, R.id.tasbih_dot_2,
      R.id.tasbih_dot_3, R.id.tasbih_dot_4, R.id.tasbih_dot_5,
    )

    fun requestUpdate(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, PrayerWidgetTasbihProvider::class.java))
      for (id in ids) mgr.updateAppWidget(id, buildViews(context))
    }

    /**
     * Record a tap and redraw immediately.
     *
     * The redraw is the point: nothing is written to the store until the app
     * next runs, so this is the only feedback there is. It has to be instant
     * and it has to agree with what the app will do.
     */
    private fun handleTap(context: Context, intent: Intent) {
      val action = intent.getStringExtra(EXTRA_ACTION) ?: return
      WidgetTasbihQueue.append(context, action)
      // Same as the log widget: without this the beads wait for the next app
      // foreground, and the drain discards entries after a fortnight. See
      // WidgetQueueEvents.
      WidgetQueueEvents.postChanged(context)
      requestUpdate(context)
    }

    private fun tasbih(context: Context): JSONObject? {
      // Parsed once per version of the payload rather than once per
      // redraw — see PrayerWidgetProvider.payload.
      val root = PrayerWidgetProvider.payload(context) ?: return null
        // The counts survive, but "Today 231" from a payload written weeks
        // ago is some other day's total. Same rule.
      if (PrayerWidgetProvider.payloadHasExpired(root)) return null
      return root.optJSONObject("tasbih")
    }

    fun buildViews(base: Context): RemoteViews {
      // Every label below comes out of the string table, so the context has to
      // be the one that speaks Mihrab's language before anything is read from
      // it. See PrayerWidgetProvider.localized.
      val context = PrayerWidgetProvider.localized(base)
      val views = RemoteViews(context.packageName, R.layout.prayer_widget_tasbih)
      val (background, accent) = PrayerWidgetProvider.resolvedColors(context)
      WidgetCard.paint(views, background)

      val t = tasbih(context)
      if (t == null) {
        views.setViewVisibility(R.id.widget_content, View.GONE)
        views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
        views.setTextViewText(
          R.id.widget_placeholder,
          context.getString(R.string.widget_placeholder_open_app),
        )
        views.setOnClickPendingIntent(R.id.widget_root, openTasbihIntent(context))
        return views
      }

      views.setViewVisibility(R.id.widget_placeholder, View.GONE)
      views.setViewVisibility(R.id.widget_content, View.VISIBLE)

      val countsArr = t.optJSONArray("counts")
      val counts = (0 until (countsArr?.length() ?: 0)).map { countsArr!!.optInt(it, 0) }
      val total = t.optInt("total", counts.size.coerceAtLeast(1))

      // The whole cycle's labels, targets and flags. Next moves the index in
      // THIS process, before the app runs, so without these the widget kept
      // the previous dhikr's name and target over the new one's count.
      // Absent on a payload written by an older build — fall back to the
      // singular fields, which are right until the first Next.
      val labelsArr = t.optJSONArray("labels")
      val labels = (0 until (labelsArr?.length() ?: 0)).map { labelsArr!!.optString(it) }
      val targetsArr = t.optJSONArray("targets")
      val targets = (0 until (targetsArr?.length() ?: 0)).map { targetsArr!!.optInt(it, 0) }
      val flagsArr = t.optJSONArray("unboundedFlags")
      val unboundedFlags = (0 until (flagsArr?.length() ?: 0)).map { flagsArr!!.optBoolean(it, false) }

      val projected = WidgetTasbihQueue.project(
        index = t.optInt("index", 0),
        total = total,
        counts = counts,
        targets = targets.ifEmpty { List(total) { t.optInt("target", 0) } },
        unboundedFlags = unboundedFlags.ifEmpty { List(total) { t.optBoolean("unbounded", false) } },
        todayTotal = t.optInt("todayTotal", 0),
        queue = WidgetTasbihQueue.read(context),
      )
      val count = projected.counts.getOrElse(projected.index) { t.optInt("count", 0) }
      val target = targets.getOrElse(projected.index) { t.optInt("target", 0) }
      val unbounded = unboundedFlags.getOrElse(projected.index) { t.optBoolean("unbounded", false) }
      val complete = target > 0 && count >= target

      views.setTextViewText(
        R.id.tasbih_label,
        labels.getOrElse(projected.index) { t.optString("label") },
      )
      views.setTextViewText(R.id.tasbih_count, count.toString())
      views.setTextViewText(
        R.id.tasbih_target,
        if (target > 0) context.getString(R.string.widget_tasbih_of, target) else "",
      )
      views.setTextColor(
        R.id.tasbih_target,
        if (complete) accent else Color.parseColor("#9AA0A6"),
      )
      views.setTextViewText(
        R.id.tasbih_today,
        footerLine(context, projected.todayTotal, t.optInt("todayRounds", 0)),
      )

      for (i in DOTS.indices) {
        if (i >= total) {
          views.setViewVisibility(DOTS[i], View.GONE)
          continue
        }
        views.setViewVisibility(DOTS[i], View.VISIBLE)
        views.setInt(
          DOTS[i],
          "setBackgroundResource",
          if (i == projected.index) R.drawable.widget_tasbih_dot_on else R.drawable.widget_tasbih_dot_off,
        )
      }

      // +1 is disabled rather than hidden when a bounded preset is finished:
      // a control that vanishes mid-round moves the other two under a thumb
      // that was already on its way down.
      val incEnabled = !(complete && !unbounded)
      views.setTextViewText(R.id.tasbih_inc, context.getString(R.string.widget_tasbih_inc))
      views.setTextColor(
        R.id.tasbih_inc,
        if (incEnabled) accent else Color.parseColor("#6B7076"),
      )
      views.setInt(
        R.id.tasbih_inc,
        "setBackgroundResource",
        if (incEnabled) R.drawable.widget_tasbih_primary else R.drawable.widget_tasbih_disabled,
      )
      views.setOnClickPendingIntent(
        R.id.tasbih_inc,
        if (incEnabled) tapIntent(context, WidgetTasbihQueue.ACTION_INC, 0) else null,
      )

      views.setTextViewText(R.id.tasbih_reset, context.getString(R.string.widget_tasbih_reset))
      views.setInt(R.id.tasbih_reset, "setBackgroundResource", R.drawable.widget_tasbih_secondary)
      views.setOnClickPendingIntent(
        R.id.tasbih_reset,
        tapIntent(context, WidgetTasbihQueue.ACTION_RESET, 1),
      )

      views.setTextViewText(R.id.tasbih_next, context.getString(R.string.widget_tasbih_next))
      views.setInt(R.id.tasbih_next, "setBackgroundResource", R.drawable.widget_tasbih_secondary)
      views.setOnClickPendingIntent(
        R.id.tasbih_next,
        tapIntent(context, WidgetTasbihQueue.ACTION_NEXT, 2),
      )

      views.setOnClickPendingIntent(R.id.widget_root, openTasbihIntent(context))
      return views
    }

    /** "Today 231 · 3 rounds" — what a single count cannot say on its own. */
    private fun footerLine(context: Context, todayTotal: Int, rounds: Int): String {
      val parts = mutableListOf(context.getString(R.string.widget_tasbih_today, todayTotal))
      if (rounds > 0) {
        parts.add(context.resources.getQuantityString(R.plurals.widget_tasbih_rounds, rounds, rounds))
      }
      return parts.joinToString(" · ")
    }

    /**
     * A distinct request code per control.
     *
     * `FLAG_UPDATE_CURRENT` matches PendingIntents by everything EXCEPT their
     * extras, so three controls sharing a request code would collapse into
     * one and every button would do whichever action was bound last.
     */
    private fun tapIntent(context: Context, action: String, index: Int): PendingIntent {
      val intent = Intent(context, PrayerWidgetTasbihProvider::class.java).apply {
        this.action = ACTION_TASBIH_TAP
        putExtra(EXTRA_ACTION, action)
      }
      return PendingIntent.getBroadcast(
        context,
        2000 + index,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun openTasbihIntent(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mihrab://tasbih")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3300,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
