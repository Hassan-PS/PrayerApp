# Changelog

All notable changes to this project are documented here. The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **A prayer the Live Activity changed for one occasion says so on the home screen, and offers the way back.** The card's button can put the upcoming prayer — or Sunrise, or a night mark — on a different alert for that one time. The row went on showing the standing setting regardless: silence Fajr from the lock screen at midnight, open the app, and it still said Adhan. The app held two answers about the same prayer and had no way to reconcile them. The row now shows what will actually happen at that time, with a line under the name naming the exception and undoing it — "Alert just this once · Reset". It follows the occurrence rather than the name, so an override set after Isha appears on tomorrow's card where that Fajr is, and never on the one that has already been and gone. Reset clears both halves — the app's and the card's — puts the prayer back on its standing setting, and the card's button drops its "· once" the moment it is pressed.
- **Today and the Log say which day it is, in both calendars.** The Hijri date was on the widget and nowhere in the app — issue #23. Today's card carries it under the countdown, and the tracker under the day it is logging, where the line above reads "Today" and says nothing about which day that is.
- **Al-Kahf and Al-Mulk have a door on the Qur'an page** — issue #23. The two surahs read on a schedule rather than looked up, reachable without scrolling eighteen and sixty-seven rows or typing a name that has four spellings in Latin letters.

### Changed
- **A silenced prayer no longer announces its Mālikī boundary.** The ikhtiyārī-window alerts were built from their own opt-in list and never asked what the prayer was set to, so someone who silenced Fajr to avoid being woken at 04:30 was woken at 05:00 instead by "Fajr's first time ends at 05:15" — an alert about the prayer they had just switched off, in the same sleep. Silence means no alarm is registered; the pre-prayer reminder already obeyed that and these now do too, both the lead-in and the end of the window. The two opt-ins pull opposite ways and the more specific one wins: turning a boundary alert on is a standing choice about a boundary, silencing a prayer is a choice about that prayer. This applies to the row's own setting and to the Live Activity's one-occurrence override alike — silencing tonight's Ishāʾ silences tonight's boundary and says nothing about tomorrow's.
- **The Live Activity's button is the home row's control now, for one prayer.** It said "Mute next adhan": two states, and the only thing it could say was "not the adhan". That was written before the five prayers had modes of their own, so it was answering a question the home screen had already answered — somebody whose Fajr was set to the plain alert was still offered a mute for an adhan that was never going to play, and somebody who wanted silence could not get it from the card at all. The button now starts from whatever that prayer is actually set to and cycles the same three, in the same order, with the same words: Adhan, Alert, Silent. Sunrise and the night marks get two of them; the call to prayer is not theirs to make. What has not changed is that it is temporary — it speaks for THIS Fajr and never for Fajr, it is gone the moment that time passes, and it never writes the standing setting. While one is live the button says so ("Alert · once"); cycle back to what the row was set to and the marker goes with it.
- **The practice graph on the Android widgets is a run of days, not a wall of weeks.** Seven rows of week-columns is the shape the in-app heatmap uses, and on a home screen it cost more than it returned: every day was a speck, and reaching the card's far edge took six months of them. The days run left to right now and wrap like text, ending on today, at a size where the fast ring and the sunnah mark on a square mean something. The rows follow the card: make it shorter and it loses a row rather than shrinking every day in it.
- **One line between the times and the graph, and the same line on both cards.** The streak had a row of its own with the number at 26sp, so the two widgets each spent three lines of small grey text on the band between their times and their graph — and the right-hand half of two of them said the same thing ("2 of 5 logged", "2 of 5 today"). It is one line now: what is next on the left, how the week has gone on the right, ruled off the same way and set at the same size on the prayer-times card and the Log card. Islamic Midnight and the Last Third moved above that rule, where they belong — they are times, and under the streak line they made the band two lines on one card and one on the other. The prayer-times widget is about forty points shorter for it, and the graph now appears from two launcher rows up rather than three.

### Fixed
- **Silencing a prayer from the Live Activity now silences its advance reminder too.** The 15-minute heads-up is a separate alert, and the card's button used to leave it standing until the app was next opened. Eventually is the problem: the case this control exists for is silencing an early Fajr the night before, and the phone then stays locked until morning — so the prayer was silent and the reminder went off fifteen minutes before it anyway, which is louder than doing nothing. It goes with the prayer now, and comes back with it.
- **Both writers of a prayer alert put it on the clock the same way.** The scheduler asks AlarmManager for the exact alarm type when the permission is granted and the inexact allow-while-idle type when it is not; the Live Activity's button passed a hand-written flag that asked for neither, so a prayer re-created from the card could be scheduled less punctually than the same prayer scheduled a minute earlier by the app. One trigger builder, in a module both can reach.
- **"Play adhan as an alarm" survives the Live Activity's button.** That setting is not a flag on a channel — a channel's sound and audio attributes are frozen when it is created, so the ringer-proof version is a separate channel — and the payload the card's button works from was resolving the ordinary one. Cycling a prayer back to the adhan from the lock screen re-created it on the stream a silenced phone silences, which is the exact thing the setting exists to prevent, undone by the control meant to be putting it back. The button also now checks the channel is actually there before posting to it: the alarm twin is created on the sync after the setting is turned on, and a notification posted to a channel that does not exist is dropped by Android with no error and no sound — a plain alert is the better failure, and the next resync restores the right one.
- **Pressing a Live Activity button no longer throws the card backwards.** The countdown walks itself onto the next prayer while the app is closed — that is the whole reason it can run for a day without being opened — but that walk lived only in the running service's memory. Both buttons rebuild the card from the payload on disk, which was whatever the app last wrote, so pressing one an hour after closing the app rebuilt a card for an event that had already passed: the wrong prayer's name over a countdown running backwards (`-40:19`), and the alert-mode button aiming at an instant nobody can be alerted at any more. It also gave the rescheduled alert the wrong prayer's name. The advance is written down now, from both places that make one — including the wake alarm, which in deep sleep is the only one that runs, and is therefore the case that mattered.
- **The graph reaches the edge of the card.** On a 4x4 it stopped about eighty pixels short of the right-hand edge that the divider and every line of text reach, which reads as a graph being clipped. The column count was derived from the card's HEIGHT — a number the widget can only estimate — and then drawn at a different cell size again, so the two shapes had no reason to agree. The cell comes from the width now, which the card does know, divided exactly among its columns; the height only decides how many rows fit.
- **An edge square is a whole square.** Every ring in the graph is drawn centred on a cell's boundary and today's reaches a whole stroke outside it, so on the first and last column the outer half fell off the bitmap: a flat left side and a hairline half the thickness of its neighbours'.
- **The times across the top of the prayer widget no longer run into each other.** They are declared with an auto-size that AppWidget hosts do not reliably honour, and the 12-hour clock in 2.15.0 made every one of them half again as wide — six of them collided. The size is measured against the column now and set explicitly, and the meridiem is set at 62% so the digits keep nearly the size the 24-hour clock has. The Log widget's times get the same treatment.
- **The alert bells on the Today card line up.** The control sits beside its time, and the time column was as wide as its own time — so on a 12-hour clock the one row with a two-digit hour ("11:09 PM") pushed its bell a digit to the left of the other six, and a column of controls read as a ragged edge. Every row is now sized by the widest time on the card. The dot that marks a prayer you aimed the countdown at holds its place on every row too, rather than nudging that one row's control aside.

## [2.15.1] — 2026-09-05

### Fixed
- **A prayer you have logged is no longer told it is late.** The second-time alerts were built from prayer times and nothing else, so someone who prayed ʿAṣr at 16:35 and recorded it was still told at 18:40 that ʿAṣr's preferred time had closed, and at sunset that ʿAṣr was now qaḍāʾ — the app contradicting its own journal, from data it was already holding. The schedule now skips a boundary whose prayer the journal has answered, keyed by the day the window belongs to rather than by "today", and logging a prayer drops what is already scheduled rather than waiting for the next resync. Where two prayers share one alert — Ẓuhr and ʿAṣr expire together at Maghrib, Maghrib and ʿIshāʾ at the next Fajr — logging one redraws the notification naming the other, instead of cancelling it and taking the other's warning away. A prayer recorded as missed counts as answered too. Reported in #23.

### Changed
- **The Moroccan timetable is refreshed** from the Ministry of Habous.

## [2.15.0] — 2026-09-04

Tilāwah: the Qur'an as something you put on. Plus the Mālikī second times answering what was actually asked for, morning and evening adhkār, and a 12-hour clock.

### Added
- **Tilāwah — listening, as its own page.** The reader already played audio, but only ever the passage in front of you, and only until that surah ended. Listening is a different act: put a recitation on in the car or at night with the screen off and it runs surah into surah, from the lock screen, without the app open or even alive. Pick a reciter, start anywhere, scrub by ayah or by surah, set a speed or a sleep timer, and follow along on a live preview of the muṣḥaf page with the recited word lit. Downloads share the reader's own folder, so a reciter fetched for a flight makes play-from-here work offline in the same act.
- **Morning and evening dua reminders.** In the windows the adhkār themselves name — after Fajr before sunrise, after ʿAṣr before sunset. There is no time to choose, deliberately: those windows move with the sun by hours over a year, so the app works the time out from the day's own prayer times instead of asking anyone to keep a clock preference in step with the seasons.
- **The Mālikī second times (ikhtiyārī / ḍarūrī), from *Al-Murshid al-Muʿīn*** — issue #19. Each prayer's preferred window and where it closes, computed on the device from your coordinates whichever source your times come from, with the two that are a model of a colour marked as approximate. Announce any of them, and — new — be told when a prayer becomes qaḍāʾ. Showing them and announcing them are separate decisions, because the reporter wanted the second without the first.
- **A 12-hour clock** — issue #18. Settings → Appearance → Time format: Automatic, 12-hour or 24-hour. Automatic follows the device's own switch; an explicit choice overrides both it and the app language. Every surface that prints a time follows it.
- **Each prayer decides how it speaks** — adhan, plain notification, or silent, a row at a time.
- **The player travels with you.** A bar under the title bar on every screen while something is playing: what it is, a progress bar for the surah, and a way to pause it or open Tilāwah without finding the tab again.

### Changed
- **Settings is an index of seven sections**, not twelve cards in one scroll, and each long page is split into sub-pages that carry their own explanations.
- **The remote next/previous move by surah.** A track is one ayah, so the lock screen, the media keys and a headphone button used to advance six seconds at a time — 286 of them to leave Al-Baqarah. They now do what the app's own big arrows do; the small pair still steps by ayah.
- **Titles are centred on both platforms.** Sub-pages and tabs alike, rather than centred on iOS and left on Android because nobody had said which.
- **The Moroccan timetable is refreshed** from the Ministry of Habous.
- **The player costs almost nothing while nobody is looking.** Position polling, the word-highlight probe and the page preview all stop when the app is backgrounded or the page is off screen; the JS thread went from 21% to below the measurable floor with audio playing in the background.

### Fixed
- **The home-screen widgets were cutting off their last line.** The prayer strip lost its next-prayer countdown and Log Today lost its footer, squeezed to a few points of half-drawn text on any phone whose launcher row is about 147dp — every 480dpi Pixel. The height budgets were measured before `widget_card_inset` gave every card a 6dp gutter, and nothing told them the layout had lost 12dp; they are host-view relative now, and each is a threshold and a budget at once so a variant can no longer be chosen on one number and filled from another.
- **The Mac shows what is playing.** `MPNowPlayingInfoCenter.playbackState` is optional on iOS and required on macOS, and the audio library never set it — so a Mac Catalyst build published a complete Control Center entry that macOS discarded: no panel, no media keys.
- **The keep-awake toggle holds the Mac's display awake.** It set the iOS idle timer, which macOS ignores; with the cup lit, `pmset` listed no assertion owned by Mihrab at all.
- **Cards no longer sit flush against each other** on the duas, fasting, backup, sync and Qur'an-download pages. The gap between them separated the scroll view's direct children, and since the reading column went in there has been exactly one of those.

## [2.14.3] — 2026-09-03

The muṣḥaf reads right: twenty pages had words drawn in the wrong face, lines were losing the bottom of their ink, and the page rail is rebuilt.

### Changed
- **The page rail on phones is rebuilt.** Dragging it no longer re-renders the muṣḥaf on every touch sample — the knob and a readout follow the finger, the reader peeks at a page once the finger rests on it, and the place is committed on release. Slide the finger up, away from the rail, to slow the scrub to half, a quarter and a tenth, so a single page out of 604 can be chosen on purpose; the readout names the surah, juz and page under the thumb and the speed it is in. The thirty ajzāʾ are marked on the rail, a touch on the knob picks it up without jumping, and the rail can be stepped a page at a time with a screen reader.

### Fixed
- **Twenty pages of the muṣḥaf were drawing words in the wrong face.** Pages 120–122, 145, 531–533, 564, 567, 569, 575, 583, 586, 588, 590, 592, 593 and 598–600 had fonts on the release cut short of the page: the words the font lacked came out in the system's Arabic face as rows of letter pairs — "له مج مح مخ" at the foot of Al-Qalam, an ayah of Al-Aʿlā turned to "هي يج يح يخ يم يى". The fonts are rebuilt from the layout the reader actually draws (so the two cannot disagree again), the app now checks every font it holds against a manifest of the release's sizes and quietly re-fetches the twenty on devices that already had them, and the release-upload script replaces a changed font instead of skipping it by name.
- **The bottom of a line is no longer cut off.** The page fonts' calligraphy reaches further below the baseline (and above it) than their metrics say, and both platforms keep only what falls inside a line's box; each line now has room for its ink, on every platform.
- **Turning the phone keeps the page.** On Android, rotating on a page past the middle of the muṣḥaf — page 589, say — could land the reader hundreds of pages back, and turning back kept it there: the scroll that re-anchors the page was executed before the pager had been laid out at the new width, clamped to the old strip, and then believed. A re-anchor the list did not honour is now issued again once the layout is there, and the pager no longer settles on an offset it was not sent to — on every platform, for the spread reader's rotations and window resizes too.

## [2.14.2] — 2026-09-03

The muṣḥaf, mostly: it opens faster, it follows the reciter, and it reaches the edges of the screen.

### Added
- **A tap on a word opens its ayah** — translation, tafsir, bookmark, recitation, khatmah position, all from the page itself. Fullscreen moved to the margins and the header strip.
- **A sepia page**, between paper and night.
- **The recited word lights up on the page**, and in landscape the column follows it down as the recitation goes.
- **Reading starts the moment the download does.** Pages arrive as their fonts do, with a slim line saying how the rest is going.
- **A page rail on phones**, so getting to juz 20 is not three hundred swipes.

### Fixed
- **The word highlight works on Android.** The timing file is fetched over a transport that works on every network, and a fetch that fails is retried instead of being believed for the life of the app.
- **The page reaches the bottom of the window.** The mini player was reserved twice, which left a band of nothing above it; and the Android navigation bar now takes the page's own colour, so a sepia or night page runs to the edge instead of stopping in a strip of app grey.
- **Turning the phone shows one page, not two.** The reader used to reveal the page waiting off-screen for the length of the rotation.
- **On iPhones with a Dynamic Island**, the surah name and the tone pill sit either side of the cutout instead of below it, and the ayah sheet clears it when the phone is on its side. An ayah can be selected in fullscreen at all.
- **Under Liquid Glass the tab bar has its icons back.**
- **The khatmah advances** when you set an ayah as its position or press the day's done button, not only when you read at its frontier.
- **Automatic location and saved locations are not alternatives** — you can keep the phone's location and still look up the places you saved.
- **The monthly sheet names the place** instead of printing coordinates.

## [2.10.1] — 2026-08-24

