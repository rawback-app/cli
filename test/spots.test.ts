import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runSpotGet,
  runSpotList,
  runSpotSun,
  type SpotCommandDependencies,
  validateSpotId,
} from '../src/spots.ts'

const temporaryDirectories: string[] = []

// No credentials file: Spots are public, so every command works signed out.
async function dependencies(
  handler: (body: Record<string, any>) => Response,
  output: string[],
): Promise<SpotCommandDependencies> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-spots-'))
  temporaryDirectories.push(directory)
  return {
    configPath: join(directory, 'config.yml'),
    credentialsPath: join(directory, 'credentials.json'),
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

const photo = {
  id: 41,
  title: 'Opera house at dusk',
  url: 'https://cdn/full',
  thumbnailUrl: 'https://cdn/thumb',
  photographerName: 'Ada',
  photographerSlug: 'ada',
  latitude: -33.8568,
  longitude: 151.2153,
  capturedAt: '2026-06-21T08:12:00Z',
  timezone: 600,
  camera: 'Fujifilm X-T5',
  lens: 'XF 23mm',
  iso: 400,
  aperture: 8,
  exposureTime: '1/250',
  focalLength: 23,
  reactionCount: 3,
}

const spot = {
  id: '18-240801-157013',
  name: 'Sydney, New South Wales, Australia',
  latitude: -33.857,
  longitude: 151.215,
  photoCount: 2,
  representative: photo,
}

const pageInfo = {
  page: 1,
  pageSize: 24,
  totalCount: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

describe('spots list', () => {
  test('sends near and featured and emits a stable JSON envelope', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe('Spots')
      expect(body.variables).toEqual({
        page: 1,
        pageSize: 24,
        featured: true,
        near: { latitude: -33.86, longitude: 151.21, radiusMeters: 3000 },
      })
      return Response.json({ data: { spots: { spots: [spot], pageInfo } } })
    }, lines)

    await runSpotList(
      { featured: true, json: true, near: '-33.86,151.21', page: 1, pageSize: 24, radius: 3000 },
      deps,
    )
    expect(JSON.parse(lines.join('\n'))).toEqual({
      spots: [
        {
          id: spot.id,
          name: spot.name,
          latitude: spot.latitude,
          longitude: spot.longitude,
          photoCount: 2,
          representative: {
            id: 41,
            title: 'Opera house at dusk',
            url: 'https://cdn/full',
            thumbnailUrl: 'https://cdn/thumb',
            photographerName: 'Ada',
            photographerSlug: 'ada',
            latitude: -33.8568,
            longitude: 151.2153,
            capturedAt: '2026-06-21T08:12:00Z',
            camera: 'Fujifilm X-T5',
            lens: 'XF 23mm',
            iso: 400,
            aperture: 8,
            exposureTime: '1/250',
            focalLength: 23,
            reactionCount: 3,
          },
        },
      ],
      pageInfo,
    })
  })

  test('renders a table without sending near when none is given', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.variables).toEqual({ page: 1, pageSize: 24 })
      return Response.json({ data: { spots: { spots: [spot], pageInfo } } })
    }, lines)
    await runSpotList({ page: 1, pageSize: 24 }, deps)
    const output = lines.join('\n')
    expect(output).toContain(spot.id)
    expect(output).toContain('Sydney')
    expect(output).toContain('Ada')
  })

  test('validates paging and location before any request', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not have made a request')
    }, lines)
    await expect(runSpotList({ page: 0, pageSize: 24 }, deps)).rejects.toThrow(/--page/)
    await expect(runSpotList({ page: 1, pageSize: 24, radius: 10 }, deps)).rejects.toThrow(
      /--radius needs --near/,
    )
  })
})

