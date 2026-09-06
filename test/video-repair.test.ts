import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type PrepareVideoOptions, type PreparedVideo, VideoToolError } from '@rawback/sdk'

import { writeCredentials } from '../src/credentials.ts'
import { runVideoRepair } from '../src/video-repair.ts'
import { runVideoUpload, type VideoCommandDependencies } from '../src/videos.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-video-attachments-'))
  directories.push(directory)
  const file = join(directory, 'clip.mp4')
  await writeFile(file, new Uint8Array(24))
  const credentialsPath = join(directory, 'credentials.json')
  await writeCredentials(
    { token: 'private-token', refreshToken: 'private-refresh' },
    credentialsPath,
  )
  const stdout: string[] = []
  const stderr: string[] = []
  const requests: Array<{ url: string; init: RequestInit | undefined }> = []
  const preparations: PrepareVideoOptions[] = []
  const video = {
    id: 7,
    title: 'clip',
    filename: 'clip.mp4',
    description: null,
    sizeBytes: 24,
    mimeType: 'video/mp4',
    durationSeconds: 12,
    width: 1920,
    height: 1080,
    hasAudio: true,
    audioChunkCount: 0,
    status: 'completed',
    thumbnailUrl: null as string | null,
    transcript: null as { status: string } | null,
    createdAt: 1,
    updatedAt: 1,
  }
  let cleaned = 0
  let failurePath: string | undefined
  let preparationFailure: 'thumbnail' | 'audio' | 'both' | undefined
  const probe = {
    containerFormat: 'mov,mp4,m4a',
    durationSeconds: 12,
    width: 1920,
    height: 1080,
    hasAudio: true,
    videoCodec: 'h264',
  }
  const prepareVideo: NonNullable<VideoCommandDependencies['prepareVideo']> = async (
    _file,
    options = {},
  ) => {
    preparations.push(options)
    const result: PreparedVideo = {
      probe: { ...probe },
      init: { ...probe, filename: 'clip.mp4', sizeBytes: 24, mimeType: 'video/mp4' },
      cleanup: async () => {
        cleaned += 1
      },
    }
    if (!options.skipThumbnail || options.thumbnail) {
      if (preparationFailure === 'thumbnail' || preparationFailure === 'both')
        options.onPreparationError?.(
          'thumbnail',
          new VideoToolError('failed to run ffmpeg: ENOENT'),
        )
      else
        result.thumbnail = options.thumbnail ?? {
          body: new Uint8Array([1, 2]),
          mimeType: 'image/jpeg',
        }
    }
    if (probe.hasAudio && !options.skipAudio) {
      if (preparationFailure === 'audio' || preparationFailure === 'both')
        options.onPreparationError?.('audio', new VideoToolError('ffmpeg exited with code 1'))
      else
        result.audio = {
          mimeType: 'audio/mpeg',
          chunks: [{ index: 0, startSeconds: 0, endSeconds: 12, body: new Uint8Array([3, 4]) }],
        }
    }
    return result
  }
  const envelope = (data: unknown) => Response.json({ code: 200, data, msg: '' })
  const fetchImpl: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (failurePath && url.endsWith(failurePath))
        return Response.json(
          { msg: 'private-token private-refresh https://s3.test?signature=secret' },
          { status: 403 },
        )
      if (url.endsWith('/api/v2/graphql')) return Response.json({ data: { video: { ...video } } })
      if (url.endsWith('/videos'))
        return envelope({
          videoId: 7,
          s3Key: 'video',
          partSizeBytes: 24,
          partCount: 1,
          contentType: 'video/mp4',
        })
      if (url.endsWith('/thumbnail'))
        return envelope({
          uploadUrl: 'https://s3.test/poster',
          s3Key: 'poster',
          contentType: 'image/jpeg',
          expiresAt: 'x',
        })
      if (url.endsWith('/thumbnail/confirm')) {
        video.thumbnailUrl = 'https://cdn.test/poster'
        return envelope({ ...video })
      }
      if (url.endsWith('/audio'))
        return envelope({
          chunks: [
            {
              index: 0,
              uploadUrl: 'https://s3.test/audio',
              s3Key: 'audio',
              contentType: 'audio/mpeg',
              expiresAt: 'x',
            },
          ],
        })
      if (url.endsWith('/audio/confirm')) {
        video.audioChunkCount = 1
        return envelope({})
      }
      if (url.endsWith('/parts'))
        return envelope({ parts: [{ partNumber: 1, url: 'https://s3.test/part', expiresAt: 'x' }] })
      if (url.endsWith('/complete')) return envelope({ ...video })
      if (url.startsWith('https://s3.test/'))
        return new Response(null, { status: 200, headers: { etag: 'etag-1' } })
      throw new Error(`Unexpected request: ${url}`)
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const dependencies: VideoCommandDependencies = {
    configPath: join(directory, 'config.yml'),
    credentialsPath,
    resolveVideoTools: async () => ({
      ffmpegPath: '/fixture/ffmpeg',
      ffprobePath: '/fixture/ffprobe',
    }),
    fetch: fetchImpl,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    prepareVideo,
  }
  return {
    directory,
    file,
    video,
    probe,
    dependencies,
    stdout,
    stderr,
    requests,
    preparations,
    get cleaned() {
      return cleaned
    },
    failAt: (path: string) => {
      failurePath = path
    },
    failPreparation: (attachment: typeof preparationFailure) => {
      preparationFailure = attachment
    },
  }
}

