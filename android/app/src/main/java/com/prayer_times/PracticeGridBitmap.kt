package com.prayer_times

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

/**
 * The practice graph, drawn once into a Bitmap.
 *
 * RemoteViews has a fixed view vocabulary and no loops: seventy squares means
 * seventy TextViews declared by hand in XML, each addressed by a generated id,
 * and every update crossing the process boundary as seventy separate actions.
 * A Bitmap is one action and one object, and the drawing is a dozen lines.
 *
 * THE GRID IS A CALENDAR, NOT A LIST. `practice.days` is SPARSE — the payload
 * writer omits days with nothing recorded and stamps every entry it does send
 * with its own date (`d`), because a dense ninety-eight-day array costs more
 * than the payload budget allows. This used to walk the array positionally and
 * pack entry `i` into cell `i`, which is only ever right for an unbroken run:
 * one skipped day slid every square after it one place along, and the widget
 * drew a record the Log screen had never shown. Look the day up by its date,
 * the way iOS's PracticeGrid does, and a gap is a gap.
 *
 * A RUN OF DAYS, READ LIKE A SENTENCE. It was seven rows of week-columns —
 * the shape the in-app heatmap uses — and on a home screen that shape costs
 * more than it returns: seven rows in the height a card can spare makes
 * every day a speck, and to reach the card's far edge it takes six months of
 * them, so the graph was mostly a wall of history nobody was looking at,
 * drawn too small to read. The days run left to right now and wrap like
 * text, the last cell is today, and the cell is big enough to have a mark on
 * it that means something. The weekly rhythm is gone; on a surface with no
 * legend and no tap, being able to see last week at all is worth more.
 *
 * THE WIDTH DECIDES THE CELL AND THE HEIGHT DECIDES THE ROWS. Those are the
 * two things a card can say about its shape, and the one it can say
 * accurately is its width — the height it reports is the launcher's figure
 * for the host view less whatever chrome the card believes it draws. So the
 * cell is the width divided among as many columns as fit, which lands the
 * grid flush on both edges whatever the height turns out to be, and the
 * height only decides how many rows of that cell there is room for. Shrink
 * the card and it loses a row rather than shrinking every day in it.
 *
 * FOUR CHANNELS, the same four the Log screen uses: fill depth for the
 * prayers, an outer amber ring for a completed fast, an inset gold line for
 * how much sunnah the day held, and a grey corner dot for a day inside the
 * record that was never filled in. Anything the app draws in a fifth
 * channel — the qiyam mark, the selection — is left out: a home screen has
 * no legend and no tap, and a mark nobody can decode is noise.
 *
 * The ramp is the same one SwiftUI's PracticeGrid uses:
 * `alpha = 0.42 + 0.58 * (kept / 5)` on the accent, so one prayer is faintly
 * there rather than invisible and five is solid. A missed day is the danger
 * colour at low alpha — a different KIND of day, not a fainter good one.
 */
object PracticeGridBitmap {

  /**
   * A sanity bound on the rows, not a design number.
   *
   * The row count is the height divided by a cell — make the card taller
   * and it grows a row, shorter and it loses one, and the cells stay the
   * size they were either way. That is the difference between a shorter
   * widget and a smaller one. This only stops a nonsense height from asking
   * for a grid with more rows than the payload has days to fill.
   */
  const val MAX_ROWS = 12

  /**
   * The cell size the rows are counted against, in dp.
   *
   * Not a minimum and not a maximum — the cell ends up whatever the box
   * divides into. It is the size at which a day is comfortably readable on
   * a home screen, and so the size that decides whether a given height has
   * room for another row of them, and how many days fit across.
   *
   * 20, down from 26. At 26 a day came out around 24dp on a four-wide
   * card, which is bigger than a day needs to be to carry a fill, a ring
   * and a corner dot — the marks are drawn as fractions of the cell, so
   * they shrink with it and stay legible. The squares now read as a graph
   * rather than as buttons, and the same card carries a couple of columns
   * more history for it.
   */
  private const val TARGET_CELL_DP = 20f

  /** Everything the grid needs to be drawn into a particular box. */
  data class Layout(
    val rows: Int,
    val columns: Int,
    val cellWPx: Int,
    val cellHPx: Int,
    val gapPx: Int,
  ) {
    /** Days the grid will show. */
    val days: Int get() = rows * columns
  }

  private const val OWED_COLOR = "#F87171"

  /** The muted grey, for days that have not happened yet. */
  private const val FUTURE_COLOR = "#9AA0A6"

