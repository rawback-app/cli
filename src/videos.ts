import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  DeleteVideoDocument,
  type FfmpegPaths,
  prepareVideoUpload,
  UpdateVideoDocument,
  VIDEO_MIME_TYPES,
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
import { findBundledFfmpegPath, findBundledFfprobePath } from './upload-identity.ts'

export interface VideoCommandDependencies extends ReadCommandDependencies {
  /**
   * Overrides the local ffmpeg pass. Injected by tests so they neither need
   * ffmpeg installed nor a real encoded video to exercise the upload flow.
   */
  prepareVideo?: typeof prepareVideoUpload
}

type Video = VideosQuery['videos']['edges'][number]

/**
 * Prefers the binaries staged beside the compiled executable, falling back to
 * whatever is on PATH — which is what a developer machine with a system ffmpeg
 * wants.
 */
async function resolveFfmpegPaths(): Promise<FfmpegPaths> {
  const [ffmpegPath, ffprobePath] = await Promise.all([
    findBundledFfmpegPath(),
    findBundledFfprobePath(),
  ])
  return {
    ...(ffmpegPath ? { ffmpegPath } : {}),
    ...(ffprobePath ? { ffprobePath } : {}),
  }
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
  transcript?: boolean
}

export async function runVideoUpload(
  options: VideoUploadOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const stats = await stat(options.file)
  if (!stats.isFile()) throw new Error(`${options.file} is not a file`)

  // Rejects the extension early, before any network work, with the same list
  // the preparation step would use.
  resolveVideoMimeType(options.file)
  const client = await createCommandClient(dependencies)
  // Storage PUTs must carry no Rawback headers, so hand the service a bare
  // fetch rather than relying on the session client happening not to inject
  // any. Honour an injected fetch so tests can still intercept.
  const videos = new VideoService(client.http, dependencies.fetch ?? globalThis.fetch)

  // The server never opens the uploaded file: it has no ffmpeg, so the
  // container metadata, the poster frame and the split-out audio all have to be
  // produced here. An init without the metadata is rejected outright, which is
  // why this is not wrapped in a try/catch the way the poster frame is.
  const prepare = dependencies.prepareVideo ?? prepareVideoUpload
  const prepared = await ui.withActivity(
    `Reading ${basename(options.file)}…`,
    async () =>
      prepare(options.file, {
        ...(await resolveFfmpegPaths()),
        // --thumbnail wins over a frame cut from the video.
        ...(options.thumbnail
          ? {
              thumbnail: {
                // readFile rather than open(): the handle from open() was never
                // closed and leaked a descriptor.
                body: new Uint8Array(await readFile(options.thumbnail)),
                mimeType: resolveThumbnailMimeType(options.thumbnail),
              },
            }
          : {}),
        ...(options.transcript === false ? { skipAudio: true } : {}),
      }),
    !options.json,
  )

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

        return videos.uploadVideo(prepared.init, readPart, {
          ...(prepared.audio ? { audio: prepared.audio } : {}),
          ...(prepared.thumbnail ? { thumbnail: prepared.thumbnail } : {}),
        })
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
    // Releases the temp directory holding the extracted audio chunks.
    await prepared.cleanup()
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