function writes(h: Awaited<ReturnType<typeof harness>>) {
  return h.requests.filter(({ url }) => !url.endsWith('/api/v2/graphql'))
}

describe('video attachment upload reporting', () => {
  test('uploads and confirms both attachments before completing the video', async () => {
    const h = await harness()
    await runVideoUpload({ file: h.file, json: true }, h.dependencies)
    const payload = JSON.parse(h.stdout.join(''))
    expect(Object.keys(payload)).toEqual(['video'])
    expect(payload.video.audioChunkCount).toBe(1)
    expect(payload.video.thumbnailUrl).toBeTruthy()
    expect(h.stderr).toEqual([])
    expect(h.requests.at(-1)?.url).toEndWith('/complete')
    for (const request of h.requests.filter(({ url }) => url.startsWith('https://s3.test/'))) {
      expect(new Headers(request.init?.headers).has('authorization')).toBe(false)
      expect(new Headers(request.init?.headers).has('x-rawback-client-source')).toBe(false)
    }
    expect(h.cleaned).toBe(1)
  })
  test('reports extraction failures without contaminating JSON or losing the video', async () => {
    const h = await harness()
    h.failPreparation('both')
    await runVideoUpload({ file: h.file, json: true }, h.dependencies)
    expect(JSON.parse(h.stdout.join('')).video.id).toBe(7)
    expect(h.stderr.join('\n')).toContain('FFmpeg could not be started')
    expect(h.stderr.join('\n')).toContain('FFmpeg could not extract')
    expect(h.stderr.join('\n').replace(/\s+/g, ' ')).toContain('videos repair --id 7')
    expect(h.cleaned).toBe(1)
  })
  test.each(['/thumbnail', '/audio/confirm'])(
    'reports attachment API failure at %s without exposing credentials',
    async (path) => {
      const h = await harness()
      h.failAt(path)
      await runVideoUpload({ file: h.file, json: true }, h.dependencies)
      expect(JSON.parse(h.stdout.join('')).video.id).toBe(7)
      expect(h.stderr.join('')).toContain('HTTP 403')
      expect(h.stderr.join('')).not.toContain('private-token')
      expect(h.stderr.join('')).not.toContain('private-refresh')
      expect(h.stderr.join('')).not.toContain('signature=secret')
    },
  )
  test.each([false, true])(
    'does not warn about intentionally absent audio (hasAudio=%s)',
    async (hasAudio) => {
      const h = await harness()
      h.probe.hasAudio = hasAudio
      await runVideoUpload({ file: h.file, transcript: false }, h.dependencies)
      expect(h.stderr).toEqual([])
      expect(h.requests.some(({ url }) => url.endsWith('/audio/confirm'))).toBe(false)
      expect(h.stdout.join('')).toContain(hasAudio ? 'skipped' : 'no audio track')
    },
  )
  test('honors an explicitly supplied WebP thumbnail', async () => {
    const h = await harness()
    const thumbnail = join(h.directory, 'poster.webp')
    await writeFile(thumbnail, new Uint8Array([6, 7, 8]))
    await runVideoUpload({ file: h.file, thumbnail, json: true }, h.dependencies)
    expect(h.preparations[0]?.thumbnail).toEqual({
      body: new Uint8Array([6, 7, 8]),
      mimeType: 'image/webp',
    })
  })
  test('cleans preparation resources even if opening the original video fails', async () => {
    const h = await harness()
    const prepare = h.dependencies.prepareVideo!
    h.dependencies.prepareVideo = async (...args) => {
      const result = await prepare(...args)
      await rm(h.file)
      return result
    }
    await expect(runVideoUpload({ file: h.file }, h.dependencies)).rejects.toThrow()
    expect(h.cleaned).toBe(1)
  })
})

