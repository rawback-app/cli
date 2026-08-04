import { afterEach, describe, expect, test } from 'bun:test'

import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import {
  runCameraConnect,
  runCameraForget,
  runCameraInfo,
  runCameraList,
  runCameraStatus,
  runCameraUse,
} from '../src/camera.ts'
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

const CACHED = {
  apiVersion: 'ver140',
  cachedAt: new Date().toISOString(),
  supportedAPIs: supportedAPIs(),
}

function saved(overrides: Partial<StoredCamera> = {}): StoredCamera {
  return {
    id: cameraId('192.168.0.1', 8080),
    host: '192.168.0.1',
    port: 8080,
    useTLS: false,
    lastUsedAt: '2026-08-04T09:00:00.000Z',
    discovery: CACHED,
    ...overrides,
  }
}

/** A saved camera with no cached discovery, so the command performs a full connect. */
function savedUncached(): StoredCamera {
  const { discovery, ...rest } = saved()
  void discovery
  return rest
}

function unexpectedPrompts() {
  return {
    confirm: async (): Promise<boolean> => {
      throw new Error('confirm prompt should not be reached')
    },
    password: async (): Promise<string> => {
      throw new Error('password prompt should not be reached')
    },
  }
}

describe('camera connect', () => {
  test('saves the camera, caches discovery, and reports the connection', async () => {
    const { store } = await temporaryStore()
    const camera = fakeCamera()
    const output = capture()

    await runCameraConnect(
      { url: 'http://192.168.0.1:8080', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toMatchObject({
      id: '192.168.0.1:8080',
      host: '192.168.0.1',
      port: 8080,
      useTLS: false,
      default: true,
      passwordSaved: false,
      connection: {
        apiVersion: 'ver140',
        device: { productName: 'Canon EOS R6m2', firmwareVersion: '1.4.0' },
      },
    })

    const entry = await store.find('192.168.0.1:8080')
    expect(entry?.discovery?.apiVersion).toBe('ver140')
    expect(entry?.model).toBe('Canon EOS R6m2')
  })

  test('does not store the password unless asked', async () => {
    const { store } = await temporaryStore()
    const camera = fakeCamera()
    const output = capture()

    await runCameraConnect(
      { url: 'http://ccapi:secret@192.168.0.1:8080', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const entry = await store.find('192.168.0.1:8080')
    expect(entry?.username).toBe('ccapi')
    expect(entry?.password).toBeUndefined()
    expect(output.json().passwordSaved).toBe(false)
  })

  test('stores the password with --save-password and warns on stderr', async () => {
    const { store } = await temporaryStore()
    const camera = fakeCamera()
    const output = capture()

    await runCameraConnect(
      { url: 'http://ccapi:secret@192.168.0.1:8080', savePassword: true, json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect((await store.find('192.168.0.1:8080'))?.password).toBe('secret')
    expect(output.stderr.join('\n')).toContain('plain text')
    // The warning must never contaminate the JSON on stdout.
    expect(output.json().passwordSaved).toBe(true)
  })

  test('--no-default saves without retargeting', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved({ id: 'other:8080', host: 'other' }), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraConnect(
      { url: 'http://192.168.0.1:8080', makeDefault: false, json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect((await store.read()).default).toBe('other:8080')
  })
})

describe('camera list', () => {
  test('marks the default and never emits a password', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved({ username: 'ccapi', password: 'secret' }), { makeDefault: true })
    await store.upsert(saved({ id: 'other:8080', host: 'other' }))
    const output = capture()

    await runCameraList({ json: true }, { store, env: {}, ...output.dependencies })

    const body = output.stdout.join('\n')
    expect(body).not.toContain('secret')
    const parsed = output.json() as { default: string; cameras: Array<Record<string, unknown>> }
    expect(parsed.default).toBe('192.168.0.1:8080')
    expect(parsed.cameras).toHaveLength(2)
    const primary = parsed.cameras.find((entry) => entry.id === '192.168.0.1:8080')
    expect(primary).toMatchObject({ passwordSaved: true, username: 'ccapi', default: true })
    expect(primary?.password).toBeUndefined()
  })

  test('renders an empty store as a hint rather than an error', async () => {
    const { store } = await temporaryStore()
    const output = capture()

    await runCameraList({}, { store, env: {}, ...output.dependencies })

    expect(output.stdout.join('\n')).toContain('rawback camera connect')
  })
})

describe('camera use and forget', () => {
  test('use retargets the default', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    await store.upsert(saved({ id: 'other:8080', host: 'other' }))
    const output = capture()

    await runCameraUse({ id: 'other:8080', json: true }, { store, env: {}, ...output.dependencies })

    expect(output.json()).toEqual({ default: 'other:8080' })
    expect((await store.defaultCamera())?.id).toBe('other:8080')
  })

  test('forget --force skips the prompt', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved())
    const output = capture()

    await runCameraForget(
      { id: '192.168.0.1:8080', force: true, json: true },
      { store, env: {}, prompts: unexpectedPrompts(), ...output.dependencies },
    )

    expect(output.json()).toEqual({ forgotten: true, id: '192.168.0.1:8080' })
    expect(await store.list()).toEqual([])
  })

  test('a declined confirmation leaves the camera in place', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved())
    const output = capture()

    await runCameraForget(
      { id: '192.168.0.1:8080', json: true },
      {
        store,
        env: {},
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(output.json()).toEqual({ forgotten: false, id: '192.168.0.1:8080' })
    expect(await store.list()).toHaveLength(1)
  })

  test('forgetting an unknown camera is an error, not a silent no-op', async () => {
    const { store } = await temporaryStore()
    const output = capture()

    await expect(
      runCameraForget({ id: 'nope:8080', force: true }, { store, env: {}, ...output.dependencies }),
    ).rejects.toThrow(/No saved camera with ID nope:8080/)
  })
})

describe('camera info', () => {
  test('reports the device, lens, and storage', async () => {
    const { store } = await temporaryStore()
    await store.upsert(savedUncached(), { makeDefault: true })
    const camera = fakeCamera({
      routes: {
        'devicestatus/storage': {
          storagelist: [
            {
              name: 'card1',
              path: '/ccapi/ver140/contents/card1',
              accesscapability: 'readwrite',
              maxsize: 64_000_000_000,
              spacesize: 32_000_000_000,
              contentsnumber: 412,
            },
          ],
        },
      },
    })
    const output = capture()

    await runCameraInfo(
      { json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toMatchObject({
      apiVersion: 'ver140',
      device: {
        manufacturer: 'Canon',
        productName: 'Canon EOS R6m2',
        firmwareVersion: '1.4.0',
        serialNumber: 'SN12345',
      },
      storage: [{ name: 'card1', contentsNumber: 412 }],
      lens: { name: 'RF24-105mm F4 L IS USM' },
    })
  })
})

describe('camera status', () => {
  test('reads every advertised endpoint', async () => {
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
        'devicestatus/temperature': { status: 'normal' },
        'devicestatus/currentstorage': { name: 'card1', path: '/x' },
        'devicestatus/currentdirectory': { name: '100CANON', path: '/x/100CANON' },
        'shooting/information/recordable': { stillimage: 1832, movieduration: 4210 },
      },
    })
    const output = capture()

    await runCameraStatus(
      { json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      battery: { name: 'LP-E6NH', kind: 'battery', level: 'full', quality: 'good' },
      temperature: 'normal',
      currentStorage: 'card1',
      currentDirectory: '100CANON',
      recordable: { stillImages: 1832, movieSeconds: 4210 },
      unsupported: [],
    })
  })

  test('reports unadvertised endpoints as null instead of failing', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      saved({
        discovery: {
          apiVersion: 'ver140',
          cachedAt: new Date().toISOString(),
          // A body that advertises only the battery.
          supportedAPIs: supportedAPIs('ver140', ['devicestatus/battery']),
        },
      }),
      { makeDefault: true },
    )
    const camera = fakeCamera({
      routes: {
        'devicestatus/battery': {
          name: 'LP-E6NH',
          kind: 'battery',
          level: 'half',
          quality: 'good',
        },
      },
    })
    const output = capture()

    await runCameraStatus(
      { json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const parsed = output.json()
    expect(parsed.temperature).toBeNull()
    expect(parsed.recordable).toBeNull()
    expect(parsed.unsupported).toEqual([
      'devicestatus/temperature',
      'devicestatus/currentstorage',
      'devicestatus/currentdirectory',
      'shooting/information/recordable',
    ])
    // The endpoint it does advertise still came back.
    expect(parsed.battery).toMatchObject({ level: 'half' })
  })

  test('renders human output without touching stderr', async () => {
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

    await runCameraStatus({}, { store, env: {}, fetch: camera.fetch, ...output.dependencies })

    expect(output.stdout.join('\n')).toContain('full')
    expect(output.stderr).toEqual([])
  })
})
