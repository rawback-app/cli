// The catalogue of CCAPI endpoints `rawback camera api` and the interactive
// explorer can invoke. Each entry is a declarative description that drives the
// argument parsing, the help listing, and the TUI's argument form alike — one
// module, two consumers, so a `--arg` invocation and a form submission cannot
// diverge.
//
// Ported from the reference TUI in the @rawback/ccapi-js repo, with three
// changes: `run` takes the CameraSession (so contents entries can default the
// ver140 `folder` segment and entries can be gated on `supports()`), every
// unsafe cast is replaced by a validating accessor, and the namespace order
// lists all nine namespaces (the reference lists six, so the rest sorted first).
//
// Binary and streaming endpoints are deliberately absent: they belong to the
// first-class commands (`contents get`, `liveview frame`, `liveview stream`),
// which can write to a file. This catalogue is a JSON inspector.

import { PICTURE_STYLES } from '@rawback/ccapi-js'
import type { ContentLocator, GPSInfo, PictureStyleName } from '@rawback/ccapi-js'

import { CameraError } from './camera-errors.ts'
import type { CameraSession } from './camera-session.ts'

export type Args = Record<string, unknown>

export type Param =
  | { name: string; kind: 'string'; required: boolean; placeholder?: string }
  | { name: string; kind: 'number'; required: boolean; placeholder?: string }
  | { name: string; kind: 'boolean'; required: false }
  | { name: string; kind: 'enum'; required: boolean; options: readonly string[] }
  | { name: string; kind: 'json'; required: boolean; placeholder?: string }

export interface ApiEntry {
  /** `<namespace>.<label>`, e.g. `status.getBattery`. */
  id: string
  namespace: string
  label: string
  /** CCAPI reference section, e.g. `4.4.4`. */
  doc: string
  /** Display-only HTTP verb. */
  method: string
  /** Changes camera state, so it is gated behind a confirmation. */
  mutates: boolean
  /** Exists, but is documented to misbehave on real hardware. */
  unreliable?: boolean
  /** Discovery suffix, so the runner can check `supports()` before calling. */
  suffix?: string
  params: readonly Param[]
  run(session: CameraSession, args: Args): Promise<unknown>
}

/** Doc order. Every namespace must appear, or it sorts ahead of the rest. */
export const NAMESPACE_ORDER = [
  'connection',
  'status',
  'settings',
  'network',
  'customization',
  'contents',
  'shooting',
  'liveview',
  'opticalViewfinder',
  'event',
] as const

// ── validating accessors ─────────────────────────────────────────────────────
// `parseArgs` has already coerced by `Param.kind`, so these are cheap
// re-narrowings — but they also make every thunk safe when the TUI form calls it.

export function argString(args: Args, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') throw new CameraError(`${key} must be a string`)
  return value
}

export function argOptionalString(args: Args, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new CameraError(`${key} must be a string`)
  return value
}

export function argNumber(args: Args, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CameraError(`${key} must be a number`)
  }
  return value
}

export function argBoolean(args: Args, key: string): boolean {
  return args[key] === true
}

export function argEnum<const T extends readonly string[]>(
  args: Args,
  key: string,
  options: T,
): T[number] {
  const value = args[key]
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new CameraError(`${key} must be one of: ${options.join(', ')}`)
  }
  return value
}

