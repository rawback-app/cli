import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { CameraError } from './camera-errors.ts'

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Checked before connecting, so a refused overwrite costs no camera round-trip. */
export async function refuseOverwrite(
  target: string,
  overwrite: boolean | undefined,
): Promise<void> {
  if (overwrite !== true && (await exists(target))) {
    throw new CameraError(`${target} already exists; pass --overwrite to replace it.`)
  }
}

/** Writes a small binary body the camera returned whole, creating its directory. */
export async function saveBytes(target: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
}
