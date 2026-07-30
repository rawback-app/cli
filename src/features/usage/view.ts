import { type FullUsageQuery } from '@rawback/sdk'

import { formatBytes, formatTimestamp } from '../../ui/format.ts'
import { type UiBlock, type UiDocument, type UiTableColumn } from '../../ui/model.ts'

function day(value: number): string {
  const formatted = formatTimestamp(value)
  return formatted === '—' ? formatted : formatted.slice(0, 10)
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
  return [
    heading(title),
    {
      type: 'table',
      columns,
      rows,
      emptyMessage,
    },
  ]
}

export function usageDocument(data: FullUsageQuery): UiDocument {
  const overview = data.me.usageOverview
  const storage = overview.storage
  const credits = overview.aiCredits
  const faces = overview.faceRecognition

  return {
    title: 'Usage',
    blocks: [
      heading('Account'),
      {
        type: 'fields',
        fields: [
          { label: 'Tier', value: data.me.tier },
          { label: 'User ID', value: data.me.id },
        ],
      },
      heading('Storage'),
      {
        type: 'fields',
        fields: [
          { label: 'Used', value: formatBytes(storage.usedBytes) },
          { label: 'Quota', value: formatBytes(storage.quotaBytes) },
          { label: 'Remaining', value: formatBytes(storage.remainingBytes) },
          { label: 'Originals', value: formatBytes(storage.originalsBytes) },
          { label: 'Other', value: formatBytes(storage.othersBytes) },
        ],
      },
      ...table(
        'Storage · last 30 days',
        [
          { key: 'day', label: 'Day', required: true },
          { key: 'uploaded', label: 'Uploaded', required: true },
        ],
        storage.dailySeries.map((point) => ({
          day: day(point.day),
          uploaded: formatBytes(point.value),
        })),
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
      heading('AI credits'),
      {
        type: 'fields',
        fields: [
          { label: 'Balance', value: credits.balance },
          { label: 'Monthly', value: credits.monthlyAllowance },
          { label: 'Reset', value: formatTimestamp(credits.resetAt) },
          { label: 'Tier', value: credits.tier },
        ],
      },
      ...table(
        'AI credits · last 30 days',
        [
          { key: 'day', label: 'Day', required: true },
          { key: 'spent', label: 'Spent', required: true },
        ],
        credits.dailySeries.map((point) => ({ day: day(point.day), spent: point.value })),
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
      heading('Face recognition'),
      {
        type: 'fields',
        fields: [
          { label: 'Remaining', value: faces.remaining },
          { label: 'Monthly', value: faces.monthlyAllowance },
          { label: 'Reset', value: formatTimestamp(faces.resetAt) },
          { label: 'Faces', value: faces.facesCount },
        ],
      },
      ...table(
        'Face recognition · last 30 days',
        [
          { key: 'day', label: 'Day', required: true },
          { key: 'photos', label: 'Photos analysed', required: true },
        ],
        faces.dailySeries.map((point) => ({ day: day(point.day), photos: point.value })),
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
      {
        type: 'notice',
        tone: storage.remainingBytes > 0 ? 'info' : 'warning',
        message:
          storage.remainingBytes > 0
            ? formatBytes(storage.remainingBytes) + ' storage remaining'
            : 'Storage quota reached',
      },
    ],
  }
}
