import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runCameraEventsClear,
  runCameraEventsPoll,
  runCameraEventsWatch,
} from '../src/camera-events.ts'
import {
  runCameraLiveviewFrame,
  runCameraLiveviewStop,
  runCameraLiveviewStream,
} from '../src/camera-liveview.ts'
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
  const directory = await mkdtemp(join(tmpdir(), 'rawback-stream-'))
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
    /** NDJSON: one object per line. */
    lines: () => stdout.flatMap((chunk) => chunk.split('\n')).filter((line) => line.trim() !== ''),
  }
}

function saved(suffixes = DEFAULT_SUFFIXES): StoredCamera {
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

/** A `multipart/x-mixed-replace` body carrying `count` one-byte JPEG frames. */
function multipartBody(count: number): { body: Uint8Array; contentType: string } {
  const boundary = 'boundarydonotcross'
  const parts: number[] = []
  const push = (text: string) => {
    for (const code of new TextEncoder().encode(text)) parts.push(code)
  }
  for (let index = 0; index < count; index += 1) {
    push(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: 1\r\n\r\n`)
    parts.push(index + 1)
    push('\r\n')
  }
  push(`--${boundary}--\r\n`)
  return {
    body: new Uint8Array(parts),
    contentType: `multipart/x-mixed-replace; boundary=${boundary}`,
  }
}

/**
 * A Chapter-5 binary unit: 0xFF 0x00, type, 4-byte big-endian size, payload,
 * 0xFF 0xFF. Monitoring events arrive as type 0x02; the client skips the rest.
 */
function binaryUnit(payload: string, type = 0x02): number[] {
  const bytes = [...new TextEncoder().encode(payload)]
  const size = bytes.length
  return [
    0xff,
    0x00,
    type,
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...bytes,
    0xff,
    0xff,
  ]
}

describe('liveview stream', () => {
  test('writes numbered frames, stops at --frames, and releases the camera', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const camera = fakeCamera()
    const { body, contentType } = multipartBody(3)

    const streaming = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('liveview/multipart') && (init?.method ?? 'GET') === 'GET') {
          return new Response(body, { status: 200, headers: { 'content-type': contentType } })
        }
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraLiveviewStream(
      { outputDir: directory, frames: 3, json: true },
      { store, processEnv: {}, fetch: streaming, ...output.dependencies },
    )

    const files = (await readdir(directory)).sort()
    expect(files).toEqual(['frame-00001.jpg', 'frame-00002.jpg', 'frame-00003.jpg'])
    expect(new Uint8Array(await readFile(join(directory, 'frame-00002.jpg')))).toEqual(
      new Uint8Array([2]),
    )

    const lines = output.lines().map((line) => JSON.parse(line) as Record<string, unknown>)
    // One object per frame, then the terminating summary.
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ frame: 1, bytes: 1 })
    expect(lines[3]).toMatchObject({ stopped: true, frames: 3, reason: 'limit' })

    // The stream is released so the next client can connect.
    expect(
      camera.requests.some(
        (request) => request.method === 'DELETE' && request.path.includes('liveview/multipart'),
      ),
    ).toBe(true)
  })

  test('falls back to the scroll stream on a body without multipart', async () => {
    const { store } = await temporaryStore()
    await store.upsert(
      saved(DEFAULT_SUFFIXES.filter((suffix) => suffix !== 'shooting/liveview/multipart')),
      { makeDefault: true },
    )
    const directory = await scratchDir()
    // The splitter walks JPEG segments: SOI, a start-of-scan, one byte of scan
    // data, EOI.
    const jpeg = (byte: number) => [0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, byte, 0xff, 0xd9]
    const frames = new Uint8Array([...jpeg(1), ...jpeg(2)])
    const camera = fakeCamera({
      routes: { 'shooting/liveview/scroll': () => new Response(frames, { status: 200 }) },
    })
    const output = capture()

    await runCameraLiveviewStream(
      { outputDir: directory, frames: 2, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect((await readdir(directory)).sort()).toEqual(['frame-00001.jpg', 'frame-00002.jpg'])
    expect(camera.requested('shooting/liveview/multipart')).toBe(false)
    expect(
      camera.requests.some(
        (request) => request.method === 'DELETE' && request.path.endsWith('liveview/scroll'),
      ),
    ).toBe(true)
  })

  test('stop releases every live-view resource and is safe when idle', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraLiveviewStop(
      { json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const parsed = JSON.parse(output.stdout.join('\n')) as { stopped: boolean; released: string[] }
    expect(parsed.stopped).toBe(true)
    expect(parsed.released).toEqual(['multipart', 'scroll'])
  })
})

describe('liveview frame --detail', () => {
  const incidental = {
    liveviewdata: {
      afframe: [
        { status: 1, select: 1, x: 10, y: 20, width: 30, height: 40 },
        { status: 0, select: 0, x: 50, y: 60, width: 30, height: 40 },
      ],
      histogram: [
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      zoom: {
        positionx: 0,
        positiony: 0,
        positionwidth: 100,
        positionheight: 100,
        magnification: 5,
      },
    },
    angleinformation: { cameraposture: 0, rolling: 150, pitching: -20 },
  }

  function detailBody(): Uint8Array {
    return new Uint8Array([
      ...binaryUnit('JPEGDATA', 0x00),
      ...binaryUnit(JSON.stringify(incidental), 0x01),
    ])
  }

  test('saves the frame and reports the incidental info', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved([...DEFAULT_SUFFIXES, 'shooting/liveview/flipdetail']), {
      makeDefault: true,
    })
    const directory = await scratchDir()
    const camera = fakeCamera({
      routes: { 'shooting/liveview/flipdetail': () => new Response(detailBody()) },
    })
    const output = capture()
    const target = join(directory, 'frame.jpg')

    await runCameraLiveviewFrame(
      { output: target, detail: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(await readFile(target, 'utf8')).toBe('JPEGDATA')
    expect(camera.requests.find((r) => r.path.endsWith('flipdetail'))?.url).toContain('kind=both')
    const parsed = JSON.parse(output.stdout.join('\n')) as {
      bytes: number
      detail: { afFrames: unknown[]; angleInformation: unknown; zoom: { magnification: number } }
    }
    expect(parsed.bytes).toBe(8)
    expect(parsed.detail.afFrames).toHaveLength(2)
    expect(parsed.detail.angleInformation).toEqual({
      cameraPosture: 0,
      rolling: 150,
      pitching: -20,
    })
    expect(parsed.detail.zoom.magnification).toBe(5)
  })

  test('reads the level in degrees for a person', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved([...DEFAULT_SUFFIXES, 'shooting/liveview/flipdetail']), {
      makeDefault: true,
    })
    const directory = await scratchDir()
    const camera = fakeCamera({
      routes: { 'shooting/liveview/flipdetail': () => new Response(detailBody()) },
    })
    const output = capture()

    await runCameraLiveviewFrame(
      { output: join(directory, 'frame.jpg'), detail: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const text = output.stdout.join('\n')
    expect(text).toContain('horizontal, roll 1.5°, pitch -0.2°')
    expect(text).toContain('5×')
  })

  test('refuses a body that does not advertise flipdetail', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const camera = fakeCamera()

    await expect(
      runCameraLiveviewFrame(
        { output: join(directory, 'frame.jpg'), detail: true, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...capture().dependencies },
      ),
    ).rejects.toThrow(/does not advertise "shooting\/liveview\/flipdetail"/)
    expect(camera.requested('shooting/liveview/flipdetail')).toBe(false)
  })
})

describe('events watch', () => {
  test('emits NDJSON, stops at --count, and stops monitoring', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const units = new Uint8Array([
      ...binaryUnit(
        '{"battery":{"name":"LP-E6NH","kind":"battery","level":"full","quality":"good"}}',
      ),
      ...binaryUnit('{"addedcontents":["/ccapi/ver140/contents/card1/100CANON/IMG_1.JPG"]}'),
      ...binaryUnit('{"temperature":{"status":"normal"}}'),
    ])

    const streaming = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('event/monitoring') && (init?.method ?? 'GET') === 'GET') {
          return new Response(units, { status: 200 })
        }
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraEventsWatch(
      { count: 2, json: true },
      { store, processEnv: {}, fetch: streaming, ...output.dependencies },
    )

    const lines = output.lines().map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ changedKeys: ['battery'] })
    expect(lines[1]).toMatchObject({
      addedContents: ['/ccapi/ver140/contents/card1/100CANON/IMG_1.JPG'],
    })
    expect(lines[2]).toMatchObject({ stopped: true, events: 2, reason: 'limit' })

    expect(
      camera.requests.some(
        (request) => request.method === 'DELETE' && request.path.includes('event/monitoring'),
      ),
    ).toBe(true)
  })

  test('every raw key survives, including ones the decoder does not model', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const units = new Uint8Array(binaryUnit('{"somethingnobodymodels":{"value":"x"}}'))
    const streaming = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('event/monitoring')) return new Response(units, { status: 200 })
        return camera.fetch(input, init)
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch
    const output = capture()

    await runCameraEventsWatch(
      { count: 1, json: true },
      { store, processEnv: {}, fetch: streaming, ...output.dependencies },
    )

    const first = JSON.parse(output.lines()[0] as string) as { changedKeys: string[] }
    expect(first.changedKeys).toEqual(['somethingnobodymodels'])
  })
})

describe('events poll', () => {
  test.each([
    ['ver110', '?timeout=long'],
    ['ver100', '?continue=on'],
  ])('--wait on a %s event endpoint holds with %s', async (version, query) => {
    const { store } = await temporaryStore()
    await store.upsert(
      {
        ...saved(),
        discovery: {
          apiVersion: version,
          cachedAt: new Date().toISOString(),
          supportedAPIs: supportedAPIs(version),
        },
      },
      { makeDefault: true },
    )
    const camera = fakeCamera({ apiVersion: version })
    const output = capture()

    await runCameraEventsPoll(
      { wait: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const poll = camera.requests.find((request) => request.path.endsWith('event/polling'))
    expect(new URL(poll?.url ?? '').search).toBe(query)
  })
})

describe('events clear', () => {
  test('--force clears polling without prompting', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraEventsClear(
      { force: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(JSON.parse(output.stdout.join('\n'))).toEqual({ cleared: true })
    expect(
      camera.requests.some(
        (request) => request.method === 'DELETE' && request.path.includes('event/polling'),
      ),
    ).toBe(true)
  })

  test('a refusal leaves the camera untouched', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraEventsClear(
      { json: true },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(JSON.parse(output.stdout.join('\n'))).toEqual({ cleared: false })
    expect(camera.requests).toEqual([])
  })
})
