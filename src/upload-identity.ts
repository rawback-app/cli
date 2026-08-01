import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function findBundledExiftoolPath(): Promise<string | undefined> {
  const executable = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
  const candidates = [process.execPath, await realpath(process.execPath)].map((path) =>
    join(dirname(path), 'exiftool', executable),
  )
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}
