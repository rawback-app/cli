import { Box, Text } from 'ink'

import { layoutColumnChart, meterBar, sparkline, usageRatio } from './chart.ts'
import { formatPercent } from './format.ts'
import {
  type UiBlock,
  type UiCell,
  type UiCellValue,
  type UiChartBlock,
  type UiDocument,
  type UiField,
  type UiHelpBlock,
  type UiMetersBlock,
  type UiTableBlock,
  type UiTableColumn,
  type UiTone,
} from './model.ts'

type ToneColor = 'cyan' | 'green' | 'yellow' | 'red' | undefined

const toneColor: Record<UiTone, ToneColor> = {
  neutral: undefined,
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
}

const toneIcon: Record<UiTone, string> = {
  neutral: '•',
  info: 'ℹ',
  success: '✓',
  warning: '!',
  error: '✗',
}

function normalizedCell(value: UiCellValue | undefined): UiCell {
  if (value === undefined) return { text: '—', dim: true }
  if (typeof value === 'object') return value
  return { text: String(value) }
}

function cellWidth(value: UiCellValue | undefined): number {
  return normalizedCell(value).text.length
}

function minColumnWidth(column: UiTableColumn): number {
  return Math.max(column.minWidth ?? 3, column.label.length)
}

export function visibleTableColumns(block: UiTableBlock, terminalWidth: number): UiTableColumn[] {
  const gapWidth = 2
  const ordered = [...block.columns].sort(
    (left, right) => (left.priority ?? 100) - (right.priority ?? 100),
  )
  const visible: UiTableColumn[] = []
  let used = 0

  for (const column of ordered) {
    const width = minColumnWidth(column)
    const nextWidth = used + (visible.length > 0 ? gapWidth : 0) + width
    if (column.required || nextWidth <= terminalWidth || visible.length === 0) {
      visible.push(column)
      used = nextWidth
    }
  }

  return block.columns.filter((column) => visible.includes(column))
}

function allocateWidths(
  block: UiTableBlock,
  columns: UiTableColumn[],
  terminalWidth: number,
): number[] {
  const gapWidth = Math.max(0, columns.length - 1) * 2
  const widths = columns.map((column) => {
    const contentWidth = Math.max(
      column.label.length,
      ...block.rows.map((row) => cellWidth(row[column.key])),
    )
    return Math.min(column.maxWidth ?? Number.POSITIVE_INFINITY, contentWidth)
  })
  const minimums = columns.map(minColumnWidth)
  let overflow = widths.reduce((total, width) => total + width, gapWidth) - terminalWidth

  while (overflow > 0) {
    let changed = false
    for (let index = widths.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const width = widths[index]
      const minimum = minimums[index]
      if (width !== undefined && minimum !== undefined && width > minimum) {
        widths[index] = width - 1
        overflow -= 1
        changed = true
      }
    }
    if (!changed) break
  }

  return widths
}

function CellText({ value }: { value: UiCellValue | undefined }) {
  const rendered = normalizedCell(value)
  const color = toneColor[rendered.tone ?? 'neutral']
  return (
    <Text
      {...(color === undefined ? {} : { color })}
      {...(rendered.dim === undefined ? {} : { dimColor: rendered.dim })}
      wrap="truncate-end"
    >
      {rendered.text}
    </Text>
  )
}

function Fields({ fields }: { fields: UiField[] }) {
  const labelWidth = Math.max(...fields.map((field) => field.label.length), 0)
  return (
    <Box flexDirection="column">
      {fields.map((field) => (
        <Box key={field.label}>
          <Box width={labelWidth + 2}>
            <Text dimColor>{field.label}</Text>
          </Box>
          <CellText value={field.value} />
        </Box>
      ))}
    </Box>
  )
}

