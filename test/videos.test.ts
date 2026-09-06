import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
  resolveFfmpegPaths,
  resolveThumbnailMimeType,
  resolveVideoMimeType,
  runVideoDelete,
  runVideoList,
  runVideoUpload,
  type VideoCommandDependencies,
} from '../src/videos.ts'

const temporaryDirectories: string[] = []

async function dependencies(
  handler: (url: string, init: RequestInit | undefined) => Response,
  output: string[],
): Promise<VideoCommandDependencies> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-videos-'))
  temporaryDirectories.push(directory)
  const credentialsPath = join(directory, 'credentials.json')
  await writeCredentials({ token: 'token', refreshToken: 'refresh' }, credentialsPath)
  return {
    configPath: join(directory, 'config.yml'),
    credentialsPath,
    resolveVideoTools: async () => ({}),
    fetch: ((input: unknown, init: RequestInit | undefined) =>
      handler(String(input), init)) as unknown as typeof fetch,
    stdout: (message) => output.push(message),
  }
}

async function scratchDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-videos-files-'))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * Stands in for the local ffmpeg pass so these tests exercise the upload flow
 * without needing ffmpeg installed or a real encoded video on disk. The real
 * probe is covered by the SDK's own tests.
 */
function stubPrepare(sizeBytes: number): NonNullable<VideoCommandDependencies['prepareVideo']> {
  return async () => ({
    cleanup: async () => {},
    init: {
      containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 12,
      filename: 'clip.mp4',
      hasAudio: false,
      height: 1080,
      mimeType: 'video/mp4',
      sizeBytes,
      videoCodec: 'h264',
      width: 1920,
    },
    probe: {
      containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 12,
      hasAudio: false,
      height: 1080,
      videoCodec: 'h264',
      width: 1920,
    },
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('resolveFfmpegPaths', () => {
  test.each([
    { ffmpeg: true, ffprobe: true },
    { ffmpeg: true, ffprobe: false },
    { ffmpeg: false, ffprobe: true },
    { ffmpeg: false, ffprobe: false },
  ])('prefers each system tool independently: %j', async (system) => {
    const bundledLookups: string[] = []
    const paths = await resolveFfmpegPaths({
      platform: 'linux',
      which: (command) => {
        if (command === 'ffmpeg' && system.ffmpeg) return '/system/ffmpeg'
        if (command === 'ffprobe' && system.ffprobe) return '/system/ffprobe'
        return null
      },
      findBundledFfmpeg: async () => {
        bundledLookups.push('ffmpeg')
        return '/bundle/ffmpeg'
      },
      findBundledFfprobe: async () => {
        bundledLookups.push('ffprobe')
        return '/bundle/ffprobe'
      },
    })

    expect(paths).toEqual({
      ffmpegPath: system.ffmpeg ? '/system/ffmpeg' : '/bundle/ffmpeg',
      ffprobePath: system.ffprobe ? '/system/ffprobe' : '/bundle/ffprobe',
    })
    expect(bundledLookups.includes('ffmpeg')).toBe(!system.ffmpeg)
    expect(bundledLookups.includes('ffprobe')).toBe(!system.ffprobe)
  })

  test.each([null, '/system/ffmpeg'])('omits unavailable tool paths: %s', async (ffmpeg) => {
    const paths = await resolveFfmpegPaths({
      platform: 'linux',
      which: (command) => (command === 'ffmpeg' ? ffmpeg : null),
      findBundledFfmpeg: async () => undefined,
      findBundledFfprobe: async () => undefined,
    })
    expect(paths).toEqual(ffmpeg ? { ffmpegPath: ffmpeg } : {})
  })

  test('looks up Windows executable names', async () => {
    const names: string[] = []
    const paths = await resolveFfmpegPaths({
      platform: 'win32',
      which: (command) => {
        names.push(command)
        return `C:\\tools\\${command}`
      },
      findBundledFfmpeg: async () => {
        throw new Error('must not inspect the bundle')
      },
      findBundledFfprobe: async () => {
        throw new Error('must not inspect the bundle')
      },
    })
    expect(names).toEqual(['ffmpeg.exe', 'ffprobe.exe'])
    expect(paths).toEqual({
      ffmpegPath: 'C:\\tools\\ffmpeg.exe',
      ffprobePath: 'C:\\tools\\ffprobe.exe',
    })
  })
})

describe('resolveVideoMimeType', () => {
  test('maps known extensions and rejects everything else', () => {
    expect(resolveVideoMimeType('/tmp/clip.mp4')).toBe('video/mp4')
    expect(resolveVideoMimeType('/tmp/clip.MOV')).toBe('video/quicktime')
    expect(() => resolveVideoMimeType('/tmp/photo.jpg')).toThrow(/Unsupported video type/)
  })
})

describe('videos list', () => {
  test('emits a stable JSON envelope', async () => {
    const lines: string[] = []
    const deps = await dependencies((_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.operationName).toBe('Videos')
      expect(body.variables).toEqual({ pagination: { page: 2, pageSize: 10 } })
      return Response.json({
        data: {
          videos: {
            edges: [
              {
                id: 7,
                title: 'clip',
                description: null,
                filename: 'clip.mp4',
                sizeBytes: 2048,
                mimeType: 'video/mp4',
                durationSeconds: 42,
                width: 1920,
                height: 1080,
                status: 'completed',
                thumbnailUrl: 'https://cdn.test/t.jpg',
                createdAt: 1_704_067_200,
                updatedAt: 1_704_067_200,
              },
            ],
            pageInfo: {
              page: 2,
              pageSize: 10,
              totalCount: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: true,
            },
          },
        },
      })
    }, lines)

    await runVideoList({ json: true, page: 2, pageSize: 10 }, deps)

    const payload = JSON.parse(lines.join(''))
    expect(payload.videos).toHaveLength(1)
    expect(payload.videos[0]).toMatchObject({
      id: 7,
      title: 'clip',
      sizeBytes: 2048,
      status: 'completed',
    })
    expect(payload.pageInfo.totalCount).toBe(1)
  })

  test('rejects an out-of-range page size before making a request', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not reach the network')
    }, lines)

    await expect(runVideoList({ json: true, page: 1, pageSize: 500 }, deps)).rejects.toThrow(
      /--page-size/,
    )
  })
})

