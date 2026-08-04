import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SupportedAPIs } from '@rawback/ccapi-js'

/**
 * Saved cameras live beside the other Rawback state in `~/.rawback/`, and the
 * file is **shared with Rawback Desktop** — both applications read and write it.
 * That rules out the desktop's previous `safeStorage` encryption, which only
 * Electron can decrypt, so the file is plain JSON kept at mode 0600. The same
 * trade already applies to `config.yml` (which holds the SFTP password) and
 * `credentials.json` (which holds the API tokens).
 */
export const DEFAULT_CAMERAS_PATH = join(homedir(), '.rawback', 'cameras.json')

/** Beyond this the list is just clutter; the least recently used entries fall off. */
const MAX_SAVED = 20

const FILE_VERSION = 1

export interface CameraDiscoveryCache {
  /** Highest version the camera serves, e.g. `ver140`. */
  apiVersion: string
  /** Identity the cache is keyed on — a change means a different body or firmware. */
  firmwareVersion?: string
  serialNumber?: string
  cachedAt: string
  supportedAPIs: SupportedAPIs
}

export interface StoredCamera {
  /** `host:port`. */
  id: string
  host: string
  port: number
  useTLS: boolean
  /** A remembered `--insecure`, so a self-signed camera is opted into once. */
  insecure?: boolean
  name?: string
  username?: string
  /** Only ever present when the user passed `--save-password`. */
  password?: string
  model?: string
  lastUsedAt: string
  discovery?: CameraDiscoveryCache
}

export interface CameraStoreFile {
  version: number
  default?: string
  cameras: StoredCamera[]
}

export class CameraStoreError extends Error {
  readonly path: string

  constructor(message: string, path: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CameraStoreError'
    this.path = path
  }
}

export function cameraId(host: string, port: number): string {
  return `${host}:${port}`
}

/**
 * The safe projection: everything except the password. Every command that
 * prints a camera goes through this, so a secret cannot reach stdout by
 * forgetting to strip it at a call site.
 */
export function redactCamera(camera: StoredCamera): Omit<StoredCamera, 'password'> & {
  passwordSaved: boolean
} {
  const { password, ...rest } = camera
  return { ...rest, passwordSaved: password !== undefined }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Tolerant by design: a file written by a newer build, or half-written by a
 * crash, degrades to "no cameras" rather than breaking every camera command.
 * The four fields below are the ones every consumer relies on; anything else is
 * carried through untouched.
 */
function isStoredCamera(value: unknown): value is StoredCamera {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    typeof value.useTLS === 'boolean'
  )
}

export class CameraStore {
  readonly path: string

  #cache: CameraStoreFile | undefined

  constructor(path = DEFAULT_CAMERAS_PATH) {
    this.path = path
  }

  async read(): Promise<CameraStoreFile> {
    if (this.#cache) return structuredClone(this.#cache)

    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) {
        this.#cache = { version: FILE_VERSION, cameras: [] }
        return structuredClone(this.#cache)
      }
      throw new CameraStoreError(`Unable to read saved cameras at ${this.path}`, this.path, {
        cause: error,
      })
    }

    this.#cache = parseStoreFile(raw)
    return structuredClone(this.#cache)
  }

  async list(): Promise<StoredCamera[]> {
    return (await this.read()).cameras
  }

  async find(id: string): Promise<StoredCamera | undefined> {
    return (await this.read()).cameras.find((camera) => camera.id === id)
  }

  /** The camera commands target when none is named: the explicit default, else the most recent. */
  async defaultCamera(): Promise<StoredCamera | undefined> {
    const file = await this.read()
    if (file.default !== undefined) {
      const named = file.cameras.find((camera) => camera.id === file.default)
      if (named) return named
    }
    return file.cameras[0]
  }

  /** Inserts or refreshes `camera`, moving it to the front of the MRU list. */
  async upsert(
    camera: StoredCamera,
    options: { makeDefault?: boolean } = {},
  ): Promise<CameraStoreFile> {
    const file = await this.read()
    const previous = file.cameras.find((existing) => existing.id === camera.id)
    const rest = file.cameras.filter((existing) => existing.id !== camera.id)
    // Preserve fields a newer build may have written that this one does not model.
    const merged = { ...previous, ...camera }
    const next: CameraStoreFile = {
      ...file,
      cameras: [merged, ...rest].slice(0, MAX_SAVED),
      ...(options.makeDefault === true ? { default: camera.id } : {}),
    }
    return this.#write(next)
  }

  async setDefault(id: string): Promise<CameraStoreFile> {
    const file = await this.read()
    if (!file.cameras.some((camera) => camera.id === id)) {
      throw new CameraStoreError(`No saved camera with ID ${id}`, this.path)
    }
    return this.#write({ ...file, default: id })
  }

  async forget(id: string): Promise<CameraStoreFile> {
    const file = await this.read()
    const cameras = file.cameras.filter((camera) => camera.id !== id)
    const next: CameraStoreFile = { ...file, cameras }
    // A dangling default would silently retarget every command at the wrong camera.
    if (file.default === id) delete next.default
    return this.#write(next)
  }

  /**
   * Rejects a group- or world-accessible file that holds a password, the same
   * guard the SDK applies to `config.yml`. A file with no saved password carries
   * no secret, so it is left alone.
   */
  async assertSecretPermissions(): Promise<void> {
    if (process.platform === 'win32') return
    const file = await this.read()
    if (!file.cameras.some((camera) => camera.password !== undefined)) return
    try {
      const information = await stat(this.path)
      if ((information.mode & 0o077) !== 0) {
        throw new CameraStoreError(
          `Saved cameras at ${this.path} contain a camera password and must not be accessible by group or others; run chmod 600 ${this.path}`,
          this.path,
        )
      }
    } catch (error) {
      if (isMissingFile(error)) return
      throw error
    }
  }

  async #write(file: CameraStoreFile): Promise<CameraStoreFile> {
    const directory = dirname(this.path)
    const temporaryPath = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`
    await mkdir(directory, { mode: 0o700, recursive: true })
    if (process.platform !== 'win32') await chmod(directory, 0o700)

    const body = `${JSON.stringify({ ...file, version: FILE_VERSION }, null, 2)}\n`
    try {
      await writeFile(temporaryPath, body, { flag: 'wx', mode: 0o600 })
      if (process.platform !== 'win32') await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, this.path)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw new CameraStoreError(`Unable to write saved cameras at ${this.path}`, this.path, {
        cause: error,
      })
    }

    this.#cache = file
    return structuredClone(file)
  }
}

function parseStoreFile(raw: string): CameraStoreFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: FILE_VERSION, cameras: [] }
  }
  if (!isRecord(parsed) || parsed.version !== FILE_VERSION || !Array.isArray(parsed.cameras)) {
    return { version: FILE_VERSION, cameras: [] }
  }
  const { cameras, ...rest } = parsed
  return {
    ...rest,
    version: FILE_VERSION,
    cameras: cameras.filter(isStoredCamera),
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}
