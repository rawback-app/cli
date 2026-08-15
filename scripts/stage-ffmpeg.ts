import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

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
 * cross-platform release matrix. Each entry below is an LGPL shared build
 * invoked as a separate process — the same posture that makes shipping exiftool
 * alongside a proprietary binary fine.
 */
const outputRoot = join(import.meta.dir, '..', '.release-artifacts', 'ffmpeg')

interface Target {
  /** GoReleaser's {{ .Os }} value, which names the staging directory. */
  platform: 'darwin' | 'linux' | 'windows'
  arch: 'arm64' | 'x64'
  url: string
  /** Path prefix to strip when unpacking, if the archive has a wrapper dir. */
  strip: number
  executables: string[]
}

const TARGETS: Target[] = [
  {
    arch: 'x64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'linux',
    strip: 1,
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  },
  {
    arch: 'arm64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'linux',
    strip: 1,
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
  },
  {
    arch: 'x64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'darwin',
    strip: 0,
    url: 'https://evermeet.cx/ffmpeg/getrelease/zip',
  },
  {
    arch: 'arm64',
    executables: ['ffmpeg', 'ffprobe'],
    platform: 'darwin',
    strip: 0,
    url: 'https://www.osxexperts.net/ffmpeg711arm.zip',
  },
  {
    arch: 'x64',
    executables: ['ffmpeg.exe', 'ffprobe.exe'],
    platform: 'windows',
    strip: 1,
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  },
]

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${String(response.status)}`)
  }
  await Bun.write(destination, response)
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stderr: 'inherit', stdout: 'inherit' })
  if ((await child.exited) !== 0) {
    throw new Error(`Command failed: ${command.join(' ')}`)
  }
}

async function stage(target: Target): Promise<void> {
  // GoReleaser maps one directory per {{ .Os }}. Both architectures of a
  // platform cannot share it, so the arch is a nested level and the archives
  // entry in .goreleaser.yaml selects with {{ .Arch }}.
  const destination = join(outputRoot, target.platform, target.arch)
  await mkdir(destination, { recursive: true })

  const isZip = target.url.endsWith('.zip') || target.url.endsWith('/zip')
  const archive = join(destination, isZip ? 'ffmpeg.zip' : 'ffmpeg.tar.xz')
  await download(target.url, archive)

  if (isZip) {
    await run(['unzip', '-o', '-j', archive, '-d', destination], destination)
  } else {
    await run(['tar', '-xf', archive, `--strip-components=${String(target.strip)}`], destination)
  }
  await rm(archive, { force: true })

  for (const executable of target.executables) {
    const path = join(destination, executable)
    if (!(await Bun.file(path).exists())) {
      throw new Error(`${executable} missing after unpacking ${target.url}`)
    }
    // Archive extraction does not always preserve the executable bit, and a
    // sidecar that cannot be spawned fails every video upload.
    await chmod(path, 0o755)
  }
}

await rm(outputRoot, { force: true, recursive: true })
for (const target of TARGETS) {
  await stage(target)
}
