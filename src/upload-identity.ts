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
): Promise<string | undefined> {
  const candidates = [process.execPath, await realpath(process.execPath)].map((path) =>
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

/**
 * ffmpeg and ffprobe probe a video, cut its poster frame and split its audio
 * before upload. The server never opens the uploaded file, so without them an
 * upload has no metadata to declare and is rejected.
 */
export function findBundledFfmpegPath(): Promise<string | undefined> {
  return findBundledBinary('ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

export function findBundledFfprobePath(): Promise<string | undefined> {
  return findBundledBinary('ffmpeg', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}
