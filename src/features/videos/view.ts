import { type VideosQuery } from '@rawback/sdk'

import { formatBytes, formatDuration, formatTimestamp } from '../../ui/format.ts'
import { cell, type UiDocument } from '../../ui/model.ts'

type Video = VideosQuery['videos']['edges'][number]
type PageInfo = VideosQuery['videos']['pageInfo']

export function videoListDocument(videos: Video[], pageInfo: PageInfo): UiDocument {
  return {
    title: 'Videos',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No videos found.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'title', label: 'Title', required: true, priority: 1 },
          { key: 'duration', label: 'Duration', priority: 3 },
          { key: 'size', label: 'Size', priority: 2 },
          { key: 'dimensions', label: 'Dimensions', priority: 5 },
          { key: 'format', label: 'Format', priority: 6 },
          { key: 'thumbnail', label: 'Thumb', priority: 7 },
          { key: 'uploaded', label: 'Uploaded', priority: 4, minWidth: 10 },
        ],
        rows: videos.map((video) => ({
          id: video.id,
          title: video.title,
          duration:
            video.durationSeconds != null
              ? formatDuration(video.durationSeconds)
              : cell('—', { dim: true }),
          size: formatBytes(video.sizeBytes),
          dimensions:
            video.width != null && video.height != null
              ? `${String(video.width)}×${String(video.height)}`
              : cell('—', { dim: true }),
          format: video.mimeType.replace(/^video\//, ''),
          thumbnail: video.thumbnailUrl
            ? cell('yes', { tone: 'success' })
            : cell('no', { dim: true }),
          uploaded: formatTimestamp(video.createdAt).slice(0, 10),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: videos.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}
