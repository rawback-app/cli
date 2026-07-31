import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { zipSync } from 'fflate'

const artifactDirectory = join(import.meta.dir, '..', '.release-artifacts')
const archivePath = join(artifactDirectory, 'rawback_Windows_arm64.zip')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rawback-windows-arm64-'))
const executablePath = join(temporaryDirectory, 'rawback.exe')
const exiftoolPath = join(artifactDirectory, 'exiftool', 'windows', 'exiftool.exe')

try {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, '..', 'src', 'index.ts')],
    compile: {
      target: 'bun-windows-arm64',
      outfile: executablePath,
    },
    external: ['cpu-features'],
    minify: true,
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }

    throw new Error('Failed to build the Windows arm64 executable')
  }

  const executable = await Bun.file(executablePath).bytes()
  const exiftool = await Bun.file(exiftoolPath).bytes()
  const archive = zipSync(
    {
      'rawback.exe': executable,
      'exiftool/exiftool.exe': exiftool,
    },
    { level: 9 },
  )

  await Bun.write(archivePath, archive)
  console.log(`Created ${archivePath}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
