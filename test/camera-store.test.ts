import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CameraStore,
  CameraStoreError,
  cameraId,
  redactCamera,
  type StoredCamera,
} from '../src/camera-store.ts'

const temporaryDirectories: string[] = []

async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-cameras-'))
  temporaryDirectories.push(directory)
  return join(directory, '.rawback', 'cameras.json')
}

function camera(overrides: Partial<StoredCamera> = {}): StoredCamera {
  return {
    id: cameraId('192.168.0.1', 8080),
    host: '192.168.0.1',
    port: 8080,
    useTLS: false,
    lastUsedAt: '2026-08-04T09:00:00.000Z',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('camera store', () => {
  test('reads an empty store when the file does not exist', async () => {
    const store = new CameraStore(await storePath())

    expect(await store.list()).toEqual([])
    expect(await store.defaultCamera()).toBeUndefined()
  })

  test('round-trips a camera and marks it the default', async () => {
    const path = await storePath()
    const store = new CameraStore(path)

    await store.upsert(camera({ name: 'Canon EOS R6m2' }), { makeDefault: true })

    const reread = new CameraStore(path)
    expect(await reread.list()).toHaveLength(1)
    expect((await reread.defaultCamera())?.name).toBe('Canon EOS R6m2')
  })

  test('moves an existing camera to the front and merges its fields', async () => {
    const store = new CameraStore(await storePath())
    await store.upsert(camera({ username: 'ccapi', password: 'secret' }))
    await store.upsert(camera({ id: 'other:8080', host: 'other', port: 8080, useTLS: false }))

    const file = await store.upsert(camera({ model: 'Canon EOS R6m2' }))

    expect(file.cameras[0]?.id).toBe('192.168.0.1:8080')
    expect(file.cameras[0]?.model).toBe('Canon EOS R6m2')
    // Fields the caller did not supply survive the update.
    expect(file.cameras[0]?.username).toBe('ccapi')
    expect(file.cameras[0]?.password).toBe('secret')
  })

  test('caps the list at twenty cameras', async () => {
    const store = new CameraStore(await storePath())
    for (let index = 0; index < 25; index += 1) {
      await store.upsert(camera({ id: `10.0.0.${index}:8080`, host: `10.0.0.${index}` }))
    }

    const cameras = await store.list()
    expect(cameras).toHaveLength(20)
    // Most recent first, oldest dropped.
    expect(cameras[0]?.id).toBe('10.0.0.24:8080')
    expect(cameras.some((entry) => entry.id === '10.0.0.0:8080')).toBe(false)
  })

  test('forgetting the default clears the dangling pointer', async () => {
    const store = new CameraStore(await storePath())
    await store.upsert(camera({ id: 'a:8080', host: 'a' }))
    await store.upsert(camera({ id: 'b:8080', host: 'b' }), { makeDefault: true })

    const file = await store.forget('b:8080')

    expect(file.default).toBeUndefined()
    expect(file.cameras.map((entry) => entry.id)).toEqual(['a:8080'])
    // Falls back to the most recent rather than reporting nothing.
    expect((await store.defaultCamera())?.id).toBe('a:8080')
  })

  test('setDefault rejects an unknown camera', async () => {
    const store = new CameraStore(await storePath())

    await expect(store.setDefault('missing:8080')).rejects.toThrow(CameraStoreError)
  })

  test('preserves fields written by a newer build', async () => {
    const path = await storePath()
    const store = new CameraStore(path)
    await store.upsert(camera())

    // Simulate the desktop, or a later CLI, adding keys this build does not model.
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const cameras = raw.cameras as Array<Record<string, unknown>>
    cameras[0] = { ...cameras[0], futureField: 'keep me' }
    await writeFile(path, JSON.stringify({ ...raw, futureTopLevel: 42, cameras }, null, 2))

    const reopened = new CameraStore(path)
    await reopened.upsert(camera({ model: 'Canon EOS R6m2' }))

    const after = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(after.futureTopLevel).toBe(42)
    expect((after.cameras as Array<Record<string, unknown>>)[0]?.futureField).toBe('keep me')
  })

  test.each([
    ['not json at all', 'reads as empty'],
    ['{"version":99,"cameras":[{"id":"a:1"}]}', 'ignores an unknown version'],
    ['{"version":1,"cameras":"nope"}', 'ignores a malformed camera list'],
  ])('tolerates a damaged file (%s)', async (contents) => {
    const path = await storePath()
    const store = new CameraStore(path)
    await store.upsert(camera())
    await writeFile(path, contents)

    expect(await new CameraStore(path).list()).toEqual([])
  })

  test('drops entries missing the fields every consumer relies on', async () => {
    const path = await storePath()
    const store = new CameraStore(path)
    await store.upsert(camera())
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        cameras: [{ id: 'good:8080', host: 'good', port: 8080, useTLS: false }, { id: 'bad' }],
      }),
    )

    const cameras = await new CameraStore(path).list()
    expect(cameras.map((entry) => entry.id)).toEqual(['good:8080'])
  })

  test('redactCamera never exposes the password', () => {
    const redacted = redactCamera(camera({ username: 'ccapi', password: 'secret' }))

    expect(JSON.stringify(redacted)).not.toContain('secret')
    expect(redacted.passwordSaved).toBe(true)
    expect(redactCamera(camera()).passwordSaved).toBe(false)
  })

  test.skipIf(process.platform === 'win32')(
    'writes the file 0600 and the directory 0700',
    async () => {
      const path = await storePath()
      const store = new CameraStore(path)
      await store.upsert(camera())

      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
    },
  )

  test('leaves no temporary file behind', async () => {
    const path = await storePath()
    const store = new CameraStore(path)
    await store.upsert(camera())

    const entries = await readdir(join(path, '..'))
    expect(entries).toEqual(['cameras.json'])
  })

  test.skipIf(process.platform === 'win32')(
    'rejects a group-readable file that holds a password',
    async () => {
      const path = await storePath()
      const store = new CameraStore(path)
      await store.upsert(camera({ password: 'secret' }))
      await chmod(path, 0o644)

      await expect(new CameraStore(path).assertSecretPermissions()).rejects.toThrow(
        /must not be accessible by group or others/,
      )
    },
  )

  test.skipIf(process.platform === 'win32')(
    'allows a group-readable file that holds no password',
    async () => {
      const path = await storePath()
      const store = new CameraStore(path)
      await store.upsert(camera())
      await chmod(path, 0o644)

      await expect(new CameraStore(path).assertSecretPermissions()).resolves.toBeUndefined()
    },
  )
})

