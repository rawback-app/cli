import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Finds a sidecar binary staged next to the compiled executable.
 *
 * The realpath candidate matters for installs that put a symlink on PATH —
 * Homebrew, /usr/local/bin shims — where process.execPath is the link, not the
 * directory the release tarball unpacked into.
 */
async function findBundledBinary(
  directory: string,
  executable: string,
  execPath = process.execPath,
): Promise<string | undefined> {
  const candidates = [execPath, await realpath(execPath)].map((path) =>
    join(dirname(path), directory, executable),
  )
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}

export function findBundledExiftoolPath(): Promise<string | undefined> {
  return findBundledBinary('exiftool', process.platform === 'win32' ? 'exiftool.exe' : 'exiftool')
}

interface BundledVideoToolOptions {
  execPath?: string
  platform?: NodeJS.Platform
}

/** Finds the bundled fallback used for poster-frame and audio extraction. */
export function findBundledFfmpegPath(
  options: BundledVideoToolOptions = {},
): Promise<string | undefined> {
  return findBundledBinary(
    'ffmpeg',
    (options.platform ?? process.platform) === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    options.execPath,
  )
}

/** Finds the bundled fallback used to read video metadata before upload. */
export function findBundledFfprobePath(
  options: BundledVideoToolOptions = {},
): Promise<string | undefined> {
  return findBundledBinary(
    'ffmpeg',
    (options.platform ?? process.platform) === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    options.execPath,
  )
}
