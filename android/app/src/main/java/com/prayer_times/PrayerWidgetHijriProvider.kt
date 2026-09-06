package com.prayer_times

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Hijri Date — the cheapest widget in the plan and close to the most useful.
 *
 * The Hijri date is the one thing in this app people look UP rather than
 * read, and it was only available by opening Home. iOS has had this since
 * phase 1; Android had not, which is the whole of the change.
 *
 * The date comes from the payload. There is a tabular Umm al-Qura conversion
 * in the app (`hijri/convert.ts`) and duplicating it in Kotlin would mean two
 * implementations that can disagree about which day it is — and disagreeing
 * about the date is the only way this widget can be wrong.
 *
 * Deliberately NOT modelling the sunset turnover: the payload states the date
 * the APP believes it is, and the app is the thing the user is comparing
 * against. A widget that flipped to tomorrow at sunset while Home still said
 * today would be a bug report, not a feature.
 */
class PrayerWidgetHijriProvider : AppWidgetProvider() {

  // Every branch goes through PrayerWidgetProvider.requestUpdate rather than
  // this provider's own: one signal has to redraw every widget and re-arm the
  // alarm chain, or a home screen holding only this one stops moving. See the
  // comment on requestUpdate.
  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      Intent.ACTION_USER_PRESENT,
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_DATE_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      PrayerWidgetProvider.ACTION_PRAYER_TIME_ELAPSED ->
        PrayerWidgetProvider.requestUpdate(context)
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

    fun requestUpdate(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, PrayerWidgetHijriProvider::class.java))
      for (id in ids) mgr.updateAppWidget(id, buildViews(context))
    }

    private fun hijri(context: Context): JSONObject? {
      // Parsed once per version of the payload rather than once per
      // redraw — see PrayerWidgetProvider.payload.
      val root = PrayerWidgetProvider.payload(context) ?: return null
        // Stating the wrong date is the only way this widget can be wrong,
        // and an expired payload states exactly that. Same rule.
      if (PrayerWidgetProvider.payloadHasExpired(root)) return null
      return root.optJSONObject("hijri")
    }

    fun buildViews(base: Context): RemoteViews {
      // Every label below comes out of the string table, so the context has to
      // be the one that speaks Mihrab's language before anything is read from
      // it. See PrayerWidgetProvider.localized.
      val context = PrayerWidgetProvider.localized(base)
      val views = RemoteViews(context.packageName, R.layout.prayer_widget_hijri)
      val (background, accent) = PrayerWidgetProvider.resolvedColors(context)
      WidgetCard.paint(views, background)
      views.setOnClickPendingIntent(R.id.widget_root, openTodayIntent(context))

      val h = hijri(context)
      if (h == null) {
        views.setViewVisibility(R.id.widget_content, View.GONE)
        views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
        views.setTextViewText(
          R.id.widget_placeholder,
          context.getString(R.string.widget_placeholder_open_app),
        )
        return views
      }

      views.setViewVisibility(R.id.widget_placeholder, View.GONE)
      views.setViewVisibility(R.id.widget_content, View.VISIBLE)

      // "7 Rabi I" and "1448" on separate lines: "7 Rabi I 1448" at one size
      // reads as one long string and the eye has to parse it to find the day,
      // which is the number people came for.
      views.setTextViewText(
        R.id.hijri_day_month,
        context.getString(
          R.string.widget_hijri_day_month,
          h.optInt("day", 1),
          h.optString("monthName"),
        ),
      )
      views.setTextColor(R.id.hijri_day_month, accent)
      // No number formatting anywhere near this: a Hijri year is a label, not
      // a quantity, and it has no thousands separator. The iOS side learned
      // that when SwiftUI rendered 1448 as "1 448".
      views.setTextViewText(R.id.hijri_year, h.optInt("year", 0).toString())

      val nextMonth = h.optString("nextMonthName")
      val inDays = h.optInt("nextMonthInDays", 0)
      if (nextMonth.isEmpty()) {
        views.setViewVisibility(R.id.hijri_next_column, View.GONE)
      } else {
        views.setViewVisibility(R.id.hijri_next_column, View.VISIBLE)
        views.setTextViewText(R.id.hijri_next_label, context.getString(R.string.widget_hijri_next))
        views.setTextViewText(
          R.id.hijri_next_value,
          when {
            // "tomorrow" beats "in 1 days", and "today" beats "in 0 days".
            inDays <= 0 -> context.getString(R.string.widget_hijri_begins_today, nextMonth)
            inDays == 1 -> context.getString(R.string.widget_hijri_begins_tomorrow, nextMonth)
            else -> context.getString(R.string.widget_hijri_in_days, nextMonth, inDays)
          },
        )
      }
      return views
    }

    private fun openTodayIntent(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mihrab://today")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3400,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
