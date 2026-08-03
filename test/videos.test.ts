import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
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

    await runVideoUpload({ file, json: true }, deps)

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

    await expect(runVideoUpload({ file, json: true }, deps)).rejects.toThrow(/ended early/)
  })
})
