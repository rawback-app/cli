import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
  parseHashtags,
  parseVideoLink,
  runVideoAudioDelete,
  runVideoAudioUpload,
  runVideoGet,
  runVideoSubtitleDelete,
  runVideoSubtitleUpload,
  runVideoSubtitleView,
  subtitlePlainText,
} from '../src/video-media.ts'
import { runVideoList, runVideoUpdate, updateVideoInput } from '../src/videos.ts'
import type { VideoCommandDependencies } from '../src/videos.ts'

const temporaryDirectories: string[] = []

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-video-media-'))
  temporaryDirectories.push(directory)
  return directory
}

async function dependencies(
  handler: (url: string, init: RequestInit | undefined) => Response,
  output: string[],
): Promise<VideoCommandDependencies> {
  const directory = await scratch()
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

function graphql(init: RequestInit | undefined): {
  operationName: string
  variables: Record<string, unknown>
} {
  return JSON.parse(String(init?.body))
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('option parsing', () => {
  test('splits hashtags on commas and drops the #', () => {
    expect(parseHashtags(['#travel,旅行', '＃food', ' ', 2024])).toEqual([
      'travel',
      '旅行',
      'food',
      '2024',
    ])
    expect(parseHashtags(undefined)).toEqual([])
  })

  test('reads url|title|Chinese title links', () => {
    expect(parseVideoLink('https://a.example')).toEqual({ url: 'https://a.example' })
    expect(parseVideoLink('https://a.example | Notes | 笔记')).toEqual({
      url: 'https://a.example',
      title: 'Notes',
      titleZh: '笔记',
    })
    expect(() => parseVideoLink('ftp://a.example')).toThrow(/http or https/)
  })

  test('builds the update input and refuses contradictions', () => {
    expect(
      updateVideoInput({
        id: 1,
        titleZh: '海港',
        descriptionZh: '',
        hashtag: ['a,b'],
        link: ['https://a.example|A'],
      }),
    ).toEqual({
      titleZh: '海港',
      descriptionZh: '',
      hashtags: ['a', 'b'],
      links: [{ url: 'https://a.example', title: 'A' }],
    })
    expect(updateVideoInput({ id: 1, clearHashtags: true, clearLinks: true })).toEqual({
      hashtags: [],
      links: [],
    })
    expect(() => updateVideoInput({ id: 1 })).toThrow(/Provide at least one/)
    expect(() => updateVideoInput({ id: 1, hashtag: ['a'], clearHashtags: true })).toThrow(
      /cannot be used together/,
    )
    expect(() => updateVideoInput({ id: 1, link: ['https://a'], clearLinks: true })).toThrow(
      /cannot be used together/,
    )
  })

  test('strips timing and markup for plain subtitle text', () => {
    expect(
      subtitlePlainText(
        'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Hello</i>\nthere\n\n00:00:03.000 --> 00:00:04.000\n你好\n',
      ),
    ).toBe('Hello there\n你好')
  })
})

describe('videos update and list', () => {
  test('sends the new fields to UpdateVideo', async () => {
    const lines: string[] = []
    let variables: Record<string, unknown> | undefined
    const deps = await dependencies((_url, init) => {
      const body = graphql(init)
      expect(body.operationName).toBe('UpdateVideo')
      variables = body.variables
      return Response.json({
        data: {
          updateVideo: {
            id: 4,
            title: 'Harbour',
            titleZh: '海港',
            description: null,
            descriptionZh: null,
            hashtags: ['travel'],
            links: [],
            updatedAt: 1,
          },
        },
      })
    }, lines)

    await runVideoUpdate({ id: 4, titleZh: '海港', hashtag: ['#travel'], json: true }, deps)
    expect(variables).toEqual({ id: 4, input: { titleZh: '海港', hashtags: ['travel'] } })
    expect(JSON.parse(lines.join('')).video.titleZh).toBe('海港')
  })

  test('filters the list by hashtag and search', async () => {
    const lines: string[] = []
    let variables: Record<string, unknown> | undefined
    const deps = await dependencies((_url, init) => {
      variables = graphql(init).variables
      return Response.json({
        data: {
          videos: {
            edges: [],
            pageInfo: {
              page: 1,
              pageSize: 24,
              totalCount: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
        },
      })
    }, lines)

    await runVideoList(
      { json: true, page: 1, pageSize: 24, hashtag: ['travel,旅行'], search: ' harbour ' },
      deps,
    )
    expect(variables).toEqual({
      pagination: { page: 1, pageSize: 24 },
      filter: { hashtags: ['travel', '旅行'], search: 'harbour' },
    })
    await expect(runVideoList({ page: 1, pageSize: 24, search: 'x' }, deps)).rejects.toThrow(
      /at least 2 characters/,
    )
  })
})

const videoDetail = {
  id: 4,
  hasAudio: true,
  audioChunkCount: 1,
  transcript: { status: 'completed' },
  title: 'Harbour',
  titleZh: '海港',
  description: 'Morning light',
  descriptionZh: '清晨',
  hashtags: ['travel', '旅行'],
  links: [{ url: 'https://a.example', title: 'Notes', titleZh: '笔记' }],
  subtitles: [
    {
      id: 9,
      language: 'zh',
      format: 'srt',
      filename: 'talk.srt',
      cueCount: 12,
      sizeBytes: 400,
      updatedAt: 1,
    },
  ],
  audioTracks: [
    {
      id: 3,
      language: 'en',
      label: 'Narration',
      filename: 'narration.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 2048,
      durationSeconds: 61,
      url: 'https://cdn.test/narration.mp3',
      updatedAt: 1,
    },
  ],
  filename: 'harbour.mov',
  sizeBytes: 1_000_000,
  mimeType: 'video/quicktime',
  durationSeconds: 120,
  width: 1920,
  height: 1080,
  status: 'completed',
  url: 'https://cdn.test/harbour.mov',
  thumbnailUrl: null,
  createdAt: 1_704_067_200,
  updatedAt: 1_704_067_200,
}

describe('videos get', () => {
  test('renders text in both languages, hashtags, links, subtitles and audio', async () => {
    const lines: string[] = []
    const deps = await dependencies((_url, init) => {
      expect(graphql(init).operationName).toBe('Video')
      return Response.json({ data: { video: videoDetail } })
    }, lines)

    await runVideoGet({ id: 4 }, deps)
    const text = lines.join('\n')
    for (const expected of [
      '海港',
      '#travel #旅行',
      'Notes',
      '笔记',
      'Chinese',
      'Narration',
      '清晨',
    ])
      expect(text).toContain(expected)
  })

  test('reports a missing video', async () => {
    const deps = await dependencies(() => Response.json({ data: { video: null } }), [])
    await expect(runVideoGet({ id: 4 }, deps)).rejects.toThrow(/was not found/)
  })
})

describe('videos subtitle', () => {
  test('uploads the file as text with its name', async () => {
    const directory = await scratch()
    const file = join(directory, 'talk.srt')
    await writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\n你好\n')
    let variables: Record<string, unknown> | undefined
    const lines: string[] = []
    const deps = await dependencies((_url, init) => {
      const body = graphql(init)
      expect(body.operationName).toBe('UploadVideoSubtitle')
      variables = body.variables
      return Response.json({
        data: {
          uploadVideoSubtitle: {
            id: 9,
            language: 'zh',
            format: 'srt',
            filename: 'talk.srt',
            cueCount: 1,
            sizeBytes: 36,
            updatedAt: 1,
          },
        },
      })
    }, lines)

    await runVideoSubtitleUpload({ id: 4, language: 'zh-CN', file }, deps)
    expect(variables).toEqual({
      videoId: 4,
      input: {
        language: 'zh',
        content: '1\n00:00:01,000 --> 00:00:02,000\n你好\n',
        filename: 'talk.srt',
      },
    })
    expect(lines.join('\n')).toContain('1 cues')
  })

  test('prints or saves the requested format', async () => {
    const lines: string[] = []
    const deps = await dependencies(
      () =>
        Response.json({
          data: {
            video: {
              id: 4,
              subtitles: [
                {
                  id: 9,
                  language: 'en',
                  format: 'srt',
                  filename: 'talk.srt',
                  cueCount: 1,
                  sizeBytes: 36,
                  content: '1\n00:00:01,000 --> 00:00:02,000\nHi\n',
                  vttContent: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n',
                  srtContent: '1\n00:00:01,000 --> 00:00:02,000\nHi\n',
                  updatedAt: 1,
                },
              ],
            },
          },
        }),
      lines,
    )

    await runVideoSubtitleView({ id: 4, language: 'en', format: 'vtt' }, deps)
    expect(lines.join('')).toContain('WEBVTT')

    const output = join(await scratch(), 'out.txt')
    await runVideoSubtitleView({ id: 4, language: 'en', format: 'text', output }, deps)
    expect(await readFile(output, 'utf8')).toBe('Hi\n')

    await expect(runVideoSubtitleView({ id: 4, language: 'zh' }, deps)).rejects.toThrow(
      /no zh subtitles/,
    )
  })

  test('deletes one language', async () => {
    let variables: Record<string, unknown> | undefined
    const lines: string[] = []
    const deps = await dependencies((_url, init) => {
      const body = graphql(init)
      expect(body.operationName).toBe('DeleteVideoSubtitle')
      variables = body.variables
      return Response.json({ data: { deleteVideoSubtitle: true } })
    }, lines)
    await runVideoSubtitleDelete({ id: 4, language: 'EN', json: true }, deps)
    expect(variables).toEqual({ videoId: 4, language: 'en' })
    expect(JSON.parse(lines.join(''))).toEqual({ deleted: true })
  })
})

describe('videos audio', () => {
  test('presigns, PUTs to storage without auth, and confirms', async () => {
    const directory = await scratch()
    const file = join(directory, 'dub.mp3')
    await writeFile(file, Buffer.from('ID3 audio bytes'))
    const requests: Array<{ url: string; method: string; headers: Headers; body?: unknown }> = []
    const lines: string[] = []
    const deps = await dependencies((url, init) => {
      requests.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
      })
      if (url.endsWith('/audio-tracks')) {
        return Response.json({
          code: 200,
          msg: '',
          data: {
            trackId: 11,
            uploadUrl: 'https://s3.test/put',
            s3Key: 'k',
            contentType: 'audio/mpeg',
            expiresAt: 'x',
          },
        })
      }
      if (url === 'https://s3.test/put') return new Response(null, { status: 200 })
      if (url.endsWith('/audio-tracks/11/confirm')) {
        return Response.json({
          code: 200,
          msg: '',
          data: {
            id: 11,
            videoId: 4,
            language: 'zh',
            label: 'Dub',
            filename: 'dub.mp3',
            mimeType: 'audio/mpeg',
            sizeBytes: 15,
            url: 'https://cdn.test/dub.mp3',
            createdAt: 1,
            updatedAt: 1,
          },
        })
      }
      throw new Error(`unexpected request ${url}`)
    }, lines)

    await runVideoAudioUpload({ id: 4, language: 'zh', file, label: ' Dub ', json: true }, deps)
    expect(requests.map((request) => request.url.replace(/^.*\/api\/v1/, ''))).toEqual([
      '/upload/videos/4/audio-tracks',
      'https://s3.test/put',
      '/upload/videos/4/audio-tracks/11/confirm',
    ])
    expect(requests[0]?.body).toEqual({
      filename: 'dub.mp3',
      label: 'Dub',
      language: 'zh',
      mimeType: 'audio/mpeg',
      sizeBytes: 15,
    })
    expect(requests[1]?.headers.get('authorization')).toBeNull()
    expect(JSON.parse(lines.join('')).audioTrack.id).toBe(11)
  })

  test('refuses an unsupported file before any request', async () => {
    const directory = await scratch()
    const file = join(directory, 'clip.mp4')
    await writeFile(file, 'x')
    const deps = await dependencies(() => {
      throw new Error('should not reach the network')
    }, [])
    await expect(runVideoAudioUpload({ id: 4, language: 'en', file }, deps)).rejects.toThrow(
      /Unsupported audio/,
    )
    await expect(runVideoAudioUpload({ id: 4, language: 'fr', file }, deps)).rejects.toThrow(
      /--language must be en or zh/,
    )
  })

  test('deletes one language', async () => {
    let variables: Record<string, unknown> | undefined
    const deps = await dependencies((_url, init) => {
      const body = graphql(init)
      expect(body.operationName).toBe('DeleteVideoAudioTrack')
      variables = body.variables
      return Response.json({ data: { deleteVideoAudioTrack: true } })
    }, [])
    await runVideoAudioDelete({ id: 4, language: 'zh' }, deps)
    expect(variables).toEqual({ videoId: 4, language: 'zh' })
  })
})
