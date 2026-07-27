import type {
  SerializedLinkShare,
  SerializedShareRecipient,
  ShareListItem,
  SharePageInfo,
  ShareScope,
} from '../../shares.ts'
import { formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { cell, statusCell, type UiDocument } from '../../ui/model.ts'

function typeLabel(type: ShareListItem['resourceType']): string {
  return type === 'image' ? 'photo' : type
}

function shareState(item: ShareListItem) {
  if (!item.link) return cell('active', { tone: 'success' })
  if (item.link.status === 'archived') return cell('archived', { dim: true })
  if (item.link.isExpired) return cell('expired', { tone: 'error' })
  return statusCell(item.link.enabled, 'enabled')
}

function shareIdentifier(item: ShareListItem): string | number {
  if (item.shareId !== null) return item.shareId
  if (item.grantId !== null) return item.grantId
  return `${item.resourceType}:${item.resourceId}`
}

export function shareListDocument(
  scope: ShareScope,
  shares: ShareListItem[],
  pageInfo: SharePageInfo,
): UiDocument {
  if (scope === 'with-me') {
    return {
      title: 'Shares with me',
      blocks: [
        {
          type: 'table',
          emptyMessage: 'Nothing has been shared with you.',
          columns: [
            { key: 'id', label: 'Grant ID', required: true, priority: 1 },
            { key: 'type', label: 'Type', required: true, priority: 1 },
            { key: 'title', label: 'Resource', required: true, priority: 1, minWidth: 12 },
            { key: 'owner', label: 'Shared by', priority: 2, minWidth: 10 },
            { key: 'created', label: 'Created', priority: 3, minWidth: 10 },
          ],
          rows: shares.map((share) => ({
            id: shareIdentifier(share),
            type: typeLabel(share.resourceType),
            title: sanitizeCell(share.title),
            owner: share.owner
              ? sanitizeCell(`${share.owner.name} (@${share.owner.slug})`)
              : cell('—', { dim: true }),
            created: formatTimestamp(share.createdAt).slice(0, 10),
          })),
        },
        {
          type: 'pagination',
          page: pageInfo.page,
          pageSize: pageInfo.pageSize,
          count: shares.length,
          totalCount: pageInfo.totalCount,
          totalPages: pageInfo.totalPages,
        },
      ],
    }
  }

  return {
    title: 'Shares with others',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'You have not shared anything matching these filters.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'kind', label: 'Kind', required: true, priority: 1 },
          { key: 'type', label: 'Type', priority: 2 },
          { key: 'title', label: 'Resource', required: true, priority: 1, minWidth: 12 },
          { key: 'recipients', label: 'Recipients', priority: 3 },
          { key: 'state', label: 'State', priority: 2 },
          { key: 'created', label: 'Created', priority: 4, minWidth: 10 },
          { key: 'url', label: 'Link', priority: 5, minWidth: 16 },
        ],
        rows: shares.map((share) => ({
          id: shareIdentifier(share),
          kind: share.kind,
          type: typeLabel(share.resourceType),
          title: sanitizeCell(share.title),
          recipients: share.recipientCount,
          state: shareState(share),
          created: formatTimestamp(share.createdAt).slice(0, 10),
          url: share.link ? sanitizeCell(share.link.url) : cell('—', { dim: true }),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: shares.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}

export function shareDetailDocument(share: SerializedLinkShare): UiDocument {
  const resourceCount =
    share.resource.imageCount ?? share.resource.photoCount ?? cell('—', { dim: true })
  return {
    title: share.title || share.resource.title,
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'ID', value: share.id },
          { label: 'Type', value: typeLabel(share.resource.type) },
          { label: 'Resource ID', value: share.resource.id },
          { label: 'Resource', value: sanitizeCell(share.resource.title) },
          { label: 'Photos', value: resourceCount },
          { label: 'Access', value: share.accessType },
          { label: 'Status', value: share.status },
          { label: 'Enabled', value: statusCell(share.enabled) },
          { label: 'Expired', value: share.isExpired ? cell('yes', { tone: 'error' }) : 'no' },
          { label: 'Expires', value: formatTimestamp(share.expiresAt) },
          { label: 'Recipients', value: share.recipients.length },
          { label: 'Views', value: share.viewCount },
          { label: 'URL', value: sanitizeCell(share.url) },
          { label: 'Frame', value: share.frameKind },
          { label: 'Show EXIF', value: share.showExif ? 'yes' : 'no' },
          {
            label: 'Minimum rating',
            value: share.minRating ?? cell('—', { dim: true }),
          },
          { label: 'Allow download', value: share.permission.allowDownload ? 'yes' : 'no' },
          {
            label: 'Allow original',
            value: share.permission.allowOriginalDownload ? 'yes' : 'no',
          },
          { label: 'Created', value: formatTimestamp(share.createdAt) },
          { label: 'Updated', value: formatTimestamp(share.updatedAt) },
        ],
      },
      ...(share.description
        ? [
            { type: 'text' as const, text: 'Description', bold: true },
            { type: 'text' as const, text: share.description },
          ]
        : []),
    ],
  }
}

export function shareRecipientsDocument(
  shareId: number,
  recipients: SerializedShareRecipient[],
): UiDocument {
  return {
    title: `Recipients for share ${shareId}`,
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No recipients found.',
        columns: [
          { key: 'id', label: 'ID', required: true },
          { key: 'email', label: 'Email', required: true, minWidth: 18 },
          { key: 'accessed', label: 'Last accessed', priority: 1, minWidth: 10 },
          { key: 'created', label: 'Added', priority: 2, minWidth: 10 },
        ],
        rows: recipients.map((recipient) => ({
          id: recipient.id,
          email: sanitizeCell(recipient.email),
          accessed:
            recipient.lastAccessedAt === null
              ? cell('never', { dim: true })
              : formatTimestamp(recipient.lastAccessedAt),
          created: formatTimestamp(recipient.createdAt),
        })),
      },
    ],
  }
}
