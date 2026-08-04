import { afterEach, describe, expect, test } from 'bun:test'

import { runCameraApi } from '../src/camera-api.ts'
import { CameraError } from '../src/camera-errors.ts'
import {
  NAMESPACE_ORDER,
  REGISTRY,
  findEntry,
  listEntries,
  parseArgs,
  validateArgs,
  type ApiEntry,
} from '../src/camera-registry.ts'
import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import {
  cleanupTemporaryStores,
  fakeCamera,
  supportedAPIs,
  temporaryStore,
} from './camera-helpers.ts'

afterEach(cleanupTemporaryStores)

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

function saved(): StoredCamera {
  return {
    id: cameraId('192.168.0.1', 8080),
    host: '192.168.0.1',
    port: 8080,
    useTLS: false,
    lastUsedAt: '2026-08-04T09:00:00.000Z',
    discovery: {
      apiVersion: 'ver140',
      cachedAt: new Date().toISOString(),
      supportedAPIs: supportedAPIs(),
    },
  }
}

const byId = (id: string): ApiEntry => findEntry(id)

describe('registry shape', () => {
  test('every ID is unique', () => {
    const ids = REGISTRY.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every namespace is listed in NAMESPACE_ORDER', () => {
    // A namespace missing here sorts to indexOf -1, ahead of everything else —
    // the ordering bug in the reference catalogue.
    const namespaces = new Set(REGISTRY.map((entry) => entry.namespace))
    for (const namespace of namespaces) {
      expect(NAMESPACE_ORDER).toContain(namespace as (typeof NAMESPACE_ORDER)[number])
    }
  })

  test('listEntries returns namespaces in doc order, not alphabetically', () => {
    const order: string[] = []
    for (const entry of listEntries()) {
      if (order[order.length - 1] !== entry.namespace) order.push(entry.namespace)
    }
    expect(order).toEqual([...NAMESPACE_ORDER].filter((namespace) => order.includes(namespace)))
    expect(order[0]).toBe('connection')
  })

  test('id, namespace, and label agree', () => {
    for (const entry of REGISTRY) {
      expect(`${entry.namespace}.${entry.label}`).toBe(entry.id)
    }
  })

  test('a GET never mutates and a non-GET always does', () => {
    for (const entry of REGISTRY) {
      if (entry.method === 'GET') expect(entry.mutates).toBe(false)
      else expect(entry.mutates).toBe(true)
    }
  })

  test('every enum parameter offers at least two options', () => {
    for (const entry of REGISTRY) {
      for (const param of entry.params) {
        if (param.kind === 'enum') expect(param.options.length).toBeGreaterThan(1)
      }
    }
  })

  test('listEntries filters by namespace and by mutation', () => {
    expect(listEntries({ namespace: 'status' }).every((e) => e.namespace === 'status')).toBe(true)
    expect(listEntries({ mutating: false }).every((e) => !e.mutates)).toBe(true)
    expect(listEntries({ mutating: true }).every((e) => e.mutates)).toBe(true)
  })

  test('findEntry suggests near matches for a typo', () => {
    expect(() => findEntry('getBattery')).toThrow(/Did you mean: status\.getBattery/)
    expect(() => findEntry('zzz')).toThrow(/Run rawback camera api --list/)
  })
})

/**
 * The drift guard. Every thunk is invoked against a client whose fetch records
 * the path and throws a sentinel, so a renamed or removed library method shows
 * up as "is not a function" rather than the sentinel. This is what catches a
 * future @rawback/ccapi-js bump changing the surface underneath the catalogue.
 */
