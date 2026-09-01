import { CCAPIClient, CCAPIError, endpointLocation } from '@rawback/ccapi-js'
import type { ConnectionSnapshot, Credentials, SupportedAPIs } from '@rawback/ccapi-js'

import { toCameraError, CameraError, type CameraErrorContext } from './camera-errors.ts'
import { createCameraFetch } from './camera-fetch.ts'
import {
  CameraStore,
  cameraId,
  type CameraDiscoveryCache,
  type StoredCamera,
} from './camera-store.ts'
import { commandOutput } from './command.ts'
import type { ReadCommandDependencies } from './command.ts'
import type { CommandOutput } from './ui/output.tsx'

/** A cached discovery map older than this is re-read rather than trusted. */
const DISCOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** ver140 nests contents under an extra `folder` segment; earlier versions do not. */
const FOLDER_SEGMENT_VERSION = 'ver140'

export interface CameraTarget {
  host: string
  port: number
  useTLS: boolean
  insecure: boolean
  credentials?: Credentials
}

export interface CameraPrompts {
  confirm(message: string): Promise<boolean>
  password(message: string): Promise<string>
}

export interface CameraCommandDependencies extends ReadCommandDependencies {
  camerasPath?: string
  /** Injected `process.env`, so precedence tests need not mutate the real one. */
  processEnv?: Record<string, string | undefined>
  prompts?: CameraPrompts
  now?: () => Date
  store?: CameraStore
}

export interface CameraTargetOptions {
  /** A `camera connect` positional, which outranks every other source. */
  url?: string
  camera?: string
  insecure?: boolean
  timeout?: number
  refresh?: boolean
  json?: boolean
}

export const CAMERA_URL_ENV = 'RAWBACK_CAMERA_URL'

/**
 * Parses the connection string every camera command accepts.
 *
 * `URL` percent-decodes the userinfo, so a password containing `@` or `:` must
 * be percent-encoded (`%40`, `%3A`) — documented in docs/configuration.md.
 */
export function parseCameraUrl(input: string): Omit<CameraTarget, 'insecure'> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CameraError(
      `Not a valid camera URL: ${JSON.stringify(input)}. ` +
        'Expected something like http://user:password@192.168.0.1:8080',
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CameraError(
      `Unsupported scheme ${JSON.stringify(url.protocol.replace(':', ''))} in the camera URL — use http:// or https://`,
    )
  }
  if (!url.hostname) throw new CameraError('The camera URL is missing a host')

  const useTLS = url.protocol === 'https:'
  const port = url.port ? Number(url.port) : useTLS ? 443 : 80
  const credentials =
    url.username || url.password
      ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
      : undefined

  return { host: url.hostname, port, useTLS, ...(credentials !== undefined ? { credentials } : {}) }
}

export interface ResolvedTarget {
  target: CameraTarget
  saved: StoredCamera | undefined
}

/**
 * Resolution order: the `connect` positional, then `--camera`, then
 * `RAWBACK_CAMERA_URL`, then the saved default. A camera named explicitly still
 * picks up saved credentials when the URL omits them.
 */
