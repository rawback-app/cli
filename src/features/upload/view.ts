import { formatBytes, formatDuration } from '../../ui/format.ts'
import { type UiDocument } from '../../ui/model.ts'

export function uploadDryRunDocument(input: {
  alreadyUploaded: number
  estimatedSeconds: number
  existingRemote: number
  files: number
  rate: number
  rateSource: string
  totalBytes: number
}): UiDocument {
  return {
    title: 'Upload dry run',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'Files', value: input.files },
          { label: 'Total size', value: formatBytes(input.totalBytes) },
          { label: 'Already uploaded', value: input.alreadyUploaded },
          { label: 'Remote', value: input.existingRemote },
          { label: 'Estimated time', value: formatDuration(input.estimatedSeconds) },
          {
            label: 'Estimated rate',
            value: formatBytes(input.rate) + '/s · ' + input.rateSource,
          },
        ],
      },
      { type: 'notice', message: 'No files were transferred.', tone: 'info' },
    ],
  }
}

export function uploadSummaryDocument(input: {
  cancelled: boolean
  /** Uploaded photos the server confirmed holding. */
  confirmed: number
  failedFiles: number
  totalBytes: number
  /** Uploaded photos the server was asked about and did not have. */
  unconfirmed: number
}): UiDocument {
  const tone = input.cancelled || input.failedFiles > 0 ? 'warning' : 'success'
  return {
    title: 'Upload complete',
    blocks: [
      {
        type: 'notice',
        tone,
        message: input.cancelled
          ? 'Upload cancelled'
          : input.failedFiles > 0
            ? String(input.failedFiles) + ' files failed'
            : 'All files uploaded',
      },
      {
        type: 'fields',
        fields: [
          { label: 'Transferred', value: formatBytes(input.totalBytes) },
          { label: 'Confirmed', value: input.confirmed },
          ...(input.unconfirmed > 0 ? [{ label: 'Unconfirmed', value: input.unconfirmed }] : []),
          { label: 'Failed', value: input.failedFiles },
        ],
      },
    ],
  }
}
