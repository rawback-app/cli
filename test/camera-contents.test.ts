import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCameraApi } from '../src/camera-api.ts'
import {
  gpsInfo,
  parseContentLocator,
  runCameraCardFormat,
  runCameraContentsDelete,
  runCameraContentsDirs,
  runCameraContentsEdit,
  runCameraContentsGet,
  runCameraContentsInfo,
  runCameraContentsList,
  runCameraContentsRmdir,
  runCameraContentsStorages,
  type ContentEdit,
} from '../src/camera-contents.ts'
import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import {
  DEFAULT_SUFFIXES,
  cleanupTemporaryStores,
  fakeCamera,
  supportedAPIs,
  temporaryStore,
} from './camera-helpers.ts'

const scratch: string[] = []

afterEach(async () => {
  await cleanupTemporaryStores()
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scratchDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-contents-'))
  scratch.push(directory)
  return directory
}

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    dependencies: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    json: () => JSON.parse(stdout.join('\n')) as Record<string, unknown>,
  }
}

function saved(version = 'ver140'): StoredCamera {
  return {
    id: cameraId('192.168.0.1', 8080),
    host: '192.168.0.1',
    port: 8080,
    useTLS: false,
    lastUsedAt: '2026-08-04T09:00:00.000Z',
    discovery: {
      apiVersion: version,
      cachedAt: new Date().toISOString(),
      supportedAPIs: supportedAPIs(version),
    },
  }
}

describe('parseContentLocator', () => {
  test('reads the camera’s own folder from a ver140 locator', () => {
    expect(parseContentLocator('/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG')).toEqual({
      storage: 'card1',
      folder: 'DCIM',
      directory: '100CANON',
      file: 'IMG_0042.JPG',
    })
  })

  test('reads an older locator without one', () => {
    expect(parseContentLocator('/ccapi/ver130/contents/card1/100CANON/IMG_0042.JPG')).toEqual({
      storage: 'card1',
      directory: '100CANON',
      file: 'IMG_0042.JPG',
    })
  })

  test('accepts a bare path and a full URL alike', () => {
    const expected = { storage: 'card1', directory: '100CANON', file: 'IMG_0042.JPG' }
    expect(parseContentLocator('card1/100CANON/IMG_0042.JPG')).toEqual(expected)
    expect(
      parseContentLocator(
        'http://192.168.0.1:8080/ccapi/ver130/contents/card1/100CANON/IMG_0042.JPG',
      ),
    ).toEqual(expected)
  })

  test.each(['', 'card1', 'card1/100CANON'])('rejects %p', (input) => {
    expect(() => parseContentLocator(input)).toThrow(/Not a content locator/)
  })
})

