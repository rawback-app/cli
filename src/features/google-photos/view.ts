import type {
  GooglePhotosAccountSummary,
  GooglePhotosExportPreviewSummary,
  GooglePhotosJobDetail,
  GooglePhotosJobSummary,
  GooglePhotosStatusSummary,
} from '@rawback/sdk'

import { formatBytes, formatCount } from '../../ui/format.ts'
import { cell, type UiCell, type UiDocument, type UiTone } from '../../ui/model.ts'

/**
 * Copy for the server's job and item `error` labels. The server adds labels
 * but never renames one; an unknown label is shown as it is.
 */
const ERROR_LABELS: Record<string, string> = {
  needs_reauth: 'Google needs to be reconnected',
  missing_scope: 'Google Photos permission was not granted',
  rate_limited: "waiting out Google's request quota",
  session_expired: 'the Google Photos picker session expired',
  quota_exceeded: 'storage is full',
  unsupported_type: 'not a supported photo (videos are not imported)',
  too_large: 'file is too large',
  duplicate: 'already in your library',
  already_exported: 'already exported to this Google account',
  not_found: 'no longer exists',
  download_failed: 'download failed',
  upload_failed: 'upload failed',
  rejected_by_google: 'rejected by Google Photos',
  album_failed: 'could not be added to the Google Photos album',
  internal_error: 'internal error',
  cancelled: 'cancelled',
}

export function describeGoogleErrorLabel(label: string | null | undefined): string | undefined {
  if (!label) return undefined
  return ERROR_LABELS[label] ?? label
}

/** `2026-10-07T10:00:00Z` → `2026-10-07 10:00`, the same instant in UTC. */
export function formatInstant(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '—'
  return new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')
}

function statusTone(status: GooglePhotosJobSummary['status']): UiTone {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelled') return 'warning'
  return 'info'
}

function statusCell(job: GooglePhotosJobSummary): UiCell {
  return cell(job.pausedUntil ? 'paused' : job.status, {
    tone: job.pausedUntil ? 'warning' : statusTone(job.status),
  })
}

function countCell(value: number, tone: UiTone): UiCell {
  return value === 0 ? cell('0', { dim: true }) : cell(formatCount(value), { tone })
}

function verb(job: Pick<GooglePhotosJobSummary, 'kind'>): string {
  return job.kind === 'import' ? 'Importing' : 'Exporting'
}

/** One line of live progress, used both by the spinner and by plain stderr lines. */
export function jobProgressLabel(job: GooglePhotosJobSummary): string {
  if (job.status === 'pending') {
    return `${verb(job)} — waiting to start (job ${String(job.id)})…`
  }
  const parts = [
    `${verb(job)} ${formatCount(job.doneItems + job.skippedItems + job.failedItems)}/${formatCount(job.totalItems)}`,
    `${formatCount(job.skippedItems)} skipped`,
    `${formatCount(job.failedItems)} failed`,
    formatBytes(job.transferredBytes),
  ]
  if (job.pausedUntil) parts.push(`paused by Google until ${formatInstant(job.pausedUntil)} UTC`)
  return parts.join(' · ')
}

export function googleStatusDocument(status: GooglePhotosStatusSummary): UiDocument {
  if (!status.available) {
    return {
      title: 'Google Photos',
      blocks: [
        {
          type: 'notice',
          message: 'Google Photos is not enabled on this server.',
          tone: 'warning',
        },
      ],
    }
  }
  const account = status.account
  return {
    title: 'Google Photos',
    blocks: [
      account
        ? account.needsReauth
          ? {
              type: 'notice',
              message: "Google needs to be reconnected. Run 'rawback google connect'.",
              tone: 'warning',
            }
          : { type: 'notice', message: 'Connected', tone: 'success' }
        : {
            type: 'notice',
            message: "Not connected. Run 'rawback google connect' to link a Google account.",
            tone: 'info',
          },
      {
        type: 'fields',
        fields: [
          ...(account ? accountFields(account) : []),
          { label: 'Active import', value: activeJobCell(status.activeImport) },
          { label: 'Active export', value: activeJobCell(status.activeExport) },
          { label: 'Pick limit', value: `${formatCount(status.maxPickerItems)} items` },
          { label: 'Export limit', value: `${formatCount(status.maxExportItems)} photos` },
        ],
      },
    ],
  }
}

function accountFields(account: GooglePhotosAccountSummary) {
  return [
    {
      label: 'Account',
      value: account.name ? `${account.name} <${account.email}>` : account.email,
    },
    {
      label: 'Import',
      value: account.canImport
        ? cell('allowed', { tone: 'success' })
        : cell('not granted', { tone: 'warning' }),
    },
    {
      label: 'Export',
      value: account.canExport
        ? cell('allowed', { tone: 'success' })
        : cell('not granted', { tone: 'warning' }),
    },
    { label: 'Connected', value: formatInstant(account.connectedAt) },
  ]
}

function activeJobCell(job: GooglePhotosJobSummary | null): UiCell {
  if (!job) return cell('none', { dim: true })
  return cell(`job ${String(job.id)} — ${jobProgressLabel(job)}`, { tone: 'info' })
}

export interface PickedItemsSummary {
  total: number
  photos: number
  videos: number
}

export function pickedItemsDocument(picked: PickedItemsSummary): UiDocument {
  return {
    title: 'Picked in Google Photos',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'Photos to import', value: formatCount(picked.photos) },
          {
            label: 'Videos skipped',
            value:
              picked.videos === 0
                ? cell('0', { dim: true })
                : cell(`${formatCount(picked.videos)} (videos are not imported)`, {
                    tone: 'warning',
                  }),
          },
        ],
      },
      {
        type: 'text',
        text: 'Google withholds location metadata from downloads, so imported photos arrive without GPS. Photos already in your library are skipped.',
        dim: true,
      },
    ],
  }
}