Sync could not accept the folder people were most likely to pick.

### Fixed
- **Choosing a Nextcloud folder — or any folder whose provider will not make a subfolder — no longer fails.** Mihrab asks for a `Mihrab` directory inside whatever you choose, purely to keep its file out of the way of yours. Plenty of providers refuse that while being perfectly happy to hold a file, and refusing the whole folder over it turned the most obvious choice — the synced folder you made for exactly this — into an error. It now writes into the folder you picked instead, and only stops you when nothing can be written there at all.
- **A folder you already named `Mihrab` is used as it is.** Choosing one made a `Mihrab` inside your `Mihrab`, so your sync client watched one folder while the app wrote to another one inside it — sync doing nothing, from a folder whose name said it should be working.
- **A folder that genuinely cannot be used says so in words.** The screen was showing the underlying failure verbatim: `java.io.FileNotFoundException: could not create a folder in there`, which names a Java class and tells nobody what to do. It now says which folders work.

## [2.10.0] — 2026-08-24

Your record on every device you own, without an account and without anyone else holding it.

### Added
- **Sync between your own devices.** Pair two devices by scanning a code — or by copying it, if the camera is not convenient — and from then on your journal, streaks, fasts, notes and settings stay in step. There is no account, no server of ours, and nothing to sign up for: the devices write sealed files into a folder you already keep in sync (Syncthing, a Nextcloud folder, whatever you use), and each one holds a key that never leaves it, so what passes through that folder is unreadable to everything but the devices you paired. Choose how often it runs — when the app opens, every fifteen minutes, hourly, daily, or not at all.
- **The Log Today widget grows up.** At its tallest it now carries the practice graph and a countdown to the next prayer, not just today's tally, and there is a picker entry for that size instead of leaving you to resize it and hope.
- **The prayer times widget in three sizes,** from a single row up. The one-row card drops its header rather than its times, so the thing you put it there for is the thing that survives.
- **Widgets speak the app's language.** All thirteen, on both platforms — and they follow the language *you* chose in the app, not the one the phone is set to, which is the whole point of choosing.
- **Seconds on the Home countdown, and a countdown you can aim.** Tap a prayer to count down to that one instead of the next.
- **Days you never filled in are marked as such** on the graph, instead of being drawn the same as days you deliberately left empty.

### Changed
- **The Quran download belongs to the app, not to the screen you started it from.** It keeps going when you leave the page or put the phone down, with a progress notification you can watch, and finishes on its own.
- **The app starts in the phone's language** until you pick one yourself. Previously it started in English and waited to be told.
- **On the Mac, the wordmark and the location share one bar** at the top of the window instead of taking a row each.

### Fixed
- **Manage downloads shows what is actually on the device.** It was reading the store the Quran reader stopped using in 2.8.0, so a device holding the entire mushaf — 179 MB of it — was told it had nothing downloaded and given no way to reclaim the space. Both stores are listed now, the current one and whatever an upgrade left behind.
- **The Fajr countdown is back in the Android widgets.** After the last prayer of the day the countdown had nothing left to count to, so it showed nothing at all — through the whole evening, which is when it was most likely to be looked at.
- **The widget picker previews are the cards you will actually get,** at every size, rather than a drawing that stopped matching them several releases ago.
- **The practice graph appears at the size that has room for it** and nowhere else; the smaller cards fill their space with what fits instead.
- **The practice grid in the widget scores a day the way the app does.** It had its own rules, so the same day could be a darker square in the widget than in the app.
- **Five of the Android widgets ignored the appearance settings** — the accent, the OLED background, the highlight — and had no way to reach them.
- **Four languages were naming prayers after meals or after strangers.** Those names are now the ones people actually use.
- **On the Mac, sync works on the Homebrew build.** Secure storage had nowhere to keep the device's identity, so it could not stay paired; it has a Keychain now. And the Mac introduced itself to every other device as "iPad", because that is what macOS answers when a Catalyst app asks for the device name.

## [2.9.1] — 2026-08-21

The widgets tell the truth again — including while the app is closed.

### Fixed
- **Widgets update without the app open.** The home-screen cards were only ever written while a particular screen was on the phone, so a prayer logged from a notification, a tasbih counted on the widget itself, or simply a new day arriving could leave every card sitting on old numbers until you next opened the app on that screen. The cards are now written from the app's own records, whatever you happen to be looking at, and every one of them is refreshed together.
- **A widget with nothing left to show asks to be opened instead of pretending.** When a card ran past the end of the times it was carrying it kept redrawing the last day it knew under today's date. It now says so plainly and asks you to open the app, which is the one thing that fixes it.
- **The practice graph in the widget is the same calendar as the one in the app.** It was filling squares in the order the days arrived rather than by their date, so a gap in your record shifted everything after it by a day. Weeks start on Monday now, in the widget and on the Mac, exactly as they do in the app, and days that have not happened yet are drawn as empty rather than as missed.
- **Nothing is drawn outside the card any more.** The streak widget's graph spilled over the edge of its own background at some sizes, and the count of prayers left to make up was pushed off the end of the line at the size most people use. Both are measured against the space the card actually has.
- **On iPhone and iPad, one unfamiliar value no longer empties every widget.** All six cards shared a single reader that gave up entirely the moment it met something it did not expect; a card now keeps everything it could read and only leaves out the part it could not.
- **The widget picker shows each widget at the size it will be**, rather than two of them cropped to a box that was the wrong shape.
- **Widgets survive a restore to a new phone.** A backup could carry another device's pending taps and a stale set of times across with it; those are now left behind where they belong.

## [2.9.0] — 2026-08-19

Sunnah prayers, your own adhan, and an app that finally reaches the edges of the screen.

### Added
- **The sunnah prayers.** The rawatib around each fard, logged beside it rather than instead of it: a prayer row now carries the fard and the sunnah that belongs with it, and the graph draws the sunnah as a line around the day's square instead of spending another colour on it. Only the ones whose time has actually come are offered, so Isha's sunnah is not asking to be logged at noon. "Log with sunnah" is on the notification too, for the times you answer the alert instead of the app.
- **Your own adhan.** Pick any audio file on the phone and every prayer alert plays it. On iPhone the notification plays the first thirty seconds — Apple's limit, not ours — and the full recording plays when the app is open. The seventeen bundled adhans are all still there; this is an eighteenth row in the same list, with the file's name under it so you can see which one you chose.
- **Export and import your whole record.** The old export carried settings only, which meant a new phone got your calculation method and none of your prayers. It is now the journal, the streaks, the fasts and the notes as well, in one file you can keep or move.
- **The best streak, beside the current one.** A number that only ever goes down is discouraging by construction; the record you have already set stays on the screen next to it.
- **Four stat tiles above the graph,** and a mode inside it that shows only what you owe — the days carrying a prayer you meant to make up later, which were previously buried in a green square.

### Changed
- **The app draws to the edges of the screen.** Android has been enforcing this on new phones for a while and will stop offering the opt-out entirely; the app now does it everywhere, on purpose, instead of behaving one way on new devices and another on old ones. The tab bar floats over the page again, slightly see-through, so a list sliding underneath it tells you there is more to read without spending a line saying so.
- **The system navigation bar and the app's own bar are one piece.** Behind the three-button navigation the band now matches the tab bar's material rather than being a solid slab, and on older Android it looks like it does on new Android.
- **Every prayer row speaks one language.** The controls on a row had drifted into three different ways of saying the same thing depending on where you tapped.
- **The practice graph's colours are a real scale.** The five shades were picked by eye and two of them were nearly the same; they are now an even ramp, so four prayers and five look as different as one and two.
- The tip jar is gone, everywhere.

### Fixed
- **The streak no longer reads zero every morning.** It counted today as a broken day from midnight until the first prayer went in, so the number you woke up to was wrong every single day.
- **The graph opens on today, in every language.** In Arabic, Urdu, Persian and Hebrew it could open on an unrelated month and make you scroll back — and dragging towards this week was read as reaching for more history, which then shoved the view sideways.
- **Nothing sits under the navigation bar any more.** The last row of every picker in Settings — the language list, the alert sounds, the calculation methods — was half under the system navigation bar and could not be tapped. On Android the buttons were being drawn over the app, because the bar reports itself as half the height it actually paints.
- **"System" appearance follows the system.** The app asked a copy of the setting that can lag behind, and a light/dark switch that happened while the app was in the background could leave it on yesterday's answer.
- **The widget stops going blank** when its schedule runs out — it now carries a month of prayer times instead of a few days.
- **871 strings that were still English** in the other twelve languages are translated.
- On Mac, the location chip sits in the column with the cards instead of floating over them.

## [2.8.10] — 2026-08-14

Words were going missing from the mushaf. They are back.

### Fixed
- **The mushaf was dropping the last word of some lines.** A reader wrote in about Surat An-Nisa and was right, and it was not only An-Nisa: about one line in eight, on nearly every page. The text and the fonts were never wrong — the renderer asked the phone to set those lines a little tighter than the space character it draws the gaps with, and on some devices the request was ignored, so the line came out wider than the page it had been measured for and the phone quietly cut the last word off the end of it. The gap is now made narrow instead of asked to shrink, which no device can decline. Every line of all 604 pages is checked against this on every build.
- **The graph scrolls the right way round in Arabic, Urdu, Persian and Hebrew.** It opened parked on the oldest week you have instead of on today, dragging towards this week was read as reaching for more history, and the history that arrived shoved the view sideways. Right-to-left now gets the mirror of the left-to-right behaviour rather than the reverse of it.
- **Quran files left behind by an update are cleared out.** Up to 120 MB of page images from the reader replaced in 2.8.0 could sit on the phone indefinitely if you had ever opened the reader and declined the download. They are swept at launch now. The page fonts also record which release they came from, so a corrected font reaches everyone instead of only new installs.

## [2.8.9] — 2026-08-14

The Log, made to work the way people were already trying to use it.

### Added
- **The Log opens by swiping, not only by the arrows.** The day panel is one card you can throw sideways; the arrows stay for one day at a time. Forward still stops at today — the card rubber-bands rather than refusing silently, so the gesture is visibly received and visibly declined. Arabic and the other right-to-left languages mirror it, as the arrows either side of the date already do.
- **"Fill in earlier days" and "Fill the past three months".** Someone who has prayed for years and installed the app on Tuesday met a wall of empty squares that was wrong about them. The first button fills from the day the app was installed up to yesterday; the second reaches further back, and pays for that reach by only ever writing to days holding nothing at all — no status, no note, no fast. Both ask first, and the question shows the exact number of days, the exact range, and how many days are being left untouched. Today is never filled: it still holds prayers that have not happened.
- **A day that owes a prayer is marked on the graph.** `missed` is how people note that a prayer will be made up later, which makes the day a to-do — and a to-do you cannot find is not one. A day of four on time and one missed used to draw a strong green square with no sign of the missed one in it. It now carries a dot in the corner, and screen readers are told as well.

### Fixed
- **The "Log prayer" button on a prayer notification actually logs the prayer.** It had been on every alert for three versions and wrote nothing: the only code listening for it lived on the Log screen, and someone pressing a button on a notification is not looking at the Log screen. With the app closed it did nothing at all. It now records the prayer from the background, and the alert carries the day it is for — so an Isha answered after midnight credits the evening it belonged to instead of blanking it. Pressing it twice cannot overwrite a status you set deliberately.
- **The evening prompt no longer asks about a day you have already finished logging.** It is retired the moment the fifth prayer goes in, and days already complete are skipped when the week is scheduled.
- **The graph scrolls on the first try, and on the Today screen at all.** The first drag used to be yanked sideways by the journal finishing loading underneath it. On Home the graph could not be scrolled at all — the card had become one large button, and a press target wrapped around a scrolling grid fights it for every gesture. The button is now a row at the foot of the card, and that graph reaches back through your history like the one on the Log.
- **The graph fills the width with history.** When it is narrower than the space it has, the weeks used to hug one edge with a gap after them; they now sit against the edge today is on, so the visible width carries as much past as exists.
- **The Today screen lists only what you have actually logged.** It used to read "0 of 5 prayers logged · No fast recorded · 0 dhikr sets completed" at seven in the morning — a list of the day's failures compiled before the day had begun.

### Changed
- The two switches on the Log moved below the prayers they are about, rather than sitting between the date and the day's rows. The cards on that page have space between them again.

## [2.8.8] — 2026-08-07

A Mac-only release. Nothing on Android or iOS changes.

### Added
- **The Mac app installed with Homebrew has the widget.** The prayer-times widget can be placed in Notification Centre, showing the same day's times as the iPhone one — small, medium and large. It reads the times the app has already worked out, so it costs nothing and keeps working offline; open the app once after installing and the widget fills in. Live Activities stay iOS-only, because macOS has nothing to show them on.

### Fixed
- **The Homebrew build no longer claims a Keychain group it cannot use.** Claiming it did not degrade quietly — macOS refused to start the app at all, before any of its own code ran. On this channel the journal, the fasting log and your coordinates continue to be stored the way they were before, which is the same as every previous Homebrew build; the App Store and Play builds are unaffected and still use the Keychain.

## [2.8.7] — 2026-08-03

### Added
- **The Log opens any day you have ever logged, not just today.** Arrows either side of the date step a day at a time, and every square in the practice graph is now a button that opens the day behind it — so a day months back is one tap, not a hundred. Everything on the screen follows: the four statuses, the private note, the fast, "Mark all on time". It writes to the day you are looking at, and it stops at today, because a log of the future is a plan. The prayer times shown next to each name are that day's, read back out of the local cache and put through your own per-prayer offsets; a day older than the cache simply shows no times rather than the wrong ones. A fast back-filled inside Ramadan is still recorded as a Ramadan fast, not a voluntary one.
- **The practice graph reaches the first day you ever logged, and scrolls.** It was thirteen fixed weeks, defended at the time on the grounds that a hard month should scroll out of view rather than stand as a monument — which protected you from your own record and took the record with it. A year in, every square earned before April was simply gone. The grid now runs from the Monday of your earliest entry to this week, with a month name over each column that opens one (and the year on every January), and it opens parked on today so the default view is still the recent one. Fasts count towards the span as well as prayers, so a Ramadan logged before you ever used the journal still pulls the graph back to itself.

- **The graph on Home, behind a switch.** Off by default — Home answers "when do I pray next", not "how has the month gone". The switch is on the Log tab next to the graph and in Settings → Appearance. The copy on Home is a picture, not a control: no day selection, no legend.

### Fixed
- **The graph now shows what you actually logged.** Depth came from the NUMBER of entries, so a day marked missed five times drew the darkest green on the chart — the app congratulating you for a day you had just told it went badly. It is now weighted by status: on time counts fully, late and make-up count for less but still count (flattening them to zero would tell a traveller who made up Dhuhr on the road that the day was a write-off), and missed counts for nothing. A day that was recorded but kept nothing is marked in a colour that is not the colour of success, rather than left as blank paper — blank is for days nobody opened the app on, and losing that difference loses the point of logging a bad day at all.
- **The graph updates on the tap, not on the disk write.** Every screen used to wait for the encrypted journal to finish writing before any of them saw the change, which on a journal with a year in it is long enough to sit and watch. The value is now published to every screen the moment it is entered, with the write carrying on behind it and putting the old value back if it fails.
- **A prayer whose time has not come cannot be logged.** Its four buttons are greyed out until the adhan time passes, and they open themselves the minute it does rather than waiting for the next launch. "Mark all on time" obeys the same rule instead of being the loophole around it — a button that quietly wrote "on time" against an Isha four hours away would put a claim in your own record that you never made. A prayer that somehow already carries an entry stays editable, so nothing gets trapped behind a dead row.
- **The graph scrolls back as far as you want to go.** It reached the first day you had logged and stopped, so the months the arrows could walk into were not on the chart at all. It now also covers whichever day you have open, and dragging to the oldest column loads another half-year — repeatedly, with the dates under your thumb staying where they are instead of lurching forward as the new columns arrive.

