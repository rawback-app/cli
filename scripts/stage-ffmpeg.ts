import { chmod, cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * Stages ffmpeg and ffprobe for every release target.
 *
 * The CLI needs them because the server never opens an uploaded video: the
 * container metadata, the poster frame and the split-out audio track are all
 * produced locally, and an upload without the metadata is rejected.
 *
 * These come from upstream release archives rather than an npm package, for the
 * reason the exiftool staging script does not have to worry about: ffmpeg-static
 * only ever downloads the *host* platform's binary, so it cannot fill a
 * cross-platform release matrix. Each entry below is an LGPL build invoked as a
 * separate process — the same posture that makes shipping exiftool alongside a
 * proprietary binary fine.
 *
 * Linux and Windows come from BtbN's builds because they are served by GitHub's
 * CDN. The personal web hosts that otherwise publish static ffmpeg builds are
 * the slowest thing in the release by an order of magnitude, and one of them
 * silently moved behind an anti-bot interstitial that answers every download
 * with a few kilobytes of HTML under a 200. macOS has no equivalent CDN-hosted
 * build, so it stays on the two established hosts — bounded by the timeout and
 * archive checks below rather than trusted.
 */
const outputRoot = join(import.meta.dir, '..', '.release-artifacts', 'ffmpeg')

/**
 * A release series rather than master, so a release never ships whatever
 * happened to be committed upstream that morning. The trailing number repeats
 * the series without its `n` prefix, which is how the assets are named.
 */
const SERIES = 'n9.0'

function btbn(platform: string, extension: string): string {
  return `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-${SERIES}-latest-${platform}-lgpl-${SERIES.slice(1)}.${extension}`
}

type ArchiveKind = 'xz' | 'zip'

interface Target {
  /** GoReleaser's {{ .Os }} value, which names the staging directory. */
  platform: 'darwin' | 'linux' | 'windows'
  arch: 'arm64' | 'x64'
  /** The macOS hosts publish one binary per archive, so this is a list. */
  urls: string[]
  executables: string[]
}

const TARGETS: Target[] = [
  {
    arch: 'x64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'linux',
    urls: [btbn('linux64', 'tar.xz')],
  },
  {
    arch: 'arm64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'linux',
    urls: [btbn('linuxarm64', 'tar.xz')],
  },
  {
    arch: 'x64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'darwin',
    urls: [
      'https://evermeet.cx/ffmpeg/getrelease/zip',
      'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
    ],
  },
  {
    arch: 'arm64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'darwin',
    urls: [
      'https://www.osxexperts.net/ffmpeg711arm.zip',
      'https://www.osxexperts.net/ffprobe711arm.zip',
    ],
  },
  {
    arch: 'x64',
    executables: ['ffmpeg.exe', 'ffprobe.exe'],
    platform: 'windows',
    urls: [btbn('win64', 'zip')],
  },
]

/**
 * A download is abandoned once it drops under 100KB/s for a minute, rather than
 * after a fixed wall-clock budget: the slow macOS hosts still get through at
 * their usual few MB/s, while a host that accepts the connection and then
 * never answers cannot burn the whole job. `fetch` has no notion of either,
 * which is how a stalled sidecar download once ran for seventeen minutes
 * before the runner killed it — and it streams these bodies to disk far more
 * slowly than curl does, which every runner and Mac already has.
 */
const STALL_BYTES_PER_SECOND = 100_000
const STALL_SECONDS = 60
const ATTEMPTS = 3
/** An interstitial or error page is a few kilobytes; every real build is tens of megabytes. */
const MINIMUM_ARCHIVE_BYTES = 1_000_000

const SIGNATURES: Record<ArchiveKind, number[]> = {
  xz: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
  zip: [0x50, 0x4b, 0x03, 0x04],
}

function archiveKind(url: string): ArchiveKind {
  return url.endsWith('.zip') || url.endsWith('/zip') ? 'zip' : 'xz'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A 200 is not proof the archive arrived. A host that has quietly put its
 * downloads behind an anti-bot interstitial answers every request with HTML,
 * which would otherwise only surface as an unreadable archive — or, worse, as a
 * released binary that cannot spawn ffmpeg.
 */
async function verify(path: string, url: string, kind: ArchiveKind): Promise<void> {
  const { size } = await stat(path)
  if (size < MINIMUM_ARCHIVE_BYTES) {
    throw new Error(`${url} returned only ${String(size)} bytes, not an archive`)
  }
  const signature = SIGNATURES[kind]
  const head = new Uint8Array(await Bun.file(path).slice(0, signature.length).arrayBuffer())
  if (signature.some((byte, index) => head[index] !== byte)) {
    throw new Error(`${url} did not return a ${kind} archive`)
  }
}

async function download(url: string, destination: string, kind: ArchiveKind): Promise<number> {
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await run(
        [
          'curl',
          '--fail',
          '--silent',
          '--show-error',
          '--location',
          '--speed-limit',
          String(STALL_BYTES_PER_SECOND),
          '--speed-time',
          String(STALL_SECONDS),
          '--output',
          destination,
          url,
        ],
        tmpdir(),
      )
      await verify(destination, url, kind)
      return (await stat(destination)).size
    } catch (error) {
      lastError = error
      await rm(destination, { force: true })
      if (attempt < ATTEMPTS) {
        console.warn(`  retrying ${url}: ${describe(error)}`)
        await Bun.sleep(attempt * 2_000)
      }
    }
  }
  throw new Error(`Failed to download ${url}: ${describe(lastError)}`)
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stderr: 'inherit', stdout: 'inherit' })
  if ((await child.exited) !== 0) {
    throw new Error(`Command failed: ${command.join(' ')}`)
  }
}

