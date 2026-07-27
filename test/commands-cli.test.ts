import { describe, expect, test } from 'bun:test'

const entrypoint = new URL('../src/index.ts', import.meta.url).pathname

function runCli(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, 'run', entrypoint, ...args], {
    env: process.env,
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
  test('documents rich photo list filters', () => {
    const result = runCli('photos', 'list', '--help')
    expect(result.exitCode).toBe(0)
    for (const flag of [
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
    expect(runCli('usage', '--help').stdout).toContain('--json')
    expect(runCli('pricing', '--help').stdout).toContain('--interval')
    expect(runCli('web', '--help').stdout).toContain('open your Rawback profile')
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
    for (const command of ['list', 'view', 'create', 'edit', 'delete', 'image', 'tag', 'article']) {
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

  test('rejects incompatible album and article options', () => {
    const clearConflict = runCli('album', 'edit', '7', '--camera-id', '2', '--clear-camera')
    expect(clearConflict.exitCode).toBe(1)
    expect(clearConflict.stderr).toContain('cannot be used together')

    const outputConflict = runCli('album', 'article', 'view', '7', '--content-only', '--json')
    expect(outputConflict.exitCode).toBe(1)
    expect(outputConflict.stderr).toContain('mutually exclusive')
  })
})
