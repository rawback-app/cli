import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  DeleteVideoDocument,
  type FfmpegPaths,
  prepareVideoUpload,
  type PrepareVideoOptions,
  RawbackHttpError,
  UpdateVideoDocument,
  VIDEO_MIME_TYPES,
  VideoService,
  VideoToolError,
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
  resolveVideoTools?: () => Promise<FfmpegPaths>
}

type Video = VideosQuery['videos']['edges'][number]

interface VideoToolDependencies {
  which?: (command: string) => string | null
  platform?: NodeJS.Platform
  findBundledFfmpeg?: () => Promise<string | undefined>
  findBundledFfprobe?: () => Promise<string | undefined>
}

/** Prefer each tool on PATH independently, falling back to its bundled copy. */
export async function resolveFfmpegPaths(
  dependencies: VideoToolDependencies = {},
): Promise<FfmpegPaths> {
  const which = dependencies.which ?? Bun.which
  const suffix = (dependencies.platform ?? process.platform) === 'win32' ? '.exe' : ''
  const [ffmpegPath, ffprobePath] = await Promise.all([
    which(`ffmpeg${suffix}`) ?? (dependencies.findBundledFfmpeg ?? findBundledFfmpegPath)(),
    which(`ffprobe${suffix}`) ?? (dependencies.findBundledFfprobe ?? findBundledFfprobePath)(),
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

/** Never echo API bodies or presigned URLs: both can contain credentials. */
export function describeVideoAttachmentError(error: unknown): string {
  if (error instanceof RawbackHttpError) {
    return `API returned HTTP ${String(error.status)}; check storage permissions and quota`
  }
  if (error instanceof VideoToolError) {
    if (/ENOENT|EACCES|failed to run/.test(error.message)) {
      return 'FFmpeg could not be started; check the bundled tools or FFmpeg on PATH'
    }
    return 'FFmpeg could not extract this attachment; check that the original file decodes with your FFmpeg build'
  }
  if (error instanceof Error) {
    const storageFailure = error.message.match(
      /^(?:Thumbnail upload|Audio chunk \d+) failed with status \d+$/,
    )
    if (storageFailure) return `${storageFailure[0]}; check storage access`
  }
  return 'processing or storage access failed; check the original file, local tools, and server logs'
}

export async function prepareVideoFile(
  options: VideoUploadOptions,
  dependencies: VideoCommandDependencies,
  preparation: PrepareVideoOptions = {},
) {
  // Validate the MIME type before opening an explicitly supplied thumbnail.
  const thumbnailMime = options.thumbnail ? resolveThumbnailMimeType(options.thumbnail) : undefined
  return (dependencies.prepareVideo ?? prepareVideoUpload)(options.file, {
    ...(await (dependencies.resolveVideoTools ?? resolveFfmpegPaths)()),
    ...preparation,
    ...(options.thumbnail && thumbnailMime
      ? {
          thumbnail: {
            body: new Uint8Array(await readFile(options.thumbnail)),
            mimeType: thumbnailMime,
          },
        }
      : {}),
    ...(options.transcript === false ? { skipAudio: true } : {}),
  })
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

  const attachmentFailures = new Set<'thumbnail' | 'audio'>()
  const reportFailure = (attachment: 'thumbnail' | 'audio', error: unknown) => {
    attachmentFailures.add(attachment)
    ui.warning(
      `${attachment === 'audio' ? 'Transcript audio' : 'Thumbnail'} unavailable: ${describeVideoAttachmentError(error)}.`,
    )
  }
  const prepared = await ui.withActivity(
    `Reading ${basename(options.file)}…`,
    () => prepareVideoFile(options, dependencies, { onPreparationError: reportFailure }),
    !options.json,
  )

  try {
    // Also detect an empty result from a custom preparation adapter.
    if (!prepared.thumbnail && !attachmentFailures.has('thumbnail'))
      reportFailure('thumbnail', undefined)
    if (
      prepared.probe.hasAudio &&
      options.transcript !== false &&
      !prepared.audio?.chunks.length &&
      !attachmentFailures.has('audio')
    )
      reportFailure('audio', undefined)
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
            onAttachmentError: reportFailure,
            ...(prepared.audio ? { audio: prepared.audio } : {}),
            ...(prepared.thumbnail ? { thumbnail: prepared.thumbnail } : {}),
          })
        },
        !options.json,
      )

      if (attachmentFailures.size > 0) {
        ui.warning(
          `Video saved with missing attachments. Repair with rawback --env ${client.environment.name} videos repair --id ${String(video.id)} --file <original-file>.`,
        )
      }

      if (options.json) {
        ui.json({ video })
        return
      }
      ui.success(`Uploaded ${video.filename} (id ${String(video.id)})`)
      if (!prepared.probe.hasAudio)
        ui.info('This video has no audio track; no transcript is expected.')
      else if (options.transcript === false)
        ui.info(
          'Transcript audio was skipped; use videos repair with the original file to attach it later.',
        )
      else if (!attachmentFailures.has('audio'))
        ui.info(
          'Audio uploaded. Transcription runs asynchronously when enabled on the server; view its status on the video page.',
        )
    } finally {
      await handle.close()
    }
  } finally {
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