function argRecord(args: Args, key: string): Record<string, unknown> {
  const value = args[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CameraError(`${key} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

/**
 * The camera requires the full EXIF GPS block (doc 4.7.6) — a partial object is
 * rejected server-side, so it is checked here where the message can name the
 * missing field.
 */
function argGPSInfo(args: Args, key: string): GPSInfo {
  const record = argRecord(args, key)
  const strings = [
    'latitude_ref',
    'longitude_ref',
    'altitude_ref',
    'mapdatum',
    'status',
    'datestamp',
  ] as const
  const rationals = ['latitude', 'longitude', 'altitude', 'timestamp'] as const

  for (const field of strings) {
    if (typeof record[field] !== 'string') {
      throw new CameraError(`${key}.${field} must be a string`)
    }
  }
  for (const field of rationals) {
    const value = record[field]
    if (!Array.isArray(value) || value.some((part) => typeof part !== 'number')) {
      throw new CameraError(`${key}.${field} must be an array of numbers`)
    }
  }
  return record as unknown as GPSInfo
}

function argNumberRecord(args: Args, key: string): Record<string, number> {
  const record = argRecord(args, key)
  const result: Record<string, number> = {}
  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== 'number') throw new CameraError(`${key}.${name} must be a number`)
    result[name] = value
  }
  return result
}

function argPictureStyle(args: Args, key: string): PictureStyleName {
  return argEnum(args, key, PICTURE_STYLES) as PictureStyleName
}

// ── builders ─────────────────────────────────────────────────────────────────

function api(
  id: string,
  doc: string,
  method: string,
  params: readonly Param[],
  run: ApiEntry['run'],
  extra: { mutates?: boolean; unreliable?: boolean; suffix?: string } = {},
): ApiEntry {
  const dot = id.indexOf('.')
  return {
    id,
    namespace: id.slice(0, dot),
    label: id.slice(dot + 1),
    doc,
    method,
    mutates: extra.mutates ?? false,
    params,
    run,
    ...(extra.unreliable === true ? { unreliable: true } : {}),
    ...(extra.suffix !== undefined ? { suffix: extra.suffix } : {}),
  }
}

const STR = (name = 'value', required = true): Param => ({ name, kind: 'string', required })
const NUM = (name = 'value', required = true): Param => ({ name, kind: 'number', required })
const BOOL = (name: string): Param => ({ name, kind: 'boolean', required: false })
const ENUM = (name: string, options: readonly string[], required = true): Param => ({
  name,
  kind: 'enum',
  required,
  options,
})
const JSON_PARAM = (name: string, placeholder?: string): Param => ({
  name,
  kind: 'json',
  required: true,
  ...(placeholder !== undefined ? { placeholder } : {}),
})

/** A read-only GET paired with its single-string PUT companion. */
function valuePair(
  namespace: string,
  getLabel: string,
  setLabel: string,
  doc: string,
  get: (session: CameraSession) => Promise<unknown>,
  set: (session: CameraSession, value: string) => Promise<unknown>,
  suffix?: string,
): ApiEntry[] {
  const extra = suffix !== undefined ? { suffix } : {}
  return [
    api(`${namespace}.${getLabel}`, doc, 'GET', [], (session) => get(session), extra),
    api(
      `${namespace}.${setLabel}`,
      doc,
      'PUT',
      [STR()],
      (session, args) => set(session, argString(args, 'value')),
      { ...extra, mutates: true },
    ),
  ]
}

/** Content locators arrive as one opaque string; the folder segment is internal. */
const LOCATOR: Param = {
  name: 'locator',
  kind: 'string',
  required: true,
  placeholder: 'a locator printed by contents.listContents',
}

function locatorOf(args: Args): ContentLocator {
  const raw = argString(args, 'locator')
  const afterContents = raw.split('/contents/')[1] ?? raw.replace(/^\/+/, '')
  const segments = afterContents.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 4) {
    const [storage, folder, directory, file] = segments as [string, string, string, string]
    return { storage, folder, directory, file }
  }
  if (segments.length === 3) {
    const [storage, directory, file] = segments as [string, string, string]
    return { storage, directory, file }
  }
  throw new CameraError(`Not a content locator: ${JSON.stringify(raw)}`)
}

function folderOptions(session: CameraSession) {
  return session.folderSegment !== undefined ? { folder: session.folderSegment } : {}
}

// ── catalogue ────────────────────────────────────────────────────────────────

export const REGISTRY: readonly ApiEntry[] = [
  // Connection / discovery (doc 4.2–4.4)
  api(
    'connection.getDeviceInformation',
    '4.3.1',
    'GET',
    [],
    (s) => s.client.getDeviceInformation(),
    {
      suffix: 'deviceinformation',
    },
  ),
  api('connection.getStorage', '4.4.1', 'GET', [], (s) => s.client.getStorage(), {
    suffix: 'devicestatus/storage',
  }),
  api('connection.getLens', '4.4.6', 'GET', [], (s) => s.client.getLens(), {
    suffix: 'devicestatus/lens',
  }),
  api('connection.listSupportedAPIs', '4.2.1', 'GET', [], (s) => s.client.listSupportedAPIs()),
  api('connection.listSupportedAPIsForDev', '4.2.2', 'GET', [STR('version', false)], (s, a) =>
    s.client.listSupportedAPIsForDev(argOptionalString(a, 'version') ?? 'ver100'),
  ),

  // Camera status (doc 4.4) — read-only
  api('status.getCurrentStorage', '4.4.2', 'GET', [], (s) => s.client.status.getCurrentStorage(), {
    suffix: 'devicestatus/currentstorage',
  }),
  api(
    'status.getCurrentDirectory',
    '4.4.3',
    'GET',
    [],
    (s) => s.client.status.getCurrentDirectory(),
    { suffix: 'devicestatus/currentdirectory' },
  ),
  api('status.getBattery', '4.4.4', 'GET', [], (s) => s.client.status.getBattery(), {
    suffix: 'devicestatus/battery',
  }),
  api('status.getBatteryList', '4.4.5', 'GET', [], (s) => s.client.status.getBatteryList(), {
    suffix: 'devicestatus/batterylist',
  }),
  api('status.getTemperature', '4.4.7', 'GET', [], (s) => s.client.status.getTemperature(), {
    suffix: 'devicestatus/temperature',
  }),
  api(
    'status.getPowerZoomStatus',
    '4.4.8',
    'GET',
    [],
    (s) => s.client.status.getPowerZoomStatus(),
    { suffix: 'devicestatus/powerzoomstatus' },
  ),

  // Camera settings (doc 4.5) — registered names
  api('settings.getCopyright', '4.5.1', 'GET', [], (s) => s.client.settings.getCopyright()),
  api(
    'settings.setCopyright',
    '4.5.1',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setCopyright(argString(a, 'value')),
    { mutates: true },
  ),
  api(
    'settings.deleteCopyright',
    '4.5.1',
    'DELETE',
    [],
    (s) => s.client.settings.deleteCopyright(),
    {
      mutates: true,
    },
  ),
  api('settings.getAuthor', '4.5.2', 'GET', [], (s) => s.client.settings.getAuthor()),
  api(
    'settings.setAuthor',
    '4.5.2',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setAuthor(argString(a, 'value')),
    { mutates: true },
  ),
  api('settings.deleteAuthor', '4.5.2', 'DELETE', [], (s) => s.client.settings.deleteAuthor(), {
    mutates: true,
  }),
  api('settings.getOwnerName', '4.5.3', 'GET', [], (s) => s.client.settings.getOwnerName()),
  api(
    'settings.setOwnerName',
    '4.5.3',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setOwnerName(argString(a, 'value')),
    { mutates: true },
  ),
  api(
    'settings.deleteOwnerName',
    '4.5.3',
    'DELETE',
    [],
    (s) => s.client.settings.deleteOwnerName(),
    {
      mutates: true,
    },
  ),
  api('settings.getNickname', '4.5.4', 'GET', [], (s) => s.client.settings.getNickname()),
  api(
    'settings.setNickname',
    '4.5.4',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setNickname(argString(a, 'value')),
    { mutates: true },
  ),
  api('settings.deleteNickname', '4.5.4', 'DELETE', [], (s) => s.client.settings.deleteNickname(), {
    mutates: true,
  }),

  // Date/time, format, sensor cleaning, directories
  api('settings.getDateTime', '4.5.5', 'GET', [], (s) => s.client.settings.getDateTime(), {
    suffix: 'functions/datetime',
  }),
  api(
    'settings.setDateTime',
    '4.5.5',
    'PUT',
    [STR('datetime'), BOOL('dst')],
    (s, a) => s.client.settings.setDateTime(argString(a, 'datetime'), argBoolean(a, 'dst')),
    { mutates: true, suffix: 'functions/datetime' },
  ),
  api(
    'settings.formatCard',
    '4.5.6',
    'POST',
    [STR('name')],
    (s, a) => s.client.settings.formatCard(argString(a, 'name')),
    { mutates: true, suffix: 'functions/cardformat' },
  ),
  api(
    'settings.startSensorCleaning',
    '4.5.10',
    'POST',
    [BOOL('autopoweroff')],
    (s, a) => s.client.settings.startSensorCleaning(argBoolean(a, 'autopoweroff')),
    { mutates: true },
  ),
  api(
    'settings.createDirectory',
    '4.5.37',
    'POST',
    [STR('directoryName', false)],
    (s, a) => s.client.settings.createDirectory(argOptionalString(a, 'directoryName') ?? ''),
    { mutates: true },
  ),

  // Camera settings — value/ability pairs
  ...valuePair(
    'settings',
    'getBeep',
    'setBeep',
    '4.5.7',
    (s) => s.client.settings.getBeep(),
    (s, v) => s.client.settings.setBeep(v),
  ),
  ...valuePair(
    'settings',
    'getDisplayOff',
    'setDisplayOff',
    '4.5.8',
    (s) => s.client.settings.getDisplayOff(),
    (s, v) => s.client.settings.setDisplayOff(v),
  ),
  ...valuePair(
    'settings',
    'getAutoPowerOff',
    'setAutoPowerOff',
    '4.5.9',
    (s) => s.client.settings.getAutoPowerOff(),
    (s, v) => s.client.settings.setAutoPowerOff(v),
  ),
  ...valuePair(
    'settings',
    'getRecordFunctionsSeparate',
    'setRecordFunctionsSeparate',
    '4.5.27',
    (s) => s.client.settings.getRecordFunctionsSeparate(),
    (s, v) => s.client.settings.setRecordFunctionsSeparate(v),
  ),
  ...valuePair(
    'settings',
    'getStillImageRecordOptions',
    'setStillImageRecordOptions',
    '4.5.28',
    (s) => s.client.settings.getStillImageRecordOptions(),
    (s, v) => s.client.settings.setStillImageRecordOptions(v),
  ),
  ...valuePair(
    'settings',
    'getMovieRecordOptions',
    'setMovieRecordOptions',
    '4.5.29',
    (s) => s.client.settings.getMovieRecordOptions(),
    (s, v) => s.client.settings.setMovieRecordOptions(v),
  ),
  ...valuePair(
    'settings',
    'getStillImageCardSelection',
    'setStillImageCardSelection',
    '4.5.30',
    (s) => s.client.settings.getStillImageCardSelection(),
    (s, v) => s.client.settings.setStillImageCardSelection(v),
  ),
  ...valuePair(
    'settings',
    'getMovieCardSelection',
    'setMovieCardSelection',
    '4.5.31',
    (s) => s.client.settings.getMovieCardSelection(),
    (s, v) => s.client.settings.setMovieCardSelection(v),
  ),
  ...valuePair(
    'settings',
    'getFanMode',
    'setFanMode',
    '4.5.32',
    (s) => s.client.settings.getFanMode(),
    (s, v) => s.client.settings.setFanMode(v),
  ),
  ...valuePair(
    'settings',
    'getFanSpeed',
    'setFanSpeed',
    '4.5.33',
    (s) => s.client.settings.getFanSpeed(),
    (s, v) => s.client.settings.setFanSpeed(v),
  ),
  ...valuePair(
    'settings',
    'getScreenDimmer',
    'setScreenDimmer',
    '4.5.35',
    (s) => s.client.settings.getScreenDimmer(),
    (s, v) => s.client.settings.setScreenDimmer(v),
  ),
  ...valuePair(
    'settings',
    'getViewfinderOff',
    'setViewfinderOff',
    '4.5.36',
    (s) => s.client.settings.getViewfinderOff(),
    (s, v) => s.client.settings.setViewfinderOff(v),
  ),
  ...valuePair(
    'settings',
    'getDirectorySelection',
    'setDirectorySelection',
    '4.5.38',
    (s) => s.client.settings.getDirectorySelection(),
    (s, v) => s.client.settings.setDirectorySelection(v),
  ),
  ...valuePair(
    'settings',
    'getStillImageFileName',
    'setStillImageFileName',
    '4.5.39',
    (s) => s.client.settings.getStillImageFileName(),
    (s, v) => s.client.settings.setStillImageFileName(v),
  ),

  // File naming
  api('settings.getStillImageFileNameUserSetting1', '4.5.40', 'GET', [], (s) =>
    s.client.settings.getStillImageFileNameUserSetting1(),
  ),
  api(
    'settings.setStillImageFileNameUserSetting1',
    '4.5.40',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setStillImageFileNameUserSetting1(argString(a, 'value')),
    { mutates: true },
  ),
  api('settings.getStillImageFileNameUserSetting2', '4.5.41', 'GET', [], (s) =>
    s.client.settings.getStillImageFileNameUserSetting2(),
  ),
  api(
    'settings.setStillImageFileNameUserSetting2',
    '4.5.41',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setStillImageFileNameUserSetting2(argString(a, 'value')),
    { mutates: true },
  ),
  api('settings.getMovieFileNameIndex', '4.5.42', 'GET', [], (s) =>
    s.client.settings.getMovieFileNameIndex(),
  ),
  api(
    'settings.setMovieFileNameIndex',
    '4.5.42',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setMovieFileNameIndex(argString(a, 'value')),
    { mutates: true },
  ),
  api('settings.getMovieFileNameReelNumber', '4.5.43', 'GET', [], (s) =>
    s.client.settings.getMovieFileNameReelNumber(),
  ),
  api(
    'settings.setMovieFileNameReelNumber',
    '4.5.43',
    'PUT',
    [NUM()],
    (s, a) => s.client.settings.setMovieFileNameReelNumber(argNumber(a, 'value')),
    { mutates: true },
  ),
  api('settings.getMovieFileNameClipNumber', '4.5.44', 'GET', [], (s) =>
    s.client.settings.getMovieFileNameClipNumber(),
  ),
  api(
    'settings.setMovieFileNameClipNumber',
    '4.5.44',
    'PUT',
    [NUM()],
    (s, a) => s.client.settings.setMovieFileNameClipNumber(argNumber(a, 'value')),
    { mutates: true },
  ),
  api('settings.getMovieFileNameUserDefined', '4.5.45', 'GET', [], (s) =>
    s.client.settings.getMovieFileNameUserDefined(),
  ),
  api(
    'settings.setMovieFileNameUserDefined',
    '4.5.45',
    'PUT',
    [STR()],
    (s, a) => s.client.settings.setMovieFileNameUserDefined(argString(a, 'value')),
    { mutates: true },
  ),

  // Network settings (doc 4.5.11–4.5.34)
  api(
    'network.performNetworkConnection',
    '4.5.11',
    'POST',
    [ENUM('action', ['disconnect', 'reboot'])],
    (s, a) =>
      s.client.network.performNetworkConnection(argEnum(a, 'action', ['disconnect', 'reboot'])),
    { mutates: true },
  ),
  api('network.getNetworkSettingAPIs', '4.5.12', 'GET', [], (s) =>
    s.client.network.getNetworkSettingAPIs(),
  ),
  ...valuePair(
    'network',
    'getCurrentConnectionSetting',
    'setCurrentConnectionSetting',
    '4.5.13',
    (s) => s.client.network.getCurrentConnectionSetting(),
    (s, v) => s.client.network.setCurrentConnectionSetting(v),
  ),
  api('network.getConnectionSettings', '4.5.14', 'GET', [], async (s) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getConnectionSettings()
  }),
  api('network.getConnectionSetting', '4.5.15', 'GET', [STR('set')], async (s, a) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getConnectionSetting(argString(a, 'set'))
  }),
  api(
    'network.deleteConnectionSetting',
    '4.5.15',
    'DELETE',
    [STR('set')],
    async (s, a) => {
      await s.loadNetworkSettingAPIs()
      return s.client.network.deleteConnectionSetting(argString(a, 'set'))
    },
    { mutates: true },
  ),
  api('network.getCommSettings', '4.5.16', 'GET', [], async (s) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getCommSettings()
  }),
  api('network.getCommSetting', '4.5.17', 'GET', [STR('nw')], async (s, a) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getCommSetting(argString(a, 'nw'))
  }),
  api(
    'network.deleteCommSetting',
    '4.5.17',
    'DELETE',
    [STR('nw')],
    async (s, a) => {
      await s.loadNetworkSettingAPIs()
      return s.client.network.deleteCommSetting(argString(a, 'nw'))
    },
    { mutates: true },
  ),
  api('network.getFunctionSettings', '4.5.18', 'GET', [], async (s) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getFunctionSettings()
  }),
  api('network.getFunctionSetting', '4.5.19', 'GET', [STR('mode')], async (s, a) => {
    await s.loadNetworkSettingAPIs()
    return s.client.network.getFunctionSetting(argString(a, 'mode'))
  }),
  api(
    'network.deleteFunctionSetting',
    '4.5.19',
    'DELETE',
    [STR('mode')],
    async (s, a) => {
      await s.loadNetworkSettingAPIs()
      return s.client.network.deleteFunctionSetting(argString(a, 'mode'))
    },
    { mutates: true },
  ),
  api(
    'network.disconnectWiFi',
    '4.5.20',
    'POST',
    [STR('action', false)],
    (s, a) => s.client.network.disconnectWiFi(argOptionalString(a, 'action')),
    { mutates: true },
  ),
  api('network.getWiFiSettings', '4.5.21', 'GET', [], (s) => s.client.network.getWiFiSettings()),
  api('network.getWiFiSetting', '4.5.22', 'GET', [STR('setID')], (s, a) =>
    s.client.network.getWiFiSetting(argString(a, 'setID')),
  ),
  api(
    'network.deleteWiFiSetting',
    '4.5.22',
    'DELETE',
    [STR('setID')],
    (s, a) => s.client.network.deleteWiFiSetting(argString(a, 'setID')),
    { mutates: true },
  ),
  api('network.getServerCertCommonName', '4.5.24', 'GET', [], (s) =>
    s.client.network.getServerCertCommonName(),
  ),
  api(
    'network.setServerCertCommonName',
    '4.5.24',
    'PUT',
    [STR('commonName')],
    (s, a) => s.client.network.setServerCertCommonName(argString(a, 'commonName')),
    { mutates: true },
  ),
  api(
    'network.deleteServerCertCommonName',
    '4.5.24',
    'DELETE',
    [],
    (s) => s.client.network.deleteServerCertCommonName(),
    { mutates: true },
  ),
  ...valuePair(
    'network',
    'getCORSSetting',
    'setCORSSetting',
    '4.5.25',
    (s) => s.client.network.getCORSSetting(),
    (s, v) => s.client.network.setCORSSetting(v),
  ),
  api('network.getCORSOrigin', '4.5.26', 'GET', [], (s) => s.client.network.getCORSOrigin()),
  api(
    'network.setCORSOrigin',
    '4.5.26',
    'PUT',
    [STR('origin')],
    (s, a) => s.client.network.setCORSOrigin(argString(a, 'origin')),
    { mutates: true },
  ),
  api(
    'network.deleteCORSOrigin',
    '4.5.26',
    'DELETE',
    [],
    (s) => s.client.network.deleteCORSOrigin(),
    { mutates: true },
  ),
  api('network.getConnectSetting', '4.5.34', 'GET', [], (s) =>
    s.client.network.getConnectSetting(),
  ),
  api(
    'network.deleteConnectSetting',
    '4.5.34',
    'DELETE',
    [],
    (s) => s.client.network.deleteConnectSetting(),
    { mutates: true },
  ),

  // Customization (doc 4.6) — read-only
  api('customization.getApertureIncrement', '4.6.1', 'GET', [], (s) =>
    s.client.customization.getApertureIncrement(),
  ),
  api('customization.getShutterIncrement', '4.6.2', 'GET', [], (s) =>
    s.client.customization.getShutterIncrement(),
  ),
  api('customization.getExposureIncrement', '4.6.3', 'GET', [], (s) =>
    s.client.customization.getExposureIncrement(),
  ),
  api('customization.getFlashExposureIncrement', '4.6.4', 'GET', [], (s) =>
    s.client.customization.getFlashExposureIncrement(),
  ),
  api('customization.getISOIncrement', '4.6.5', 'GET', [], (s) =>
    s.client.customization.getISOIncrement(),
  ),

  // Contents (doc 4.7)
  api('contents.listStorages', '4.7.1', 'GET', [], (s) => s.client.contents.listStorages(), {
    suffix: 'contents',
  }),
  api('contents.listDirectories', '4.7.2', 'GET', [STR('storage')], (s, a) =>
    s.client.contents.listDirectories(argString(a, 'storage')),
  ),
  api(
    'contents.listContents',
    '4.7.3',
    'GET',
    [STR('storage'), STR('directory'), NUM('page', false)],
    (s, a) =>
      s.client.contents.listContents(argString(a, 'storage'), argString(a, 'directory'), {
        ...folderOptions(s),
        ...(a.page !== undefined ? { page: argNumber(a, 'page') } : {}),
      }),
  ),
  api('contents.getContentsNumber', '4.7.3', 'GET', [STR('storage'), STR('directory')], (s, a) =>
    s.client.contents.getContentsNumber(
      argString(a, 'storage'),
      argString(a, 'directory'),
      folderOptions(s),
    ),
  ),
  api('contents.getContentInfo', '4.7.5', 'GET', [LOCATOR], (s, a) =>
    s.client.contents.getContentInfo(locatorOf(a)),
  ),
  api(
    'contents.deleteDirectory',
    '4.7.4',
    'DELETE',
    [STR('storage'), STR('directory')],
    (s, a) =>
      s.client.contents.deleteDirectory(
        argString(a, 'storage'),
        argString(a, 'directory'),
        s.folderSegment,
      ),
    { mutates: true },
  ),
  api(
    'contents.rotateContent',
    '4.7.6',
    'PUT',
    [LOCATOR, ENUM('degrees', ['0', '90', '180', '270'])],
    (s, a) =>
      s.client.contents.rotateContent(
        locatorOf(a),
        Number(argEnum(a, 'degrees', ['0', '90', '180', '270'])),
      ),
    { mutates: true },
  ),
  api(
    'contents.setContentProtect',
    '4.7.6',
    'PUT',
    [LOCATOR, BOOL('enabled')],
    (s, a) => s.client.contents.setContentProtect(locatorOf(a), argBoolean(a, 'enabled')),
    { mutates: true },
  ),
  api(
    'contents.setContentArchive',
    '4.7.6',
    'PUT',
    [LOCATOR, BOOL('enabled')],
    (s, a) => s.client.contents.setContentArchive(locatorOf(a), argBoolean(a, 'enabled')),
    { mutates: true },
  ),
  api(
    'contents.setContentRating',
    '4.7.6',
    'PUT',
    [LOCATOR, ENUM('rating', ['off', '1', '2', '3', '4', '5'])],
    (s, a) =>
      s.client.contents.setContentRating(
        locatorOf(a),
        argEnum(a, 'rating', ['off', '1', '2', '3', '4', '5']),
      ),
    { mutates: true },
  ),
  api(
    'contents.setContentGPS',
    '4.7.6',
    'PUT',
    [LOCATOR, JSON_PARAM('gps', '{ "latitude": 35.6, "longitude": 139.7 }')],
    (s, a) => s.client.contents.setContentGPS(locatorOf(a), argGPSInfo(a, 'gps')),
    { mutates: true },
  ),
  api(
    'contents.deleteContent',
    '4.7.6',
    'DELETE',
    [LOCATOR],
    (s, a) => s.client.contents.deleteContent(locatorOf(a)),
    { mutates: true },
  ),

  // Shooting control (doc 4.8)
  api(
    'shooting.pressShutterButton',
    '4.8.1',
    'POST',
    [BOOL('af')],
    (s, a) => s.client.shooting.pressShutterButton(argBoolean(a, 'af')),
    { mutates: true, suffix: 'shooting/control/shutterbutton' },
  ),
  api(
    'shooting.pressShutterButtonManual',
    '4.8.2',
    'POST',
    [ENUM('action', ['half_press', 'full_press', 'release']), BOOL('af')],
    (s, a) =>
      s.client.shooting.pressShutterButtonManual(
        argEnum(a, 'action', ['half_press', 'full_press', 'release']),
        argBoolean(a, 'af'),
      ),
    { mutates: true, suffix: 'shooting/control/shutterbutton/manual' },
  ),
  api(
    'shooting.pressRecButton',
    '4.8.5',
    'POST',
    [ENUM('action', ['start', 'stop'])],
    (s, a) => s.client.shooting.pressRecButton(argEnum(a, 'action', ['start', 'stop'])),
    { mutates: true, suffix: 'shooting/control/recbutton' },
  ),
  api(
    'shooting.performAF',
    '4.8.6',
    'POST',
    [ENUM('action', ['start', 'stop'])],
    (s, a) => s.client.shooting.performAF(argEnum(a, 'action', ['start', 'stop'])),
    { mutates: true, suffix: 'shooting/control/af' },
  ),
  api(
    'shooting.driveFocus',
    '4.8.7',
    'POST',
    [ENUM('value', ['near1', 'near2', 'near3', 'far1', 'far2', 'far3'])],
    (s, a) =>
      s.client.shooting.driveFocus(
        argEnum(a, 'value', ['near1', 'near2', 'near3', 'far1', 'far2', 'far3']),
      ),
    { mutates: true },
  ),
  api('shooting.getMovieMode', '4.8.4', 'GET', [], (s) => s.client.shooting.getMovieMode(), {
    suffix: 'shooting/control/moviemode',
  }),
  api(
    'shooting.setMovieMode',
    '4.8.4',
    'POST',
    [ENUM('action', ['on', 'off'])],
    (s, a) => s.client.shooting.setMovieMode(argEnum(a, 'action', ['on', 'off'])),
    { mutates: true, suffix: 'shooting/control/moviemode' },
  ),
  api('shooting.getIgnoreShootingModeDialMode', '4.8.3', 'GET', [], (s) =>
    s.client.shooting.getIgnoreShootingModeDialMode(),
  ),
  api(
    'shooting.setIgnoreShootingModeDialMode',
    '4.8.3',
    'POST',
    [ENUM('action', ['on', 'off'])],
    (s, a) => s.client.shooting.setIgnoreShootingModeDialMode(argEnum(a, 'action', ['on', 'off'])),
    { mutates: true },
  ),
  api('shooting.getPowerZoomControl', '4.8.12', 'GET', [], (s) =>
    s.client.shooting.getPowerZoomControl(),
  ),
  api(
    'shooting.setPowerZoom',
    '4.8.12',
    'POST',
    [ENUM('value', ['stop', 'wide', 'tele'])],
    (s, a) => s.client.shooting.setPowerZoom(argEnum(a, 'value', ['stop', 'wide', 'tele'])),
    { mutates: true },
  ),
  api('shooting.getZoom', '4.8.6', 'GET', [], (s) => s.client.shooting.getZoom(), {
    suffix: 'shooting/control/zoom',
  }),
  api(
    'shooting.setZoom',
    '4.8.6',
    'POST',
    [NUM()],
    (s, a) => s.client.shooting.setZoom(argNumber(a, 'value')),
    { mutates: true, suffix: 'shooting/control/zoom' },
  ),
  api('shooting.detectFlicker', '4.8.9', 'POST', [], (s) => s.client.shooting.detectFlicker(), {
    mutates: true,
  }),
  api(
    'shooting.detectHFFlicker',
    '4.8.10',
    'POST',
    [ENUM('action', ['start', 'cancel']), BOOL('applyResult')],
    (s, a) =>
      s.client.shooting.detectHFFlicker(
        argEnum(a, 'action', ['start', 'cancel']),
        argBoolean(a, 'applyResult'),
      ),
    { mutates: true },
  ),
  api(
    'shooting.applyHFFlickerTv',
    '4.8.11',
    'POST',
    [ENUM('value', ['decrement_large', 'decrement_small', 'increment_small', 'increment_large'])],
    (s, a) =>
      s.client.shooting.applyHFFlickerTv(
        argEnum(a, 'value', [
          'decrement_large',
          'decrement_small',
          'increment_small',
          'increment_large',
        ]),
      ),
    { mutates: true },
  ),

  // Shooting settings (doc 4.9) — the generic mechanism reaches any setting
  api(
    'shooting.getShootingSettings',
    '4.9.1',
    'GET',
    [],
    (s) => s.client.shooting.getShootingSettings(),
    { suffix: 'shooting/settings' },
  ),
  api('shooting.getSetting', '4.9', 'GET', [STR('name')], (s, a) =>
    s.client.shooting.getSetting(argString(a, 'name')),
  ),
  api(
    'shooting.putSetting',
    '4.9',
    'PUT',
    [STR('name'), STR('value')],
    (s, a) => s.client.shooting.putSetting(argString(a, 'name'), argString(a, 'value')),
    { mutates: true },
  ),
  api('shooting.getIntSetting', '4.9', 'GET', [STR('name')], (s, a) =>
    s.client.shooting.getIntSetting(argString(a, 'name')),
  ),
  api(
    'shooting.putIntSetting',
    '4.9',
    'PUT',
    [STR('name'), NUM()],
    (s, a) => s.client.shooting.putIntSetting(argString(a, 'name'), argNumber(a, 'value')),
    { mutates: true },
  ),
  api('shooting.getRangeSetting', '4.9', 'GET', [STR('name')], (s, a) =>
    s.client.shooting.getRangeSetting(argString(a, 'name')),
  ),
  api(
    'shooting.deleteSetting',
    '4.9',
    'DELETE',
    [STR('name')],
    (s, a) => s.client.shooting.deleteSetting(argString(a, 'name')),
    { mutates: true },
  ),

  ...valuePair(
    'shooting',
    'getAperture',
    'setAperture',
    '4.9.6',
    (s) => s.client.shooting.getAperture(),
    (s, v) => s.client.shooting.setAperture(v),
  ),
  ...valuePair(
    'shooting',
    'getShutterSpeed',
    'setShutterSpeed',
    '4.9.7',
    (s) => s.client.shooting.getShutterSpeed(),
    (s, v) => s.client.shooting.setShutterSpeed(v),
  ),
  ...valuePair(
    'shooting',
    'getISO',
    'setISO',
    '4.9.8',
    (s) => s.client.shooting.getISO(),
    (s, v) => s.client.shooting.setISO(v),
  ),
  ...valuePair(
    'shooting',
    'getExposure',
    'setExposure',
    '4.9.9',
    (s) => s.client.shooting.getExposure(),
    (s, v) => s.client.shooting.setExposure(v),
  ),
  ...valuePair(
    'shooting',
    'getWhiteBalance',
    'setWhiteBalance',
    '4.9.10',
    (s) => s.client.shooting.getWhiteBalance(),
    (s, v) => s.client.shooting.setWhiteBalance(v),
  ),
  ...valuePair(
    'shooting',
    'getWhiteBalanceShift',
    'setWhiteBalanceShift',
    '4.9.14',
    (s) => s.client.shooting.getWhiteBalanceShift(),
    (s, v) => s.client.shooting.setWhiteBalanceShift(v),
  ),
  ...valuePair(
    'shooting',
    'getWhiteBalanceBracket',
    'setWhiteBalanceBracket',
    '4.9.15',
    (s) => s.client.shooting.getWhiteBalanceBracket(),
    (s, v) => s.client.shooting.setWhiteBalanceBracket(v),
  ),
  ...valuePair(
    'shooting',
    'getDriveMode',
    'setDriveMode',
    '4.9.16',
    (s) => s.client.shooting.getDriveMode(),
    (s, v) => s.client.shooting.setDriveMode(v),
  ),
  ...valuePair(
    'shooting',
    'getMetering',
    'setMetering',
    '4.9.17',
    (s) => s.client.shooting.getMetering(),
    (s, v) => s.client.shooting.setMetering(v),
  ),
  ...valuePair(
    'shooting',
    'getAEB',
    'setAEB',
    '4.9.18',
    (s) => s.client.shooting.getAEB(),
    (s, v) => s.client.shooting.setAEB(v),
  ),
  ...valuePair(
    'shooting',
    'getFlash',
    'setFlash',
    '4.9.19',
    (s) => s.client.shooting.getFlash(),
    (s, v) => s.client.shooting.setFlash(v),
  ),
  ...valuePair(
    'shooting',
    'getColorSpace',
    'setColorSpace',
    '4.9.20',
    (s) => s.client.shooting.getColorSpace(),
    (s, v) => s.client.shooting.setColorSpace(v),
  ),
  ...valuePair(
    'shooting',
    'getPictureStyle',
    'setPictureStyle',
    '4.9.21',
    (s) => s.client.shooting.getPictureStyle(),
    (s, v) => s.client.shooting.setPictureStyle(v),
  ),
  ...valuePair(
    'shooting',
    'getAFOperation',
    'setAFOperation',
    '4.9.22',
    (s) => s.client.shooting.getAFOperation(),
    (s, v) => s.client.shooting.setAFOperation(v),
  ),
  ...valuePair(
    'shooting',
    'getAFMethod',
    'setAFMethod',
    '4.9.23',
    (s) => s.client.shooting.getAFMethod(),
    (s, v) => s.client.shooting.setAFMethod(v),
  ),
  ...valuePair(
    'shooting',
    'getTrackingSetting',
    'setTrackingSetting',
    '4.9.24',
    (s) => s.client.shooting.getTrackingSetting(),
    (s, v) => s.client.shooting.setTrackingSetting(v),
  ),
  ...valuePair(
    'shooting',
    'getStillImageQuality',
    'setStillImageQuality',
    '4.9.25',
    (s) => s.client.shooting.getStillImageQuality(),
    (s, v) => s.client.shooting.setStillImageQuality(v),
  ),
  ...valuePair(
    'shooting',
    'getStillImageAspectRatio',
    'setStillImageAspectRatio',
    '4.9.26',
    (s) => s.client.shooting.getStillImageAspectRatio(),
    (s, v) => s.client.shooting.setStillImageAspectRatio(v),
  ),
  ...valuePair(
    'shooting',
    'getShootingMode',
    'setShootingMode',
    '4.9.2',
    (s) => s.client.shooting.getShootingMode(),
    (s, v) => s.client.shooting.setShootingMode(v),
  ),
  ...valuePair(
    'shooting',
    'getMovieRecordingMode',
    'setMovieRecordingMode',
    '4.9.3',
    (s) => s.client.shooting.getMovieRecordingMode(),
    (s, v) => s.client.shooting.setMovieRecordingMode(v),
  ),
  ...valuePair(
    'shooting',
    'getMovieFormat',
    'setMovieFormat',
    '4.9.27',
    (s) => s.client.shooting.getMovieFormat(),
    (s, v) => s.client.shooting.setMovieFormat(v),
  ),
  ...valuePair(
    'shooting',
    'getMovieQuality',
    'setMovieQuality',
    '4.9.28',
    (s) => s.client.shooting.getMovieQuality(),
    (s, v) => s.client.shooting.setMovieQuality(v),
  ),
  ...valuePair(
    'shooting',
    'getRecordingFrameRate',
    'setRecordingFrameRate',
    '4.9.29',
    (s) => s.client.shooting.getRecordingFrameRate(),
    (s, v) => s.client.shooting.setRecordingFrameRate(v),
  ),
  ...valuePair(
    'shooting',
    'getMovieCropping',
    'setMovieCropping',
    '4.9.30',
    (s) => s.client.shooting.getMovieCropping(),
    (s, v) => s.client.shooting.setMovieCropping(v),
  ),
  ...valuePair(
    'shooting',
    'getShutterMode',
    'setShutterMode',
    '4.9.31',
    (s) => s.client.shooting.getShutterMode(),
    (s, v) => s.client.shooting.setShutterMode(v),
  ),
  ...valuePair(
    'shooting',
    'getHDR',
    'setHDR',
    '4.9.32',
    (s) => s.client.shooting.getHDR(),
    (s, v) => s.client.shooting.setHDR(v),
  ),
  ...valuePair(
    'shooting',
    'getAntiFlickerShoot',
    'setAntiFlickerShoot',
    '4.9.33',
    (s) => s.client.shooting.getAntiFlickerShoot(),
    (s, v) => s.client.shooting.setAntiFlickerShoot(v),
  ),
  ...valuePair(
    'shooting',
    'getHFAntiFlickerShoot',
    'setHFAntiFlickerShoot',
    '4.9.34',
    (s) => s.client.shooting.getHFAntiFlickerShoot(),
    (s, v) => s.client.shooting.setHFAntiFlickerShoot(v),
  ),
  ...valuePair(
    'shooting',
    'getHFFlickerTvSetting',
    'setHFFlickerTvSetting',
    '4.9.35',
    (s) => s.client.shooting.getHFFlickerTvSetting(),
    (s, v) => s.client.shooting.setHFFlickerTvSetting(v),
  ),
  ...valuePair(
    'shooting',
    'getFocusBracketing',
    'setFocusBracketing',
    '4.9.49',
    (s) => s.client.shooting.getFocusBracketing(),
    (s, v) => s.client.shooting.setFocusBracketing(v),
  ),
  ...valuePair(
    'shooting',
    'getExposureSmoothing',
    'setExposureSmoothing',
    '4.9.52',
    (s) => s.client.shooting.getExposureSmoothing(),
    (s, v) => s.client.shooting.setExposureSmoothing(v),
  ),
  ...valuePair(
    'shooting',
    'getDepthComposite',
    'setDepthComposite',
    '4.9.53',
    (s) => s.client.shooting.getDepthComposite(),
    (s, v) => s.client.shooting.setDepthComposite(v),
  ),
  ...valuePair(
    'shooting',
    'getSoundRecording',
    'setSoundRecording',
    '4.9.63',
    (s) => s.client.shooting.getSoundRecording(),
    (s, v) => s.client.shooting.setSoundRecording(v),
  ),

  api(
    'shooting.setColorTemperature',
    '4.9.11',
    'PUT',
    [NUM()],
    (s, a) => s.client.shooting.setColorTemperature(argNumber(a, 'value')),
    { mutates: true },
  ),
  api('shooting.getPictureStyleDetail', '4.9.40', 'GET', [ENUM('style', PICTURE_STYLES)], (s, a) =>
    s.client.shooting.getPictureStyleDetail(argPictureStyle(a, 'style')),
  ),
  api(
    'shooting.setPictureStyleDetail',
    '4.9.40',
    'PUT',
    [
      ENUM('style', PICTURE_STYLES),
      JSON_PARAM('params', '{ "sharpness_strength": 4, "contrast": 1 } — snake_case keys'),
    ],
    (s, a) =>
      s.client.shooting.setPictureStyleDetail(
        argPictureStyle(a, 'style'),
        argNumberRecord(a, 'params'),
      ),
    { mutates: true },
  ),
  api(
    'shooting.resetPictureStyle',
    '4.9.40',
    'DELETE',
    [ENUM('style', PICTURE_STYLES)],
    (s, a) => s.client.shooting.resetPictureStyle(argPictureStyle(a, 'style')),
    { mutates: true },
  ),

  // Shooting information (doc 4.10)
  api('shooting.getRecordable', '4.10.1', 'GET', [], (s) => s.client.shooting.getRecordable(), {
    suffix: 'shooting/information/recordable',
  }),

  // Live view (doc 4.11) — JSON endpoints only; frames go through `camera liveview`
  api(
    'liveview.start',
    '4.11.1',
    'POST',
    [
      ENUM('liveviewsize', ['off', 'small', 'medium']),
      ENUM('cameradisplay', ['on', 'keep', 'off']),
    ],
    (s, a) =>
      s.client.liveview.start({
        liveviewsize: argEnum(a, 'liveviewsize', ['off', 'small', 'medium']),
        cameradisplay: argEnum(a, 'cameradisplay', ['on', 'keep', 'off']),
      }),
    { mutates: true, suffix: 'shooting/liveview' },
  ),
  api('liveview.stopMultipart', '4.11.4', 'DELETE', [], (s) => s.client.liveview.stopMultipart(), {
    mutates: true,
    suffix: 'shooting/liveview/multipart',
  }),
  api('liveview.getScroll', '4.11.5', 'GET', [], (s) => s.client.liveview.getScroll(), {
    unreliable: true,
  }),
  api('liveview.deleteScroll', '4.11.5', 'DELETE', [], (s) => s.client.liveview.deleteScroll(), {
    mutates: true,
  }),
  api('liveview.getScrollDetail', '4.11.6', 'GET', [], (s) => s.client.liveview.getScrollDetail(), {
    unreliable: true,
  }),
  api(
    'liveview.deleteScrollDetail',
    '4.11.6',
    'DELETE',
    [],
    (s) => s.client.liveview.deleteScrollDetail(),
    { mutates: true },
  ),
  api('liveview.getRTP', '4.11.8', 'GET', [], (s) => s.client.liveview.getRTP()),
  api(
    'liveview.setRTP',
    '4.11.8',
    'POST',
    [ENUM('action', ['start', 'stop']), STR('ipaddress', false)],
    (s, a) =>
      s.client.liveview.setRTP(
        argEnum(a, 'action', ['start', 'stop']),
        argOptionalString(a, 'ipaddress'),
      ),
    { mutates: true },
  ),
  api(
    'liveview.setAFFramePosition',
    '4.11.2',
    'PUT',
    [NUM('positionx'), NUM('positiony')],
    (s, a) =>
      s.client.liveview.setAFFramePosition(argNumber(a, 'positionx'), argNumber(a, 'positiony')),
    { mutates: true },
  ),
  api(
    'liveview.clickWB',
    '4.11.10',
    'POST',
    [NUM('positionx'), NUM('positiony')],
    (s, a) => s.client.liveview.clickWB(argNumber(a, 'positionx'), argNumber(a, 'positiony')),
    { mutates: true },
  ),
  api(
    'liveview.requestAngleInformation',
    '4.11.9',
    'POST',
    [],
    (s) => s.client.liveview.requestAngleInformation(),
    { mutates: true },
  ),

  // Optical viewfinder (doc 4.12 — EOS-1D X Mark III only)
  ...valuePair(
    'opticalViewfinder',
    'getAFAreaSelectionMode',
    'setAFAreaSelectionMode',
    '4.12.2',
    (s) => s.client.opticalViewfinder.getAFAreaSelectionMode(),
    (s, v) => s.client.opticalViewfinder.setAFAreaSelectionMode(v),
  ),
  ...valuePair(
    'opticalViewfinder',
    'getAFAreaSelection',
    'setAFAreaSelection',
    '4.12.3',
    (s) => s.client.opticalViewfinder.getAFAreaSelection(),
    (s, v) => s.client.opticalViewfinder.setAFAreaSelection(v),
  ),
  api('opticalViewfinder.getAFFrameInformation', '4.12.4', 'GET', [], (s) =>
    s.client.opticalViewfinder.getAFFrameInformation(),
  ),
  api('opticalViewfinder.getAFAreaInformation', '4.12.5', 'GET', [], (s) =>
    s.client.opticalViewfinder.getAFAreaInformation(),
  ),

  // Event (doc 4.13)
  api(
    'event.getPolling',
    '4.13.1',
    'GET',
    [BOOL('continue'), STR('timeout', false)],
    (s, a) =>
      s.client.event.getPolling({
        continue: argBoolean(a, 'continue'),
        ...(argOptionalString(a, 'timeout') !== undefined
          ? { timeout: argOptionalString(a, 'timeout') as string }
          : {}),
      }),
    { suffix: 'event/polling' },
  ),
  api('event.clearPolling', '4.13.1', 'DELETE', [], (s) => s.client.event.clearPolling(), {
    mutates: true,
    suffix: 'event/polling',
  }),
  api('event.stopMonitoring', '4.13.2', 'DELETE', [], (s) => s.client.event.stopMonitoring(), {
    mutates: true,
    suffix: 'event/monitoring',
  }),
]

const BY_ID = new Map(REGISTRY.map((entry) => [entry.id, entry]))

export function findEntry(id: string): ApiEntry {
  const entry = BY_ID.get(id)
  if (entry) return entry
  const near = REGISTRY.map((candidate) => candidate.id)
    .filter((candidate) => candidate.toLowerCase().includes(id.toLowerCase()))
    .slice(0, 5)
  throw new CameraError(
    `Unknown endpoint ${JSON.stringify(id)}.` +
      (near.length > 0
        ? ` Did you mean: ${near.join(', ')}?`
        : ' Run rawback camera api --list to see them all.'),
  )
}

export function listEntries(
  filter: { namespace?: string | undefined; mutating?: boolean | undefined } = {},
): ApiEntry[] {
  return REGISTRY.filter((entry) => {
    if (filter.namespace !== undefined && entry.namespace !== filter.namespace) return false
    if (filter.mutating !== undefined && entry.mutates !== filter.mutating) return false
    return true
  }).sort((left, right) => {
    const order =
      NAMESPACE_ORDER.indexOf(left.namespace as (typeof NAMESPACE_ORDER)[number]) -
      NAMESPACE_ORDER.indexOf(right.namespace as (typeof NAMESPACE_ORDER)[number])
    return order !== 0 ? order : left.label.localeCompare(right.label)
  })
}

/**
 * Turns repeated `--arg key=value` into the entry's argument object. Pure, so
 * it runs before any session is built — an unknown endpoint or a bad value
 * fails without touching the network.
 */
export function parseArgs(entry: ApiEntry, pairs: readonly string[]): Args {
  const args: Args = {}
  const seen = new Set<string>()

  for (const pair of pairs) {
    const split = pair.indexOf('=')
    if (split < 0) {
      throw new CameraError(`--arg must be key=value; got ${JSON.stringify(pair)}`)
    }
    const key = pair.slice(0, split)
    const raw = pair.slice(split + 1)
    if (key === '') throw new CameraError(`--arg is missing a name: ${JSON.stringify(pair)}`)
    // Last-wins would be a silent footgun in a script.
    if (seen.has(key)) throw new CameraError(`--arg ${key} was given more than once`)
    seen.add(key)

    const param = entry.params.find((candidate) => candidate.name === key)
    if (!param) {
      const expected = entry.params.map((candidate) => candidate.name)
      throw new CameraError(
        `${JSON.stringify(key)} is not a parameter of ${entry.id}.` +
          (expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : ' It takes no parameters.'),
      )
    }
    args[key] = coerce(entry, param, raw)
  }

  validateArgs(entry, args)
  return args
}

function coerce(entry: ApiEntry, param: Param, raw: string): unknown {
  switch (param.kind) {
    case 'string':
      return raw
    case 'number': {
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        throw new CameraError(
          `${entry.id} --arg ${param.name} must be a number; got ${JSON.stringify(raw)}`,
        )
      }
      return value
    }
    case 'boolean': {
      const normalized = raw.toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true
      if (['false', '0', 'no', 'off'].includes(normalized)) return false
      throw new CameraError(
        `${entry.id} --arg ${param.name} must be true or false; got ${JSON.stringify(raw)}`,
      )
    }
    case 'enum':
      if (!param.options.includes(raw)) {
        throw new CameraError(
          `${entry.id} --arg ${param.name} must be one of: ${param.options.join(', ')}`,
        )
      }
      return raw
    case 'json':
      try {
        return JSON.parse(raw)
      } catch (error) {
        throw new CameraError(
          `${entry.id} --arg ${param.name} must be JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
  }
}

/** Shared by `--arg` parsing and the interactive form, so the two cannot diverge. */
export function validateArgs(entry: ApiEntry, args: Args): void {
  for (const param of entry.params) {
    if (param.required && args[param.name] === undefined) {
      throw new CameraError(`${entry.id} requires --arg ${param.name}=<value>`)
    }
  }
}

export function describeParams(entry: ApiEntry): string {
  if (entry.params.length === 0) return '—'
  return entry.params
    .map((param) => {
      const type = param.kind === 'enum' ? param.options.join('|') : param.kind
      return param.required ? `${param.name}:${type}` : `[${param.name}:${type}]`
    })
    .join(' ')
}
