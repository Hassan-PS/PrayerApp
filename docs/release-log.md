# Release log

What each release cost to cut, and what it taught the cycle.

Written by `scripts/release.sh` — the facts automatically, the **Lesson**
line by hand. A release that changed the cycle, or that had to be aborted
and restarted, leaves that line as `_(unfilled)_`, and **the next release
refuses to start until it says something.**

That gate is the point of this file. Every check in `release.sh` stops a
bad release; this one stops a bad *cycle* — the same mistake being paid
for twice because nobody wrote down what the first one cost. It is cheap
when nothing happened: a clean run that did not touch the cycle records
"none needed" on its own and never asks.

Entries are appended newest-last.

---

## 2.13.0 (245) — 2026-08-27

Cut by hand, before `release.sh` existed. Recorded here because it is the
release that produced most of the reasons the script has the shape it has.

Aborted nothing — it had nothing to abort into. What went wrong instead
went wrong *after* publishing:

  - The Play release notes were over the 500-character limit in all three
    locales, found by `verify-release.sh` once the tag and the GitHub
    release were already public.
  - Every Mac that upgraded to it froze its widgets and their gallery
    previews at 2.12.0's data, because replacing the app invalidates
    chronod's archived timelines and it never recovers on its own. No
    step anywhere covered that; the checklist predated the Mac build.

**Lesson:** a checklist cannot enforce an order, and the irreversible step
sits in the middle of it. Everything that can fail has to run before the
first push, which is now the one rule `release.sh` is built around — and
the two things this release got wrong are checks in it: the notes limit in
preflight, and the cask's `chronod` postflight as a release gate.

## 2.13.1 (246) — 2026-08-28

Took 5 aborted attempt(s) before it ran clean:

  - 1 catalyst build failed — /tmp/release-catalyst.log
  - 1 the last release left its lesson unwritten — fill in the '**Lesson:**' line in docs/release-log.md, commit it, and rerun
  - 3 working tree has tracked changes — commit or stash them first

Changed the release cycle itself:

  - `docs/DISTRIBUTION.md`
  - `scripts/release.sh`
  - `scripts/verify-release.sh`
  - `scripts/xcode-cloud.py`

**Lesson:** the iOS gate written for 2.13.0 failed this release, and the
gate was the thing that was wrong: it announced that 2.13.1 had never
reached App Store Connect while run #550 was building that exact commit.
`/buildRuns` returns the *oldest* runs unless asked to sort, so the branch
that reports "still building" had never once been reachable — the check
had one answer and it was a false alarm. A verification step is not proved
by passing; it is proved by each of its verdicts having been seen to
happen for the right reason. It now sorts, is handed the release commit,
and tells "Xcode Cloud has not picked this push up yet" apart from "the
trigger never fired".

**Second lesson, learned by causing it:** pushing that fix to `main` while
run #550 was building cancelled it. #551 then built the same version from
the newer commit and reached App Store Connect as build 551, VALID — fine
here only because the fix touched scripts and tests, nothing in the app.
The rule is now in `DISTRIBUTION.md`: after a release, `main` stays still
until Xcode Cloud finishes. What ships on iOS is the commit that survived
to the end of the run, not the commit the tag names.

## 2.13.2 (247) — 2026-08-29

Ran clean on the first attempt — the first release that has.

Changed the release cycle itself:

  - `docs/DISTRIBUTION.md`
  - `scripts/release.sh`
  - `scripts/sync-version.js`
  - `scripts/verify-release.sh`
  - `scripts/xcode-cloud.py`

**Lesson:** the two gates written after 2.13.0 and 2.13.1 both fired for
the first time in this cut, and both were right. The in-flight check
refused to start the release at all, because pushing the release notes had
started a run — which is the same collision that lost 2.12.0's iOS build,
caught this time before anything was tagged; waiting eleven minutes was
the whole cost. Then verification ended on *"EVERY FINISHED CHANNEL
PASSED — iOS is still building"* rather than the old "live on every
channel", naming run #561 by number. Neither of those was reachable a
release ago: one was dead code behind an unsorted API query, the other was
a sentence that overclaimed.

