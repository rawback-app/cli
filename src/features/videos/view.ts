import { type VideoQuery, type VideosQuery } from '@rawback/sdk'

import { formatBytes, formatDuration, formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { type UiBlock, cell, type UiDocument } from '../../ui/model.ts'

type Video = VideosQuery['videos']['edges'][number]
type VideoDetail = NonNullable<VideoQuery['video']>

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', zh: 'Chinese' }

function languageName(language: string): string {
  return LANGUAGE_NAMES[language] ?? language
}

function videoStatusCell(status: string) {
  return cell(status, {
    tone: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warning',
  })
}
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
          title: sanitizeCell(video.title),
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

/** One video: its text in both languages, hashtags, links, subtitles and audio. */
export function videoViewDocument(video: VideoDetail): UiDocument {
  const none = cell('—', { dim: true })
  const blocks: UiBlock[] = [
    {
      type: 'fields',
      fields: [
        { label: 'ID', value: video.id },
        { label: 'Title', value: sanitizeCell(video.title) },
        { label: 'Title (Chinese)', value: video.titleZh ? sanitizeCell(video.titleZh) : none },
        { label: 'Status', value: videoStatusCell(video.status) },
        {
          label: 'Hashtags',
          value:
            video.hashtags.length > 0
              ? video.hashtags.map((tag) => `#${sanitizeCell(tag)}`).join(' ')
              : none,
        },
        { label: 'File', value: sanitizeCell(video.filename) },
        { label: 'Size', value: formatBytes(video.sizeBytes) },
        {
          label: 'Duration',
          value: video.durationSeconds != null ? formatDuration(video.durationSeconds) : none,
        },
        {
          label: 'Dimensions',
          value:
            video.width != null && video.height != null
              ? `${String(video.width)}×${String(video.height)}`
              : none,
        },
        { label: 'Transcript', value: video.transcript?.status ?? none },
        { label: 'Playback', value: video.url ? sanitizeCell(video.url) : none },
        { label: 'Uploaded', value: formatTimestamp(video.createdAt) },
      ],
    },
  ]
  if (video.description) {
    blocks.push(
      { type: 'text', text: 'Description', bold: true },
      { type: 'text', text: video.description },
    )
  }
  if (video.descriptionZh) {
    blocks.push(
      { type: 'text', text: 'Description (Chinese)', bold: true },
      { type: 'text', text: video.descriptionZh },
    )
  }
  if (video.links.length > 0) {
    blocks.push(
      { type: 'text', text: 'Links', bold: true },
      {
        type: 'table',
        columns: [
          { key: 'title', label: 'Title', required: true, priority: 1 },
          { key: 'titleZh', label: 'Chinese title', priority: 3 },
          { key: 'url', label: 'URL', required: true, priority: 1 },
        ],
        rows: video.links.map((link) => ({
          title: sanitizeCell(link.title),
          titleZh: link.titleZh ? sanitizeCell(link.titleZh) : none,
          url: sanitizeCell(link.url),
        })),
      },
    )
  }
  if (video.subtitles.length > 0) {
    blocks.push(
      { type: 'text', text: 'Subtitles', bold: true },
      {
        type: 'table',
        columns: [
          { key: 'language', label: 'Language', required: true, priority: 1 },
          { key: 'format', label: 'Format', priority: 2 },
          { key: 'cues', label: 'Cues', priority: 2 },
          { key: 'file', label: 'File', priority: 3 },
        ],
        rows: video.subtitles.map((subtitle) => ({
          language: languageName(subtitle.language),
          format: subtitle.format.toUpperCase(),
          cues: subtitle.cueCount,
          file: subtitle.filename ? sanitizeCell(subtitle.filename) : none,
        })),
      },
    )
  }
  if (video.audioTracks.length > 0) {
    blocks.push(
      { type: 'text', text: 'Audio attachments', bold: true },
      {
        type: 'table',
        columns: [
          { key: 'language', label: 'Language', required: true, priority: 1 },
          { key: 'label', label: 'Label', priority: 3 },
          { key: 'file', label: 'File', priority: 2 },
          { key: 'duration', label: 'Duration', priority: 3 },
          { key: 'size', label: 'Size', priority: 2 },
          { key: 'url', label: 'URL', priority: 4 },
        ],
        rows: video.audioTracks.map((track) => ({
          language: languageName(track.language),
          label: track.label ? sanitizeCell(track.label) : none,
          file: sanitizeCell(track.filename),
          duration: track.durationSeconds != null ? formatDuration(track.durationSeconds) : none,
          size: formatBytes(track.sizeBytes),
          url: sanitizeCell(track.url),
        })),
      },
    )
  }
  return { title: sanitizeCell(video.title), blocks }
}