### Changed
- **F-Droid.** Mihrab is in the F-Droid repository — the recipe merged upstream on 1 August. The website and the README carry a "Get it on F-Droid" button pointing at the listing, and the merge-request link they used to track is gone from both.

## [2.8.6] — 2026-08-02

Two things the 2.8.5 design pass got wrong on real devices.

### Fixed
- **The tab bar's labels were cut off the bottom of the screen.** On an iPhone they were gone entirely; on Android they sat on the gesture handle. The bar sets its own height, and a tab navigator that is given a height returns exactly that — it stops reserving the safe area underneath, which the pill's bottom offset had been written to subtract from. Subtracting an inset nobody reserved hung the bar ten to twenty points off the bottom edge. The offset is now the whole gap and nothing is taken away from it: the pill tucks inside a home-indicator strip, which is a handle it only has to clear, and sits fully above a three-button navigation bar, which is real chrome. A test pins it, because this is a fault that no build log reports and every screenshot of the top of the app hides.
- **Home fits an iPad without scrolling.** The day card — countdown, week strip, six times, month link — is the tallest thing on the screen and uses almost the whole window on its own, so the Quran card stacked beneath it fell off the bottom: the one card on Home you are meant to act on was the one you had to go looking for. It now sits at the top of the side column, which was half empty. The foot of the page also carried a safe-area inset a second time, under a bar that had already spent it, and that dead air is gone everywhere.

## [2.8.5] — 2026-08-02

A design pass over the whole app, and the mushaf finally works in Arabic.

### Added
- **Six tabs across the bottom.** Today, Quran, Tasbih, Duas, Log, Settings. "More" is gone — a More tab is an admission the deciding was never finished, and with Find a masjid removed and Month folded into Settings there was nothing left for it to hold. Tasbih and Duas are separate now: one is a counter you tap fifty times, the other is a library you read, and bundling them saved a tab at the cost of ever finding either. On a phone the bar is a floating pill and the page runs underneath it, so a list that would otherwise stop dead at a solid edge tells you there is more below.
- **A page rail in the mushaf, on every device.** Six hundred and four pages is too many for a pair of chevrons — reaching juz 20 by tapping ‹ three hundred times is not navigation. Drag the rail and it ticks once per surah, not once per page: pages are two-per-pixel on a phone and would be a continuous buzz carrying nothing, while surahs are what people actually navigate by, and their uneven spacing is the signal. Al-Baqarah is forty-eight pages of silence; the last juz is a tick every few millimetres. Drag slowly and each boundary lands firmly enough to stop on; sweep and the ticks go light, because a firm knock twenty times a second is just a vibration. The surah under your thumb is named while you drag. Next to the rail, and on the Quran screen itself, a button to type a page number.
- **An end-of-day reminder that logs the day in one tap.** Ten minutes after Isha, optionally, a notification asks whether the day's five prayers went as planned; one button answers it without opening the app. It carries the date it was scheduled for, so the prompt you slept through and answered the next morning still logs the right night — which is the entire point, given Isha in a Swedish summer lands near midnight. It only fills prayers you haven't already recorded: a day where you marked Asr as missed keeps that record. Off by default; the switch is on the Log screen and in Settings.
- **The mushaf on iPad and Mac gets an index beside the page.** Surahs, juz and bookmarks in a sidebar, searchable by name or page number, with the page you are reading marked and the khatmah pinned at the foot. Facing pages are paired the way the print pairs them.
- **Al-Ajmi, and thirty more reciters.** Ahmed Al-Ajmi was in the catalogue all along, but the picker matched on a raw substring — so "alajami", the spelling most people type, found nothing and he read as missing. Search now folds case, punctuation, the al-/el- article and Arabic harakat, and checks a list of alternate spellings per reciter. The list is alphabetical.

### Changed
- **The Today screen is one card instead of four.** It used to be a hero, a table, a Quran bar and a tile row — four shadowed slabs on warm paper, so nothing grouped "today" apart from "tools" and the eye re-entered four times. The countdown is now the headline it should always have been (you roughly know when Dhuhr is; what you opened the app for is how long you have got), the seven-day strip is visible rather than hidden behind six-pixel dots, and the Quran card states where you actually are — continue reading, khatmah progress, or today's ayah — instead of a button labelled "Open the Quran" carrying no information at all.
- **Tasbih answers back.** The counter was a four-hundred-point white void with a number in it: no hint that it was the tap target, and nothing given back when you tapped. The count now sits inside a ring that fills, the ring is the tap target and says so, and the dhikr's meaning sits under the Arabic instead of a second Latin spelling of the same words. Reset is a text link rather than a third identical button, one of which destroyed your count. "Set 2 of 6" and a peek at what comes next turn six disconnected screens into one sequence.
- **Prayers, fasting and the practice graph share one screen.** The Log tab: thirteen weeks of history, the day's five prayers with a private note each, and the fast.
- **A single tap in the mushaf clears the chrome.** It used to open the ayah panel if the tap happened to land on a word, which is most of the page — so a reader trying to get the chrome out of the way was interrupted by a sheet instead. Tafsir, "play from here", repeat and share are a long press on the ayah now.
- **Sizes on the Mac follow the Mac.** Catalyst scales the whole canvas down for a desktop, and type designed for a tablet held at thirty centimetres was arriving on a display sitting at seventy. The tab bar, the navigation title and the Quran sidebar are sized for the distance they are read from.

### Fixed
- **The mushaf was blank in Arabic.** Only in Arabic — Swedish and English were fine, which is what made it look like a rendering fault rather than a layout one. An app running right-to-left measures a horizontal pager's scroll offset from the right, and the pager's own arithmetic counted from the left, so it opened parked six hundred pages past the end. Every page was laid out correctly and painted where nobody could see it. Right-to-left page turning was never the pager's job in the first place — that is the mushaf's own reading order, and it was already handled.
- **The mushaf can be read in landscape, and no longer disappears upside down.** Rotation is allowed in the reader; the accidental fourth orientation, which drew nothing at all, is not.
- **The Arabic weekday initials were unreadable.** Cutting each name to three letters gave الأحد and الأربعاء the same stub.
- **Twenty-seven strings showed English to everyone but English readers** — including "CHOOSE" in the middle of an Arabic screen. They are translated into all thirteen languages, and a test now fails if a new one appears.
- **Today's ayah is the same ayah everywhere.** The Quran screen and the notification each drew their own.
- **The Quran sidebar no longer sits under the window controls, or over the page.** On the Mac its tabs were behind the close/minimise/zoom buttons; on iPad the pages were sized to the whole window while the sidebar took a fifth of it, so the left-hand page of every spread ran underneath and was clipped mid-line.
- **The Duas screen wasted a header's worth of space at the top.** It reserved room for a transparent navigation bar it stopped having when it became a tab, so the header was counted twice. Tasbih had the same.

## [2.8.3] — 2026-07-31

### Changed
- **Downloading the mushaf is about five times faster.** Every page's typeface was being fetched three times over: the transport that writes straight to disk fails outright on some networks, so each file spent two doomed attempts and nearly a second asleep before falling back to the slower path that works. Across 604 files that is over a thousand pointless requests and nine minutes of waiting, in bursts that made the progress bar look frozen. The fallback existed all along — nothing remembered it. Now one failure is enough to learn from for the rest of the download.
- **A surah opens the way it does in the print.** It used to just start: the name sat in a plain rounded box the width of the name, and the basmalah under it was small grey text. In the Madinah mushaf a surah opens with a band — a rectangle ruled twice, ornament worked into the course between the rules, a rosette closing each end, and the name written in the middle across the whole text block. That is what you get now, drawn rather than traced: the printed illumination is gold and lapis across a wide field, and a bad imitation of it at the height of one line of text is worse than none. The basmalah is set at the page's own size in the page's own ink, with the same eight-pointed seal at a quarter of the size on either side.
- **The mushaf asks before it downloads, and clears out what it replaces.** Opening the Quran now shows a plain "Download mushaf" and nothing else until it is on your device — on a fresh install and after an update alike, so nobody finds 180 MB on their bill because they opened a page. Pressing Download also removes the older copy of the mushaf that an updated app is still carrying from before 2.8.0, which nothing reads any more; the screen tells you how big it is before removing it. Downloading it once means a page never pauses to fetch its own typeface again.
- **The mushaf is lighter to read.** Going in and out of fullscreen used to lay every page on screen out four times over — once for each stage of the chrome getting out of the way, and again because a tap handler was rebuilt on every render of the screen and carried all the way down to each of a page's fifteen lines, so nothing could be reused. Each of those passes re-derived a page's ~260 drawn pieces, justified every line and re-shaped every paragraph, and three of the four were thrown away before anything was ever drawn at that size. A page is now laid out once per toggle, at the size it actually ends up. Nothing on the page changed: same text, same justification, same taps.

### Fixed
- **The Quran's buttons work again after reading in fullscreen landscape.** Leave the reader after it had been fullscreen and turned, and the surah list and the button that opens the Quran looked completely normal and did nothing at all. 2.8.2 claimed this was fixed; it was not — that release closed a leftover menu window, which was a real problem but not this one. The cause was underneath the app: when the screen turns, every screen in the stack is asked to report its position again, but the ones sitting in the background behind the reader are not on screen to answer, and nothing asked them again afterwards. They went on being drawn in the right place while the part of the app that decides whether a touch is a press believed they sat a header's height lower. A perfectly still touch is never re-checked against that position and still worked, which is why a test tap always succeeded and a finger — which always moves a little — never did. Background screens now report their position again once the screen has turned.
- **The reader's title is readable on a night page on iPhone and iPad.** The header there is transparent and sits over the page, and its title was painted in the app theme's text colour — so a light app theme reading a night page put near-black lettering over a near-black page. The title, the back arrow and the blur now follow the colour of the page rather than the theme.

## [2.8.2] — 2026-07-31

### Fixed
- **The mushaf's lines are the print's lines again.** Every line was losing its last word. The page fonts carry no space character, so the gap between two words was being drawn by whichever system typeface the phone happened to fall back on — at a width the app had never measured, and a different one on Android than on iPhone. Lines came out wider than the box they were sized for, and the word that no longer fitted was simply dropped: `مَّقْبُوضَةٌۭ` off the first line of page 49, `ٱلسَّمَٰوَٰتِ` off the fourth. The gap is now drawn in a typeface the app ships and whose measurements it knows, so a line is exactly as wide as it was planned to be, on every device. Justification then works the way the print does — the space between words opens or closes to fill the measure, within a fixed band, and a line that cannot reach the measure honestly is centred rather than pulled apart. The previous release's attempt at this could not have worked: it scaled each line after the layout was already decided, which cannot recover a word the layout had thrown away.
- **A word in the wrong place in ayah 2:2.** The verse rendered as `لَا ۛ فِيهِ ۛ رَيْبَ` instead of `لَا رَيْبَ ۛ فِيهِ ۛ`, and the ۞ marks throughout the mushaf sat one word later than they should. Direction-override marks had been placed around words of more than one glyph but not around single glyphs, which left the single ones to be reordered. The page data is already in reading order, so the overrides were the error — they are gone, and the text reads as it is printed.
- **A menu left open when you leave the reader no longer swallows taps.** Closing the reader while the ayah menu was open tore that menu down without ever hiding it, and the leftover window went on absorbing every tap. Anything open is now closed before the screen goes. *(This was originally written up as the fix for the surah list and the home screen's Quran button going dead. That was wrong — those had a different cause, which is fixed in the next release.)*
- **The page reaches the edge of the screen.** A strip of the app's background showed along the edge of the mushaf, and nothing allowed for the camera cut-out on the side where it sits. The page now runs to all four edges, and its text keeps clear of the cut-out without moving off centre.
- **The reader's title follows the page you are on.** It kept naming the surah you opened at, however far you read past it.
- **Revisiting the Quran no longer wears the reader out.** Each visit held on to one of a limited set of font slots without giving it back; after roughly two dozen visits every page rendered blank until the app was restarted.

## [2.8.1] — 2026-07-31

### Changed
- **Mushaf lines run edge to edge again.** Each line was drawn at its natural width, so the page ended with a ragged margin where the print has a straight one. Lines are now fitted to a single, consistent measure — by a margin small enough that the letterforms are unchanged to the eye. A line that would have to stretch further than that is left as it is rather than distorted, and the last line of a surah still stops where the text stops.
- **The opening pages are bigger.** Pages 1 and 2 carry only seven or eight lines in the space a normal page gives fifteen, so they now use a wider block and the text is correspondingly larger.

## [2.8.0] — 2026-07-31

### Changed
- **The mushaf is drawn as text now, not as pictures of pages.** Every page renders from its own official KFGQPC page font — one glyph per word — instead of a 2600-pixel image. It is sharp at any zoom because there is no resolution to run out of, a page on screen costs a fraction of the memory, and rotating is a re-layout rather than a re-decode. The reader also opens straight away: a page needs only its own ~300 KB font, so the 120 MB up-front download is no longer a gate — pages arrive as you read, and the ones either side are fetched ahead of you. Page-for-page and line-for-line identical to the printed Madinah mushaf, as before. The old page-image reader stays selectable for one release.
- **The reader is split by device.** Phones get one view that serves portrait and landscape without remounting between them, so rotating keeps your page and repaints immediately. iPads and Macs get a facing-page spread where the pair itself is the unit that turns.

### Fixed
- **Turning pages in landscape no longer skips one.** Landscape used a page strip whose offsets were measured from a moving anchor, so a turn could land a page off.

## [2.7.43] — 2026-07-30

### Fixed
- **Rotating the mushaf on a phone is fast and stable again.** The landscape reading zoom sized every page it kept in memory to the full screen width, which pushed the page images past the size where the app keeps its sharpened copies — so each rotation decoded three full-resolution pages at once (~130 MB). That made rotating slow and, on tighter devices, crashed the app. Now only the page you're reading is zoomed (the ones queued either side stay at portrait size), the zoom is capped to what the sharpening cache can serve, and rotation reuses the copy from the previous orientation instead of falling back to the full-resolution original. Same zoom on screen, a fraction of the memory.

## [2.7.42] — 2026-07-30

### Changed
- **Two unused permissions removed (Android).** `WRITE_EXTERNAL_STORAGE` and `READ_EXTERNAL_STORAGE` came in from a networking library's manifest; Mihrab only ever writes to its own app-private storage (mushaf pages, caches, recitation audio), so both are now stripped from the merged manifest. Raised in the F-Droid review.
- **Store listing rewritten** to match the app as it is today — including an explicit note on what is optional and online (prayer-time providers, OpenStreetMap Nominatim place search, Quran downloads) and what stays on device.

### Fixed
- **macOS menu bar says "Mihrab"**, not "PrayerApp" — macOS reads a different bundle key than the iOS home screen, and that one still carried the Xcode target name.

## [2.7.41] — 2026-07-29

### Fixed
- **Landscape reading on phones.** Turning a phone sideways in the mushaf no longer opens a cramped iPad-style two-page spread (tall phones are wide enough in landscape to have triggered it) — and on some phones that spread failed to draw at all, leaving a blank page. Landscape now shows ONE page zoomed to the full width and scrolled vertically, with every gesture intact: tap for fullscreen, long-press an ayah for the actions sheet, swipe to turn the page.
- **Full Arabic surah names in the Quran list.** Two-word names ("آل عمران") were wrapping at the space on narrow rows and losing the second word — Aal-i-Imran showed only "آل".
- **Settings gear on macOS.** The location chip and Settings button sat inside the window's title-bar drag region, so clicks were sometimes swallowed as window drags ("works sometimes, sometimes doesn't"). They now sit just below it and respond every time.

## [2.7.40] — 2026-07-27

### Added
- **One choice for what appears under each verse.** Translation and tafsir are now a single app-wide preference: pick the mode (translation ⇄ tafsir) and the edition once, and it applies everywhere a verse is shown — the reader (both view modes, including tafsir under each ayah in the translation view), the verse of the day, the verse action sheet, and the daily-ayah notification. The selector lives in a new "Under each verse" card on the Quran page, in the reader header, and in Settings — all in sync. Editions are grouped by language (Arabic and English first), every shipped translation and tafsir is offered regardless of app language, and picking one applies it in a single tap.
- **Battery-optimization warning (Android).** When Android's battery optimization is restricting Mihrab — which can delay or silence adhan alerts, especially after turning the Live Activity off — Settings → Notifications shows a fix-it row that jumps straight to the system exclusion screen.

### Fixed
- **Adhan alerts no longer stop after a couple of days without opening the app.** Alerts were only scheduled for today and tomorrow, so if the app wasn't opened for 2+ days every alarm silently lapsed — the Live Activity's background service used to mask this by keeping the app active, which is why turning it off could "kill" the adhan. Alerts now cover four cached days.
- **Tools grid no longer collapses to two narrow columns on some phones.** On devices whose screen width lands on a fractional dp value (e.g. 440 dpi), a sub-pixel rounding overflow wrapped the third tile; the grid now rounds down and uses native gutters, so rows always fill.
- **al-Muyassar is a tafsir, not a translation.** It no longer appears in the translation list (it remains available as a tafsir); an old stored pick falls back cleanly.
- **Cross-language edition picks now stick.** Choosing a translation or tafsir in a different language than the app UI no longer silently reverts to the default.

## [2.7.39] — 2026-07-16

### Fixed
- **Home spacing regression (all platforms, since 2.7.36)**: the centering wrapper collapsed the Home cards into one container, disabling the 12pt inter-card gap — most visibly the day-carousel page dots overlapping the day table and the "Open the Quran" button. Rhythm restored on phones, iPad (portrait + landscape), and Mac.
- **Tools grid on phones back to 3 columns** — the auto-flow grid crammed four undersized tiles per row on common phone widths.

### Changed
- **Play Console recommendations (Android)**: the widget configure screen no longer locks to portrait (Android 16 ignores such locks on large screens); resource shrinking enabled for the Play flavor (AAB ~2.7 MB smaller) with ABI splits gated off during bundling to dodge AGP's shrunk-resources bundling bug. The remaining flagged items (edge-to-edge Window color APIs, Fresco decode paths) live inside React Native/Fresco internals and await upstream releases.

## [2.7.38] — 2026-07-16

### Added
- **Mihrab for Mac via Homebrew** (`brew install --cask hassan-ps/tap/mihrab`). The iPad app now also builds as a real macOS app with Mac Catalyst — same feature set as the App Store "Designed for iPad" experience (widgets/Live Activity stay iOS-only on both). Every release now ships a `Mihrab-macOS-<version>.zip` built by `scripts/build-catalyst.sh`; the cask lives in the `Hassan-PS/homebrew-tap` repo. Ad-hoc signed until Developer ID signing + notarization are wired in (first launch may need right-click → Open).

### Changed
- **Desktop zoom & alignment**: past the width cap the Home dashboard scales uniformly to the window (capped 1.45×) instead of floating small in a fullscreen Mac window; the day table's width now matches its sibling cards exactly at every window size; native chrome (the header location chip) follows the app's resolved theme on Mac.
- **iPad/Mac layout, round 2** (docs/adaptive-layout-v2-plan.md). Home dashboard: content now vertically centers in the window (no more dead bottom half), the hero scales up to anchor the two columns, the tools grid flows in balanced larger tiles instead of 5-across with an orphan, and the two-column form only engages at ≥1180pt. Mushaf: the dual-page spread carries ONE chrome set (single Juz label at the outer right, single night pill at the outer left — they were duplicated per page), hover/click chevrons at the screen edges turn pages for trackpad and mouse users (there was no pointer affordance at all), and the spread threshold rises so facing pages never render cramped.

### Fixed
- **Quran index no longer pins to the right edge of wide windows (RTL).** The width cap moved from the list's content container (where it's ignored and pinned to the flow edge) onto the header and rows themselves, so the column truly centers in any language.
- **Home data-freshness line no longer scrambles in Arabic.** The embedded time/date is bidi-isolated and formatted in the app language.
- **Adhan/Sunrise alerts no longer fire 1–2 minutes off (with a duplicate at the real time).** If a notification sync ran shortly after midnight while the app still held the previous day's times in memory (e.g. a brief phone wake before the day-change refetch landed), yesterday's clock times were pinned onto today's date — the alert fired at yesterday's minute, and the next resync scheduled a second alert at the correct time. The schedule is now anchored to the calendar day the times were fetched for, so a stale map lands on its own (past) day and the "tomorrow" map correctly covers the actual today. A sync whose data is entirely stale now keeps the existing alarms instead of wiping them.