  /** The five salāh — what a complete day accounts for. */
  private const val SALAH_PER_DAY = 5

  /**
   * The fasting ring and the sunnah line, in the app's own two colours.
   *
   * Separated by LIGHTNESS rather than hue, because they are neighbours on
   * the wheel and sit inside each other on a square smaller than a grain of
   * rice — see sunnahTheme.ts, which is where these values come from. The
   * dark variants, because every widget card is dark.
   */
  private const val FAST_RING_COLOR = "#FBBF24"
  private const val SUNNAH_GOLD = "#E8CE7A"

  /**
   * Everything a complete day of sunnah holds — the five prayers' sunnah
   * plus Witr, which is 7. It is `SUNNAH_TOTAL` in src/journal/sunnah.ts;
   * the payload sends the raw count and the denominator has to live
   * somewhere, so it lives here with this note. A day that somehow reports
   * more is clamped rather than drawn as more than a full ring.
   */
  private const val SUNNAH_TOTAL = 7

  /**
   * A RemoteViews carrying bitmaps has to cross a Binder transaction, and
   * the AppWidget host applies its own ceiling on top of that — OEMs vary,
   * and the failure is the whole widget refusing to draw rather than a
   * warning. Ten weeks of 7dp cells is ~150 KB at 2.75x and ~300 KB at 4x,
   * and there are two of these in a 4x4. Clamping the cell keeps the pair
   * comfortably inside the budget on any density, at the cost of a grid
   * that stops growing on the very densest screens — where it is already
   * more pixels than the eye is using.
   *
   * Raised from 14 with the fold to three rows, and now a backstop rather
   * than the working limit: `layoutFor` sizes the bitmap against an AREA
   * budget, which is the thing the transaction actually cares about, and a
   * per-cell ceiling of 14px only ever meant a big cell arriving as a blur.
   */
  private const val MAX_CELL_PX = 96

  /**
   * The margin the grid keeps inside its own bitmap, so an edge square is a
   * whole square.
   *
   * Every ring here is drawn CENTRED on a cell's boundary, and two of them
   * reach outside it: the empty square's hairline by half its width, and
   * today's ring — which is itself drawn on a rect outset by half a stroke —
   * by a whole one. The first column starts at x=0 and the last ends at the
   * bitmap's width, so the outer half of those rings fell off the edge: the
   * leftmost column came out with a flat left side and a hairline half as
   * thick as its neighbours', which on a home screen reads as a graph the
   * card is clipping rather than a graph drawn to its own edge.
   *
   * A bitmap is not a canvas with room around it, so the room has to be part
   * of the bitmap. One ring's width on all four sides is the widest anything
   * reaches; the ~1dp it costs is invisible next to a square that is whole.
   */
  private fun padFor(cellPx: Int): Int =
    Math.ceil(ringWidth(cellPx).toDouble()).toInt()

  /** Today's ring — the widest stroke the grid draws, and the outermost. */
  private fun ringWidth(cellPx: Int): Float = ringWidthOf(cellPx.toFloat())

  /**
   * The same number in whatever unit the cell was given in.
   *
   * `layoutFor` needs it in dp, to count the margin against the box before
   * it decides how many rows fit; `padFor` needs it in pixels, to leave that
   * margin in the bitmap. One formula, so the row that is counted as fitting
   * is the row that fits.
   */
  private fun ringWidthOf(cell: Float): Float = (cell * RING_RATIO).coerceAtLeast(1.5f)

  private const val RING_RATIO = 0.14f

