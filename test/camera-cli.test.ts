import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrypoint = new URL('../src/index.ts', import.meta.url).pathname

const temporaryDirectories: string[] = []

async function emptyHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-camera-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

async function runCli(...args: string[]) {
  const home = await emptyHome()
  const result = Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
    env: { ...process.env, HOME: home, RAWBACK_CAMERA_URL: '' },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

/**
 * Help output is wrapped to the terminal width, which can split a long flag
 * name across lines. Rejoin wrapped lines before matching on flag names.
 */
function dewrap(text: string): string {
  return text.replace(/\n\s+/g, '')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('rawback camera help', () => {
  test('the top-level help lists the camera group', async () => {
    const result = await runCli('--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('camera')
  })

  test('lists every subcommand', async () => {
    const result = await runCli('camera', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    for (const subcommand of ['connect', 'list', 'use', 'forget', 'info', 'status']) {
      expect(result.stdout).toContain(subcommand)
    }
  })

  test.each([
    ['connect', ['--name', '--save-password', '--camera', '--insecure', '--timeout', '--json']],
    ['info', ['--camera', '--insecure', '--timeout', '--refresh', '--json']],
    ['status', ['--camera', '--insecure', '--timeout', '--refresh', '--json']],
    ['list', ['--json']],
    ['forget', ['--force', '--json']],
  ])('camera %s --help documents its options', async (subcommand, flags) => {
    const result = await runCli('camera', subcommand, '--help')

    expect(result.exitCode).toBe(0)
    const help = dewrap(result.stdout)
    for (const flag of flags) expect(help).toContain(flag)
  })

  test('requires a subcommand', async () => {
    const result = await runCli('camera')

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Choose a camera command')
  })

  test.each([
    [['camera', 'nonsense'], 'Unknown argument'],
    [['camera', 'info', '--bogus'], 'Unknown argument'],
  ])('rejects %p', async (args, expected) => {
    const result = await runCli(...args)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(expected)
  })
})

describe('camera validation happens before any connection', () => {
  // Port 1 would produce a connection error if these ever reached the network,
  // so asserting the specific message proves validation ran first.
  test.each([
    [['camera', 'info', '--camera', 'notaurl'], /--camera must be a URL/],
    [['camera', 'info', '--camera', 'ftp://192.168.0.1'], /--camera must use http/],
    [
      ['camera', 'info', '--camera', 'http://127.0.0.1:1', '--insecure'],
      /--insecure only applies to an https/,
    ],
    [['camera', 'info', '--camera', 'http://127.0.0.1:1', '--timeout', '-5'], /--timeout must be/],
    [
      ['camera', 'connect', 'http://127.0.0.1:1', '--camera', 'http://127.0.0.1:2'],
      /takes a URL or --camera, not both/,
    ],
  ])('rejects %p without connecting', async (args, pattern) => {
    const result = await runCli(...args)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(pattern)
    expect(result.stderr).not.toContain('Could not reach')
  })

  test('forget without --force needs a terminal', async () => {
    const result = await runCli('camera', 'forget', 'a:8080')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('interactive terminal')
  })
})

describe('local camera commands work with no camera present', () => {
  test('list reports an empty store as valid JSON', async () => {
    const result = await runCli('camera', 'list', '--json')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ default: null, cameras: [] })
  })

  test('a command with no target explains how to set one', async () => {
    const result = await runCli('camera', 'info')

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('rawback camera connect')
  })

  test('camera commands never ask for Rawback credentials', async () => {
    const result = await runCli('camera', 'info')

    expect(result.stderr).not.toContain('Authentication credentials')
  })
})
