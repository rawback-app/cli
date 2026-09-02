/**
 * Pure terminal-chart geometry. No React, no Ink, no formatting: callers hand in
 * sanitized numbers and pre-formatted labels, and get back plain strings that a
 * renderer can color and print. Keeping this module free of dependencies is what
 * makes the layout unit-testable and reusable outside the usage command.
 *
 * Series are treated as non-negative magnitudes; negative and non-finite values
 * are clamped to zero rather than rejected, because they only ever arrive from
 * API payloads where a bad value should degrade the chart, not crash the command.
 */

import { type UiChartPoint } from './model.ts'

/** Eighth-height blocks, ascending. Index `n - 1` renders `n` eighths of a row. */
export const CHART_BLOCKS = '▁▂▃▄▅▆▇█'

const METER_FILL = '━'
const METER_EMPTY = '─'
const BASELINE = '─'
const AXIS_TICK = '┤'
const AXIS_CORNER = '└'

const DEFAULT_HEIGHT = 6
const MIN_HEIGHT = 1
const MAX_HEIGHT = 16
const DEFAULT_AXIS_WIDTH = 8
const MIN_AXIS_WIDTH = 3
const MAX_AXIS_WIDTH = 12
const MIN_CHART_WIDTH = 20
const MIN_METER_WIDTH = 4

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Charts plot magnitudes, so anything not a finite positive number reads as zero. */
function magnitude(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export interface MeterSegments {
  filled: string
  empty: string
}

/**
 * Fraction of `total` consumed, or `undefined` when there is no usable quota to
 * measure against. Deliberately unclamped above 1 so callers can tell "full"
 * from "over quota".
 */
export function usageRatio(used: number, total: number): number | undefined {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return undefined
  return Math.max(0, used) / total
}

/**
 * Gauge halves, returned separately so the renderer owns the colors. An
 * `undefined` ratio renders as an unfilled track, which is how an unlimited or
 * unknown quota is shown.
 */
export function meterBar(ratio: number | undefined, width: number): MeterSegments {
  const track = Math.max(MIN_METER_WIDTH, Math.trunc(width))
  if (ratio === undefined || !Number.isFinite(ratio)) {
    return { filled: '', empty: METER_EMPTY.repeat(track) }
  }
  const bounded = clamp(ratio, 0, 1)
  let filled = Math.round(bounded * track)
  // Never round a real value away to nothing, and never look full short of full.
  if (bounded > 0 && filled === 0) filled = 1
  if (bounded < 1 && filled === track) filled = track - 1
  return { filled: METER_FILL.repeat(filled), empty: METER_EMPTY.repeat(track - filled) }
}

export type BucketAggregate = 'sum' | 'max'

/**
 * Downsample a series to at most `maxColumns` points, keeping the first label of
 * each bucket. Defaults to summing because these series are per-day flows;
 * `'max'` suits a series that measures a level rather than a flow.
 */
export function bucketPoints(
  points: UiChartPoint[],
  maxColumns: number,
  aggregate: BucketAggregate = 'sum',
): UiChartPoint[] {
  const limit = Math.trunc(maxColumns)
  if (limit <= 0 || points.length <= limit) return points

  const size = Math.ceil(points.length / limit)
  const buckets: UiChartPoint[] = []
  for (let start = 0; start < points.length; start += size) {
    const slice = points.slice(start, start + size)
    const first = slice[0]
    if (first === undefined) continue
    const values = slice.map((point) => magnitude(point.value))
    buckets.push({
      label: first.label,
      value: aggregate === 'max' ? Math.max(...values) : values.reduce((sum, v) => sum + v, 0),
    })
  }
  return buckets
}

/** One glyph per value, bucketed to `width`. Returns '' for an empty series. */
export function sparkline(values: number[], width: number): string {
  if (values.length === 0) return ''
  const points = bucketPoints(
    values.map((value, index) => ({ label: String(index), value })),
    Math.max(1, Math.trunc(width)),
  )
  const peak = Math.max(...points.map((point) => magnitude(point.value)))
  const last = CHART_BLOCKS.at(-1) ?? ''
  const first = CHART_BLOCKS[0] ?? ''
  if (peak <= 0) return first.repeat(points.length)

  return points
    .map((point) => {
      const value = magnitude(point.value)
      if (value <= 0) return first
      const step = Math.round((value / peak) * (CHART_BLOCKS.length - 1))
      return CHART_BLOCKS[step] ?? last
    })
    .join('')
}

export interface ColumnChartOptions {
  /** Total width budget, including the y-axis gutter. */
  width: number
  /** Plot rows, clamped to 1..16. */
  height?: number
  /** Y-label gutter, clamped to 3..12. */
  axisWidth?: number
  /** Pre-formatted peak, shown on the top row. */
  maxLabel?: string
  /** Pre-formatted floor, shown on the baseline. */
  minLabel?: string
  aggregate?: BucketAggregate
}

/**
 * A rendered line, split so the renderer can dim the axis while coloring the
 * data.
 */
export interface ChartRow {
  gutter: string
  plot: string
}

export interface ColumnChartLayout {
  /** No points, or nothing above zero: the caller should print its empty message. */
  empty: boolean
  /** Plot rows, top first. */
  rows: ChartRow[]
  baseline: ChartRow
  labels: ChartRow
  columnCount: number
  barWidth: number
  bucketed: boolean
}

function padLeft(text: string, width: number): string {
  return text.length > width ? text.slice(-width) : text.padStart(width)
}

/**
 * Lay out a vertical column chart. Each row carries eight sub-steps of vertical
 * resolution via the block glyphs, so a 6-row plot resolves 48 levels.
 */
export function layoutColumnChart(
  points: UiChartPoint[],
  options: ColumnChartOptions,
): ColumnChartLayout {
  const height = clamp(Math.trunc(options.height ?? DEFAULT_HEIGHT), MIN_HEIGHT, MAX_HEIGHT)
  const axisWidth = clamp(
    Math.trunc(options.axisWidth ?? DEFAULT_AXIS_WIDTH),
    MIN_AXIS_WIDTH,
    MAX_AXIS_WIDTH,
  )
  const width = Math.max(MIN_CHART_WIDTH, Math.trunc(options.width))
  const gutterWidth = axisWidth + 1
  const plotWidth = Math.max(1, width - gutterWidth)
  const minLabel = options.minLabel ?? '0'

  const blank: ChartRow = { gutter: '', plot: '' }
  const emptyLayout: ColumnChartLayout = {
    empty: true,
    rows: [],
    baseline: blank,
    labels: blank,
    columnCount: 0,
    barWidth: 0,
    bucketed: false,
  }
  if (points.length === 0) return emptyLayout

  const columns = bucketPoints(points, plotWidth, options.aggregate)
  const values = columns.map((point) => magnitude(point.value))
  const peak = Math.max(...values)
  if (peak <= 0) return emptyLayout

  // Widen the bars when there is room; 30 days at 80 columns lands on 2.
  const barWidth = [3, 2, 1].find((candidate) => columns.length * candidate <= plotWidth) ?? 1
  const steps = height * CHART_BLOCKS.length
  const units = values.map((value) => {
    if (value <= 0) return 0
    // A real-but-tiny day must not vanish into the baseline.
    return Math.max(1, clamp(Math.round((value / peak) * steps), 0, steps))
  })

  const rows: ChartRow[] = []
  for (let row = height - 1; row >= 0; row -= 1) {
    const plot = units
      .map((total) => {
        const eighths = clamp(total - row * CHART_BLOCKS.length, 0, CHART_BLOCKS.length)
        const glyph = eighths === 0 ? ' ' : (CHART_BLOCKS[eighths - 1] ?? ' ')
        return glyph.repeat(barWidth)
      })
      .join('')
    const label =
      row === height - 1 ? padLeft(options.maxLabel ?? '', axisWidth) : ' '.repeat(axisWidth)
    rows.push({ gutter: label + AXIS_TICK, plot })
  }

  const plotted = columns.length * barWidth
  const baseline: ChartRow = {
    gutter: padLeft(minLabel, axisWidth) + AXIS_CORNER,
    plot: BASELINE.repeat(plotted),
  }

  // Label the real range, not the buckets, so downsampling never mislabels it.
  const left = points[0]?.label ?? ''
  const right = points.at(-1)?.label ?? ''
  let labelPlot = ''
  if (left !== right && left.length + right.length + 2 <= plotted) {
    labelPlot = left + ' '.repeat(plotted - left.length - right.length) + right
  } else if (left.length <= plotted) {
    labelPlot = left
  }

  return {
    empty: false,
    rows,
    baseline,
    labels: { gutter: ' '.repeat(gutterWidth), plot: labelPlot },
    columnCount: columns.length,
    barWidth,
    bucketed: columns.length !== points.length,
  }
}