describe('registry drift guard', () => {
  const SENTINEL = 'sentinel-request'

  function syntheticArgs(entry: ApiEntry): Record<string, unknown> {
    const args: Record<string, unknown> = {}
    for (const param of entry.params) {
      switch (param.kind) {
        case 'string':
          args[param.name] =
            param.name === 'locator' ? '/ccapi/ver140/contents/card1/100CANON/IMG_1.JPG' : 'x'
          break
        case 'number':
          args[param.name] = 1
          break
        case 'boolean':
          args[param.name] = true
          break
        case 'enum':
          args[param.name] = param.options[0]
          break
        case 'json':
          args[param.name] =
            param.name === 'gps'
              ? {
                  latitude_ref: 'N',
                  latitude: [35, 0, 0],
                  longitude_ref: 'E',
                  longitude: [139, 0, 0],
                  altitude_ref: 'P',
                  altitude: [0, 1],
                  timestamp: [0, 0, 0],
                  mapdatum: 'WGS-84',
                  status: 'A',
                  datestamp: '2026:08:04',
                }
              : { sharpness_strength: 4 }
          break
      }
    }
    return args
  }

  test('every entry reaches the transport instead of a missing method', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      {
        ...saved(),
        discovery: {
          apiVersion: 'ver140',
          cachedAt: new Date().toISOString(),
          // Advertise every suffix any entry might resolve, so version lookup
          // never masks a missing method.
          supportedAPIs: supportedAPIs('ver140', allSuffixes()),
        },
      },
      { makeDefault: true },
    )

    const failures: string[] = []
    const throwingFetch = Object.assign(
      async () => {
        throw new Error(SENTINEL)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch

    const { withCameraSession } = await import('../src/camera-session.ts')

    await withCameraSession(
      {},
      { store, env: {}, fetch: throwingFetch, stdout: () => {}, stderr: () => {} },
      async (session) => {
        for (const entry of REGISTRY) {
          try {
            await entry.run(session, syntheticArgs(entry))
            failures.push(`${entry.id}: unexpectedly resolved`)
          } catch (error) {
            // Anything that came from the client — a sentinel fetch failure, or
            // a version lookup that named a suffix — proves the method exists
            // and was callable. The drift we are hunting is the opposite: a
            // renamed or removed method, which surfaces as a TypeError.
            const message = error instanceof Error ? error.message : String(error)
            const drifted =
              error instanceof TypeError ||
              /is not a function|undefined is not an object|Cannot read propert/i.test(message)
            if (drifted) failures.push(`${entry.id}: ${message}`)
          }
        }
      },
    ).catch(() => undefined)

    expect(failures).toEqual([])
  })

  function allSuffixes(): string[] {
    const suffixes = new Set<string>()
    for (const entry of REGISTRY) if (entry.suffix !== undefined) suffixes.add(entry.suffix)
    // Plus the ones the library resolves internally for the generic accessors.
    for (const extra of [
      'deviceinformation',
      'devicestatus/battery',
      'devicestatus/batterylist',
      'devicestatus/temperature',
      'devicestatus/storage',
      'devicestatus/lens',
      'devicestatus/currentstorage',
      'devicestatus/currentdirectory',
      'devicestatus/powerzoomstatus',
      'contents',
      'shooting/settings',
      'shooting/information/recordable',
      'shooting/liveview',
      'event/polling',
      'event/monitoring',
      'functions/datetime',
      'functions/cardformat',
      'functions/registeredname/copyright',
      'functions/registeredname/author',
      'functions/registeredname/ownername',
      'functions/registeredname/nickname',
      'functions/beep',
      'functions/displayoff',
      'functions/autopoweroff',
      'functions/networksetting',
      'functions/networkconnection',
      'customfunction/afsetting',
    ]) {
      suffixes.add(extra)
    }
    return [...suffixes]
  }
})

