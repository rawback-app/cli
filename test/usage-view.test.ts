import { describe, expect, test } from 'bun:test'

import { usageDocument } from '../src/features/usage/view.ts'
import { type UiBlock, type UiMetersBlock } from '../src/ui/model.ts'
import { usageFixture } from './usage-fixture.ts'

/** 2024-01-01T00:00:00Z — before the fixture's reset date, so countdowns render. */
const NOW = 1_704_067_200

function blocksOfType(blocks: UiBlock[], type: UiBlock['type']): UiBlock[] {
  return blocks.filter((block) => block.type === type)
}

function meters(blocks: UiBlock[]): UiMetersBlock['meters'] {
  const block = blocks.find((candidate) => candidate.type === 'meters')
  if (block?.type !== 'meters') throw new Error('The usage document has no meters block')
  return block.meters
}

describe('usage document', () => {
  test('summarizes quotas and withholds the detail sections by default', () => {
    const { blocks } = usageDocument(usageFixture(), { now: NOW })

    expect(blocksOfType(blocks, 'meters')).toHaveLength(1)
    expect(blocksOfType(blocks, 'chart')).toHaveLength(0)
    expect(blocksOfType(blocks, 'table')).toHaveLength(0)
    expect(meters(blocks).map((meter) => meter.label)).toEqual([
      'Storage',
      'AI credits',
      'Face recognition',
    ])
  })

  test('derives spend from the allowance, because the API reports what is left', () => {
    const [storage, credits, faces] = meters(usageDocument(usageFixture(), { now: NOW }).blocks)

    // Storage reports what is used; the other two report what remains.
    expect(storage).toMatchObject({ used: 1024, total: 4096 })
    expect(credits).toMatchObject({ used: 20, total: 100 })
    expect(faces).toMatchObject({ used: 10, total: 100 })
  })

  test('adds charts and the top lists under detail', () => {
    const { blocks } = usageDocument(usageFixture(), { detail: true, now: NOW })

    expect(blocksOfType(blocks, 'chart')).toHaveLength(3)
    expect(blocksOfType(blocks, 'table')).toHaveLength(4)
    expect(
      blocksOfType(blocks, 'text').some((block) => block.type === 'text' && block.dim === true),
    ).toBe(false)
  })

  test('escalates tone with quota pressure and stays quiet when there is headroom', () => {
    const tones = (usedBytes: number, quotaBytes: number) => {
      const { blocks } = usageDocument(
        usageFixture({
          storage: { usedBytes, quotaBytes, remainingBytes: quotaBytes - usedBytes },
        }),
        { now: NOW },
      )
      const storage = meters(blocks)[0]
      return { tone: storage?.tone, notices: blocksOfType(blocks, 'notice').length }
    }

    expect(tones(2048, 4096)).toEqual({ tone: 'info', notices: 0 })
    expect(tones(3900, 4096)).toEqual({ tone: 'warning', notices: 1 })
    expect(tones(4096, 4096)).toEqual({ tone: 'error', notices: 1 })
  })

  test('treats a missing quota as unmeasured rather than full', () => {
    const { blocks } = usageDocument(
      usageFixture({ storage: { quotaBytes: 0, remainingBytes: 0 } }),
      { now: NOW },
    )

    expect(meters(blocks)[0]?.tone).toBe('neutral')
    expect(blocksOfType(blocks, 'notice')).toHaveLength(0)
  })

  test('counts down to an upcoming reset', () => {
    const resetAt = NOW + 12 * 86_400
    const { blocks } = usageDocument(usageFixture({ aiCredits: { resetAt } }), { now: NOW })

    expect(meters(blocks)[1]?.caption).toContain('resets 2024-01-13')
    expect(meters(blocks)[1]?.caption).toContain('in 12 days')
  })

  test('drops the countdown for a reset that has already passed', () => {
    const { blocks } = usageDocument(usageFixture({ aiCredits: { resetAt: NOW - 86_400 } }), {
      now: NOW,
    })
    const caption = meters(blocks)[1]?.caption ?? ''

    expect(caption).toContain('resets 2023-12-31')
    // The date keeps its hyphens; what must not appear is a negative countdown.
    expect(caption).not.toContain('(')
    expect(caption).not.toMatch(/-\d+ days/)
  })

  test('omits the reset clause entirely when the API reports none', () => {
    const { blocks } = usageDocument(usageFixture({ aiCredits: { resetAt: null } }), { now: NOW })

    expect(meters(blocks)[1]?.caption).toBe('80 credits left')
  })

  test('storage never claims a reset, because it is a level and not an allowance', () => {
    const { blocks } = usageDocument(usageFixture(), { now: NOW })

    expect(meters(blocks)[0]?.caption).not.toContain('resets')
  })
})
