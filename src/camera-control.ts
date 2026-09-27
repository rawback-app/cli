import { CameraError } from './camera-errors.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraSession,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import {
  clockDocument,
  ownerDocument,
  recordStatusDocument,
  zoomDocument,
  type OwnerView,
  type ZoomView,
} from './features/camera/view.ts'

/**
 * Asks before a command changes the camera, unless `--force`. Resolves `false`
 * when the user declines, after reporting that nothing changed.
 */
async function confirmChange(
  options: { force?: boolean; json?: boolean },
  dependencies: CameraCommandDependencies,
  question: string,
  declined: { json: Record<string, unknown>; message: string },
): Promise<boolean> {
  if (options.force === true) return true
  if (await cameraPrompts(dependencies).confirm(question)) return true
  const ui = commandOutput(dependencies)
  if (options.json === true) ui.json(declined.json)
  else ui.info(declined.message)
  return false
}

/** Reads an endpoint only when it is advertised; a failed read reports as absent. */
async function whenSupported<T>(
  session: CameraSession,
  suffix: string,
  read: () => Promise<T>,
): Promise<T | undefined> {
  if (!session.supports(suffix)) return undefined
  return read().catch(() => undefined)
}

// ── record ────────────────────────────────────────────────────────────────────

const REC_BUTTON = 'shooting/control/recbutton'
const MOVIE_MODE = 'shooting/control/moviemode'

export interface CameraRecordOptions extends CameraTargetOptions {
  action: 'start' | 'stop' | 'status'
  /** Switch a body with a movie-mode control into movie mode first. */
  movieMode?: boolean
  force?: boolean
}

export async function runCameraRecord(
  options: CameraRecordOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.action === 'status') {
    await withCameraSession(options, dependencies, async (session) => {
      const movieMode = await whenSupported(session, MOVIE_MODE, () =>
        session.client.shooting.getMovieMode(),
      )
      const recordable = await whenSupported(session, 'shooting/information/recordable', () =>
        session.client.shooting.getRecordable(),
      )
      const view = {
        movieMode: movieMode?.status,
        movieSeconds: recordable?.movieDuration,
      }
      if (options.json === true) {
        ui.json({ movieMode: view.movieMode ?? null, movieSeconds: view.movieSeconds ?? null })
        return
      }
      ui.document(recordStatusDocument(view))
    })
    return
  }

  const start = options.action === 'start'
  const proceed = await confirmChange(
    options,
    dependencies,
    start ? 'Start recording a movie on the camera?' : 'Stop the movie recording?',
    { json: { changed: false }, message: 'Left the recording as it was.' },
  )
  if (!proceed) return

  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(REC_BUTTON, `rawback camera record ${options.action}`)

    // Bodies with a movie-mode control only record once it is on.
    if (start && session.supports(MOVIE_MODE)) {
      const mode = await session.client.shooting.getMovieMode()
      if (mode.status === 'off') {
        if (options.movieMode !== true) {
          throw new CameraError(
            'The camera is not in movie mode. Pass --movie-mode to switch it first, or turn the mode dial to movie.',
          )
        }
        await session.client.shooting.setMovieMode('on')
      }
    }

    await session.client.shooting.pressRecButton(start ? 'start' : 'stop')
    if (options.json === true) {
      ui.json({ changed: true, recording: start })
      return
    }
    ui.success(start ? 'Recording started.' : 'Recording stopped.')
  })
}

// ── focus ─────────────────────────────────────────────────────────────────────

export interface CameraFocusOptions extends CameraTargetOptions {
  action: 'af' | 'stop' | 'near' | 'far'
  /** 1 (finest) to 3 (coarsest), for near and far. */
  steps?: number
  force?: boolean
}

export async function runCameraFocus(
  options: CameraFocusOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const drive = options.action === 'near' || options.action === 'far'
  const steps = options.steps ?? 1
  const describe = drive
    ? `Move focus ${options.action} (step ${steps})?`
    : options.action === 'af'
      ? 'Start autofocus on the camera?'
      : 'Stop autofocus on the camera?'

  const proceed = await confirmChange(options, dependencies, describe, {
    json: { changed: false },
    message: 'Left the focus as it was.',
  })
  if (!proceed) return

  await withCameraSession(options, dependencies, async (session) => {
    if (drive) {
      session.requireSupport(
        'shooting/control/drivefocus',
        `rawback camera focus ${options.action}`,
      )
      await session.client.shooting.driveFocus(`${options.action}${steps}`)
    } else {
      session.requireSupport('shooting/control/af', `rawback camera focus ${options.action}`)
      await session.client.shooting.performAF(options.action === 'af' ? 'start' : 'stop')
    }

    if (options.json === true) {
      ui.json({ changed: true, action: options.action, ...(drive ? { steps } : {}) })
      return
    }
    ui.success(
      drive
        ? `Moved focus ${options.action} by step ${steps}.`
        : options.action === 'af'
          ? 'Autofocus started.'
          : 'Autofocus stopped.',
    )
  })
}

