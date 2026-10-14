import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  DeleteVideoAudioTrackDocument,
  DeleteVideoSubtitleDocument,
  openAudioTrackFile,
  parseVideoLanguage,
  readSubtitleFile,
  UploadVideoSubtitleDocument,
  type VideoLanguage,
  type VideoLinkInput,
  VideoDocument,
  VideoService,
  VideoSubtitlesDocument,
} from '@rawback/sdk'

import { commandOutput, createCommandClient } from './command.ts'
import { videoViewDocument } from './features/videos/view.ts'
import { formatBytes } from './ui/format.ts'
import type { VideoCommandDependencies } from './videos.ts'

/**
 * Hashtags as typed: repeat the option or comma-separate, with or without the
 * #. Normalising beyond that (letters, numbers, _ and -; duplicates) is the
 * server's job, so its message is the one the user sees.
 */
export function parseHashtags(values: Array<string | number> | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => String(value).split(/[,，]/))
    .map((tag) => tag.trim().replace(/^[#＃]+/, ''))
    .filter(Boolean)
}

/** `url`, `url|title` or `url|title|中文 title`. */
export function parseVideoLink(value: string): VideoLinkInput {
  const [url = '', title, titleZh] = value.split('|').map((part) => part.trim())
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`--link must start with an http or https URL: ${value}`)
  }
  return {
    url,
    ...(title ? { title } : {}),
    ...(titleZh ? { titleZh } : {}),
  }
}

export function validateVideoLanguage(value: string): VideoLanguage {
  const language = parseVideoLanguage(value)
  if (!language) throw new Error(`--language must be en or zh, not ${value}`)
  return language
}

function validateVideoId(id: number): number {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Video ID must be a positive integer')
  return id
}

export interface VideoGetOptions {
  id: number
  json?: boolean
}

export async function runVideoGet(
  options: VideoGetOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading video…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({ query: VideoDocument, variables: { id } })
    },
    !options.json,
  )
  if (result.error) throw result.error
  const video = result.data?.video
  if (!video) throw new Error(`Video ${String(id)} was not found`)

  if (options.json) {
    ui.json({ video })
    return
  }
  ui.document(videoViewDocument(video))
}

export type SubtitleOutputFormat = 'srt' | 'vtt' | 'text'

export interface VideoSubtitleUploadOptions {
  id: number
  language: string
  file: string
  json?: boolean
}

export async function runVideoSubtitleUpload(
  options: VideoSubtitleUploadOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const language = validateVideoLanguage(options.language)
  const subtitle = await readSubtitleFile(options.file)

  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    `Uploading ${subtitle.filename}…`,
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.mutate({
        mutation: UploadVideoSubtitleDocument,
        variables: {
          videoId: id,
          input: { language, content: subtitle.content, filename: subtitle.filename },
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  const saved = result.data?.uploadVideoSubtitle
  if (!saved) throw new Error('The upload response did not include the subtitle')

  if (options.json) {
    ui.json({ subtitle: saved })
    return
  }
  ui.success(
    `Saved ${language} subtitles for video ${String(id)} (${String(saved.cueCount)} cues, ${saved.format.toUpperCase()})`,
  )
}

/** The words of a WebVTT document, one cue per line, without timing or markup. */
export function subtitlePlainText(vtt: string): string {
  const lines: string[] = []
  for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const rows = block.split('\n')
    const timing = rows.findIndex((row) => row.includes('-->'))
    if (timing === -1) continue
    const text = rows
      .slice(timing + 1)
      .map((row) => row.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join(' ')
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

export interface VideoSubtitleViewOptions {
  id: number
  language: string
  format?: SubtitleOutputFormat
  output?: string
  json?: boolean
}

export async function runVideoSubtitleView(
  options: VideoSubtitleViewOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const language = validateVideoLanguage(options.language)
  const format = options.format ?? 'srt'

  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading subtitles…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({ query: VideoSubtitlesDocument, variables: { id } })
    },
    !options.json && !options.output,
  )
  if (result.error) throw result.error
  const video = result.data?.video
  if (!video) throw new Error(`Video ${String(id)} was not found`)
  const subtitle = video.subtitles.find((item) => item.language === language)
  if (!subtitle) throw new Error(`Video ${String(id)} has no ${language} subtitles`)

  const meta = {
    id: subtitle.id,
    language: subtitle.language,
    format: subtitle.format,
    filename: subtitle.filename ?? null,
    cueCount: subtitle.cueCount,
    sizeBytes: subtitle.sizeBytes,
    updatedAt: subtitle.updatedAt,
  }
  const content =
    format === 'vtt'
      ? subtitle.vttContent
      : format === 'text'
        ? subtitlePlainText(subtitle.vttContent)
        : subtitle.srtContent

  if (options.output) {
    await writeFile(options.output, content.endsWith('\n') ? content : `${content}\n`)
    if (options.json) {
      ui.json({ subtitle: meta, outputFormat: format, output: options.output })
      return
    }
    ui.success(`Wrote ${language} subtitles to ${options.output}`)
    return
  }
  if (options.json) {
    ui.json({ subtitle: meta, outputFormat: format, content })
    return
  }
  ui.raw(content.endsWith('\n') ? content : `${content}\n`)
}

export interface VideoMediaDeleteOptions {
  id: number
  language: string
  json?: boolean
}

export async function runVideoSubtitleDelete(
  options: VideoMediaDeleteOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const language = validateVideoLanguage(options.language)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Deleting subtitles…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.mutate({
        mutation: DeleteVideoSubtitleDocument,
        variables: { videoId: id, language },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (options.json) {
    ui.json({ deleted: result.data?.deleteVideoSubtitle ?? false })
    return
  }
  ui.success(`Deleted the ${language} subtitles of video ${String(id)}`)
}

export interface VideoAudioUploadOptions {
  id: number
  language: string
  file: string
  label?: string
  json?: boolean
}

export async function runVideoAudioUpload(
  options: VideoAudioUploadOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const language = validateVideoLanguage(options.language)
  const label = options.label?.trim()
  const track = await openAudioTrackFile(options.file, {
    language,
    ...(label ? { label } : {}),
  })

  const ui = commandOutput(dependencies)
  const client = await createCommandClient(dependencies)
  // Storage PUTs must carry no Rawback headers; see runVideoUpload.
  const videos = new VideoService(client.http, dependencies.fetch ?? globalThis.fetch)
  const saved = await ui.withActivity(
    `Uploading ${basename(options.file)}…`,
    () => videos.uploadAudioTrack(id, track),
    !options.json,
  )

  if (options.json) {
    ui.json({ audioTrack: saved })
    return
  }
  ui.success(
    `Attached ${saved.filename} (${formatBytes(saved.sizeBytes)}) as the ${language} audio of video ${String(id)}`,
  )
}

export async function runVideoAudioDelete(
  options: VideoMediaDeleteOptions,
  dependencies: VideoCommandDependencies = {},
): Promise<void> {
  const id = validateVideoId(options.id)
  const language = validateVideoLanguage(options.language)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Deleting audio…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.mutate({
        mutation: DeleteVideoAudioTrackDocument,
        variables: { videoId: id, language },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (options.json) {
    ui.json({ deleted: result.data?.deleteVideoAudioTrack ?? false })
    return
  }
  ui.success(`Deleted the ${language} audio of video ${String(id)}`)
}