describe('camera contents', () => {
  test('lists storages', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: { contents: { path: ['/ccapi/ver140/contents/card1'] } },
    })
    const output = capture()

    await runCameraContentsStorages(
      { json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({ storages: ['/ccapi/ver140/contents/card1'] })
  })

  /** A ver140 card: directories under DCIM, movie reels beside them. */
  const R6_MARK_III_DIRECTORIES = {
    path: [
      '/ccapi/ver140/contents/card1/XFVC/100CANON',
      '/ccapi/ver140/contents/card1/DCIM/100CANON',
      '/ccapi/ver140/contents/card1/DCIM/101CANON',
    ],
  }

  test.each(['100CANON', 'DCIM/100CANON', '/ccapi/ver140/contents/card1/DCIM/100CANON'])(
    'a ver140 listing of %p goes through the DCIM folder',
    async (directory) => {
      const { store } = await temporaryStore()
      await store.upsert(saved('ver140'), { makeDefault: true })
      const camera = fakeCamera({
        apiVersion: 'ver140',
        paths: { 'ccapi/ver140/contents/card1': R6_MARK_III_DIRECTORIES },
      })
      const output = capture()

      await runCameraContentsList(
        { storage: 'card1', directory, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      )

      const listings = camera.requests
        .map((request) => request.url)
        .filter((url) => url.includes('100CANON'))
      expect(listings.map((url) => new URL(url).pathname)).toEqual([
        '/ccapi/ver140/contents/card1/DCIM/100CANON',
        '/ccapi/ver140/contents/card1/DCIM/100CANON',
      ])
      // Listed first, then counted — never both at once.
      expect(new URL(listings[0] ?? '').searchParams.get('kind')).toBeNull()
      expect(new URL(listings[1] ?? '').searchParams.get('kind')).toBe('number')
    },
  )

  test('refuses a directory locator on another card instead of following it', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved('ver140'), { makeDefault: true })
    const camera = fakeCamera({ apiVersion: 'ver140' })
    const output = capture()

    await expect(
      runCameraApi(
        {
          id: 'contents.deleteDirectory',
          arg: ['storage=card1', 'directory=/ccapi/ver140/contents/card2/DCIM/100CANON'],
          force: true,
          json: true,
        },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow(/is on card2, not card1/)
    expect(camera.requests.some((request) => request.method === 'DELETE')).toBe(false)
  })

  test('reports a failed directory lookup instead of listing without the folder', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved('ver140'), { makeDefault: true })
    // The storage listing fails; a folderless `contents/card1/100CANON` would
    // only 404 for an unrelated reason and hide this one.
    const camera = fakeCamera({ apiVersion: 'ver140', missing: ['contents/card1'] })
    const output = capture()

    await expect(
      runCameraContentsList(
        { storage: 'card1', directory: '100CANON', json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow()
    expect(camera.requests.some((request) => request.path.includes('100CANON'))).toBe(false)
  })

  test('an older camera omits it', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved('ver130'), { makeDefault: true })
    const camera = fakeCamera({ apiVersion: 'ver130' })
    const output = capture()

    await runCameraContentsList(
      { storage: 'card1', directory: '100CANON', json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(
      camera.requests.some((request) => request.path.includes('contents/card1/100CANON')),
    ).toBe(true)
    expect(camera.requests.some((request) => request.path.includes('/folder/'))).toBe(false)
  })

  test('--all concatenates every chunked page', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    // The chunked form returns concatenated JSON objects, not an array.
    const chunked = '{"path":["a.JPG","b.JPG"]}{"path":["c.JPG"]}'
    const camera = fakeCamera()
    const streaming = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('kind=chunked')) {
          return new Response(chunked, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraContentsList(
      { storage: 'card1', directory: '100CANON', all: true, json: true },
      { store, processEnv: {}, fetch: streaming, ...output.dependencies },
    )

    expect(output.json()).toEqual({ contents: ['a.JPG', 'b.JPG', 'c.JPG'], count: 3 })
  })

  test('get streams the file to disk and reports the byte count', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const target = join(directory, 'shot.jpg')
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const camera = fakeCamera()
    const binary = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('IMG_0042.JPG')) {
          return new Response(payload, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          })
        }
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraContentsGet(
      {
        locator: '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG',
        output: target,
        json: true,
      },
      { store, processEnv: {}, fetch: binary, ...output.dependencies },
    )

    expect(new Uint8Array(await readFile(target))).toEqual(payload)
    expect(output.json()).toMatchObject({ output: target, bytes: 5, kind: 'main' })
  })

  test('get refuses to clobber without --overwrite', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const target = join(directory, 'shot.jpg')
    await writeFile(target, 'keep me')
    const camera = fakeCamera()
    const output = capture()

    await expect(
      runCameraContentsGet(
        {
          locator: '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG',
          output: target,
          json: true,
        },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow(/already exists; pass --overwrite/)

    expect(await readFile(target, 'utf8')).toBe('keep me')
    // The refusal happens before any request reaches the camera.
    expect(camera.requests).toEqual([])
  })

  test('get into a directory keeps the camera filename', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const camera = fakeCamera()
    const binary = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('IMG_0042.JPG')) return new Response(new Uint8Array([9]), { status: 200 })
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraContentsGet(
      {
        locator: '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG',
        output: directory,
        json: true,
      },
      { store, processEnv: {}, fetch: binary, ...output.dependencies },
    )

    expect(output.json().output).toBe(join(directory, 'IMG_0042.JPG'))
  })

  test('delete asks first and honours a refusal', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraContentsDelete(
      { locator: '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG', json: true },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(output.json().deleted).toBe(false)
    expect(camera.requests).toEqual([])
  })

  test('delete --force issues the DELETE', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraContentsDelete(
      {
        locator: '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG',
        force: true,
        json: true,
      },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json().deleted).toBe(true)
    const request = camera.requests.find((entry) => entry.method === 'DELETE')
    expect(request?.path).toContain('card1/DCIM/100CANON/IMG_0042.JPG')
  })
})

