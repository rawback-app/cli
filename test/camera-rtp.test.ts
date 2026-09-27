import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runCameraRtpSdp,
  runCameraRtpStart,
  runCameraRtpStatus,
  runCameraRtpStop,
} from '../src/camera-rtp.ts'
import { cameraId, type StoredCamera } from '../src/camera-store.ts'
import { runCameraCert } from '../src/camera.ts'
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
  const directory = await mkdtemp(join(tmpdir(), 'rawback-rtp-'))
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

const ADVERTISED = [
  ...DEFAULT_SUFFIXES,
  'shooting/liveview/rtp',
  'shooting/liveview/rtpsessiondesc',
  'functions/ssl/cacert',
]

function saved(suffixes = ADVERTISED): StoredCamera {
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

const refuse = { confirm: async () => false, password: async () => '' }

describe('camera rtp', () => {
  test('start streams to the given address', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraRtpStart(
      { ip: '192.168.0.10', force: true, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    const post = camera.requests.find(
      (request) => request.method === 'POST' && request.path.endsWith('liveview/rtp'),
    )
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ action: 'start', ipaddress: '192.168.0.10' })
    expect(output.json()).toEqual({ started: true, ipaddress: '192.168.0.10' })
  })

  test('a refused start never reaches the camera', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()
    const output = capture()

    await runCameraRtpStart(
      { ip: '192.168.0.10', json: true },
      { store, processEnv: {}, fetch: camera.fetch, prompts: refuse, ...output.dependencies },
    )

    expect(camera.requests).toHaveLength(0)
    expect(output.json()).toEqual({ started: false })
  })

  test('stop sends a stop', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera()

    await runCameraRtpStop(
      { json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...capture().dependencies },
    )

    const post = camera.requests.find((request) => request.method === 'POST')
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ action: 'stop' })
  })

  test('status reports where the camera is streaming', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const camera = fakeCamera({
      routes: { 'shooting/liveview/rtp': { status: 'start', ipaddress: '192.168.0.10' } },
    })
    const output = capture()

    await runCameraRtpStatus(
      { json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({ status: 'start', ipaddress: '192.168.0.10' })
  })

  test('sdp saves the session description', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const sdp = 'v=0\r\nm=video 5004 RTP/AVP 96\r\n'
    const camera = fakeCamera({
      routes: {
        'shooting/liveview/rtpsessiondesc': () =>
          new Response(sdp, { headers: { 'content-type': 'application/sdp' } }),
      },
    })
    const output = capture()
    const target = join(directory, 'live.sdp')

    await runCameraRtpSdp(
      { output: target, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(await readFile(target, 'utf8')).toBe(sdp)
    expect(output.json()).toEqual({ output: target, bytes: sdp.length })
  })

  test('sdp refuses to replace a file before connecting', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const target = join(directory, 'live.sdp')
    await writeFile(target, 'mine')
    const camera = fakeCamera()

    await expect(
      runCameraRtpSdp(
        { output: target, json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...capture().dependencies },
      ),
    ).rejects.toThrow(/already exists; pass --overwrite/)
    expect(camera.requests).toHaveLength(0)
    expect(await readFile(target, 'utf8')).toBe('mine')
  })

  test('a body without RTP is refused by name', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(DEFAULT_SUFFIXES), { makeDefault: true })
    const camera = fakeCamera()

    await expect(
      runCameraRtpStatus(
        { json: true },
        { store, processEnv: {}, fetch: camera.fetch, ...capture().dependencies },
      ),
    ).rejects.toThrow(
      /does not advertise "shooting\/liveview\/rtp", which rawback camera rtp status/,
    )
  })
})

describe('camera cert', () => {
  test('saves a PEM certificate and says how to check it', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'
    const camera = fakeCamera({ routes: { 'functions/ssl/cacert': () => new Response(pem) } })
    const output = capture()
    const target = join(directory, 'camera.pem')

    await runCameraCert(
      { output: target },
      // Wide enough that the temporary path is never wrapped mid-command.
      { store, processEnv: {}, fetch: camera.fetch, columns: 400, ...output.dependencies },
    )

    expect(await readFile(target, 'utf8')).toBe(pem)
    const text = output.stdout.join('\n')
    expect(text).toContain('PEM')
    expect(text).toContain(`openssl x509 -in ${target} -noout -fingerprint -sha256`)
  })

  test('recognises a DER certificate', async () => {
    const { store } = await temporaryStore()
    await store.upsert(saved(), { makeDefault: true })
    const directory = await scratchDir()
    const der = new Uint8Array([0x30, 0x82, 0x01, 0x0a])
    const camera = fakeCamera({ routes: { 'functions/ssl/cacert': () => new Response(der) } })
    const output = capture()
    const target = join(directory, 'camera.cer')

    await runCameraCert(
      { output: target, json: true },
      { store, processEnv: {}, fetch: camera.fetch, ...output.dependencies },
    )

    expect(output.json()).toEqual({ output: target, bytes: 4, format: 'der' })
    expect(new Uint8Array(await readFile(target))).toEqual(der)
  })
})