## [2.7.37] — 2026-07-15

### Added
- **Mihrab is now a real iPad app — and runs on Mac.** The whole app adapts to the window size: on a wide iPad (or a resizable window on Apple Silicon Macs) the Home screen becomes a two-column dashboard, reading content stays centred and comfortably measured instead of stretching, and the tools grid, Settings, and month schedule reflow to fill the space; narrow it and everything gracefully returns to the single-column phone layout.
- **Dual-page Quran (mushaf) in landscape.** When the window is wide enough, the mushaf shows two facing pages side by side like a printed copy; in portrait or on a phone it stays single-page.
- **Tafsir selector in Settings.** Pick your tafsir edition in Settings, or from any verse on the Quran page — the two stay in sync.
- **Hide the Live Activity from the lock screen (Android).** The prayer-countdown Live Activity now has a second action, next to "Mute next adhan," that hides or shows it on the lock screen / always-on display while keeping it in the notification shade. It's separate from the on/off setting.
- **Snooze a prayer alert.** Prayer notifications now have a Snooze action — tap it to be reminded again in 5, 10, 15 or 30 minutes, or type any number of minutes right in the notification (Android). iOS offers the same via an inline text field.

### Fixed
- **Your tafsir choice now sticks.** Choosing a tafsir edition used to revert to the default every time you reopened a verse; the selection now persists across the app.
- **Day carousel on large screens.** On iPad/Mac the day cards no longer clip or show a sliver of the neighbouring day — each day fills its page cleanly and swiping between days works.
- **Stale prayer notifications cleared (Android).** A fired prayer's notification now auto-dismisses when the next prayer arrives, so an old "Prayer time" alert can no longer linger on the lock screen next to a different, current prayer.
- **Sunrise notification wording.** The Sunrise alert no longer says "Prayer time" (Sunrise isn't a prayer) — it now shows the time instead.

### Changed
- **Qibla compass is temporarily hidden** while the iPad/Mac layout work lands (there's no magnetometer on Mac). It will return in a later update.

## [2.7.35] — 2026-07-08

### Fixed
- **Removed deprecated edge-to-edge calls (Android).** Under the enforced edge-to-edge mode on Android 15+, the native theme code still called the deprecated `Window.navigationBarColor` / `setDecorFitsSystemWindows` / `isNavigationBarContrastEnforced` setters — no-ops on those versions that tripped Play Console's "deprecated edge-to-edge API" recommendation. They're now guarded behind API < 35; the still-valid light/dark nav-bar icon appearance is applied on every version, so there is no visual change.

## [2.7.34] — 2026-07-08

### Fixed
- **Prayer times now follow you across borders reliably.** Fixed a feedback loop where a completed location fetch re-triggered the whole GPS cycle and raced itself, which could leave the screen showing the previous city's times after you'd moved (e.g. travelling Sweden→abroad updated the city name but not the times). The displayed times, city name, and data source now switch together. Verified Stockholm→London→Stockholm: the Swedish source (Islamiska Förbundet) and the global source (AlAdhan) swap correctly, and returning to a recent city reuses its cached week with no re-download.
- **"Approximate location" (Android 12+) now works.** If you grant *Approximate* rather than *Precise* location, automatic mode previously treated it as denied. It now accepts a coarse grant — which is plenty for prayer times and is exactly the Wi-Fi positioning used when GPS is unavailable.
- **Defence-in-depth for the Swedish source.** Coordinates far from any covered Swedish city (bounding-box edge cases like Åland) now miss the prepared dataset and fall through to the live/computed sources instead of being pinned to a distant Swedish city.

### Changed
- **More reliable automatic location.** The app now asks the OS for a fast Wi-Fi/cell fix first (works indoors, resolves in ~1 s, and on the Play build taps the network locator) and refines it with GPS — instead of forcing a GPS lock that often never resolved indoors. The Android location provider is pinned to the platform `LocationManager` so the Wi-Fi/network path is used and the F-Droid build stays free of Google Play Services. Cross-flavor safe: on de-Googled builds it still falls through to GPS.
- **Resourceful handling of location changes.** Each city gets a stable anchor coordinate, so moving *within* a city no longer re-downloads the same prayer times. When the city actually changes, the new city's times are fetched while the previous city stays cached for a week in case you return; cities you only pass through (active less than a day) are dropped a day after you leave, so travelling through many cities doesn't hoard data.
- **Location chip shows the current city in both modes.** In automatic mode it now names the reverse-geocoded city (e.g. "Göteborg") with an "Auto" badge, not just coordinates; manual mode still shows the saved location.
- **Faster first-time Quran (mushaf) download.** The 604 page images now download 8-at-a-time (was 3), roughly tripling throughput, with the existing per-page retry/fallback intact.

## [2.7.33] — 2026-07-07

### Fixed
- **iOS version bump only.** After the 2.7.32 build was delivered to App Store Connect, that pre-release train closed, so a later build couldn't reuse version 2.7.32. Bumped to 2.7.33 so iOS delivery succeeds. No functional changes from 2.7.32.

## [2.7.32] — 2026-07-06

### Changed
- **Sweden prayer times are now served from a prepared dataset instead of scraping on every device.** A scheduled server-side job mirrors the Islamiska Förbundet bönetider into per-city JSON on a CDN (+ a compact seed bundled in the app), and the app reads that — with the live scrape, AlAdhan, and on-device calculation kept as fallbacks. Result: the flaky origin is off the normal path, times work offline, and a day cached earlier from a fallback auto-upgrades to exact IFiS times once the server's coverage reaches it. Client refresh is index-driven (polls a tiny `index.json`, pulls only when the server publishes a newer build; ±jitter, atomic-commit-safe).

### Added
- **Hidden data-statistics panel** (unlock with 5 taps on the version in Settings, à la developer mode): a card at the bottom of Home showing the current source (server dataset / offline bundled / live scrape / AlAdhan / on-device), days stored, last-updated and next-check times, and the last/next server-run status. Wrapped in an error boundary so it can never affect the prayer screen.

### Infrastructure
- Weekly GitHub Actions job builds + commits the dataset with coverage safeguards: warns by email under 40 days of per-city coverage and hard-fails under a 30-day floor. Karlshamn (unsupported by the widget) dropped from the city table; its coordinates map to the nearest supported city.

## [2.7.31] — 2026-07-06

### Added
- **Custom khatmah length**: alongside the 30/60/90-day presets, a "Custom…" chip opens a small dialog to start a plan of any length (1–604 days); the daily portion adjusts accordingly.
- **Verse of the day: translation ⇄ tafsir toggle**: the card now lays the ayah on its own row with the companion text below it, and a small toggle chooses whether that second row shows the translation or real tafsir (Ibn Kathir et al., cached offline like the ayah panel). The choice persists.

## [2.7.30] — 2026-07-06

### Added
- **Data-freshness indicator on the Home hero**: a quiet line under the countdown showing when prayer times last landed from the provider and how many days are stored offline.

### Changed
- **Sweden provider (Islamiska Förbundet) fails over instantly**: if the scraper origin is down, the SAME request now silently serves AlAdhan instead of waiting for three failed sessions before the 12 h cooldown engaged. Retry chain shortened (2×6 s instead of 4×7 s) so the failover is quick; the existing cooldown still stops repeat probing.
- **Home layout swap**: the wide shortcut under the day carousel now opens the **Quran** (with a new open-mushaf icon) — one of the app's main thoughts. The month view moved to a calendar chip right next to "Today" and a tile in the tools grid (replacing the old Quran tile).
- **Hero tint matches the palette under dynamic colors too**: the slim rule + "NEXT PRAYER" label followed a fixed time-of-day hue under Material You, clashing with the wallpaper accent. They now always follow the current accent.
- **Mushaf pages 1–2 render sharp**: the page scaler's single bilinear step landed in the pixel-skipping 0.5–0.7× zone exactly at those pages' display size. The scaler now downscales progressively (≈0.71× per step, area-filter quality at any factor); the render cache regenerates itself (v2) on first open.

## [2.7.29] — 2026-07-06

### Changed
- **Fullscreen keeps the essentials**: the surah name (replacing the Juz label, since the nav header is hidden), the night/light toggle, and the tappable page number stay visible in fullscreen reading.
- **Fixed a brief chrome misform when exiting fullscreen**: the page was sized against the stale fullscreen viewport for a few frames, letting text run under the reappearing bars; measurements are now tagged with the mode they were taken in.
- **Full mushaf pages stretch vertically to fill the screen**: the Madinah page is a fixed ~0.61 aspect while phones are ~0.45, so a width-fit page always letterboxed above and below — especially in fullscreen. Full-text pages (3+) now stretch their text block vertically into that space (capped at 1.25× — fullscreen would need ~1.35× to fill completely, which reads as drawn-out calligraphy), bounded by the real measured page viewport so text never runs under the Juz marker or the page-number frame. Ayah highlights and long-press hit-testing map through the same stretch; the render cache keys off the display height so stretched pages stay pixel-sharp. Pages 1–2 keep their decorative plates undistorted.

## [2.7.28] — 2026-07-05

### Added
- **Real tafsir**: classical tafsir in the ayah panel — Ibn Kathir (abridged) and Maarif-ul-Quran in English, al-Muyassar and Ibn Kathir in Arabic, plus Urdu and Bengali Ibn Kathir. Fetched per ayah on demand (spa5k/tafsir_api mirror of the Quran.com corpus, attributed in About) and cached for offline re-reading.
- **Manage downloads screen** (Settings → Data & privacy, and from the Quran screen): disk usage and one-tap delete for mushaf pages, per-reciter audio, and the tafsir cache.
- **Khatmah upgrades**: a Continue button that jumps straight to your current page; a Reset menu (today's reading / restart the plan / delete it); and an explicit "Set as my khatmah position" pin in the ayah panel, shown on the mushaf in a reserved cyan highlight. Automatic page tracking still works alongside.
- **Khatmah daily reminder**: optional notification at a chosen time with today's portion and where to continue.
- **First E2E test suite** (Maestro): home, Quran reader, and settings smoke flows (`npm run e2e`).

### Changed
- **Mushaf gestures**: single tap toggles fullscreen; long-press selects the ayah. The header button is now labeled "♪ Audio" and opens the same ayah panel scrolled to the recitation controls — translation, tafsir, bookmarks, khatmah pin, playback, and memorization all live in one sheet. The view toggle is now labeled "Translation" (it shows translations; tafsir is the new separate feature).
- **Bookmarked ayahs are now highlighted in full** on the mushaf page in their bookmark color (translucent, ink stays readable) — the old margin marker sat at the *start* of the ayah, which read as the previous ayah.
- **Pages 1–2 render ~60% larger**: the ornamental Fatihah/Baqarah plates occupy only ~59%×42% of the source canvas; the reader now crops to the content box.
- **Regular pages use more of the screen**: a safe uniform crop (union of all 602 page content boxes, so nothing can clip) plus slimmer reader gutters make the text ~6% larger edge to edge.
- **Sharper mushaf rendering**: a new native `MushafPageScaler` module (Kotlin + Swift) caches each page at the exact display pixel size using high-quality multi-step scaling, so the GPU no longer minifies the 2600px source in one aliasing-prone step — strokes render pixel-perfect. Cache lives inside the managed mushaf store (covered by Manage downloads).
- **Fullscreen lost its ✕ button** — a single tap toggles fullscreen in both directions; the overlay button looked bolted-on.
- **Gapless recitation**: upcoming ayahs are prefetched to disk during playback and swapped into the queue, so longer sessions play without network gaps between ayahs.
- **Adhan reliability (Android)**: prayer triggers now always ride AlarmManager (exact when permitted, allow-while-idle otherwise) instead of falling back to WorkManager, which OEM battery managers defer.
- **Sweden provider cooldown**: after 3 consecutive failures the Swedish city source rests for 12 h (AlAdhan + cache serve meanwhile) instead of being retried noisily every fetch.
- **Fasting reminders** now resync on every app foreground (previously only when visiting the Fasting screen, letting the 60-day window drain).
- **"Show onboarding again" no longer wipes data** — it simply replays the welcome flow; the destructive wipe moved to its own clearly-labeled "Reset app data" row.
- Word-highlight coverage audited: all 9 recordings with public quran-align data are wired; the other 12 have no published alignment (documented in `reciters.ts`).

### Removed
- Stale Scheherazade New references (the font was never bundled): attribution row and scaffolding notes.

## [2.7.27] — 2026-07-05

### Added
- **16 new reciters** (21 total): As-Sudais, Ash-Shatri, Ar-Rifai, Al-Tablawi (all four with word-level highlight), Maher Al-Muaiqly, Saad Al-Ghamdi, Ahmed Al-Ajmi, Muhammad Ayyub, Muhammad Jibreel, Yasser Ad-Dossari, Ali Al-Hudhaify, Nasser Al-Qatami, Abdullah Basfar, Fares Abbad, Salah Al-Budair, and Abdullah Al-Juhany. All verified against EveryAyah; reciters without word timings fall back to ayah-level highlight.
- **Searchable reciter picker**: switching reciters is now a dedicated sheet with type-ahead search (Latin or Arabic) and a "word highlight" badge — reachable from the recitation settings *and* by tapping the reciter name in the player.
- **Ayah of the day notification**: opt-in daily notification at a chosen time with a randomly drawn ayah (uniform over all 6,236) and its translation in your active edition. Settings → Notifications → Ayah of the day.

### Changed
- **The mushaf is now the default reading view** — opening a surah lands on the raw Arabic page; the header toggle still switches to the translation view and remembers your choice (applied once to existing installs).
- **Night/light toggle is a labeled pill** on the mushaf page header (was a small glyph), and its icons stay monochrome.
- **Sleeker recitation player**: floating card matching the app chrome, accent-filled circular play button, ayah progress hairline, tappable reciter name.
- **Bookmarks are deletable** from the Bookmarks tab (and stars removable) with an ✕ on each row.
- Updated the in-app attributions for the expanded reciter set.

### Fixed
- **Recitation sheet in mushaf view**: the header ♪ button now opens the recitation settings in mushaf mode (it silently did nothing before).
- **Rose/Violet accents no longer reset to green after an app restart** (settings validation list was missing the two new accent ids).

## [2.7.26] — 2026-07-05 — Quran Reader v2 (docs/quran-reader-plan.md)

### Added
- **Feature tour for new users**: a swipeable four-slide walkthrough (welcome, prayer times, Quran, customization) shows once after onboarding completes; replayable any time from Settings → "Show the app tour". Fully localized in all 13 languages and palette-aware.
- **Rate Mihrab**: a Settings row that opens the native in-app review sheet on iOS (SKStoreReviewController), the Play Store listing on Google Play builds, and the GitHub project page on F-Droid builds — no trackers, no SDKs.
- **Live Activity "Markers" design (Android 16+)**: a third look for the countdown notification — the day progress bar gains a dot at each prayer boundary and a crescent tracker that travels along the track, using the native ProgressStyle points API. Keeps the status-bar chip and Always-On Display, like the other designs.
- **Data survives uninstall → reinstall (Android)**: all settings, journal, fasting log, tasbih, Quran bookmarks/khatmah are now covered by Android Auto Backup (cloud + device-to-device transfer), and uninstalling on Android 10+ offers a "Keep app data" checkbox — reinstalling later restores everything without redoing setup. Downloaded mushaf pages/audio are excluded (re-downloadable, would blow the backup quota).
- **Interactive mushaf**: tap any ayah on the page → highlight + action sheet with translation peek, play-from-here, repeat, colored bookmarks (5 colors), star, share (text or a rendered image card). Word-accurate ayah geometry (quran.com ayahinfo data) validated pixel-perfect against the KFGQPC page images.
- **Audio recitation**: 5 reciters (Al-Husary, Alafasy, Abdul Basit, Al-Minshawi, Al-Shuraim) streamed per-ayah from EveryAyah, with lock-screen/notification controls, background playback, speed control (0.75×–2×), and per-surah offline downloads. The playing ayah is highlighted on the mushaf and auto-turns pages; the translation view highlights the live word using quran-align timings (CC BY 4.0, re-hosted on this repo's `quran-timings-v1` release).
- **Memorization (hifz) tools**: repeat each ayah ×N, repeat a range ×M, pause-between-repeats (recite-back gap), explicit range player, and hide/reveal masking of Arabic or translation per ayah.
- **Khatmah tracking**: 30/60/90-day plans with daily portion, progress bar and gentle catch-up hints, advanced automatically by sequential mushaf page turns.
- **Navigation**: Surah / Juz / Bookmarks tabs, continue-reading resume card, go-to-page jump, verse of the day, diacritic-insensitive Arabic + translation search.
- **Night mode** for the mushaf (clean page inversion) + keep-screen-awake while reading.

### Added — look & feel upgrade
- **Real Arabic typography**: the bundled Amiri fonts are now actually registered and applied — ayah text renders in Amiri Quran (classical mushaf letterforms with correct stacked diacritics) and surah names / duas in Amiri Naskh, on both platforms. Previously everything fell back to the system Arabic face.
- **Depth**: every card in the standard light theme gets a soft warm shadow lift (`cardEdgeStyle`); dark themes keep the calm border-only look, dynamic/glass chrome untouched.
- **Time-of-day awareness (principle 5)**: the Home hero now carries a slim tinted rule + eyebrow label whose hue follows the prayer day — pre-dawn indigo, morning amber, midday teal, golden Asr, sunset rose, violet dusk. Felt, not announced.
- **Two new accent colors**: Rose and Violet join the picker (deep ink tones in light mode, lifted variants in dark), mirrored to the home-screen widget as a custom hex so no native changes were needed.

### Changed
- **Mushaf storage** moved from the evictable OS image cache to a managed on-disk store with a manifest, partial-download resume and a retry-missing-pages path (fixes blank pages after cache eviction).
- **Translation view virtualized** (FlatList) and translation JSON loading deferred off the navigation transition — Al-Baqarah opens instantly.
- Mushaf chrome now follows the app palette (was hardcoded light) and reflows correctly on rotation.
- New deps: react-native-track-player (Apache-2.0, patched for Kotlin 2 nullability), react-native-blob-util (MIT), @sayem314/react-native-keep-awake (MIT). All FOSS, no Google Play Services — F-Droid-safe.

## [2.7.25] — 2026-06-27

### Changed
- **Live Activity countdown is now identical on the Always-On Display and when the screen is on (Android 17)**: the countdown keeps the same MetricStyle layout in both states (the earlier dashed-seconds AOD variant used a different layout, which looked inconsistent).

## [2.7.24] — 2026-06-27

### Changed
- **Live Activity countdown on Always-On Display (Android 17)**: on the AOD the seconds now show as a dash (e.g. "4:23:-") instead of ticking; the full live H:MM:SS returns as soon as the screen is on.

## [2.7.23] — 2026-06-27

### Fixed
- **Live Activity countdown on Always-On Display (Android 17)**: the countdown showed a coarse "4h" on AOD; it now shows the full hours and minutes. The metric uses the system chronometer format, which renders H:MM:SS while the screen is on and H:MM on AOD (no per-second churn).

## [2.7.22] — 2026-06-27

### Fixed
- **F-Droid build**: the Android 17 Live Activity APIs (MetricStyle countdown, etc.) are now invoked via runtime reflection, so the app compiles against the Android 16 SDK on F-Droid's build server (which doesn't yet have the Android 17 SDK) while keeping every feature on Android 17 devices. No user-facing change; the GitHub/Play builds still target the Android 17 SDK.

## [2.7.21] — 2026-06-27

### Fixed
- **Live Activity now follows the app language immediately**: changing the app language re-pushes the notification, so the metric labels ("In"/"At"/"Since"), the mute toggle and the Hijri month all switch language right away instead of staying in the previous language.
- **Arabic Hijri date**: when the app language is Arabic, the Hijri date uses Arabic-Indic numerals (e.g. ١٢ محرم ١٤٤٧) so the whole date reads in Arabic.

## [2.7.20] — 2026-06-27

### Changed
- **Live Activity fully localized**: the countdown metric labels ("In", "At", "Since") and the Hijri month names now translate into all 13 app languages, so the entire Live Activity reads in the user's chosen language.

## [2.7.19] — 2026-06-27

### Changed
- **Android 17 Live Activity polish**: the countdown design now keeps its larger, two-row layout even with no second metric, so the Hijri date always has room. Changing a Live Activity option (design or second metric) now refreshes the notification immediately. The "Mute next adhan" toggle is now translated into all 13 app languages.

## [2.7.18] — 2026-06-27

### Added
- **Hijri date in the app**: the Today card and every day in the upcoming-week carousel now show the Hijri date beneath the Gregorian date (iOS + Android). On Android it also appears next to the next prayer in the Live Activity, and rolls over to the new day automatically.
- **Android 17 Live Activity**: a dedicated Android 17 path using the platform Live Update APIs. Two designs — a refined ProgressStyle prayer-day timeline and a MetricStyle countdown (system-ticked; live seconds while the screen is on, battery-friendly adaptive format on Always-On Display). Adds an optional second metric on the countdown (prayer time / time since last prayer), a "Mute next adhan" toggle action, and a brief "it's prayer time" state when a prayer arrives. Android 16 keeps its existing implementation unchanged.

## [2.7.17] — 2026-06-25

### Fixed
- **Prayer times follow your location's region (provider auto-switch)**: the Swedish source (Islamiska Förbundet) only has data for Swedish cities, so for a location outside Sweden it produced wrong times. The data source now switches by region — Sweden uses the Swedish source, everywhere else uses the global source — in both automatic mode and when the Swedish source is pinned manually. (Outside Sweden a pinned Swedish source falls back to the global source for that location.)
- **Location changes apply on the first try**: settings saves are now serialized, so two quick changes — e.g. removing a saved location and then picking a new place — can no longer land out of order and leave the older coordinates on disk. Previously a location change could appear not to "take" and had to be redone.

## [2.7.16] — 2026-06-25

### Changed
- **Live Activity comes back after being dismissed (iOS)**: if you swipe the prayer Live Activity away (or clear it) while the feature is enabled, it's now re-shown automatically the next time you open the app — from any screen, not just Home. (iOS doesn't let apps make a Live Activity un-dismissible or start one in the background, so this revives it on every foreground rather than truly pinning it.)

## [2.7.15] — 2026-06-21

### Added
- **Full adhan on iOS (compliant)**: iOS caps notification sounds at 30s, so the prayer notification can only play a 29s clip. The complete adhan now plays in-app when you **tap** an adhan notification (which opens the app) or when a prayer notification arrives **while the app is open**, and when you **preview** an adhan in Settings. Uses a foreground-only audio player (no background audio mode), so it's App Store-compliant. Android is unchanged (its notification channel already plays the full adhan).

## [2.7.14] — 2026-06-19

### Fixed
- **Crash on launch (Android)**: 2.7.13's F-Droid build compiled notifee's core from source, which turned out to be binary-incompatible with notifee's current wrapper at runtime and crashed immediately on launch. Reverted to notifee's published `core` library so the app starts normally again.

## [2.7.13] — 2026-06-19

### Changed
- Maintenance release rolling up the recent theme fixes (iOS header chrome follows the in-app theme; "System" theme no longer lags on the opposite appearance) and internal test-suite updates for React 19.

## [2.7.12] — 2026-06-19

### Fixed
- **"System" theme no longer lags or sticks on the opposite appearance (Android & iOS)**: when following the system light/dark setting, the app could stay on the previous (now-opposite) theme after the OS appearance changed — most often when the change happened while the app was in the background. The app now re-reads the authoritative current appearance on every system appearance event and whenever it returns to the foreground, so the theme tracks the OS without lag.

## [2.7.11] — 2026-06-19

### Fixed
- **iOS header now follows the in-app theme (location + settings chip)**: when the app's appearance is set to the opposite of the system (e.g. app Light on a Dark device), the navigation-bar material behind the header location-pin and Settings gear used to follow the system appearance while the chip's own text/icons used the app theme — a mismatched header. The app now forces the iOS window's interface style to its chosen appearance so all native chrome matches.

## [2.7.10] — 2026-06-17

### Changed
- **F-Droid build now compiles notifee's core from source** instead of using the prebuilt `core` AAR notifee ships. The notifee source (a community fork that reproduces the `app.notifee:core` engine without Google Play Services) is vendored as the `notifee_fork` git submodule, and `android/settings.gradle` builds it as `:notifee_core` when the submodule is present. Play/local builds without the submodule checked out continue to use the bundled AAR unchanged.

## [2.7.9] — 2026-06-16

### Fixed
- **Content no longer clipped by the see-through navigation bar (Android)**: with the nav bar now transparent and the app drawing edge-to-edge, the Home, Settings, Monthly times, and Quran reader screens now pad their scroll content by the bottom safe-area inset, so the last row of cards/tiles/ayahs sits fully above the navigation buttons instead of being hidden behind them.

## [2.7.8] — 2026-06-16

### Changed
- **See-through navigation bar (Android)**: the 3-button navigation bar is now fully transparent and integrated — the app's background flows underneath it (the OS contrast scrim is disabled), while content stays above the buttons. Button icons still follow the light/dark theme.

## [2.7.7] — 2026-06-16

### Changed
- **Small widget is now a compact 2×1**: laid out as one row with two columns — next prayer name + time on the left, time remaining + location on the right.

## [2.7.6] — 2026-06-16

### Changed
- **Widget polish**: the large widget's prayer list fills its height again (no large empty area below) and defaults to a more compact size; the small widget is now a 1×1 countdown (next prayer name + auto-sizing time).

## [2.7.5] — 2026-06-16

### Changed
- **Home-screen widgets — cleaner, better-proportioned layouts**: The large widget's prayer list is now a tidy top-anchored list instead of rows stretched into big gaps; the small widget fills its space; the next-prayer time auto-sizes to use the available room; prayer names show in full ("Maghrib", "Sunrise") instead of abbreviations; and each size shows a "time remaining until next" caption. The default green highlight now matches the app's emerald accent.

## [2.7.4] — 2026-06-16

### Changed
- **System colours (Android) now recolour only the accent**: Enabling system colours keeps the standard theme's design (surfaces, text, bordered chrome) and just overrides the accent with the live Material You wallpaper colour, instead of swapping the whole Material 3 surface palette. It now also applies without a restart.
- **Live Activity tint follows the app accent**: The Android Live Activity uses the app's actual accent — the brand emerald on the standard theme (previously it was stuck on an old lime green and ignored the setting), or the Material You colour when system colours are on. With system colours on it re-resolves the live system accent on every update (and on configuration changes), so the notification colour tracks a wallpaper/colour change without reopening the app.

## [2.7.3] — 2026-06-16

### Changed
- **Live Activity timeline shows only the five prayers + Sunrise**: When Islamic Midnight / Last Third (Qiyām) are enabled they no longer add a gap to the Android Live Activity timeline — the bar stays at the six prayer/Sunrise gaps. They still drive the countdown: when one is the next event, the title's inline countdown (and the Countdown design) targets it.

## [2.7.2] — 2026-06-16

### Changed
- **Live Activity timeline — one gap per prayer**: The Android day-timeline is now a clean segmented bar with a separator at each of the six events (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) — no milestone dots, tracker thumb, or start/end icons. The bar is anchored at the middle of the night so every prayer (including Fajr and Isha) sits as its own gap rather than at an edge, with the night shown as the two end pieces. Short intervals are floored to a minimum width so all six gaps stay readable; the filled/unfilled boundary still marks "now".
- **Live Activity "Countdown" design reverted to the chip-safe layout**: On Android 16 a larger shade countdown can't coexist with the status-bar chip and always-on display (a custom view or enlarged title disqualifies the promoted-ongoing chip), so the Countdown design keeps the standard layout that preserves both.

### Fixed
- **Location onboarding (App Store guideline 5.1.1)**: The "Set your location" step no longer has a "Skip for now" exit, and the GPS button is now neutrally labelled "Use my location". Users can still avoid the OS prompt by entering a location manually.

## [2.7.1] — 2026-06-16

### Added
- **Android Live Activity — new "Countdown" design + style picker**: A second Live Activity layout for Android that puts the live countdown front-and-centre as the large title, with the next prayer's name and clock time beneath it. Both designs keep the Android 16 status-bar chip and the always-on display. Choose between **Timeline** (the prayer-day progress bar with a marker at each prayer) and **Countdown** under Settings → Live Activity, with a live preview of each. Android only.

### Changed
- **Live Activity countdown includes the night times**: When Islamic Midnight / Last Third are enabled, the Live Activity now counts down to them (and shows them on the Android timeline) as well as the five prayers and sunrise.

## [2.7.0] — 2026-06-15

### Added
- **Islamic Midnight & Last Third of the night (Qiyām)**: Two optional pre-dawn times, computed on the classical Maghrib→Fajr basis (Islamic Midnight is the midpoint of the night; the Last Third marks the start of the final third, the time of Qiyām al-Layl). Off by default; when enabled they appear in the prayer table and fire notifications. Like Sunrise, they use the default notification sound (never the adhan).
- **Sunrise toggle (kill-switch)**: A new toggle (on by default) to hide Sunrise from the prayer table, notifications, and the Live Activity.

All three live under Settings → Notifications → "Additional times", translated across all 13 locales.

### Changed
- **F-Droid build no longer depends on jitpack**: The Liquid-Glass blur is iOS-only, so `@react-native-community/blur` (which pulled `BlurView` from jitpack) is excluded from Android autolinking entirely. The F-Droid/Android build is now fully resolvable from standard repositories; iOS keeps the blur.

## [2.6.0] — 2026-06-15

### Changed
- **Android Live Activity — live ticking countdown + true-to-time day timeline**: The notification title now shows the next prayer with an inline countdown that ticks every second while the screen is on (`Asr · 2:18:42`) and drops to `H:MM` on the always-on display to save power; the actual prayer time sits in the subtext. The day-timeline segments are now sized from the exact number of seconds between each pair of prayers (previously minute-resolution), including the overnight Isha→Fajr stretch, and the tracker advances continuously, so the spacing stays proportional to the real time of day. The progress line uses the device's system (Material You) colour when system colours are enabled in the app, otherwise the default system tint. The status-bar chip now also shows seconds.

## [2.5.0] — 2026-06-15

### Added
- **Android Live Activity — native day-timeline (Android 16)**: The Live Activity now uses the platform `Notification.ProgressStyle` "Live Update" API to render the whole prayer day as a segmented timeline — accent-filled progress with a point marker at each prayer, a tracker dot at the current moment, and sunrise/crescent icons bookending the dawn→night cycle. The upcoming prayer's marker is highlighted in the accent colour. Falls back to a plain progress bar when the day cycle can't be resolved, and to the existing custom layout on pre-Android-16 devices.
- **Header location chip on Android (parity with iOS)**: The current location is shown next to the Settings gear whenever a manual location is set — with or without saved presets. Tapping it always opens the location selector, which now includes an "Add a new location" action that jumps to Settings and briefly highlights the Saved Locations section.
- **iOS Live Activity follows the system theme**: When Liquid Glass / system colours is selected, the Live Activity uses the dynamic iOS system tint (adapting to light/dark on its own) instead of the brand accent, so it matches the in-app theme.

### Changed
- **Refined standard theme (light + dark)**: Warmer, more reverent neutrals (deep ink-blue at night, warm paper by day); a calmer Next-Prayer hero (neutral surface with the countdown carrying the accent, instead of a saturated colour block); a refined deep/lifted emerald accent in place of the old neon green; softer, unified card radii; and a gentler active-row indicator.
- **Android navigation bar follows the app theme**: The system navigation bar icons now match the selected light/dark theme (previously always dark).
- **Themed restart prompt**: The "Restart required" dialog shown when toggling System colours is now a custom themed modal instead of the stock system alert.

## [2.4.0] — 2026-06-14

### Added
- **Multi-day schedule for the home-screen widget + Live Activity**: The app now pushes a multi-day schedule (`days[]`, one dated entry per day) instead of a single-day snapshot. Each native renderer selects the day matching the device's wall-clock date and rolls forward on its own. This fixes prayer times going stale ~24 hours after the app was last opened (previously they only refreshed when the app was reopened). Applies to the iOS widget (timeline now spans every supplied day), the Android widget (selects today's entry; also arms a midnight rollover refresh — previously no refresh was scheduled after Isha), and the Android Live Activity (recomputes next/previous prayer from the absolute dated schedule, including the overnight Isha→Fajr interval).
- **iOS Live Activity — redesigned**: Rebuilt the Lock Screen and Dynamic Island presentations with a live countdown (`Text(timerInterval:)`) and an auto-filling progress bar (`ProgressView(timerInterval:)`) spanning the previous → next prayer, plus a prayer strip with the upcoming prayer accented — mirroring the Android Live Activity feature set. Adopts `ActivityContent(staleDate:)` on iOS 16.2+. Background rollover of the highlighted prayer is handled **locally with no server** via `BGTaskScheduler` (the app stays local-first; APNs/push was explicitly ruled out — see `docs/ios-live-activity-push.md`). The Live Activity setting is labelled **experimental** on iOS (localized across all 13 locales).
- **CI**: Added a GitHub Actions workflow that runs the TypeScript typecheck and the Jest suite on every push/PR (there was previously no automated test run).

### Changed
- **Android Live Activity — advances during deep sleep**: The foreground service now schedules an exact `setExactAndAllowWhileIdle` wake alarm at the next prayer, so the countdown/progress roll over even while the device is dozing (the `Handler` ticker is suspended during sleep).
- **Fewer Android notification channels**: Only the selected adhan channel and the default channel are created (and surplus channels are cleaned up), instead of creating all 17 adhan channels on every sync.

### Fixed
- **Sunrise no longer plays the adhan**: When an adhan sound is selected it now plays for the five daily prayers only; Sunrise (which is not a prayer) uses the default notification sound and drops the "Stop adhan" action.
- **Test suite + typecheck restored to green**: Fixed the half-finished `accentSolid` palette typing and an RTL-title style cast, converted directional CSS in the Quran reader to start/end, and refreshed stale tests (tasbih presets, Quran loader, the relocated LocationChip) that had drifted from the shipped source.

## [2.3.14] — 2026-05-14

### Fixed
- **Android Live Activity — advance past Isha to tomorrow's Fajr**: When the app process was killed (user force-stopped the app) while the foreground-service Live Activity was running, the service's internal 60-second ticker would find no rows after Isha and freeze the notification permanently on "Isha" until the app was reopened. The ticker now wraps around to Fajr after Isha: it locates the Fajr row in the cached payload and calls `parseHHMMToEpochMs`, which automatically places Fajr 24 hours ahead when today's Fajr is already in the past. This matches the behaviour of every other prayer transition (Fajr→Sunrise→Dhuhr→Asr→Maghrib→Isha all advanced correctly via the same ticker logic; Isha→Fajr is the only after-midnight roll-over the ticker needs to handle itself when JS is not running).

## [2.3.13] — 2026-05-12

### Changed
- **Android Live Activity — reverted to standard template (chip preserved)**: Removed the `DecoratedCustomViewStyle` + custom view experiment from v2.3.12. Back to the chip-compatible standard layout: countdown (`↓ 1h 23m`) in `setSubText`, percentage appended to the end of `setContentTitle` (`الفجر · 02:48  ·  52%`) so it is always the last element reading left-to-right on the content row. Progress bar via `setProgress`.

## [2.3.12] — 2026-05-12

### Changed
- **Android Live Activity — platform `DecoratedCustomViewStyle` + percentage far-right**: Uses `Notification.DecoratedCustomViewStyle()` (platform API 36, not compat) with `setCustomContentView` so the prayer title sits LEFT and `52%` sits far RIGHT on the same content row. Countdown (`↓ 1h 23m`) stays in `setSubText` in the header. The platform style wraps the custom view in standard Material You chrome and may allow chip promotion where a bare custom view does not. Progress bar rendered by the custom view's `ProgressBar` (no double bar).

## [2.3.11] — 2026-05-12

### Changed
- **Android Live Activity — layout refinement (chip preserved)**: Countdown (`↓ 1h 23m`) is now shown alone in `setSubText` (right of app name in header row). Percentage (`52%`) moves to the content title row, appended to the prayer name: `"الفجر · 02:48  ·  52%"`. Progress bar remains below. `setCustomContentView` is intentionally absent — assigning a custom content view (even post-build) excludes the notification from chip promotion on Android 16.

## [2.3.10] — 2026-05-12

### Changed
- **Android Live Activity — post-build `contentView` injection (chip + same-line layout)**: Instead of calling `builder.setCustomContentView()` (which flags the notification as "custom template" and causes the builder to suppress `FLAG_PROMOTED_ONGOING` during `build()`), the notification is now built as a standard template so chip state is fully preserved, then `notif.contentView` is assigned directly on the built `Notification` object post-build. This sidesteps the builder's template-type tracking entirely. Also injects `android.requestPromotedOngoing = true` and `android.shortCriticalText` into extras post-build as belt-and-suspenders, and clears the standard progress extras to prevent a double progress bar when the custom `ProgressBar` is in use.

## [2.3.9] — 2026-05-12

### Changed
- **Android Live Activity — same-line layout on Android 16 with chip preservation attempt**: Restored `setCustomContentView` on the Android 16 path so prayer title and countdown+percentage (`↓ 1h 23m  |  52%`) appear on the exact same line again (left / right). The Android 16 chip is preserved via post-build flag injection: `FLAG_PROMOTED_ONGOING` and `android.shortCriticalText` are written directly onto the built `Notification` object after `builder.build()`, bypassing any template-type resolution that might strip them during the build phase. Falls back to standard template (subText countdown) if the custom view fails.

## [2.3.8] — 2026-05-12

### Changed
- **Android Live Activity — compact layout on Android 16**: The countdown and percentage (`↓ 1h 23m  |  52%`) are now placed in `setSubText`, which pins them to the right of the notification header row. The prayer title (`الفجر · 02:48`) gets the full content row below it, and the Material You progress bar sits below that. This is the most compact layout achievable with the standard notification template that also preserves the Android 16 status-bar chip (`setRequestPromotedOngoing`) — `setCustomContentView` / `RemoteViews` breaks chip promotion and cannot be used on this path.

## [2.3.7] — 2026-05-12

### Fixed
- **Android Live Activity — chip regression (v2.3.4–v2.3.6)**: The root cause was `setCustomContentView()` itself on the Android 16 path, not just `DecoratedCustomViewStyle`. Setting a custom content view changes the notification template type internally and prevents `FLAG_PROMOTED_ONGOING` from being applied, which kills the status-bar chip. Fixed by removing `setCustomContentView` entirely from the Android 16 (`buildAndroid16`) path. The standard two-line template (prayer title / countdown+percentage) is used on API 36+ to preserve the chip. The same-line `RemoteViews` layout is kept on pre-36 devices where no chip exists.

## [2.3.6] — 2026-05-12

### Fixed
- **Android Live Activity — chip regression (v2.3.4–v2.3.5)**: Adding `DecoratedCustomViewStyle` in v2.3.4 broke the Android 16 status-bar chip. The style's internal `apply()` call during `build()` was overwriting the promoted-ongoing state set via reflection (`setRequestPromotedOngoing`). Fixed by removing `DecoratedCustomViewStyle` from the Android 16 notification path — on API 36 the system shade renders the header chrome (app icon, app name) automatically without needing an explicit style, so the style was unnecessary and harmful.

## [2.3.5] — 2026-05-12

### Fixed
- **Android Live Activity — double progress bar**: When the custom `RemoteViews` content view is active, `setProgress()` on the builder was also rendering a second progress bar below the custom view. Fixed by skipping `setProgress()` on the builder when the custom layout is in use (the `RemoteViews` `ProgressBar` is the only bar now).
- **Android Live Activity — RTL layout flip with Arabic prayer names**: Arabic text in the prayer title (`الفجر · 02:48`) caused the notification's `LinearLayout` to flip to RTL, putting the prayer title on the right and the countdown on the left — the opposite of the intended layout. Fixed by setting `android:layoutDirection="ltr"` on the row `LinearLayout` to lock the left-prayer / right-countdown widget order, while keeping `android:textDirection="locale"` on each `TextView` so Arabic and Urdu glyphs still render correctly.

## [2.3.4] — 2026-05-11

### Changed
- **Android Live Activity — prayer title and countdown on the same line**: Replaced the two-line layout (title / countdown+percentage) with a custom `RemoteViews` content view using `DecoratedCustomViewStyle`. The prayer title is now left-weighted and the `↓ 1h 23m  |  52%` text is right-pinned on the exact same line. The progress bar sits below, full-width. The standard `setContentTitle`/`setContentText` fields are kept as fallback for hardened shells (GrapheneOS, some MIUI builds) that strip custom `RemoteViews` silently.

## [2.3.3] — 2026-05-11

### Changed
- **Android Live Activity — countdown + percentage in content area**: Moved the `↓ 1h 23m  |  52%` line from the notification header row (`setSubText`, far from the content) into `setContentText` so it sits directly below the prayer title on the same visual block. Layout: line 1 = "Asr · 17:08", line 2 = "↓ 1h 23m  |  52%", progress bar below. Applied to both the Android 16 and legacy (pre-36) notification paths. The legacy path also drops the chronometer/countdown-timer display in the header row in favour of the explicit text line.

## [2.3.2] — 2026-05-12

### Changed
- **Android Live Activity — Material You progress bar**: Reverted the Unicode text bar back to the system `setProgress()` bar, which Android 12+ (Pixel) renders with Material You styling — rounded ends, accent tint, smooth fill. The percentage is shown as `setContentText("52%")` directly above the bar so they read as a single visual unit.

## [2.3.1] — 2026-05-12

### Changed
- **Android Live Activity — progress bar with inline percentage**: Replaced the system `setProgress()` bar (which gives no control over placement) with a Unicode text bar rendered directly in the notification content line: `████████████░░░░░░  52%`. The bar and percentage are now on the same line with no gap between them, exactly as intended. Works on all Android shells including hardened ones (it is plain `setContentText`, not a RemoteView).

## [2.3.0] — 2026-05-12

### Changed
- **Android Live Activity — single notification**: Replaced the dual-notification architecture (a hidden IMPORTANCE_NONE FGS placeholder + a separate rich notification) with a single notification. The rich prayer-countdown notification is now the foreground service notification itself — no more phantom entry in the "silent" section of the notification settings. The trade-off is losing the Android 16 status-bar chip; the cleaner single-notification UX is the correct call.
- **Android Live Activity — progress percentage placement**: Moved the `52%` from the notification title (`"Asr · 17:08  ·  52%"`) to `setSubText`, which places it in the notification header row next to the app name. The title is now cleanly `"Asr · 17:08"` and the progress bar + percentage are visually grouped at the header level.

## [2.2.0] — 2026-05-11

### Fixed
- **Android Live Activity — disappears after app update**: When Android installs an update it kills the app process, stopping the foreground service. The last payload was held only in memory, so the Live Activity notification was gone until the user opened the app. Fixed by persisting the payload to SharedPreferences on every `display()` call and clearing it on `cancel()`. A new `MihrabRestartReceiver` handles `MY_PACKAGE_REPLACED` (fires immediately after an OTA update in the fresh process) and `BOOT_COMPLETED` (fires after a device reboot). Both cases read the persisted payload and restart the service without requiring the app to open.
- **Android build — fdroid APK got ABI splits when building play and fdroid tasks together**: The `wantsPlayRelease` guard in `build.gradle` matched "bundleplayrelease" as a substring when both tasks were run in the same Gradle invocation, enabling ABI splits for the fdroid flavor too. Replaced the substring check with an explicit allowlist of play-flavor task names so fdroid always produces a single universal APK.

## [2.1.9] — 2026-05-11

### Fixed
- **Settings — "Apply coordinates" button too prominent**: The button was using the `primary` filled-accent variant, giving it the same visual weight as a main-screen call-to-action. Switched to `secondary` (outlined accent, transparent fill) so it sits at the same visual level as the rest of the settings surface.

## [2.1.8] — 2026-05-11

### Fixed
- **Settings — "Apply coordinates" button visual consistency**: The manual-coordinates Apply button in the Location card was rendered as a raw `Pressable` with a solid accent fill and no pressed-opacity handler, making it appear brighter and heavier than every other action button in settings. Replaced with the shared `Button` component so it gets the same pressed-state opacity (0.85), typography, padding, and border-radius as all other primary buttons.
- **F-Droid recipe — build entries out of order**: The `rewritemeta` linter sorts `Builds:` entries by `versionCode` ascending and fails if it has to reorder them. Builds 2.1.4 / 2.1.5 / 2.1.6 were added in the wrong order (2.1.6 → 2.1.5 → 2.1.4). Reordered to correct ascending sequence so `rewritemeta` is a no-op.

## [2.1.7] — 2026-05-11

### Fixed
- **Android Live Activity — wrong prayer after Sunrise (background advance)**: The foreground service ticker that auto-advances the countdown when a prayer passes while the app is closed was not including Sunrise in its candidate row list. When `nextKey="Sunrise"` and Sunrise passed with the app closed, the ticker's index-of lookup returned -1 (Sunrise absent from `rows[]`), causing it to scan from Fajr, find it in the past, and advance +24h to **tomorrow's Fajr** instead of today's Dhuhr. Fixed by injecting `sunriseRow` into the ordered list immediately after Fajr before the candidate scan, so the full six-point sequence [Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha] is searched correctly.

## [2.1.6] — 2026-05-11

### Fixed
- **Android Live Activity — progress bar starts at ~20% at Isha adhan**: After Isha passes, `buildWidgetPayload` rolls the widget over to tomorrow's prayer data. The previous `prevEpochMs` computation iterated through those tomorrow-rows and — because tomorrow's Isha in Stockholm (May, days getting longer) is slightly later than today's — it mis-identified tomorrow's Maghrib as the most recent past prayer, inflating the initial progress to ~23%. Fixed by passing the raw `today` TimingsMap directly to `computePrevPrayerEpoch`; it now always scans the actual current-day `HH:MM` strings (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) and correctly finds today's Isha as the previous anchor, so the bar resets to 0% at rollover.

## [2.1.5] — 2026-05-11

### Changed
- **Settings — Live Activity description**: The help text beneath the Live Activity toggle now notes that iOS support is experimental. Updated across all 13 supported locales.

## [2.1.4] — 2026-05-11

### Fixed
- **iOS Live Activity — race condition on launch**: Multiple React Native effects (`useFocusEffect`, settings change, next-prayer advance) firing simultaneously at app launch could race each other into a create/dismiss spiral, leaving no visible Live Activity. Fixed with two complementary guards: an 800 ms JS-side debounce that coalesces concurrent `syncLiveActivity` calls so only the freshest payload executes, and a Swift-side serial `DispatchQueue` + `isStarting` flag that skips duplicate in-flight `start()` calls. Existing activities are now updated in-place (`act.update(using:)`) instead of stop-then-restart, eliminating the flash-and-disappear on the lock screen.

## [2.1.3] — 2026-05-11

### Added
- **Home screen — Mihrab logo in header**: The app name in the home screen navigation bar now shows a transparent-fill pointed-arch icon (matching the launcher icon geometry) alongside the text. The arch interior shows through to the navigation bar background, adapting to light and dark themes automatically.

### Fixed
- **Home screen — title always "Mihrab"**: The home screen header title is now always the proper app name "Mihrab" regardless of the selected language. Previously it was translated (e.g. "محراب" in Arabic), which obscured the brand name.
- **iOS Live Activity — next-prayer advance**: When a prayer passes while the app is open in the foreground, the Live Activity now immediately updates to show the next prayer and a fresh countdown. Root cause: `syncLiveActivity` was not re-triggered when the "next prayer" pointer advanced; adding `nextInfo` to the effect dependency array fixes this.

## [2.1.2] — 2026-05-11

### Fixed
- **Android notifications — status-bar icon**: All notifications (prayer alerts, fasting reminders, Live Activity) now show a refined mihrab arch icon whose Bézier shoulder curves and eight-pointed star are derived directly from the launcher icon geometry, replacing the previous straight-line approximation.

### Changed
- **Android Live Activity — notification prayer names**: Prayer names in the Live Activity notification now correctly use the app's selected language (e.g. Arabic) instead of always falling back to English. Root cause was a lowercase key lookup (`prayer.fajr`) that missed the capitalised keys (`prayer.Fajr`) used in all 13 locale files.
- **Android Live Activity — auto-advance**: When a prayer time passes while the app is in the background, the Live Activity foreground service now automatically advances to the next prayer and updates the notification without requiring the app to be opened.
- **Android Live Activity — compact mode permanent**: The compact single-row layout is now the permanent default; the compact mode toggle has been removed from settings.

## [2.1.1] — 2026-05-11

### Changed
- **Android Live Activity — localised notification strings**: Channel name, channel description, and FGS placeholder text are now translated into all 13 supported locales (ar, bn, de, es, fr, hi, id, ru, sv, tr, ur, zh) via Android `strings.xml` resources. Previously these were hardcoded English strings shown in Android Settings → Notifications.

## [2.1.0] — 2026-05-11

### Added
- **Android Live Activity — status-bar chip (Android 16+)**: The prayer countdown now appears as a Live Update chip in the Android 16 status bar alongside the clock. Implemented via `setRequestPromotedOngoing` and `setShortCriticalText` (reflected from `Notification.Builder` API 36).
- **Android Live Activity — dual-notification architecture**: The foreground service now posts two notifications — a minimal silent placeholder via `startForeground()` (keeps the process alive) and a rich chip notification via `notify()`. This is required because `FLAG_FOREGROUND_SERVICE` and `FLAG_PROMOTED_ONGOING` are mutually exclusive in Android 16's NMS; only `notify()` notifications can be promoted to the chip.
- **Android Live Activity — progress percentage**: The notification content text now shows the elapsed percentage (e.g. "52%") above the progress bar, giving a quick at-a-glance sense of where the prayer window stands.
- **Android Live Activity — compact single-row layout**: Prayer name and time are now combined on one line ("Asr · 17:08") instead of separate title/body rows, matching the clean Material style of system apps like EasyPark and Uber.
- **Android Live Activity — `POST_PROMOTED_NOTIFICATIONS` permission**: Declared in `AndroidManifest.xml`; auto-granted at install (`prot=normal|appop`). Required by Android 16's `api_rich_ongoing_permission` feature flag.
- **FGS channel `mihrab_fgs_v1`** (`IMPORTANCE_MIN`): Dedicated silent/hidden channel for the foreground-service placeholder notification so it never appears in the user-facing shade.

### Fixed
- **Android Live Activity — chip blocked by `FLAG_FOREGROUND_SERVICE`**: Previous single-FGS-notification approach permanently blocked chip promotion. Split into FGS placeholder + regular `notify()` chip notification.
- **Android Live Activity — `setSilent` compile error**: Removed `.setSilent(true)` from the platform `Notification.Builder` path (API 36); it only exists on `NotificationCompat.Builder`. The `mihrab_live_activity_v3` channel already sets `sound=null` and `vibration=false`.

### Changed
- **Android Live Activity — notification design**: Removed the InboxStyle prayer table from the expanded notification. The notification is now compact-only — a single title row + percentage text + progress bar + chronometer countdown — matching Material Design ongoing-activity conventions.

## [1.5.46] — 2026-04-28

### Fixed
- **Android medium widget — refresh button placement**: The ↻ button now sits in the empty space at the right end of the left panel, vertically centred next to the divider line. Previously it was at the top-right corner of the whole widget, floating above the prayer-times list.

## [1.5.45] — 2026-04-28

### Fixed
- **Android widgets — refresh on wallpaper/theme change**: All three widget variants (small, medium, large) now listen for `ACTION_WALLPAPER_CHANGED` and re-render immediately when the system wallpaper or Material You color palette changes. Previously the widget could stay the wrong accent color for up to 30 minutes.
- **Android widgets — refresh after reboot**: Widgets now listen for `ACTION_BOOT_COMPLETED` and repopulate as soon as the device finishes booting. Previously they stayed stale until the user opened the app or the 30-minute system timer fired.
- **Android widgets — prayer-time highlight advance**: The AlarmManager alarm that fires at each prayer time now refreshes all three widget variants. Previously it only targeted medium widgets, so small and large widgets kept the wrong prayer row highlighted after a prayer time passed.
- **Android widgets — screen-on refresh scope**: `ACTION_SCREEN_ON` and `ACTION_USER_PRESENT` now correctly refresh all three widget variants. Previously if only a small or large widget was on the home screen (no medium), the screen-on refresh was a no-op.
- **Android medium widget — refresh button overlap**: The refresh button (↻) was positioned inside the left panel at `top|start`, overlapping the prayer name on the narrow 4×1 layout. Moved to the top-right corner of the whole widget so it clears the left-side content.

## [1.5.44] — 2026-04-28

### Fixed
- **Android medium widget — wrong size**: On Android 12+ (API 31) the medium widget placed at 4×3 instead of 4×1 due to the `xml-v31/prayer_widget_info.xml` override pointing to the large widget layout (`prayer_widget`) with `targetCellHeight="3"`. Corrected to use `prayer_widget_horizontal` and `targetCellHeight="1"`.

### Changed
- **Android medium widget — design**: Redesigned to match the large widget's visual style — `sans-serif-light` time, `sans-serif-medium` all-caps prayer name, a thin vertical divider between the next-prayer panel and the prayer list. Right panel rows made more compact (equal 1:1 weight split, 4dp row padding) to fit the 4×1 height.

## [1.5.30] — 2026-04-27

### Fixed
- **iOS widget — build**: `.kerning()` called after `.foregroundStyle()` resolves to the SwiftUI View modifier (iOS 16+) rather than `Text.kerning(_:)` (iOS 13+). Moved all `.kerning()` calls to be the first modifier on each `Text` view so the compiler picks the correct iOS 13+ method.

## [1.5.29] — 2026-04-27

### Fixed
- **Android widget — New Architecture**: `NativeModules.PrayerWidget` is not accessible in React Native New Architecture (bridgeless mode). The widget sync now uses `TurboModuleRegistry.get()` as the primary lookup, falling back to `NativeModules` for older builds. Added `@ReactModule` annotation to `PrayerWidgetModule` for proper TurboModule registry discovery.

## [1.5.28] — 2026-04-27

### Fixed
- **Android widget — doesn't load**: `requestUpdate` was using `sendBroadcast` which can be silently dropped by battery optimisation on Android 8+. Replaced with direct `AppWidgetManager.updateAppWidget()` calls throughout. The configure activity now also directly refreshes the new widget on Save (instead of relying on the broadcast reaching the correct ID). Also fixed `setBackgroundResource(0)` → `setBackgroundColor(TRANSPARENT)` which could throw on some ROM variants.

## [1.5.27] — 2026-04-27

### Fixed
- **iOS widget — build**: `.tracking()` (SwiftUI letter-spacing modifier, iOS 16+ only) replaced with `.kerning()` (iOS 13+) so the Xcode Cloud archive compiles on the app's minimum deployment target.

## [1.5.26] — 2026-04-27

### Fixed
- **Widget — fresh install**: widget would show "Open Prayer Times to load times" even after the app had loaded prayer data. The widget data is now also synced every time the Home screen gains focus (e.g. when returning after placing the widget), guaranteeing the widget is populated within seconds of opening the app.

## [1.5.25] — 2026-04-27

### Fixed
- **F-Droid CI**: trailing space on a `sudo` curl line in the v1.5.21 build recipe caused `fdroid rewritemeta` to produce a diff and fail the pipeline; whitespace removed.

### Changed
- **Month view — layout**: prayer times now displayed in an aligned column grid (day label + 6 prayer columns with abbreviated headers) instead of a single joined string; each column has a fixed-width header; Sunrise column rendered muted italic.
- **Month view — today highlight**: today's row shows the accent background and a leading accent bar; Friday rows use the card background to distinguish the day of Jumu'ah.
- **Month view — controls**: month nav, "This Month", refresh, and "Share" toggle are now compact pills in a single row; provider info and cache count shown in one meta line; column headers are fixed below the controls (not part of the scrollable list).
- **Month view — auto-scroll**: list jumps to today's row on initial load.
- **Share image — banner**: header background changed to brand dark green (`#14532d`) to match app identity.
- **Share image — Sunrise column**: Sunrise times rendered muted italic in both the header and data rows of the shareable table.
- **Share image — GitHub URL**: corrected from `github.com/hassan/PrayerApp` to `github.com/Hassan-PS/PrayerApp`.

### Release builds
- Android `versionName` **1.5.25**, `versionCode` **48**.
- iOS `MARKETING_VERSION` **1.5.25**, `CURRENT_PROJECT_VERSION` **48**.

[1.5.25]: https://github.com/Hassan-PS/PrayerApp/compare/v1.5.24...v1.5.25

## [1.5.24] — 2026-04-27

### Changed
- **Home screen — Next prayer card**: redesigned hero card with prayer name and time side-by-side, a countdown pill, and platform-specific corner radius (iOS 20dp, Android 16dp).
- **Home screen — Prayer table**: Sunrise row is now rendered in muted italic to distinguish it as a reference time, not a salah. The active prayer row gains a 4dp accent bar on the leading edge.
- **Home screen — layout**: switched to `gap`-based spacing for consistent vertical rhythm; month shortcut moved below the prayer table and spans full width.
- **Navigation (iOS)**: large title headers enabled on all screens (`headerLargeTitle`), matching iOS HIG expectations.
- **Widget (Android)**: left panel uses `sans-serif-light` for the large time (more elegant), prayer name rendered uppercase with letter spacing, subtle vertical divider separates panels, right-side prayer list uses `sans-serif-medium` for clarity.
- **Widget (iOS — small)**: added "NEXT" micro-label, prayer name shown above the time, location shown uppercase with tracking at top.
- **Widget (iOS — medium/large)**: left panel restructured with location top, "NEXT" label, uppercase prayer name, and day label at bottom; large time uses `.light` weight. Highlighted row gains a 3dp leading accent bar alongside the background tint. Divider between panels.

### Release builds
- Android `versionName` **1.5.24**, `versionCode` **47**.
- iOS `MARKETING_VERSION` **1.5.24**, `CURRENT_PROJECT_VERSION` **47**.

[1.5.24]: https://github.com/Hassan-PS/PrayerApp/compare/v1.5.23...v1.5.24

## [1.5.23] — 2026-04-27

### Changed
- **Notification icon (Android)**: status-bar icon replaced with a mosque silhouette (dome + two minarets) for a more recognisable prayer app icon.
- **README**: store badge buttons rendered in a fixed horizontal row.

### Release builds
- Android `versionName` **1.5.23**, `versionCode` **46**.
- iOS `MARKETING_VERSION` **1.5.23**, `CURRENT_PROJECT_VERSION` **46**.

[1.5.23]: https://github.com/Hassan-PS/PrayerApp/compare/v1.5.22...v1.5.23

## [1.5.22] — 2026-04-27

### Fixed
- **Compass (iOS)**: native `CompassModule` is now null-checked before constructing `NativeEventEmitter`, preventing a crash on builds where the module is not registered.
- **Settings persistence**: storage write failures are now logged instead of silently swallowed, making AsyncStorage errors diagnosable.
- **Prayer cache**: background cache-write and refresh errors are now logged so storage failures don't go undetected.
- **UK prayer times (PrayerTimes.dev)**: date-part variables initialised to `undefined` instead of `0`, preventing a wrong-epoch timezone offset when `Intl.DateTimeFormat.formatToParts` partially fails.
- **Sweden prayer times**: times extracted by HTML scraping are validated to be in strict chronological order; an out-of-order result now throws rather than silently storing corrupted data.
- **Sweden reverse-geocoding cache**: capped at 200 entries (FIFO eviction) to prevent unbounded memory growth.
- **Widget highlight ID**: native Android widget appearance value is validated against known IDs before being written to settings, removing an unsafe `as any` cast.
- **Language persistence**: settings storage now recognises all 13 supported languages; previously only `en`, `sv`, and `ar` were accepted and other languages were silently reset to English on restart.
- **Midnight rollover**: home screen now detects when the calendar date has changed during an active session and re-fetches prayer times automatically.
- **Widget (iOS + Android)**: after Isha, the "next prayer" left panel no longer falls back to showing today's Fajr time (stale data); it now stays blank until the app syncs tomorrow's payload.
- **Widget `getSnapshot` (iOS)**: snapshot now computes the real dynamic next prayer instead of passing `nil`, so the widget preview reflects live data.
- **Widget comment**: corrected stale comment that said "Sunrise is omitted" when Sunrise has been included in the row list.
- **Widget description (iOS)**: updated App Store widget gallery description to reflect six displayed times including Sunrise.

### Changed
- **Sunrise row (widget)**: Sunrise is now rendered in muted colour when it is not the current next item, visually distinguishing it as a reference time rather than a daily salah — consistent on both iOS and Android.
- **Widget (iOS)**: added `systemSmall` family — a compact view showing location, next prayer name, and time.
- **Widget (iOS)**: `computeDynamicNext` extracted as a module-level function shared by both `getSnapshot` and `getTimeline`, eliminating duplicated logic.
- **Widget info (Android)**: added `targetCellWidth`/`targetCellHeight` and `maxResizeWidth`/`maxResizeHeight` for correct Android 12+ grid sizing.
- **CI**: `release-android.yml` now builds both the F-Droid APK (`assembleFdroidRelease`) and the Google Play AAB (`bundlePlayRelease`) and attaches both to the GitHub Release.
- **HTTP User-Agent**: updated version string from stale `1.4.9` to `1.5.22`.

### Release builds
- Android `versionName` **1.5.22**, `versionCode` **45**.
- iOS `MARKETING_VERSION` **1.5.22**, `CURRENT_PROJECT_VERSION` **45**.

[1.5.22]: https://github.com/Hassan-PS/PrayerApp/compare/v1.5.21...v1.5.22

## [1.4.9] — 2026-04-24

### Added
- **Settings**: installed version now includes a tappable GitHub link at the bottom.

### Changed
- **Android dynamic theme**: use higher-contrast container colors to avoid low-contrast text with Material You palettes.
- **Android widget**: Android 12+ widget metadata now marks the widget as reconfigurable so launcher settings affordance appears on long-press.
- **iOS widget**: use native widget container background and internal padding for consistent edge rendering.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.9**.

### Release builds
- Android `versionName` **1.4.9**, `versionCode` **22**.
- iOS `MARKETING_VERSION` **1.4.9**, `CURRENT_PROJECT_VERSION` **21**.

[1.4.9]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.8...v1.4.9

## [1.4.8] — 2026-04-22

### Added
- **Settings (Android + iOS)**: show installed app version/build at the bottom of the Settings screen.

### Changed
- **Notifications**: Adhan sound options are bundled in-app for Android/iOS; help text updated to reflect built-in sounds.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.8**.

### Release builds
- Android `versionName` **1.4.8**, `versionCode` **21**.
- iOS `MARKETING_VERSION` **1.4.8**, `CURRENT_PROJECT_VERSION` **20**.

[1.4.8]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.7...v1.4.8

## [1.4.6] — 2026-04-22

### Added
- **Notifications (Android + iOS)**: bundled built-in Adhan sound assets are now shipped in the app (`adhan_makkah`, `adhan_madina`, `adhan_aqsa`) so sound options work out of the box on every build.

### Changed
- **Notification sound picker** copy now confirms voices are built into the app build.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.6**.

### Release builds
- Android `versionName` **1.4.6**, `versionCode` **20**.
- iOS `MARKETING_VERSION` **1.4.6**, `CURRENT_PROJECT_VERSION` **19**.

[1.4.6]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.5...v1.4.6

## [1.4.5] — 2026-04-22

### Added
- **Notifications**: selectable alert sound profile with default notification sound plus Adhan voice options (Makkah, Madina, Al-Aqsa) in Settings.

### Changed
- **Android notifications**: prayer alerts now use a dedicated monochrome status-bar icon instead of the generic fallback circle.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.5**.

### Release builds
- Android `versionName` **1.4.5**, `versionCode` **19**.

[1.4.5]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.4...v1.4.5

## [1.4.4] — 2026-04-14

### Changed
- **Compass (iOS + Android)**: improved diagnostics for weak/very weak signal and unstable movement, with actionable calibration guidance (move away from metal/electronics, remove magnetic accessories, do a slow figure-8, hold steady).
- **iOS compass permission UX**: clearer startup prompt guidance and explicit denied-permission messaging with direct path to system settings.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.4**.

### Release builds
- Android `versionName` **1.4.4**, `versionCode` **18**.
- iOS `MARKETING_VERSION` **1.4.4**, `CURRENT_PROJECT_VERSION` **18**.

[1.4.4]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.3...v1.4.4

## [1.4.3] — 2026-04-12

### Added
- **iOS**: **WidgetKit extension** (`PrayerWidgetExtension`) embedded in the app — home screen widget matches Android (five prayers + next-prayer highlight) via App Group `group.com.prayerapp`.

### Changed
- **Portrait only**: iPhone/iPad app **portrait** orientation; Android `MainActivity` and widget configure activity use **`screenOrientation="portrait"`**.
- **System colors (Material You / dynamic palette)**: setting and palette path are **Android-only**. On **iOS**, System theme uses standard surfaces with **brand green** accents (same as Light/Dark accent behavior).
- **iOS**: optional **tip / IAP** UI is **omitted** (tips remain on Android Play builds only). Support copy no longer names other app stores.
- HTTP `User-Agent` prefix **PrayerTimes/1.4.3**.

### Release builds
- Android `versionName` **1.4.3**, `versionCode` **17**.
- iOS `MARKETING_VERSION` **1.4.3**, `CURRENT_PROJECT_VERSION` **17**.

[1.4.3]: https://github.com/Hassan-PS/PrayerApp/compare/v1.4.2...v1.4.3

## [1.3.7] — 2026-04-11

### Added
- **Android `fdroid` product flavor**: no Google Play Billing; F-Droid–friendly build (`assembleFdroidRelease`). **`play` flavor** unchanged for store/GitHub APK with optional tips.
- **Apache-2.0** [`LICENSE`](LICENSE) at repo root; `package.json` `license` field set.

### Changed
- **Donations / IAP**: hidden on **`fdroid`** builds via native `PrayerBuildInfo` + JS gating (`TipIapBootstrap` and settings “support developer” section omitted).
- **Android**: hardware back from Settings, Compass, and month view returns to the home screen instead of exiting the app.
- HTTP `User-Agent` prefix **PrayerTimes/1.3.7**.

### Release builds
- Android `versionName` **1.3.7**, `versionCode` **11** — **`play`** APK + **AAB** (Google Play), **`fdroid`** APK (F-Droid / sideload without billing).
- iOS `MARKETING_VERSION` **1.3.7**, `CURRENT_PROJECT_VERSION` **11** (build in Xcode for App Store / TestFlight).

[1.3.7]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.6...v1.3.7

## [1.3.6] — 2026-04-11

### Changed
- **App theme**: When **System colors** is off (or theme is not System), accents use the app’s **brand green** again; Material You / dynamic path unchanged when System + System colors are on.
- **Home screen widget**: **In-app Settings** again control widget options — Android **background strength**, **highlight** presets (green / teal / blue / amber) plus **custom `#RRGGBB`**, synced to the widget; **iOS** gets the same highlight options via the app group. Next-prayer row uses the **phone accent** only when Theme is **System** and **System colors** is on.
- **Android widget configure** (long-press → gear): **Custom color** field; “match phone accent” toggle removed (use app Theme → System colors).
- HTTP `User-Agent` prefix **PrayerTimes/1.3.6**.

### Release builds
- Android `versionName` **1.3.6**, `versionCode` **10** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.6]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.5...v1.3.6