// ── zoom ──────────────────────────────────────────────────────────────────────

const ZOOM = 'shooting/control/zoom'
const POWER_ZOOM = 'shooting/control/powerzoom'
export const POWER_ZOOM_ACTIONS = ['wide', 'tele', 'stop'] as const

export interface CameraZoomOptions extends CameraTargetOptions {
  /** A zoom position (PowerShot), or wide|tele|stop (Power Zoom Adapter). Absent reads. */
  value?: string
  force?: boolean
}

export async function runCameraZoom(
  options: CameraZoomOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.value === undefined) {
    await withCameraSession(options, dependencies, async (session) => {
      const zoom = await whenSupported(session, ZOOM, () => session.client.shooting.getZoom())
      const powerZoom = await whenSupported(session, POWER_ZOOM, () =>
        session.client.shooting.getPowerZoomControl(),
      )
      const adapter = await whenSupported(session, 'devicestatus/powerzoomstatus', () =>
        session.client.status.getPowerZoomStatus(),
      )
      const view: ZoomView = {
        ...(zoom !== undefined
          ? {
              zoom: {
                value: zoom.value ?? null,
                min: zoom.ability?.min ?? null,
                max: zoom.ability?.max ?? null,
                step: zoom.ability?.step ?? null,
              },
            }
          : {}),
        ...(powerZoom !== undefined
          ? { powerZoom: { value: powerZoom.value ?? null, ability: powerZoom.ability ?? [] } }
          : {}),
        ...(adapter !== undefined ? { adapter } : {}),
      }
      if (options.json === true) {
        ui.json({
          zoom: view.zoom ?? null,
          powerZoom: view.powerZoom ?? null,
          adapter: view.adapter ?? null,
        })
        return
      }
      ui.document(zoomDocument(view))
    })
    return
  }

  const value = options.value
  const drive = (POWER_ZOOM_ACTIONS as readonly string[]).includes(value)
  const position = drive ? undefined : Number(value)
  if (position !== undefined && (!Number.isSafeInteger(position) || position < 0)) {
    throw new CameraError(
      `zoom takes a position (a whole number) or ${POWER_ZOOM_ACTIONS.join('|')}; got ${value}`,
    )
  }

  const proceed = await confirmChange(
    options,
    dependencies,
    drive ? `Drive the power zoom ${value}?` : `Zoom the lens to position ${value}?`,
    { json: { changed: false }, message: 'Left the zoom as it was.' },
  )
  if (!proceed) return

  await withCameraSession(options, dependencies, async (session) => {
    if (position === undefined) {
      session.requireSupport(POWER_ZOOM, `rawback camera zoom ${value}`)
      const result = await session.client.shooting.setPowerZoom(value)
      if (options.json === true) {
        ui.json({ changed: true, powerZoom: result.value ?? value })
        return
      }
      ui.success(value === 'stop' ? 'Power zoom stopped.' : `Power zoom moving ${value}.`)
      return
    }

    session.requireSupport(ZOOM, 'rawback camera zoom <position>')
    const result = await session.client.shooting.setZoom(position)
    if (options.json === true) {
      ui.json({ changed: true, zoom: result.value ?? position })
      return
    }
    ui.success(`Zoom is now at ${result.value ?? position}.`)
  })
}

// ── clock ─────────────────────────────────────────────────────────────────────

const DATE_TIME = 'functions/datetime'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The camera's RFC 1123 form with a numeric offset, e.g.
 * `Tue, 01 Jan 2019 01:23:45 +0900` (doc 4.5.3): `date` as wall-clock time at
 * `offsetMinutes` east of UTC.
 */
export function cameraDateTime(date: Date, offsetMinutes: number): string {
  const local = new Date(date.getTime() + offsetMinutes * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const sign = offsetMinutes < 0 ? '-' : '+'
  const magnitude = Math.abs(offsetMinutes)
  return (
    `${WEEKDAYS[local.getUTCDay()]}, ${pad(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]} ` +
    `${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:` +
    `${pad(local.getUTCSeconds())} ${sign}${pad(Math.floor(magnitude / 60))}${pad(magnitude % 60)}`
  )
}

export interface CameraClockOptions extends CameraTargetOptions {
  sync?: boolean
  force?: boolean
}

export async function runCameraClock(
  options: CameraClockOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.sync !== true) {
    await withCameraSession(options, dependencies, async (session) => {
      session.requireSupport(DATE_TIME, 'rawback camera clock')
      const clock = await session.client.settings.getDateTime()
      if (options.json === true) {
        ui.json({ datetime: clock.datetime, dst: clock.dst })
        return
      }
      ui.document(clockDocument(clock))
    })
    return
  }

  const proceed = await confirmChange(
    options,
    dependencies,
    "Set the camera's clock to this computer's time?",
    { json: { synced: false }, message: "Left the camera's clock as it was." },
  )
  if (!proceed) return

  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport(DATE_TIME, 'rawback camera clock sync')
    const now = (dependencies.now ?? (() => new Date()))()
    // The full current offset, daylight saving included, with the camera's own
    // DST flag off: the string alone then names the instant, and the camera
    // cannot add a second hour on top of an offset that already has one.
    const datetime = cameraDateTime(now, -now.getTimezoneOffset())
    await session.client.settings.setDateTime(datetime, false)
    const readBack = await session.client.settings.getDateTime().catch(() => undefined)

    if (options.json === true) {
      ui.json({ synced: true, datetime, dst: false, camera: readBack ?? null })
      return
    }
    ui.success(`Set the camera's clock to ${readBack?.datetime ?? datetime}.`)
  })
}

