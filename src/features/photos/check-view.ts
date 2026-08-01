import type { PhotoCheckReport, PhotoCheckResult } from '../../photo-check.ts'
import { cell, type UiDocument } from '../../ui/model.ts'

const reasonLabels: Record<Exclude<PhotoCheckResult['reason'], null>, string> = {
  'metadata-check-failed': 'Metadata checking failed',
  'metadata-read-failed': 'Metadata could not be read',
  'missing-capture-time': 'No usable capture time',
  'remote-check-failed': 'Rawback check failed',
}

export function photoCheckDocument(report: PhotoCheckReport): UiDocument {
  return {
    title: 'Local photo check',
    blocks: [
      {
        type: 'table',
        columns: [
          { key: 'path', label: 'Local path', required: true, priority: 1, minWidth: 16 },
          { key: 'status', label: 'Status', required: true, priority: 1, minWidth: 10 },
          { key: 'imageId', label: 'Rawback ID', priority: 2 },
          { key: 'reason', label: 'Details', priority: 3, minWidth: 12 },
        ],
        rows: report.files.map((file) => ({
          path: file.path,
          status:
            file.status === 'present'
              ? cell('Already in Rawback', { tone: 'success' })
              : file.status === 'absent'
                ? 'Not in Rawback'
                : cell('Unknown', { tone: 'warning' }),
          imageId: file.imageId ?? cell('—', { dim: true }),
          reason: file.reason ? reasonLabels[file.reason] : cell('—', { dim: true }),
        })),
      },
      {
        type: 'fields',
        fields: [
          { label: 'Files', value: report.summary.total },
          { label: 'Already in Rawback', value: report.summary.present },
          { label: 'Not in Rawback', value: report.summary.absent },
          { label: 'Unknown', value: report.summary.unknown },
        ],
      },
    ],
  }
}