## [1.3.5] — 2026-04-11

### Changed
- **App accents**: Light/Dark (non–System-colors) mode now uses the platform **primary / tint** (`colorPrimary` / `tintColor`) and **primary container** surfaces so the UI matches **Material You** and wallpaper-derived colors on Android 12+ instead of a fixed green.
- **Android widget**: **Configure** from the launcher (long-press widget → settings / gear, or when adding the widget). Native screen for background strength, highlight preset, and “match phone accent”. Removed duplicate widget controls from in-app Settings (short hint only).
- HTTP `User-Agent` prefix **PrayerTimes/1.3.5**.

### Release builds
- Android `versionName` **1.3.5**, `versionCode` **9** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.5]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.4...v1.3.5

## [1.3.4] — 2026-04-11

### Changed
- **App accents**: when system **dynamic colors** are off, UI accent uses brand **green** (`#6BC98A`) aligned with the widget and launcher; dynamic/Material You path unchanged when System colors are on.
- **Widget highlight**: with **System colors** on, **only the next-prayer row** uses the system accent (Android `system_accent1_600` / theme primary; iOS `Color.accentColor`); presets apply when dynamic is off.
- HTTP `User-Agent` prefix **PrayerTimes/1.3.4**.

### Release builds
- Android `versionName` **1.3.4**, `versionCode` **8** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.4]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.3...v1.3.4

