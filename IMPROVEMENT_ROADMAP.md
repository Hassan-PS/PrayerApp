# Mihrab — Improvement Roadmap

**Last verified against the code: 2026-09-06, at v2.16.0 (versionCode 261).**

This file was written for v1.5.56 and then went stale for about a year, which
made it actively misleading: it kept proposing work that had already shipped —
splitting HomeScreen, widening the retry policy, adding a locale-parity test —
so anyone reading it started by re-solving solved problems. Every item below
was checked against the tree on the date above.

**Rule for this file:** an item leaves the roadmap when it lands, in the same
change that lands it. A roadmap nobody trims is a roadmap nobody can act on.

---

## Part 0 — Shipped since this file was written

Kept only as a record, so these do not get proposed again. Each was verified
present in the tree, not assumed.

**Architecture and rendering.** HomeScreen, SettingsScreen and CompassScreen
are all orchestrators now (143 and 160 lines for the latter two), with their
children under `src/screens/home/`, `settings/` and `compass/`, every one
memoized. The one-second countdown lives in `HeroToday` inside `TodayCard` and
is gated on focus _and_ foreground, so it stops in a pocket; HomeScreen's
remaining 30-second timer is a watchdog that only sets state when the next
prayer actually changes. `PrayerSettingsContext` is split into six domain
contexts, so a widget-colour change no longer wakes the home tree.

**Network.** `src/utils/fetchWithRetry.ts` carries a per-request timeout, all
5xx plus 408/425/429 retried, `Retry-After`, jittered backoff, body draining
between attempts, and no retry after a caller cancels. `providerHealth.ts` is
a real circuit breaker (3 consecutive failures, 12-hour cooldown, persisted).
Every prayer-times provider and all geocoding routes through both. The Quran
content sources — recitation, timings, page fonts, tafsir, riwayah installs —
were brought in on 2026-09-06 and now all carry deadlines, with a source scan
that fails the build if a new one is added without.

**Correctness.** `validateTimings` checks ordering, not just shape; the
Islamiska Förbundet scraper is a parser module with its own tests; DST
transitions, AsyncStorage quota, exact-alarm revocation, pre-reminder
clamping, widget rollover with no tomorrow, and the `(0,0)` coordinate guard
all have tests.

**Accessibility and i18n.** Locale parity and RTL are enforced by tests;
`scripts/a11y-scan.js` exists; CLDR plurals are in the locale files; Hijri
month names are localised.

**Privacy.** Coordinates are in `src/settings/secureStorage.ts` on encrypted
storage, not AsyncStorage.

**Testing.** 278 suites / 3851 tests, against the "existing 9" this file was
written beside. CI runs `tsc --noEmit` and the full suite on every push.

**Features.** Saved locations, tasbih, Hijri events, Ramadan countdown, adhan
preview, notification actions, per-prayer offsets, iOS lock-screen
complications (`accessoryCircular`/`Inline`/`Rectangular`), Jumu'ah highlight,
share, the prayer journal, the dua library, the fasting tracker, custom adhan
audio, backup/restore, and the full Quran reader with audio — all shipped.

---

## Part 1 — Actually open

### 1.1 The app reloads after switching away

The most-felt problem, and not a rendering one. Android reclaims the process:
`oom_score_adj` measures **700** with the Live Activity off versus **50** with
it on (a foreground service), at ~125 MB PSS. Memoization cannot prevent this
and neither can a smaller APK — a reclaim is a kill.

What makes it _feel_ like a reload is that nothing is restored.
`NavigationContainer` in `src/AppNavigationRoot.tsx` has no `initialState` and
no `onStateChange`, so coming back means the tab resets to Home, the mushaf
page is lost and scroll position is gone.

**Fix:** persist navigation state plus the mushaf page and scroll offset, and
restore on launch. A reclaim then costs a 470 ms flash instead of a reader's
place. This is the highest-value item on the list.

### 1.2 The last 1.74 MB of the JS bundle

The APK went 50.1 MB → 35.8 MB by moving the translations and the 114 surah
files out to platform assets. What remains inside the bundle is
`src/quran/data/mushafLayoutV2.json` (1.4 MB) and
`warshLines.json`/`shubahLines.json` (264 KB).

They were left deliberately: `getPageLayout(page)` is the **synchronous**
entry point for the mushaf page renderer, and behind a warm invariant a miss
renders a blank page on the core reading surface. Moving them means making
that renderer async first. Real work, worth doing deliberately — not a config
change.

### 1.3 Build and release

- **`package.json` says 1.5.50; the app is 2.16.0.** `scripts/sync-version.js`
  updates the gradle, pbxproj and F-Droid entries but not `package.json`, so
  it has drifted by about a year. Either sync it or make it explicit that
  gradle is the only source of truth.
- **CI does not run eslint.** `ci.yml` runs `tsc --noEmit` and jest. The
  baseline is 6 errors and 536 warnings; the errors want fixing before the
  check is turned on, or it lands red.
- **No `fastlane match` fallback for iOS.** Xcode Cloud is the path; there is
  no local lane for an offline emergency build.

### 1.4 Smaller, genuine

- **Pre-prayer reminder for a silenced occurrence.** Silencing an occurrence
  from the Live Activity leaves its own pre-reminder standing until the next
  full resync.
- **`zod`-style strict boundaries.** `validateTimings` is a hand-rolled guard
  and covers the prayer providers well; the Quran content boundaries do not
  have an equivalent.

---

## Part 2 — Features not built

Roughly by value ÷ cost.

- **Mosque finder** — Overpass/OSM query for `amenity=place_of_worship` +
  `religion=muslim`. No accounts, no API keys. The largest remaining gap
  against competitors.
- **Hijri date picker for the month view** — browse a Hijri month, not only a
  Gregorian one.
- **Wear OS tile and Apple Watch complication** — next prayer plus countdown,
  off the existing widget data. (`scripts/mihrab-watch.sh` is the weekly reuse
  check, not a watch app — the name is a coincidence.)
- **Tahajjud / Duha / Ishraq notifications** — the optional windows are
  already computed for the Live Activity's non-prayer events; this is the
  notification surface for them.
- **Family/community mode** — shared household reminders, privacy-preserving
  with a single shared key. A month or more, and the first feature that would
  need Mihrab to hold anything about anyone.

---

## Part 3 — Waiting on a person, not on code

- **Cut a release.** 20 commits on `main` since v2.16.0, including a
  user-facing feature (the Live Activity's temporary alert-mode toggle and its
  home-screen reset).
- **Upload `app-play-release.aab` to Play** so the localized store listings go
  live.
- **App Store Connect vendor number** is needed for real iOS install figures.