export interface ExportPlanView {
  selection: string
  albumTitle: string | null
  file: string
  preview: GooglePhotosExportPreviewSummary
  skipExported: boolean
}

export function exportPreviewDocument(plan: ExportPlanView): UiDocument {
  return {
    title: 'Export to Google Photos',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'Selection', value: plan.selection },
          { label: 'Photos to export', value: formatCount(plan.preview.count) },
          { label: 'Size', value: formatBytes(plan.preview.totalBytes) },
          {
            label: 'Already exported',
            value:
              plan.preview.alreadyExported === 0
                ? cell('0', { dim: true })
                : cell(
                    `${formatCount(plan.preview.alreadyExported)} ${plan.skipExported ? '(skipped)' : '(sent again)'}`,
                    { tone: 'info' },
                  ),
          },
          {
            label: 'Google album',
            value: plan.albumTitle ?? cell('none — library only', { dim: true }),
          },
          { label: 'File', value: plan.file },
        ],
      },
    ],
  }
}

function jobFields(job: GooglePhotosJobSummary) {
  const done = job.kind === 'import' ? 'Imported' : 'Exported'
  return [
    { label: 'Job', value: job.id },
    { label: 'Kind', value: job.kind },
    { label: 'Status', value: statusCell(job) },
    { label: done, value: `${formatCount(job.doneItems)} of ${formatCount(job.totalItems)}` },
    { label: 'Skipped', value: countCell(job.skippedItems, 'info') },
    { label: 'Failed', value: countCell(job.failedItems, 'error') },
    { label: 'Transferred', value: formatBytes(job.transferredBytes) },
    ...(job.kind === 'export'
      ? [
          { label: 'Google album', value: job.albumTitle ?? cell('library only', { dim: true }) },
          ...(job.albumUrl ? [{ label: 'Album link', value: job.albumUrl }] : []),
          { label: 'File', value: job.exportFile },
        ]
      : []),
    ...(job.upload ? [{ label: 'Upload session', value: job.upload.id }] : []),
    ...(job.error
      ? [
          {
            label: 'Error',
            value: cell(describeGoogleErrorLabel(job.error) ?? job.error, {
              tone: job.status === 'failed' ? 'error' : 'warning',
            }),
          },
        ]
      : []),
    ...(job.pausedUntil
      ? [{ label: 'Paused until', value: `${formatInstant(job.pausedUntil)} UTC` }]
      : []),
    { label: 'Created', value: formatInstant(job.createdAt) },
    ...(job.completedAt ? [{ label: 'Finished', value: formatInstant(job.completedAt) }] : []),
  ]
}

export function jobDocument(job: GooglePhotosJobSummary, hints: string[] = []): UiDocument {
  return {
    title: job.kind === 'import' ? 'Google Photos import' : 'Google Photos export',
    blocks: [
      { type: 'fields', fields: jobFields(job) },
      ...hints.map((text) => ({ type: 'text' as const, text, dim: true })),
    ],
  }
}

export function jobDetailDocument(job: GooglePhotosJobDetail): UiDocument {
  return {
    title: job.kind === 'import' ? 'Google Photos import' : 'Google Photos export',
    blocks: [
      { type: 'fields', fields: jobFields(job) },
      {
        type: 'table',
        emptyMessage: 'No items on this page.',
        columns: [
          { key: 'id', label: 'Item', required: true, priority: 1 },
          { key: 'status', label: 'Status', required: true, priority: 1 },
          { key: 'filename', label: 'File', required: true, priority: 1, minWidth: 12 },
          { key: 'size', label: 'Size', priority: 3 },
          { key: 'photo', label: 'Photo', priority: 4 },
          { key: 'detail', label: 'Detail', priority: 2, minWidth: 12 },
        ],
        rows: job.items.map((item) => ({
          id: item.id,
          status: cell(item.status, {
            tone:
              item.status === 'done'
                ? 'success'
                : item.status === 'failed'
                  ? 'error'
                  : item.status === 'skipped'
                    ? 'info'
                    : 'neutral',
          }),
          filename: item.filename,
          size: item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : cell('—', { dim: true }),
          photo: item.image ? item.image.id : cell('—', { dim: true }),
          detail:
            describeGoogleErrorLabel(item.error) ?? item.googleUrl ?? cell('—', { dim: true }),
        })),
      },
    ],
  }
}

export function jobListDocument(jobs: GooglePhotosJobSummary[]): UiDocument {
  return {
    title: 'Google Photos jobs',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No Google Photos imports or exports yet.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'kind', label: 'Kind', required: true, priority: 1 },
          { key: 'status', label: 'Status', required: true, priority: 1 },
          { key: 'done', label: 'Done', priority: 2 },
          { key: 'skipped', label: 'Skipped', priority: 3 },
          { key: 'failed', label: 'Failed', priority: 3 },
          { key: 'size', label: 'Size', priority: 4 },
          { key: 'created', label: 'Created', priority: 5, minWidth: 16 },
          { key: 'detail', label: 'Detail', priority: 6, minWidth: 12 },
        ],
        rows: jobs.map((job) => ({
          id: job.id,
          kind: job.kind,
          status: statusCell(job),
          done: `${formatCount(job.doneItems)}/${formatCount(job.totalItems)}`,
          skipped: countCell(job.skippedItems, 'info'),
          failed: countCell(job.failedItems, 'error'),
          size: formatBytes(job.transferredBytes),
          created: formatInstant(job.createdAt),
          detail:
            describeGoogleErrorLabel(job.error) ??
            job.albumUrl ??
            job.albumTitle ??
            cell('—', { dim: true }),
        })),
      },
    ],
  }
}
