// Continue Reading — the shortest path back into the habit.
//
// The app knows the last page read and, when a khatmah is running, whether
// today's portion is done. Everything here is one of those two states:
//
//   • a plan is running  → the plan's page, and today's portion as a fraction
//   • no plan            → the last page read, and when that was
//
// Which reader a tap opens is decided by the APP, not here: `reading.mode` is
// already resolved against both what the user last had open and whether the
// ~180 MB mushaf is on disk. A widget that sent someone to a download wall
// would be worse than one that opened the wrong reader.

import SwiftUI
import WidgetKit

struct ReadingEntry: TimelineEntry {
  let date: Date
  let reading: WidgetPayload.Reading?
}

struct ReadingProvider: TimelineProvider {
  func placeholder(in context: Context) -> ReadingEntry {
    ReadingEntry(date: Date(), reading: Self.sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
    completion(ReadingEntry(date: Date(), reading: loadReading() ?? Self.sample))
  }

  /// One entry, until just after midnight.
  ///
  /// A reading position moves when a page is turned, and every page turn
  /// already reloads the timelines. What changes unattended is the day: a
  /// khatmah's "today's portion" resets, and "2 days ago" becomes 3.
  func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
    let now = Date()
    let cal = Calendar.current
    let nextMidnight =
      cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 1), matchingPolicy: .nextTime)
      ?? now.addingTimeInterval(3600)
    completion(Timeline(
      entries: [ReadingEntry(date: now, reading: loadReading())],
      policy: .after(nextMidnight)
    ))
  }

  private func loadReading() -> WidgetPayload.Reading? {
    guard let json = UserDefaults(suiteName: kSuite)?.string(forKey: kKey),
          let data = json.data(using: .utf8),
          let p = try? JSONDecoder().decode(WidgetPayload.self, from: data)
    else { return nil }
    // This one is the least wrong when stale — "last read 40 days ago" is
    // true — but a khatmah's "today's portion" is not, and the deep link
    // would still be right. Held to the same rule as the rest.
    guard !payloadHasExpired(p) else { return nil }
    return p.reading
  }

  static let sample = WidgetPayload.Reading(
    surah: 2, surahName: "Al-Baqarah", ayah: 1, page: 3, juz: 1,
    pagesRead: 47, totalPages: 604, bookmarks: 3,
    lastReadAt: nil, mode: "mushaf",
    khatmah: .init(day: 14, targetDays: 30, pagesToday: 7, doneToday: 4, behindBy: 0, daysLeft: 16)
  )
}

struct ReadingEntryView: View {
  var entry: ReadingEntry
  @Environment(\.widgetFamily) var family

  /// Nothing has ever been read: no position, no bookmarks, no plan.
  ///
  /// The block used to be omitted entirely in that case and every family fell
  /// through to "Open Mihrab" — this widget dead for exactly the person whose
  /// habit it exists to restart. It says something now instead.
  private var notStarted: Bool {
    guard let r = entry.reading else { return false }
    return r.started == false
  }

  var body: some View {
    switch family {
    case .accessoryInline:
      Text(verbatim: notStarted
        ? widgetString("widget_reading_read_quran")
        : (entry.reading.map { widgetString("widget_reading_page_surah", $0.page, $0.surahName) }
           ?? widgetString("app_name")))
    case .accessoryRectangular:
      if notStarted { startBody } else { rectangularBody }
    case .systemMedium:
      if notStarted { startBody } else { mediumBody }
    default:
      if notStarted { startBody } else { smallBody }
    }
  }