/**
 * The archives disagree on layout — BtbN nests the binaries under `bin/`, the
 * macOS hosts put a single binary at the root — so each one is located by name
 * instead of unpacked with a per-host `--strip-components`. Picking the
 * binaries out also leaves behind ffplay, the manpages and the API docs, which
 * together weigh more than everything the release actually ships.
 */
async function collect(from: string, executables: string[], into: string): Promise<void> {
  const entries = await readdir(from, { recursive: true })
  for (const executable of executables) {
    const match = entries.find(
      (entry) => basename(entry) === executable && !entry.includes('__MACOSX'),
    )
    if (!match) {
      throw new Error(`${executable} missing after unpacking`)
    }
    const path = join(into, executable)
    await cp(join(from, match), path)
    // Archive extraction does not always preserve the executable bit, and a
    // sidecar that cannot be spawned fails every video upload.
    await chmod(path, 0o755)
  }
}

async function stage(target: Target): Promise<void> {
  const label = `${target.platform}/${target.arch}`
  // GoReleaser maps one directory per {{ .Os }}. Both architectures of a
  // platform cannot share it, so the arch is a nested level and the archives
  // entry in .goreleaser.yaml selects with {{ .Arch }}.
  const destination = join(outputRoot, target.platform, target.arch)
  await mkdir(destination, { recursive: true })
  const scratch = await mkdtemp(join(tmpdir(), `rawback-ffmpeg-${target.platform}-${target.arch}-`))

  try {
    for (const url of target.urls) {
      const kind = archiveKind(url)
      const archive = join(scratch, `download.${kind}`)
      const startedAt = Date.now()
      const size = await download(url, archive, kind)
      const seconds = (Date.now() - startedAt) / 1_000
      console.log(
        `${label}: fetched ${url} (${(size / 1_000_000).toFixed(1)}MB in ${seconds.toFixed(1)}s)`,
      )
      await run(
        kind === 'zip' ? ['unzip', '-q', '-o', archive, '-d', scratch] : ['tar', '-xf', archive],
        scratch,
      )
      await rm(archive, { force: true })
    }
    await collect(scratch, target.executables, destination)
    console.log(`${label}: staged ${target.executables.join(' and ')}`)
  } finally {
    await rm(scratch, { force: true, recursive: true })
  }
}

await rm(outputRoot, { force: true, recursive: true })

// Every target is a different host, so they are fetched together — and settled
// rather than raced, so a nightly run reports every host that has rotted
// instead of only the first.
const results = await Promise.allSettled(TARGETS.map(stage))
const failures = results.filter((result) => result.status === 'rejected')

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(describe(failure.reason))
  }
  throw new Error(
    `Failed to stage ffmpeg for ${String(failures.length)} of ${String(TARGETS.length)} targets`,
  )
}