So the thing worth writing down is not a new failure. It is that the cost
of a gate is paid on the release that adds it, and the value arrives one
or two releases later, on a cut where nothing goes wrong and nothing looks
like it needed the gate. That asymmetry is exactly why they get deleted.
The evidence that they work is this entry being short.

**Held back, deliberately:** this lesson was committed while run #561 was
still building and pushed only afterwards. That is the rule from 2.13.1,
now followed rather than discovered — a push to `main` mid-run cancels it,
and iOS then ships the newer commit rather than the tagged one.

## 2.13.3 (248) — 2026-08-29

Ran clean on the first attempt.

**Lesson:** none needed — clean run, no change to the cycle.

**Corrected the same day.** That line was written by the script and left
alone, and it was wrong within hours. The cut was clean; the *release* was
not, and neither failure was reachable from anything this cycle checks:

  - Upgrading on macOS REMOVED every placed widget, and had done on every
    upgrade. Replacing the app drops the extension's PlugInKit record and
    nothing re-registers it, so WidgetKit discards the placement. Found
    because a user said "after every update the widgets are removed" — not
    by a gate, and not by the person cutting the release, whose own Mac
    looked fine because he launches the app.
  - This was the eighth consecutive release to ship UNNOTARIZED. Gatekeeper
    had been blocking the first launch of every Mac install since 2.11.0,
    and the cask carried a caveat apologising for it. The notary service's
    history is what says so: last accepted submission, 2.10.1.

Both are now gates (`pluginkit` in the cask; a stapled ticket on the zip,
checked before publishing and again on what is served), and notarization
happens inside `build-catalyst.sh` rather than in a comment asking a human
to run it afterwards.

The reason this note is appended rather than the "none needed" line being
edited: a clean *cut* is not a clean *release*, and this file is the only
place that distinction gets recorded. A release that publishes something
broken and reports success is the failure this log exists to catch, so the
entry has to show both what the script knew and what it could not know.

## 2.13.4 (249) — 2026-08-29

Ran clean on the first attempt.

Changed the release cycle itself:

  - `docs/DISTRIBUTION.md`
  - `scripts/build-catalyst.sh`
  - `scripts/release.sh`
  - `scripts/verify-release.sh`

**Lesson:** both of the failures this release fixes were invisible to the
cycle for the same reason, and it is not the one that looks obvious.

Neither was a missing check. Notarization *was* written down — four
commented-out lines at the top of `build-catalyst.sh`, with the exact
commands. The widget re-registration had no comment, but nothing about it
was hard either. What both had in common is that the only evidence they
were needed lived on a machine the release never looks at: a Mac that had
*upgraded*, some time later. The release process only ever sees a Mac that
just built the thing, where the app is registered because the build
launched it and Gatekeeper is quiet because the developer approved the
bundle himself months ago. Eight releases went out with Gatekeeper blocking
every install, from a machine on which nothing was blocked.

So the useful generalisation is not "add a gate for notarization". It is
that a check run on the build machine answers a different question from
the one users are asking, and for anything that only manifests on a second
install, the artifact has to be interrogated as a stranger would: unpacked
somewhere else and asked what it is. That is why the new checks are
`stapler validate` on the downloaded zip rather than "we ran notarytool",
and why the cask's registration loop verifies that the record *stayed*
rather than that the command succeeded.

**It cost something to learn that, too.** The first version of the
verification unpacked the app and ran `spctl` on it, which handed the
bundle to App Translocation, registered the translocated path, and took the
installed app's widget registration down with it — the exact failure the
release was fixing, caused by the check for it. Both release scripts turned
out to have been leaving registered copies of unpacked zips behind on every
run, which is very likely where some of this cycle's earlier blank-widget
reports came from.

