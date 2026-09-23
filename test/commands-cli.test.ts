import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const entrypoint = new URL('../src/index.ts', import.meta.url).pathname

const temporaryHomes: string[] = []

/**
 * Every invocation gets an empty home, so these tests never read the
 * developer's real credentials and the first-run config bootstrap writes into a
 * temporary directory instead of `~/.rawback`.
 */
function emptyHome(): string {
  const directory = mkdtempSync(join(tmpdir(), 'rawback-commands-cli-'))
  temporaryHomes.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryHomes.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function runCli(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
    env: { ...process.env, HOME: emptyHome() },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

describe('new command hierarchy', () => {
  test('documents the plain-language photo search', () => {
    const result = runCli('photos', 'search', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('rawback photos search <prompt>')
    for (const flag of ['--ai-search-id', '--page', '--page-size', '--json']) {
      expect(result.stdout).toContain(flag)
    }
  })

  // The prompt is required, and that has to be caught before any credentials
  // are read — same rule the other pre-flight validations follow.
  test('requires a prompt for photos search', () => {
    const result = runCli('photos', 'search')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('Authentication credentials')
  })

  test('documents rich photo list filters', () => {
    const result = runCli('photos', 'list', '--help')
    expect(result.exitCode).toBe(0)
    for (const flag of [
      '--prompt',
      '--ai-search-id',
      '--search',
      '--status',
      '--camera-make',
      '--camera-model',
      '--lens-model',
      '--captured-after',
      '--captured-before',
      '--aperture-min',
      '--focal-length-min',
      '--rate',
      '--city',
      '--country',
      '--has-gps',
      '--page-size',
      '--json',
    ]) {
      expect(result.stdout).toContain(flag)
    }
  })

  test('documents upload sessions, usage, pricing, and web', () => {
    expect(runCli('uploads', '--help').stdout).toContain('--status')
    const usageHelp = runCli('usage', '--help').stdout
    expect(usageHelp).toContain('--json')
    expect(usageHelp).toContain('--detail')
    expect(runCli('pricing', '--help').stdout).toContain('--interval')
    expect(runCli('web', '--help').stdout).toContain('open your Rawback profile')
  })

  test('lists social media links and rejects --open with --json', () => {
    const help = runCli('social', '--help')
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("show Rawback's social media links")
    expect(help.stdout).toContain('--open')

    const json = runCli('social', '--json')
    expect(json.exitCode).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual({
      links: [{ network: 'x', name: 'X (Twitter)', url: 'https://x.com/rawbackapp' }],
    })

    const conflict = runCli('social', '--open', '--json')
    expect(conflict.exitCode).toBe(1)
    expect(conflict.stdout).toBe('')
    expect(conflict.stderr).toContain('--open or --json, not both')
  })

  test('documents the config view command and JSON output', () => {
    const config = runCli('config', '--help')
    expect(config.exitCode).toBe(0)
    expect(config.stdout).toContain('view')

    const view = runCli('config', 'view', '--help')
    expect(view.exitCode).toBe(0)
    expect(view.stdout).toContain('--json')
  })

  test('documents the environment commands and the global --env flag', () => {
    const config = runCli('config', '--help')
    expect(config.stdout).toContain('env')
    expect(config.stdout).toContain('use')

    expect(runCli('--help').stdout).toContain('--env')
    expect(runCli('config', 'env', '--help').stdout).toContain('--json')
    expect(runCli('config', 'use', '--help').stdout).toContain('environment')
  })

  test('requires an environment name for config use', () => {
    const result = runCli('config', 'use')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Missing required argument: environment')
  })

  test('rejects an unknown config env subcommand', () => {
    const result = runCli('config', 'env', 'add')
    expect(result.exitCode).toBe(1)
  })

  test('documents the dream command hierarchy and view alias', () => {
    const dream = runCli('dream', '--help')
    for (const command of ['list', 'get', 'view', 'retry']) {
      expect(dream.stdout).toContain(command)
    }

    for (const command of ['get', 'view']) {
      const detail = runCli('dream', command, '7', '--help')
      expect(detail.exitCode).toBe(0)
      expect(detail.stdout).toContain('--page-size')
      expect(detail.stdout).toContain('--json')
    }
    const retry = runCli('dream', 'retry', '7', '--help')
    expect(retry.stdout).toContain('--force')
    expect(retry.stdout).toContain('--json')
  })

  test('requires a photos subcommand', () => {
    const result = runCli('photos')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Choose a photos command')
  })

  test('requires a dream subcommand', () => {
    const result = runCli('dream')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Choose a dream command')
  })

  test('removes the old top-level upload command', () => {
    for (const result of [runCli('upload'), runCli('upload', '--help')]) {
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown argument: upload')
    }
  })

  test('validates photo pagination and ranges before authentication', () => {
    const page = runCli('photos', 'list', '--page', '0')
    expect(page.exitCode).toBe(1)
    expect(page.stderr).toContain('--page must be a positive integer')
    expect(page.stderr).not.toContain('Authentication credentials')

    const range = runCli('photos', 'list', '--aperture-min', '8', '--aperture-max', '2')
    expect(range.exitCode).toBe(1)
    expect(range.stderr).toContain('must not be greater')
  })

  test('validates dream arguments and retry safety before authentication', () => {
    const page = runCli('dream', 'list', '--page', '0')
    expect(page.exitCode).toBe(1)
    expect(page.stderr).toContain('--page must be a positive integer')
    expect(page.stderr).not.toContain('Authentication credentials')

    for (const command of ['get', 'view', 'retry']) {
      const id = runCli('dream', command, '0')
      expect(id.exitCode).toBe(1)
      expect(id.stderr).toContain('Dream ID must be a positive integer')
      expect(id.stderr).not.toContain('Authentication credentials')
    }

    const retry = runCli('dream', 'retry', '7')
    expect(retry.exitCode).toBe(1)
    expect(retry.stderr).toContain('requires an interactive terminal unless --force is provided')
    expect(retry.stderr).not.toContain('Authentication credentials')
  })

  test('documents the shares command hierarchy and rich list filters', () => {
    const shares = runCli('shares', '--help')
    for (const command of [
      'list',
      'get',
      'view',
      'archive',
      'unarchive',
      'enable',
      'disable',
      'delete',
      'recipients',
      'link',
    ]) {
      expect(shares.stdout).toContain(command)
    }

    const list = runCli('shares', 'list', '--help')
    for (const flag of [
      '--scope',
      '--type',
      '--kind',
      '--status',
      '--enabled',
      '--access',
      '--expiry',
      '--after',
      '--before',
      '--page-size',
      '--json',
    ]) {
      expect(list.stdout).toContain(flag)
    }
    expect(runCli('shares', 'link', '7', '--help').stdout).toContain('--copy')
    expect(runCli('shares', 'delete', '7', '--help').stdout).toContain('--force')
  })

  test('requires a shares subcommand', () => {
    const result = runCli('shares')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Choose a shares command')
  })

  test('validates share filters, IDs, and delete safety before authentication', () => {
    const filter = runCli('shares', 'list', '--scope', 'with-me', '--status', 'archived')
    expect(filter.exitCode).toBe(1)
    expect(filter.stderr).toContain('only apply to --scope by-me')
    expect(filter.stderr).not.toContain('Authentication credentials')

    const range = runCli('shares', 'list', '--after', '2025-02-01', '--before', '2025-01-01')
    expect(range.exitCode).toBe(1)
    expect(range.stderr).toContain('--after must not be later')
    expect(range.stderr).not.toContain('Authentication credentials')

    const id = runCli('shares', 'get', '0')
    expect(id.exitCode).toBe(1)
    expect(id.stderr).toContain('Share ID must be a positive integer')
    expect(id.stderr).not.toContain('Authentication credentials')

    const remove = runCli('shares', 'delete', '7')
    expect(remove.exitCode).toBe(1)
    expect(remove.stderr).toContain('requires an interactive terminal unless --force is provided')
    expect(remove.stderr).not.toContain('Authentication credentials')
  })

  test('documents the album command hierarchy', () => {
    const album = runCli('album', '--help')
    for (const command of [
      'list',
      'view',
      'create',
      'edit',
      'delete',
      'refresh',
      'image',
      'tag',
      'article',
    ]) {
      expect(album.stdout).toContain(command)
    }

    const create = runCli('album', 'create', '--help')
    for (const flag of [
      '--name',
      '--description',
      '--permission',
      '--tag-id',
      '--date-from',
      '--timezone',
      '--camera-id',
      '--json',
    ]) {
      expect(create.stdout).toContain(flag)
    }

    const refresh = runCli('album', 'refresh', '7', '--help')
    expect(refresh.stdout).toContain('--json')
    expect(refresh.stdout).not.toContain('--force')

    const article = runCli('album', 'article', '--help')
    for (const command of ['list', 'view', 'edit', 'publish', 'unpublish', 'delete']) {
      expect(article.stdout).toContain(command)
    }
    const articleEdit = runCli('album', 'article', 'edit', '7', '--help')
    expect(articleEdit.stdout).toContain('--title')
    expect(articleEdit.stdout).toContain('--content-file')
  })

  test('requires album, membership, and article subcommands', () => {
    const album = runCli('album')
    expect(album.exitCode).toBe(1)
    expect(album.stderr).toContain('Choose an album command')
    expect(album.stderr).toContain('delete, refresh, image')

    const image = runCli('album', 'image')
    expect(image.exitCode).toBe(1)
    expect(image.stderr).toContain('Choose an album image command')

    const article = runCli('album', 'article')
    expect(article.exitCode).toBe(1)
    expect(article.stderr).toContain('Choose an album article command')
  })

  test('validates album edits and article inputs before authentication', () => {
    const albumEdit = runCli('album', 'edit', '7')
    expect(albumEdit.exitCode).toBe(1)
    expect(albumEdit.stderr).toContain('requires at least one change option')
    expect(albumEdit.stderr).not.toContain('Authentication credentials')

    const articleEdit = runCli('album', 'article', 'edit', '7')
    expect(articleEdit.exitCode).toBe(1)
    expect(articleEdit.stderr).toContain('requires --title or --content-file')
    expect(articleEdit.stderr).not.toContain('Authentication credentials')

    const badId = runCli('album', 'view', '0')
    expect(badId.exitCode).toBe(1)
    expect(badId.stderr).toContain('Album ID must be a positive integer')
    expect(badId.stderr).not.toContain('Authentication credentials')
  })

  test('accepts several image IDs for album membership', () => {
    const add = runCli('album', 'image', 'add', '--help')
    expect(add.exitCode).toBe(0)
    expect(add.stdout).toContain('add <album-id> <image-ids..>')
    expect(add.stdout).toContain('add one or more photos to an album')

    const remove = runCli('album', 'image', 'remove', '--help')
    expect(remove.stdout).toContain('remove <album-id> <image-ids..>')
    expect(remove.stdout).toContain('--force')

    const missingIds = runCli('album', 'image', 'add', '7')
    expect(missingIds.exitCode).toBe(1)
    expect(missingIds.stderr).toContain('Not enough non-option arguments')

    const badIds = runCli('album', 'image', 'add', '7', '11', 'abc')
    expect(badIds.exitCode).toBe(1)
    expect(badIds.stderr).toContain('Image IDs must contain only positive integers')
    expect(badIds.stderr).not.toContain('Authentication credentials')

    const badRemove = runCli('album', 'image', 'remove', '7', '11,0', '--force')
    expect(badRemove.exitCode).toBe(1)
    expect(badRemove.stderr).toContain('Image IDs must contain only positive integers')
    expect(badRemove.stderr).not.toContain('Authentication credentials')

    // Validation passed, so the command gets as far as needing credentials.
    const valid = runCli('album', 'image', 'add', '7', '11', '12,13')
    expect(valid.exitCode).toBe(1)
    expect(valid.stderr).not.toContain('Image IDs')
  })

  test('rejects incompatible album and article options', () => {
    const clearConflict = runCli('album', 'edit', '7', '--camera-id', '2', '--clear-camera')
    expect(clearConflict.exitCode).toBe(1)
    expect(clearConflict.stderr).toContain('cannot be used together')

    const outputConflict = runCli('album', 'article', 'view', '7', '--content-only', '--json')
    expect(outputConflict.exitCode).toBe(1)
    expect(outputConflict.stderr).toContain('--content-only and --json cannot be used together')
  })

  // Both output flags default to false, so a presence-based conflict check
  // (yargs `.conflicts()`) fired on every invocation — even with no flags.
  test('accepts album article view without output flags', () => {
    for (const extra of [[], ['--json'], ['--content-only']]) {
      const result = runCli('album', 'article', 'view', '7', ...extra)
      expect(result.stderr).not.toContain('cannot be used together')
      expect(result.stderr).not.toContain('mutually exclusive')
    }
  })
})

describe('logs commands', () => {
  test('documents the logs group and each subcommand', () => {
    const group = runCli('logs', '--help')
    expect(group.exitCode).toBe(0)
    for (const subcommand of ['path', 'show', 'purge']) {
      expect(group.stdout).toContain(subcommand)
    }

    const show = runCli('logs', 'show', '--help')
    for (const flag of ['--lines', '--level', '--app', '--json']) {
      expect(show.stdout).toContain(flag)
    }

    const purge = runCli('logs', 'purge', '--help')
    for (const flag of ['--app', '--yes', '--json']) {
      expect(purge.stdout).toContain(flag)
    }
  })

  test('requires a logs subcommand and rejects an unknown one', () => {
    expect(runCli('logs').exitCode).toBe(1)
    expect(runCli('logs').stderr).toContain('Choose a logs command')
    expect(runCli('logs', 'tailf').exitCode).toBe(1)
  })

  test('documents the global verbosity options', () => {
    const help = runCli('--help')
    expect(help.stdout).toContain('--log-level')
    expect(help.stdout.replace(/\s+/g, ' ')).toContain('--verbose')
  })

  test('rejects a log level that is not one of the known ones', () => {
    const result = runCli('--log-level', 'verbose', 'logs', 'path')
    expect(result.exitCode).toBe(1)
  })

  test('writes no log directory for --help or --version', () => {
    // The logger is built lazily behind the same boundary that keeps the config
    // bootstrap off these paths; a regression here would create files in the
    // user's home just for asking for help.
    for (const args of [['--help'], ['--version'], ['logs', '--help']]) {
      const home = emptyHome()
      const result = Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
        env: { ...process.env, HOME: home },
        stderr: 'pipe',
        stdout: 'pipe',
      })
      expect(result.exitCode).toBe(0)
      expect(existsSync(join(home, '.rawback', 'logs'))).toBe(false)
    }
  })

  test('records a failed command, with its trace-able exit code', () => {
    const home = emptyHome()
    const run = (...args: string[]) =>
      Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
        env: { ...process.env, HOME: home },
        stderr: 'pipe',
        stdout: 'pipe',
      })

    // No credentials in an empty home, so this fails and should be recorded.
    expect(run('photos', 'list').exitCode).toBe(1)

    // pino-roll numbers every file, so discover it rather than assume a name.
    const logs = join(home, '.rawback', 'logs')
    const [file] = readdirSync(logs)
    expect(file).toMatch(/^cli\.\d+\.log$/)
    const contents = readFileSync(join(logs, file!), 'utf8')
    const records = contents
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({
      level: 'warn',
      event: 'cli.command.done',
      exitCode: 1,
      app: 'cli',
      command: 'photos list',
    })

    // And the CLI can read back what it just wrote.
    const shown = run('logs', 'show', '--json')
    expect(shown.exitCode).toBe(0)
    expect(
      (JSON.parse(shown.stdout.toString()) as { lines: unknown[] }).lines.length,
    ).toBeGreaterThan(0)
  })

  test('keeps --json output clean while logging verbosely', () => {
    const home = emptyHome()
    const result = Bun.spawnSync(
      [process.execPath, 'run', entrypoint, '-vv', 'logs', 'path', '--json'],
      { env: { ...process.env, HOME: home }, stderr: 'pipe', stdout: 'pipe' },
    )
    expect(result.exitCode).toBe(0)
    // stdout is the machine-readable contract; log records never belong in it.
    expect(() => JSON.parse(result.stdout.toString())).not.toThrow()
  })
})
