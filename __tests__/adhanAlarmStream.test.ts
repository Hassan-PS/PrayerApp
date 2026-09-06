/**
 * "Notification sound not working on silent/vibrate" (issue #9).
 *
 * Not a bug, and the reporter's fix was the right one. A notification
 * channel's audio carries `USAGE_NOTIFICATION`, which Android routes to the
 * notification stream — the stream the ringer switch silences. Correct
 * behaviour, and useless to someone who silences their phone and still
 * wants to be called to prayer. `USAGE_ALARM` goes to the alarm stream,
 * which the ringer does not touch.
 *
 * Two constraints shape the whole design and both are pinned here:
 *
 *  1. A channel's sound and audio attributes are FROZEN at creation.
 *     Calling `createNotificationChannel` again with the same id changes
 *     nothing, so the ringer-proof variant has to be a separate channel
 *     with its own id — hence the `-alarm` suffix.
 *  2. It is for the CALL TO PRAYER only. Sunrise and the night times are
 *     not prayers, and a muted next adhan has just been silenced on
 *     purpose; neither should override a silenced phone.
 */
import {
  resolveSoundTargets,
  alarmChannelId,
  getNotificationSoundOption,
  registerCustomAdhan,
} from '../src/notifications/notificationSounds';
import { DEFAULT_SETTINGS } from '../src/settings/types';

afterEach(() => registerCustomAdhan(null));

describe('the alarm channel is a different channel', () => {
  it('suffixes rather than reusing the id', () => {
    // Reusing it would silently keep the old audio attributes: Android
    // freezes them at creation and ignores a second create.
    const base = getNotificationSoundOption('adhan_makkah').androidChannelId;
    expect(alarmChannelId(base)).toBe(`${base}-alarm`);
    expect(alarmChannelId(base)).not.toBe(base);
  });

  it('resolves to the twin only when asked', () => {
    const base = getNotificationSoundOption('adhan_makkah').androidChannelId;
    expect(resolveSoundTargets('adhan_makkah').androidChannelId).toBe(base);
    expect(resolveSoundTargets('adhan_makkah', true).androidChannelId).toBe(
      `${base}-alarm`,
    );
  });

  it('leaves the iOS sound alone either way', () => {
    // iOS has no equivalent: notification sounds obey the physical silent
    // switch and only Critical Alerts overrides it. The flag must not
    // change what iOS is told.
    const off = resolveSoundTargets('adhan_makkah');
    const on = resolveSoundTargets('adhan_makkah', true);
    expect(on.iosSound).toBe(off.iosSound);
  });

  it('applies to the imported recording too', () => {
    registerCustomAdhan({
      name: 'my adhan',
      soundName: 'custom.caf',
      channelId: 'custom-adhan-abc123',
    } as never);
    expect(resolveSoundTargets('custom', true).androidChannelId).toBe(
      'custom-adhan-abc123-alarm',
    );
  });

  it('follows the fallback when custom is selected but missing', () => {
    // The file does not survive a reinstall while the setting does. The
    // alarm twin must track the fallback, not point at a channel for a
    // recording that is gone — that is a silent prayer alert.
    const fallback = getNotificationSoundOption('default').androidChannelId;
    expect(resolveSoundTargets('custom', true).androidChannelId).toBe(
      `${fallback}-alarm`,
    );
  });
});

describe('the setting', () => {
  it('is off by default', () => {
    // Louder than what someone agreed to when they turned notifications
    // on. An alert that ignores a silenced phone is asked for, not assumed.
    expect(DEFAULT_SETTINGS.adhanUsesAlarmStream).toBe(false);
  });
});

describe('wiring that would fail silently if it drifted', () => {
  const read = (p: string) =>
    require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');

  it('the native channel uses USAGE_ALARM, not USAGE_NOTIFICATION', () => {
    const kt = read(
      'android/app/src/main/java/com/prayer_times/CustomAdhanModule.kt',
    );
    expect(kt).toMatch(/fun ensureAlarmChannel/);
    const fn = kt.slice(kt.indexOf('fun ensureAlarmChannel'));
    expect(fn).toContain('AudioAttributes.USAGE_ALARM');
  });

  it('is built natively because Notifee cannot express audio attributes', () => {
    // If anyone ever "simplifies" this to notifee.createChannel, the sound
    // goes back to the notification stream and the feature silently stops
    // working with no other symptom.
    const ts = read('src/notifications/prayerNotifications.ts');
    expect(ts).toContain('ensureAlarmAdhanChannel');
    expect(ts).toContain('deleteAdhanChannel');
  });

  it('only the adhan gets the alarm twin', () => {
    const ts = read('src/notifications/prayerNotifications.ts');
    // The gate is `wantsAdhan`, and `wantsAdhan` is the whole claim: a
    // real prayer, set to the adhan for THIS occurrence (v2.14.5 — before
    // that the mode was global, so being a prayer at all was the whole
    // test). `modeAt` is what folds the Live Activity's one-off override
    // into that answer; a rewrite that went back to the standing mode
    // would give the alarm stream to a prayer the card had just silenced.
    expect(ts).toMatch(/useAlarmStream && wantsAdhan/);
    expect(ts).toMatch(
      /const wantsAdhan =\s*\n?\s*!isNonPrayer && modeAt\(e\.name, e\.at\.getTime\(\)\) === 'adhan'/,
    );
  });

  it('a prayer set to the plain alert is not making the adhan’s claim', () => {
    // The alarm stream exists so the CALL TO PRAYER survives a silenced
    // ringer. A row cycled to the ordinary tone has asked for an alert,
    // not for something that overrides the phone being silenced.
    const ts = read('src/notifications/prayerNotifications.ts');
    expect(ts).toMatch(/const eventSound = wantsAdhan \? prayerTimeSound : reminderSound/);
  });

  it('the resync fingerprint includes it', () => {
    // It changes which channel every prayer is scheduled against. Left out
    // of the fingerprint, flipping the toggle looks like "nothing changed"
    // and the alarms keep pointing at the old channel.
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toMatch(/String\(settings\.adhanUsesAlarmStream\)/);
  });

  it('the toggle is Android-only', () => {
    // iOS cannot do this without Critical Alerts. A switch that did
    // nothing on iPhone is worse than no switch.
    const card = read('src/screens/settings/NotificationsCard.tsx');
    expect(card).toMatch(
      /Platform\.OS === 'android' \?\s*\(\s*<SettingsToggleRow[\s\S]{0,600}adhanAlarmStream/,
    );
  });
});
