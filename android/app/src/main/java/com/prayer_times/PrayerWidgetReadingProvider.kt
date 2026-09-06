package com.prayer_times

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Continue Reading — the shortest path back into the habit.
 *
 * Two states and the card is only ever one of them: a khatmah is running, so
 * the headline is the plan's page and the side column is today's portion as
 * a fraction; or there is no plan, so it is the last page read and when.
 *
 * WHICH READER A TAP OPENS IS DECIDED BY THE APP. The payload's `mode` is
 * already resolved against both what the user last had open and whether the
 * ~180 MB mushaf is actually on disk — see buildReadingBlock. A widget that
 * promised "carry on from page 3" and delivered a download prompt would be
 * worse than one that opened the wrong reader.
 *
 * ── TWO INTENTS, NOT ONE (issue #25) ─────────────────────────────────
 *
 * Resuming with recitation meant opening the bookmark, finding the reciter
 * and pressing play — three steps for the thing people do most days. The
 * card's own tap still opens the page in silence, because that is what most
 * taps mean and turning all of them into sound would surprise everyone who
 * reads without it. The play disc beside the surah name is the other
 * intent, and it is the only one that sends `playFromAyah`.
 */
class PrayerWidgetReadingProvider : AppWidgetProvider() {

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
      appWidgetManager.updateAppWidget(id, buildViews(context, widthDp(context, appWidgetManager, id), heightDp(context, appWidgetManager, id)))
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
    appWidgetManager.updateAppWidget(
      appWidgetId,
      buildViews(context, widthDp(context, appWidgetManager, appWidgetId), heightDp(context, appWidgetManager, appWidgetId)),
    )
  }

  companion object {

    fun requestUpdate(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, PrayerWidgetReadingProvider::class.java))
      for (id in ids) mgr.updateAppWidget(id, buildViews(context, widthDp(context, mgr, id), heightDp(context, mgr, id)))
    }

    /** The card's real size, or 0 when the launcher has not measured yet. */
    private fun heightDp(context: Context, mgr: AppWidgetManager, appWidgetId: Int): Int =
      PrayerWidgetProvider.sizeDp(context, mgr, appWidgetId).second

    private fun widthDp(context: Context, mgr: AppWidgetManager, appWidgetId: Int): Int =
      PrayerWidgetProvider.sizeDp(context, mgr, appWidgetId).first

    /**
     * Below this the two columns cannot both be read, so the side one goes.
     * Four launcher cells is roughly 250dp; 200 leaves slack for launchers
     * that report their cells a little short.
     */
    private const val SIDE_COLUMN_MIN_WIDTH_DP = 200

    private fun reading(context: Context): JSONObject? {
      // Parsed once per version of the payload rather than once per
      // redraw — see PrayerWidgetProvider.payload.
      val root = PrayerWidgetProvider.payload(context) ?: return null
        // Least wrong of the four when stale — "last read 40 days ago" is
        // true — but a khatmah's "today's portion" is not. Same rule.
      if (PrayerWidgetProvider.payloadHasExpired(root)) return null
      return root.optJSONObject("reading")
    }

    /**
     * Room for the bar and the two lines under it.
     *
     * 170dp, and the number is arithmetic rather than taste. The full stack
     * — header, surah, page, bar, its label, the tail, with the margins
     * between them — measures about 133dp, and a card is given 32dp less
     * than the launcher hands it (6dp of inset a side, 10dp of padding).
     * So the bar cannot be drawn below 165dp without cutting the lines it
     * sits above.
     *
     * It was 150, which is under that: between 150 and 165 the card drew a
     * stack it had no room for. Two launcher rows is about 220dp so the
     * common case was fine, which is why it went unnoticed — the same way
     * the one-row case fitted by a rounding error until it didn't.
     * `__tests__/readingWidgetSizes.test.ts` computes this rather than
     * trusting it.
     */
    private const val PROGRESS_MIN_HEIGHT_DP = 170

    /**
     * ── HOW MUCH ROOM THERE ACTUALLY IS ──────────────────────────────
     *
     * The default size is 4x1, and one launcher row is not much. Measured
     * on a 420dpi phone: the launcher hands this widget about 101dp, the
     * card insets 6dp on each side and pads 10dp inside that, so the
     * content has **69dp**. At the sizes the type was set to — an 11sp
     * header, a 23sp surah name and a 13sp position line, with their
     * margins — the left column wanted 65dp of it and the side column 70dp.
     * Both were inside a rounding error of the edge, and the side column
     * was already over it: "3 pages left" was cut in half on the default
     * size, which is what a reader sees first.
     *
     * Then the play control landed on the surah's line and made that line
     * 40dp, which took the left column to 77dp and cut the position too.
     * A card that fits by luck will stop fitting.
     *
     * So height picks a tier, and each tier is sized to fit with room over.
     * COMPACT drops the least load-bearing line and scales the type down;
     * GENEROUS scales it up, because three and four rows of a card that
     * keeps 4x1's type is mostly air with a border round it.
     */
    private const val COMPACT_MAX_HEIGHT_DP = 130
    private const val GENEROUS_MIN_HEIGHT_DP = 240

    private enum class Tier { COMPACT, NORMAL, GENEROUS }

    /** An unmeasured height is NORMAL: the same fallback the bar has. */
    private fun tierFor(heightDp: Int): Tier = when {
      heightDp <= 0 -> Tier.NORMAL
      heightDp < COMPACT_MAX_HEIGHT_DP -> Tier.COMPACT
      heightDp >= GENEROUS_MIN_HEIGHT_DP -> Tier.GENEROUS
      else -> Tier.NORMAL
    }

    /**
     * Type scale per tier, in sp.
     *
     * `setTextViewTextSize` rather than three layouts: the difference
     * between the sizes is what the type measures, and three copies of the
     * same card would be three places to fix the next thing.
     */
    private fun applyTypeScale(views: RemoteViews, tier: Tier) {
      val sp = TypedValue.COMPLEX_UNIT_SP
      views.setTextViewTextSize(
        R.id.reading_surah, sp,
        when (tier) { Tier.COMPACT -> 20f; Tier.NORMAL -> 23f; Tier.GENEROUS -> 28f },
      )
      views.setTextViewTextSize(
        R.id.reading_position, sp,
        when (tier) { Tier.COMPACT -> 12f; else -> 13f },
      )
      views.setTextViewTextSize(
        R.id.reading_side_value, sp,
        when (tier) { Tier.COMPACT -> 22f; Tier.NORMAL -> 27f; Tier.GENEROUS -> 32f },
      )
    }

    fun buildViews(base: Context, widthDp: Int = 0, heightDp: Int = 0): RemoteViews {
      // Every label below comes out of the string table, so the context has to
      // be the one that speaks Mihrab's language before anything is read from
      // it. See PrayerWidgetProvider.localized.
      val context = PrayerWidgetProvider.localized(base)
      val views = RemoteViews(context.packageName, R.layout.prayer_widget_reading)
      val (background, accent) = PrayerWidgetProvider.resolvedColors(context)
      WidgetCard.paint(views, background)

      val tier = tierFor(heightDp)
      applyTypeScale(views, tier)

      val r = reading(context)
      if (r == null) {
        views.setViewVisibility(R.id.widget_content, View.GONE)
        views.setViewVisibility(R.id.widget_placeholder, View.VISIBLE)
        views.setTextViewText(
          R.id.widget_placeholder,
          context.getString(R.string.widget_placeholder_open_app),
        )
        // Nothing on the card is a position, so there is nothing to
        // recite from.
        views.setViewVisibility(R.id.reading_play, View.GONE)
        views.setOnClickPendingIntent(R.id.widget_root, openQuranIntent(context))
        return views
      }

      views.setViewVisibility(R.id.widget_placeholder, View.GONE)
      views.setViewVisibility(R.id.widget_content, View.VISIBLE)

      // Never opened the Quran. This widget's whole job is getting someone
      // back into the habit, and it used to be a dead card saying "Open
      // Mihrab" for exactly the person who has not started one. An invitation
      // costs the same space and asks for the tap the widget wants anyway.
      if (!r.optBoolean("started", true)) {
        val downloaded = r.optBoolean("downloaded", false)
        views.setTextViewText(
          R.id.reading_header,
          context.getString(R.string.widget_reading_header_start),
        )
        views.setTextViewText(
          R.id.reading_surah,
          context.getString(R.string.widget_reading_start_title),
        )
        // Two different people. One has the mushaf on disk and is a tap away
        // from a page; the other has nothing downloaded and is a tap away
        // from the translation, which needs no download and always works.
        // Promising the mushaf to the second is how a widget sends someone
        // to a download wall.
        views.setTextViewText(
          R.id.reading_position,
          context.getString(
            if (downloaded) R.string.widget_reading_start_note
            else R.string.widget_reading_start_note_undownloaded,
          ),
        )
        // The invitation is three short lines in a card built for six, so
        // the tail carries the one fact that makes it concrete rather than
        // leaving the bottom half of the widget empty — at the sizes that
        // have a bottom half. At one row it is the line to lose.
        views.setViewVisibility(
          R.id.reading_tail,
          if (tier == Tier.COMPACT) View.GONE else View.VISIBLE,
        )
        views.setTextViewText(
          R.id.reading_tail,
          context.getString(R.string.widget_reading_start_tail),
        )
        views.setViewVisibility(R.id.reading_progress, View.GONE)
        views.setViewVisibility(R.id.reading_progress_label, View.GONE)
        views.setViewVisibility(R.id.reading_side, View.VISIBLE)
        views.setTextViewText(
          R.id.reading_side_title,
          context.getString(R.string.widget_reading_start_side_title),
        )
        views.setTextViewText(R.id.reading_side_value, "604")
        views.setTextViewText(
          R.id.reading_side_note,
          context.getString(R.string.widget_reading_start_side_note),
        )
        views.setViewVisibility(
          R.id.reading_side_note,
          if (tier == Tier.COMPACT) View.GONE else View.VISIBLE,
        )
        // "Continue from where you left off" is not on offer to someone
        // who has not left off anywhere. A play button here would recite
        // Al-Fatiha at a reader who asked for nothing.
        views.setViewVisibility(R.id.reading_play, View.GONE)
        views.setOnClickPendingIntent(R.id.widget_root, openQuranIntent(context))
        return views
      }
      views.setViewVisibility(R.id.reading_side, View.VISIBLE)
      // At one row there is height for the header and one line under it, and
      // the progress bar belongs to the taller sizes. Hiding it is not a
      // loss: the page number above says the same thing, and a 4dp bar
      // squeezed against a card edge says it worse.
      val tall = tier != Tier.COMPACT && (heightDp <= 0 || heightDp >= PROGRESS_MIN_HEIGHT_DP)
      views.setViewVisibility(R.id.reading_progress, if (tall) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.reading_progress_label, if (tall) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.reading_tail, if (tall) View.VISIBLE else View.GONE)
      // The side column's third line is the first thing to go: "3 pages
      // left" repeats what the counter above it already showed, and it was
      // the line being cut off at the default size.
      views.setViewVisibility(
        R.id.reading_side_note,
        if (tier == Tier.COMPACT) View.GONE else View.VISIBLE,
      )

      val khatmah = r.optJSONObject("khatmah")
      views.setTextViewText(
        R.id.reading_header,
        if (khatmah != null) {
          context.getString(
            R.string.widget_reading_khatmah_day,
            khatmah.optInt("day", 1),
            khatmah.optInt("targetDays", 30),
          )
        } else {
          context.getString(R.string.widget_reading_continue)
        },
      )
      views.setTextViewText(R.id.reading_surah, r.optString("surahName"))
      views.setTextViewText(
        R.id.reading_position,
        context.getString(R.string.widget_reading_position, r.optInt("page", 1), r.optInt("juz", 1)),
      )

      val pagesRead = r.optInt("pagesRead", 0)
      val totalPages = r.optInt("totalPages", 604).coerceAtLeast(1)
      val pct = Math.round(pagesRead * 100.0 / totalPages).toInt()
      // A floor of 1%, for the same reason the iOS bar has one: two pages of
      // 604 is 0.3% and draws as nothing, and a bar with nothing in it says
      // "you have not started" to someone who has.
      views.setProgressBar(
        R.id.reading_progress,
        100,
        if (pagesRead > 0) pct.coerceAtLeast(1) else 0,
        false,
      )
      views.setTextViewText(
        R.id.reading_progress_label,
        context.getString(R.string.widget_reading_progress, pagesRead, totalPages, pct),
      )

      if (khatmah != null) {
        views.setTextViewText(
          R.id.reading_side_title,
          context.getString(R.string.widget_reading_today_portion),
        )
        views.setTextViewText(
          R.id.reading_side_value,
          context.getString(
            R.string.widget_reading_portion_value,
            khatmah.optInt("doneToday", 0),
            khatmah.optInt("pagesToday", 0),
          ),
        )
        val behind = khatmah.optInt("behindBy", 0)
        val left = (khatmah.optInt("pagesToday", 0) - khatmah.optInt("doneToday", 0)).coerceAtLeast(0)
        views.setTextViewText(
          R.id.reading_side_note,
          when {
            behind > 0 ->
              context.resources.getQuantityString(R.plurals.widget_reading_behind, behind, behind)
            left == 0 -> context.getString(R.string.widget_reading_done_today)
            else ->
              context.resources.getQuantityString(R.plurals.widget_reading_left, left, left)
          },
        )
        views.setTextColor(
          R.id.reading_side_note,
          if (behind > 0) android.graphics.Color.parseColor("#F87171") else accent,
        )
        // With a plan the side column has taken "today", so the last-read
        // line has nowhere else to be — and the column is taller than its
        // content without it.
        val tail = lastReadTail(context, r)
        // `tall` still decides. This branch used to set the tail visible on
        // its own, which put a line back onto a card that had just decided
        // it had no room for one.
        if (tail != null && tall) {
          views.setViewVisibility(R.id.reading_tail, View.VISIBLE)
          views.setTextViewText(R.id.reading_tail, tail)
        } else {
          views.setViewVisibility(R.id.reading_tail, View.GONE)
        }
      } else {
        // Without a plan the tail is the one line left to fill a tall card,
        // and at three rows and up there is a lot of card to fill: the left
        // column is a header, a name and a page, and the rest was air.
        val tail = if (tier == Tier.GENEROUS) lastReadTail(context, r) else null
        if (tail != null) {
          views.setViewVisibility(R.id.reading_tail, View.VISIBLE)
          views.setTextViewText(R.id.reading_tail, tail)
        } else {
          views.setViewVisibility(R.id.reading_tail, View.GONE)
        }
        views.setTextViewText(
          R.id.reading_side_title,
          context.getString(R.string.widget_reading_last_read),
        )
        views.setTextViewText(
          R.id.reading_side_value,
          lastReadPhrase(context, r) ?: "—",
        )
        val bookmarks = r.optInt("bookmarks", 0)
        views.setTextViewText(
          R.id.reading_side_note,
          if (bookmarks > 0) {
            context.resources.getQuantityString(
              R.plurals.widget_reading_bookmarks, bookmarks, bookmarks,
            )
          } else {
            ""
          },
        )
        views.setTextColor(R.id.reading_side_note, android.graphics.Color.parseColor("#9AA0A6"))
      }

      // At 2x2 the side column is the first thing to go: a surah name and a
      // portion counter side by side in half the width leaves neither
      // readable, and the left column alone still answers the question the
      // widget exists for — where was I. The plan lists both sizes; this is
      // what makes the small one honest rather than cramped.
      if (widthDp in 1 until SIDE_COLUMN_MIN_WIDTH_DP) {
        views.setViewVisibility(R.id.reading_side, View.GONE)
      } else {
        views.setViewVisibility(R.id.reading_side, View.VISIBLE)
      }

      views.setOnClickPendingIntent(R.id.widget_root, readingIntent(context, r))

      // The one control on this card. Tinted with the same accent the rest
      // of the widget answers to, so it belongs to the card rather than
      // sitting on it.
      views.setViewVisibility(R.id.reading_play, View.VISIBLE)
      views.setInt(R.id.reading_play, "setColorFilter", accent)
      views.setContentDescription(
        R.id.reading_play,
        context.getString(R.string.widget_reading_play),
      )
      views.setOnClickPendingIntent(R.id.reading_play, playIntent(context, r))
      return views
    }

    /** "Last read today · 3 bookmarks", dropping whichever half is unknown. */
    private fun lastReadTail(context: Context, r: JSONObject): String? {
      val parts = mutableListOf<String>()
      lastReadPhrase(context, r)?.let {
        parts.add(context.getString(R.string.widget_reading_last_read_prefix, it.lowercase()))
      }
      val bookmarks = r.optInt("bookmarks", 0)
      if (bookmarks > 0) {
        parts.add(
          context.resources.getQuantityString(
            R.plurals.widget_reading_bookmarks, bookmarks, bookmarks,
          ),
        )
      }
      return if (parts.isEmpty()) null else parts.joinToString(" · ")
    }

    /** "Today" / "Yesterday" / "4 days ago". Never "0 days ago". */
    private fun lastReadPhrase(context: Context, r: JSONObject): String? {
      val ms = r.optDouble("lastReadAt", 0.0)
      if (ms <= 0) return null
      val days = ((System.currentTimeMillis() - ms) / 86_400_000L).toInt()
      return when {
        days < 1 -> context.getString(R.string.widget_reading_today)
        days == 1 -> context.getString(R.string.widget_reading_yesterday)
        else -> context.resources.getQuantityString(R.plurals.widget_reading_days_ago, days, days)
      }
    }

    /**
     * mihrab://read/2?initialPage=3 or ?scrollToAyah=1 — the surah screen
     * picks its reader from which of the two it is given, which is why the
     * app resolves `mode` rather than this side guessing.
     */
    private fun readingIntent(context: Context, r: JSONObject): PendingIntent {
      val surah = r.optInt("surah", 1)
      val position = if (r.optString("mode") == "mushaf") {
        "initialPage=${r.optInt("page", 1)}"
      } else {
        "scrollToAyah=${r.optInt("ayah", 1)}"
      }
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mihrab://read/$surah?$position")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3200,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /**
     * The same destination, arriving out loud — issue #25.
     *
     * `playFromAyah` rides ALONGSIDE the position above rather than
     * replacing it: the muṣḥaf still has to open on its page and the
     * translation reader on its ayah, and recitation begins at an ayah
     * either way. So the ayah is sent every time, whichever reader the
     * app resolved, and the reader that does not need it ignores it.
     *
     * Its own request code. Two PendingIntents that differ only in their
     * data are already distinct to the system, but a shared code makes
     * that a fact about the URI rather than about the intent, and the
     * next person to edit one of these URIs should not have to know
     * that.
     */
    private fun playIntent(context: Context, r: JSONObject): PendingIntent {
      val surah = r.optInt("surah", 1)
      val ayah = r.optInt("ayah", 1)
      val position = if (r.optString("mode") == "mushaf") {
        "initialPage=${r.optInt("page", 1)}"
      } else {
        "scrollToAyah=$ayah"
      }
      val intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("mihrab://read/$surah?$position&playFromAyah=$ayah"),
      ).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3202,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun openQuranIntent(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mihrab://quran")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        3201,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