  /// The invitation. Deliberately not a progress view of zero: a bar with
  /// nothing in it reads as failure, and there is nothing here to have
  /// failed at yet.
  @ViewBuilder
  private var startBody: some View {
    VStack(alignment: .leading, spacing: 0) {
      widgetText("widget_reading_header_start")
        .kerning(0.8)
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(widgetMuted)
        .lineLimit(1)
      Spacer(minLength: 4)
      widgetText("widget_reading_start_title")
        .font(.system(size: 20, weight: .semibold))
        .foregroundStyle(widgetText)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
      Text(entry.reading?.downloaded == true
           ? "widget_reading_start_note"
           : "widget_reading_start_note_undownloaded")
        .font(.system(size: 11))
        .foregroundStyle(widgetMuted)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
        .padding(.top, 2)
      widgetText("widget_reading_start_tail")
        .font(.system(size: 10))
        .foregroundStyle(widgetMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .padding(.top, 1)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  // MARK: - systemSmall

  @ViewBuilder
  private var smallBody: some View {
    if let r = entry.reading {
      VStack(alignment: .leading, spacing: 0) {
        Text(headerLabel(r))
          .kerning(0.8)
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(widgetMuted)
          .lineLimit(1)
          .minimumScaleFactor(0.7)

        Spacer(minLength: 4)

        Text(r.surahName)
          .font(.system(size: 20, weight: .bold))
          .foregroundStyle(widgetText)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Text(verbatim: widgetString("widget_reading_position", r.page, r.juz))
          .font(.system(size: 12))
          .foregroundStyle(widgetMuted)
          .lineLimit(1)

        Spacer(minLength: 4)

        progressBar(r)
          .padding(.bottom, 4)
        Text(verbatim: progressLine(r))
          .font(.system(size: 10))
          .foregroundStyle(widgetMuted)
          .lineLimit(1)
          .minimumScaleFactor(0.8)

        Spacer(minLength: 4)

        footer(r)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .padding(14)
      .widgetURL(readingURL(r))
    } else {
      emptyBody
    }
  }

  // MARK: - systemMedium

  /// Same facts, side by side: where you are on the left, how the plan is
  /// going on the right. Without a plan the right column is the bookmark
  /// count and when this was last touched — which is all there is to say.
  @ViewBuilder
  private var mediumBody: some View {
    if let r = entry.reading {
      HStack(alignment: .top, spacing: 14) {
        VStack(alignment: .leading, spacing: 0) {
          Text(headerLabel(r))
            .kerning(0.8)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(widgetMuted)
            .lineLimit(1)
          Spacer(minLength: 4)
          // The surah, and the one control on this card — issue #25.
          //
          // MEDIUM ONLY, and not by choice. A widget gets one tap target
          // unless a `Link` carves out another, and `Link` is honoured on
          // systemMedium and systemLarge alone: on systemSmall and on both
          // accessory families the system routes every tap to `widgetURL`,
          // so a play button drawn there would silently open the reader
          // instead of playing. A control that does the wrong thing is
          // worse than one that is not offered, so the small and lock
          // screen cards stay a single tap that opens the page, and
          // Android — whose RemoteViews take a click per view — carries it
          // at every size.
          HStack(alignment: .center, spacing: 8) {
            Text(r.surahName)
              .font(.system(size: 22, weight: .bold))
              .foregroundStyle(widgetText)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
              .frame(maxWidth: .infinity, alignment: .leading)
            if let play = playURL(r) {
              Link(destination: play) {
                Image(systemName: "play.fill")
                  .font(.system(size: 12, weight: .bold))
                  .foregroundStyle(resolvedWidgetHighlightColor())
                  .frame(width: 32, height: 32)
                  .background(
                    Circle().fill(resolvedWidgetHighlightColor().opacity(0.18))
                  )
                  .overlay(
                    Circle().stroke(
                      resolvedWidgetHighlightColor().opacity(0.45),
                      lineWidth: 1
                    )
                  )
              }
              .accessibilityLabel(Text(verbatim: widgetString("widget_reading_play")))
            }
          }
          Text(verbatim: widgetString("widget_reading_position", r.page, r.juz))
            .font(.system(size: 12))
            .foregroundStyle(widgetMuted)
          Spacer(minLength: 8)
          progressBar(r)
            .padding(.bottom, 4)
          Text(verbatim: progressLine(r))
            .font(.system(size: 10))
            .foregroundStyle(widgetMuted)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
          // With a plan running the right column has taken "today", so the
          // last-read line has nowhere else to be — and without it this
          // column stops a third of the way up a card that is taller than
          // its content. Information rather than air.
          if r.khatmah != nil, let tail = lastReadTail(r) {
            Text(verbatim: tail)
              .font(.system(size: 10))
              .foregroundStyle(widgetMuted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
              .padding(.top, 2)
          }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)

        VStack(alignment: .leading, spacing: 2) {
          if let k = r.khatmah {
            widgetText("widget_reading_today_portion")
              .kerning(0.8)
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(widgetMuted)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
              Text(verbatim: "\(k.doneToday)")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(widgetText)
              Text(verbatim: "/ \(k.pagesToday)")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(widgetMuted)
            }
            // Two short complete lines rather than one long one wrapping
            // mid-phrase: this column is 110pt and "On track · 21 pages left"
            // breaks after "21", which reads as a layout accident.
            ForEach(Array(planStatusLines(k).enumerated()), id: \.offset) { _, line in
              Text(verbatim: line)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(k.behindBy > 0 ? behindColor : resolvedWidgetHighlightColor())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
          } else {
            widgetText("widget_reading_last_read")
              .kerning(0.8)
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(widgetMuted)
            Text(verbatim: lastReadPhrase(r) ?? "—")
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(widgetText)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
            if r.bookmarks > 0 {
              Text(verbatim: widgetString("widget_reading_bookmarks", r.bookmarks))
                .font(.system(size: 11))
                .foregroundStyle(widgetMuted)
                .lineLimit(1)
            }
            Spacer(minLength: 0)
          }
        }
        .frame(width: 118, alignment: .leading)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(14)
      .widgetURL(readingURL(r))
    } else {
      emptyBody
    }
  }

  // MARK: - accessoryRectangular

  @ViewBuilder
  private var rectangularBody: some View {
    if let r = entry.reading {
      VStack(alignment: .leading, spacing: 1) {
        Text(headerLabel(r))
          .kerning(0.8)
          .font(.system(size: 10, weight: .semibold))
          .lineLimit(1)
        Text(r.surahName)
          .font(.system(size: 16, weight: .semibold))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(verbatim: r.khatmah
          .map { widgetString("widget_reading_page_today", r.page, $0.doneToday, $0.pagesToday) }
          ?? widgetString("widget_reading_position", r.page, r.juz))
          .font(.system(size: 11))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
    } else {
      widgetText("widget_placeholder_open_app").font(.system(size: 12))
    }
  }

  // MARK: - Shared

  /// The bottom two lines of the small card: what the plan asks of today, or
  /// — with no plan — when this was last touched and how many bookmarks are
  /// waiting. Two lines either way, so the card does not change height.
  @ViewBuilder
  private func footer(_ r: WidgetPayload.Reading) -> some View {
    if let k = r.khatmah {
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        widgetText("widget_reading_today")
          .font(.system(size: 10))
          .foregroundStyle(widgetMuted)
        Text(verbatim: "\(k.doneToday)/\(k.pagesToday)")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(widgetText)
      }
      Text(verbatim: planStatus(k))
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(k.behindBy > 0 ? behindColor : resolvedWidgetHighlightColor())
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    } else {
      if let phrase = lastReadPhrase(r) {
        Text(verbatim: phrase)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(widgetText)
          .lineLimit(1)
      }
      Text(verbatim: r.bookmarks > 0
        ? widgetString("widget_reading_bookmarks", r.bookmarks)
        : widgetString("widget_reading_no_bookmarks"))
        .font(.system(size: 10))
        .foregroundStyle(widgetMuted)
        .lineLimit(1)
    }
  }

  /// "KHATMAH · DAY 14/30" with a plan, "CONTINUE" without one.
  private func headerLabel(_ r: WidgetPayload.Reading) -> String {
    guard let k = r.khatmah else { return widgetString("widget_reading_continue") }
    return widgetString("widget_reading_khatmah_day", k.day, k.targetDays)
  }

  /// "47 of 604 · 8% read".
  private func progressLine(_ r: WidgetPayload.Reading) -> String {
    let pct = r.totalPages > 0 ? Int((Double(r.pagesRead) / Double(r.totalPages) * 100).rounded()) : 0
    return widgetString("widget_reading_progress", r.pagesRead, r.totalPages, pct)
  }

  /// A hairline of progress. Two pages out of 604 is 0.3% — too thin to be a
  /// rectangle at all — so the fill has a floor: the bar's job is to say
  /// "you have started", and a bar with nothing in it says the opposite.
  @ViewBuilder
  private func progressBar(_ r: WidgetPayload.Reading) -> some View {
    let raw = r.totalPages > 0 ? Double(r.pagesRead) / Double(r.totalPages) : 0
    let shown = r.pagesRead > 0 ? max(0.03, min(1, raw)) : 0
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule()
          .fill(widgetMuted.opacity(0.25))
        Capsule()
          .fill(resolvedWidgetHighlightColor())
          .frame(width: geo.size.width * shown)
      }
    }
    .frame(height: 3)
  }

  /// "On track · 3 pages left", or how far behind the plan has slipped.
  private func planStatus(_ k: WidgetPayload.Khatmah) -> String {
    planStatusLines(k).joined(separator: " · ")
  }

  /// The same thing as separate lines, for the narrow column.
  private func planStatusLines(_ k: WidgetPayload.Khatmah) -> [String] {
    let left = max(0, k.pagesToday - k.doneToday)
    if k.behindBy > 0 {
      return [widgetString("widget_reading_behind", k.behindBy)]
    }
    if left == 0 { return ["Done for today"] }
    return [widgetString("widget_reading_left", left)]
  }

  /// "Last read today · 3 bookmarks", dropping whichever half is unknown.
  private func lastReadTail(_ r: WidgetPayload.Reading) -> String? {
    var parts: [String] = []
    if let phrase = lastReadPhrase(r) {
      parts.append(widgetString("widget_reading_last_read_prefix", phrase.lowercased()))
    }
    if r.bookmarks > 0 {
      parts.append(widgetString("widget_reading_bookmarks", r.bookmarks))
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// "today" / "yesterday" / "4 days ago". Never "0 days ago".
  private func lastReadPhrase(_ r: WidgetPayload.Reading) -> String? {
    guard let ms = r.lastReadAt else { return nil }
    let then = Date(timeIntervalSince1970: ms / 1000)
    let cal = Calendar.current
    let days = cal.dateComponents([.day], from: cal.startOfDay(for: then), to: cal.startOfDay(for: entry.date)).day ?? 0
    switch days {
    case ..<1: return widgetString("widget_reading_today")
    case 1: return widgetString("widget_reading_yesterday")
    default: return widgetString("widget_reading_days_ago", days)
    }
  }

  /// mihrab://read/2?initialPage=3 or ?scrollToAyah=1 — the surah screen
  /// picks its reader from which of the two it is given, which is why the
  /// app resolves `mode` rather than this side guessing.
  private func readingURL(_ r: WidgetPayload.Reading) -> URL? {
    let position = r.mode == "mushaf" ? "initialPage=\(r.page)" : "scrollToAyah=\(r.ayah)"
    return URL(string: "mihrab://read/\(r.surah)?\(position)")
  }

  /// The same destination, arriving out loud — issue #25.
  ///
  /// `playFromAyah` rides alongside the position above rather than
  /// replacing it: the muṣḥaf still opens on its page and the translation
  /// reader on its ayah, and recitation begins at an ayah either way. So
  /// the ayah goes every time, whichever reader the app resolved.
  private func playURL(_ r: WidgetPayload.Reading) -> URL? {
    let position = r.mode == "mushaf" ? "initialPage=\(r.page)" : "scrollToAyah=\(r.ayah)"
    return URL(string: "mihrab://read/\(r.surah)?\(position)&playFromAyah=\(r.ayah)")
  }

  /// The same amber the Log screen marks a slipping plan with.
  private var behindColor: Color {
    Color(red: 217 / 255, green: 119 / 255, blue: 6 / 255)
  }

  private var emptyBody: some View {
    VStack(spacing: 2) {
      widgetText("widget_placeholder_open_app")
        .font(.caption)
        .foregroundStyle(widgetMuted)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct ReadingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MihrabReading", provider: ReadingProvider()) { entry in
      ReadingEntryView(entry: entry)
        .modifier(WidgetBackgroundCompatModifier())
        // The app has its own language setting; this is what makes the
        // labels below follow it rather than the phone. See mihrabLocale().
        .environment(\.locale, mihrabLocale())
    }
    .configurationDisplayName(widgetGalleryName("widget_name_reading"))
    .description(widgetString("widget_ios_description_reading"))
    .supportedFamilies(readingFamilies())
  }

  private func readingFamilies() -> [WidgetFamily] {
    #if targetEnvironment(macCatalyst)
    return [.systemSmall, .systemMedium]
    #else
    return [.systemSmall, .systemMedium, .accessoryInline, .accessoryRectangular]
    #endif
  }
}
