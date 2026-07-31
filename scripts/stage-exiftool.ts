import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const outputRoot = join(import.meta.dir, '..', '.release-artifacts', 'exiftool')

async function installFor(os: NodeJS.Platform, cpu: 'arm64' | 'x64'): Promise<void> {
  const process = Bun.spawn(['bun', 'install', '--frozen-lockfile', `--os=${os}`, `--cpu=${cpu}`], {
    stderr: 'inherit',
    stdout: 'inherit',
  })
  if ((await process.exited) !== 0) throw new Error(`Unable to install dependencies for ${os}`)
}

async function stagePackage(packageName: string, platforms: string[], executable: string) {
  const source: unknown = (await import(packageName)).default
  if (typeof source !== 'string') {
    throw new Error(`${packageName} did not resolve to an executable path`)
  }
  for (const platform of platforms) {
    const destination = join(outputRoot, platform)
    await mkdir(destination, { recursive: true })
    await cp(dirname(source), destination, { recursive: true })
    if (source !== join(dirname(source), executable)) {
      await Bun.write(join(destination, executable), Bun.file(source))
    }
  }
}

const hostOS = process.platform
const hostCPU = process.arch === 'arm64' ? 'arm64' : 'x64'

await rm(outputRoot, { force: true, recursive: true })
try {
  await stagePackage('exiftool-vendored.pl', ['darwin', 'linux'], 'exiftool')
  await installFor('win32', 'x64')
  await stagePackage('exiftool-vendored.exe', ['windows'], 'exiftool.exe')
} finally {
  await installFor(hostOS, hostCPU)
}