  /**
   * @param days    the payload's `practice.days` array, sparse, each entry
   *                carrying its own `d` date key
   * @param columns how many days each row holds. The grid draws
   *                `rows * columns` days, oldest at the top left and TODAY in
   *                the last cell.
   * @param cellWPx cell width in pixels
   * @param cellHPx cell height in pixels — not the same number, because the
   *                box a card gives the grid is not three cells tall for
   *                every width it is cells wide
   * @param gapPx   space between cells
   * @param since   the payload's `practice.since` — the first day the user
   *                ever logged a prayer, or null. Days from it onwards that
   *                do not account for all five carry the unaccounted dot;
   *                days before it carry nothing, because there was nothing
   *                to record yet.
   * @param now     the moment the grid describes — injectable so the shape
   *                can be asserted against a fixed date
   */
  @JvmOverloads
  fun render(
    days: JSONArray?,
    rows: Int,
    columns: Int,
    cellWPx: Int,
    cellHPx: Int,
    gapPx: Int,
    accent: Int,
    since: String? = null,
    now: Calendar = Calendar.getInstance(),
  ): Bitmap {
    @Suppress("NAME_SHADOWING") val cellWPx = cellWPx.coerceIn(3, MAX_CELL_PX)
    @Suppress("NAME_SHADOWING") val cellHPx = cellHPx.coerceIn(3, MAX_CELL_PX)
    @Suppress("NAME_SHADOWING") val gapPx = gapPx.coerceIn(1, 24)
    @Suppress("NAME_SHADOWING") val columns = columns.coerceAtLeast(1)
    @Suppress("NAME_SHADOWING") val rows = rows.coerceIn(1, MAX_ROWS)
    val ringUnit = minOf(cellWPx, cellHPx)
    val pad = padFor(ringUnit)
    val width = columns * cellWPx + (columns - 1) * gapPx + 2 * pad
    val height = rows * cellHPx + (rows - 1) * gapPx + 2 * pad
    val bmp = Bitmap.createBitmap(
      width.coerceAtLeast(1),
      height.coerceAtLeast(1),
      Bitmap.Config.ARGB_8888,
    )
    val canvas = Canvas(bmp)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val radius = ringUnit * 0.28f

    val byDate = indexByDate(days)
    val todayKey = keyOf(now)
    // Today is the LAST cell, so the run starts however many days back that
    // makes it. Nothing after today is drawn at all: a home screen has room
    // for the days that happened, and a tail of empty squares reads as days
    // already lost rather than days not yet arrived.
    val cursor = (now.clone() as Calendar).apply {
      set(Calendar.HOUR_OF_DAY, 12)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, -(rows * columns - 1))
    }

