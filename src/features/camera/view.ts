import type { ConnectionSnapshot } from '@rawback/ccapi-js'

import { formatBytes } from '../../ui/format.ts'
import { cell, statusCell, type UiDocument, type UiField } from '../../ui/model.ts'

export interface SavedCameraRow {
  id: string
  name?: string
  host: string
  port: number
  useTLS: boolean
  insecure?: boolean
  username?: string
  passwordSaved: boolean
  model?: string
  lastUsedAt: string
  isDefault: boolean
}

const DASH = cell('—', { dim: true })

export function savedCameraListDocument(cameras: SavedCameraRow[]): UiDocument {
  return {
    title: 'Saved cameras',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No saved cameras. Run rawback camera connect <url> to add one.',
        columns: [
          { key: 'marker', label: '', required: true, priority: 1, maxWidth: 1 },
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'name', label: 'Name', priority: 2 },
          { key: 'scheme', label: 'Scheme', priority: 4 },
          { key: 'auth', label: 'Auth', priority: 3 },
          { key: 'lastUsed', label: 'Last used', priority: 5, minWidth: 10 },
        ],
        rows: cameras.map((camera) => ({
          marker: camera.isDefault ? cell('*', { tone: 'success' }) : '',
          id: camera.id,
          name: camera.name ?? camera.model ?? DASH,
          scheme: camera.useTLS
            ? cell(camera.insecure === true ? 'https (insecure)' : 'https', {
                tone: camera.insecure === true ? 'warning' : 'neutral',
              })
            : 'http',
          auth: describeAuth(camera),
          lastUsed: camera.lastUsedAt.slice(0, 10),
        })),
      },
      {
        type: 'text',
        text: '* marks the camera used when no --camera is given.',
        dim: true,
      },
    ],
  }
}

function describeAuth(camera: SavedCameraRow) {
  if (camera.username === undefined) return cell('none', { dim: true })
  return camera.passwordSaved
    ? cell(`${camera.username} (password saved)`, { tone: 'warning' })
    : `${camera.username}`
}

export function connectionDocument(
  snapshot: ConnectionSnapshot,
  extra: { id: string; isDefault: boolean; passwordSaved: boolean; endpointCount: number },
): UiDocument {
  const { device, lens } = snapshot
  const fields: UiField[] = [
    { label: 'Camera', value: device.productName ?? cell('unknown', { dim: true }) },
    { label: 'ID', value: extra.id },
    { label: 'Firmware', value: device.firmwareVersion ?? DASH },
    { label: 'Serial', value: device.serialNumber ?? DASH },
    { label: 'API version', value: snapshot.apiVersion },
    { label: 'Endpoints', value: String(extra.endpointCount) },
    { label: 'Lens', value: lens?.name ?? cell('none mounted', { dim: true }) },
    { label: 'Default', value: statusCell(extra.isDefault, 'yes') },
  ]
  if (extra.passwordSaved) {
    fields.push({ label: 'Password', value: cell('saved in cameras.json', { tone: 'warning' }) })
  }

  return {
    title: 'Connected',
    blocks: [
      { type: 'fields', fields },
      ...(snapshot.storage.length > 0 ? [storageBlock(snapshot)] : []),
    ],
  }
}

function storageBlock(snapshot: ConnectionSnapshot) {
  return {
    type: 'table' as const,
    columns: [
      { key: 'name', label: 'Card', required: true, priority: 1 },
      { key: 'access', label: 'Access', priority: 3 },
      { key: 'contents', label: 'Items', priority: 2 },
      { key: 'free', label: 'Free', priority: 2 },
      { key: 'size', label: 'Size', priority: 4 },
    ],
    rows: snapshot.storage.map((storage) => ({
      name: storage.name ?? '—',
      access: storage.accessCapability ?? '—',
      contents: storage.contentsNumber !== undefined ? String(storage.contentsNumber) : '—',
      free: storage.spaceSize !== undefined ? formatBytes(storage.spaceSize) : '—',
      size: storage.maxSize !== undefined ? formatBytes(storage.maxSize) : '—',
    })),
  }
}

export interface CameraInfoView {
  snapshot: ConnectionSnapshot
  dateTime?: string | undefined
}

export function cameraInfoDocument(view: CameraInfoView): UiDocument {
  const { device, lens } = view.snapshot
  return {
    title: device.productName ?? 'Camera',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'Manufacturer', value: device.manufacturer ?? DASH },
          { label: 'Model', value: device.productName ?? DASH },
          { label: 'Firmware', value: device.firmwareVersion ?? DASH },
          { label: 'Serial', value: device.serialNumber ?? DASH },
          { label: 'MAC address', value: device.macAddress ?? DASH },
          { label: 'API version', value: view.snapshot.apiVersion },
          { label: 'Lens', value: lens?.name ?? cell('none mounted', { dim: true }) },
          ...(view.dateTime !== undefined ? [{ label: 'Camera clock', value: view.dateTime }] : []),
        ],
      },
      ...(view.snapshot.storage.length > 0 ? [storageBlock(view.snapshot)] : []),
    ],
  }
}

