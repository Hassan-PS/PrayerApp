package com.prayer_times

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * Handles the Live Activity's action buttons (Android 17+).
 *
 * The alert-mode button was a two-state "Mute next adhan" toggle. It is now
 * the same three-way control as the home row — adhan / alert / silent, one
 * tap per step, for the upcoming occurrence only. See
 * [LiveActivityAlertModes] for why the mode travels on every row and why the
 * override is stored against an instant.
 *
 * The Live Activity is a native Notification.Builder (not notifee), so its
 * action button fires a broadcast here. We split responsibility:
 *
 *   • Native owns the BUTTON STATE — the override (an instant and a mode) is
 *     stored in the Live Activity SharedPreferences and read back by the
 *     notification builder to choose the label. This makes the label advance
 *     instantly and reliably, even with no JS runtime alive.
 *
 *   • JS owns the ACTUAL ALERT — the adhan is an OS-played
 *     notification-channel sound baked into a pre-scheduled notifee trigger,
 *     so changing the mode means re-creating that trigger on another channel,
 *     or cancelling it outright for silent. That's JS work, dispatched to
 *     [AdhanMuteHeadlessService] (a HeadlessJS task) which runs even when the
 *     app is closed. The task also persists the override so a later full
 *     resync rebuilds the alert the way the button left it.
 *
 * The two are independent: if the JS side fails, the button still advances and
 * the Live Activity itself is never affected.
 *
 * NOTHING HERE WRITES THE STANDING SETTING. The home row is the answer for
 * every Fajr; this is the answer for one of them, and a temporary control
 * that quietly turns permanent is the worst of both.
 */
class MihrabLiveActivityActionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      ACTION_TOGGLE_MUTE_NEXT -> handleMuteToggle(ctx, intent)
      ACTION_TOGGLE_AOD -> handleAodToggle(ctx)
    }
  }

  /**
   * Toggle whether the ongoing Live Activity shows on the lock screen /
   * always-on display. Purely native: flips a persisted flag and re-posts the
   * card so the new visibility takes effect immediately. The notification stays
   * in the shade either way — only its lock-screen/AOD visibility changes. This
   * is independent of the master on/off setting (which stops the card entirely).
   */
  private fun handleAodToggle(ctx: Context) {
    val prefs = ctx.getSharedPreferences(
      MihrabLiveActivityModule.PREFS_NAME, Context.MODE_PRIVATE,
    )
    val nowHidden = !prefs.getBoolean(KEY_AOD_HIDDEN, false)
    prefs.edit().putBoolean(KEY_AOD_HIDDEN, nowHidden).apply()
    Log.i(TAG, "toggle AOD visibility -> hidden=$nowHidden")
    val payloadJson = MihrabLiveActivityModule.loadPayload(ctx)
    val payload = runCatching { payloadJson?.let { JSONObject(it) } }.getOrNull()
    runCatching {
      if (payload != null) {
        val notif = MihrabLiveActivityModule.buildNotificationFromPayload(ctx, payload)
        NotificationManagerCompat.from(ctx).notify(MihrabLiveActivityModule.NOTIF_ID, notif)
      }
    }.onFailure { Log.w(TAG, "re-post after AOD toggle failed", it) }
  }

  /**
   * One step round the cycle for the upcoming occurrence.
   *
   * The intent carries only the instant and the key. The mode it is moving
   * FROM is read back here from the same two places the builder read it —
   * the stored override and the payload's own rows — so a PendingIntent the
   * system kept from an earlier post can never apply a mode the card has
   * since moved past.
   */
  private fun handleMuteToggle(ctx: Context, intent: Intent) {
    val epoch = intent.getLongExtra(EXTRA_EPOCH, 0L)
    val name = intent.getStringExtra(EXTRA_NAME) ?: ""
    if (epoch <= 0L) return
    // A TAP AIMED AT AN EVENT THAT HAS ALREADY ARRIVED CHANGES NOTHING.
    //
    // One PendingIntent is kept alive across every re-post (FLAG_UPDATE_
    // CURRENT), so its extras track the card — but only as often as the card
    // is rebuilt. Between the instant a prayer arrives and the next rebuild,
    // the button on screen still carries the epoch that has just passed.
    // Without this, a tap in that window would write an override for a
    // moment nobody can be alerted at any more, and — worse — throw away one
    // the user had set for it. The alert itself is already beyond changing:
    // the headless task refuses a past epoch too.
    if (epoch <= System.currentTimeMillis()) {
      Log.i(TAG, "ignoring alert-mode tap for a past event: epoch=$epoch name=$name")
      return
    }

    val prefs = ctx.getSharedPreferences(
      MihrabLiveActivityModule.PREFS_NAME, Context.MODE_PRIVATE,
    )
    val payloadJson = MihrabLiveActivityModule.loadPayload(ctx)
    val payload = runCatching { payloadJson?.let { JSONObject(it) } }.getOrNull()

    val current =
      if (payload != null) {
        LiveActivityAlertModes.effectiveMode(prefs, payload, epoch, name)
      } else {
        LiveActivityAlertModes.overrideFor(prefs, epoch, name)
          ?: LiveActivityAlertModes.modesFor(name)[0]
      }
    val next = LiveActivityAlertModes.nextMode(name, current)
    // The standing setting, so a cycle that lands back on it clears the
    // override instead of pinning the row to a value it already held.
    val base =
      payload?.let { LiveActivityAlertModes.baseModeFor(it, name) }.orEmpty()
    LiveActivityAlertModes.store(prefs, epoch, name, next, base)
    Log.i(TAG, "cycle alert mode: epoch=$epoch name=$name $current -> $next (base=$base)")

    // 1) Re-post the Live Activity immediately so the label advances now.
    runCatching {
      if (payload != null) {
        val notif = MihrabLiveActivityModule.buildNotificationFromPayload(ctx, payload)
        NotificationManagerCompat.from(ctx).notify(MihrabLiveActivityModule.NOTIF_ID, notif)
      }
    }.onFailure { Log.w(TAG, "re-post after cycle failed", it) }

    // 2) Apply the real change in JS via a HeadlessJS task. The button tap is
    //    a user interaction, which grants the brief background start allowance
    //    the service needs. Reschedule data comes from the persisted payload.
    //    Dispatched even when the cycle returned to the standing mode: an
    //    earlier step may have cancelled or re-channelled that alert, and
    //    clearing the override alone would not put it back.
    runCatching {
      val svc = Intent(ctx, AdhanMuteHeadlessService::class.java).apply {
        putExtra(EXTRA_EPOCH, epoch)
        putExtra(EXTRA_NAME, name)
        putExtra(EXTRA_MODE, next)
        putExtra("title", payload?.optString("nextLabel", name) ?: name)
        putExtra("body", payload?.optString("atPrayerBody", "") ?: "")
        putExtra("adhanChannelId", payload?.optString("adhanChannelId", "") ?: "")
        putExtra("adhanSoundId", payload?.optString("adhanSoundId", "default") ?: "default")
        putExtra(
          "defaultChannelId",
          payload?.optString("defaultChannelId", "prayer-times-default")
            ?: "prayer-times-default",
        )
      }
      ctx.startService(svc)
      HeadlessReschedule.acquire(ctx)
    }.onFailure { Log.w(TAG, "headless alert-mode dispatch failed", it) }
  }

  companion object {
    const val TAG = "MihrabLAAction"
    const val ACTION_TOGGLE_MUTE_NEXT = "com.prayer_times.ACTION_TOGGLE_MUTE_NEXT"
    const val ACTION_TOGGLE_AOD = "com.prayer_times.ACTION_TOGGLE_AOD"
    const val EXTRA_EPOCH = "epoch"
    const val EXTRA_NAME = "name"
    /** The mode the tap is moving TO: adhan / notification / silent. */
    const val EXTRA_MODE = "mode"
    /** SharedPreferences key written by the two-state "Mute next adhan"
     *  button this action replaced: the epoch of the prayer whose adhan was
     *  muted, or -1. Still READ (see LiveActivityAlertModes.overrideFor) so
     *  an install that updated between a mute and the prayer it muted does
     *  not hear the adhan anyway; never written again. */
    const val KEY_MUTED_EPOCH = "muted_next_epoch"
    /** SharedPreferences key: true when the user hid the Live Activity from the
     *  lock screen / always-on display (it stays visible in the shade). */
    const val KEY_AOD_HIDDEN = "aod_hidden"
  }
}

/** Tiny wakelock holder so the HeadlessJS service has time to spin up. */
object HeadlessReschedule {
  fun acquire(ctx: Context) {
    runCatching { com.facebook.react.HeadlessJsTaskService.acquireWakeLockNow(ctx) }
  }
}
