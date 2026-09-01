import { afterEach, describe, expect, test } from 'bun:test'

import { CameraError } from '../src/camera-errors.ts'
import { createCameraFetch, isCertificateError } from '../src/camera-fetch.ts'
import {
  CAMERA_URL_ENV,
  parseCameraUrl,
  resolveCameraTarget,
  suffixSet,
  withCameraSession,
} from '../src/camera-session.ts'
import { cameraId } from '../src/camera-store.ts'
import {
  cleanupTemporaryStores,
  fakeCamera,
  supportedAPIs,
  temporaryStore,
} from './camera-helpers.ts'

afterEach(cleanupTemporaryStores)

function silent() {
  return { stdout: () => {}, stderr: () => {} }
}

describe('parseCameraUrl', () => {
  test('reads host, port, TLS, and credentials', () => {
    expect(parseCameraUrl('http://user:pwd@192.168.0.1:8080')).toEqual({
      host: '192.168.0.1',
      port: 8080,
      useTLS: false,
      credentials: { username: 'user', password: 'pwd' },
    })
  })

  test.each([
    ['https://192.168.0.1', 443, true],
    ['http://192.168.0.1', 80, false],
    ['http://192.168.0.1:8080', 8080, false],
  ])('defaults the port for %s', (input, port, useTLS) => {
    const parsed = parseCameraUrl(input)
    expect(parsed.port).toBe(port)
    expect(parsed.useTLS).toBe(useTLS)
  })

  test('percent-decodes a password containing @ and :', () => {
    const parsed = parseCameraUrl('http://user:p%40ss%3Aword@192.168.0.1:8080')
    expect(parsed.credentials?.password).toBe('p@ss:word')
  })

  test.each([
    ['not-a-url', /Not a valid camera URL/],
    ['ftp://192.168.0.1', /Unsupported scheme/],
  ])('rejects %s', (input, pattern) => {
    expect(() => parseCameraUrl(input)).toThrow(pattern)
  })
})

describe('target resolution', () => {
  test('prefers the positional URL over every other source', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      { id: 'saved:8080', host: 'saved', port: 8080, useTLS: false, lastUsedAt: 'now' },
      { makeDefault: true },
    )

    const { target } = await resolveCameraTarget(
      { url: 'http://positional:1000', camera: 'http://flag:2000' },
      { store, processEnv: { [CAMERA_URL_ENV]: 'http://env:3000' } },
    )

    expect(target.host).toBe('positional')
  })

  test('prefers --camera over the environment and the saved default', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      { id: 'saved:8080', host: 'saved', port: 8080, useTLS: false, lastUsedAt: 'now' },
      { makeDefault: true },
    )

    const { target } = await resolveCameraTarget(
      { camera: 'http://flag:2000' },
      { store, processEnv: { [CAMERA_URL_ENV]: 'http://env:3000' } },
    )

    expect(target.host).toBe('flag')
  })

  test('prefers the environment over the saved default', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      { id: 'saved:8080', host: 'saved', port: 8080, useTLS: false, lastUsedAt: 'now' },
      { makeDefault: true },
    )

    const { target } = await resolveCameraTarget(
      {},
      { store, processEnv: { [CAMERA_URL_ENV]: 'http://env:3000' } },
    )

    expect(target.host).toBe('env')
  })

  test('falls back to the saved default and its credentials', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      {
        id: 'saved:8080',
        host: 'saved',
        port: 8080,
        useTLS: false,
        username: 'ccapi',
        password: 'secret',
        insecure: true,
        lastUsedAt: 'now',
      },
      { makeDefault: true },
    )

    const { target } = await resolveCameraTarget({}, { store, processEnv: {} })

    expect(target.host).toBe('saved')
    expect(target.credentials).toEqual({ username: 'ccapi', password: 'secret' })
    expect(target.insecure).toBe(true)
  })

  test('fills in saved credentials when the URL omits them', async () => {
    const { store } = await temporaryStore()
    await store.upsert({
      id: cameraId('192.168.0.1', 8080),
      host: '192.168.0.1',
      port: 8080,
      useTLS: false,
      username: 'ccapi',
      password: 'secret',
      lastUsedAt: 'now',
    })

    const { target } = await resolveCameraTarget(
      { camera: 'http://192.168.0.1:8080' },
      { store, processEnv: {} },
    )

    expect(target.credentials).toEqual({ username: 'ccapi', password: 'secret' })
  })

  test('errors with the setup instructions when nothing is configured', async () => {
    const { store } = await temporaryStore()

    await expect(resolveCameraTarget({}, { store, processEnv: {} })).rejects.toThrow(
      /No camera configured\. Run rawback camera connect/,
    )
  })
})

