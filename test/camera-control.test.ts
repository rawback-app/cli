import { afterEach, describe, expect, test } from 'bun:test'

import {
  cameraDateTime,
  runCameraClock,
  runCameraFocus,
  runCameraOwner,
  runCameraRecord,
  runCameraZoom,
} from '../src/camera-control.ts'
import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import {
  DEFAULT_SUFFIXES,
  cleanupTemporaryStores,
  fakeCamera,
  supportedAPIs,
  temporaryStore,
  type FakeCamera,
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

const CONTROLS = [
  ...DEFAULT_SUFFIXES,
  'shooting/control/recbutton',
  'shooting/control/moviemode',
  'shooting/control/af',
  'shooting/control/drivefocus',
  'shooting/control/zoom',
  'shooting/control/powerzoom',
  'devicestatus/powerzoomstatus',
  'functions/datetime',
  'functions/registeredname/copyright',
  'functions/registeredname/author',
  'functions/registeredname/ownername',
  'functions/registeredname/nickname',
]

function saved(suffixes = CONTROLS): StoredCamera {
  return {
    id: cameraId('192.168.0.1', 8080),
    host: '192.168.0.1',
    port: 8080,
    useTLS: false,
    lastUsedAt: '2026-08-04T09:00:00.000Z',
    discovery: {
      apiVersion: 'ver140',
      cachedAt: new Date().toISOString(),
      supportedAPIs: supportedAPIs('ver140', suffixes),
    },
  }
}

async function setup(routes: Record<string, unknown> = {}, suffixes = CONTROLS) {
  const { store } = await temporaryStore()
  await store.upsert(saved(suffixes), { makeDefault: true })
  const camera = fakeCamera({ routes })
  const output = capture()
  return {
    camera,
    output,
    dependencies: { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
  }
}

/** The JSON body of the one write request to `suffix`. */
function sent(camera: FakeCamera, method: string, suffix: string): unknown {
  const request = camera.requests.find(
    (candidate) => candidate.method === method && candidate.path.endsWith(suffix),
  )
  return request?.body === undefined ? undefined : JSON.parse(request.body)
}

const refuse = { confirm: async () => false, password: async () => '' }

describe('camera record', () => {
  test('start presses the record button', async () => {
    const { camera, output, dependencies } = await setup({
      'shooting/control/moviemode': { status: 'on' },
    })

    await runCameraRecord({ action: 'start', force: true, json: true }, dependencies)

    expect(sent(camera, 'POST', 'control/recbutton')).toEqual({ action: 'start' })
    expect(output.json()).toEqual({ changed: true, recording: true })
  })

  test('refuses to start outside movie mode unless asked to switch', async () => {
    const { camera, dependencies } = await setup({
      'shooting/control/moviemode': { status: 'off' },
    })

    await expect(
      runCameraRecord({ action: 'start', force: true, json: true }, dependencies),
    ).rejects.toThrow(/not in movie mode\. Pass --movie-mode/)
    expect(sent(camera, 'POST', 'control/recbutton')).toBeUndefined()
  })

  test('--movie-mode switches the body into movie mode first', async () => {
    const { camera, dependencies } = await setup({
      'shooting/control/moviemode': { status: 'off' },
    })

    await runCameraRecord(
      { action: 'start', movieMode: true, force: true, json: true },
      dependencies,
    )

    const writes = camera.requests
      .filter((request) => request.method === 'POST')
      .map((request) => request.path.split('/').pop())
    expect(writes).toEqual(['moviemode', 'recbutton'])
    expect(sent(camera, 'POST', 'control/moviemode')).toEqual({ action: 'on' })
  })

  test('a declined stop never reaches the camera', async () => {
    const { camera, output, dependencies } = await setup()

    await runCameraRecord({ action: 'stop', json: true }, { ...dependencies, prompts: refuse })

    expect(camera.requests).toHaveLength(0)
    expect(output.json()).toEqual({ changed: false })
  })

  test('status reports movie mode and the time left', async () => {
    const { output, dependencies } = await setup({
      'shooting/control/moviemode': { status: 'on' },
      'shooting/information/recordable': { recordableshots: 900, remainingtime: 3600 },
    })

    await runCameraRecord({ action: 'status', json: true }, dependencies)

    expect(output.json()).toEqual({ movieMode: 'on', movieSeconds: 3600 })
  })
})

describe('camera focus', () => {
  test('near and far drive focus by the requested step', async () => {
    const { camera, output, dependencies } = await setup()

    await runCameraFocus({ action: 'far', steps: 3, force: true, json: true }, dependencies)

    expect(sent(camera, 'POST', 'control/drivefocus')).toEqual({ value: 'far3' })
    expect(output.json()).toEqual({ changed: true, action: 'far', steps: 3 })
  })

  test('af starts autofocus and stop cancels it', async () => {
    const { camera, dependencies } = await setup()

    await runCameraFocus({ action: 'af', force: true, json: true }, dependencies)
    await runCameraFocus({ action: 'stop', force: true, json: true }, dependencies)

    const bodies = camera.requests
      .filter((request) => request.method === 'POST' && request.path.endsWith('control/af'))
      .map((request) => JSON.parse(request.body ?? '{}') as unknown)
    expect(bodies).toEqual([{ action: 'start' }, { action: 'stop' }])
  })

  test('a body without drive focus is refused by name', async () => {
    const { dependencies } = await setup({}, DEFAULT_SUFFIXES)

    await expect(
      runCameraFocus({ action: 'near', force: true, json: true }, dependencies),
    ).rejects.toThrow(/does not advertise "shooting\/control\/drivefocus"/)
  })
})

describe('camera zoom', () => {
  test('reads every zoom control the body has', async () => {
    const adapter = {
      status: true,
      sw: 'pz',
      moving: false,
      location: 'middle',
      equip: true,
      battery: true,
      lock: false,
      limit: false,
      temperature: 'normal',
    }
    const { output, dependencies } = await setup({
      'shooting/control/zoom': { value: 40, ability: { min: 0, max: 100, step: 1 } },
      'shooting/control/powerzoom': { value: 'stop', ability: ['stop', 'wide', 'tele'] },
      'devicestatus/powerzoomstatus': adapter,
    })

    await runCameraZoom({ json: true }, dependencies)

    expect(output.json()).toEqual({
      zoom: { value: 40, min: 0, max: 100, step: 1 },
      powerZoom: { value: 'stop', ability: ['stop', 'wide', 'tele'] },
      adapter,
    })
  })

  test('a number zooms to a position', async () => {
    const { camera, dependencies } = await setup({
      'shooting/control/zoom': { value: 60, ability: { min: 0, max: 100, step: 1 } },
    })

    await runCameraZoom({ value: '60', force: true, json: true }, dependencies)

    expect(sent(camera, 'POST', 'control/zoom')).toEqual({ value: 60 })
  })

  test('wide, tele and stop drive the power zoom', async () => {
    const { camera, output, dependencies } = await setup({
      'shooting/control/powerzoom': { value: 'tele' },
    })

    await runCameraZoom({ value: 'tele', force: true, json: true }, dependencies)

    expect(sent(camera, 'POST', 'control/powerzoom')).toEqual({ value: 'tele' })
    expect(output.json()).toEqual({ changed: true, powerZoom: 'tele' })
  })

  test('rejects a position that is not a whole number', async () => {
    const { camera, dependencies } = await setup()

    await expect(
      runCameraZoom({ value: '1.5', force: true, json: true }, dependencies),
    ).rejects.toThrow(/whole number/)
    expect(camera.requests).toHaveLength(0)
  })
})

describe('camera clock', () => {
  test.each([
    [new Date('2019-01-01T01:23:45Z'), 540, 'Tue, 01 Jan 2019 10:23:45 +0900'],
    [new Date('2019-01-01T01:23:45Z'), -300, 'Mon, 31 Dec 2018 20:23:45 -0500'],
    [new Date('2026-08-04T09:00:07Z'), 330, 'Tue, 04 Aug 2026 14:30:07 +0530'],
    [new Date('2026-08-04T09:00:07Z'), 0, 'Tue, 04 Aug 2026 09:00:07 +0000'],
  ])('formats %p at offset %p as the camera expects', (date, offset, expected) => {
    expect(cameraDateTime(date, offset)).toBe(expected)
  })

  test('sync sends the host time with its offset and reads the clock back', async () => {
    const now = new Date('2026-08-04T09:00:07Z')
    const { camera, output, dependencies } = await setup({
      'functions/datetime': { datetime: 'Tue, 04 Aug 2026 18:00:07 +0900', dst: false },
    })

    await runCameraClock(
      { sync: true, force: true, json: true },
      { ...dependencies, now: () => now },
    )

    const expected = cameraDateTime(now, -now.getTimezoneOffset())
    expect(sent(camera, 'PUT', 'functions/datetime')).toEqual({ datetime: expected, dst: false })
    expect(output.json()).toEqual({
      synced: true,
      datetime: expected,
      dst: false,
      camera: { datetime: 'Tue, 04 Aug 2026 18:00:07 +0900', dst: false },
    })
  })

  test('show reads the clock without changing it', async () => {
    const { camera, output, dependencies } = await setup({
      'functions/datetime': { datetime: 'Tue, 04 Aug 2026 18:00:07 +0900', dst: true },
    })

    await runCameraClock({ json: true }, dependencies)

    expect(output.json()).toEqual({ datetime: 'Tue, 04 Aug 2026 18:00:07 +0900', dst: true })
    expect(camera.requests.every((request) => request.method === 'GET')).toBe(true)
  })
})

describe('camera owner', () => {
  test('show reads every field the body advertises', async () => {
    const { output, dependencies } = await setup(
      {
        'functions/registeredname/copyright': { copyright: '© Rawback' },
        'functions/registeredname/author': { author: 'A. Photographer' },
      },
      [
        ...DEFAULT_SUFFIXES,
        'functions/registeredname/copyright',
        'functions/registeredname/author',
      ],
    )

    await runCameraOwner({ action: 'show', json: true }, dependencies)

    expect(output.json()).toEqual({
      copyright: '© Rawback',
      author: 'A. Photographer',
      ownerName: null,
      nickname: null,
      unsupported: ['owner-name', 'nickname'],
    })
  })

  test('set writes each given field under its own key', async () => {
    const { camera, output, dependencies } = await setup()

    await runCameraOwner(
      {
        action: 'set',
        values: { copyright: '© Rawback', 'owner-name': 'Studio' },
        force: true,
        json: true,
      },
      dependencies,
    )

    expect(sent(camera, 'PUT', 'registeredname/copyright')).toEqual({ copyright: '© Rawback' })
    expect(sent(camera, 'PUT', 'registeredname/ownername')).toEqual({ ownername: 'Studio' })
    expect(output.json()).toEqual({ changed: ['copyright', 'owner-name'] })
  })

  test('set refuses every field before writing any when one is unsupported', async () => {
    const { camera, dependencies } = await setup({}, [
      ...DEFAULT_SUFFIXES,
      'functions/registeredname/copyright',
    ])

    await expect(
      runCameraOwner(
        { action: 'set', values: { copyright: '©', nickname: 'cam' }, force: true, json: true },
        dependencies,
      ),
    ).rejects.toThrow(/registeredname\/nickname/)
    expect(camera.requests.some((request) => request.method === 'PUT')).toBe(false)
  })

  test('clear deletes the field', async () => {
    const { camera, output, dependencies } = await setup()

    await runCameraOwner(
      { action: 'clear', field: 'nickname', force: true, json: true },
      dependencies,
    )

    expect(
      camera.requests.some(
        (request) =>
          request.method === 'DELETE' && request.path.endsWith('registeredname/nickname'),
      ),
    ).toBe(true)
    expect(output.json()).toEqual({ cleared: true, field: 'nickname' })
  })
})
