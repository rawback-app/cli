import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
  createPhotoFilter,
  runPhotoList,
  runPhotoSearch,
  type PhotoListDependencies,
} from '../src/photos.ts'

const temporaryDirectories: string[] = []

async function dependencies(
  handler: (body: Record<string, any>) => Response,
  output: string[],
): Promise<PhotoListDependencies> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-photos-'))
  temporaryDirectories.push(directory)
  const credentialsPath = join(directory, 'credentials.json')
  await writeCredentials({ token: 'token', refreshToken: 'refresh' }, credentialsPath)
  return {
    configPath: join(directory, 'config.yml'),
    credentialsPath,
    fetch: (async (_input, init) => handler(JSON.parse(String(init?.body)))) as typeof fetch,
    stdout: (message) => output.push(message),
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('photos list', () => {
  test('maps rich filters and emits a stable JSON envelope', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe('Photos')
      expect(body.variables).toEqual({
        filter: {
          apertureMin: 1.4,
          cameraMake: ['Fujifilm', 'Sony'],
          cameraModel: ['X-T5'],
          capturedAfter: 1_704_067_200,
          capturedBefore: 1_704_153_600,
          city: ['Tokyo'],
          country: ['Japan'],
          focalLengthMax: 85,
          hasGps: true,
          lensModel: ['XF 23mm'],
          rate: [0, 2],
          search: 'street',
          status: ['completed', 'processing'],
        },
        pagination: { page: 2, pageSize: 10 },
      })
      return Response.json({
        data: {
          images: {
            edges: [
              {
                id: 7,
                filename: 'tokyo.raf',
                url: 'https://cdn/photo',
                thumbnailUrl: null,
                status: 'completed',
                width: 6000,
                height: 4000,
                capturedAt: 1_704_067_200,
                cameraMake: 'Fujifilm',
                cameraModel: 'X-T5',
                rotation: 0,
                rate: 2,
                editedImages: [],
              },
            ],
            pageInfo: {
              page: 2,
              pageSize: 10,
              totalCount: 17,
              totalPages: 2,
              hasNextPage: false,
              hasPreviousPage: true,
            },
          },
        },
      })
    }, lines)

    await runPhotoList(
      {
        apertureMin: 1.4,
        cameraMake: ['Fujifilm,Sony'],
        cameraModel: ['X-T5'],
        capturedAfter: '2024-01-01',
        capturedBefore: '2024-01-02',
        city: ['Tokyo'],
        country: ['Japan'],
        focalLengthMax: 85,
        hasGps: true,
        json: true,
        lensModel: ['XF 23mm'],
        page: 2,
        pageSize: 10,
        rate: ['0,2'],
        search: ' street ',
        status: ['completed,processing'],
      },
      deps,
    )

    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      photos: [{ id: 7, thumbnailUrl: null, editedImages: [] }],
      pageInfo: { page: 2, totalCount: 17 },
    })
  })

  test('uses the web rating default and renders a table', async () => {
    const filter = createPhotoFilter({ page: 1, pageSize: 24 })
    expect(filter).toEqual({ rate: [3, 4, 5] })

    const lines: string[] = []
    const deps = await dependencies(
      () =>
        Response.json({
          data: {
            images: {
              edges: [
                {
                  id: 1,
                  filename: 'photo.jpg',
                  url: 'https://cdn/photo',
                  thumbnailUrl: null,
                  status: 'completed',
                  width: 1200,
                  height: 800,
                  capturedAt: 1_704_067_200,
                  cameraMake: 'Sony',
                  cameraModel: 'A7',
                  rotation: 0,
                  rate: 5,
                  editedImages: [],
                },
              ],
              pageInfo: {
                page: 1,
                pageSize: 24,
                totalCount: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            },
          },
        }),
      lines,
    )
    await runPhotoList({ page: 1, pageSize: 24 }, deps)
    expect(lines[0]).toContain('ID  Filename')
    expect(lines[0]).toContain('Sony A7')
    expect(lines[0]).toContain('Page 1 of 1 · 1 total')
  })

  test('rejects invalid filters before making a request', async () => {
    expect(() => createPhotoFilter({ page: 1, pageSize: 24, rate: ['6'] })).toThrow(
      'integers between 0 and 5',
    )
    expect(() => createPhotoFilter({ page: 1, pageSize: 24, capturedAfter: 'not-a-date' })).toThrow(
      'ISO date/time',
    )
    expect(() => createPhotoFilter({ page: 1, pageSize: 101 })).toThrow('between 1 and 100')
  })
})

