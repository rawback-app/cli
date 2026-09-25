import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
  createPhotoFilter,
  photoOrderBy,
  runPhotoList,
  runPhotoPermission,
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
                permission: 'private',
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
      photos: [
        {
          id: 7,
          thumbnailUrl: null,
          editedImages: [],
          permission: 'private',
          latitude: null,
          city: null,
        },
      ],
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
                  permission: 'private',
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
              permission: 'private',
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

describe('photos location and access filters', () => {
  test('maps --near, --radius, --sort and --permission onto the query', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.variables).toEqual({
        filter: {
          rate: [3, 4, 5],
          near: { latitude: 37.7749, longitude: -122.4194, radiusMeters: 2500 },
          permission: ['public', 'protected'],
        },
        pagination: { page: 1, pageSize: 24 },
        orderBy: 'DISTANCE',
      })
      return Response.json({
        data: {
          images: {
            edges: [
              {
                id: 9,
                filename: 'bridge.jpg',
                url: 'https://cdn/bridge',
                thumbnailUrl: null,
                status: 'completed',
                width: null,
                height: null,
                capturedAt: null,
                cameraMake: null,
                cameraModel: null,
                rotation: 0,
                rate: 4,
                permission: 'public',
                latitude: 37.77,
                longitude: -122.42,
                city: 'San Francisco',
                country: 'United States',
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
            aiSearch: null,
          },
        },
      })
    }, lines)

    await runPhotoList(
      {
        json: true,
        near: ' 37.7749 , -122.4194 ',
        page: 1,
        pageSize: 24,
        permission: ['public,protected'],
        radius: 2500,
        sort: 'distance',
      },
      deps,
    )
    expect(JSON.parse(lines.join('\n')).photos[0]).toMatchObject({
      id: 9,
      permission: 'public',
      latitude: 37.77,
      longitude: -122.42,
      city: 'San Francisco',
    })
  })

  test('defaults the radius to 1000 meters', () => {
    expect(createPhotoFilter({ near: '51.5,-0.12', page: 1, pageSize: 24 }).near).toEqual({
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 1000,
    })
  })

  test('rejects malformed location, sort and permission input before any request', () => {
    const base = { page: 1, pageSize: 24 }
    expect(() => createPhotoFilter({ ...base, radius: 500 })).toThrow(/--radius needs --near/)
    expect(() => createPhotoFilter({ ...base, near: '91,0' })).toThrow(/--near must be/)
    expect(() => createPhotoFilter({ ...base, near: 'paris' })).toThrow(/--near must be/)
    expect(() => createPhotoFilter({ ...base, near: '1,2,3' })).toThrow(/--near must be/)
    expect(() => createPhotoFilter({ ...base, near: '1,2', radius: 0 })).toThrow(/--radius must/)
    expect(() => createPhotoFilter({ ...base, near: '1,2', radius: 600_000 })).toThrow(
      /--radius must/,
    )
    expect(() => createPhotoFilter({ ...base, permission: ['secret'] })).toThrow(
      /--permission must contain only/,
    )
    expect(() => photoOrderBy({ ...base, sort: 'distance' })).toThrow(/needs --near/)
    expect(() => photoOrderBy({ ...base, sort: 'relevance' })).toThrow(/needs --search/)
    expect(() => photoOrderBy({ ...base, sort: 'oldest' })).toThrow(/--sort must be one of/)
    expect(photoOrderBy({ ...base, sort: 'relevance', search: 'bridge' })).toBe('RELEVANCE')
    expect(photoOrderBy({ ...base, sort: 'rating' })).toBe('RATE_DESC')
    expect(photoOrderBy({ ...base, sort: 'newest' })).toBeUndefined()
  })
})

describe('photos permission', () => {
  test('updates every photo and reports each result in JSON', async () => {
    const lines: string[] = []
    const seen: number[] = []
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe('CliUpdatePhoto')
      expect(body.variables.input.permission).toBe('protected')
      seen.push(body.variables.input.id)
      return Response.json({
        data: {
          updateImage: {
            id: body.variables.input.id,
            filename: 'a.jpg',
            displayName: '',
            rate: null,
            permission: 'protected',
          },
        },
      })
    }, lines)

    await runPhotoPermission({ imageIds: ['3,4', 5, '3'], json: true, level: 'protected' }, deps)

    expect(seen.toSorted()).toEqual([3, 4, 5])
    expect(JSON.parse(lines.join('\n'))).toEqual({
      permission: 'protected',
      results: [
        { id: 3, ok: true, permission: 'protected', error: null },
        { id: 4, ok: true, permission: 'protected', error: null },
        { id: 5, ok: true, permission: 'protected', error: null },
      ],
      succeeded: 3,
      failed: 0,
    })
  })

  test('keeps going past a failed photo and then fails the command', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      if (body.variables.input.id === 8) {
        return Response.json({ errors: [{ message: 'image not found' }], data: null })
      }
      return Response.json({
        data: {
          updateImage: {
            id: body.variables.input.id,
            filename: 'a.jpg',
            displayName: '',
            rate: null,
            permission: 'public',
          },
        },
      })
    }, lines)

    await expect(
      runPhotoPermission({ imageIds: [7, 8], json: true, level: 'public' }, deps),
    ).rejects.toThrow('1 of 2 photos could not be updated')
    const output = JSON.parse(lines.join('\n'))
    expect(output).toMatchObject({ succeeded: 1, failed: 1 })
    expect(output.results[0]).toMatchObject({ id: 7, ok: true })
    expect(output.results[1]).toMatchObject({ id: 8, ok: false, permission: null })
    expect(output.results[1].error).toContain('image not found')
  })

  test('prints a table and the publication notice for public photos', async () => {
    const lines: string[] = []
    const deps = await dependencies(
      (body) =>
        Response.json({
          data: {
            updateImage: {
              id: body.variables.input.id,
              filename: 'a.jpg',
              displayName: '',
              rate: null,
              permission: 'public',
            },
          },
        }),
      lines,
    )
    await runPhotoPermission({ imageIds: [12], level: 'public' }, deps)
    const output = lines.join('\n')
    expect(output).toContain('12')
    expect(output).toContain('public')
    expect(output).toContain('appear in Spots')
  })

  test('rejects an unknown level or bad IDs before any request', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not have made a request')
    }, lines)
    await expect(runPhotoPermission({ imageIds: [1], level: 'secret' }, deps)).rejects.toThrow(
      /Permission must be one of/,
    )
    await expect(runPhotoPermission({ imageIds: ['x'], level: 'public' }, deps)).rejects.toThrow(
      /Image ID/,
    )
  })
})