**Held back, deliberately:** committed while run #568 was still building
and pushed only afterwards, per the rule from 2.13.1.

## 2.13.5 (250) — 2026-08-29

Ran clean on the first attempt.

Changed the release cycle itself:

  - `docs/DISTRIBUTION.md`
  - `scripts/build-catalyst.sh`
  - `scripts/release.sh`
  - `scripts/verify-release.sh`

**Lesson:** the two phases added in 2.13.4 both fired for the first time
here, and both did what they were built for. "Installing it the way a user
does" installed the published cask, and reported the extension registered
*with the app never launched* — the exact property whose absence removed
every Mac user's widgets for three releases, now asserted on a real install
rather than reasoned about. Cleanup stopped the Gradle daemon and found
nothing else running. Neither line was reachable a release ago.

What is worth writing down is the shape of the night that produced them.
The bug that started it — a widget tap never reaching the journal — took
four wrong diagnoses before the right one, and every wrong one came from
treating an absence as evidence:

  - `pluginkit` empty ⇒ "the registration is broken". It was, sometimes,
    but not then.
  - the App Group missing a key ⇒ "every extension write is dropped". The
    reading was taken while the widget was frozen and nothing had run.
  - no log lines from the extension ⇒ "the intent never fires". `log` is a
    zsh builtin; the command had never run `/usr/bin/log` at all, and
    `2>/dev/null` hid the error. Hours of reasoning rested on that.
  - a tap producing nothing ⇒ "the button does not exist". The extension
    had been idle for seventeen minutes; the test was run against a dead
    widget.

The one that worked was the one with a control: plant a queue entry and
withhold the notification, then send it. Still queued at 10s, 20s, 30s;
drained within 6s. That is the difference between a measurement and an
observation — a measurement can come out the other way.

So the rule this release earns is narrower than "test more". It is that
**nothing-happened is not a reading until something-happened has been shown
on the same instrument.** Three of the four wrong turns above would have
been caught by one control run costing under a minute.


## 2.13.6 (251) — 2026-08-30

Took 2 aborted attempt(s) before it ran clean:

  - 1 an Xcode Cloud run is already in flight — let it finish, or it and the release build will kill each other
  - 1 missing release notes: en-US/changelogs/251.txt

Changed the release cycle itself:

  - `docs/DISTRIBUTION.md`
  - `scripts/release.sh`
  - `scripts/verify-release.sh`

**Lesson:** both aborted attempts were the cycle refusing to do something
wrong, and neither gate existed a day earlier. That is the whole return on
the CI work: a release that stops twice and then runs clean is cheaper than
one that runs first time and leaves a mess behind it.

The CI gate then did the thing it was built for, in the shape it was built
for. PHASE 4 could only print `⧗` — verification runs seconds after the tag
push, when GitHub has not started the run — and PHASE 6 waited and reported
`CI is green on the release commit`. First release in the project's history
where the cycle itself knew that.

What is worth writing down is what the release UNCOVERED rather than what it
cost. The install at 03:32 replaced the extension, chronod rebuilt every
timeline, and the widget extension burned 16 seconds of CPU and had a
resource report filed against it. That was the fifth such report on this
machine, spanning 2.10.1 to 2.13.6, and every one had been read as noise.

Chased the same afternoon, with an instrument and a control — extension
idle, 0.00s over 10s; launch the app to force one refresh, 10.46s in 13s —
it turned out to be three defects stacked on one another, none of which was
the button everyone suspected:

  - `Text("literal")` in a widget is a filesystem read. Every widget sets
    `.environment(\.locale, mihrabLocale())` so labels follow Mihrab's
    language rather than the system's, which takes SwiftUI off NSBundle's
    cached lookup and onto the localization-qualified one — re-reading and
    re-parsing 13 KB of `.strings`, per label, per render pass, and again
    per accessibility label.
  - the timeline built 60 archived entries under the comment "WidgetKit
    tolerates large timelines, but keep it bounded". It tolerates entries.
    The archive has a byte cap, and chronod had been saying so in plain
    words all along: `reload: failed with too large timeline archive
    11307528`. 11.3 MB, refused. A refused timeline is a card with nothing
    to draw, which is the blank widget and then the missing one.
  - `RefreshIntent.perform()` was `{ .result() }`.