const LOCATOR = '/ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG'

describe('camera contents dirs and info', () => {
  test('dirs lists the directories on a storage', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      paths: {
        'ccapi/ver140/contents/card1': { path: ['/ccapi/ver140/contents/card1/DCIM/100CANON'] },
      },
    })
    const output = capture()

    await runCameraContentsDirs(
      { storage: 'card1', json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      storage: 'card1',
      directories: ['/ccapi/ver140/contents/card1/DCIM/100CANON'],
    })
  })

  test('info reports the file metadata', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      paths: {
        'ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG': {
          filesize: 1024,
          protect: 'disable',
          archive: 'disable',
          rotate: '0',
          rating: '3',
          lastmodifieddate: 'Tue, 04 Aug 2026 09:00:00 +0900',
        },
      },
    })
    const output = capture()

    await runCameraContentsInfo(
      { locator: LOCATOR, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toMatchObject({ locator: LOCATOR, fileSize: 1024, rating: '3' })
    const request = camera.requests.find((entry) => entry.path.endsWith('IMG_0042.JPG'))
    expect(new URL(request?.url ?? '').searchParams.get('kind')).toBe('info')
  })
})

describe('camera contents edits', () => {
  async function edit(value: ContentEdit, routes: Record<string, unknown> = {}) {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({ paths: routes })
    const output = capture()
    await runCameraContentsEdit(
      { locator: LOCATOR, edit: value, force: true, json: true },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        now: () => new Date('2026-08-04T09:05:30Z'),
        ...output.dependencies,
      },
    )
    const put = camera.requests.find((request) => request.method === 'PUT')
    return {
      body: JSON.parse(put?.body ?? '{}') as Record<string, unknown>,
      path: put?.path,
      json: output.json(),
    }
  }

  test.each([
    [
      { kind: 'protect', enabled: true },
      { action: 'protect', value: 'enable' },
    ],
    [
      { kind: 'archive', enabled: false },
      { action: 'archive', value: 'disable' },
    ],
    [
      { kind: 'rate', rating: '4' },
      { action: 'rating', value: '4' },
    ],
    [
      { kind: 'rotate', degrees: 90 },
      { action: 'rotate', value: '90' },
    ],
    [
      { kind: 'xmp', attributes: 'xmlns:C=http://canon.com/camera/1.0/ C:Yaw=261.9' },
      { action: 'xmp_description', value: 'xmlns:C=http://canon.com/camera/1.0/ C:Yaw=261.9' },
    ],
  ] as Array<[ContentEdit, Record<string, unknown>]>)(
    '%p modifies the file',
    async (value, body) => {
      const result = await edit(value)

      expect(result.path).toBe('ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG')
      expect(result.body).toEqual(body)
      expect(result.json).toMatchObject({ changed: true, locator: LOCATOR, action: value.kind })
    },
  )

  test('geotag writes the full GPS block the camera requires', async () => {
    const result = await edit({ kind: 'geotag', latitude: 35.658581, longitude: 139.745433 })

    expect(result.body).toEqual({
      action: 'gps',
      gps: {
        latitude_ref: 'N',
        latitude: { degree: [35, 1], minute: [39, 1], second: [3089, 100] },
        longitude_ref: 'E',
        longitude: { degree: [139, 1], minute: [44, 1], second: [4356, 100] },
        altitude_ref: 'P',
        altitude: [0, 100],
        timestamp: { hour: [9, 1], minute: [5, 1], second: [30, 1] },
        mapdatum: 'WGS-84',
        status: 'A',
        datestamp: '2026:08:04',
      },
    })
  })

  test('a declined edit never reaches the camera', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraContentsEdit(
      { locator: LOCATOR, edit: { kind: 'rate', rating: '5' }, json: true },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(camera.requests).toEqual([])
    expect(output.json()).toEqual({ changed: false, locator: LOCATOR })
  })

  test('a protected file explains the 409', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      paths: {
        'ccapi/ver140/contents/card1/DCIM/100CANON/IMG_0042.JPG': () =>
          new Response('{"message":"Protected"}', { status: 409 }),
      },
    })

    await expect(
      runCameraContentsEdit(
        { locator: LOCATOR, edit: { kind: 'rotate', degrees: 90 }, force: true, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...capture().dependencies },
      ),
    ).rejects.toThrow(/Protected contents cannot be deleted or modified/)
  })
})

