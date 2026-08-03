import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  DeleteVideoDocument,
  UpdateVideoDocument,
  VideoService,
  VideosDocument,
  type VideosQuery,
} from '@rawback/sdk'

import {
  commandOutput,
  createCommandClient,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { videoListDocument } from './features/videos/view.ts'

export type VideoCommandDependencies = ReadCommandDependencies
type Video = VideosQuery['videos']['edges'][number]

/**
 * Extension → MIME map matching the server's video allowlist. The server signs
 * the content type into the upload, so it has to be declared up front.
 */
const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
}

/** The server signs the content type into the presign, so it must be right. */
const THUMBNAIL_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function resolveThumbnailMimeType(filePath: string): string {
  const mime = THUMBNAIL_MIME_TYPES[extname(filePath).toLowerCase()]
  if (!mime) {
    throw new Error(
      `Unsupported thumbnail type for ${basename(filePath)}. Supported: ${Object.keys(THUMBNAIL_MIME_TYPES).join(', ')}`,
    )
  }
  return mime
}

export function resolveVideoMimeType(filePath: string): string {
  const mime = VIDEO_MIME_TYPES[extname(filePath).toLowerCase()]
  if (!mime) {
    throw new Error(
      `Unsupported video type for ${basename(filePath)}. Supported: ${Object.keys(VIDEO_MIME_TYPES).join(', ')}`,
    )
  }
  return mime
}

function serializeVideo(video: Video) {
  return {
    id: video.id,
    title: video.title,
    description: video.description ?? null,
    filename: video.filename,
    sizeBytes: video.sizeBytes,
    mimeType: video.mimeType,
    durationSeconds: video.durationSeconds ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    status: video.status,
    thumbnailUrl: video.thumbnailUrl ?? null,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  }
}

export interface VideoListOptions {
  json?: boolean
  page: number
  pageSize: number
}

export async function runVideoList(
  options: VideoListOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize)

  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading videos…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: VideosDocument,
        variables: { pagination: { page: options.page, pageSize: options.pageSize } },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The videos response did not include video data')

  const { edges, pageInfo } = result.data.videos
  if (options.json) {
    ui.json({
      videos: edges.map(serializeVideo),
      pageInfo: {
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
        hasNextPage: pageInfo.hasNextPage,
        hasPreviousPage: pageInfo.hasPreviousPage,
      },
    })
    return
  }
  ui.document(videoListDocument(edges, pageInfo))
}

export interface VideoUploadOptions {
  file: string
  json?: boolean
  thumbnail?: string
}

export async function runVideoUpload(
  options: VideoUploadOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const stats = await stat(options.file)
  if (!stats.isFile()) throw new Error(`${options.file} is not a file`)

  const mimeType = resolveVideoMimeType(options.file)
  const client = await createCommandClient(dependencies)
  // Storage PUTs must carry no Rawback headers, so hand the service a bare
  // fetch rather than relying on the session client happening not to inject
  // any. Honour an injected fetch so tests can still intercept.
  const videos = new VideoService(client.http, dependencies.fetch ?? globalThis.fetch)

  const handle = await open(options.file, 'r')
  try {
    const video = await ui.withActivity(
      `Uploading ${basename(options.file)}…`,
      async () => {
        // Parts are read on demand so a very large video is never held in
        // memory all at once. A positional read can come back short, so keep
        // reading until the part is full — otherwise the unfilled tail is
        // zeroes and would upload as silently corrupt data.
        const readPart = async (_partNumber: number, start: number, end: number) => {
          const buffer = new Uint8Array(end - start)
          let filled = 0
          while (filled < buffer.byteLength) {
            const { bytesRead } = await handle.read(
              buffer,
              filled,
              buffer.byteLength - filled,
              start + filled,
            )
            if (bytesRead === 0) {
              throw new Error(`${basename(options.file)} ended early; it changed while uploading`)
            }
            filled += bytesRead
          }
          return buffer
        }

        const thumbnail = options.thumbnail
          ? {
              // readFile rather than open(): the handle from open() was never
              // closed and leaked a descriptor.
              body: new Uint8Array(await readFile(options.thumbnail)),
              mimeType: resolveThumbnailMimeType(options.thumbnail),
            }
          : undefined

        return videos.uploadVideo(
          {
            filename: basename(options.file),
            sizeBytes: stats.size,
            mimeType,
          },
          readPart,
          thumbnail ? { thumbnail } : {},
        )
      },
      !options.json,
    )

    if (options.json) {
      ui.json({ video })
      return
    }
    ui.success(`Uploaded ${video.filename} (id ${String(video.id)})`)
  } finally {
    await handle.close()
  }
}

export interface VideoUpdateOptions {
  id: number
  description?: string
  json?: boolean
  title?: string
}

export async function runVideoUpdate(
  options: VideoUpdateOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  if (options.title === undefined && options.description === undefined) {
    throw new Error('Provide --title and/or --description')
  }

  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Updating video…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.mutate({
        mutation: UpdateVideoDocument,
        variables: {
          id: options.id,
          input: {
            ...(options.title !== undefined ? { title: options.title } : {}),
            ...(options.description !== undefined ? { description: options.description } : {}),
          },
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The update response did not include video data')

  if (options.json) {
    ui.json({ video: result.data.updateVideo })
    return
  }
  ui.success(`Updated video ${String(options.id)}`)
}

export interface VideoDeleteOptions {
  id: number
  json?: boolean
}

export async function runVideoDelete(
  options: VideoDeleteOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Deleting video…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.mutate({
        mutation: DeleteVideoDocument,
        variables: { id: options.id },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error

  if (options.json) {
    ui.json({ deleted: result.data?.deleteVideo ?? false })
    return
  }
  ui.success(`Deleted video ${String(options.id)}`)
}