The rule this release earns is about attention, not about SwiftUI. **Five
CPU-resource reports and sixteen "too large timeline archive" errors were
sitting in the logs the whole time, and the bug was chased for two days
through screenshots.** The failing subsystem was writing down what was wrong
with it, in English, unread. Before theorising about a symptom, read what
the system says about itself — `log show` and `/Library/Logs/Diagnostic-
Reports` before the first hypothesis, not after the fourth.

Note also the near-miss on the way to fixing it: the first attempt to
measure built with `SKIP_NOTARIZE=1` and installed that over
`/Applications`. Gatekeeper rejected it, chronod purged the descriptors, and
the developer's own widgets went — by hand, the exact failure the last three
releases were spent eliminating. Four minutes of build time is not worth
reproducing the bug you are trying to fix. A build that gets installed gets
notarized, even when it is only being measured.

## 2.13.7 (252) — 2026-08-30

Ran clean on the first attempt.

Changed the release cycle itself:

  - `.github/workflows/habous-cities.yml`
  - `.github/workflows/habous-dataset.yml`
  - `.github/workflows/habous-probe.yml`

(Those three are dataset plumbing rather than release plumbing. They count
as cycle changes only because "changed the cycle" is measured as "touched
`.github/workflows`", which is the cheap test and worth keeping — a false
positive costs one paragraph, and the alternative is a rule that has to
guess which workflows matter.)

**Lesson:** every gate this cycle has asks whether the release was BUILT
and SHIPPED correctly. None of them asks whether the app is right, and
2.13.7's headline fix was a case where nothing in the cycle could have
helped: the app had been asking AlAdhan for `2026-08-30` in a URL that
means `DD-MM-YYYY`, so it had been served times for 30-08-**2030** on
every request it ever made. Status 200, valid shape, plausible times. Tests
passed, CI was green, notarization succeeded, the release verified clean —
and the times were four years out.

What found it was comparing a stored day against an independent published
source, which happened only because a user in Morocco reported "off by
minutes" and the ministry's own tables were sitting there to check against.
That is not a gate and cannot be made into one for every provider. But it
is worth writing down what the shape of the miss was: a dependency that
answers confidently instead of erroring is invisible to every check that
looks for errors. The cheapest defence is an oracle — some second source
that was not derived from the first — and this project now has two of
them, Sweden's and Morocco's, both wired in as providers rather than as
tests. Using them as tests is the obvious next step and is not done.

## 2.13.8 (253) — 2026-09-01

Took 1 aborted attempt(s) before it ran clean:

  - 1 catalyst build failed — /tmp/release-catalyst.log

That line is misleading and the log should say so: the Catalyst build
succeeded. It was signed, the entitlements were sealed in, it smoke-launched
and found today's payload in the App Group. What failed was the submission
after all of that — `notarytool` could not resolve
`appstoreconnect.apple.com`:

    Error Domain=NSURLErrorDomain Code=-1003 "A server with the specified
    hostname could not be found." … Resolved 0 endpoints in 5004ms …
    interface: utun4

`utun4` is a VPN tunnel. DNS through it came back empty for five seconds,
notarytool gave up, and the script stopped. Four minutes later the same
name resolved to 23.49.109.248 and an identical re-run passed with nothing
changed.

**Lesson:** the first abort in this log that was not the cycle catching
something wrong with the release. It was the network, and the release was
fine — which is worth recording precisely because the log would otherwise
read as though every abort means a defect.

