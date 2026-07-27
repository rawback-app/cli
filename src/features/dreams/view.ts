import {
  type CliDreamFieldsFragment,
  type CliDreamImageFieldsFragment,
  type CliDreamSummaryFieldsFragment,
} from '../../gql/graphql.ts'
import { formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { cell, type UiCell, type UiDocument } from '../../ui/model.ts'

interface PageInfo {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

function dreamStatusCell(status: string): UiCell {
  const normalized = status.toLowerCase()
  return cell(status, {
    tone:
      normalized === 'completed'
        ? 'success'
        : normalized === 'failed'
          ? 'error'
          : normalized === 'pending'
            ? 'warning'
            : 'neutral',
  })
}

function cameraName(make: string | null | undefined, model: string): string {
  return sanitizeCell([make, model].filter(Boolean).join(' '))
}

export function dreamListDocument(
  dreams: CliDreamSummaryFieldsFragment[],
  pageInfo: PageInfo,
): UiDocument {
  return {
    title: 'Dreams',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No dreams found.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'date', label: 'Date', required: true, priority: 1, minWidth: 10 },
          { key: 'status', label: 'Status', required: true, priority: 2 },
          { key: 'title', label: 'Title', priority: 3, minWidth: 12 },
          { key: 'photos', label: 'Photos', priority: 2 },
        ],
        rows: dreams.map((dream) => ({
          id: dream.id,
          date: dream.dreamDate,
          status: dreamStatusCell(dream.status),
          title: sanitizeCell(dream.title) || `Dream of ${dream.dreamDate}`,
          photos: dream.photoCount,
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: dreams.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}

export function dreamViewDocument(
  dream: CliDreamFieldsFragment,
  photos: CliDreamImageFieldsFragment[],
  pageInfo: PageInfo,
): UiDocument {
  const title = sanitizeCell(dream.title) || `Dream of ${dream.dreamDate}`
  const placeNames =
    dream.placeClusters
      .map((place) => sanitizeCell(place.label))
      .filter(Boolean)
      .join(', ') || dream.places.map(sanitizeCell).filter(Boolean).join(', ')
  const cameraNames =
    dream.cameras.map((camera) => cameraName(camera.make, camera.model)).join(', ') ||
    dream.cameraModels.map(sanitizeCell).filter(Boolean).join(', ')
  const dimensions =
    dream.imageWidth && dream.imageHeight
      ? String(dream.imageWidth) + '×' + String(dream.imageHeight)
      : cell('—', { dim: true })
  const statusNotice =
    dream.status === 'failed'
      ? {
          type: 'notice' as const,
          message: dream.errorMessage || 'Dream generation failed.',
          tone: 'error' as const,
        }
      : dream.status === 'pending'
        ? {
            type: 'notice' as const,
            message: dream.skipReason || 'This dream is still being created.',
            tone: 'warning' as const,
          }
        : undefined

  return {
    title,
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'ID', value: dream.id },
          { label: 'Date', value: dream.dreamDate },
          { label: 'Status', value: dreamStatusCell(dream.status) },
          { label: 'Photos', value: dream.photoCount },
          { label: 'Places', value: placeNames || cell('—', { dim: true }) },
          { label: 'Cameras', value: cameraNames || cell('—', { dim: true }) },
          {
            label: 'Cover',
            value: dream.imageUrl ? sanitizeCell(dream.imageUrl) : cell('—', { dim: true }),
          },
          { label: 'Cover dimensions', value: dimensions },
          { label: 'Retry attempts', value: dream.retryCount },
          { label: 'Created', value: formatTimestamp(dream.createdAt) },
        ],
      },
      ...(statusNotice ? [statusNotice] : []),
      ...(dream.descriptionMarkdown
        ? [
            { type: 'text' as const, text: 'Description', bold: true },
            { type: 'text' as const, text: dream.descriptionMarkdown },
          ]
        : []),
      ...(dream.placeClusters.length > 0
        ? [
            { type: 'text' as const, text: 'Places', bold: true },
            {
              type: 'table' as const,
              columns: [
                { key: 'place', label: 'Place', required: true, priority: 1 },
                { key: 'photos', label: 'Photos', priority: 2 },
                { key: 'coordinates', label: 'Coordinates', priority: 3 },
              ],
              rows: dream.placeClusters.map((place) => ({
                place: sanitizeCell(place.label),
                photos: place.imageCount,
                coordinates: `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`,
              })),
            },
          ]
        : []),
      ...(dream.cameras.length > 0
        ? [
            { type: 'text' as const, text: 'Cameras', bold: true },
            {
              type: 'table' as const,
              columns: [
                { key: 'id', label: 'ID', required: true, priority: 1 },
                { key: 'camera', label: 'Camera', required: true, priority: 1 },
                { key: 'photos', label: 'Photos', priority: 2 },
                { key: 'sensor', label: 'Sensor', priority: 3 },
                { key: 'shutter', label: 'Shutter', priority: 4 },
              ],
              rows: dream.cameras.map((camera) => ({
                id: camera.id,
                camera: cameraName(camera.make, camera.model),
                photos: camera.imageCount,
                sensor:
                  camera.sensorWidth && camera.sensorHeight
                    ? String(camera.sensorWidth) + '×' + String(camera.sensorHeight)
                    : cell('—', { dim: true }),
                shutter:
                  camera.shutterCount === null || camera.shutterCount === undefined
                    ? cell('—', { dim: true })
                    : camera.shutterCount,
              })),
            },
          ]
        : []),
      { type: 'text', text: 'Photos', bold: true },
      {
        type: 'table',
        emptyMessage: 'No photos in this dream.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'filename', label: 'Filename', required: true, priority: 1, minWidth: 12 },
          { key: 'status', label: 'Status', priority: 2 },
          { key: 'rating', label: 'Rating', priority: 5 },
          { key: 'captured', label: 'Captured', priority: 3, minWidth: 10 },
          { key: 'camera', label: 'Camera', priority: 6, minWidth: 8 },
          { key: 'dimensions', label: 'Dimensions', priority: 4 },
        ],
        rows: photos.map((photo) => ({
          id: photo.id,
          filename: sanitizeCell(photo.filename),
          status: cell(photo.status, {
            tone: photo.status.toLowerCase().includes('fail') ? 'error' : 'neutral',
          }),
          rating:
            photo.rate === null || photo.rate === undefined ? cell('—', { dim: true }) : photo.rate,
          captured: formatTimestamp(photo.capturedAt).slice(0, 10),
          camera:
            [photo.cameraMake, photo.cameraModel].filter(Boolean).join(' ') ||
            cell('—', { dim: true }),
          dimensions:
            photo.width && photo.height
              ? String(photo.width) + '×' + String(photo.height)
              : cell('—', { dim: true }),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: photos.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}
