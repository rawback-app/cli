import { type FullUsageQuery } from '@rawback/sdk'

import { usageRatio } from '../../ui/chart.ts'
import {
  formatBytes,
  formatCount,
  formatDate,
  formatPercent,
  formatRelativeDays,
  formatTimestamp,
} from '../../ui/format.ts'
import {
  type UiBlock,
  type UiChartPoint,
  type UiDocument,
  type UiMeter,
  type UiTableColumn,
  type UiTone,
} from '../../ui/model.ts'

type Overview = FullUsageQuery['me']['usageOverview']
type Series = Overview['storage']['dailySeries']

export interface UsageViewOptions {
  /** Adds daily charts, recent operations, and the top lists. */
  detail?: boolean
  /** Unix seconds, injected by tests so reset reminders stay deterministic. */
  now?: number
}

function heading(text: string): UiBlock {
  return { type: 'text', text, bold: true }
}

function table(
  title: string,
  columns: UiTableColumn[],
  rows: Array<Record<string, string | number>>,
  emptyMessage: string,
): UiBlock[] {
  return [heading(title), { type: 'table', columns, rows, emptyMessage }]
}

/** Joins the clauses that survived, so a missing reset date drops its whole phrase. */
function sentence(parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((part): part is string => part !== undefined && part !== '')
  return kept.length === 0 ? undefined : kept.join(' · ')
}

function resetClause(resetAt: number | null | undefined, now: number): string | undefined {
  if (resetAt === null || resetAt === undefined || !Number.isFinite(resetAt)) return undefined
  const relative = formatRelativeDays(resetAt, now)
  const date = formatDate(resetAt)
  if (date === '—') return undefined
  return relative === undefined ? `resets ${date}` : `resets ${date} (${relative})`
}

/**
 * Quota pressure drives both the bar color and whether a trailing notice is
 * worth printing. Below 90% the meter is simply informational.
 */
function quotaTone(ratio: number | undefined): UiTone {
  if (ratio === undefined) return 'neutral'
  if (ratio >= 1) return 'error'
  if (ratio >= 0.9) return 'warning'
  return 'info'
}

/** Trims the year so 30 x-labels fit a narrow terminal. */
function chartPoints(series: Series): UiChartPoint[] {
  return series.map((point) => ({ label: formatDate(point.day).slice(5), value: point.value }))
}

function chartBlock(
  title: string,
  series: Series,
  format: (value: number) => string,
  emptyMessage: string,
): UiBlock {
  const points = chartPoints(series)
  const values = series.map((point) => (Number.isFinite(point.value) ? point.value : 0))
  const peak = values.length === 0 ? 0 : Math.max(...values)
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  const peakDay = series.find((point) => point.value === peak)
  const caption =
    peak > 0 && peakDay !== undefined
      ? `total ${format(total)} · peak ${format(peak)} on ${formatDate(peakDay.day)}`
      : undefined

  return {
    type: 'chart',
    title,
    points,
    maxLabel: format(peak),
    tone: 'info',
    emptyMessage,
    ...(caption === undefined ? {} : { caption }),
  }
}

function storageMeter(storage: Overview['storage']): UiMeter {
  const ratio = usageRatio(storage.usedBytes, storage.quotaBytes)
  // Storage has no reset clause: it is a level, not a monthly allowance.
  const caption = sentence([
    `${formatBytes(storage.remainingBytes)} free`,
    `${formatBytes(storage.originalsBytes)} originals`,
    `${formatBytes(storage.othersBytes)} other`,
  ])
  return {
    label: 'Storage',
    used: storage.usedBytes,
    total: storage.quotaBytes,
    value: `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.quotaBytes)}`,
    tone: quotaTone(ratio),
    spark: storage.dailySeries.map((point) => point.value),
    ...(caption === undefined ? {} : { caption }),
  }
}

function creditsMeter(credits: Overview['aiCredits'], now: number): UiMeter {
  // `balance` is what is LEFT, so spend has to be derived from the allowance.
  const used = Math.max(0, credits.monthlyAllowance - credits.balance)
  const ratio = usageRatio(used, credits.monthlyAllowance)
  const caption = sentence([
    `${formatCount(credits.balance)} credits left`,
    resetClause(credits.resetAt, now),
  ])
  return {
    label: 'AI credits',
    used,
    total: credits.monthlyAllowance,
    value: `${formatCount(used)} / ${formatCount(credits.monthlyAllowance)} credits`,
    tone: quotaTone(ratio),
    spark: credits.dailySeries.map((point) => point.value),
    ...(caption === undefined ? {} : { caption }),
  }
}

function facesMeter(faces: Overview['faceRecognition'], now: number): UiMeter {
  // `remaining` is what is LEFT, same inversion as AI credits.
  const used = Math.max(0, faces.monthlyAllowance - faces.remaining)
  const ratio = usageRatio(used, faces.monthlyAllowance)
  const caption = sentence([
    `${formatCount(faces.remaining)} photos left`,
    resetClause(faces.resetAt, now),
    `${formatCount(faces.facesCount)} faces`,
  ])
  return {
    label: 'Face recognition',
    used,
    total: faces.monthlyAllowance,
    value: `${formatCount(used)} / ${formatCount(faces.monthlyAllowance)} photos`,
    tone: quotaTone(ratio),
    spark: faces.dailySeries.map((point) => point.value),
    ...(caption === undefined ? {} : { caption }),
  }
}