## [1.3.3] — 2026-04-11

### Changed
- **Android home screen widget**: neutral dark background (not green-tinted); **only the next prayer** uses an accent color. **Settings** (Android): background strength (opacity) and next-prayer accent (green / teal / blue / amber), with an in-app preview.
- **Widget picker** (Android 12+): `previewLayout` shows sample prayer times in the widget gallery.
- **iOS widget**: same neutral shell with accent on the next prayer only (no extra settings yet).
- App **theme** copy updated so system/dynamic colors are described for the **app**; Android widget styling is separate.
- HTTP `User-Agent` prefix **PrayerTimes/1.3.3**.

### Release builds
- Android `versionName` **1.3.3**, `versionCode` **7** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.3]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.2...v1.3.3

## [1.3.2] — 2026-04-11

### Changed
- **Home screen widget** uses a fixed green-tinted look (aligned with the launcher icon) instead of following system / dynamic theme; next prayer is highlighted in **#6BC98A**.
- Launcher icon pipeline: master resize cap **2048px** and bicubic downscale for sharper mipmaps when the source asset is high resolution.
- HTTP `User-Agent` prefix **PrayerTimes/1.3.2**.

### Release builds
- Android `versionName` **1.3.2**, `versionCode` **6** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.2]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.1...v1.3.2

