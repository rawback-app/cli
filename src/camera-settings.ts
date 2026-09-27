import { CameraError } from './camera-errors.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraSession,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import { settingDocument, settingsListDocument, type SettingRow } from './features/camera/view.ts'

/**
 * Settings whose `ability` is a `{ min, max, step }` range rather than a value
 * list (doc 4.9.10–4.9.13, 4.9.50–4.9.51, 4.9.64+). Reading these through the
 * list decoder would drop the range entirely and report the documented locked
 * `null` as `0`, so they go through `getRangeSetting`.
 */
const RANGE_SETTINGS = new Set([
  'colortemperature',
  'colortemperature2',
  'colortemperature3',
  'colortemperature4',
  'focusbracketing/numberofshots',
  'focusbracketing/focusincrement',
])

function isRangeSetting(name: string): boolean {
  return RANGE_SETTINGS.has(name) || name.startsWith('soundrecording/level/')
}

export interface CameraSettingView {
  name: string
  value: string | number | null
  ability: string[] | null
  range: SettingRow['range']
}

async function readSetting(session: CameraSession, name: string): Promise<CameraSettingView> {
  if (isRangeSetting(name)) {
    const setting = await session.client.shooting.getRangeSetting(name)
    return {
      name,
      value: setting.value ?? null,
      ability: null,
      range: {
        min: setting.ability?.min ?? null,
        max: setting.ability?.max ?? null,
        step: setting.ability?.step ?? null,
      },
    }
  }
  const setting = await session.client.shooting.getSetting(name)
  return { name, value: setting.value, ability: setting.ability ?? null, range: null }
}

/** Strings pass through; structured values (`stillimagequality`, `wbshift`) print as JSON. */
function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function rangeOf(ability: unknown): SettingRow['range'] {
  if (typeof ability !== 'object' || ability === null || Array.isArray(ability)) return null
  const { min, max, step } = ability as Record<string, unknown>
  if (typeof min !== 'number' && typeof max !== 'number') return null
  return {
    min: typeof min === 'number' ? min : null,
    max: typeof max === 'number' ? max : null,
    step: typeof step === 'number' ? step : null,
  }
}

/** One aggregate entry, shaped like the GET of its own endpoint: `{ value, ability }`. */
function listRow(name: string, setting: unknown): SettingRow {
  const entry =
    typeof setting === 'object' && !Array.isArray(setting)
      ? (setting as { value?: unknown; ability?: unknown })
      : { value: setting }
  const value = entry.value
  return {
    name,
    value: value === undefined || value === null ? null : display(value),
    ability: Array.isArray(entry.ability) ? entry.ability.map(display) : null,
    range: rangeOf(entry.ability),
  }
}

export async function runCameraSettingsList(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    // The undecoded aggregate, not `getShootingSettings()`: that one renames
    // keys to camelCase (`shootingMode`), which `settings get`/`set` would then
    // send as a path the camera does not have, and it drops every setting it
    // does not model. Keyed by the camera's own names, every row round-trips.
    const settings = await session.client.shooting.getShootingSettingsRaw()

    const rows = Object.entries(settings)
      .filter(([, setting]) => setting !== undefined && setting !== null)
      .map(([name, setting]) => listRow(name, setting))
      .sort((left, right) => left.name.localeCompare(right.name))

    if (options.json === true) {
      ui.json({ settings: rows })
      return
    }
    ui.document(settingsListDocument(rows))
  })
}

export async function runCameraSettingsGet(
  options: CameraTargetOptions & { name: string },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const setting = await readSetting(session, options.name)
    if (options.json === true) {
      ui.json(setting)
      return
    }
    ui.document(settingDocument(setting))
  })
}

export async function runCameraSettingsSet(
  options: CameraTargetOptions & { name: string; value: string; int?: boolean; force?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const numeric = options.int === true || isRangeSetting(options.name)
  let parsed: number | undefined
  if (numeric) {
    parsed = Number(options.value)
    if (!Number.isFinite(parsed)) {
      throw new CameraError(`${options.name} takes a number; got ${JSON.stringify(options.value)}`)
    }
  }

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `Set ${options.name} to ${options.value} on the camera?`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ changed: false, name: options.name })
      else ui.info('Left the setting unchanged.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    if (parsed !== undefined) {
      await session.client.shooting.putIntSetting(options.name, parsed)
    } else {
      await session.client.shooting.putSetting(options.name, options.value)
    }

    // Read back so the caller sees what the camera actually accepted rather
    // than an echo of the request.
    const setting = await readSetting(session, options.name).catch(() => undefined)

    if (options.json === true) {
      ui.json({
        changed: true,
        name: options.name,
        requested: parsed ?? options.value,
        value: setting?.value ?? null,
      })
      return
    }
    ui.success(`${options.name} is now ${String(setting?.value ?? options.value)}.`)
  })
}