describe('videos upload', () => {
  test('runs init, part PUTs, and complete, sending no auth header to storage', async () => {
    const directory = await scratchDirectory()
    const file = join(directory, 'clip.mp4')
    await writeFile(file, Buffer.alloc(24, 1))

    const lines: string[] = []
    const storageRequests: Array<{ url: string; headers: Headers }> = []
    let completedParts: unknown

    const deps = await dependencies((url, init) => {
      if (url.includes('/api/v1/upload/videos') && url.endsWith('/videos')) {
        return Response.json({
          code: 200,
          data: {
            videoId: 7,
            s3Key: 'users/1/videos/clip.mp4',
            partSizeBytes: 10,
            partCount: 3,
            contentType: 'video/mp4',
          },
          msg: '',
        })
      }
      if (url.endsWith('/parts')) {
        const body = JSON.parse(String(init?.body)) as { partNumbers: number[] }
        return Response.json({
          code: 200,
          data: {
            parts: body.partNumbers.map((partNumber) => ({
              partNumber,
              url: `https://s3.test/part/${String(partNumber)}`,
              expiresAt: 'x',
            })),
          },
          msg: '',
        })
      }
      if (url.startsWith('https://s3.test/part/')) {
        storageRequests.push({ url, headers: new Headers(init?.headers) })
        const partNumber = url.split('/').pop()
        return new Response(null, {
          status: 200,
          headers: { etag: `"etag-${String(partNumber)}"` },
        })
      }
      if (url.endsWith('/complete')) {
        completedParts = (JSON.parse(String(init?.body)) as { parts: unknown }).parts
        return Response.json({
          code: 200,
          data: {
            id: 7,
            title: 'clip',
            filename: 'clip.mp4',
            sizeBytes: 24,
            mimeType: 'video/mp4',
            status: 'completed',
            createdAt: 1,
          },
          msg: '',
        })
      }
      throw new Error(`unexpected request to ${url}`)
    }, lines)

    let prepared = false
    await runVideoUpload(
      { file, json: true },
      {
        ...deps,
        resolveVideoTools: () =>
          resolveFfmpegPaths({
            platform: 'linux',
            which: (command) => (command === 'ffmpeg' ? '/system/ffmpeg' : null),
            findBundledFfmpeg: async () => {
              throw new Error('must prefer system ffmpeg')
            },
            findBundledFfprobe: async () => '/bundle/ffprobe',
          }),
        prepareVideo: async (path, options) => {
          prepared = true
          expect(path).toBe(file)
          expect(options).toEqual({
            ffmpegPath: '/system/ffmpeg',
            ffprobePath: '/bundle/ffprobe',
          })
          return stubPrepare(24)(path, options)
        },
      },
    )

    expect(prepared).toBe(true)
    expect(storageRequests).toHaveLength(3)
    // A presigned URL signs the request, so the bearer token must not be sent.
    for (const request of storageRequests) {
      expect(request.headers.get('authorization')).toBeNull()
      expect(request.headers.get('x-rawback-client-source')).toBeNull()
    }
    // S3 assembles by part number, so the parts must arrive in order.
    expect(completedParts).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ])

    const payload = JSON.parse(lines.join(''))
    expect(payload.video).toMatchObject({ id: 7, status: 'completed' })
  })

  test('rejects a non-video file before uploading anything', async () => {
    const directory = await scratchDirectory()
    const file = join(directory, 'photo.jpg')
    await writeFile(file, Buffer.alloc(4))

    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not reach the network')
    }, lines)

    await expect(runVideoUpload({ file, json: true }, deps)).rejects.toThrow(
      /Unsupported video type/,
    )
  })
})

