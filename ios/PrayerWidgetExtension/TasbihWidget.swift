// Tasbih — the best possible fit for an interactive widget.
//
// One target, one number, no navigation. Count on the left, controls on the
// right; grown to systemMedium because three 20pt tap targets do not fit in a
// small and a control you have to aim at is not a control.
//
// THE QUEUE IS AN ORDERED LOG, not a set. Tapping Fajr twice on Log Today
// means Fajr; tapping +1 twice here means two. So the rules differ from that
// widget's in one way that matters: nothing is de-duplicated and order is the
// answer. `+1 +1 next +1` is two beads on one dhikr and one on the next.
//
// Rules mirrored from `src/widget/widgetTasbihQueue.ts`, whose tests decide
// what they are. Two behaviours are worth naming because they are easy to get
// wrong and invisible when you do:
//
//   • a bounded preset stops at its target. The preset's own
//     `unboundedAfterTarget` says which are which, and the payload carries it.
//   • Next keeps a part-finished count. Moving on must not discard it — that
//     is what the screen does, and a widget quietly throwing away 27 beads is
//     the worse surprise.

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Queue

enum WidgetTasbihQueue {
  static let key = "widget_tasbih_queue"
  static let actions = ["inc", "reset", "next"]

  /// One action, and how many times it was tapped in a row.
  ///
  /// A run is one record whose count goes up rather than a record per bead,
  /// so a tap costs the same on bead three thousand as on bead one. `t` is
  /// the run's NEWEST tap, so a sitting that crosses the fortnight cutoff is
  /// not thrown away while it is still being counted. Mirrors
  /// `widgetTasbihQueue.ts`, which is where the rules are decided.
  struct Entry: Codable, Equatable {
    let a: String
    let t: Double
    /// Absent means one tap — every entry written before runs existed.
    var n: Int?
  }

  /// A bound on what a corrupted queue can ask the drain to replay, not a
  /// limit anyone counting can reach. Mirrors MAX_TASBIH_RUN.
  static let maxRun = 100_000

  static func runLength(_ e: Entry) -> Int { min(maxRun, max(1, e.n ?? 1)) }

  /// Fold every run of adjacent `+1`s into one entry.
  ///
  /// ADJACENT is the whole rule: `inc inc next inc` is two beads on one
  /// dhikr and one on the next. Run over the whole queue on every append,
  /// so a queue written by an older build — a record per bead — is left
  /// compact by the first tap after an update rather than carrying the old
  /// cost for as long as it survives.
  static func compact(_ entries: [Entry]) -> [Entry] {
    var out: [Entry] = []
    for e in entries {
      if e.a == "inc", let last = out.last, last.a == "inc" {
        out[out.count - 1] = Entry(
          a: "inc",
          t: max(last.t, e.t),
          n: min(maxRun, runLength(last) + runLength(e))
        )
      } else {
        out.append(e)
      }
    }
    return out
  }

  private static func defaults() -> UserDefaults? { UserDefaults(suiteName: kSuite) }

  static func read() -> [Entry] {
    guard let raw = defaults()?.string(forKey: key),
          let data = raw.data(using: .utf8),
          let decoded = try? JSONDecoder().decode([Entry].self, from: data)
    else { return [] }
    return decoded.filter { actions.contains($0.a) && $0.t > 0 }
  }

  /// The most taps this queue holds before it starts forgetting the oldest.
  ///
  /// This one grows a bead at a time — a round is thirty-three — so a
  /// fortnight of counting on the widget without opening the app is tens of
  /// thousands of entries, every one of them re-encoded on the next tap
  /// inside a widget extension that is given milliseconds to live. The drain
  /// discards anything older than fourteen days regardless, so entries past
  /// this point were never going to be written down.
  static let maxEntries = 4000

