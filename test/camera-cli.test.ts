import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_CONFIG_TEMPLATE } from '../src/config-init.ts'

const entrypoint = new URL('../src/index.ts', import.meta.url).pathname

const temporaryDirectories: string[] = []

/**
 * A home with no saved cameras, but with `config.yml` already in place: these
 * tests assert on empty stderr, and a genuinely first-run home would also carry
 * the one-line notice for the config the CLI creates. First-run behavior has
 * its own coverage in `config-init.test.ts`.
 */
async function emptyHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-camera-cli-'))
  temporaryDirectories.push(directory)
  await mkdir(join(directory, '.rawback'), { mode: 0o700, recursive: true })
  await Bun.write(join(directory, '.rawback', 'config.yml'), DEFAULT_CONFIG_TEMPLATE)
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
    for (const subcommand of [
      'connect',
      'list',
      'use',
      'forget',
      'info',
      'status',
      'cert',
      'rtp',
      'record',
      'focus',
      'zoom',
      'clock',
      'owner',
    ]) {
      expect(result.stdout).toContain(subcommand)
    }
  })

  test.each([
    ['connect', ['--name', '--save-password', '--camera', '--insecure', '--timeout', '--json']],
    ['info', ['--camera', '--insecure', '--timeout', '--refresh', '--json']],
    ['status', ['--camera', '--insecure', '--timeout', '--refresh', '--json']],
    ['list', ['--json']],
    ['forget', ['--force', '--json']],
    ['cert', ['--overwrite', '--camera', '--json']],
    ['rtp', ['--ip', '--overwrite', '--force', '--json']],
    ['liveview', ['--detail', '--frames', '--output-dir']],
    ['record', ['--movie-mode', '--force', '--json']],
    ['focus', ['--steps', '--force', '--json']],
    ['owner', ['--copyright', '--author', '--owner-name', '--nickname', '--force']],
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
    [['camera', 'contents', 'list', 'card1', '100CANON', '--order', 'desc'], /--order needs --all/],
    [['camera', 'rtp', 'start', '--camera', 'http://127.0.0.1:1'], /requires --ip <address>/],
    [
      ['camera', 'rtp', 'start', '--ip', 'not-an-ip', '--camera', 'http://127.0.0.1:1'],
      /requires --ip <address>/,
    ],
    [
      [
        'camera',
        'rtp',
        'start',
        '--ip',
        '192.168.0.10',
        '--json',
        '--camera',
        'http://127.0.0.1:1',
      ],
      /--json also needs --force/,
    ],
    [['camera', 'owner', 'set', '--camera', 'http://127.0.0.1:1'], /owner set needs --copyright/],
    [['camera', 'owner', 'clear', '--camera', 'http://127.0.0.1:1'], /owner clear needs a field/],
    [['camera', 'zoom', '1.5', '--camera', 'http://127.0.0.1:1'], /whole-number position/],
    [
      ['camera', 'record', 'start', '--json', '--camera', 'http://127.0.0.1:1'],
      /record start --json also needs --force/,
    ],
    [
      ['camera', 'clock', 'sync', '--json', '--camera', 'http://127.0.0.1:1'],
      /clock sync --json also needs --force/,
    ],
    [
      ['camera', 'focus', 'near', '--steps', '4', '--camera', 'http://127.0.0.1:1'],
      /Invalid values/,
    ],
    [['camera', 'rtp', 'sdp', '--camera', 'http://127.0.0.1:1'], /requires an output file/],
    [
      [
        'camera',
        'liveview',
        'stream',
        '--output-dir',
        'x',
        '--detail',
        '--camera',
        'http://127.0.0.1:1',
      ],
      /--detail applies only to rawback camera liveview frame/,
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

  test('a JSON document larger than a pipe buffer arrives whole', async () => {
    // The catalogue listing is well over 64 KiB. Once Ink has loaded, Bun's
    // console.log makes one write to a shell pipe and drops whatever the pipe
    // buffer did not take, so `rawback … --json | jq` read truncated JSON.
    // Bun.spawnSync's own pipe does not reproduce it; a kernel pipe does.
    const home = await emptyHome()
    const result = Bun.spawnSync(
      ['sh', '-c', `"${process.execPath}" run "${entrypoint}" camera api --list --json | cat`],
      { env: { ...process.env, HOME: home, RAWBACK_CAMERA_URL: '' }, stdout: 'pipe' },
    )
    const stdout = result.stdout.toString()

    expect(stdout.length).toBeGreaterThan(65536)
    const parsed = JSON.parse(stdout) as { count: number; endpoints: unknown[] }
    expect(parsed.endpoints).toHaveLength(parsed.count)
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

describe('module boundaries', () => {
  const source = (path: string) =>
    Bun.file(new URL(`../src/${path}`, import.meta.url).pathname).text()

  test('cli.ts never imports the camera client', async () => {
    // The camera group must be declarations plus a lazy import, or every
    // `rawback --help` would pay to load @rawback/ccapi-js.
    expect(await source('cli.ts')).not.toContain('@rawback/ccapi-js')
  })

  test('camera modules never import the Rawback SDK', async () => {
    const glob = new Bun.Glob('camera*.ts')
    const root = new URL('../src/', import.meta.url).pathname
    for await (const file of glob.scan({ cwd: root })) {
      expect(await source(file), file).not.toContain('@rawback/sdk')
    }
  })

  test('camera --help does not load the camera client', async () => {
    // A proxy for the startup-path rule: help must render without the dynamic
    // import chain ever being taken.
    const result = await runCli('camera', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })
})
