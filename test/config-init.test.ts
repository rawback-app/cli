import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  DEFAULT_CONFIG_TEMPLATE,
  bootstrapConfig,
  createDefaultConfig,
  runConfigInit,
} from '../src/config-init.ts'
import { readConfig } from '../src/config.ts'
import { DEFAULT_API_HOST } from '../src/http.ts'
import { CommandOutput } from '../src/ui/output.tsx'

const entrypoint = new URL('../src/index.ts', import.meta.url).pathname
const isWindows = process.platform === 'win32'

const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix = 'rawback-config-init-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function temporaryConfigPath(): Promise<string> {
  return join(await temporaryDirectory(), 'config.yml')
}

function collectingOutput(stdout: string[], stderr: string[]): CommandOutput {
  return new CommandOutput({
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  })
}

async function fileMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('default config template', () => {
  test('round-trips the config schema as live hosts only', async () => {
    const path = await temporaryConfigPath()

    expect(await createDefaultConfig(path)).toEqual({ outcome: 'created', path })
    expect(await Bun.file(path).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
    expect(await readConfig(path)).toEqual({
      apiHost: DEFAULT_API_HOST,
      webHost: 'https://rawback.app',
    })
  })

  test('leaves every optional block commented out', () => {
    for (const line of DEFAULT_CONFIG_TEMPLATE.split('\n')) {
      if (/^\s*(sftp|metadata|current|environments):/.test(line)) {
        throw new Error(`template must not enable ${line.trim()}`)
      }
    }

    expect(DEFAULT_CONFIG_TEMPLATE).toContain('# sftp:')
    expect(DEFAULT_CONFIG_TEMPLATE).toContain('# metadata:')
    expect(DEFAULT_CONFIG_TEMPLATE).not.toContain('generated SFTP credential password')
  })
})

describe('createDefaultConfig', () => {
  test('creates the ~/.rawback directory when it is missing', async () => {
    const path = join(await temporaryDirectory(), '.rawback', 'config.yml')

    expect(await createDefaultConfig(path)).toEqual({ outcome: 'created', path })
    expect(await Bun.file(path).exists()).toBe(true)
  })

  test.skipIf(isWindows)('restricts the file and its directory on Unix', async () => {
    const path = join(await temporaryDirectory(), '.rawback', 'config.yml')

    await createDefaultConfig(path)

    expect(await fileMode(path)).toBe(0o600)
    expect(await fileMode(dirname(path))).toBe(0o700)
  })

  test('never overwrites an existing file', async () => {
    const path = await temporaryConfigPath()
    const existing = 'apiHost: https://staging.rawback.app\n'
    await Bun.write(path, existing)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await createDefaultConfig(path)).toEqual({ outcome: 'existed', path })
      expect(await Bun.file(path).text()).toBe(existing)
    }
  })

  test('leaves an existing empty file alone', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(path, '')

    expect(await createDefaultConfig(path)).toEqual({ outcome: 'existed', path })
    expect(await Bun.file(path).text()).toBe('')
  })

  test('replaces the file only when forced', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(path, 'apiHost: https://staging.rawback.app\n')

    expect(await createDefaultConfig(path, true)).toEqual({ outcome: 'replaced', path })
    expect(await Bun.file(path).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
  })

  test('concurrent calls create the file exactly once', async () => {
    const path = await temporaryConfigPath()

    const results = await Promise.all([
      createDefaultConfig(path),
      createDefaultConfig(path),
      createDefaultConfig(path),
    ])

    expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'existed')).toHaveLength(2)
    expect(await Bun.file(path).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
  })
})

describe('bootstrapConfig', () => {
  test('announces a created file on stderr only', async () => {
    const path = await temporaryConfigPath()
    const stdout: string[] = []
    const stderr: string[] = []

    const result = await bootstrapConfig(collectingOutput(stdout, stderr), path)

    expect(result.outcome).toBe('created')
    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Created a default config')
    expect(stderr.join('\n')).toContain(path)
  })

  test('stays silent when the file already exists', async () => {
    const path = await temporaryConfigPath()
    await createDefaultConfig(path)
    const stdout: string[] = []
    const stderr: string[] = []

    const result = await bootstrapConfig(collectingOutput(stdout, stderr), path)

    expect(result).toEqual({ outcome: 'existed', path })
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
  })

  test('tolerates a location it cannot write', async () => {
    const directory = await temporaryDirectory()
    // A regular file in place of the parent directory fails for every user,
    // including root, which ignores directory permission bits.
    await writeFile(join(directory, 'notadir'), 'blocked\n')
    const path = join(directory, 'notadir', 'config.yml')
    const stdout: string[] = []
    const stderr: string[] = []
    const exitCode = process.exitCode

    const result = await bootstrapConfig(collectingOutput(stdout, stderr), path)

    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBeTruthy()
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
    expect(process.exitCode).toBe(exitCode)
  })
})

describe('rawback config init', () => {
  test('creates the file and reports the path', async () => {
    const path = await temporaryConfigPath()
    const lines: string[] = []

    await runConfigInit({}, { configPath: path, stdout: (message) => lines.push(message) })

    expect(lines.join('\n')).toContain('Created a default configuration')
    expect(await Bun.file(path).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
  })

  test('refuses to replace an existing file without --force', async () => {
    const path = await temporaryConfigPath()
    const existing = 'apiHost: https://staging.rawback.app\n'
    await Bun.write(path, existing)
    const lines: string[] = []

    await runConfigInit({}, { configPath: path, stdout: (message) => lines.push(message) })

    expect(lines.join('\n')).toContain('pass --force to replace it')
    expect(await Bun.file(path).text()).toBe(existing)
  })

  test('replaces an existing file with --force', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(path, 'apiHost: https://staging.rawback.app\n')
    const lines: string[] = []

    await runConfigInit(
      { force: true },
      { configPath: path, stdout: (message) => lines.push(message) },
    )

    expect(lines.join('\n')).toContain('Replaced the configuration')
    expect(await Bun.file(path).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
  })
})

describe('first-run bootstrap through the CLI', () => {
  async function runInFreshHome(...args: string[]) {
    const home = await temporaryDirectory('rawback-config-init-home-')
    const result = Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
      env: { ...process.env, HOME: home },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    return {
      configPath: join(home, '.rawback', 'config.yml'),
      exitCode: result.exitCode,
      home,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
    }
  }

  test('a real command creates the config', async () => {
    const result = await runInFreshHome('config', 'view')

    expect(result.exitCode).toBe(0)
    expect(await Bun.file(result.configPath).exists()).toBe(true)
    expect(result.stderr).toContain('Created a default config')
    expect(result.stdout).not.toContain('No config file found')
    if (!isWindows) expect(await fileMode(result.configPath)).toBe(0o600)
  })

  test('--json output stays parseable while the config is created', async () => {
    const result = await runInFreshHome('config', 'view', '--json')

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      apiHost: DEFAULT_API_HOST,
      webHost: 'https://rawback.app',
    })
  })

  test.each([['--help'], ['-h'], ['--version']])(
    '%s leaves the home directory alone',
    async (flag) => {
      const result = await runInFreshHome(flag)

      expect(result.exitCode).toBe(0)
      expect(await Bun.file(result.configPath).exists()).toBe(false)
    },
  )

  test('config init reports the creation itself', async () => {
    const result = await runInFreshHome('config', 'init')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain('Created a default config at')
    expect(result.stdout).toContain('Created a default configuration')
    expect(await Bun.file(result.configPath).text()).toBe(DEFAULT_CONFIG_TEMPLATE)
  })
})