  /// See WidgetLogQueue.tap for why `synchronize()` is here.
  ///
  /// AND WHY IT NOW SAYS WHETHER IT WORKED. This queue had the same silence
  /// the log queue used to: `set` and `synchronize` both "succeed" on a
  /// group the process cannot actually write, and the only symptom is a
  /// bead that does not count. On the Mac where the log-queue failure was
  /// reported, `widget_tasbih_queue` is missing from the group container
  /// too — so this is very likely one fault showing up on two widgets, and
  /// a tap on either should now leave a line. `notice`, not `info`, so a
  /// plain `log show` finds it; see WidgetLogQueue.swift for what that
  /// distinction cost the first time.
  static func append(_ action: String, now: Double = Date().timeIntervalSince1970 * 1000) {
    guard actions.contains(action) else { return }
    // A `+1` on the back of a `+1` bumps the run rather than starting a
    // second record: two taps are still two beads, they are just written
    // down together. Only `inc` coalesces — two Nexts move two presets on.
    let next = compact(read() + [Entry(a: action, t: now)]).suffix(maxEntries).map { $0 }
    guard let data = try? JSONEncoder().encode(next),
          let s = String(data: data, encoding: .utf8)
    else {
      widgetLogLog.error(
        "tasbih \(action, privacy: .public): could not encode \(next.count, privacy: .public) entr(ies)")
      return
    }
    guard let store = defaults() else {
      widgetLogLog.error(
        "tasbih \(action, privacy: .public): no UserDefaults for suite \(kSuite, privacy: .public)")
      return
    }
    store.set(s, forKey: key)
    store.synchronize()
    if read().count == next.count {
      widgetLogLog.notice(
        "tasbih \(action, privacy: .public) queued, queue now \(next.count, privacy: .public)")
    } else {
      widgetLogLog.error(
        "tasbih \(action, privacy: .public): WRITE DROPPED — suite \(kSuite, privacy: .public) accepted \(next.count, privacy: .public) entr(ies) and read back \(self.read().count, privacy: .public)")
    }
    // Same reason as the log queue: the drain runs on app mount and on
    // AppState `active`, and a widget tap is neither. On a Mac the app is
    // usually already active when Notification Center is open, so without
    // this a bead counted here waits for a relaunch — and the drain discards
    // anything older than a fortnight. See postWidgetQueueChanged.
    postWidgetQueueChanged()
  }
}

// MARK: - Intents

@available(iOS 17.0, *)
struct TasbihActionIntent: AppIntent {
  static var title: LocalizedStringResource = "widget_intent_tasbih"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Action")
  var action: String

  init() {}
  init(action: String) { self.action = action }

  func perform() async throws -> some IntentResult {
    WidgetTasbihQueue.append(action)
    WidgetCenter.shared.reloadTimelines(ofKind: "MihrabTasbih")
    return .result()
  }
}

// MARK: - Timeline

struct TasbihEntry: TimelineEntry {
  let date: Date
  let tasbih: WidgetPayload.Tasbih?
  /// The payload with this device's queued taps replayed over it.
  let index: Int
  let counts: [Int]
  let todayTotal: Int
}

struct TasbihProvider: TimelineProvider {
  func placeholder(in context: Context) -> TasbihEntry { entry(fallback: true) }

  func getSnapshot(in context: Context, completion: @escaping (TasbihEntry) -> Void) {
    completion(entry(fallback: true))
  }