describe('spots view', () => {
  test('shows the spot and a page of its photos', async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe('Spot')
      expect(body.variables).toEqual({ id: spot.id, page: 2, pageSize: 10 })
      return Response.json({
        data: { spot: { ...spot, photos: { photos: [photo], pageInfo } } },
      })
    }, lines)
    await runSpotGet({ id: ` ${spot.id} `, page: 2, pageSize: 10 }, deps)
    const output = lines.join('\n')
    expect(output).toContain('Opera house')
    expect(output).toContain('23mm f/8')
  })

  test('JSON carries the spot, its photos and paging', async () => {
    const lines: string[] = []
    const deps = await dependencies(
      () => Response.json({ data: { spot: { ...spot, photos: { photos: [photo], pageInfo } } } }),
      lines,
    )
    await runSpotGet({ id: spot.id, json: true, page: 1, pageSize: 24 }, deps)
    const output = JSON.parse(lines.join('\n'))
    expect(output.spot.id).toBe(spot.id)
    expect(output.photos).toHaveLength(1)
    expect(output.pageInfo.totalCount).toBe(1)
  })

  test('reports a spot with no public photos as not found', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => Response.json({ data: { spot: null } }), lines)
    await expect(runSpotGet({ id: spot.id, page: 1, pageSize: 24 }, deps)).rejects.toThrow(
      /was not found/,
    )
  })

  test('rejects a malformed spot ID before any request', () => {
    expect(() => validateSpotId('17-1-1')).toThrow(/Spot ID must look like/)
    expect(() => validateSpotId('18-a-1')).toThrow(/Spot ID must look like/)
    expect(validateSpotId(' 18-1-2 ')).toBe('18-1-2')
  })
})

describe('spots sun', () => {
  const plan = {
    date: '2026-06-21',
    timezone: 'Australia/Sydney',
    state: 'normal',
    latitude: -33.857,
    longitude: 151.215,
    sunrise: '2026-06-20T21:00:00Z',
    sunset: '2026-06-21T06:53:00Z',
    sunriseAzimuth: 62.4,
    sunsetAzimuth: 297.6,
    morningGoldenHourStart: '2026-06-20T21:00:00Z',
    morningGoldenHourEnd: '2026-06-20T21:40:00Z',
    goldenHourStart: '2026-06-21T06:10:00Z',
    goldenHourEnd: '2026-06-21T06:53:00Z',
  }

  test("prints times in the spot's time zone", async () => {
    const lines: string[] = []
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe('SpotSunPlan')
      expect(body.variables).toEqual({ id: spot.id, date: '2026-06-21', photoId: 41 })
      return Response.json({ data: { spotSunPlan: plan } })
    }, lines)
    await runSpotSun({ date: '2026-06-21', id: spot.id, photoId: 41 }, deps)
    const output = lines.join('\n')
    expect(output).toContain('07:00 (62°)')
    expect(output).toContain('16:10–16:53')
    expect(output).toContain('Australia/Sydney')
  })

  test('JSON passes the plan through with the spot ID', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => Response.json({ data: { spotSunPlan: plan } }), lines)
    await runSpotSun({ date: '2026-06-21', id: spot.id, json: true }, deps)
    expect(JSON.parse(lines.join('\n'))).toEqual({ spotId: spot.id, ...plan })
  })

  test('describes polar days instead of listing times', async () => {
    const lines: string[] = []
    const deps = await dependencies(
      () =>
        Response.json({
          data: {
            spotSunPlan: {
              ...plan,
              state: 'polarDay',
              sunrise: null,
              sunset: null,
              sunriseAzimuth: null,
              sunsetAzimuth: null,
            },
          },
        }),
      lines,
    )
    await runSpotSun({ date: '2026-06-21', id: spot.id }, deps)
    expect(lines.join('\n')).toContain('up all day')
  })

  test('validates the date and photo ID before any request', async () => {
    const lines: string[] = []
    const deps = await dependencies(() => {
      throw new Error('should not have made a request')
    }, lines)
    await expect(runSpotSun({ date: '21/06/2026', id: spot.id }, deps)).rejects.toThrow(
      /--date must be/,
    )
    await expect(runSpotSun({ date: '2026-06-21', id: spot.id, photoId: 0 }, deps)).rejects.toThrow(
      /--photo-id/,
    )
  })
})