function Table({ block, terminalWidth }: { block: UiTableBlock; terminalWidth: number }) {
  if (block.rows.length === 0) {
    return <Text dimColor>{block.emptyMessage ?? 'No results.'}</Text>
  }

  const columns = visibleTableColumns(block, terminalWidth)
  const widths = allocateWidths(block, columns, terminalWidth)

  return (
    <Box flexDirection="column">
      <Box columnGap={2}>
        {columns.map((column, index) => (
          <Box key={column.key} width={widths[index] ?? minColumnWidth(column)}>
            <Text bold dimColor wrap="truncate-end">
              {column.label}
            </Text>
          </Box>
        ))}
      </Box>
      {block.rows.map((row, rowIndex) => (
        <Box key={rowIndex} columnGap={2}>
          {columns.map((column, columnIndex) => (
            <Box key={column.key} width={widths[columnIndex] ?? minColumnWidth(column)}>
              <CellText value={row[column.key]} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function toneProps(tone: UiTone | undefined) {
  const color = toneColor[tone ?? 'neutral']
  return color === undefined ? {} : { color }
}

/*
 * Meter and chart rows are built as a single <Text> with nested spans and
 * JS-side padding rather than a row of <Box>es. Box children default to
 * flexShrink: 1, which lets a long neighbour squeeze a column — the same trap
 * the Help component documents below.
 */

const METER_MIN_BAR = 8
const METER_MAX_BAR = 28
const METER_SPARK_MIN = 8
const METER_SPARK_MAX = 30
const METER_PERCENT_WIDTH = 4
/** Below this, a label plus a bar plus the amounts cannot share one line legibly. */
const METER_STACK_WIDTH = 60

function Meters({ block, terminalWidth }: { block: UiMetersBlock; terminalWidth: number }) {
  // On a narrow terminal the label moves to its own row so the amounts, which
  // are the point of the meter, survive instead of being truncated away.
  const stacked = terminalWidth < METER_STACK_WIDTH
  const labelWidth = stacked ? 2 : Math.max(...block.meters.map((m) => m.label.length), 0) + 2
  const valueWidth = Math.max(...block.meters.map((meter) => meter.value.length), 0)
  const barWidth = Math.max(
    METER_MIN_BAR,
    Math.min(METER_MAX_BAR, terminalWidth - labelWidth - valueWidth - METER_PERCENT_WIDTH - 4),
  )
  const indent = ' '.repeat(labelWidth)

  return (
    <Box flexDirection="column">
      {block.meters.map((meter) => {
        const ratio = usageRatio(meter.used, meter.total)
        const bar = meterBar(ratio, barWidth)
        const caption = meter.caption ?? ''
        const sparkBudget = terminalWidth - labelWidth - caption.length - 2
        const spark =
          meter.spark !== undefined && meter.spark.length > 0 && sparkBudget >= METER_SPARK_MIN
            ? sparkline(meter.spark, Math.min(METER_SPARK_MAX, sparkBudget))
            : ''
        const amounts =
          '  ' + formatPercent(ratio).padStart(METER_PERCENT_WIDTH) + '  ' + meter.value

        return (
          <Box key={meter.label} flexDirection="column">
            {stacked ? (
              <Text dimColor wrap="truncate-end">
                {meter.label}
              </Text>
            ) : null}
            <Text wrap="truncate-end">
              <Text dimColor>{stacked ? indent : meter.label.padEnd(labelWidth)}</Text>
              <Text {...toneProps(meter.tone)}>{bar.filled}</Text>
              <Text dimColor>{bar.empty}</Text>
              <Text>{amounts}</Text>
            </Text>
            {caption === '' && spark === '' ? null : (
              <Text dimColor wrap="truncate-end">
                {indent + caption + (spark === '' || caption === '' ? spark : '  ' + spark)}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function Chart({ block, terminalWidth }: { block: UiChartBlock; terminalWidth: number }) {
  const layout = layoutColumnChart(block.points, {
    width: terminalWidth,
    maxLabel: block.maxLabel,
    ...(block.height === undefined ? {} : { height: block.height }),
    ...(block.minLabel === undefined ? {} : { minLabel: block.minLabel }),
  })
  const title = block.title === undefined ? null : <Text bold>{block.title}</Text>

  if (layout.empty) {
    return (
      <Box flexDirection="column">
        {title}
        <Text dimColor>{block.emptyMessage ?? 'No data.'}</Text>
      </Box>
    )
  }

  const bars = toneProps(block.tone ?? 'info')
  return (
    <Box flexDirection="column">
      {title}
      {layout.rows.map((row, index) => (
        <Text key={index} wrap="truncate-end">
          <Text dimColor>{row.gutter}</Text>
          <Text {...bars}>{row.plot}</Text>
        </Text>
      ))}
      <Text dimColor wrap="truncate-end">
        {layout.baseline.gutter + layout.baseline.plot}
      </Text>
      <Text dimColor wrap="truncate-end">
        {layout.labels.gutter + layout.labels.plot}
      </Text>
      {block.caption === undefined ? null : (
        <Text dimColor wrap="truncate-end">
          {block.caption}
        </Text>
      )}
    </Box>
  )
}

function Help({ block }: { block: UiHelpBlock }) {
  return (
    <Box flexDirection="column">
      {block.description ? (
        <Box marginBottom={1}>
          <Text>{block.description}</Text>
        </Box>
      ) : null}
      {block.usage ? (
        <Box marginBottom={1}>
          <Text dimColor>Usage </Text>
          <Text color="cyan">{block.usage}</Text>
        </Box>
      ) : null}
      {block.sections.map((section) => {
        const termWidth = Math.max(...section.entries.map((entry) => entry.term.length), 0)
        return (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold>{section.title}</Text>
            {section.entries.map((entry) => (
              <Box key={entry.term} paddingLeft={2}>
                {/* Without flexShrink={0} a long description squeezes this
                    column and splits the option name mid-word. */}
                <Box width={termWidth + 2} flexShrink={0}>
                  <Text color="cyan">{entry.term}</Text>
                </Box>
                <Text>{entry.description}</Text>
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

function Block({ block, terminalWidth }: { block: UiBlock; terminalWidth: number }) {
  switch (block.type) {
    case 'notice': {
      const tone = block.tone ?? 'neutral'
      const color = toneColor[tone]
      return (
        <Text {...(color === undefined ? {} : { color })}>
          {toneIcon[tone]} {block.message}
        </Text>
      )
    }
    case 'fields':
      return <Fields fields={block.fields} />
    case 'table':
      return <Table block={block} terminalWidth={terminalWidth} />
    case 'chart':
      return <Chart block={block} terminalWidth={terminalWidth} />
    case 'meters':
      return <Meters block={block} terminalWidth={terminalWidth} />
    case 'text':
      return (
        <Text
          {...(block.dim === undefined ? {} : { dimColor: block.dim })}
          {...(block.bold === undefined ? {} : { bold: block.bold })}
        >
          {block.text}
        </Text>
      )
    case 'help':
      return <Help block={block} />
    case 'pagination': {
      const start = block.count === 0 ? 0 : (block.page - 1) * block.pageSize + 1
      const end = start === 0 ? 0 : start + block.count - 1
      if (block.totalCount !== undefined && block.totalPages !== undefined) {
        return (
          <Text dimColor>
            Page {block.page} of {block.totalPages} · {block.totalCount} total
          </Text>
        )
      }
      return (
        <Text dimColor>
          Page {block.page} · showing {start}–{end} · {block.count} result
          {block.count === 1 ? '' : 's'}
        </Text>
      )
    }
  }
}

export function DocumentView({
  document,
  terminalWidth = 80,
}: {
  document: UiDocument
  terminalWidth?: number
}) {
  return (
    <Box flexDirection="column">
      {document.title ? (
        <Box marginBottom={document.blocks.length > 0 ? 1 : 0}>
          <Text bold>{document.title}</Text>
        </Box>
      ) : null}
      {document.blocks.map((block, index) => (
        <Box key={index} marginBottom={index === document.blocks.length - 1 ? 0 : 1}>
          <Block block={block} terminalWidth={terminalWidth} />
        </Box>
      ))}
    </Box>
  )
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function ActivityView({ label, frame }: { label: string; frame: number }) {
  return (
    <Box>
      <Text color="cyan">{spinnerFrames[frame % spinnerFrames.length]}</Text>
      <Text> {label}</Text>
    </Box>
  )
}