describe('videos delete', () => {
  test('reports the deletion result', async () => {
    const lines: string[] = []
    const deps = await dependencies((_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.operationName).toBe('DeleteVideo')
      expect(body.variables).toEqual({ id: 7 })
      return Response.json({ data: { deleteVideo: true } })
    }, lines)

    await runVideoDelete({ id: 7, json: true }, deps)

    expect(JSON.parse(lines.join(''))).toEqual({ deleted: true })
  })
})

describe('resolveThumbnailMimeType', () => {
  test('maps image extensions and rejects anything else', () => {
    expect(resolveThumbnailMimeType('/tmp/a.jpg')).toBe('image/jpeg')
    expect(resolveThumbnailMimeType('/tmp/a.PNG')).toBe('image/png')
    expect(resolveThumbnailMimeType('/tmp/a.webp')).toBe('image/webp')
    // Previously anything non-.png was labelled JPEG, and the server signs the
    // content type into the presign, so the stored object rendered broken.
    expect(() => resolveThumbnailMimeType('/tmp/a.gif')).toThrow(/Unsupported thumbnail/)
  })
})

describe('videos upload short reads', () => {
  test('fails loudly when the file shrinks mid-upload instead of padding zeroes', async () => {
    const directory = await scratchDirectory()
    const file = join(directory, 'clip.mp4')
    // stat() sees 30 bytes, so the plan is 3 parts...
    await writeFile(file, Buffer.alloc(30, 7))

    const lines: string[] = []
    const deps = await dependencies((url, init) => {
      if (url.endsWith('/videos')) {
        // ...but truncate the file before the parts are read.
        return HttpResponse_init(url, init)
      }
      throw new Error(`unexpected request to ${url}`)
    }, lines)

    function HttpResponse_init(_url: string, _init: RequestInit | undefined) {
      writeFileSync(file, Buffer.alloc(5, 7))
      return Response.json({
        code: 200,
        data: {
          videoId: 7,
          s3Key: 'k',
          partSizeBytes: 10,
          partCount: 3,
          contentType: 'video/mp4',
        },
        msg: '',
      })
    }

    await expect(
      runVideoUpload({ file, json: true }, { ...deps, prepareVideo: stubPrepare(30) }),
    ).rejects.toThrow(/ended early/)
  })
})
