import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CameraStore } from '../src/camera-store.ts'

export interface CameraRequest {
  method: string
  url: string
  path: string
  headers: Record<string, string>
  body: string | undefined
  init: RequestInit | undefined
}

export interface FakeCameraOptions {
  /** Answer the first request with a Digest challenge, as a real camera does. */
  digest?: boolean
  /** Responses keyed by path suffix (everything after `ccapi/verNNN/`). */
  routes?: Record<string, unknown | (() => unknown)>
  /** Full-path overrides, e.g. `ccapi/ver100/topurlfordev`. */
  paths?: Record<string, unknown | (() => unknown)>
  /** Suffixes that answer 404, so `notActivated` can be exercised. */
  missing?: string[]
  apiVersion?: string
}

export interface FakeCamera {
  fetch: typeof globalThis.fetch
  requests: CameraRequest[]
  /** Path suffixes requested, in order — the readable form for assertions. */
  suffixes(): string[]
  requested(suffix: string): boolean
}

const DEFAULT_SUFFIXES = [
  'deviceinformation',
  'devicestatus/storage',
  'devicestatus/lens',
  'devicestatus/battery',
  'devicestatus/temperature',
  'devicestatus/currentstorage',
  'devicestatus/currentdirectory',
  'shooting/information/recordable',
  'shooting/settings',
  'shooting/control/shutterbutton',
  'shooting/control/shutterbutton/manual',
  'contents',
  'event/polling',
  'event/monitoring',
  'shooting/liveview',
  'shooting/liveview/flip',
  'shooting/liveview/multipart',
  'shooting/liveview/scroll',
]

export function supportedAPIs(version = 'ver140', suffixes = DEFAULT_SUFFIXES) {
  return {
    [version]: suffixes.map((suffix) => ({
      path: `/ccapi/${version}/${suffix}`,
      get: true,
      post: true,
      put: true,
      delete: true,
    })),
  }
}

const DEVICE_INFORMATION = {
  manufacturer: 'Canon',
  productname: 'Canon EOS R6m2',
  guid: 'guid-1',
  serialnumber: 'SN12345',
  macaddress: 'aa:bb:cc:dd:ee:ff',
  firmwareversion: '1.4.0',
}

/**
 * A camera-shaped `fetch`. Routes are matched on the endpoint suffix so tests
 * need not care which `verNNN` the client resolved.
 */
export function fakeCamera(options: FakeCameraOptions = {}): FakeCamera {
  const version = options.apiVersion ?? 'ver140'
  const requests: CameraRequest[] = []
  let challenged = false

  const defaults: Record<string, unknown> = {
    deviceinformation: DEVICE_INFORMATION,
    'devicestatus/storage': { storagelist: [] },
    'devicestatus/lens': { name: 'RF24-105mm F4 L IS USM', mount: true },
  }

  const fetchImpl = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url).pathname.replace(/^\/+/, '')
    const headers = headerRecord(init?.headers)
    requests.push({
      method: init?.method ?? 'GET',
      url,
      path,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      init,
    })

    if (options.digest === true && !challenged) {
      challenged = true
      return new Response('{"message":"Unauthorized"}', {
        status: 401,
        headers: {
          'www-authenticate':
            'Digest realm="CameraControlApi", nonce="dcd98b7102dd2f0e", qop="auth", algorithm=MD5',
        },
      })
    }

    if (path === `ccapi/${version}/topurlfordev` || path.endsWith('/topurlfordev')) {
      return json(options.paths?.[path] ?? supportedAPIs(version))
    }
    if (options.paths?.[path] !== undefined) return json(resolve(options.paths[path]))

    const suffix = suffixOf(path)
    if (suffix !== undefined && options.missing?.includes(suffix)) {
      return new Response('{"message":"Not Found"}', { status: 404 })
    }
    if (suffix !== undefined && options.routes?.[suffix] !== undefined) {
      return json(resolve(options.routes[suffix]))
    }
    if (suffix !== undefined && defaults[suffix] !== undefined) return json(defaults[suffix])

    return json({})
  }

  return {
    fetch: Object.assign(fetchImpl, { preconnect: () => {} }) as typeof globalThis.fetch,
    requests,
    suffixes: () => requests.map((request) => suffixOf(request.path) ?? request.path),
    requested: (suffix: string) => requests.some((request) => suffixOf(request.path) === suffix),
  }
}

function resolve(value: unknown): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function suffixOf(path: string): string | undefined {
  const match = /^ccapi\/ver\d+\/(.+?)\/?$/.exec(path)
  return match?.[1]
}

function headerRecord(
  headers: ConstructorParameters<typeof Headers>[0] | undefined,
): Record<string, string> {
  if (headers === undefined) return {}
  const record: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    record[key.toLowerCase()] = value
  })
  return record
}

const temporaryDirectories: string[] = []

export async function temporaryStore(): Promise<{ path: string; store: CameraStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-camera-'))
  temporaryDirectories.push(directory)
  const path = join(directory, '.rawback', 'cameras.json')
  return { path, store: new CameraStore(path) }
}

export async function cleanupTemporaryStores(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
}