describe('parseArgs', () => {
  const setting = byId('shooting.getSetting')
  const put = byId('shooting.putIntSetting')
  const shutter = byId('shooting.pressShutterButton')
  const rotate = byId('contents.rotateContent')

  test('splits on the first = only', () => {
    expect(parseArgs(setting, ['name=a=b'])).toEqual({ name: 'a=b' })
  })

  test.each([
    ['novalue', /--arg must be key=value/],
    ['=x', /--arg is missing a name/],
  ])('rejects %p', (pair, pattern) => {
    expect(() => parseArgs(setting, [pair])).toThrow(pattern)
  })

  test('rejects a repeated key rather than silently taking the last', () => {
    expect(() => parseArgs(setting, ['name=a', 'name=b'])).toThrow(/given more than once/)
  })

  test('rejects an unknown key and names the expected ones', () => {
    expect(() => parseArgs(setting, ['nope=1'])).toThrow(/is not a parameter.*Expected: name/s)
  })

  test('requires a required parameter', () => {
    expect(() => parseArgs(setting, [])).toThrow(/requires --arg name=<value>/)
  })

  test('omits an absent optional rather than setting it undefined', () => {
    const args = parseArgs(byId('contents.listContents'), ['storage=card1', 'directory=100CANON'])
    // exactOptionalPropertyTypes: an absent optional must not be a present undefined.
    expect('page' in args).toBe(false)
  })

  test.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('coerces the boolean %p', (raw, expected) => {
    expect(parseArgs(shutter, [`af=${raw}`]).af).toBe(expected)
  })

  test('rejects a non-boolean for a boolean parameter', () => {
    expect(() => parseArgs(shutter, ['af=maybe'])).toThrow(/must be true or false/)
  })

  test('coerces and validates numbers', () => {
    expect(parseArgs(put, ['name=x', 'value=42']).value).toBe(42)
    expect(() => parseArgs(put, ['name=x', 'value=abc'])).toThrow(/must be a number/)
  })

  test('rejects an enum value and lists the valid ones', () => {
    expect(() => parseArgs(rotate, ['locator=card1/100CANON/A.JPG', 'degrees=45'])).toThrow(
      /must be one of: 0, 90, 180, 270/,
    )
  })

  test('parses JSON and reports a parse failure clearly', () => {
    const style = byId('shooting.setPictureStyleDetail')
    expect(parseArgs(style, ['style=standard', 'params={"contrast":1}']).params).toEqual({
      contrast: 1,
    })
    expect(() => parseArgs(style, ['style=standard', 'params={oops'])).toThrow(/must be JSON/)
  })

  test('validateArgs enforces the same rule the form must obey', () => {
    expect(() => validateArgs(setting, {})).toThrow(CameraError)
    expect(() => validateArgs(setting, { name: 'av' })).not.toThrow()
  })
})

describe('camera api runner', () => {
  test('--list reports every endpoint with its metadata', async () => {
    const { store } = await temporaryStore()
    const output = capture()

    await runCameraApi({ list: true, json: true }, { store, env: {}, ...output.dependencies })

    const parsed = output.json() as { count: number; endpoints: Array<Record<string, unknown>> }
    expect(parsed.count).toBe(REGISTRY.length)
    expect(parsed.endpoints[0]).toMatchObject({ namespace: 'connection' })
  })

  test('--list --namespace filters', async () => {
    const { store } = await temporaryStore()
    const output = capture()

    await runCameraApi(
      { list: true, namespace: 'status', json: true },
      { store, env: {}, ...output.dependencies },
    )

    const parsed = output.json() as { endpoints: Array<{ namespace: string }> }
    expect(parsed.endpoints.every((entry) => entry.namespace === 'status')).toBe(true)
  })

  test('runs a read-only endpoint and reports the result', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: {
        'devicestatus/battery': {
          name: 'LP-E6NH',
          kind: 'battery',
          level: 'full',
          quality: 'good',
        },
      },
    })
    const output = capture()

    await runCameraApi(
      { id: 'status.getBattery', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const parsed = output.json()
    expect(parsed.id).toBe('status.getBattery')
    expect(parsed.result).toMatchObject({ level: 'full' })
    expect(typeof parsed.ms).toBe('number')
  })

  test('refuses an endpoint the camera does not advertise', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      {
        ...saved(),
        discovery: {
          apiVersion: 'ver140',
          cachedAt: new Date().toISOString(),
          supportedAPIs: supportedAPIs('ver140', ['devicestatus/battery']),
        },
      },
      { makeDefault: true },
    )
    const camera = fakeCamera()
    const output = capture()

    await expect(
      runCameraApi(
        { id: 'shooting.getZoom', json: true },
        { store, env: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow(/does not advertise "shooting\/control\/zoom"/)
  })

  test('a mutating endpoint asks first and honours a refusal', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraApi(
      { id: 'shooting.setAperture', arg: ['value=f5.6'], json: true },
      {
        store,
        env: {},
        fetch: camera.fetch,
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(output.json()).toEqual({ id: 'shooting.setAperture', ran: false })
    expect(camera.requests).toEqual([])
  })

  test('an unreliable endpoint warns on stderr before running', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraApi(
      { id: 'liveview.getScroll', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    ).catch(() => undefined)

    expect(output.stderr.join('\n')).toContain('misbehave on real hardware')
  })

  test('--describe never touches the camera', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraApi(
      { id: 'status.getBattery', describe: true, json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toMatchObject({ id: 'status.getBattery', doc: '4.4.4', mutates: false })
    expect(camera.requests).toEqual([])
  })
})
