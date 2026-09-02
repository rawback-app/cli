import { describe, expect, test } from 'bun:test'

import {
  bucketPoints,
  CHART_BLOCKS,
  layoutColumnChart,
  meterBar,
  sparkline,
  usageRatio,
} from '../src/ui/chart.ts'
import { type UiChartPoint } from '../src/ui/model.ts'

function points(values: number[], prefix = 'd'): UiChartPoint[] {
  return values.map((value, index) => ({ label: prefix + String(index), value }))
}

describe('usageRatio', () => {
  test('measures consumption and reports over-quota honestly', () => {
    expect(usageRatio(1, 4)).toBe(0.25)
    expect(usageRatio(5, 4)).toBe(1.25)
    expect(usageRatio(0, 4)).toBe(0)
  })

  test('returns undefined when there is no quota to measure against', () => {
    expect(usageRatio(1, 0)).toBeUndefined()
    expect(usageRatio(1, -5)).toBeUndefined()
    expect(usageRatio(Number.NaN, 4)).toBeUndefined()
    expect(usageRatio(1, Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('meterBar', () => {
  test('splits the track into filled and empty halves', () => {
    const bar = meterBar(0.5, 10)
    expect(bar.filled).toBe('━━━━━')
    expect(bar.empty).toBe('─────')
  })

  test('never rounds a real value to nothing, nor looks full short of full', () => {
    expect(meterBar(0, 10).filled).toBe('')
    expect(meterBar(0.001, 10).filled).toHaveLength(1)
    expect(meterBar(0.999, 10).filled).toHaveLength(9)
    expect(meterBar(1, 10).empty).toBe('')
    expect(meterBar(2, 10).empty).toBe('')
  })

  test('renders an unmeasured quota as an empty track', () => {
    expect(meterBar(undefined, 10)).toEqual({ filled: '', empty: '──────────' })
  })

  test('always fills the requested width', () => {
    for (const ratio of [0, 0.1, 0.33, 0.5, 0.87, 1]) {
      const bar = meterBar(ratio, 12)
      expect(bar.filled.length + bar.empty.length).toBe(12)
    }
  })
})

describe('bucketPoints', () => {
  test('sums a series down to the column budget and keeps the range', () => {
    const input = points(Array.from({ length: 30 }, (_, index) => index))
    const bucketed = bucketPoints(input, 10)

    expect(bucketed).toHaveLength(10)
    expect(bucketed.reduce((total, point) => total + point.value, 0)).toBe(
      input.reduce((total, point) => total + point.value, 0),
    )
    expect(bucketed[0]?.label).toBe('d0')
  })

  test('takes the peak when aggregating a level rather than a flow', () => {
    expect(bucketPoints(points([1, 9, 2, 3]), 2, 'max').map((point) => point.value)).toEqual([9, 3])
  })

  test('passes short series and non-positive budgets through unchanged', () => {
    const input = points([1, 2, 3])
    expect(bucketPoints(input, 10)).toBe(input)
    expect(bucketPoints(input, 0)).toBe(input)
  })
})

describe('sparkline', () => {
  test('maps a series onto the block ramp', () => {
    expect(sparkline([], 10)).toBe('')
    expect(sparkline([0, 0, 0], 3)).toBe('▁▁▁')
    expect(sparkline([0, 10], 2)).toBe('▁█')
    expect([...sparkline([1, 5, 3, 9], 4)].every((glyph) => CHART_BLOCKS.includes(glyph))).toBe(
      true,
    )
  })

  test('buckets a series wider than the requested width', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6], 2)).toHaveLength(2)
  })
})

describe('layoutColumnChart', () => {
  test('reports emptiness rather than drawing a blank grid', () => {
    expect(layoutColumnChart([], { width: 80 }).empty).toBe(true)
    expect(layoutColumnChart(points([0, 0, 0]), { width: 80 }).empty).toBe(true)
    expect(layoutColumnChart([], { width: 80 }).rows).toHaveLength(0)
  })

  test('draws a labelled grid with the peak on top and a zero baseline', () => {
    const layout = layoutColumnChart(points([1, 4, 2]), {
      width: 80,
      height: 4,
      maxLabel: '4 GB',
    })

    expect(layout.empty).toBe(false)
    expect(layout.rows).toHaveLength(4)
    expect(layout.rows[0]?.gutter).toContain('4 GB')
    expect(layout.rows[0]?.plot).toContain('█')
    expect(layout.baseline.gutter).toEndWith('└')
    expect(layout.baseline.gutter.trim()).toStartWith('0')
    expect(layout.baseline.plot).toBe('─'.repeat(layout.columnCount * layout.barWidth))
    // Every gutter is the same width, or the axis would zigzag.
    const widths = new Set(layout.rows.map((row) => row.gutter.length))
    expect(widths.size).toBe(1)
  })

  test('keeps a real but tiny value visible above the baseline', () => {
    const layout = layoutColumnChart(points([1000, 1]), { width: 80, height: 6 })
    const bottom = layout.rows.at(-1)

    expect(bottom?.plot.slice(layout.barWidth, layout.barWidth * 2).trim()).not.toBe('')
  })

  test('fits a 30-day series into a narrow terminal', () => {
    const layout = layoutColumnChart(points(Array.from({ length: 30 }, (_, i) => i + 1)), {
      width: 40,
      maxLabel: '30',
    })

    expect(layout.columnCount).toBe(30)
    expect(layout.barWidth).toBe(1)
    expect(layout.bucketed).toBe(false)
    for (const row of [...layout.rows, layout.baseline, layout.labels]) {
      expect(row.gutter.length + row.plot.length).toBeLessThanOrEqual(40)
    }
  })

  test('widens the bars when the terminal has room', () => {
    const layout = layoutColumnChart(points(Array.from({ length: 30 }, (_, i) => i + 1)), {
      width: 80,
    })
    expect(layout.barWidth).toBe(2)
  })

  test('buckets an oversized series and still labels the real range', () => {
    const layout = layoutColumnChart(points(Array.from({ length: 200 }, (_, i) => i + 1)), {
      width: 80,
    })

    expect(layout.bucketed).toBe(true)
    expect(layout.columnCount).toBeLessThanOrEqual(71)
    expect(layout.labels.plot).toStartWith('d0')
    expect(layout.labels.plot).toEndWith('d199')
  })

  test('treats negative and non-finite values as zero', () => {
    const layout = layoutColumnChart(points([10, -5, Number.NaN, Number.POSITIVE_INFINITY]), {
      width: 80,
      height: 3,
    })

    expect(layout.empty).toBe(false)
    for (const row of layout.rows) {
      expect(row.plot).not.toContain('NaN')
    }
  })

  test('clamps height and axis width to sane bounds', () => {
    expect(layoutColumnChart(points([1, 2]), { width: 80, height: 100 }).rows).toHaveLength(16)
    expect(layoutColumnChart(points([1, 2]), { width: 80, height: 0 }).rows).toHaveLength(1)
  })
})