/**
 * `~/.rawback/cameras.json` is shared with the Rawback desktop app, so the file
 * format is a contract between two codebases. These use a byte-for-byte copy of
 * what the desktop's CameraConnectionStore writes.
 */
describe('cross-app compatibility with Rawback Desktop', () => {
  test('reads a file the desktop wrote', async () => {
    const path = await storePath()
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    await writeFile(
      path,
      JSON.stringify(
        {
          version: 1,
          cameras: [
            {
              id: '192.168.1.2:8080',
              host: '192.168.1.2',
              port: 8080,
              useTLS: false,
              username: 'ccapi',
              model: 'EOS R6',
              lastUsedAt: '2026-08-04T17:26:36.393Z',
            },
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )

    const cameras = await new CameraStore(path).list()
    expect(cameras).toHaveLength(1)
    expect(cameras[0]).toMatchObject({
      id: '192.168.1.2:8080',
      host: '192.168.1.2',
      port: 8080,
      useTLS: false,
      username: 'ccapi',
      model: 'EOS R6',
    })
  })

  test('writes the fields the desktop validator requires', async () => {
    const path = await storePath()
    await new CameraStore(path).upsert(camera({ model: 'Canon EOS R6m2' }), { makeDefault: true })

    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(written.version).toBe(1)
    const entry = (written.cameras as Array<Record<string, unknown>>)[0]
    // The desktop's isStoredConnection() checks exactly these four.
    expect(typeof entry?.id).toBe('string')
    expect(typeof entry?.host).toBe('string')
    expect(typeof entry?.port).toBe('number')
    expect(typeof entry?.useTLS).toBe('boolean')
  })
})