## [1.3.1] — 2026-04-11

### Changed
- **System colors** mode: stronger platform **background layering** (iOS grouped backgrounds; Android `colorSurface` vs `colorSurfaceContainerHighest`) so dynamic / Material You tints read more clearly.
- In system dynamic mode, **flat chrome**: no box borders or list hairlines; segmented controls use **filled** selection instead of accent outlines. Text fields rely on surface contrast instead of strokes.
- HTTP `User-Agent` prefix **PrayerTimes/1.3.1**.

### Release builds
- Android `versionName` **1.3.1**, `versionCode` **5** — **AAB** for Google Play, **APK** for GitHub Releases.

[1.3.1]: https://github.com/Hassan-PS/PrayerApp/compare/v1.3.0...v1.3.1

## [1.3.0] — 2026-04-11

### Added
- Optional **System colors** when the theme is set to System: platform semantic and dynamic colors (including Material You on Android) for the app and the home screen widget, with **Pure black (OLED)** still applied to backgrounds when enabled in dark mode.
- Widget appearance sync via native `setUiHints` when theme-related settings change (no need to reload prayer data first).

### Changed
- Android uses **Material 3** `DynamicColors` day/night theme so `PlatformColor` Material attributes resolve correctly.
- New launcher icon artwork; icon generator uses minimal zoom (1.0) for crop.
- HTTP `User-Agent` prefix updated to `PrayerTimes/1.3`.

### Release builds
- Android `versionName` **1.3**, `versionCode` **4** — release **AAB** for Google Play and **APK** for GitHub Releases.

[1.3.0]: https://github.com/Hassan-PS/PrayerApp/compare/v1.2.0...v1.3.0

## [1.2.0] — 2026-04-10

### Added
- In-app shortcut on Home for the full month view: calendar icon plus a clear label (translated: EN / SV / AR) so it is obvious that it opens prayer times for the whole month.
- `PRIVACY_POLICY.md` (Swedish and English) for store listings and transparency.

### Changed
- Settings control in the app bar uses a clearer cog-style icon instead of the previous shape that was easy to misread.
- On Home, the compass shortcut was removed from the row below the prayer times source; **Qibla** remains available from the top app bar next to Month and Settings.
- HTTP `User-Agent` for outbound requests (e.g. place search) updated to `PrayerTimes/1.2` to match the app version.

### Release builds
- Android `versionName` **1.2**, `versionCode` **3** — use the release **AAB** for Google Play and the **APK** for GitHub Releases or other distribution.

[1.2.0]: https://github.com/Hassan-PS/PrayerApp/compare/v1.1.0...v1.2.0