// ── owner ─────────────────────────────────────────────────────────────────────

export const OWNER_FIELDS = ['copyright', 'author', 'owner-name', 'nickname'] as const
export type OwnerField = (typeof OWNER_FIELDS)[number]

/** Each field's endpoint and accessors (doc 4.5.1): copyright, author, owner, nickname. */
function ownerField(session: CameraSession, field: OwnerField) {
  const settings = session.client.settings
  switch (field) {
    case 'copyright':
      return {
        suffix: 'functions/registeredname/copyright',
        get: () => settings.getCopyright(),
        set: (value: string) => settings.setCopyright(value),
        clear: () => settings.deleteCopyright(),
      }
    case 'author':
      return {
        suffix: 'functions/registeredname/author',
        get: () => settings.getAuthor(),
        set: (value: string) => settings.setAuthor(value),
        clear: () => settings.deleteAuthor(),
      }
    case 'owner-name':
      return {
        suffix: 'functions/registeredname/ownername',
        get: () => settings.getOwnerName(),
        set: (value: string) => settings.setOwnerName(value),
        clear: () => settings.deleteOwnerName(),
      }
    case 'nickname':
      return {
        suffix: 'functions/registeredname/nickname',
        get: () => settings.getNickname(),
        set: (value: string) => settings.setNickname(value),
        clear: () => settings.deleteNickname(),
      }
  }
}

export interface CameraOwnerOptions extends CameraTargetOptions {
  action: 'show' | 'set' | 'clear'
  /** For set: the new values, keyed by field. */
  values?: Partial<Record<OwnerField, string>>
  /** For clear. */
  field?: OwnerField
  force?: boolean
}

export async function runCameraOwner(
  options: CameraOwnerOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.action === 'show') {
    await withCameraSession(options, dependencies, async (session) => {
      const view: OwnerView = { unsupported: [] }
      for (const field of OWNER_FIELDS) {
        const accessor = ownerField(session, field)
        if (!session.supports(accessor.suffix)) {
          view.unsupported.push(field)
          continue
        }
        const value = await accessor.get().catch(() => undefined)
        if (value !== undefined) view[field] = value
      }
      if (options.json === true) {
        ui.json({
          copyright: view.copyright ?? null,
          author: view.author ?? null,
          ownerName: view['owner-name'] ?? null,
          nickname: view.nickname ?? null,
          unsupported: view.unsupported,
        })
        return
      }
      ui.document(ownerDocument(view))
    })
    return
  }

  if (options.action === 'clear') {
    const field = options.field
    if (field === undefined) throw new CameraError('rawback camera owner clear needs a field')
    const proceed = await confirmChange(options, dependencies, `Clear the camera's ${field}?`, {
      json: { cleared: false },
      message: `Left the ${field} as it was.`,
    })
    if (!proceed) return

    await withCameraSession(options, dependencies, async (session) => {
      const accessor = ownerField(session, field)
      session.requireSupport(accessor.suffix, `rawback camera owner clear ${field}`)
      await accessor.clear()
      if (options.json === true) {
        ui.json({ cleared: true, field })
        return
      }
      ui.success(`Cleared the ${field}.`)
    })
    return
  }

  const entries = OWNER_FIELDS.flatMap((field) => {
    const value = options.values?.[field]
    return value !== undefined ? [[field, value] as const] : []
  })
  if (entries.length === 0) {
    throw new CameraError(
      'rawback camera owner set needs --copyright, --author, --owner-name or --nickname',
    )
  }

  const proceed = await confirmChange(
    options,
    dependencies,
    `Set the camera's ${entries.map(([field]) => field).join(', ')}?`,
    { json: { changed: [] }, message: 'Left the owner details as they were.' },
  )
  if (!proceed) return

  await withCameraSession(options, dependencies, async (session) => {
    // All refused up front, so an unsupported field never leaves a partial write.
    const accessors = entries.map(([field, value]) => {
      const accessor = ownerField(session, field)
      session.requireSupport(accessor.suffix, `rawback camera owner set --${field}`)
      return { field, value, accessor }
    })
    for (const { value, accessor } of accessors) await accessor.set(value)

    if (options.json === true) {
      ui.json({ changed: accessors.map(({ field }) => field) })
      return
    }
    ui.success(`Updated the ${accessors.map(({ field }) => field).join(', ')}.`)
  })
}
