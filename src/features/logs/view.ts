import { type LogDirectoryListing, type PurgeLogsResult } from '@rawback/sdk'

import { type LogLine } from '../../logs.ts'
import { formatBytes, sanitizeCell } from '../../ui/format.ts'
import { cell, type UiBlock, type UiDocument, type UiTone } from '../../ui/model.ts'

/** ISO timestamps trimmed to the second: the zone and milliseconds only crowd the table. */
function shortTime(value: string | undefined): string {
  if (value === undefined) return '—'
  return value.replace('T', ' ').slice(0, 19)
}

function levelTone(level: string | undefined): UiTone {
  switch (level) {
    case 'warn':
      return 'warning'
    case 'error':
    case 'fatal':
      return 'error'
    case 'info':
      return 'info'
    default:
      return 'neutral'
  }
}

export function logFilesDocument(listing: LogDirectoryListing): UiDocument {
  return {
    title: 'Logs',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'Directory', value: listing.directory },
          { label: 'Total', value: formatBytes(listing.totalBytes) },
        ],
      },
      {
        type: 'table',
        emptyMessage: 'No log files yet.',
        columns: [
          { key: 'name', label: 'File', required: true, minWidth: 12 },
          { key: 'size', label: 'Size', priority: 1 },
          { key: 'modified', label: 'Modified', priority: 2, minWidth: 10 },
        ],
        rows: listing.files.map((file) => ({
          name: sanitizeCell(file.name),
          size: formatBytes(file.bytes),
          modified: shortTime(file.modifiedAt),
        })),
      },
    ],
  }
}

export function logLinesDocument(source: string, lines: LogLine[]): UiDocument {
  return {
    title: 'Logs',
    blocks: [
      { type: 'text', text: source, dim: true },
      {
        type: 'table',
        emptyMessage: 'No log lines to show.',
        columns: [
          { key: 'time', label: 'Time', priority: 2, minWidth: 10 },
          { key: 'level', label: 'Level', required: true },
          { key: 'component', label: 'Component', priority: 3 },
          { key: 'message', label: 'Message', required: true, minWidth: 16 },
          { key: 'trace', label: 'Trace', priority: 4 },
        ],
        rows: lines.map((line) =>
          line.raw === undefined
            ? {
                time: shortTime(line.time),
                level: cell(line.level ?? '—', { tone: levelTone(line.level) }),
                component: sanitizeCell(line.component ?? '—'),
                message: sanitizeCell(line.msg ?? line.event ?? ''),
                trace: line.traceId ?? '—',
              }
            : {
                time: '—',
                level: cell('raw', { dim: true }),
                component: '—',
                message: sanitizeCell(line.raw),
                trace: '—',
              },
        ),
      },
    ],
  }
}

export function purgeResultDocument(result: PurgeLogsResult): UiDocument {
  const removed = result.removed.length
  const blocks: UiBlock[] = [
    {
      type: 'notice',
      tone: result.failed.length > 0 ? 'warning' : 'success',
      message:
        `Deleted ${removed} log file${removed === 1 ? '' : 's'} ` +
        `(${formatBytes(result.bytes)}) from ${result.directory}`,
    },
  ]
  if (result.failed.length > 0) {
    blocks.push({
      type: 'table',
      columns: [
        { key: 'name', label: 'Not deleted', required: true, minWidth: 12 },
        { key: 'reason', label: 'Reason', required: true, minWidth: 12 },
      ],
      rows: result.failed.map((failure) => ({
        name: sanitizeCell(failure.name),
        reason: sanitizeCell(failure.reason),
      })),
    })
  }
  return { title: 'Logs purged', blocks }
}
