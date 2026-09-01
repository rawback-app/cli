import { afterEach, describe, expect, test } from 'bun:test'

import {
  runCameraSettingsGet,
  runCameraSettingsList,
  runCameraSettingsSet,
} from '../src/camera-settings.ts'
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
      supportedAPIs: supportedAPIs('ver140', [
        'shooting/settings',
        'shooting/settings/av',
        'shooting/settings/colortemperature',
      ]),
    },
  }
}

describe('camera settings', () => {
  test('list reports each setting with its ability', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: {
        'shooting/settings': {
          av: { value: 'f4.0', ability: ['f2.8', 'f4.0'] },
          tv: { value: '1/125', ability: ['1/60', '1/125'] },
        },
      },
    })
    const output = capture()

    await runCameraSettingsList(
      { json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      settings: [
        { name: 'av', value: 'f4.0', ability: ['f2.8', 'f4.0'] },
        { name: 'tv', value: '1/125', ability: ['1/60', '1/125'] },
      ],
    })
  })

  test('get returns a list-ability setting', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: { 'shooting/settings/av': { value: 'f4.0', ability: ['f2.8', 'f4.0'] } },
    })
    const output = capture()

    await runCameraSettingsGet(
      { name: 'av', json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      name: 'av',
      value: 'f4.0',
      ability: ['f2.8', 'f4.0'],
      range: null,
    })
  })

  test('a range-ability setting reports its range, not a bare value', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: {
        'shooting/settings/colortemperature': {
          value: 5200,
          ability: { min: 2500, max: 10000, step: 100 },
        },
      },
    })
    const output = capture()

    await runCameraSettingsGet(
      { name: 'colortemperature', json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      name: 'colortemperature',
      value: 5200,
      ability: null,
      range: { min: 2500, max: 10000, step: 100 },
    })
  })

  test('a locked range setting reports null rather than 0', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    // The documented locked shape: every member is null.
    const camera = fakeCamera({
      routes: {
        'shooting/settings/colortemperature': {
          value: null,
          ability: { min: null, max: null, step: null },
        },
      },
    })
    const output = capture()

    await runCameraSettingsGet(
      { name: 'colortemperature', json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({
      name: 'colortemperature',
      value: null,
      ability: null,
      range: { min: null, max: null, step: null },
    })
  })

  test('set writes the value and reads back what the camera accepted', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: { 'shooting/settings/av': { value: 'f5.6', ability: ['f4.0', 'f5.6'] } },
    })
    const output = capture()

    await runCameraSettingsSet(
      { name: 'av', value: 'f5.6', force: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const put = camera.requests.find((request) => request.method === 'PUT')
    expect(put?.body).toContain('f5.6')
    expect(output.json()).toEqual({
      changed: true,
      name: 'av',
      requested: 'f5.6',
      value: 'f5.6',
    })
  })

  test('a declined confirmation leaves the camera alone', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraSettingsSet(
      { name: 'av', value: 'f5.6', json: true },
      {
        store,
        processEnv: {},
        fetch: camera.fetch,
        prompts: { confirm: async () => false, password: async () => '' },
        ...output.dependencies,
      },
    )

    expect(output.json()).toEqual({ changed: false, name: 'av' })
    expect(camera.requests).toEqual([])
  })

  test('a range setting takes a number without --int', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: {
        'shooting/settings/colortemperature': {
          value: 5600,
          ability: { min: 2500, max: 10000, step: 100 },
        },
      },
    })
    const output = capture()

    await runCameraSettingsSet(
      { name: 'colortemperature', value: '5600', force: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const put = camera.requests.find((request) => request.method === 'PUT')
    // Sent as a number, not the string "5600".
    expect(put?.body).toBe('{"value":5600}')
    expect(output.json()).toMatchObject({ changed: true, requested: 5600 })
  })

  test('a non-numeric value for a range setting is rejected before connecting', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await expect(
      runCameraSettingsSet(
        { name: 'colortemperature', value: 'warm', force: true, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
      ),
    ).rejects.toThrow(/takes a number/)

    expect(camera.requests).toEqual([])
  })
})
