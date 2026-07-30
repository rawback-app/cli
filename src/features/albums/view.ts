import { type CliAlbumFieldsFragment, type CliAlbumImageFieldsFragment } from '@rawback/sdk'

import { formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { cell, type UiDocument } from '../../ui/model.ts'

interface PageInfo {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export function albumListDocument(
  albums: CliAlbumFieldsFragment[],
  pageInfo: PageInfo,
): UiDocument {
  return {
    title: 'Albums',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No albums found.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'name', label: 'Name', required: true, priority: 1, minWidth: 12 },
          { key: 'status', label: 'Status', priority: 2 },
          { key: 'permission', label: 'Permission', priority: 3 },
          { key: 'images', label: 'Images', priority: 2 },
          { key: 'tags', label: 'Tags', priority: 5, minWidth: 8 },
          { key: 'updated', label: 'Updated', priority: 4, minWidth: 10 },
        ],
        rows: albums.map((album) => ({
          id: album.id,
          name: sanitizeCell(album.name),
          status: album.status,
          permission: album.permission,
          images: album.imageCount,
          tags:
            album.tags.map((tag) => sanitizeCell(tag.name)).join(', ') || cell('—', { dim: true }),
          updated: formatTimestamp(album.updatedAt).slice(0, 10),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: albums.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}

export function albumViewDocument(
  album: CliAlbumFieldsFragment,
  images: CliAlbumImageFieldsFragment[],
  pageInfo: PageInfo,
): UiDocument {
  const camera = album.camera
    ? [album.camera.make, album.camera.model].filter(Boolean).join(' ')
    : '—'
  const lens = album.lens ? [album.lens.make, album.lens.model].filter(Boolean).join(' ') : '—'

  return {
    title: album.name,
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'ID', value: album.id },
          {
            label: 'Description',
            value: sanitizeCell(album.description) || cell('—', { dim: true }),
          },
          { label: 'Slug', value: album.slug },
          { label: 'Permission', value: album.permission },
          { label: 'Status', value: album.status },
          { label: 'Images', value: album.imageCount },
          {
            label: 'Tags',
            value:
              album.tags.map((tag) => sanitizeCell(tag.name)).join(', ') ||
              cell('—', { dim: true }),
          },
          { label: 'Date from', value: formatTimestamp(album.dateFrom) },
          { label: 'Date to', value: formatTimestamp(album.dateTo) },
          { label: 'Timezone', value: album.timezone ?? cell('—', { dim: true }) },
          { label: 'Camera', value: camera },
          { label: 'Lens', value: lens },
          { label: 'Updated', value: formatTimestamp(album.updatedAt) },
        ],
      },
      { type: 'text', text: 'Photos', bold: true },
      {
        type: 'table',
        emptyMessage: 'No photos in this album.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'name', label: 'Name', required: true, priority: 1, minWidth: 12 },
          { key: 'status', label: 'Status', priority: 2 },
          { key: 'rating', label: 'Rating', priority: 4 },
          { key: 'captured', label: 'Captured', priority: 3, minWidth: 10 },
          { key: 'dimensions', label: 'Dimensions', priority: 5 },
        ],
        rows: images.map((image) => ({
          id: image.id,
          name: sanitizeCell(image.displayName || image.filename),
          status: image.status,
          rating:
            image.rate === null || image.rate === undefined ? cell('—', { dim: true }) : image.rate,
          captured: formatTimestamp(image.capturedAt).slice(0, 10),
          dimensions:
            image.width && image.height
              ? String(image.width) + '×' + String(image.height)
              : cell('—', { dim: true }),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: images.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}
