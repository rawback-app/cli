import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const installer =
  process.platform === 'win32'
    ? Bun.fileURLToPath(new URL('../install.ps1', import.meta.url))
    : Bun.fileURLToPath(new URL('../install.sh', import.meta.url))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

async function createFixture(options: { validChecksum: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'rawback-installer-test-'))
  temporaryDirectories.push(root)

  const payloadDirectory = join(root, 'payload')
  const installDirectory = join(root, 'install')

  const assetOs =
    process.platform === 'darwin' ? 'Darwin' : process.platform === 'win32' ? 'Windows' : 'Linux'
  const assetArch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const binaryName = process.platform === 'win32' ? 'rawback.exe' : 'rawback'
  const archiveName = `rawback_${assetOs}_${assetArch}.${extension}`
  const archivePath = join(root, archiveName)
  const payloadBinary = join(payloadDirectory, binaryName)

  if (process.platform === 'win32') {
    await Bun.write(payloadBinary, Bun.file(process.execPath))
    await Bun.write(join(payloadDirectory, 'exiftool', 'exiftool.exe'), Bun.file(process.execPath))
  } else {
    await Bun.write(payloadBinary, '#!/bin/sh\necho 9.9.9\n')
    await chmod(payloadBinary, 0o755)
    const exiftool = join(payloadDirectory, 'exiftool', 'exiftool')
    await Bun.write(exiftool, '#!/bin/sh\n')
    await chmod(exiftool, 0o755)
  }

  const archiveResult =
    process.platform === 'win32'
      ? Bun.spawnSync([
          'tar',
          '-a',
          '-cf',
          archivePath,
          '-C',
          payloadDirectory,
          binaryName,
          'exiftool',
        ])
      : Bun.spawnSync(['tar', '-czf', archivePath, '-C', payloadDirectory, binaryName, 'exiftool'])
  expect(archiveResult.exitCode).toBe(0)

  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await Bun.file(archivePath).arrayBuffer())
  const checksum = options.validChecksum ? hasher.digest('hex') : '0'.repeat(64)
  const checksums = `${checksum}  ${archiveName}\n`

  const server = Bun.serve({
    port: 0,
    routes: {
      [`/${archiveName}`]: new Response(Bun.file(archivePath)),
      '/checksums.txt': new Response(checksums),
    },
  })

  return {
    binaryName,
    installDirectory,
    releaseBaseUrl: `http://127.0.0.1:${server.port}`,
    root,
    server,
  }
}

async function runInstaller(
  releaseBaseUrl: string,
  installDirectory: string,
  path = process.env.PATH,
) {
  const env = {
    ...process.env,
    PATH: path,
    RAWBACK_INSTALL_DIR: installDirectory,
    RAWBACK_RELEASE_BASE_URL: releaseBaseUrl,
  }
  const command =
    process.platform === 'win32'
      ? ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer]
      : ['sh', installer]

  const child = Bun.spawn(command, {
    env,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stderr, stdout }
}

describe('release installers', () => {
  test('verifies, replaces, and installs the platform archive', async () => {
    const fixture = await createFixture({ validChecksum: true })
    const target = join(fixture.installDirectory, fixture.binaryName)
    await Bun.write(target, 'stale')

    try {
      const result = await runInstaller(fixture.releaseBaseUrl, fixture.installDirectory)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Installed rawback to ${target}`)
      expect(result.stderr).toContain('is not on PATH')
      expect(await Bun.file(target).exists()).toBe(true)
      expect(await Bun.file(target).text()).not.toBe('stale')
      const exiftool = join(
        fixture.installDirectory,
        'exiftool',
        process.platform === 'win32' ? 'exiftool.exe' : 'exiftool',
      )
      expect(await Bun.file(exiftool).exists()).toBe(true)
    } finally {
      fixture.server.stop(true)
    }
  })

  test('rejects a checksum mismatch without installing', async () => {
    const fixture = await createFixture({ validChecksum: false })
    const target = join(fixture.installDirectory, fixture.binaryName)

    try {
      const result = await runInstaller(fixture.releaseBaseUrl, fixture.installDirectory)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('checksum mismatch')
      expect(await Bun.file(target).exists()).toBe(false)
    } finally {
      fixture.server.stop(true)
    }
  })

  test.skipIf(process.platform === 'win32')('rejects an unsupported architecture', async () => {
    const fixture = await createFixture({ validChecksum: true })
    const fakeBin = join(fixture.root, 'fake-bin')
    const fakeUname = join(fakeBin, 'uname')
    await Bun.write(
      fakeUname,
      '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo mips64; fi\n',
    )
    await chmod(fakeUname, 0o755)

    try {
      const result = await runInstaller(
        fixture.releaseBaseUrl,
        fixture.installDirectory,
        `${fakeBin}:${process.env.PATH ?? ''}`,
      )

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('unsupported architecture: mips64')
    } finally {
      fixture.server.stop(true)
    }
  })
})