export interface CameraStatusView {
  battery?:
    | {
        name?: string | undefined
        kind?: string | undefined
        level?: string | undefined
        quality?: string | undefined
      }
    | undefined
  temperature?: string | undefined
  currentStorage?: string | undefined
  currentDirectory?: string | undefined
  recordable?: { stillImages?: number | undefined; movieSeconds?: number | undefined } | undefined
  unsupported: string[]
}

export function cameraStatusDocument(view: CameraStatusView): UiDocument {
  const fields: UiField[] = [
    { label: 'Battery', value: batteryCell(view.battery) },
    { label: 'Temperature', value: temperatureCell(view.temperature) },
    { label: 'Recording to', value: view.currentStorage ?? DASH },
    { label: 'Directory', value: view.currentDirectory ?? DASH },
    {
      label: 'Stills left',
      value:
        view.recordable?.stillImages !== undefined ? String(view.recordable.stillImages) : DASH,
    },
    {
      label: 'Movie time left',
      value:
        view.recordable?.movieSeconds !== undefined
          ? formatSeconds(view.recordable.movieSeconds)
          : DASH,
    },
  ]

  return {
    title: 'Camera status',
    blocks: [
      { type: 'fields', fields },
      ...(view.unsupported.length > 0
        ? [
            {
              type: 'text' as const,
              text: `Not advertised by this camera: ${view.unsupported.join(', ')}`,
              dim: true,
            },
          ]
        : []),
    ],
  }
}

function batteryCell(battery: CameraStatusView['battery']) {
  if (battery === undefined) return DASH
  const level = battery.level ?? 'unknown'
  const tone =
    level === 'low' || level === 'empty'
      ? 'error'
      : level === 'quarter' || level === 'half'
        ? 'warning'
        : 'success'
  const suffix = battery.name !== undefined ? ` (${battery.name})` : ''
  return cell(`${level}${suffix}`, { tone })
}

function temperatureCell(temperature: string | undefined) {
  if (temperature === undefined) return DASH
  return cell(temperature, { tone: temperature === 'normal' ? 'success' : 'warning' })
}

export interface SettingRow {
  name: string
  value: string | null
  ability: string[] | null
}

export function settingsListDocument(settings: SettingRow[]): UiDocument {
  return {
    title: 'Shooting settings',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'The camera reported no shooting settings.',
        columns: [
          { key: 'name', label: 'Setting', required: true, priority: 1 },
          { key: 'value', label: 'Value', required: true, priority: 1 },
          { key: 'choices', label: 'Choices', priority: 4, maxWidth: 48 },
        ],
        rows: settings.map((setting) => ({
          name: setting.name,
          value: setting.value ?? DASH,
          choices:
            setting.ability && setting.ability.length > 0
              ? cell(setting.ability.join(', '), { dim: true })
              : DASH,
        })),
      },
      {
        type: 'text',
        text: 'Change one with rawback camera settings set <name> <value>.',
        dim: true,
      },
    ],
  }
}

export interface SettingView {
  name: string
  value: string | number | null
  ability: string[] | null
  range: { min: number | null; max: number | null; step: number | null } | null
}

export function settingDocument(setting: SettingView): UiDocument {
  const fields: UiField[] = [
    { label: 'Setting', value: setting.name },
    {
      label: 'Value',
      value: setting.value === null ? cell('locked', { tone: 'warning' }) : String(setting.value),
    },
  ]
  if (setting.range) {
    fields.push({
      label: 'Range',
      value:
        setting.range.min === null
          ? cell('locked', { tone: 'warning' })
          : `${setting.range.min}–${setting.range.max} step ${setting.range.step}`,
    })
  }
  if (setting.ability && setting.ability.length > 0) {
    fields.push({ label: 'Choices', value: cell(setting.ability.join(', '), { dim: true }) })
  }
  return { blocks: [{ type: 'fields', fields }] }
}

export interface ContentsListRow {
  locator: string
  name: string
}

export function contentsListDocument(
  rows: ContentsListRow[],
  pagination?: { page: number; pageSize: number; totalCount?: number; totalPages?: number },
): UiDocument {
  return {
    title: 'Contents',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No contents in that directory.',
        columns: [
          { key: 'name', label: 'File', required: true, priority: 1 },
          { key: 'locator', label: 'Locator', required: true, priority: 2 },
        ],
        rows: rows.map((row) => ({ name: row.name, locator: cell(row.locator, { dim: true }) })),
      },
      ...(pagination
        ? [
            {
              type: 'pagination' as const,
              page: pagination.page,
              pageSize: pagination.pageSize,
              count: rows.length,
              ...(pagination.totalCount !== undefined ? { totalCount: pagination.totalCount } : {}),
              ...(pagination.totalPages !== undefined ? { totalPages: pagination.totalPages } : {}),
            },
          ]
        : []),
      {
        type: 'text',
        text: 'Download one with rawback camera contents get <locator> --output <file>.',
        dim: true,
      },
    ],
  }
}

export function pathListDocument(
  title: string,
  label: string,
  paths: string[],
  emptyMessage: string,
): UiDocument {
  return {
    title,
    blocks: [
      {
        type: 'table',
        emptyMessage,
        columns: [{ key: 'path', label, required: true, priority: 1 }],
        rows: paths.map((path) => ({ path })),
      },
    ],
  }
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`
}