  /// One entry. A counter changes when it is tapped, and a tap reloads the
  /// timeline; nothing about it moves on its own.
  func getTimeline(in context: Context, completion: @escaping (Timeline<TasbihEntry>) -> Void) {
    // `.never` meant exactly that: once the payload behind this card expired,
    // nothing on the system would ever run this provider again, and the
    // widget sat on a dead entry until the user tapped it or opened the app.
    // Every other widget here rolls itself forward; this one has to as well.
    // An hour is generous for a bead counter — nothing about it changes
    // faster than the user's own taps, which reload directly — and it is what
    // brings the card to the "Open Mihrab" state on its own once the schedule
    // it is drawn beside has run out.
    let refresh = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
      ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [entry(fallback: false)], policy: .after(refresh)))
  }

  private func entry(fallback: Bool) -> TasbihEntry {
    let t = loadTasbih() ?? (fallback ? Self.sample : nil)
    guard let t else {
      return TasbihEntry(date: Date(), tasbih: nil, index: 0, counts: [], todayTotal: 0)
    }
    let projected = Self.project(t, WidgetTasbihQueue.read())
    return TasbihEntry(
      date: Date(),
      tasbih: t,
      index: projected.index,
      counts: projected.counts,
      todayTotal: projected.todayTotal
    )
  }

  /// Mirrors `projectTasbih` in widgetTasbihQueue.ts. See that file's tests.
  static func project(
    _ t: WidgetPayload.Tasbih,
    _ queue: [WidgetTasbihQueue.Entry]
  ) -> (index: Int, counts: [Int], todayTotal: Int) {
    var index = t.index
    var counts = t.counts
    var todayTotal = t.todayTotal
    for e in queue {
      let times = WidgetTasbihQueue.runLength(e)
      switch e.a {
      case "inc":
        let current = index < counts.count ? counts[index] : 0
        // The rules that apply are the CURRENT index's, which Next may have
        // moved inside this very loop — see the arrays on the payload.
        let target = t.targets?[safe: index] ?? t.target
        let unbounded = t.unboundedFlags?[safe: index] ?? t.unbounded
        // Arithmetic rather than a loop, landing on exactly what the loop
        // landed on: a run of a thousand against a target three away adds
        // three.
        let room = (!unbounded && target > 0) ? max(0, target - current) : times
        let applied = min(times, room)
        if applied > 0 {
          if index < counts.count { counts[index] = current + applied }
          todayTotal += applied
        }
      case "reset":
        // Resetting twice is resetting.
        if index < counts.count { counts[index] = 0 }
      case "next":
        index = t.total > 0 ? (index + times) % t.total : index
      default:
        break
      }
    }
    return (index, counts, todayTotal)
  }

  private func loadTasbih() -> WidgetPayload.Tasbih? {
    guard let json = UserDefaults(suiteName: kSuite)?.string(forKey: kKey),
          let data = json.data(using: .utf8),
          let p = try? JSONDecoder().decode(WidgetPayload.self, from: data)
    else { return nil }
    // The counts survive, but "Today 231" from a payload written weeks ago
    // is some other day's total. See payloadHasExpired.
    guard !payloadHasExpired(p) else { return nil }
    return p.tasbih
  }

  static let sample = WidgetPayload.Tasbih(
    presetId: "subhanallah",
    label: "SubhanAllah",
    arabic: "سُبْحَانَ ٱللَّٰهِ",
    count: 27,
    target: 33,
    unbounded: false,
    index: 0,
    total: 6,
    counts: [27, 0, 0, 0, 0, 0],
    labels: ["SubhanAllah", "Alhamdulillah", "Allahu Akbar", "La ilaha illa Allah", "Astaghfirullah", "Salawat"],
    targets: [33, 33, 34, 100, 100, 0],
    unboundedFlags: [false, false, false, false, false, true],
    todayTotal: 231,
    todayRounds: 2
  )
}

/// Bounds-checked subscript. The arrays come from another process and a
/// mismatched length must render as "fall back", not as a crash on a home
/// screen where there is nothing to report the crash to.
extension Array {
  subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}

// MARK: - View

struct TasbihEntryView: View {
  var entry: TasbihEntry

  /// The active count after the queue, not the payload's — the number has to
  /// move on the same frame as the tap.
  private var count: Int {
    entry.index < entry.counts.count ? entry.counts[entry.index] : (entry.tasbih?.count ?? 0)
  }

  /// The dhikr the widget is STANDING ON, which after a queued Next is not
  /// the one the payload calls active.
  private var label: String {
    entry.tasbih?.labels?[safe: entry.index] ?? entry.tasbih?.label ?? ""
  }

  private var target: Int {
    entry.tasbih?.targets?[safe: entry.index] ?? entry.tasbih?.target ?? 0
  }

  private var unbounded: Bool {
    entry.tasbih?.unboundedFlags?[safe: entry.index] ?? entry.tasbih?.unbounded ?? false
  }

  private var complete: Bool {
    target > 0 && count >= target
  }

