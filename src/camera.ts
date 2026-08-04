import type { ConnectionSnapshot } from '@rawback/ccapi-js'

import { CameraError } from './camera-errors.ts'
import { createCameraFetch } from './camera-fetch.ts'
import {
  buildDiscoveryCache,
  cameraStore,
  resolveCameraTarget,
  withCameraSession,
  type CameraCommandDependencies,
  type CameraSession,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraId, redactCamera, type StoredCamera } from './camera-store.ts'
import { commandOutput } from './command.ts'
import {
  cameraInfoDocument,
  cameraStatusDocument,
  connectionDocument,
  savedCameraListDocument,
  type CameraStatusView,
  type SavedCameraRow,
} from './features/camera/view.ts'

export type { CameraCommandDependencies } from './camera-session.ts'

export interface CameraConnectOptions extends CameraTargetOptions {
  name?: string
  savePassword?: boolean
  makeDefault?: boolean
}

/** Interactive prompts, injected so tests never reach a terminal. */
function defaultPrompts() {
  return {
    async confirm(message: string): Promise<boolean> {
      ensureInteractive('This command needs an interactive terminal unless --force is provided.')
      const { confirm } = await import('@inquirer/prompts')
      return confirm({ default: false, message })
    },
    async password(message: string): Promise<string> {
      ensureInteractive('Entering a camera password needs an interactive terminal.')
      const { password } = await import('@inquirer/prompts')
      return password({ mask: true, message })
    },
  }
}

function ensureInteractive(message: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CameraError(message)
}

export function cameraPrompts(dependencies: CameraCommandDependencies) {
  return dependencies.prompts ?? defaultPrompts()
}

function serializeSnapshot(snapshot: ConnectionSnapshot) {
  return {
    apiVersion: snapshot.apiVersion,
    device: {
      manufacturer: snapshot.device.manufacturer ?? null,
      productName: snapshot.device.productName ?? null,
      firmwareVersion: snapshot.device.firmwareVersion ?? null,
      serialNumber: snapshot.device.serialNumber ?? null,
      macAddress: snapshot.device.macAddress ?? null,
    },
    storage: snapshot.storage.map((storage) => ({
      name: storage.name ?? null,
      accessCapability: storage.accessCapability ?? null,
      maxSize: storage.maxSize ?? null,
      spaceSize: storage.spaceSize ?? null,
      contentsNumber: storage.contentsNumber ?? null,
    })),
    lens: snapshot.lens
      ? { name: snapshot.lens.name ?? null, mount: snapshot.lens.mount ?? null }
      : null,
  }
}

/**
 * Pairs with a camera and saves it. Unlike every other camera command this one
 * always performs a full connect: its whole job is to prove the target works
 * and to record what was discovered.
 */
export async function runCameraConnect(
  options: CameraConnectOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const store = cameraStore(dependencies)
  const { target, saved } = await resolveCameraTarget(options, dependencies)
  await store.assertSecretPermissions()

  const { CCAPIClient } = await import('@rawback/ccapi-js')
  const client = new CCAPIClient({
    host: target.host,
    port: target.port,
    useTLS: target.useTLS,
    fetch: createCameraFetch({ host: target.host, insecure: target.insecure }, dependencies.fetch),
    ...(target.credentials !== undefined ? { credentials: target.credentials } : {}),
    ...(options.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
  })

  const { toCameraError } = await import('./camera-errors.ts')
  const errorContext = { host: target.host, port: target.port, insecure: target.insecure }

  let snapshot: ConnectionSnapshot
  let apis
  try {
    snapshot = await ui.withActivity(
      `Connecting to ${target.host}:${target.port}…`,
      () => client.connect(),
      options.json !== true,
    )
    apis = await client.listSupportedAPIsForDev('ver100')
  } catch (error) {
    throw toCameraError(error, errorContext)
  }

  const id = cameraId(target.host, target.port)
  const now = (dependencies.now ?? (() => new Date()))().toISOString()
  const makeDefault = options.makeDefault !== false
  const entry: StoredCamera = {
    ...saved,
    id,
    host: target.host,
    port: target.port,
    useTLS: target.useTLS,
    insecure: target.insecure,
    lastUsedAt: now,
    discovery: buildDiscoveryCache(snapshot, apis, now),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(snapshot.device.productName !== undefined ? { model: snapshot.device.productName } : {}),
    ...(target.credentials !== undefined ? { username: target.credentials.username } : {}),
  }

  // A password only ever reaches disk on an explicit opt-in.
  if (options.savePassword === true && target.credentials !== undefined) {
    entry.password = target.credentials.password
  } else {
    delete entry.password
  }

  await store.upsert(entry, { makeDefault })

  const endpointCount = Object.values(apis).reduce((total, list) => total + list.length, 0)
  const passwordSaved = entry.password !== undefined

  if (passwordSaved) {
    ui.warning(
      `The camera password is stored in plain text in ${store.path}; keep that file private.`,
    )
  }

  if (options.json === true) {
    ui.json({
      id,
      host: target.host,
      port: target.port,
      useTLS: target.useTLS,
      insecure: target.insecure,
      name: entry.name ?? null,
      default: makeDefault,
      passwordSaved,
      endpointCount,
      connection: serializeSnapshot(snapshot),
    })
    return
  }

  ui.document(
    connectionDocument(snapshot, { id, isDefault: makeDefault, passwordSaved, endpointCount }),
  )
}

export async function runCameraList(
  options: { json?: boolean } = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const store = cameraStore(dependencies)
  const file = await store.read()
  const defaultId = (await store.defaultCamera())?.id

  if (options.json === true) {
    ui.json({
      default: defaultId ?? null,
      cameras: file.cameras.map((camera) => ({
        ...redactCamera(camera),
        // The cached map is large and uninteresting here; report only that it exists.
        discovery: camera.discovery
          ? { apiVersion: camera.discovery.apiVersion, cachedAt: camera.discovery.cachedAt }
          : null,
        default: camera.id === defaultId,
      })),
    })
    return
  }

  ui.document(
    savedCameraListDocument(
      file.cameras.map((camera): SavedCameraRow => {
        const redacted = redactCamera(camera)
        return {
          id: redacted.id,
          host: redacted.host,
          port: redacted.port,
          useTLS: redacted.useTLS,
          passwordSaved: redacted.passwordSaved,
          lastUsedAt: redacted.lastUsedAt,
          isDefault: camera.id === defaultId,
          ...(redacted.name !== undefined ? { name: redacted.name } : {}),
          ...(redacted.model !== undefined ? { model: redacted.model } : {}),
          ...(redacted.username !== undefined ? { username: redacted.username } : {}),
          ...(redacted.insecure !== undefined ? { insecure: redacted.insecure } : {}),
        }
      }),
    ),
  )
}

export async function runCameraUse(
  options: { id: string; json?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const store = cameraStore(dependencies)
  await store.setDefault(options.id)

  if (options.json === true) {
    ui.json({ default: options.id })
    return
  }
  ui.success(`rawback camera commands now target ${options.id}.`)
}

export async function runCameraForget(
  options: { id: string; force?: boolean; json?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const store = cameraStore(dependencies)
  const saved = await store.find(options.id)
  if (!saved) throw new CameraError(`No saved camera with ID ${options.id}`)

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `Forget ${saved.name ?? saved.id}${saved.password !== undefined ? ', including its saved password' : ''}?`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ forgotten: false, id: options.id })
      else ui.info('Left the saved camera in place.')
      return
    }
  }

  await store.forget(options.id)
  if (options.json === true) {
    ui.json({ forgotten: true, id: options.id })
    return
  }
  ui.success(`Forgot ${options.id}.`)
}