/** One notice per resource that actually needs attention; silence on the happy path. */
function pressureNotices(meters: UiMeter[]): UiBlock[] {
  return meters.flatMap((meter): UiBlock[] => {
    const ratio = usageRatio(meter.used, meter.total)
    const tone = quotaTone(ratio)
    if (tone !== 'warning' && tone !== 'error') return []
    const message =
      tone === 'error'
        ? `${meter.label} quota reached — ${meter.value}`
        : `${meter.label} is ${formatPercent(ratio)} used — ${meter.value}`
    return [{ type: 'notice', tone, message }]
  })
}

function detailBlocks(data: FullUsageQuery): UiBlock[] {
  const overview = data.me.usageOverview
  const storage = overview.storage
  const credits = overview.aiCredits
  const faces = overview.faceRecognition

  return [
    chartBlock(
      'Storage · last 30 days',
      storage.dailySeries,
      formatBytes,
      'No storage activity in the last 30 days.',
    ),
    ...table(
      'Largest photos',
      [
        { key: 'id', label: 'ID', required: true },
        { key: 'name', label: 'Name', required: true, minWidth: 12 },
        { key: 'size', label: 'Size', priority: 2 },
        { key: 'type', label: 'Type', priority: 3 },
      ],
      storage.topImages.map((image) => ({
        id: image.id,
        name: image.displayName || image.originalFilename,
        size: formatBytes(image.sizeBytes),
        type: image.mimeType,
      })),
      'No photos found.',
    ),
    chartBlock(
      'AI credits · last 30 days',
      credits.dailySeries,
      formatCount,
      'No AI credit usage in the last 30 days.',
    ),
    ...table(
      'Recent AI operations',
      [
        { key: 'id', label: 'ID', required: true, priority: 1 },
        { key: 'operation', label: 'Operation', required: true, priority: 1, minWidth: 10 },
        { key: 'quota', label: 'Quota', priority: 4 },
        { key: 'used', label: 'Used', priority: 2 },
        { key: 'status', label: 'Status', priority: 2 },
        { key: 'created', label: 'Created', priority: 5, minWidth: 10 },
        { key: 'reference', label: 'Reference', priority: 6 },
      ],
      credits.recentOperations.map((operation) => ({
        id: operation.id,
        operation: operation.operationType,
        quota: operation.quotaType,
        used: operation.creditsUsed,
        status: operation.status,
        created: formatTimestamp(operation.createdAt).slice(0, 10),
        reference:
          operation.referenceType &&
          operation.referenceId !== null &&
          operation.referenceId !== undefined
            ? operation.referenceType + ':' + String(operation.referenceId)
            : '—',
      })),
      'No recent AI operations.',
    ),
    ...table(
      'AI operation costs',
      [
        { key: 'operation', label: 'Operation', required: true, minWidth: 10 },
        { key: 'cost', label: 'Cost', priority: 1 },
        { key: 'quota', label: 'Quota', priority: 2 },
        { key: 'description', label: 'Description', priority: 3, minWidth: 12 },
      ],
      data.creditCosts.map((cost) => ({
        operation: cost.operation,
        cost: cost.cost,
        quota: cost.quotaType,
        description: cost.description,
      })),
      'No AI operation costs found.',
    ),
    chartBlock(
      'Face recognition · last 30 days',
      faces.dailySeries,
      formatCount,
      'No face recognition activity in the last 30 days.',
    ),
    ...table(
      'Top face matches',
      [
        { key: 'id', label: 'ID', required: true },
        { key: 'name', label: 'Name', required: true, minWidth: 10 },
        { key: 'matches', label: 'Matches', priority: 1 },
      ],
      faces.topFaces.map((person) => ({
        id: person.id,
        name: person.name || '#' + String(person.id),
        matches: person.faceCount,
      })),
      'No face matches found.',
    ),
  ]
}

export function usageDocument(data: FullUsageQuery, options: UsageViewOptions = {}): UiDocument {
  const overview = data.me.usageOverview
  const now = options.now ?? Date.now() / 1000
  const detail = options.detail === true
  const meters = [
    storageMeter(overview.storage),
    creditsMeter(overview.aiCredits, now),
    facesMeter(overview.faceRecognition, now),
  ]

  return {
    title: 'Usage',
    blocks: [
      heading('Account'),
      {
        type: 'fields' as const,
        fields: [
          { label: 'Tier', value: data.me.tier },
          { label: 'User ID', value: data.me.id },
        ],
      },
      { type: 'meters' as const, meters },
      ...pressureNotices(meters),
      ...(detail
        ? detailBlocks(data)
        : [
            {
              type: 'text' as const,
              text: 'Run rawback usage --detail for daily charts, recent operations, and top lists.',
              dim: true,
            },
          ]),
    ],
  }
}