  var body: some View {
    if let t = entry.tasbih {
      HStack(alignment: .center, spacing: 12) {
        countColumn(t)
        controlColumn(t)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      .padding(12)
      .widgetURL(URL(string: "mihrab://tasbih"))
    } else {
      widgetText("widget_placeholder_open_app")
        .font(.caption)
        .foregroundStyle(widgetMuted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  @ViewBuilder
  private func countColumn(_ t: WidgetPayload.Tasbih) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(label)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(widgetMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(verbatim: "\(count)")
          .font(.system(size: 40, weight: .bold))
          .foregroundStyle(widgetText)
          .lineLimit(1)
          .minimumScaleFactor(0.5)
        Text(verbatim: target > 0 ? widgetString("widget_tasbih_of", target) : "")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(complete ? resolvedWidgetHighlightColor() : widgetMuted)
          .lineLimit(1)
      }
      if complete {
        Text(unbounded ? "widget_tasbih_keep_going" : "widget_tasbih_complete")
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(resolvedWidgetHighlightColor())
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      Spacer(minLength: 4)
      Text(verbatim: footerLine(t))
        .font(.system(size: 10))
        .foregroundStyle(widgetMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      // Position in the cycle, so Next has somewhere visible to move.
      HStack(spacing: 3) {
        ForEach(0..<max(1, t.total), id: \.self) { i in
          Circle()
            .fill(i == entry.index ? resolvedWidgetHighlightColor() : widgetMuted.opacity(0.35))
            .frame(width: 4, height: 4)
        }
      }
      .padding(.top, 3)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func controlColumn(_ t: WidgetPayload.Tasbih) -> some View {
    VStack(spacing: 6) {
      // +1 is the one people press, so it is the one that is big. Disabled
      // rather than hidden when a bounded preset is finished: a control that
      // vanishes mid-round moves the other two under your thumb.
      control(
        label: "+1",
        action: "inc",
        prominent: true,
        enabled: !(complete && !unbounded)
      )
      HStack(spacing: 6) {
        control(label: "Reset", action: "reset", prominent: false, enabled: true)
        control(label: "Next ›", action: "next", prominent: false, enabled: true)
      }
    }
    .frame(width: 132)
  }

  @ViewBuilder
  private func control(label: String, action: String, prominent: Bool, enabled: Bool) -> some View {
    if #available(iOSApplicationExtension 17.0, *), enabled {
      Button(intent: TasbihActionIntent(action: action)) {
        controlBody(label, prominent: prominent, enabled: true)
      }
      .buttonStyle(.plain)
    } else {
      // iOS 16 has no Button(intent:). The card still deep-links to the
      // Tasbih screen, which is where counting works.
      controlBody(label, prominent: prominent, enabled: enabled)
    }
  }

  @ViewBuilder
  private func controlBody(_ label: String, prominent: Bool, enabled: Bool) -> some View {
    Text(label)
      .font(.system(size: prominent ? 20 : 12, weight: .semibold))
      .foregroundStyle(
        !enabled ? widgetMuted.opacity(0.5)
          : prominent ? resolvedWidgetHighlightColor() : widgetText
      )
      .frame(maxWidth: .infinity)
      .padding(.vertical, prominent ? 12 : 7)
      .background(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(prominent
                ? resolvedWidgetHighlightColor().opacity(enabled ? 0.18 : 0.07)
                : widgetMuted.opacity(0.16))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .strokeBorder(
            prominent
              ? resolvedWidgetHighlightColor().opacity(enabled ? 0.45 : 0.18)
              : widgetMuted.opacity(0.3),
            lineWidth: 1
          )
      )
  }

  /// "Today 231 · round 3 of 3" — the two facts the screen keeps that a
  /// single count cannot say on its own.
  private func footerLine(_ t: WidgetPayload.Tasbih) -> String {
    var parts = ["Today \(entry.todayTotal)"]
    if t.todayRounds > 0 {
      parts.append("\(t.todayRounds) \(t.todayRounds == 1 ? "round" : "rounds")")
    }
    return parts.joined(separator: " · ")
  }
}

struct TasbihWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MihrabTasbih", provider: TasbihProvider()) { entry in
      TasbihEntryView(entry: entry)
        .modifier(WidgetBackgroundCompatModifier())
        // The app has its own language setting; this is what makes the
        // labels below follow it rather than the phone. See mihrabLocale().
        .environment(\.locale, mihrabLocale())
    }
    .configurationDisplayName(widgetGalleryName("widget_name_tasbih"))
    .description(widgetString("widget_ios_description_tasbih"))
    .supportedFamilies([.systemMedium])
  }
}
