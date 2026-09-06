import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { VideoDocument, type VideoQuery, VideoService } from '@rawback/sdk'

import { commandOutput, createCommandClient } from './command.ts'
import {
  describeVideoAttachmentError,
  prepareVideoFile,
  resolveThumbnailMimeType,
  resolveVideoMimeType,
  type VideoCommandDependencies,
  type VideoUploadOptions,
} from './videos.ts'

export interface VideoRepairOptions extends VideoUploadOptions {
  id: number
}

type Video = NonNullable<VideoQuery['video']>
type AttachmentResult = { status: 'repaired' | 'skipped' | 'failed'; reason: string }

/** Repairs attachments only; never creates or reuploads the video body. */
export async function runVideoRepair(
  options: VideoRepairOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  if (!Number.isSafeInteger(options.id) || options.id < 1)
    throw new Error('--id must be a positive integer')
  const stats = await stat(options.file)
  if (!stats.isFile()) throw new Error(`${options.file} is not a file`)
  const mimeType = resolveVideoMimeType(options.file)
  if (options.thumbnail) resolveThumbnailMimeType(options.thumbnail)
  const ui = commandOutput(dependencies)
  const client = await createCommandClient(dependencies)
  const result = await client.graphql.query({ query: VideoDocument, variables: { id: options.id } })
  if (result.error) throw result.error
  const video = result.data?.video
  if (!video) throw new Error(`Video ${String(options.id)} was not found or is not accessible`)
  if (video.status !== 'completed')
    throw new Error('Only completed videos can have their attachments repaired')
  if (
    video.filename !== basename(options.file) ||
    video.sizeBytes !== stats.size ||
    video.mimeType !== mimeType
  ) {
    throw new Error(
      'The file does not match this video’s original filename, size, and MIME type; provide the original uploaded file',
    )
  }
  // The count is required from the new server schema. Do not interpret an old
  // server's missing field as zero and risk replacing existing audio.
  if (!Number.isSafeInteger(video.audioChunkCount) || video.audioChunkCount < 0) {
    throw new Error(
      'The server did not return an audio chunk count; update the server before repairing videos',
    )
  }

  const needsThumbnail = Boolean(options.thumbnail) || !video.thumbnailUrl
  const audioSkip = audioSkipReason(video, options.transcript)
  const attachments: Record<'thumbnail' | 'audio', AttachmentResult> = {
    thumbnail: { status: 'skipped', reason: 'Thumbnail already exists' },
    audio: { status: 'skipped', reason: audioSkip ?? 'Audio not yet attached' },
  }
  const failed = (attachment: 'thumbnail' | 'audio', error: unknown) => {
    const reason = describeVideoAttachmentError(error)
    attachments[attachment] = { status: 'failed', reason }
    ui.warning(`${attachment}: ${reason}.`)
  }
  const prepared = await ui.withActivity(
    `Reading ${basename(options.file)}…`,
    () =>
      prepareVideoFile(options, dependencies, {
        skipThumbnail: !needsThumbnail,
        skipAudio: audioSkip !== undefined,
        onPreparationError: failed,
      }),
    !options.json,
  )
  try {
    const probe = prepared.probe
    if (
      prepared.init.sizeBytes !== video.sizeBytes ||
      video.width !== probe.width ||
      video.height !== probe.height ||
      video.hasAudio !== probe.hasAudio ||
      video.durationSeconds == null ||
      !Number.isFinite(video.durationSeconds) ||
      Math.abs(video.durationSeconds - probe.durationSeconds) > 1
    ) {
      throw new Error(
        'The file’s dimensions, duration, or audio presence do not match this video; no attachments were changed',
      )
    }
    const videos = new VideoService(client.http, dependencies.fetch ?? globalThis.fetch)
    await ui.withActivity(
      'Repairing video attachments…',
      async () => {
        if (needsThumbnail && attachments.thumbnail.status !== 'failed') {
          if (!prepared.thumbnail) failed('thumbnail', undefined)
          else {
            try {
              await videos.uploadThumbnail(video.id, prepared.thumbnail)
              attachments.thumbnail = { status: 'repaired', reason: 'Thumbnail attached' }
            } catch (error) {
              failed('thumbnail', error)
            }
          }
        }
        if (audioSkip === undefined && attachments.audio.status !== 'failed') {
          if (!prepared.audio?.chunks.length) failed('audio', undefined)
          else {
            try {
              await videos.uploadAudio(video.id, prepared.audio)
              attachments.audio = {
                status: 'repaired',
                reason:
                  'Audio attached; transcription runs asynchronously when enabled on the server',
              }
            } catch (error) {
              failed('audio', error)
            }
          }
        }
      },
      !options.json,
    )
    if (options.json) ui.json({ videoId: video.id, attachments })
    else {
      for (const [name, attachment] of Object.entries(attachments)) {
        ui.info(`${name}: ${attachment.status} — ${attachment.reason}`)
      }
    }
    if (Object.values(attachments).some((attachment) => attachment.status === 'failed')) {
      throw new Error(
        `Video ${String(video.id)} still has missing attachments; successful repairs were preserved. Run videos repair again after resolving the warnings`,
      )
    }
  } finally {
    await prepared.cleanup()
  }
}

function audioSkipReason(video: Video, transcript: boolean | undefined): string | undefined {
  if (transcript === false) return 'Skipped with --no-transcript'
  if (!video.hasAudio) return 'Video has no audio track'
  const status = video.transcript?.status
  if (status === 'failed' || status === 'skipped') {
    return `Transcription is ${status}; check server configuration and worker jobs. Attachment repair does not restart transcription jobs`
  }
  if (video.audioChunkCount > 0) return 'Audio already exists; no audio was replaced'
  if (status === 'pending' || status === 'processing' || status === 'completed')
    return `Transcription is ${status}; no audio was replaced`
  return undefined
}
