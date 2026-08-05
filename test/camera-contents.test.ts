import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseContentLocator,
  runCameraContentsDelete,
  runCameraContentsGet,
  runCameraContentsList,
  runCameraContentsStorages,
} from '../src/camera-contents.ts'
import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import {
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
  test('reads a ver140 locator with a folder segment', () => {
    expect(
      parseContentLocator('/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG'),
    ).toEqual({ storage: 'card1', folder: 'folder', directory: '100CANON', file: 'IMG_0042.JPG' })
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
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({ storages: ['/ccapi/ver140/contents/card1'] })
  })

  test('a ver140 listing sends the folder segment', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved('ver140'), { makeDefault: true })
    const camera = fakeCamera({ apiVersion: 'ver140' })
    const output = capture()

    await runCameraContentsList(
      { storage: 'card1', directory: '100CANON', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    // ver140 inserts `folder` as a path segment: contents/<storage>/folder/<directory>
    expect(
      camera.requests.some((request) => request.path.includes('contents/card1/folder/100CANON')),
    ).toBe(true)
  })

  test('an older camera omits it', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved('ver130'), { makeDefault: true })
    const camera = fakeCamera({ apiVersion: 'ver130' })
    const output = capture()

    await runCameraContentsList(
      { storage: 'card1', directory: '100CANON', json: true },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
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
      { store, env: {}, fetch: streaming, ...output.dependencies },
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
        locator: '/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG',
        output: target,
        json: true,
      },
      { store, env: {}, fetch: binary, ...output.dependencies },
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
          locator: '/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG',
          output: target,
          json: true,
        },
        { store, env: {}, fetch: camera.fetch, ...output.dependencies },
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
        locator: '/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG',
        output: directory,
        json: true,
      },
      { store, env: {}, fetch: binary, ...output.dependencies },
    )

    expect(output.json().output).toBe(join(directory, 'IMG_0042.JPG'))
  })

  test('delete asks first and honours a refusal', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraContentsDelete(
      { locator: '/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG', json: true },
      {
        store,
        env: {},
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
        locator: '/ccapi/ver140/contents/card1/folder/100CANON/IMG_0042.JPG',
        force: true,
        json: true,
      },
      { store, env: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json().deleted).toBe(true)
    const request = camera.requests.find((entry) => entry.method === 'DELETE')
    expect(request?.path).toContain('card1/folder/100CANON/IMG_0042.JPG')
  })
})