describe('gpsInfo', () => {
  test('carries rounding into the minute rather than writing 60 seconds', () => {
    // 10° 59' 59.999" rounds to 11° 00' 00.00".
    const gps = gpsInfo(10 + 59 / 60 + 59.999 / 3600, 0, 0, new Date('2026-01-02T03:04:05Z'))
    expect(gps.latitude).toEqual({ degree: [11, 1], minute: [0, 1], second: [0, 100] })
  })

  test('names the hemisphere and depth by sign', () => {
    const gps = gpsInfo(-33.8688, -151.2093, -12.5, new Date('2026-01-02T03:04:05Z'))
    expect(gps.latitude_ref).toBe('S')
    expect(gps.longitude_ref).toBe('W')
    expect(gps.altitude_ref).toBe('M')
    expect(gps.altitude).toEqual([1250, 100])
    expect(gps.datestamp).toBe('2026:01:02')
  })
})

describe('camera contents rmdir', () => {
  test('deletes the directory through its ver140 folder', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      paths: {
        'ccapi/ver140/contents/card1': { path: ['/ccapi/ver140/contents/card1/DCIM/100CANON'] },
      },
    })
    const output = capture()

    await runCameraContentsRmdir(
      { storage: 'card1', directory: '100CANON', force: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const request = camera.requests.find((entry) => entry.method === 'DELETE')
    expect(request?.path).toBe('ccapi/ver140/contents/card1/DCIM/100CANON')
    expect(output.json()).toEqual({ deleted: true, storage: 'card1', directory: '100CANON' })
  })
})

describe('camera card format', () => {
  async function formatSetup() {
    const { store } = await temporaryStore()
    await store.upsert(
      {
        ...saved(),
        discovery: {
          apiVersion: 'ver140',
          cachedAt: new Date().toISOString(),
          supportedAPIs: supportedAPIs('ver140', [...DEFAULT_SUFFIXES, 'functions/cardformat']),
        },
      },
      { makeDefault: true },
    )
    const camera = fakeCamera({
      routes: {
        contents: { path: ['/ccapi/ver140/contents/card1', '/ccapi/ver140/contents/card2'] },
      },
    })
    const output = capture()
    return { store, camera, output }
  }

  const formatted = (camera: ReturnType<typeof fakeCamera>) =>
    camera.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('functions/cardformat'),
    )

  test('formats the named card once its name is typed back', async () => {
    const { store, camera, output } = await formatSetup()

    await runCameraCardFormat(
      { storage: 'card2' },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: {
          confirm: async () => false,
          password: async () => '',
          input: async () => 'card2',
        },
        ...output.dependencies,
      },
    )

    expect(formatted(camera).map((request) => JSON.parse(request.body ?? '{}'))).toEqual([
      { name: 'card2' },
    ])
  })

  test('a mistyped name leaves the card alone', async () => {
    const { store, camera, output } = await formatSetup()

    await runCameraCardFormat(
      { storage: 'card2' },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: {
          confirm: async () => true,
          password: async () => '',
          input: async () => 'card1',
        },
        ...output.dependencies,
      },
    )

    expect(formatted(camera)).toEqual([])
    expect(output.stdout.join('\n')).toContain('Left card2 untouched')
  })

  test('refuses a storage the camera does not have, naming the ones it does', async () => {
    const { store, camera, output } = await formatSetup()

    await expect(
      runCameraCardFormat(
        { storage: 'card3', force: true, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow(/no storage named card3\. It has: card1, card2/)
    expect(formatted(camera)).toEqual([])
  })
})