describe('videos repair', () => {
  test('repairs only attachments and is a no-op when repeated', async () => {
    const h = await harness()
    await runVideoRepair({ id: 7, file: h.file, json: true }, h.dependencies)
    const payload = JSON.parse(h.stdout.join(''))
    expect(payload.videoId).toBe(7)
    expect(h.preparations[0]).toMatchObject({
      ffmpegPath: '/fixture/ffmpeg',
      ffprobePath: '/fixture/ffprobe',
    })
    expect(payload.attachments.thumbnail.status).toBe('repaired')
    expect(payload.attachments.audio.status).toBe('repaired')
    expect(h.requests.some(({ url }) => /\/(videos|parts|complete)$/.test(url))).toBe(false)
    const previousWrites = writes(h).length
    await runVideoRepair({ id: 7, file: h.file, json: true }, h.dependencies)
    expect(writes(h)).toHaveLength(previousWrites)
    expect(h.preparations.at(-1)).toMatchObject({ skipThumbnail: true, skipAudio: true })
    expect(h.cleaned).toBe(2)
  })
  test('preserves a repaired thumbnail when audio fails and returns partial JSON', async () => {
    const h = await harness()
    h.failAt('/audio/confirm')
    await expect(
      runVideoRepair({ id: 7, file: h.file, json: true }, h.dependencies),
    ).rejects.toThrow('successful repairs were preserved')
    const payload = JSON.parse(h.stdout.join(''))
    expect(payload.attachments.thumbnail.status).toBe('repaired')
    expect(payload.attachments.audio.status).toBe('failed')
    expect(h.video.thumbnailUrl).toBeTruthy()
    expect(h.cleaned).toBe(1)
  })
  test('continues audio repair when thumbnail preparation fails', async () => {
    const h = await harness()
    h.failPreparation('thumbnail')
    await expect(
      runVideoRepair({ id: 7, file: h.file, json: true }, h.dependencies),
    ).rejects.toThrow()
    expect(h.video.audioChunkCount).toBe(1)
    expect(JSON.parse(h.stdout.join('')).attachments.thumbnail.status).toBe('failed')
  })
  test.each(['pending', 'failed'])('rejects a %s video before preparation', async (status) => {
    const h = await harness()
    h.video.status = status
    await expect(runVideoRepair({ id: 7, file: h.file }, h.dependencies)).rejects.toThrow(
      'Only completed',
    )
    expect(h.preparations).toEqual([])
    expect(writes(h)).toEqual([])
  })
  test.each(['filename', 'sizeBytes', 'mimeType'] as const)(
    'rejects mismatched %s before preparation',
    async (field) => {
      const h = await harness()
      if (field === 'sizeBytes') h.video.sizeBytes += 1
      else h.video[field] = 'different'
      await expect(runVideoRepair({ id: 7, file: h.file }, h.dependencies)).rejects.toThrow(
        'does not match',
      )
      expect(h.preparations).toEqual([])
      expect(writes(h)).toEqual([])
    },
  )
  test.each(['width', 'height', 'durationSeconds', 'hasAudio'] as const)(
    'rejects mismatched %s before storage writes and cleans up',
    async (field) => {
      const h = await harness()
      if (field === 'hasAudio') h.probe.hasAudio = false
      else h.probe[field] += 2
      await expect(runVideoRepair({ id: 7, file: h.file }, h.dependencies)).rejects.toThrow(
        'do not match',
      )
      expect(writes(h)).toEqual([])
      expect(h.cleaned).toBe(1)
    },
  )
  test.each(['pending', 'processing', 'completed', 'failed', 'skipped'])(
    'does not replace audio for a %s transcript',
    async (status) => {
      const h = await harness()
      h.video.transcript = { status }
      await runVideoRepair({ id: 7, file: h.file, json: true }, h.dependencies)
      expect(h.preparations[0]?.skipAudio).toBe(true)
      expect(h.video.audioChunkCount).toBe(0)
      expect(JSON.parse(h.stdout.join('')).attachments.audio.reason).toContain(status)
    },
  )
  test('only replaces an existing poster when a thumbnail is supplied explicitly', async () => {
    const h = await harness()
    h.video.thumbnailUrl = 'old-poster'
    const thumbnail = join(h.directory, 'new.png')
    await writeFile(thumbnail, new Uint8Array([9]))
    await runVideoRepair(
      { id: 7, file: h.file, thumbnail, transcript: false, json: true },
      h.dependencies,
    )
    expect(h.preparations[0]?.thumbnail?.mimeType).toBe('image/png')
    expect(h.video.thumbnailUrl).toBe('https://cdn.test/poster')
    expect(h.video.audioChunkCount).toBe(0)
  })
  test('validates IDs before reading files or creating a client', async () => {
    await expect(runVideoRepair({ id: -1, file: '/missing.mp4' })).rejects.toThrow('--id')
  })
})