describe('camera fetch', () => {
  test('refuses a request to another host', async () => {
    const camera = fakeCamera()
    const scoped = createCameraFetch({ host: '192.168.0.1' }, camera.fetch)

    await expect(scoped('http://evil.example/steal')).rejects.toThrow(
      /refused a request to evil\.example/,
    )
  })

  test('relaxes certificate verification only when asked', async () => {
    const camera = fakeCamera()

    await createCameraFetch({ host: '192.168.0.1' }, camera.fetch)('http://192.168.0.1/a')
    await createCameraFetch(
      { host: '192.168.0.1', insecure: true },
      camera.fetch,
    )('http://192.168.0.1/b')

    const [verified, relaxed] = camera.requests
    expect((verified?.init as { tls?: unknown } | undefined)?.tls).toBeUndefined()
    expect((relaxed?.init as { tls?: unknown } | undefined)?.tls).toEqual({
      rejectUnauthorized: false,
    })
  })

  test('recognises a certificate failure through the cause chain', () => {
    const error = new Error('fetch failed', {
      cause: new Error('self-signed certificate in certificate chain'),
    })
    expect(isCertificateError(error)).toBe(true)
    expect(isCertificateError(new Error('connection refused'))).toBe(false)
  })
})

describe('withCameraSession', () => {
  async function savedCamera(overrides: Record<string, unknown> = {}) {
    const { store, path } = await temporaryStore()
    await store.upsert(
      {
        id: cameraId('192.168.0.1', 8080),
        host: '192.168.0.1',
        port: 8080,
        useTLS: false,
        lastUsedAt: '2026-08-04T09:00:00.000Z',
        ...overrides,
      },
      { makeDefault: true },
    )
    return { store, path }
  }

  test('connects, discovers, and caches the discovery map', async () => {
    const { store } = await savedCamera()
    const camera = fakeCamera()

    const version = await withCameraSession(
      {},
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async (session) => session.apiVersion,
    )

    expect(version).toBe('ver140')
    expect(camera.requested('deviceinformation')).toBe(true)

    const saved = await store.find('192.168.0.1:8080')
    expect(saved?.discovery?.apiVersion).toBe('ver140')
    expect(saved?.discovery?.firmwareVersion).toBe('1.4.0')
    expect(saved?.model).toBe('Canon EOS R6m2')
  })

  test('a cached map skips discovery entirely', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs(),
      },
    })
    const camera = fakeCamera()

    await withCameraSession(
      {},
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async (session) => session.client.status.getBattery(),
    )

    expect(camera.suffixes()).toEqual(['devicestatus/battery'])
  })

  test('--refresh ignores the cache', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs(),
      },
    })
    const camera = fakeCamera()

    await withCameraSession(
      { refresh: true },
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async () => undefined,
    )

    expect(camera.requested('deviceinformation')).toBe(true)
  })

  test('an expired cache is re-read', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: '2026-06-01T00:00:00.000Z',
        supportedAPIs: supportedAPIs(),
      },
    })
    const camera = fakeCamera()

    await withCameraSession(
      {},
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        now: () => new Date('2026-08-04T00:00:00.000Z'),
        ...silent(),
      },
      async () => undefined,
    )

    expect(camera.requested('deviceinformation')).toBe(true)
  })

  test('a stale cache is revalidated once, then the call is retried', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        // Advertises an endpoint the camera no longer serves.
        supportedAPIs: supportedAPIs('ver140', ['devicestatus/battery', 'deviceinformation']),
      },
    })
    const camera = fakeCamera({
      routes: { 'devicestatus/battery': { kind: 'battery', level: 'full' } },
    })

    // First battery read 404s, forcing a revalidate; the retry succeeds.
    let served = 0
    const flaky = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('devicestatus/battery')) {
          served += 1
          if (served === 1) return new Response('{"message":"Not Found"}', { status: 404 })
        }
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch

    const battery = await withCameraSession(
      {},
      { store, processEnv: {}, fetch: flaky, ...silent() },
      async (session) => session.client.status.getBattery(),
    )

    expect(battery.level).toBe('full')
    // Exactly one revalidation: discovery is re-read once, not on every call.
    expect(camera.suffixes().filter((suffix) => suffix === 'topurlfordev')).toHaveLength(1)
    expect(served).toBe(2)
  })

  test('answers the camera Digest challenge', async () => {
    const { store } = await savedCamera({
      username: 'ccapi',
      password: 'secret',
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs(),
      },
    })
    const camera = fakeCamera({ digest: true })

    await withCameraSession(
      {},
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async (session) => session.client.status.getBattery(),
    )

    const authorized = camera.requests.find(
      (request) => request.headers.authorization !== undefined,
    )
    expect(authorized?.headers.authorization).toContain('Digest')
    expect(authorized?.headers.authorization).toContain('nc=00000001')
    expect(authorized?.headers.authorization).toMatch(/response="[0-9a-f]{32}"/)
  })

  test.each([
    [401, /Check the CCAPI user name and password/],
    [403, /only one client at a time/],
    [404, /does not advertise|CCAPI is not enabled/],
    [409, /resource is locked/],
    [503, /waiting for you to confirm/],
  ])('maps HTTP %i to actionable prose', async (status, pattern) => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs(),
      },
    })
    const failing = Object.assign(async () => new Response('{"message":"nope"}', { status }), {
      preconnect: () => {},
    }) as typeof globalThis.fetch

    const promise = withCameraSession(
      {},
      { store, processEnv: {}, fetch: failing, ...silent() },
      async (session) => session.client.status.getBattery(),
    )

    await expect(promise).rejects.toThrow(pattern)
    await expect(promise).rejects.toBeInstanceOf(CameraError)
  })

  test('a certificate failure names --insecure', async () => {
    const { store } = await savedCamera({ useTLS: true, port: 443, id: '192.168.0.1:443' })
    const failing = Object.assign(
      async () => {
        throw new Error('fetch failed', { cause: new Error('self-signed certificate') })
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch

    await expect(
      withCameraSession(
        {},
        { store, processEnv: {}, fetch: failing, ...silent() },
        async () => undefined,
      ),
    ).rejects.toThrow(/re-run with --insecure/)
  })

  test('runs registered teardown with a signal that is not already aborted', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs(),
      },
    })
    const camera = fakeCamera()
    let releasedWhileAborted: boolean | undefined

    await withCameraSession(
      {},
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async (session) => {
        session.register(async () => {
          releasedWhileAborted = session.signal.aborted
          await session.client.liveview.stopMultipart()
        })
        session.abort()
      },
    )

    // Teardown runs after the abort, but must still reach the camera.
    expect(releasedWhileAborted).toBe(true)
    expect(camera.requested('shooting/liveview/multipart')).toBe(true)
  })

  test('folderSegment tracks the ver140 contents path quirk', async () => {
    for (const [version, expected] of [
      ['ver140', 'folder'],
      ['ver130', undefined],
    ] as const) {
      const { store } = await savedCamera({
        id: `192.168.0.1:8080`,
        discovery: {
          apiVersion: version,
          cachedAt: new Date().toISOString(),
          supportedAPIs: supportedAPIs(version),
        },
      })
      const camera = fakeCamera({ apiVersion: version })

      const segment = await withCameraSession(
        {},
        { store, processEnv: {}, fetch: camera.fetch, ...silent() },
        async (session) => session.folderSegment,
      )

      expect(segment).toBe(expected)
    }
  })

  test('supports() answers from the discovery map', async () => {
    const { store } = await savedCamera({
      discovery: {
        apiVersion: 'ver140',
        cachedAt: new Date().toISOString(),
        supportedAPIs: supportedAPIs('ver140', ['devicestatus/battery']),
      },
    })
    const camera = fakeCamera()

    const answers = await withCameraSession(
      {},
      { store, processEnv: {}, fetch: camera.fetch, ...silent() },
      async (session) => [
        session.supports('devicestatus/battery'),
        session.supports('devicestatus/temperature'),
      ],
    )

    expect(answers).toEqual([true, false])
  })
})

describe('suffixSet', () => {
  test('strips the version and normalises slashes', () => {
    const suffixes = suffixSet({
      ver100: [{ url: 'http://camera/ccapi/ver100/deviceinformation' }],
      ver140: [{ path: '/ccapi/ver140/contents/' }, { path: '/ccapi/ver140/shooting/settings' }],
    })

    expect([...suffixes].sort()).toEqual(['contents', 'deviceinformation', 'shooting/settings'])
  })
})