export async function runCameraInfo(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const snapshot = session.snapshot ?? (await session.client.connect())
    const dateTime = session.supports('functions/datetime')
      ? await session.client.settings.getDateTime().then(
          (value) => value.datetime,
          () => undefined,
        )
      : undefined

    if (options.json === true) {
      ui.json({
        ...serializeSnapshot(snapshot),
        dateTime: dateTime ?? null,
        target: {
          host: session.target.host,
          port: session.target.port,
          useTLS: session.target.useTLS,
        },
      })
      return
    }
    ui.document(cameraInfoDocument({ snapshot, dateTime }))
  })
}

/**
 * Reads every status endpoint the camera advertises. Anything it does not
 * advertise is reported as `null` and named in `unsupported`, rather than
 * failing the whole command on one missing endpoint.
 */
export async function runCameraStatus(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const unsupported: string[] = []

    const battery = await optional(session, 'devicestatus/battery', unsupported, () =>
      session.client.status.getBattery(),
    )
    const temperature = await optional(session, 'devicestatus/temperature', unsupported, () =>
      session.client.status.getTemperature(),
    )
    const currentStorage = await optional(session, 'devicestatus/currentstorage', unsupported, () =>
      session.client.status.getCurrentStorage(),
    )
    const currentDirectory = await optional(
      session,
      'devicestatus/currentdirectory',
      unsupported,
      () => session.client.status.getCurrentDirectory(),
    )
    const recordable = await optional(session, 'shooting/information/recordable', unsupported, () =>
      session.client.shooting.getRecordable(),
    )

    if (options.json === true) {
      ui.json({
        battery: battery ?? null,
        temperature: temperature?.status ?? null,
        currentStorage: currentStorage?.name ?? null,
        currentDirectory: currentDirectory?.name ?? null,
        recordable: recordable
          ? {
              stillImages: recordable.stillImage ?? null,
              movieSeconds: recordable.movieDuration ?? null,
            }
          : null,
        unsupported,
      })
      return
    }

    const view: CameraStatusView = {
      unsupported,
      ...(battery !== undefined ? { battery } : {}),
      ...(temperature !== undefined ? { temperature: temperature.status } : {}),
      ...(currentStorage !== undefined ? { currentStorage: currentStorage.name } : {}),
      ...(currentDirectory !== undefined ? { currentDirectory: currentDirectory.name } : {}),
      ...(recordable !== undefined
        ? {
            recordable: {
              ...(recordable.stillImage !== undefined
                ? { stillImages: recordable.stillImage }
                : {}),
              ...(recordable.movieDuration !== undefined
                ? { movieSeconds: recordable.movieDuration }
                : {}),
            },
          }
        : {}),
    }
    ui.document(cameraStatusDocument(view))
  })
}

/**
 * Reads an endpoint only when the camera advertises it, recording the ones it
 * does not. A camera that advertises an endpoint can still fail the call, so a
 * failure is also treated as "not available" rather than aborting the command.
 */
async function optional<T>(
  session: CameraSession,
  suffix: string,
  unsupported: string[],
  read: () => Promise<T>,
): Promise<T | undefined> {
  if (!session.supports(suffix)) {
    unsupported.push(suffix)
    return undefined
  }
  try {
    return await read()
  } catch {
    unsupported.push(suffix)
    return undefined
  }
}