Two things to carry forward. First, this is the one rule paying off in its
least dramatic form: the failure landed in the DRY RUN, before the push,
the tag and the GitHub release, so the whole cost was one rebuild. An
irreversible step in the middle of the list would have made the same blip
expensive.

Second, and the actually useful part: `notarytool` failing to SUBMIT and
`notarytool` failing to NOTARIZE look alike at the top of the output and
mean opposite things — one is your network, the other is your build. The
error text is what separates them, and reading it before assuming the
build is broken saved re-signing something that was never wrong. If this
recurs, the fix is in the script rather than in the habit: retry the
submit on a resolution error rather than dying on it, the way
`fetchWithRetry` already treats a DNS failure as different from a refusal.

## 2.14.0 (254) — 2026-09-02

Took 1 aborted attempt(s) before it ran clean:

  - 1 catalyst build failed — /tmp/release-catalyst.log

Changed the release cycle itself:

  - `scripts/build-catalyst.sh`

The abort was not the build. Notarization came back **Accepted**, and
`stapler` then failed seconds later with error 73:

    Processing: .../Mihrab.app
    The staple and validate action failed! Error 73.

`stapler` does not read the verdict `notarytool` has just printed — it
fetches the ticket from Apple's CDN, and the ticket is published a little
after the submission is accepted. Asking too early gets an error that
looks exactly like a broken build, and the cost of finding that out was a
full rebuild and a second notarization.

**Lesson:** 2.13.8 ended by saying that a dependency failing because it is
not ready is not the same as one refusing, and that the fix belonged in
the script rather than in the habit. That was right, and it named the
wrong command: it said retry the SUBMIT, and the next transient landed one
step later, on the STAPLE. The specific command was the accidental part of
that lesson; the shape was the durable one.

So the retry went where it was actually needed — six attempts over two and
a half minutes — and the generalisation is worth carrying rather than the
instance. Every step of this release that talks to Apple can be early
rather than wrong: submit, staple, and the Xcode Cloud poll after it. Two
of the three now retry. The third has not failed yet, which is not the
same as being safe.

And the one rule paid again, in the same unglamorous way it did last time:
the failure landed in PHASE 2, so the whole cost of getting this wrong was
a rebuild — not a tag, a GitHub release and a cask pointing at a zip with
no ticket in it.

## 2.14.1 (255) — 2026-09-02

Took 4 aborted attempt(s) before it ran clean:

  - 2 catalyst build failed — /tmp/release-catalyst.log
  - 1 origin/main has commits main does not — pull first
  - 1 working tree has tracked changes — commit or stash them first

**Lesson:** Four aborts, and they were two different kinds. Two were the
script refusing to start — a dirty tree, and main behind origin — which
cost only the seconds it took to read them. That is the one rule working
exactly as written, and the right response to those is nothing at all.

The two Catalyst failures are the ones worth a note, because they landed
in PHASE 2 where the cost is a rebuild. The Mac build has a failure mode
that reads as a broken build and is not one: with no Apple ID signed into
Xcode, `xcodebuild` cannot generate a Mac Catalyst provisioning profile
for the widget extension and stops with "No profiles for
'maccatalyst.com.hassan.prayerapp.PrayerWidgetExtension'" — or, worse
because it looks unrelated, "No Accounts: Add a new account in Accounts
settings". Nothing about the tree is wrong when that happens.
`build-catalyst.sh` does not hit it, because it builds unsigned and signs
afterwards against the Developer ID and the embedded profile. So a
Catalyst abort during a release is worth checking against the script
BEFORE assuming the code broke: the same tree that fails a bare
`xcodebuild` builds and signs cleanly through the script.

The generalisation from 2.14.0 holds here too — the failure landed before
the irreversible line, so getting it wrong cost a rebuild rather than a
tag, a release and a cask pointing at nothing.

## 2.15.0 (259) — 2026-09-04

Took 1 aborted attempt(s) before it ran clean:

  - 1 an Xcode Cloud run is already in flight — let it finish, or it and the release build will kill each other

