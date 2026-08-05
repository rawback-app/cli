import { Box, Text } from 'ink'

import type { ApiEntry } from '../../camera-registry.ts'

interface Props {
  entries: ApiEntry[]
  selected: number
  /** Rows available for the list body. */
  height: number
  /** Endpoints the connected camera does not advertise, shown dimmed. */
  unsupported: (entry: ApiEntry) => boolean
}

type Row = { type: 'header'; namespace: string } | { type: 'entry'; entry: ApiEntry; index: number }

/** The glyph shown to the left of each endpoint. */
export function marker(entry: ApiEntry): { glyph: string; color: string } {
  if (!entry.mutates) return { glyph: '●', color: 'cyan' }
  const destructive = entry.method === 'DELETE' || /format|delete/i.test(entry.label)
  return destructive ? { glyph: '⚠', color: 'red' } : { glyph: '✎', color: 'yellow' }
}

/** Grouped, windowed endpoint list with a selection cursor. */
export function ApiList({ entries, selected, height, unsupported }: Props) {
  const rows = buildRows(entries)
  const selectedRow = rows.findIndex((row) => row.type === 'entry' && row.index === selected)
  const window = windowRows(rows, selectedRow, height)

  return (
    <Box flexDirection="column">
      {window.map((row) => {
        if (row.type === 'header') {
          return (
            <Text key={`h-${row.namespace}`} bold color="gray">
              {`── ${row.namespace} ──`}
            </Text>
          )
        }
        const isSelected = row.index === selected
        const { glyph, color } = marker(row.entry)
        const dim = unsupported(row.entry)
        return (
          <Text
            key={row.entry.id}
            inverse={isSelected}
            dimColor={dim && !isSelected}
            wrap="truncate-end"
          >
            {isSelected ? '▸ ' : '  '}
            <Text {...(isSelected ? {} : { color })}>{glyph}</Text>
            {` ${row.entry.label}`}
          </Text>
        )
      })}
    </Box>
  )
}

export function buildRows(entries: ApiEntry[]): Row[] {
  const rows: Row[] = []
  let namespace: string | undefined
  entries.forEach((entry, index) => {
    if (entry.namespace !== namespace) {
      namespace = entry.namespace
      rows.push({ type: 'header', namespace })
    }
    rows.push({ type: 'entry', entry, index })
  })
  return rows
}

/** Keeps the selected row visible inside a `height`-row window. */
export function windowRows(rows: Row[], selectedRow: number, height: number): Row[] {
  if (rows.length <= height) return rows
  let start = selectedRow - Math.floor(height / 2)
  start = Math.max(0, Math.min(start, rows.length - height))
  // Pull the start back onto a header for group context, but only while the
  // selected row stays inside the window — otherwise a group taller than the
  // window pins the start to its header and scrolling freezes.
  let aligned = start
  while (aligned > 0 && rows[aligned]?.type !== 'header') aligned -= 1
  if (selectedRow - aligned < height) start = aligned
  return rows.slice(start, start + height)
}