export async function resolveCameraTarget(
  options: CameraTargetOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<ResolvedTarget> {
  const store = cameraStore(dependencies)
  // An exported-but-empty `RAWBACK_CAMERA_URL=` is a common shell-profile
  // shape and means "unset", not "connect to the empty string".
  const fromEnv = (dependencies.processEnv ?? process.env)[CAMERA_URL_ENV]?.trim()
  const named = options.url ?? options.camera ?? (fromEnv !== '' ? fromEnv : undefined)

  if (named === undefined) {
    const saved = await store.defaultCamera()
    if (!saved) {
      throw new CameraError(
        'No camera configured. Run rawback camera connect <url>, pass --camera <url>, ' +
          `or set ${CAMERA_URL_ENV}.`,
      )
    }
    return { target: targetFromSaved(saved, options), saved }
  }

  const parsed = parseCameraUrl(named)
  const saved = await store.find(cameraId(parsed.host, parsed.port))
  const credentials = parsed.credentials ?? savedCredentials(saved)

  return {
    target: {
      host: parsed.host,
      port: parsed.port,
      useTLS: parsed.useTLS,
      insecure: options.insecure ?? saved?.insecure ?? false,
      ...(credentials !== undefined ? { credentials } : {}),
    },
    saved,
  }
}

function targetFromSaved(saved: StoredCamera, options: CameraTargetOptions): CameraTarget {
  const credentials = savedCredentials(saved)
  return {
    host: saved.host,
    port: saved.port,
    useTLS: saved.useTLS,
    insecure: options.insecure ?? saved.insecure ?? false,
    ...(credentials !== undefined ? { credentials } : {}),
  }
}

function savedCredentials(saved: StoredCamera | undefined): Credentials | undefined {
  if (saved?.username === undefined) return undefined
  return { username: saved.username, password: saved.password ?? '' }
}

export function cameraStore(dependencies: CameraCommandDependencies): CameraStore {
  return dependencies.store ?? new CameraStore(dependencies.camerasPath)
}

export class CameraSession {
  readonly client: CCAPIClient
  readonly target: CameraTarget
  readonly output: CommandOutput

  /** Bumped so a stale cache can be replaced once, then trusted. */
  #suffixes: Set<string>
  #apiVersion: string
  #snapshot: ConnectionSnapshot | undefined
  #revalidated = false

  readonly #abort = new AbortController()
  readonly #cleanups: Array<() => Promise<void>> = []

  constructor(init: {
    client: CCAPIClient
    target: CameraTarget
    output: CommandOutput
    supportedAPIs: SupportedAPIs
    apiVersion: string
    snapshot?: ConnectionSnapshot
  }) {
    this.client = init.client
    this.target = init.target
    this.output = init.output
    this.#suffixes = suffixSet(init.supportedAPIs)
    this.#apiVersion = init.apiVersion
    this.#snapshot = init.snapshot
  }

  get apiVersion(): string {
    return this.#apiVersion
  }

  get snapshot(): ConnectionSnapshot | undefined {
    return this.#snapshot
  }

  get signal(): AbortSignal {
    return this.#abort.signal
  }

  /** ver140 inserts a `folder` segment into contents paths; earlier versions do not. */
  get folderSegment(): string | undefined {
    return this.#apiVersion >= FOLDER_SEGMENT_VERSION ? 'folder' : undefined
  }

  get errorContext(): CameraErrorContext {
    return {
      host: this.target.host,
      port: this.target.port,
      useTLS: this.target.useTLS,
      insecure: this.target.insecure,
      ...(this.#snapshot?.device.firmwareVersion !== undefined
        ? { firmwareVersion: this.#snapshot.device.firmwareVersion }
        : {}),
    }
  }

  /** Whether the camera advertises an endpoint suffix, from the discovery map. */
  supports(suffix: string): boolean {
    return this.#suffixes.has(normalizeSuffix(suffix))
  }

  /** Registers a camera-side release to run during teardown. */
  register(cleanup: () => Promise<void>): void {
    this.#cleanups.push(cleanup)
  }

  abort(): void {
    this.#abort.abort()
  }

  /**
   * Runs `operation`, and on a failure that a stale discovery map would explain,
   * re-reads discovery once and retries. A cached map is the difference between
   * two round-trips and six, but it also means a camera swapped onto the same
   * address would otherwise fail with a confusing `notActivated`.
   */
  async retryOnce<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (this.#revalidated || !isStaleCacheError(error)) throw error
      this.#revalidated = true
      await this.revalidate()
      return operation()
    }
  }

  async revalidate(): Promise<void> {
    const apis = await this.client.listSupportedAPIsForDev('ver100')
    this.#suffixes = suffixSet(apis)
    this.#apiVersion = highestVersion(apis) ?? this.#apiVersion
  }

  /**
   * The deep `networksetting/*` tables are not in the top-level discovery map,
   * so any command touching them must fold them in first (doc 4.5.12).
   */
  async loadNetworkSettingAPIs(): Promise<void> {
    const apis = await this.client.network.getNetworkSettingAPIs()
    for (const suffix of suffixSet(apis)) this.#suffixes.add(suffix)
  }

  /**
   * Releases camera-side resources. Deliberately uses a *fresh* signal: the
   * session's own signal is already aborted by the time teardown runs after a
   * Ctrl-C, and reusing it would cancel the very requests that free the camera,
   * leaving it locked against the next client.
   */
  async teardown(): Promise<void> {
    const cleanups = this.#cleanups.splice(0).reverse()
    for (const cleanup of cleanups) {
      await cleanup().catch(() => undefined)
    }
  }
}

/**
 * Builds a session, runs `operation`, and always tears down. Every networked
 * camera command goes through this.
 */
export async function withCameraSession<T>(
  options: CameraTargetOptions,
  dependencies: CameraCommandDependencies,
  operation: (session: CameraSession) => Promise<T>,
): Promise<T> {
  const ui = commandOutput(dependencies)
  const store = cameraStore(dependencies)
  const { target, saved } = await resolveCameraTarget(options, dependencies)
  await store.assertSecretPermissions()

  const cached = usableCache(saved, options, dependencies)
  const client = new CCAPIClient({
    host: target.host,
    port: target.port,
    useTLS: target.useTLS,
    fetch: createCameraFetch({ host: target.host, insecure: target.insecure }, dependencies.fetch),
    ...(target.credentials !== undefined ? { credentials: target.credentials } : {}),
    ...(options.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
    ...(cached !== undefined ? { supportedAPIs: cached.supportedAPIs } : {}),
  })

  const errorContext: CameraErrorContext = {
    host: target.host,
    port: target.port,
    useTLS: target.useTLS,
    insecure: target.insecure,
  }

  let session: CameraSession
  try {
    if (cached !== undefined) {
      session = new CameraSession({
        client,
        target,
        output: ui,
        supportedAPIs: cached.supportedAPIs,
        apiVersion: cached.apiVersion,
      })
    } else {
      const snapshot = await ui.withActivity(
        `Connecting to ${target.host}:${target.port}…`,
        () => client.connect(),
        options.json !== true,
      )
      const apis = await client.listSupportedAPIsForDev('ver100')
      session = new CameraSession({
        client,
        target,
        output: ui,
        supportedAPIs: apis,
        apiVersion: snapshot.apiVersion,
        snapshot,
      })
      await persist(store, target, saved, snapshot, apis, dependencies)
    }
  } catch (error) {
    throw toCameraError(error, errorContext)
  }

  try {
    return await session.retryOnce(() => operation(session))
  } catch (error) {
    throw toCameraError(error, { ...session.errorContext, ...suffixOfError(error) })
  } finally {
    await session.teardown()
  }
}

function usableCache(
  saved: StoredCamera | undefined,
  options: CameraTargetOptions,
  dependencies: CameraCommandDependencies,
): CameraDiscoveryCache | undefined {
  if (options.refresh === true) return undefined
  const discovery = saved?.discovery
  if (discovery === undefined) return undefined
  const now = (dependencies.now ?? (() => new Date()))().getTime()
  const cachedAt = Date.parse(discovery.cachedAt)
  if (!Number.isFinite(cachedAt) || now - cachedAt > DISCOVERY_TTL_MS) return undefined
  return discovery
}

async function persist(
  store: CameraStore,
  target: CameraTarget,
  saved: StoredCamera | undefined,
  snapshot: ConnectionSnapshot,
  apis: SupportedAPIs,
  dependencies: CameraCommandDependencies,
): Promise<void> {
  // Only remember cameras the user already chose to save; connect() does its own upsert.
  if (saved === undefined) return
  const now = (dependencies.now ?? (() => new Date()))().toISOString()
  await store.upsert({
    ...saved,
    host: target.host,
    port: target.port,
    useTLS: target.useTLS,
    insecure: target.insecure,
    lastUsedAt: now,
    ...(snapshot.device.productName !== undefined ? { model: snapshot.device.productName } : {}),
    discovery: buildDiscoveryCache(snapshot, apis, now),
  })
}

export function buildDiscoveryCache(
  snapshot: ConnectionSnapshot,
  apis: SupportedAPIs,
  cachedAt: string,
): CameraDiscoveryCache {
  return {
    apiVersion: snapshot.apiVersion,
    cachedAt,
    supportedAPIs: apis,
    ...(snapshot.device.firmwareVersion !== undefined
      ? { firmwareVersion: snapshot.device.firmwareVersion }
      : {}),
    ...(snapshot.device.serialNumber !== undefined
      ? { serialNumber: snapshot.device.serialNumber }
      : {}),
  }
}

/**
 * `notActivated` and `invalidRequest` are exactly the two failures a stale
 * discovery map produces, so they are the trigger to re-read it once.
 */
function isStaleCacheError(error: unknown): boolean {
  return (
    error instanceof CCAPIError &&
    (error.kind === 'notActivated' || error.kind === 'invalidRequest')
  )
}

function suffixOfError(error: unknown): { suffix?: string } {
  if (!(error instanceof CCAPIError) || error.kind !== 'notActivated') return {}
  const match = /ccapi\/ver\d+\/(.+)$/.exec(error.message)
  return match?.[1] !== undefined ? { suffix: match[1] } : {}
}

/** The endpoint suffixes a discovery map advertises, version stripped. */
export function suffixSet(apis: SupportedAPIs): Set<string> {
  const suffixes = new Set<string>()
  for (const endpoints of Object.values(apis)) {
    for (const endpoint of endpoints) {
      const location = endpointLocation(endpoint)
      if (location === undefined) continue
      const match = /ccapi\/ver\d+\/(.+)$/.exec(location)
      if (match?.[1] !== undefined) suffixes.add(normalizeSuffix(match[1]))
    }
  }
  return suffixes
}

function normalizeSuffix(suffix: string): string {
  return suffix.replace(/^\/+/, '').replace(/\/+$/, '')
}

export function highestVersion(apis: SupportedAPIs): string | undefined {
  return Object.keys(apis)
    .filter((key) => key.startsWith('ver'))
    .sort()
    .reverse()[0]
}