Changed the release cycle itself:

  - `scripts/sync-version.js`

**Lesson:** The journal's own "changed the release cycle" line named
`scripts/sync-version.js` and that was the warning, read too late. The
Swedish site page arrived this cycle, sync-version learned to stamp it,
and the list of files the release commit ADDS did not — so the stamp
happened on disk, the commit went out with a site saying 2.15.0 in
English and 2.14.4 in Swedish, and `siteVersion.test.ts` — which exists
for precisely that mismatch — went red on the release commit itself.
Local jest passed before the stamp and passed after it, because the file
was correct on disk the whole time; the only place the gap was visible
was CI, on a commit that was already tagged and published.

And it was worse than one missing file, which the first fix missed:
`npm run sync-version` is `sync-version.js && build-site.js`, and the cut
ran only the first of the two. So eleven GENERATED locale pages kept the
old version as well, and `build-site.js --check` failed on all of them.

Fixed at both ends rather than remembered. The stamp step now runs the
generator and re-checks it, and the Publishing step adds `docs/` whole
instead of naming the pages that happened to exist when the line was
typed — a list of filenames in a release script is a list that goes stale
the first time the site grows.

The cask also needed a hand. The script's own comment predicted it: the
cask's version is whatever SHIPPED last, not this repo's previous
version, and 2.14.4 never shipped to the Mac — so the version sed matched
nothing while the sha sed matched fine, leaving a cask on disk pointing
at the 2.14.3 URL with 2.15.0's checksum. It died before pushing that,
which is the gate working; the manual fix was one line. Worth doing
properly next time: sed the version by pattern rather than by the value
release.sh happens to think preceded it.

Xcode Cloud never got a build. Not a code failure — the account was out
of build minutes for the month, so #675, #676 and #677 all failed at
"Preparing build for App Store Connect" and the release went out with
Android, F-Droid and the Mac only. The iOS channel needs the workflow
rerun when the quota resets.

## 2.15.1 (260) — 2026-09-05

Took 2 aborted attempt(s) before it ran clean:

  - 1 CI on main last concluded 'failure' on "release.sh: revert the site whole, like the add does" — fix it before releasing on top of it: https://github.com/Hassan-PS/Mihrab/actions/runs/33981339332
  - 1 catalyst build failed — /tmp/release-catalyst.log

Changed the release cycle itself:

  - `scripts/release.sh`

**Lesson:** the same staleness, a third time, and then a fourth in the
test written to catch it. 2.15.0's list of files to ADD had gone stale;
this cycle found the list of files to REVERT had gone stale identically,
so a phase-2 failure left the Swedish page and the eleven generated ones
stamped and the next run refused to start on a dirty tree of thirteen
files it had written itself. Both are `docs` whole now.

The abort that cost the cycle was the fix's own CI.
`releasePublishStep.test.ts` asserted the revert string *contains*
`docs/index.html` — a test that pins a list of filenames, which goes
stale exactly the way the list does, and went red on the commit that
stopped naming files at all. The
release then refused to start on a red main, which is the preflight gate
doing its job on a failure the previous release taught it to look for.

So: when a release-script fix is "stop naming files, name the directory",
the test has to move in the same commit — and a check that asserts a
specific path inside a release script is the same bug as the path being
there. Assert the BEHAVIOUR (every file `sync-version` writes is covered)
rather than the spelling.

The catalyst abort was the ordinary one, unrelated and unremarkable.

## 2.16.0 (261) — 2026-09-05

Ran clean on the first attempt.

**Lesson:** none needed — clean run, no change to the cycle.

## 2.17.0 (262) — 2026-09-06

Took 2 aborted attempt(s) before it ran clean:

  - 1 missing release notes: en-US/changelogs/262.txt
  - 1 working tree has tracked changes — commit or stash them first

**Lesson:** _(unfilled)_