    // COLUMN-MAJOR, and deliberately: the Log screen's heatmap runs the days
    // down each column, one column to a week, newest week at the right. At
    // seven rows this grid IS that heatmap; at any other row count it is
    // still the same reading direction, so the widget and the screen it
    // summarises never disagree about which square is which day.
    for (col in 0 until columns) {
      for (row in 0 until rows) {
        val key = keyOf(cursor)
        val left = (pad + col * (cellWPx + gapPx)).toFloat()
        val top = (pad + row * (cellHPx + gapPx)).toFloat()
        val rect = RectF(left, top, left + cellWPx, top + cellHPx)
        // A date key is YYYY-MM-DD, so string order IS date order.
        val future = key > todayKey
        if (!future) {
          val day = byDate[key]
          paint.style = Paint.Style.FILL
          paint.color = colorFor(day, accent)
          canvas.drawRoundRect(rect, radius, radius, paint)
          // The hairline the app gives an empty square, for the same reason
          // it gives it one: an empty cell cannot carry enough contrast to
          // be seen at a lightness that still reads as empty, so the ring
          // carries it instead. Without this the last few days of a partly
          // logged week are indistinguishable from the card behind them.
          if (day == null || (weightOf(day) <= 0 && loggedOf(day) <= 0)) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = (ringUnit * 0.09f).coerceAtLeast(1f)
            paint.color = withAlpha(accent, 0.22f)
            canvas.drawRoundRect(rect, radius, radius, paint)
          }
          // The fast, as the outer ring — the same channel the Log screen
          // gives it, so a Ramadan reads as the same band of outlined
          // squares in both places.
          if (day != null && day.optBoolean("f", false)) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = (ringUnit * 0.12f).coerceAtLeast(1f)
            paint.color = Color.parseColor(FAST_RING_COLOR)
            val half = paint.strokeWidth / 2f
            canvas.drawRoundRect(
              RectF(
                rect.left + half,
                rect.top + half,
                rect.right - half,
                rect.bottom - half,
              ),
              radius,
              radius,
              paint,
            )
          }
          // The sunnah, as a line travelling round INSIDE the fast ring —
          // again the app's own channel. How far round it has gone is the
          // quantity, which reads at a glance in a way that six shades of
          // one colour never did.
          val sunnah = (day?.optInt("s", 0) ?: 0).coerceIn(0, SUNNAH_TOTAL)
          if (sunnah > 0) {
            drawSunnah(canvas, rect, sunnah / SUNNAH_TOTAL.toFloat(), ringUnit, paint)
          }
          // The unaccounted mark: a day inside the record that never got
          // all five filled in. FILLED here where the app draws it hollow —
          // a 1px ring inside a 7px cell is mush on a home screen, and
          // being visible is the entire point of carrying the mark into the
          // widget. Grey, and in the corner, so it cannot be read as part
          // of the green ramp.
          if (since != null && key >= since && key < todayKey &&
            (day == null || loggedOf(day) < SALAH_PER_DAY)
          ) {
            paint.style = Paint.Style.FILL
            paint.color = withAlpha(Color.parseColor(FUTURE_COLOR), 0.85f)
            val r = (ringUnit * 0.16f).coerceAtLeast(1.2f)
            canvas.drawCircle(rect.left + r + 1f, rect.top + r + 1f, r, paint)
          }
        }
        // Today gets a ring, as it does on the Log screen. A grid whose most
        // recent squares are empty gives no clue where "now" is without it.
        if (key == todayKey) {
          paint.style = Paint.Style.STROKE
          paint.strokeWidth = ringWidth(ringUnit)
          paint.color = withAlpha(accent, 0.85f)
          val inset = paint.strokeWidth / 2f
          canvas.drawRoundRect(
            RectF(rect.left - inset, rect.top - inset, rect.right + inset, rect.bottom + inset),
            radius,
            radius,
            paint,
          )
        }
        paint.style = Paint.Style.FILL
        cursor.add(Calendar.DAY_OF_YEAR, 1)
      }
    }
    return bmp
  }

  /**
   * The grid's whole geometry for a given box — how many days, and the
   * shape of the cell that carries one.
   *
   * ── ONE PLACE, BECAUSE TWO WAS THE BUG ────────────────────────────────
   *
   * The count and the cell size used to be decided by different code: a
   * cell size derived from the box's HEIGHT chose the column count, and
   * then the caller drew that count at a size of its own. Two shapes with
   * no reason to agree, and on a 4x4 they did not — the bitmap came out
   * proportionally narrower than its ImageView, `fitStart` scaled it to the
   * height, and eighty-odd pixels of width piled up on the right. A graph
   * that stops short of the edge every other element reaches does not read
   * as a graph that chose to be narrow; it reads as one being clipped.
   *
   * So it is answered once, here, and the caller passes the answer straight
   * through to `render`.
   *
   * ── AND WHICH WAY TO BE WRONG ─────────────────────────────────────────
   *
   * `boxHeightDp` is an estimate: the caller subtracts the chrome it knows
   * about from the height the launcher reports for the host view, and the
   * ImageView's real height comes out a little under it. So the box is
   * reckoned SHORTER than it measured. Too many columns costs a few percent
   * of cell width with the slack falling under the grid, where nothing is
   * looking; too few costs the gap against the right edge. Being wrong in
   * one direction is a rounding error and in the other it is the bug.
   *
   * @param maxDays how much history the payload actually carries
   */
  @JvmStatic
  fun layoutFor(
    boxWidthDp: Int,
    boxHeightDp: Int,
    density: Float,
    maxDays: Int,
  ): Layout {
    val boxW = boxWidthDp.toFloat().coerceAtLeast(40f)
    // The height is an estimate: the launcher reports the host view and the
    // card subtracts the chrome it believes it draws. It decides the row
    // count and nothing else — see below.
    val boxH = boxHeightDp.toFloat().coerceAtLeast(14f)

    // THE WIDTH DECIDES THE CELL, because the width is the number the caller
    // actually knows: it is the card's own width less its padding, and no
    // estimate of anything comes into it. So the columns are however many
    // readable cells fit across it, and the cell is then the width divided
    // exactly among them — which is what makes the grid land flush on both
    // edges, every time, rather than when an estimate happens to be right.
    val columns = Math.round((boxW + GAP_DP) / (TARGET_CELL_DP + GAP_DP))
      .coerceAtLeast(MIN_COLUMNS)
    // SQUARE. The cell was allowed to take the box's proportions for a
    // while, and a day drawn half again as wide as it is tall does not read
    // as a day; it reads as a bar in a chart of something else.
    val cellDp = ((boxW - (columns - 1) * GAP_DP) / columns).coerceIn(3f, MAX_CELL_DP)

    // ROWS FROM WHAT IS LEFT, ROUNDED DOWN, AND THE BITMAP'S OWN MARGIN
    // COUNTED — because the margin is part of what has to fit.
    //
    // Nearest was the honest answer to "how many rows fit in this height"
    // and the wrong answer to the question that decides how the widget
    // behaves. `fitStart` scales the bitmap by whichever axis binds first.
    // The width always lands on the box by construction, so while the grid
    // is no TALLER than its box the width binds, the scale is the same
    // whatever the height, and the cell arrives the size the width chose.
    // Round up by half a cell and the height binds instead — and then a
    // card dragged an inch shorter does not lose a row, it draws every day
    // on it smaller. That is the difference between a shorter widget and a
    // smaller one, and it is the whole reason the rows are counted here.
    //
    // So the height only ever removes rows, one at a time, down to one; the
    // leftover is a band of card under the last row, at most a row deep,
    // which is what quantising into whole squares costs and is invisible
    // next to a graph that changes size when you drag the handle.
    val marginDp = 2f * ringWidthOf(cellDp)
    val usableH = (boxH - marginDp).coerceAtLeast(cellDp)
    val roomFor = ((usableH + GAP_DP) / (cellDp + GAP_DP)).toInt()
    val rows = roomFor
      .coerceIn(1, MAX_ROWS)
      .coerceAtMost((maxDays / columns).coerceAtLeast(1))
    val cellHDp = cellDp
    val cellWDp = cellDp

    // Only the RATIOS above matter for how the grid LOOKS, because it is
    // scaled into the box either way. What the scale below decides is how
    // sharp it arrives: draw at the device's own pixels and every edge is
    // exactly where it should be; draw at a third of them and the launcher
    // enlarges the bitmap, which is a blur with rounded corners.
    //
    // Native resolution wherever it fits. It does not always fit — the
    // bitmap crosses a Binder transaction and the host has its own ceiling
    // on top of that, and the failure is the whole widget refusing to draw
    // rather than a warning — so the only thing that pulls the scale down
    // is the area budget, and it pulls it down by as little as it must.
    val gridW = columns * cellWDp + (columns - 1) * GAP_DP
    val gridH = rows * cellHDp + (rows - 1) * GAP_DP
    var scale = density
    val area = gridW * gridH * scale * scale
    if (area > MAX_BITMAP_PX) {
      scale *= Math.sqrt((MAX_BITMAP_PX / area).toDouble()).toFloat()
    }
    return Layout(
      rows = rows,
      columns = columns,
      cellWPx = Math.round(cellWDp * scale).coerceAtLeast(3),
      cellHPx = Math.round(cellHDp * scale).coerceAtLeast(3),
      gapPx = Math.round(GAP_DP * scale).coerceAtLeast(1),
    )
  }

  /** Never fewer than a fortnight's worth of columns, however small the box. */
  private const val MIN_COLUMNS = 5

  /**
   * A ceiling on the cell, in dp, and it is deliberately generous.
   *
   * The grid takes the shape of its box: a third of the height per row, and
   * as many columns as that cell size fits across the width. Capping the
   * cell tighter than this would buy extra columns at the price of a band
   * of empty card under the graph — the bitmap would be proportionally
   * wider than its box, so the width would bind and the leftover height
   * would sit there doing nothing. Better to let a tall box have big days
   * and fewer of them; how many days to show is a decision the person
   * makes by resizing the widget, which is the control they already have.
   */
  private const val MAX_CELL_DP = 40f

  /**
   * The most pixels the bitmap may hold, and it is a Binder budget.
   *
   * 100k pixels is 400 KB as ARGB_8888 — comfortably inside what an
   * AppWidget host will carry, and enough that a 4x4's grid is drawn at
   * about two thirds of the device's own resolution rather than a third of
   * it. Below that the enlargement starts to show on the cells' corners.
   */
  private const val MAX_BITMAP_PX = 100_000f



  /**
   * The space between cells, in dp, on both axes.
   *
   * Four, up from two. Two was right for a 7dp square in a grid of a
   * hundred and eighty; at three rows the cells are four times the size and
   * the same two points between them read as a solid slab with grout lines
   * scratched into it. The gap has to grow with what it separates.
   */
  private const val GAP_DP = 7f

  /**
   * The sunnah line: four straight sides, clockwise from the top-left,
   * drawn as far round as the day got.
   *
   * Straight sides rather than an arc for the same reason the in-app graph
   * uses them — the shape is read as "how far round", and four `drawLine`
   * calls cost nothing on a bitmap that holds a hundred and forty squares.
   */
  private fun drawSunnah(
    canvas: Canvas,
    rect: RectF,
    fraction: Float,
    cellPx: Int,
    paint: Paint,
  ) {
    val inset = (cellPx * 0.22f).coerceAtLeast(1.5f)
    val l = rect.left + inset
    val t = rect.top + inset
    val r = rect.right - inset
    val b = rect.bottom - inset
    val w = r - l
    val h = b - t
    if (w <= 0f || h <= 0f) return
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = (cellPx * 0.09f).coerceAtLeast(1f)
    paint.color = Color.parseColor(SUNNAH_GOLD)
    // Round the PERIMETER, not four equal sides: the cell is a rectangle
    // now, and splitting the fraction evenly would have the line finish a
    // short side early and crawl along a long one.
    var left = fraction.coerceIn(0f, 1f) * (2f * w + 2f * h)
    if (left <= 0f) return
    var d = minOf(left, w)
    canvas.drawLine(l, t, l + d, t, paint)
    left -= d
    if (left <= 0f) return
    d = minOf(left, h)
    canvas.drawLine(r, t, r, t + d, paint)
    left -= d
    if (left <= 0f) return
    d = minOf(left, w)
    canvas.drawLine(r, b, r - d, b, paint)
    left -= d
    if (left <= 0f) return
    d = minOf(left, h)
    canvas.drawLine(l, b, l, b - d, paint)
  }

  /**
   * `days` keyed by its own date stamp.
   *
   * An entry without a usable `d` is dropped rather than guessed at: a day
   * drawn in the wrong square is worse than a day not drawn, because it is
   * indistinguishable from a real one.
   */
  private fun indexByDate(days: JSONArray?): Map<String, JSONObject> {
    if (days == null || days.length() == 0) return emptyMap()
    val out = HashMap<String, JSONObject>(days.length())
    for (i in 0 until days.length()) {
      val day = days.optJSONObject(i) ?: continue
      val key = day.optString("d")
      if (key.length == 10) out[key] = day
    }
    return out
  }

  /** Local YYYY-MM-DD, matching the payload's own day keys. */
  private fun keyOf(cal: Calendar): String = String.format(
    "%04d-%02d-%02d",
    cal.get(Calendar.YEAR),
    cal.get(Calendar.MONTH) + 1,
    cal.get(Calendar.DAY_OF_MONTH),
  )

  /**
   * The fill, and it is the Log screen's `fillFor` with the names changed.
   *
   * Kept deliberately in the same order and with the same thresholds,
   * because the one thing this grid must not do is describe a week
   * differently from the screen the user checks it against. A future day is
   * not here at all — it is skipped before this is called, and drawn as
   * nothing, which is what the app does with it. It used to be a grey
   * square, which read as a day already lost.
   */
  private fun colorFor(day: JSONObject?, accent: Int): Int {
    // The empty square is the palest step of the SAME ramp, not grey — the
    // app's heatmap makes the same choice, and for the same reason: grey
    // reads as a failed day, and this graph does not grade anyone.
    if (day == null) return withAlpha(accent, 0.10f)
    // ORDER MATTERS, and it used to be wrong. `m` was tested first, so a day
    // of four prayers on time and one marked missed — the ordinary shape of
    // a day that is still in progress — drew as a red square here and as a
    // strong green one on the Log screen. The app treats `missed` as a MARK
    // on a day, not as the day's colour: red is only what a day looks like
    // when something was recorded and NONE of it was kept.
    val weight = weightOf(day)
    if (weight > 0) return withAlpha(accent, 0.42f + 0.58f * (weight / 500f))
    if (loggedOf(day) > 0) return withAlpha(Color.parseColor(OWED_COLOR), 0.30f)
    return withAlpha(accent, 0.10f)
  }

  /**
   * The day's weighted score, 0..500, as the Log screen computes it.
   *
   * `kw` is the field the app now sends. `k` is the older count and is the
   * fallback for a payload written before this change — it over-credits a
   * late prayer and ignores a made-up one, which is exactly why it stopped
   * being the number the fill is drawn from.
   */
  private fun weightOf(day: JSONObject): Int {
    if (day.has("kw")) return day.optInt("kw", 0).coerceIn(0, 500)
    return day.optInt("k", 0).coerceIn(0, 5) * 100
  }

  /** Entries recorded that day, whatever they say. Absent on old payloads. */
  private fun loggedOf(day: JSONObject): Int {
    if (day.has("l")) return day.optInt("l", 0).coerceAtLeast(0)
    // Before `l` existed the only signal that something was recorded on a
    // day with nothing kept was the missed flag.
    return if (day.optBoolean("m", false)) 1 else 0
  }

  private fun withAlpha(color: Int, alpha: Float): Int =
    Color.argb(
      (alpha.coerceIn(0f, 1f) * 255).toInt(),
      Color.red(color),
      Color.green(color),
      Color.blue(color),
    )
}