describe('photos search', () => {
  const aiSearch = {
    id: 'abc123',
    prompt: 'from 2012, all images in NYC',
    summary: 'Photos taken in New York during 2012.',
    cached: false,
    creditsUsed: 1,
    expiresAt: '2026-01-01T00:00:00Z',
    criteria: [
      { field: 'city', label: 'City', value: 'New York' },
      { field: 'capturedAfter', label: 'From', value: '2012-01-01' },
    ],
  }

  function photosResponse(hasNextPage: boolean) {
    return Response.json({
      data: {
        images: {
          edges: [
            {
              id: 7,
              filename: 'nyc.cr3',
              url: 'https://cdn/photo',
              thumbnailUrl: null,
              status: 'completed',
              width: 6000,
              height: 4000,
              capturedAt: 1_325_376_000,
              cameraMake: 'Canon',
              cameraModel: 'EOS R5',
              rotation: 0,
              rate: 4,
              editedImages: [],
            },
          ],
          pageInfo: {
            page: 1,
            pageSize: 24,
            totalCount: 40,
            totalPages: 2,
            hasNextPage,
            hasPreviousPage: false,
          },
          aiSearch,
        },
      },
    })
  }

  test('sends the prompt and returns the interpretation in JSON', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.variables).toEqual({
        filter: { prompt: 'from 2012, all images in NYC' },
        pagination: { page: 1, pageSize: 24 },
      })
      return photosResponse(false)
    }, lines)

    await runPhotoSearch(
      { json: true, page: 1, pageSize: 24, prompt: '  from 2012, all images in NYC  ' },
      deps,
    )

    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      aiSearch: { id: 'abc123', creditsUsed: 1 },
    })
  })

  // The id is what keeps later pages free, and it is only valid next to the
  // prompt it came from.
  test('sends the id alongside the prompt on later pages', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.variables.filter).toEqual({
        prompt: 'from 2012, all images in NYC',
        aiSearchId: 'abc123',
      })
      return photosResponse(false)
    }, lines)

    await runPhotoSearch(
      {
        aiSearchId: 'abc123',
        json: true,
        page: 2,
        pageSize: 24,
        prompt: 'from 2012, all images in NYC',
      },
      deps,
    )
  })

  test('rejects an id with no prompt to anchor it', () => {
    expect(() => createPhotoFilter({ aiSearchId: 'abc123', page: 1, pageSize: 24 })).toThrow(
      /--ai-search-id needs the --prompt/,
    )
  })

  test('rejects an empty prompt before making a request', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not have made a request')
    }, lines)
    expect(() => runPhotoSearch({ page: 1, pageSize: 24, prompt: '  ' }, deps)).toThrow(
      /Provide something to search for/,
    )
  })

  // A plain-language request must not be silently narrowed to 3★-and-up; an
  // explicit --rate still wins.
  test('drops the browsing rating default under a prompt', () => {
    expect(createPhotoFilter({ page: 1, pageSize: 24, prompt: 'sunsets' })).toEqual({
      prompt: 'sunsets',
    })
    expect(
      createPhotoFilter({ page: 1, pageSize: 24, prompt: 'sunsets', rate: ['1,2'] }).rate,
    ).toEqual([1, 2])
  })

  test('prints the interpretation and a credit-free resend line', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => photosResponse(true), lines)

    await runPhotoSearch({ page: 1, pageSize: 24, prompt: 'from 2012, all images in NYC' }, deps)

    const output = lines.join('\n')
    expect(output).toContain('Photos taken in New York during 2012.')
    expect(output).toContain('New York')
    expect(output).toContain('--ai-search-id abc123')
    expect(output).toContain('--page 2')
  })
})
