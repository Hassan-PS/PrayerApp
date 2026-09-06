package com.prayer_times

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.time.Instant

/**
 * Mihrab Live Activity — JS bridge for the Android Live Activity.
 *
 * Architecture (v2.3.0+, single-notification):
 *
 *   JS toggles ON  →  MihrabLiveActivityModule.display(payload)
 *                  →  ContextCompat.startForegroundService(payload)
 *                  →  MihrabLiveActivityService takes over:
 *                       startForeground(NOTIF_ID, buildNotificationFromPayload())
 *                       — the rich notification IS the FGS notification.
 *                         One notification keeps the process alive AND
 *                         shows the prayer countdown. No hidden placeholder.
 *
 *   JS toggles OFF →  MihrabLiveActivityModule.cancel()
 *                  →  context.stopService(...)
 *                  →  service.onDestroy() cancels the ticker and the notification.
 *
 * Note: the single-notification approach means FLAG_FOREGROUND_SERVICE is
 *   added to NOTIF_ID by NMS, which prevents FLAG_PROMOTED_ONGOING and
 *   therefore the Android 16 status-bar chip. The cleaner single-notification
 *   UX (no "silent" placeholder visible in settings) is the correct trade-off.
 *
 * The notification builder lives in the companion object so the
 * service can build the notification on its own ticker, without going
 * back through the React module instance.
 *
 * Why foreground service: a plain `notify()` notification (a) lands in
 * the "Silent" section on most ROMs, (b) never auto-updates so the
 * progress bar stays frozen until JS reposts, and (c) is not eligible
 * for Android 16's status-bar Live Update chip. Foreground service
 * notifications fix all three.
 */
class MihrabLiveActivityModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  // ── Public API ────────────────────────────────────────────────────

  @ReactMethod
  fun display(payloadJson: String, promise: Promise) {
    try {
      val p = JSONObject(payloadJson)
      Log.i(
        NAME,
        "display: nextLabel=${p.optString("nextLabel")} epochMs=${p.optLong("nextEpochMs")} prevEpochMs=${p.optLong("prevEpochMs")}"
      )
      // Make sure the channel exists before the FGS posts. JS also
      // creates it via notifee on app boot, but on first install the
      // FGS may try to post before notifee has run.
      ensureChannelExists(reactContext)
      ensureFgsChannelExists(reactContext)
      // Persist before starting the service so the restart receiver can
      // revive the Live Activity after an app update or device reboot.
      savePayload(reactContext, payloadJson)
      val intent = Intent(reactContext, MihrabLiveActivityService::class.java).apply {
        putExtra(MihrabLiveActivityService.EXTRA_PAYLOAD, payloadJson)
      }
      try {
        ContextCompat.startForegroundService(reactContext, intent)
        Log.i(NAME, "display: foreground service started")
        promise.resolve(null)
      } catch (se: SecurityException) {
        Log.w(NAME, "display: foreground service start denied", se)
        promise.reject("PERM_DENIED", "Foreground service start denied", se)
      } catch (ise: IllegalStateException) {
        // Android 12+ throws when starting a foreground service from
        // the background outside an allowlisted path. Fall back to a
        // plain notify() so the user still sees something — progress
        // bar won't tick in this fallback path, but at least the
        // notification appears.
        Log.w(NAME, "display: FGS blocked from background; falling back to notify()", ise)
        runCatching {
          val notif = buildNotificationFromPayload(reactContext, p)
          NotificationManagerCompat.from(reactContext).notify(NOTIF_ID, notif)
        }
        promise.resolve(null)
      }
    } catch (e: Throwable) {
      Log.e(NAME, "display: failed", e)
      promise.reject("DISPLAY_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    try {
      // Clear persisted payload so the restart receiver doesn't revive
      // the Live Activity after an update / reboot when the user has
      // explicitly turned it off.
      clearPayload(reactContext)
      val intent = Intent(reactContext, MihrabLiveActivityService::class.java)
      reactContext.stopService(intent)
      // Also cancel both notifications in case the service was never
      // started (background FGS-start was blocked and we fell back to
      // notify()) or the service already exited.
      runCatching {
        NotificationManagerCompat.from(reactContext).cancel(NOTIF_ID)
      }
      promise.resolve(null)
    } catch (e: Throwable) {
      promise.reject("CANCEL_FAILED", e.message, e)
    }
  }

  // ── Companion: notification building (static so the service can
  //    rebuild on each tick without going through the JS bridge) ────

  companion object {
    const val NAME = "MihrabLiveActivity"

    // SharedPreferences key/name used to persist the last payload across
    // process death (app update, device boot). The restart receiver reads
    // these to revive the Live Activity without requiring the app to open.
    const val PREFS_NAME = "mihrab_live_activity"
    const val PREF_KEY_PAYLOAD = "last_payload"
    const val PREF_KEY_ENABLED = "enabled"

    fun savePayload(context: android.content.Context, payloadJson: String) {
      context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_KEY_PAYLOAD, payloadJson)
        .putBoolean(PREF_KEY_ENABLED, true)
        .apply()
    }

    fun clearPayload(context: android.content.Context) {
      context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .remove(PREF_KEY_PAYLOAD)
        .putBoolean(PREF_KEY_ENABLED, false)
        .apply()
    }

    fun loadPayload(context: android.content.Context): String? {
      val prefs = context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
      if (!prefs.getBoolean(PREF_KEY_ENABLED, false)) return null
      return prefs.getString(PREF_KEY_PAYLOAD, null)
    }
    // v3 — bumped in beta.9 to IMPORTANCE_HIGH (sound + vibration off
    // explicitly) so the Android 16 status-bar chip can promote us.
    // Channel importance must match what JS creates in liveActivity.ts.
    const val CHANNEL_ID = "mihrab_live_activity_v3"
    const val NOTIF_ID = 0xA1B2

    // Foreground-service placeholder notification (beta.10+ dual-notification
    // architecture). This notification is posted via startForeground() to
    // keep the process alive; it uses a separate low-importance channel so
    // it stays silent and out of the way. The rich chip notification
    // (NOTIF_ID) is posted via regular notify() on this same channel.
    const val FGS_NOTIF_ID = 0xA1B3
    // v2 — IMPORTANCE_NONE so the placeholder never appears in the shade.
    const val FGS_CHANNEL_ID = "mihrab_fgs_v2"

    /** Ensure the channel exists with the right importance before any
     *  startForeground call. */
    @JvmStatic
    fun ensureChannelExists(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
        ?: return
      if (nm.getNotificationChannel(CHANNEL_ID) != null) return
      val ch = android.app.NotificationChannel(
        CHANNEL_ID,
        ctx.getString(R.string.live_activity_channel_name),
        android.app.NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = ctx.getString(R.string.live_activity_channel_desc)
        setSound(null, null) // silent — passive countdown only
        enableVibration(false)
        setShowBadge(false)
        // No heads-up popup — silently slots into the shade.
        // setBypassDnd intentionally NOT called so the chip respects DnD.
      }
      nm.createNotificationChannel(ch)
    }

    /** Ensure the hidden FGS placeholder channel exists.
     *  IMPORTANCE_NONE suppresses the placeholder completely from the
     *  notification shade. The rich chip notification on CHANNEL_ID
     *  (IMPORTANCE_HIGH) is the only user-visible notification. */
    @JvmStatic
    fun ensureFgsChannelExists(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
        ?: return
      if (nm.getNotificationChannel(FGS_CHANNEL_ID) != null) return
      val ch = android.app.NotificationChannel(
        FGS_CHANNEL_ID,
        ctx.getString(R.string.live_activity_fgs_channel_name),
        android.app.NotificationManager.IMPORTANCE_NONE,
      ).apply {
        description = ctx.getString(R.string.live_activity_fgs_channel_desc)
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      }
      nm.createNotificationChannel(ch)
    }

    /** Build the minimal FGS placeholder notification. Posted via
     *  startForeground() to satisfy Android's FGS requirement and keep
     *  the process alive. The IMPORTANCE_NONE channel suppresses it from
     *  the notification shade on Android 8+.
     *  @param fgsText Localised "Prayer countdown active" string passed
     *    from JS so it respects the app's language setting. Falls back to
     *    the Android string resource (device locale) if absent. */
    @JvmStatic
    fun buildFgsNotification(ctx: Context, fgsText: String? = null): Notification {
      val tap = Intent(ctx, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val pi = PendingIntent.getActivity(
        ctx, 1, tap,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val text = if (!fgsText.isNullOrEmpty()) fgsText
                 else ctx.getString(R.string.live_activity_countdown_active)
      return NotificationCompat.Builder(ctx, FGS_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_prayer)
        .setContentTitle(ctx.getString(R.string.app_name))
        .setContentText(text)
        .setContentIntent(pi)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setVisibility(NotificationCompat.VISIBILITY_SECRET)
        .build()
    }

    /**
     * Render a single-line text progress bar with the percentage on the
     * same line: "████████████░░░░░░░░  52%"
     *
     * Uses Unicode FULL BLOCK (U+2588) for filled and LIGHT SHADE (U+2591)
     * for empty. 20 cells wide — readable at notification text size on any
     * screen density. Works on every Android shell including GrapheneOS
     * because it is plain text in setContentText, not a RemoteView.
     */
    /**
     * Format a millisecond delta as "1h 23m" or "45m".
     * Used in the notification subText alongside the percentage so the
     * countdown and percentage are in the same right-anchored row.
     */
    /** Join non-empty parts with a middle dot for the header subtext. */
    private fun joinDot(vararg parts: String): String =
      parts.filter { it.isNotEmpty() }.joinToString(" · ")

    private fun formatRemaining(deltaMs: Long): String {
      val totalSec = (deltaMs / 1000).coerceAtLeast(0)
      val h = totalSec / 3600
      val m = (totalSec % 3600) / 60
      return if (h > 0) "${h}h ${m}m" else "${m}m"
    }

    /** Live ticking countdown with seconds: "3:07:05" (≥1h) or "7:05" (<1h). */
    private fun formatHMS(deltaMs: Long): String {
      val totalSec = (deltaMs / 1000).coerceAtLeast(0)
      val h = totalSec / 3600
      val m = (totalSec % 3600) / 60
      val s = totalSec % 60
      return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
             else String.format("%d:%02d", m, s)
    }

    /** Top-level entry point — used by both the JS bridge (as a
     *  fallback when foreground-service start is denied) and by the
     *  MihrabLiveActivityService on its periodic ticker.
     *  Returns a Pair of (richNotification, fgsText) so callers can
     *  rebuild the FGS placeholder with the same localized string. */
    @JvmStatic
    fun buildNotificationFromPayload(ctx: Context, p: JSONObject): Notification {
      val nextLabel = p.optString("nextLabel", "")
      val nextEpochMs = p.optLong("nextEpochMs", 0L)
      val prevEpochMs = p.optLong("prevEpochMs", 0L)
      // When system colours are on, follow the LIVE Material You accent,
      // resolved fresh on every (re)post — so the tint matches the app and
      // auto-updates when the wallpaper colour changes, without reopening the
      // app. Otherwise use the app's chosen brand accent from the payload.
      val accentInt = if (p.optBoolean("systemAccent", false)) {
        resolveSystemAccent(ctx)
      } else {
        parseColor(p.optString("accentHex", "#22C55E"), Color.parseColor("#22C55E"))
      }
      val progressPct = computeProgressPercent(prevEpochMs, nextEpochMs)
      // JS sends title as the combined "Asr · 17:08" string; falls back to
      // just the label if the title field is absent.
      val title = p.optString("title", nextLabel)

      val tap = Intent(ctx, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      val pi = PendingIntent.getActivity(
        ctx, 0, tap,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )

      return when {
        Build.VERSION.SDK_INT >= 37 -> {
          // Android 17+ path: full Live Update feature set — direct (non-
          // reflective) promotion APIs, ProgressStyle with per-prayer points +
          // tracker icon (timeline design) OR MetricStyle with a system-ticking
          // TimeDifference countdown (countdown design), plus Semantic Color for
          // the imminent (<5 min) state. Falls back to buildAndroid16 on error.
          buildAndroid17(ctx, p, nextEpochMs, accentInt, progressPct, title, pi)
        }
        Build.VERSION.SDK_INT >= 36 -> {
          // Android 16 path (UNCHANGED): native Notification.ProgressStyle day
          // timeline + reflective chip APIs. Kept exactly as-is for Android 16
          // users. Falls back to the plain progress bar inside buildAndroid16.
          buildAndroid16(ctx, p, nextEpochMs, accentInt, progressPct, title, pi)
        }
        else -> {
          // Pre-36 path: custom RemoteViews layout. No chip on these versions.
          val contentView = buildContentView(ctx, title, nextEpochMs, progressPct)
          buildLegacy(ctx, nextEpochMs, accentInt, progressPct, title, pi, contentView)
        }
      }
    }

    /** Extract the localised FGS placeholder text from a payload JSON.
     *  Called by MihrabLiveActivityService so the FGS notification text
     *  matches the app's selected language (set by JS via i18n). */
    @JvmStatic
    fun fgsTextFromPayload(p: JSONObject): String? =
      p.optString("fgsText", "").takeIf { it.isNotEmpty() }

    // ── Custom RemoteViews content layout ───────────────────────────

    /**
     * Build the custom notification content view:
     *
     *   [Asr · 17:08          ↓ 1h 23m  |  52%]
     *   [████████████░░░░░░░░░░░░░░░░░░░░░░░░░]
     *
     * Prayer title is left-weighted (layout_weight=1); countdown+percentage
     * is right-pinned. Used with DecoratedCustomViewStyle so the standard
     * header chrome (app icon, app name) is still rendered by the system.
     *
     * Returns null on any error so callers fall back to the standard template.
     * On hardened shells that strip custom RemoteViews (GrapheneOS, some MIUI
     * builds), the standard setContentTitle/setContentText fields are shown.
     */
    /** Build a RemoteViews for the collapsed notification content area.
     *  [rightText] overrides the default full countdown+percentage string —
     *  pass just "$progressPct%" for Android 16 (countdown lives in subText),
     *  or null for the full "↓ time | pct%" used by the pre-36 legacy path. */
    private fun buildContentView(
      ctx: Context,
      title: String,
      nextEpochMs: Long,
      progressPct: Int,
      rightText: String? = null,
    ): RemoteViews? = try {
      val rv = RemoteViews(ctx.packageName, R.layout.notification_live_activity)
      rv.setTextViewText(R.id.la_prayer_title, title)
      rv.setTextViewText(
        R.id.la_countdown_pct,
        rightText ?: "↓ ${formatRemaining(nextEpochMs - System.currentTimeMillis())}  |  $progressPct%",
      )
      rv.setProgressBar(R.id.la_progress, 100, progressPct, false)
      rv
    } catch (t: Throwable) {
      Log.w(NAME, "buildContentView failed, using standard template", t)
      null
    }

    // ── Android 16+ path ────────────────────────────────────────────

    @SuppressLint("NewApi")
    private fun buildAndroid16(
      ctx: Context,
      p: JSONObject,
      nextEpochMs: Long,
      accentInt: Int,
      progressPct: Int,
      title: String,
      contentIntent: PendingIntent,
    ): Notification {
      try {
        val now = System.currentTimeMillis()
        // When the screen is interactive the service ticks every second and
        // sets withSeconds=true → live H:MM:SS; on AOD/screen-off it ticks each
        // minute with withSeconds=false → H:MM (no seconds, lower power).
        val withSeconds = p.optBoolean("withSeconds", false)
        val remaining = nextEpochMs - now
        val countdown = if (withSeconds) formatHMS(remaining) else formatRemaining(remaining)
        val shortText = if (withSeconds) formatHMS(remaining) else formatRemainingShort(remaining)
        val nextLabel = p.optString("nextLabel", "")
        // THE PRAYER'S NAME, AND NOT A SECOND COUNTDOWN.
        //
        // This used to be the name with the countdown interpolated after it,
        // and every one of these cards also runs `setUsesChronometer(true)` with
        // `setChronometerCountDown(true)`, which is the platform drawing the
        // same countdown in the header slot, to the second, for free. So the
        // card carried two countdowns to one prayer: a live H:MM:SS ticking
        // in the corner and a stale minute-resolution copy of it in the
        // title, which only moved when the service re-posted. They disagreed
        // for most of every minute.
        //
        // The chronometer is the better of the two — it has the seconds, it
        // costs no re-posts, and it is what the system keeps ticking on the
        // always-on display — so it is the countdown now, and the title is
        // the one thing it cannot say: which prayer this is counting to.
        val inlineTitle = if (nextLabel.isNotEmpty()) nextLabel else title

        // Two designs, both NOT colorized (a colorized notification is not
        // eligible for the status-bar chip) and both keeping the chip + AOD:
        //   'timeline'  — full ProgressStyle prayer-day timeline + inline title.
        //   'countdown' — countdown-focused: big countdown title + prayer/time.
        val design = p.optString("design", "timeline")
        val nextTime = p.optString("nextTime", "")
        // What the card DRAWS. `nextTime` stays canonical 24-hour `HH:mm`
        // because `buildMetricStyle` parses it into a `LocalTime` for the
        // Android 17 "At <time>" metric, which the system then formats
        // itself. Empty on payloads from app builds before issue #18.
        val nextTimeText =
          p.optString("nextTimeDisplay", "").ifEmpty { nextTime }

        val builder = Notification.Builder(ctx, CHANNEL_ID)
          .setSmallIcon(R.drawable.ic_stat_prayer)
          .setColor(accentInt)
          .setColorized(false)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setLocalOnly(false)
          .setCategory(Notification.CATEGORY_NAVIGATION)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          // The seconds, drawn by the platform rather than by us.
          //
          // A chronometer counting down to `nextEpochMs` advances on its own,
          // in the header slot, with no app involvement at all. Before this,
          // `withSeconds` baked H:MM:SS into the title and the service had to
          // re-post the entire notification once a second to move it — 3600
          // rebuilds an hour for as long as the screen was on. The text this
          // builder produces is now minute-resolution and the chronometer
          // carries the seconds, so a post a minute is enough.
          //
          // `setShowWhen(true)` is required with it: without it the header
          // slot is not drawn and the chronometer has nowhere to render.
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
          .setWhen(nextEpochMs)
          .setShowWhen(true)
          .setContentIntent(contentIntent)

        if (design == "countdown") {
          // The live countdown is the prominent title (the largest text the
          // standard template renders — keeping it a standard base template,
          // not custom RemoteViews, is what preserves the Android 16
          // promoted-ongoing chip + always-on display; a custom view of any
          // kind disqualifies the chip, as does a title size span being
          // stripped). The next prayer's name + clock time sit beneath it.
          builder.setContentTitle(countdown)
          val sub = when {
            nextLabel.isNotEmpty() && nextTimeText.isNotEmpty() ->
              "$nextLabel · $nextTimeText"
            nextLabel.isNotEmpty() -> nextLabel
            else -> title
          }
          builder.setContentText(sub)
          // Simple linear progress toward the next prayer (no day timeline).
          builder.setProgress(100, progressPct, false)
        } else {
          // timeline (default) or markers: inline countdown in the title + the
          // bar over the next three events. 'markers' additionally draws a
          // point at each of them and a tracker icon at "now" — all native
          // ProgressStyle APIs (Android 16), so the chip + AOD eligibility is
          // identical.
          val dayStyle = buildNextEventsProgressStyle(
            p, accentInt,
            addPoints = design == "markers",
            trackerIcon = if (design == "markers") {
              Icon.createWithResource(ctx, R.drawable.ic_stat_prayer)
            } else null,
          )
          builder.setContentTitle(
            if (dayStyle != null) inlineTitle else "$inlineTitle · $progressPct%",
          )
          // Actual prayer time shown small/grey in the header (next to app name).
          if (nextTimeText.isNotEmpty()) builder.setSubText(nextTimeText)
          if (dayStyle != null) {
            builder.setStyle(dayStyle)
          } else {
            builder.setProgress(100, progressPct, false)
          }
        }

        tryAttachShortCriticalText(builder, shortText)
        tryRequestPromotedOngoing(builder)

        return builder.build()
      } catch (t: Throwable) {
        Log.w(NAME, "Android 16 path failed, falling back to legacy", t)
        return buildLegacy(ctx, nextEpochMs, accentInt, progressPct, title, contentIntent, null)
      }
    }

    // ── Android 17+ path ────────────────────────────────────────────
    //
    // Uses the real Live Update APIs directly (compileSdk 37): no reflection
    // for promotion, a richer ProgressStyle (per-prayer points + tracker icon),
    // an alternative MetricStyle countdown that the system ticks on its own
    // (Notification.Metric.TimeDifference), and the new Semantic Color API to
    // flag an imminent prayer. Both designs stay chip- and AOD-eligible:
    // ProgressStyle/MetricStyle are first-class promotable templates, we never
    // colorize or attach custom RemoteViews, and the channel is IMPORTANCE_HIGH.

    @SuppressLint("NewApi")
    private fun buildAndroid17(
      ctx: Context,
      p: JSONObject,
      nextEpochMs: Long,
      accentInt: Int,
      progressPct: Int,
      title: String,
      contentIntent: PendingIntent,
    ): Notification {
      try {
        val now = System.currentTimeMillis()
        val remaining = nextEpochMs - now
        val withSeconds = p.optBoolean("withSeconds", false)
        val countdown = if (withSeconds) formatHMS(remaining) else formatRemaining(remaining)
        val shortText = if (withSeconds) formatHMS(remaining) else formatRemainingShort(remaining)
        val nextLabel = p.optString("nextLabel", "")
        val nextTime = p.optString("nextTime", "")
        // See the note in the other builder: `nextTime` is parsed, this is drawn.
        val nextTimeText =
          p.optString("nextTimeDisplay", "").ifEmpty { nextTime }
        val design = p.optString("design", "timeline")
        val prevEpochMs = p.optLong("prevEpochMs", 0L)
        // "It's <prayer> time" — brief SAFE (green) state for ~90s right after a
        // prayer instant. The just-passed prayer's localised name is looked up
        // from the day rows by its epoch.
        val sinceArrival = if (prevEpochMs > 0L) now - prevEpochMs else Long.MAX_VALUE
        val justArrived = sinceArrival in 0 until 90_000L
        val arrivedLabel = if (justArrived) labelForEpoch(p, prevEpochMs) else ""
        val nowWord = p.optString("nowWord", "Now")
        val nextKey = p.optString("nextKey", "")
        // "time" by default, not "off". This was a user setting with a
        // "None" choice; it is not one any more — the next prayer's clock
        // time is the one fact a falling countdown does not carry, so it is
        // always beside it. Defaulting here rather than only in the payload
        // means a card rebuilt from a stored payload written by an older
        // build gets it too, without a migration.
        val secondMetric = p.optString("secondMetric", "time")
        // Hijri date shown next to the next prayer (in the header subtext).
        val hijri = if (p.optBoolean("showHijri", false)) p.optString("hijriLabel", "") else ""
        // On arrival, flag SAFE green regardless of the brand/Material accent.
        val effectiveAccent = if (justArrived) Color.parseColor("#22C55E") else accentInt

        val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // What the upcoming event is set to, and whether that answer came
        // from the standing per-prayer setting or from a tap on this card.
        // The two look different on the button on purpose — see the label
        // built with the action below.
        val alertMode = LiveActivityAlertModes.effectiveMode(prefs, p, nextEpochMs, nextKey)
        val alertOverridden =
          LiveActivityAlertModes.overrideFor(prefs, nextEpochMs, nextKey) != null
        // User-toggled: when hidden, keep the card in the shade but drop it off
        // the lock screen / always-on display (VISIBILITY_SECRET) and skip the
        // status-bar chip promotion below. Independent of the master on/off.
        val aodHidden = prefs.getBoolean(MihrabLiveActivityActionReceiver.KEY_AOD_HIDDEN, false)

        val builder = Notification.Builder(ctx, CHANNEL_ID)
          .setSmallIcon(R.drawable.ic_stat_prayer)
          .setColor(effectiveAccent)
          .setColorized(false)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setLocalOnly(false)
          .setCategory(Notification.CATEGORY_NAVIGATION)
          .setVisibility(
            if (aodHidden) Notification.VISIBILITY_SECRET
            else Notification.VISIBILITY_PUBLIC,
          )
          .setShowWhen(false)
          .setContentIntent(contentIntent)

        val name = if (nextLabel.isNotEmpty()) nextLabel else title
        val arrivedTitle =
          if (justArrived && arrivedLabel.isNotEmpty()) "$arrivedLabel · $nowWord"
          else null
        // Whether the PLATFORM is already animating the countdown for this
        // card. MetricStyle's TimeDifference is system-ticked, so a
        // chronometer on top of it would show the same number twice. Every
        // other branch bakes a minute-resolution string and wants the
        // chronometer to carry the seconds — see the attach below.
        var systemTicked = false
        if (design == "countdown") {
          // MetricStyle (Android 17) for BOTH screen-on and AOD, so the card
          // looks identical in both states. Built via REFLECTION so the same
          // source compiles against compileSdk 36 (the F-Droid build); there it
          // returns null and we fall back to the standard big-countdown. The
          // TimeDifference value is system-ticked (H:MM:SS, the system handles
          // the AOD cadence) and the critical metric drives the status-bar chip.
          val inWord = p.optString("inWord", "In")
          val atWord = p.optString("atWord", "At")
          val ms = tryBuildCountdownMetricStyle(
            nextEpochMs, inWord, secondMetric, nextTime, atWord,
          )
          if (ms != null) {
            val (style, hasSecond) = ms
            if (hasSecond) {
              // [At · 17:35 | In · 3:13:09]; subtext carries the Hijri.
              builder.setContentTitle(arrivedTitle ?: name)
              if (hijri.isNotEmpty()) builder.setSubText(hijri)
            } else {
              // Single big countdown: name + Hijri on the title line, time below.
              builder.setContentTitle(arrivedTitle ?: joinDot(name, hijri))
              if (nextTimeText.isNotEmpty()) builder.setSubText(nextTimeText)
            }
            builder.setStyle(style)
            systemTicked = true
          } else {
            builder.setContentTitle(arrivedTitle ?: "$name · $countdown")
            val sub = joinDot(nextTimeText, hijri)
            if (sub.isNotEmpty()) builder.setSubText(sub)
            builder.setProgress(100, progressPct, false)
            tryAttachShortCriticalText(builder, shortText)
          }
        } else {
          // timeline (default) or markers: the segmented ProgressStyle bar
          // over the next three events (all Android 16 APIs, so this compiles
          // on compileSdk 36 too). 'markers' adds a point at each of them
          // plus a tracker icon at "now".
          val dayStyle = buildNextEventsProgressStyle(
            p, effectiveAccent,
            addPoints = design == "markers",
            trackerIcon = if (design == "markers") {
              Icon.createWithResource(ctx, R.drawable.ic_stat_prayer)
            } else null,
          )
          // The prayer's name alone — the chronometer below carries the
          // countdown, to the second and without a re-post. See the same
          // note on `inlineTitle` in the Android 16 builder above: two
          // countdowns to one prayer, one of them a minute-resolution copy
          // that disagreed with the other for most of every minute.
          val inlineTitle = when {
            arrivedTitle != null -> arrivedTitle
            nextLabel.isNotEmpty() -> nextLabel
            else -> title
          }
          if (dayStyle != null) {
            builder.setContentTitle(inlineTitle)
            val sub = joinDot(nextTimeText, hijri)
            if (sub.isNotEmpty()) builder.setSubText(sub)
            builder.setStyle(dayStyle)
          } else {
            builder.setContentTitle("$inlineTitle · $progressPct%")
            builder.setProgress(100, progressPct, false)
          }
          tryAttachShortCriticalText(builder, shortText)
        }

        // The seconds, drawn by the platform. Same reasoning as the Android 16
        // path: a chronometer counting down to `nextEpochMs` advances on its
        // own, so the service posts once a minute instead of once a second.
        // Skipped when MetricStyle already ticks the countdown itself.
        if (!systemTicked) {
          builder
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(nextEpochMs)
            .setShowWhen(true)
        }

        // The alert-mode action — the same control as the home row, for one
        // occurrence. One tap cycles the upcoming event through the modes
        // its row allows: three for a prayer, two for Sunrise and the night
        // marks, which have no adhan to offer.
        //
        // THE LABEL IS THE STATE, NOT THE VERB. It reads "Adhan", "Alert" or
        // "Silent" — the three words printed under the glyph on the home row
        // — because the first thing this button has to do is answer a
        // question the reader already has: what is going to happen at Fajr?
        // The button it replaced could not answer that. It said "Mute next
        // adhan" over a prayer somebody had already set to the plain alert.
        //
        // The "· once" marker appears only while an override is actually
        // live. With none, the button is reporting the standing setting and
        // marking that temporary would be the same lie in reverse.
        //
        // Independent of the rest so a failure can't break the card.
        if (p.optBoolean("alertActionEnabled", false) && nextKey.isNotEmpty()) {
          runCatching {
            val stateWord = when (alertMode) {
              LiveActivityAlertModes.ADHAN -> p.optString("alertLabelAdhan", "Adhan")
              LiveActivityAlertModes.SILENT -> p.optString("alertLabelSilent", "Silent")
              else -> p.optString("alertLabelNotification", "Alert")
            }
            val actionLabel =
              if (alertOverridden) joinDot(stateWord, p.optString("alertOnceWord", "once"))
              else stateWord
            // Epoch and key only. The receiver reads the current mode back
            // from the same two sources this builder did, so a PendingIntent
            // the system kept from an earlier post cannot apply a mode that
            // has since moved on.
            val cycleIntent = Intent(ctx, MihrabLiveActivityActionReceiver::class.java).apply {
              action = MihrabLiveActivityActionReceiver.ACTION_TOGGLE_MUTE_NEXT
              putExtra(MihrabLiveActivityActionReceiver.EXTRA_EPOCH, nextEpochMs)
              putExtra(MihrabLiveActivityActionReceiver.EXTRA_NAME, nextKey)
            }
            val cyclePi = PendingIntent.getBroadcast(
              ctx, 0x4D55, cycleIntent,
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val actIcon = Icon.createWithResource(ctx, R.drawable.ic_stat_prayer)
            builder.addAction(
              Notification.Action.Builder(actIcon, actionLabel, cyclePi).build(),
            )
          }
        }

        // Second action: hide/show the card on the lock screen / AOD. Native-
        // only toggle — the notification stays in the shade; only its
        // lock-screen visibility (and the chip) flips. Independent of the
        // master on/off setting and of the mute action above.
        if (p.optBoolean("aodActionEnabled", false)) {
          runCatching {
            val aodLabel =
              if (aodHidden) p.optString("aodShowLabel", "Show on lock screen")
              else p.optString("aodHideLabel", "Hide on lock screen")
            val aodIntent = Intent(ctx, MihrabLiveActivityActionReceiver::class.java).apply {
              action = MihrabLiveActivityActionReceiver.ACTION_TOGGLE_AOD
            }
            val aodPi = PendingIntent.getBroadcast(
              ctx, 0x414F, aodIntent,
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val aodIcon = Icon.createWithResource(ctx, R.drawable.ic_stat_prayer)
            builder.addAction(
              Notification.Action.Builder(aodIcon, aodLabel, aodPi).build(),
            )
          }
        }

        // Promotion to the status-bar chip / AOD. Reflective (tryRequest…) so
        // this compiles against compileSdk 36 for the F-Droid build too. Skip it
        // when the user has hidden the card from the lock screen / AOD.
        if (!aodHidden) tryRequestPromotedOngoing(builder)
        return builder.build()
      } catch (t: Throwable) {
        Log.w(NAME, "Android 17 path failed, falling back to Android 16 path", t)
        return buildAndroid16(ctx, p, nextEpochMs, accentInt, progressPct, title, contentIntent)
      }
    }

    /** Localised name of the event whose instant is closest to [epochMs]
     *  (within 2 min), looked up from the payload's day rows. "" if none. */
    private fun labelForEpoch(p: JSONObject, epochMs: Long): String {
      return try {
        val days = p.optJSONArray("days") ?: return ""
        var best = ""
        var bestDiff = Long.MAX_VALUE
        for (i in 0 until days.length()) {
          val day = days.optJSONObject(i) ?: continue
          val dateKey = day.optString("dateKey")
          // Sunrise and the enabled night marks are candidates too. They pass
          // like anything else, and the card's "It's <name>" moment went blank
          // on them — the name was only ever looked for among the five salāh.
          val candidates = mutableListOf<JSONObject>()
          day.optJSONArray("rows")?.let { rows ->
            for (j in 0 until rows.length()) rows.optJSONObject(j)?.let(candidates::add)
          }
          day.optJSONObject("sunriseRow")?.let(candidates::add)
          day.optJSONArray("extraRows")?.let { extra ->
            for (j in 0 until extra.length()) extra.optJSONObject(j)?.let(candidates::add)
          }
          for (r in candidates) {
            val e = epochForDayTime(dateKey, r.optString("time"))
            if (e <= 0L) continue
            val d = kotlin.math.abs(e - epochMs)
            if (d < bestDiff) {
              bestDiff = d
              best = r.optString("name").ifEmpty { r.optString("key") }
            }
          }
        }
        if (bestDiff <= 120_000L) best else ""
      } catch (t: Throwable) {
        ""
      }
    }

    /**
     * Build the Android 17 countdown MetricStyle entirely via REFLECTION, so the
     * same source compiles against compileSdk 36 (the F-Droid build) as well as
     * 37 (Play / GitHub). Returns (style, hasSecondMetric) or null when the
     * MetricStyle APIs aren't available (API < 37) or anything goes wrong — the
     * caller then falls back to a standard big-countdown notification.
     *
     * Verified signatures (android.jar 37):
     *   Notification.MetricStyle()  .addMetric(Metric) .setMetrics(List)
     *                               .setCriticalMetric(int)
     *   Notification.Metric(MetricValue value, CharSequence label)
     *   Metric.TimeDifference.forTimer(Instant, int)  FORMAT_CHRONOMETER
     *   Metric.FixedTime(LocalTime)
     */
    private fun tryBuildCountdownMetricStyle(
      nextEpochMs: Long,
      inWord: String,
      secondKind: String,
      nextTime: String,
      atWord: String,
    ): Pair<Notification.Style, Boolean>? {
      return try {
        val msCls = Class.forName("android.app.Notification\$MetricStyle")
        val metricCls = Class.forName("android.app.Notification\$Metric")
        val mvCls = Class.forName("android.app.Notification\$Metric\$MetricValue")
        val tdCls = Class.forName("android.app.Notification\$Metric\$TimeDifference")
        val ftCls = Class.forName("android.app.Notification\$Metric\$FixedTime")
        val fmtChrono = tdCls.getField("FORMAT_CHRONOMETER").getInt(null)
        val forTimer = tdCls.getMethod(
          "forTimer", Instant::class.java, Int::class.javaPrimitiveType,
        )
        val metricCtor = metricCls.getConstructor(mvCls, CharSequence::class.java)
        val addMetric = msCls.getMethod("addMetric", metricCls)
        val setMetrics = msCls.getMethod("setMetrics", java.util.List::class.java)
        val setCritical = msCls.getMethod("setCriticalMetric", Int::class.javaPrimitiveType)

        // Always the chronometer format: the system shows H:MM:SS while the
        // screen is on and H:MM on the Always-On Display (it drops the seconds
        // there itself), so the full hours and minutes are always visible. The
        // adaptive format collapsed to a coarse "4h" on AOD.
        val timer = forTimer.invoke(
          null,
          Instant.ofEpochMilli(nextEpochMs),
          fmtChrono,
        )
        val countdownMetric = metricCtor.newInstance(timer, inWord as CharSequence)

        val second: Any? = when (secondKind) {
          "time" -> {
            val m = Regex("^(\\d{1,2}):(\\d{2})$").find(nextTime)
            if (m == null) null else {
              val lt = java.time.LocalTime.of(
                m.groupValues[1].toInt(), m.groupValues[2].toInt(),
              )
              val ftCtor = ftCls.getConstructor(java.time.LocalTime::class.java)
              metricCtor.newInstance(ftCtor.newInstance(lt), atWord as CharSequence)
            }
          }
          // A "Since Asr 1:12" stopwatch used to be offered here as a third
          // choice. It was dropped: the countdown card is one number falling
          // to zero, and a second clock climbing away from it beside the
          // first reads as a contradiction rather than as more information.
          else -> null
        }

        val ms = msCls.getConstructor().newInstance()
        if (second != null) {
          setMetrics.invoke(ms, arrayListOf(second, countdownMetric))
          setCritical.invoke(ms, 1)
        } else {
          addMetric.invoke(ms, countdownMetric)
          setCritical.invoke(ms, 0)
        }
        Pair(ms as Notification.Style, second != null)
      } catch (t: Throwable) {
        Log.w(NAME, "MetricStyle reflection unavailable, using fallback", t)
        null
      }
    }

    /** How many events ahead the bar reaches. Three is the most a strip that
     *  narrow can label at a glance, and enough to show the shape of the
     *  evening — a long wait, then two short ones. */
    private const val AHEAD = 3

    /**
     * Every dated instant in the payload's window, sorted: the five salāh,
     * Sunrise, and the night marks the user turned on. Their presence in the
     * payload IS the toggle — the JS side only sends the ones that are on.
     */
    private fun datedEvents(p: JSONObject): List<Long> {
      val days = p.optJSONArray("days") ?: return emptyList()
      val out = ArrayList<Long>()
      for (i in 0 until days.length()) {
        val day = days.optJSONObject(i) ?: continue
        val dateKey = day.optString("dateKey")
        if (dateKey.isEmpty()) continue
        val add = { time: String ->
          val e = epochForDayTime(dateKey, time)
          if (e > 0L) out.add(e)
          Unit
        }
        day.optJSONArray("rows")?.let { rows ->
          for (j in 0 until rows.length()) {
            rows.optJSONObject(j)?.let { add(it.optString("time")) }
          }
        }
        day.optJSONObject("sunriseRow")?.let { add(it.optString("time")) }
        day.optJSONArray("extraRows")?.let { extra ->
          for (j in 0 until extra.length()) {
            extra.optJSONObject(j)?.let { add(it.optString("time")) }
          }
        }
      }
      out.sort()
      return out
    }

    /**
     * Build a native [Notification.ProgressStyle] bar over WHAT IS COMING
     * (Android 16+):
     *
     *   ●━━━━━━━◆━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━●
     *   Dhuhr   now                     Asr             Maghrib      Isha
     *
     * The bar runs from the event just passed to the third one ahead, and the
     * three gaps are drawn to scale against each other — so the picture says
     * how long is left of this interval AND how that compares with the two
     * after it. At a glance in the afternoon: a long wait to Asr, a shorter
     * one to Maghrib, a short one to Isha.
     *
     * ── WHY NOT THE WHOLE DAY ─────────────────────────────────────────
     *
     * It used to be the whole solar day, midnight of one night to midnight of
     * the next, with all six events inside it. That is a lovely diagram and a
     * poor instrument: nine tenths of it is time you are not waiting for, the
     * interval you actually care about is a sliver, and the night — the
     * longest gap by hours — took the width that would have made the evening
     * legible. A Live Activity is read in two seconds while something else is
     * happening; it should answer "how long, and then what".
     *
     * Every event the user turned on counts here, night marks included. The
     * day timeline left them out deliberately, on the grounds that they were
     * not among "the six" — but this bar is about what is next, and what is
     * next is whatever the toggles say it is.
     *
     * Returns null when nothing is ahead in the payload window (the caller
     * falls back to a plain linear bar).
     */
    @SuppressLint("NewApi")
    private fun buildNextEventsProgressStyle(
      p: JSONObject,
      accentInt: Int,
      // Optional per-event points + tracker icon (Android 16 APIs). Default off
      // to keep the clean bar; both buildAndroid16 and buildAndroid17 use it.
      addPoints: Boolean = false,
      trackerIcon: Icon? = null,
    ): Notification.ProgressStyle? {
      if (Build.VERSION.SDK_INT < 36) return null
      return try {
        val now = System.currentTimeMillis()
        val events = datedEvents(p)
        val upcoming = events.filter { it > now }.take(AHEAD)
        if (upcoming.isEmpty()) return null

        // The left edge is the event just gone, so there is something filled
        // to read as "how far through". Before the window's first event there
        // is nothing behind us, so an hour is assumed — the same fallback the
        // progress fraction uses when it has no previous prayer.
        val start = events.lastOrNull { it <= now } ?: (upcoming.first() - 3600_000L)
        val marks = ArrayList<Long>(upcoming.size + 1).apply {
          add(start)
          addAll(upcoming)
        }

        val rawLens = (0 until marks.size - 1).map {
          (marks[it + 1] - marks[it]).coerceAtLeast(1L)
        }
        val rawTotal = rawLens.sum().toDouble()
        val n = rawLens.size
        // Proportional, but with a floor: a twelve-minute Maghrib→Isha beside
        // a five-hour Isha→Fajr would otherwise be a hairline nobody can see,
        // and a gap you cannot see is a gap the bar is not telling you about.
        // Capped so the floors can never take more than about two thirds of
        // the bar, which is what keeps the long gaps honestly long.
        val minShare = minOf(0.12, 0.66 / n)
        val floorLen = rawTotal * minShare
        val adjLens = rawLens.map { maxOf(it.toDouble(), floorLen) }
        val adjTotal = adjLens.sum()
        val unit = 100_000.0
        val segUnits = adjLens.map { (it / adjTotal * unit).toInt().coerceAtLeast(1) }
        val segments = segUnits.map {
          Notification.ProgressStyle.Segment(it).setColor(accentInt)
        }

        // "Now" remapped into the same floored space, so the filled edge lands
        // at the real moment within the gap we are actually in — which, with
        // the left edge one event behind, is always the first segment.
        var progressUnits = 0
        for (i in 0 until n) {
          val segStart = marks[i]
          val segEnd = marks[i + 1]
          if (now >= segEnd) {
            progressUnits += segUnits[i]
          } else if (now > segStart) {
            val frac = (now - segStart).toDouble() / (segEnd - segStart).toDouble()
            progressUnits += (segUnits[i] * frac).toInt()
            break
          } else {
            break
          }
        }

        val style = Notification.ProgressStyle()
          .setProgress(progressUnits)
          .setProgressSegments(segments)

        // A point at each event the bar reaches, the far end included: unlike
        // the day timeline, whose last mark was a notional midnight, every
        // mark here IS an event.
        if (addPoints) {
          val points = ArrayList<Notification.ProgressStyle.Point>(n)
          var cum = 0
          for (i in 0 until n) {
            cum += segUnits[i]
            points.add(Notification.ProgressStyle.Point(cum).setColor(accentInt))
          }
          if (points.isNotEmpty()) style.setProgressPoints(points)
        }
        if (trackerIcon != null) style.setProgressTrackerIcon(trackerIcon)

        style
      } catch (t: Throwable) {
        Log.w(NAME, "buildNextEventsProgressStyle failed", t)
        null
      }
    }

    /** Local-timezone epoch (ms) for a `yyyy-MM-dd` + `HH:MM` pair, or 0. */
    private fun epochForDayTime(dateKey: String, hhmm: String): Long {
      val dm = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$").find(dateKey) ?: return 0L
      val tm = Regex("^(\\d{1,2}):(\\d{2})$").find(hhmm) ?: return 0L
      val h = tm.groupValues[1].toInt()
      val min = tm.groupValues[2].toInt()
      if (h !in 0..23 || min !in 0..59) return 0L
      return java.util.Calendar.getInstance().apply {
        set(java.util.Calendar.YEAR, dm.groupValues[1].toInt())
        set(java.util.Calendar.MONTH, dm.groupValues[2].toInt() - 1)
        set(java.util.Calendar.DAY_OF_MONTH, dm.groupValues[3].toInt())
        set(java.util.Calendar.HOUR_OF_DAY, h)
        set(java.util.Calendar.MINUTE, min)
        set(java.util.Calendar.SECOND, 0)
        set(java.util.Calendar.MILLISECOND, 0)
      }.timeInMillis
    }

    // ── Pre-Android 16 path ─────────────────────────────────────────

    private fun buildLegacy(
      ctx: Context,
      nextEpochMs: Long,
      accentInt: Int,
      progressPct: Int,
      title: String,
      contentIntent: PendingIntent,
      contentView: RemoteViews?,
    ): Notification {
      val countdown = "↓ ${formatRemaining(nextEpochMs - System.currentTimeMillis())}  |  $progressPct%"
      val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_prayer)
        .setColor(accentInt)
        .setColorized(false)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setLocalOnly(false)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        // Standard fields — accessibility text + fallback for hardened shells.
        .setContentTitle(title)
        .setContentText(countdown)
        .setContentIntent(contentIntent)
        .setShowWhen(false)

      if (contentView != null) {
        // Custom layout handles the progress bar — don't call setProgress()
        // or a second bar appears below the custom content view.
        builder.setCustomContentView(contentView)
        builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
      } else {
        builder.setProgress(100, progressPct, false)
      }

      return builder.build()
    }

    // ── Reflection helpers for Android 16 chip APIs ─────────────────

    /** Set the short critical text on the notification — drives the
     *  status-bar Live Update chip on Android 16+. Probed via runtime
     *  method enumeration; takes String on AOSP, may differ on OEMs. */
    private fun tryAttachShortCriticalText(
      builder: Notification.Builder,
      text: String,
    ) {
      if (text.isEmpty()) return
      val cls = Notification.Builder::class.java
      val candidateNames = setOf(
        "setShortCriticalText",
        "setShortText",
        "setStatusBarShortText",
        "setOngoingActivityShortText",
      )
      for (m in cls.methods) {
        if (m.name !in candidateNames) continue
        val pts = m.parameterTypes
        if (pts.size != 1) continue
        if (!pts[0].isAssignableFrom(CharSequence::class.java) &&
            pts[0] != CharSequence::class.java &&
            pts[0] != String::class.java) continue
        val ok = runCatching { m.invoke(builder, text as CharSequence) }.isSuccess
        if (ok) {
          Log.i(NAME, "ShortCriticalText attached via ${m.name}: $text")
          builder.extras.putCharSequence("android.shortCriticalText", text)
          return
        }
      }
      builder.extras.putCharSequence("android.shortCriticalText", text)
      Log.i(NAME, "ShortCriticalText set via extras fallback: $text")
    }

    /** Ask the system to promote this notification to the status-bar
     *  chip. Available since Android 16. */
    private fun tryRequestPromotedOngoing(builder: Notification.Builder) {
      val candidates = setOf(
        "setRequestPromotedOngoing",
        "setOngoingPromoted",
        "requestPromotedOngoing",
        "setPromotedOngoing",
      )
      for (m in Notification.Builder::class.java.methods) {
        if (m.name !in candidates) continue
        val pts = m.parameterTypes
        if (pts.size != 1) continue
        if (pts[0] != Boolean::class.javaPrimitiveType &&
            pts[0] != java.lang.Boolean::class.java) continue
        val ok = runCatching { m.invoke(builder, true) }.isSuccess
        if (ok) {
          Log.i(NAME, "Requested promoted ongoing via ${m.name}")
          return
        }
      }
      Log.w(NAME, "No promoted-ongoing API found on this build")
    }

    // ── Small helpers ───────────────────────────────────────────────

    /** Current progress between `prev` and `next` epochs as a 0..100
     *  integer. The bar advances every time we call this — the service
     *  re-calls it every minute so the bar actually animates. */
    private fun computeProgressPercent(prevEpochMs: Long, nextEpochMs: Long): Int {
      if (nextEpochMs <= 0L || prevEpochMs <= 0L) return 0
      val span = nextEpochMs - prevEpochMs
      if (span <= 0L) return 0
      val done = System.currentTimeMillis() - prevEpochMs
      val pct = ((done.toDouble() / span.toDouble()) * 100.0)
      return pct.coerceIn(0.0, 100.0).toInt()
    }

    /** Short human duration for the status-bar chip — at most ~7 chars. */
    private fun formatRemainingShort(ms: Long): String {
      if (ms <= 0L) return "Now"
      val totalMin = (ms / 60_000L).toInt()
      if (totalMin < 1) return "<1m"
      val h = totalMin / 60
      val m = totalMin % 60
      return if (h <= 0) "${m}m" else "${h}h ${m}m"
    }

    private fun parseColor(hex: String, fallback: Int): Int =
      try { Color.parseColor(if (hex.startsWith("#")) hex else "#$hex") }
      catch (_: Throwable) { fallback }

    /**
     * Resolve the device's current Material You system accent as an ARGB int.
     * Read fresh from the context each call so re-posts pick up wallpaper
     * colour changes. Uses the platform `system_accent1_600` resource (the same
     * source the home-screen widget uses) on Android 12+, falling back to the
     * AppTheme's colorPrimary, then brand green.
     */
    private fun resolveSystemAccent(ctx: Context): Int {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        runCatching {
          return ContextCompat.getColor(ctx, android.R.color.system_accent1_600)
        }
      }
      runCatching {
        val wrapped = android.view.ContextThemeWrapper(ctx.applicationContext, R.style.AppTheme)
        val ta = wrapped.obtainStyledAttributes(intArrayOf(android.R.attr.colorPrimary))
        try {
          return ta.getColor(0, Color.parseColor("#22C55E"))
        } finally {
          ta.recycle()
        }
      }
      return Color.parseColor("#22C55E")
    }
  }
}
