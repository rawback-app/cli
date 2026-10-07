import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GooglePhotosJobNotFoundError,
  GooglePhotosTimeoutError,
  NOOP_LOGGER,
  RawbackGraphqlError,
} from '@rawback/sdk'

import { writeCredentials } from '../src/credentials.ts'
import {
  describeGoogleErrorLabel,
  formatInstant,
  jobProgressLabel,
} from '../src/features/google-photos/view.ts'
import { uploadSourceLabel } from '../src/features/uploads/view.ts'
import {
  CommandInterruptedError,
  describeGooglePhotosError,
  type GooglePhotosCommandDependencies,
  resolveGoogleExport,
  runGoogleCancel,
  runGoogleConnect,
  runGoogleDisconnect,
  runGoogleExport,
  runGoogleImport,
  runGoogleJob,
  runGoogleJobs,
  runGoogleStatus,
  summarizePicks,
} from '../src/google-photos.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-google-'))
  temporaryDirectories.push(directory)
  return directory
}

type Reply = Record<string, unknown> | ((variables: Record<string, unknown>) => unknown)

const account = {
  email: 'ada@example.com',
  name: 'Ada',
  avatar: '',
  canImport: true,
  canExport: true,
  needsReauth: false,
  connectedAt: '2026-10-01T09:00:00Z',
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      googlePhotos: {
        available: true,
        maxPickerItems: 2000,
        maxExportItems: 50000,
        account,
        activeImport: null,
        activeExport: null,
        ...overrides,
      },
    },
  }
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    kind: 'import',
    status: 'running',
    totalItems: 2,
    doneItems: 0,
    skippedItems: 0,
    failedItems: 0,
    transferredBytes: 0,
    albumTitle: null,
    albumUrl: null,
    exportFile: 'original',
    error: null,
    pausedUntil: null,
    createdAt: '2026-10-07T10:00:00Z',
    startedAt: null,
    completedAt: null,
    upload: { id: 88, sessionId: 'upload-88', status: 'in_progress' },
    ...overrides,
  }
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'picker-1',
    pickerUri: 'https://photos.google.com/picker/picker-1',
    mediaItemsSet: false,
    pollIntervalSeconds: 5,
    timeoutSeconds: 1800,
    expiresAt: null,
    ...overrides,
  }
}

function item(id: string, type = 'PHOTO') {
  return {
    id,
    filename: `${id}.jpg`,
    mimeType: type === 'VIDEO' ? 'video/mp4' : 'image/jpeg',
    type,
    createdAt: null,
    width: null,
    height: null,
    cameraMake: null,
    cameraModel: null,
    thumbnailUrl: null,
  }
}

const progress = (value: unknown) => ({ data: { googlePhotosJob: value } })
const picked = (items: unknown[]) => ({
  data: { googlePhotosPickedItems: { items, nextPageToken: null } },
})
const refusal = (code: number, reason?: string, message = 'refused') => ({
  errors: [{ message, extensions: { code, ...(reason ? { reason } : {}) } }],
})

interface Harness {
  deps: GooglePhotosCommandDependencies
  stdout: string[]
  stderr: string[]
  opened: string[]
  prompts: Array<{ message: string; defaultAnswer: boolean }>
  calls: Array<{ operation: string; variables: Record<string, unknown> }>
  operations: () => string[]
  interrupt: () => void
}

/**
 * A fake API answering GraphQL by operation name, a queue per name whose last
 * reply repeats, plus instant polling and captured prompts and browser opens.
 */
async function harness(
  replies: Record<string, Reply[]>,
  overrides: Partial<GooglePhotosCommandDependencies> & { answer?: boolean } = {},
): Promise<Harness> {
  const directory = await scratch()
  const credentialsPath = join(directory, 'credentials.json')
  await writeCredentials({ token: 'token', refreshToken: 'refresh' }, credentialsPath)
  const calls: Harness['calls'] = []
  const stdout: string[] = []
  const stderr: string[] = []
  const opened: string[] = []
  const prompts: Harness['prompts'] = []
  let onInterrupt: (() => void) | undefined
  let clock = Date.parse('2026-10-07T10:00:00Z')
  const { answer = true, ...dependencyOverrides } = overrides

  const fetch = (async (_input: unknown, init: RequestInit | undefined) => {
    const body = JSON.parse(String(init?.body)) as {
      operationName: string
      variables: Record<string, unknown>
    }
    calls.push({ operation: body.operationName, variables: body.variables })
    const queue = replies[body.operationName]
    if (!queue?.length) {
      return Response.json({ errors: [{ message: `unexpected ${body.operationName}` }] })
    }
    const next = (queue.length > 1 ? queue.shift() : queue[0]) as Reply
    return Response.json(typeof next === 'function' ? next(body.variables) : next)
  }) as unknown as typeof globalThis.fetch

  const deps: GooglePhotosCommandDependencies = {
    configPath: join(directory, 'config.yml'),
    credentialsPath,
    fetch,
    logger: NOOP_LOGGER,
    // Wide enough that no hint wraps mid-command.
    columns: 200,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    open: async (_command, args) => {
      opened.push(args.at(-1) ?? '')
      return 0
    },
    platform: 'linux',
    prompts: {
      confirm: async (message, defaultAnswer) => {
        prompts.push({ message, defaultAnswer })
        return answer
      },
    },
    polling: {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds
      },
    },
    now: () => clock,
    onInterrupt: (handler) => {
      onInterrupt = handler
      return () => {
        onInterrupt = undefined
      }
    },
    ...dependencyOverrides,
  }
  return {
    deps,
    stdout,
    stderr,
    opened,
    prompts,
    calls,
    operations: () => calls.map((call) => call.operation),
    interrupt: () => onInterrupt?.(),
  }
}

function importReplies(overrides: Record<string, Reply[]> = {}): Record<string, Reply[]> {
  return {
    GooglePhotosStatus: [status()],
    CreateGooglePhotosPickerSession: [{ data: { createGooglePhotosPickerSession: session() } }],
    GooglePhotosPickerSession: [
      { data: { googlePhotosPickerSession: session() } },
      { data: { googlePhotosPickerSession: session({ mediaItemsSet: true }) } },
    ],
    GooglePhotosPickedItems: [picked([item('a'), item('b'), item('c', 'VIDEO')])],
    ImportGooglePhotos: [{ data: { importGooglePhotos: job({ status: 'pending' }) } }],
    GooglePhotosJobProgress: [
      progress(job({ doneItems: 1 })),
      progress(
        job({
          status: 'completed',
          doneItems: 2,
          transferredBytes: 4096,
          completedAt: '2026-10-07T10:02:00Z',
        }),
      ),
    ],
    DeleteGooglePhotosPickerSession: [{ data: { deleteGooglePhotosPickerSession: true } }],
    ...overrides,
  }
}

describe('rawback import google', () => {
  test('opens the picker, confirms, imports, and watches to the end', async () => {
    const h = await harness(importReplies())
    await runGoogleImport({}, h.deps)

    expect(h.operations()).toEqual([
      'GooglePhotosStatus',
      'CreateGooglePhotosPickerSession',
      'GooglePhotosPickerSession',
      'GooglePhotosPickerSession',
      'GooglePhotosPickedItems',
      'ImportGooglePhotos',
      'GooglePhotosJobProgress',
      'GooglePhotosJobProgress',
    ])
    expect(h.opened).toEqual(['https://photos.google.com/picker/picker-1'])
    // The link is printed undecorated on stderr, so it can be copied.
    expect(h.stderr).toContain('https://photos.google.com/picker/picker-1')
    expect(h.prompts).toEqual([
      { message: 'Import 2 photos from Google Photos?', defaultAnswer: true },
    ])
    const human = h.stdout.join('\n')
    expect(human).toContain('Videos skipped')
    expect(human).toContain('without GPS')
    expect(human).toContain('2 of 2')
    expect(human).toContain('rawback uploads')
    expect(h.stderr.join('\n')).toContain('Importing 1/2')
  })

  test('keeps stdout to one JSON document under --json --yes', async () => {
    const h = await harness(importReplies())
    await runGoogleImport({ json: true, yes: true }, h.deps)

    expect(h.prompts).toEqual([])
    const output = JSON.parse(h.stdout.join('\n')) as Record<string, unknown>
    expect(output).toEqual({
      picked: { total: 3, photos: 2, videos: 1 },
      job: expect.objectContaining({ id: 31, status: 'completed', doneItems: 2 }),
      finished: true,
    })
    expect(h.stderr.join('\n')).toContain('1 video will be skipped')
  })

  test('connects the Google account first when none is linked', async () => {
    const h = await harness(
      importReplies({
        GooglePhotosStatus: [status({ account: null }), status({ account: null }), status()],
        ConnectGooglePhotos: [
          {
            data: {
              connectGooglePhotos: {
                authorizationUrl: 'https://api.rawback.test/google-photos/start?state=s',
                expiresAt: '2026-10-07T10:10:00Z',
              },
            },
          },
        ],
      }),
    )
    await runGoogleImport({ yes: true }, h.deps)

    expect(h.calls.find((call) => call.operation === 'ConnectGooglePhotos')?.variables).toEqual({
      client: 'cli',
    })
    expect(h.opened[0]).toBe('https://api.rawback.test/google-photos/start?state=s')
    expect(h.stderr.join('\n')).toContain('Connect a Google account to continue.')
    expect(h.stdout.join('\n')).toContain('Connected Google Photos as ada@example.com.')
  })

  test('reconnects an account Google stopped accepting, and one missing the import permission', async () => {
    for (const stale of [
      { ...account, needsReauth: true },
      { ...account, canImport: false },
    ]) {
      const h = await harness(
        importReplies({
          GooglePhotosStatus: [status({ account: stale }), status()],
          ConnectGooglePhotos: [
            {
              data: {
                connectGooglePhotos: {
                  authorizationUrl: 'https://api.rawback.test/start',
                  expiresAt: '2026-10-07T10:10:00Z',
                },
              },
            },
          ],
        }),
      )
      await runGoogleImport({ yes: true }, h.deps)
      expect(h.operations()).toContain('ConnectGooglePhotos')
    }
  })

  test('warns when the browser cannot be opened, and carries on', async () => {
    const h = await harness(importReplies(), { open: async () => 1 })
    await runGoogleImport({ yes: true }, h.deps)
    expect(h.stderr.join('\n')).toContain('Could not open the browser automatically')

    const thrown = await harness(importReplies(), {
      open: async () => {
        throw new Error('no xdg-open')
      },
    })
    await runGoogleImport({ yes: true }, thrown.deps)
    expect(thrown.stderr.join('\n')).toContain('Could not open the browser automatically')
  })

  test('says so when the server does not offer Google Photos', async () => {
    const h = await harness({ GooglePhotosStatus: [status({ available: false, account: null })] })
    await expect(runGoogleImport({ yes: true }, h.deps)).rejects.toThrow(
      'Google Photos is not enabled on this server.',
    )
  })

  test('refuses to start a second import before the picker opens', async () => {
    const h = await harness({ GooglePhotosStatus: [status({ activeImport: job({ id: 5 }) })] })
    await expect(runGoogleImport({ yes: true }, h.deps)).rejects.toThrow(
      "A Google Photos import is already running (job 5). Follow it with 'rawback google job 5 --watch'",
    )
    expect(h.operations()).toEqual(['GooglePhotosStatus'])
  })

  test('ends the picker session when the import is declined', async () => {
    const h = await harness(importReplies(), { answer: false })
    await runGoogleImport({}, h.deps)

    expect(h.operations()).not.toContain('ImportGooglePhotos')
    expect(h.calls.at(-1)).toEqual({
      operation: 'DeleteGooglePhotosPickerSession',
      variables: { id: 'picker-1' },
    })
    expect(h.stdout.join('\n')).toContain('Import cancelled; nothing was imported.')
  })

  test('has nothing to import when every pick is a video', async () => {
    const h = await harness(
      importReplies({
        GooglePhotosPickedItems: [picked([item('v', 'VIDEO'), item('w', 'VIDEO')])],
      }),
    )
    await expect(runGoogleImport({ yes: true }, h.deps)).rejects.toThrow(
      'Nothing to import: the 2 picked items are all videos, and videos are not imported.',
    )
    expect(h.operations().at(-1)).toBe('DeleteGooglePhotosPickerSession')

    const single = await harness(
      importReplies({ GooglePhotosPickedItems: [picked([item('v', 'VIDEO')])] }),
    )
    await expect(runGoogleImport({ yes: true }, single.deps)).rejects.toThrow('is a video')

    const empty = await harness(importReplies({ GooglePhotosPickedItems: [picked([])] }))
    await expect(runGoogleImport({ yes: true }, empty.deps)).rejects.toThrow('Nothing was picked')
  })

  test('prints the started job and leaves it running with --no-wait', async () => {
    const h = await harness(importReplies())
    await runGoogleImport({ json: true, yes: true, wait: false }, h.deps)

    expect(h.operations()).not.toContain('GooglePhotosJobProgress')
    expect(JSON.parse(h.stdout.join('\n'))).toMatchObject({
      job: { id: 31, status: 'pending' },
      finished: false,
    })

    const human = await harness(importReplies())
    await runGoogleImport({ yes: true, wait: false }, human.deps)
    expect(human.stdout.join('\n')).toContain('rawback google job 31 --watch')
  })

  test('exits nonzero when the job fails, is cancelled, or loses items', async () => {
    const failed = await harness(
      importReplies({
        GooglePhotosJobProgress: [progress(job({ status: 'failed', error: 'needs_reauth' }))],
      }),
    )
    await expect(runGoogleImport({ yes: true }, failed.deps)).rejects.toThrow(
      'Google Photos import job 31 failed: Google needs to be reconnected.',
    )
    expect(failed.stdout.join('\n')).toContain('Google needs to be reconnected')

    const cancelled = await harness(
      importReplies({ GooglePhotosJobProgress: [progress(job({ status: 'cancelled' }))] }),
    )
    await expect(runGoogleImport({ yes: true }, cancelled.deps)).rejects.toThrow('was cancelled')

    const partial = await harness(
      importReplies({
        GooglePhotosJobProgress: [
          progress(job({ status: 'completed', doneItems: 1, failedItems: 1 })),
        ],
      }),
    )
    await expect(runGoogleImport({ yes: true }, partial.deps)).rejects.toThrow(
      "1 item failed. List them with 'rawback google job 31 --items failed'.",
    )
  })

  test('maps a server refusal to its next step and ends the unused session', async () => {
    const h = await harness(
      importReplies({
        ImportGooglePhotos: [refusal(409, 'google_photos_job_active')],
      }),
    )
    await expect(runGoogleImport({ yes: true }, h.deps)).rejects.toThrow(
      'Another Google Photos transfer of this kind is already running.',
    )
    expect(h.operations().at(-1)).toBe('DeleteGooglePhotosPickerSession')
  })

  test('stops waiting for picks on Ctrl-C and ends the session', async () => {
    let h: Harness | undefined
    h = await harness(
      importReplies({
        GooglePhotosPickerSession: [
          () => {
            h?.interrupt()
            return { data: { googlePhotosPickerSession: session() } }
          },
        ],
      }),
    )
    const error = await runGoogleImport({ yes: true }, h.deps).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CommandInterruptedError)
    expect((error as Error).message).toBe('Import cancelled; nothing was imported.')
    expect(h.operations().at(-1)).toBe('DeleteGooglePhotosPickerSession')
  })

  test('keeps the picker session when Ctrl-C lands while the import starts', async () => {
    let h: Harness | undefined
    h = await harness(
      importReplies({
        ImportGooglePhotos: [
          () => {
            h?.interrupt()
            throw new DOMException('This operation was aborted', 'AbortError')
          },
        ],
      }),
    )
    const error = await runGoogleImport({ yes: true }, h.deps).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CommandInterruptedError)
    expect((error as Error).message).toBe(
      "Stopped while starting the import; it may have started anyway. See 'rawback google jobs'.",
    )
    // The server may already be importing from it.
    expect(h.operations()).not.toContain('DeleteGooglePhotosPickerSession')
  })

  test('stops watching on Ctrl-C, reporting the job it leaves running', async () => {
    let h: Harness | undefined
    h = await harness(
      importReplies({
        GooglePhotosJobProgress: [
          () => {
            h?.interrupt()
            return progress(job({ doneItems: 1 }))
          },
        ],
      }),
    )
    const error = await runGoogleImport({ json: true, yes: true }, h.deps).catch(
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(CommandInterruptedError)
    expect((error as Error).message).toContain('continues on the server as job 31')
    expect(JSON.parse(h.stdout.join('\n'))).toMatchObject({
      job: { id: 31, doneItems: 1 },
      finished: false,
    })
    expect(h.operations()).not.toContain('DeleteGooglePhotosPickerSession')
  })

  test('explains a picker session that ran out of time', async () => {
    const h = await harness(
      importReplies({
        CreateGooglePhotosPickerSession: [
          { data: { createGooglePhotosPickerSession: session({ timeoutSeconds: 4 }) } },
        ],
        GooglePhotosPickerSession: [
          { data: { googlePhotosPickerSession: session({ timeoutSeconds: 4 }) } },
        ],
      }),
    )
    await expect(runGoogleImport({ yes: true }, h.deps)).rejects.toThrow(
      "The Google Photos picker closed before anything was picked. Run 'rawback import google' to start again.",
    )
  })

  test('cannot prompt under --json', async () => {
    const h = await harness({})
    await expect(runGoogleImport({ json: true }, h.deps)).rejects.toThrow(
      'rawback import google --json also needs --yes',
    )
    expect(h.calls).toEqual([])
  })
})

describe('resolveGoogleExport', () => {
  test('exports everything to the Rawback album by default', async () => {
    expect(await resolveGoogleExport({})).toEqual({
      input: {
        scope: 'all',
        file: 'original',
        includeSecret: false,
        includeArchived: false,
        skipExported: true,
        albumTitle: 'Rawback',
      },
      selection: 'all photos',
    })
    expect((await resolveGoogleExport({ all: true })).input.scope).toBe('all')
  })

  test('turns date-only bounds into whole UTC days', async () => {
    const { input, selection } = await resolveGoogleExport({
      from: '2024-01-01',
      to: '2024-12-31',
    })
    expect(input).toMatchObject({
      scope: 'date_range',
      from: '2024-01-01T00:00:00Z',
      to: '2024-12-31T23:59:59Z',
    })
    expect(selection).toBe('photos from 2024-01-01 to 2024-12-31')

    const open = await resolveGoogleExport({ from: '2024-06-01T08:00:00+02:00' })
    expect(open.input).toMatchObject({ from: '2024-06-01T06:00:00.000Z' })
    expect(open.input).not.toHaveProperty('to')
    expect(open.selection).toBe('photos from 2024-06-01 to now')

    expect((await resolveGoogleExport({ to: '2020-02-29' })).selection).toBe(
      'photos from the beginning to 2020-02-29',
    )
  })

  test('rejects malformed and reversed dates', async () => {
    await expect(resolveGoogleExport({ from: '2024-02-30' })).rejects.toThrow(
      '--from must be a valid YYYY-MM-DD date or RFC3339 timestamp',
    )
    await expect(resolveGoogleExport({ to: 'yesterday' })).rejects.toThrow('--to must be')
    await expect(resolveGoogleExport({ to: '2024-01-01Tnope' })).rejects.toThrow('--to must be')
    await expect(resolveGoogleExport({ from: '2024-02-01', to: '2024-01-01' })).rejects.toThrow(
      '--from must not be later than --to',
    )
  })

  test('selects albums or photos, and every option reaches the input', async () => {
    const albums = await resolveGoogleExport({
      albums: ['3,4', 4],
      includeSecret: true,
      includeArchived: true,
      skipExported: false,
      file: 'fullsize',
      albumTitle: '  Trips  ',
    })
    expect(albums.input).toEqual({
      scope: 'albums',
      albumIds: [3, 4],
      includeSecret: true,
      includeArchived: true,
      skipExported: false,
      file: 'fullsize',
      albumTitle: 'Trips',
    })
    expect(albums.selection).toBe('2 albums (3, 4) (secret albums included, archived included)')

    const directory = await scratch()
    const file = join(directory, 'ids.txt')
    await writeFile(file, '12\n13\n\n12\n')
    const images = await resolveGoogleExport({
      images: ['11'],
      imagesFile: file,
      libraryOnly: true,
    })
    expect(images.input).toMatchObject({ scope: 'images', imageIds: [11, 12, 13] })
    expect(images.input).not.toHaveProperty('albumTitle')
    expect(images.selection).toBe('3 chosen photos')

    const piped = await resolveGoogleExport(
      { imagesFile: '-' },
      { readStdin: async () => '7, 8\n9' },
    )
    expect(piped.input.imageIds).toEqual([7, 8, 9])
  })

  test('refuses more than one selection and other bad flags', async () => {
    await expect(resolveGoogleExport({ all: true, albums: ['3'] })).rejects.toThrow(
      'Choose one selection, not --all and --album',
    )
    await expect(resolveGoogleExport({ from: '2024-01-01', images: ['1'] })).rejects.toThrow(
      'not --from/--to and --image/--images-file',
    )
    await expect(resolveGoogleExport({ file: 'raw' })).rejects.toThrow(
      '--file must be one of: original, fullsize',
    )
    await expect(resolveGoogleExport({ albums: ['x'] })).rejects.toThrow(
      '--album must contain only positive integers',
    )
    await expect(
      resolveGoogleExport({ albums: Array.from({ length: 101 }, (_, index) => index + 1) }),
    ).rejects.toThrow('--album accepts at most 100 albums')
    await expect(resolveGoogleExport({ libraryOnly: true, albumTitle: 'X' })).rejects.toThrow(
      '--album-title and --no-album cannot be combined',
    )
    await expect(resolveGoogleExport({ albumTitle: '   ' })).rejects.toThrow(
      '--album-title must not be empty; pass --no-album',
    )
    await expect(
      resolveGoogleExport({ imagesFile: '-' }, { readStdin: async () => '\n' }),
    ).rejects.toThrow('--images-file lists no photo IDs')
    await expect(
      resolveGoogleExport({ imagesFile: '-' }, { readStdin: async () => 'abc' }),
    ).rejects.toThrow('--images-file must contain only positive integers')
    await expect(
      resolveGoogleExport({ imagesFile: join(await scratch(), 'missing.txt') }),
    ).rejects.toThrow('Unable to read --images-file')
  })
})

function exportReplies(overrides: Record<string, Reply[]> = {}): Record<string, Reply[]> {
  return {
    GooglePhotosStatus: [status()],
    GooglePhotosExportPreview: [
      {
        data: {
          googlePhotosExportPreview: { count: 3, totalBytes: 3 * 1024 ** 2, alreadyExported: 1 },
        },
      },
    ],
    ExportToGooglePhotos: [
      {
        data: {
          exportToGooglePhotos: job({
            id: 40,
            kind: 'export',
            status: 'pending',
            totalItems: 3,
            albumTitle: 'Rawback',
            upload: null,
          }),
        },
      },
    ],
    GooglePhotosJobProgress: [
      progress(
        job({
          id: 40,
          kind: 'export',
          status: 'completed',
          totalItems: 3,
          doneItems: 3,
          albumTitle: 'Rawback',
          albumUrl: 'https://photos.google.com/album/abc',
          upload: null,
        }),
      ),
    ],
    ...overrides,
  }
}

describe('rawback export google', () => {
  test('previews without connecting or exporting on --dry-run', async () => {
    const h = await harness(exportReplies({ GooglePhotosStatus: [status({ account: null })] }))
    await runGoogleExport({ albums: ['3'], dryRun: true, json: true }, h.deps)

    expect(h.operations()).toEqual(['GooglePhotosStatus', 'GooglePhotosExportPreview'])
    expect(JSON.parse(h.stdout.join('\n'))).toEqual({
      dryRun: true,
      input: expect.objectContaining({ scope: 'albums', albumIds: [3] }),
      preview: { count: 3, totalBytes: 3 * 1024 ** 2, alreadyExported: 1 },
      job: null,
      finished: false,
    })

    const human = await harness(exportReplies())
    await runGoogleExport({ dryRun: true }, human.deps)
    const output = human.stdout.join('\n')
    expect(output).toContain('Photos to export')
    expect(output).toContain('3 MB')
    expect(output).toContain('(skipped)')
  })

  test('confirms, exports, and reports the album', async () => {
    const h = await harness(exportReplies())
    await runGoogleExport({}, h.deps)

    expect(h.prompts).toEqual([
      {
        message: 'Export 3 photos (3 MB) to Google Photos album "Rawback"?',
        defaultAnswer: false,
      },
    ])
    expect(h.calls.find((call) => call.operation === 'ExportToGooglePhotos')?.variables).toEqual({
      input: {
        scope: 'all',
        file: 'original',
        includeSecret: false,
        includeArchived: false,
        skipExported: true,
        albumTitle: 'Rawback',
      },
    })
    const output = h.stdout.join('\n')
    expect(output).toContain('https://photos.google.com/album/abc')
    expect(output).toContain('3 of 3')
  })

  test('writes one JSON document with --json --yes', async () => {
    const h = await harness(exportReplies())
    await runGoogleExport({ json: true, yes: true, libraryOnly: true }, h.deps)
    const output = JSON.parse(h.stdout.join('\n')) as Record<string, unknown>
    expect(output).toMatchObject({
      dryRun: false,
      job: { id: 40, status: 'completed' },
      finished: true,
    })
    expect(output.input).not.toHaveProperty('albumTitle')
  })

  test('stops when the export is declined', async () => {
    const h = await harness(exportReplies(), { answer: false })
    await runGoogleExport({ libraryOnly: true }, h.deps)
    expect(h.prompts[0]?.message).toBe('Export 3 photos (3 MB) to Google Photos?')
    expect(h.operations()).not.toContain('ExportToGooglePhotos')
    expect(h.stdout.join('\n')).toContain('Export cancelled; nothing was sent.')
  })

  test('has nothing to send when everything was exported before', async () => {
    const h = await harness(
      exportReplies({
        GooglePhotosExportPreview: [
          { data: { googlePhotosExportPreview: { count: 0, totalBytes: 0, alreadyExported: 4 } } },
        ],
      }),
    )
    await runGoogleExport({ json: true, yes: true }, h.deps)
    expect(h.stderr.join('\n')).toContain('--no-skip-exported')
    expect(JSON.parse(h.stdout.join('\n'))).toMatchObject({ job: null, finished: false })

    const none = await harness(
      exportReplies({
        GooglePhotosExportPreview: [
          { data: { googlePhotosExportPreview: { count: 0, totalBytes: 0, alreadyExported: 0 } } },
        ],
      }),
    )
    await runGoogleExport({ yes: true }, none.deps)
    expect(none.stdout.join('\n')).toContain('no photos match this selection')
  })

  test('refuses a selection over the export limit before asking', async () => {
    const h = await harness(exportReplies({ GooglePhotosStatus: [status({ maxExportItems: 2 })] }))
    await expect(runGoogleExport({}, h.deps)).rejects.toThrow(
      'This selection has 3 photos; one export sends at most 2.',
    )
    expect(h.prompts).toEqual([])

    // A dry run fails the same way, rather than passing a selection the real run refuses.
    const dry = await harness(
      exportReplies({ GooglePhotosStatus: [status({ maxExportItems: 2 })] }),
    )
    await expect(runGoogleExport({ dryRun: true }, dry.deps)).rejects.toThrow(
      'This selection has 3 photos; one export sends at most 2.',
    )
  })

  test('says an export interrupted while starting may have started', async () => {
    let h: Harness | undefined
    h = await harness(
      exportReplies({
        ExportToGooglePhotos: [
          () => {
            h?.interrupt()
            throw new DOMException('This operation was aborted', 'AbortError')
          },
        ],
      }),
    )
    const error = await runGoogleExport({ yes: true, libraryOnly: true }, h.deps).catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(CommandInterruptedError)
    expect((error as Error).message).toBe(
      "Stopped while starting the export; it may have started anyway. See 'rawback google jobs'.",
    )
  })

  test('reconnects for the export permission first', async () => {
    const h = await harness(
      exportReplies({
        GooglePhotosStatus: [
          status({ account: { ...account, canExport: false } }),
          status({ account: { ...account, canExport: false } }),
          status(),
        ],
        ConnectGooglePhotos: [
          {
            data: {
              connectGooglePhotos: {
                authorizationUrl: 'https://api.rawback.test/start',
                expiresAt: '2026-10-07T10:10:00Z',
              },
            },
          },
        ],
      }),
    )
    await runGoogleExport({ yes: true }, h.deps)
    expect(h.stderr.join('\n')).toContain('Rawback is not allowed to add photos to your library')
    expect(h.operations().filter((operation) => operation === 'GooglePhotosStatus')).toHaveLength(3)
  })

  test('refuses a second export, and an unavailable server', async () => {
    const busy = await harness({
      GooglePhotosStatus: [status({ activeExport: job({ id: 9, kind: 'export' }) })],
    })
    await expect(runGoogleExport({ yes: true }, busy.deps)).rejects.toThrow(
      'A Google Photos export is already running (job 9).',
    )

    const off = await harness({ GooglePhotosStatus: [status({ available: false })] })
    await expect(runGoogleExport({ dryRun: true }, off.deps)).rejects.toThrow(
      'Google Photos is not enabled on this server.',
    )
  })

  test('validates flags before any request', async () => {
    const h = await harness({})
    await expect(runGoogleExport({ json: true }, h.deps)).rejects.toThrow(
      '--json also needs --yes (or --dry-run)',
    )
    await expect(runGoogleExport({ all: true, from: '2024-01-01' }, h.deps)).rejects.toThrow(
      'Choose one selection',
    )
    expect(h.calls).toEqual([])
  })

  test('prints the started export with --no-wait', async () => {
    const h = await harness(exportReplies())
    await runGoogleExport({ yes: true, wait: false }, h.deps)
    expect(h.operations()).not.toContain('GooglePhotosJobProgress')
    expect(h.stdout.join('\n')).toContain('rawback google job 40 --watch')
  })
})

describe('rawback google status', () => {
  test('reports the account, the running jobs and the limits', async () => {
    const h = await harness({
      GooglePhotosStatus: [
        status({
          activeExport: job({ id: 9, kind: 'export', pausedUntil: '2026-10-07T10:30:00Z' }),
        }),
      ],
    })
    await runGoogleStatus({ json: true }, h.deps)
    expect(JSON.parse(h.stdout.join('\n'))).toEqual({
      available: true,
      account,
      activeImport: null,
      activeExport: expect.objectContaining({ id: 9, pausedUntil: '2026-10-07T10:30:00Z' }),
      maxPickerItems: 2000,
      maxExportItems: 50000,
    })

    const human = await harness({ GooglePhotosStatus: [status({ activeImport: job() })] })
    await runGoogleStatus({}, human.deps)
    const output = human.stdout.join('\n')
    expect(output).toContain('Ada <ada@example.com>')
    expect(output).toContain('job 31')
  })

  test('describes every state of the link', async () => {
    for (const [overrides, expected] of [
      [{ available: false, account: null }, 'not enabled on this server'],
      [{ account: null }, 'Not connected'],
      [{ account: { ...account, needsReauth: true, canExport: false } }, 'reconnected'],
    ] as const) {
      const h = await harness({ GooglePhotosStatus: [status(overrides)] })
      await runGoogleStatus({}, h.deps)
      expect(h.stdout.join('\n')).toContain(expected)
    }
  })
})

describe('rawback google connect', () => {
  const connectReply = {
    data: {
      connectGooglePhotos: {
        authorizationUrl: 'https://api.rawback.test/start',
        expiresAt: '2026-10-07T10:10:00Z',
      },
    },
  }

  test('leaves a working link alone', async () => {
    const h = await harness({ GooglePhotosStatus: [status()] })
    await runGoogleConnect({ json: true }, h.deps)
    expect(JSON.parse(h.stdout.join('\n'))).toEqual({ account, connected: false })
    expect(h.stderr.join('\n')).toContain("run 'rawback google disconnect' first")
  })

  test('links an account and reports it', async () => {
    const h = await harness({
      GooglePhotosStatus: [status({ account: null }), status()],
      ConnectGooglePhotos: [connectReply],
    })
    await runGoogleConnect({ json: true }, h.deps)
    expect(JSON.parse(h.stdout.join('\n'))).toEqual({ account, connected: true })
    expect(h.stderr).toContain('https://api.rawback.test/start')
  })

  test('warns about a permission Google still did not grant', async () => {
    const h = await harness({
      GooglePhotosStatus: [
        status({ account: { ...account, needsReauth: true } }),
        status({ account: { ...account, canExport: false } }),
      ],
      ConnectGooglePhotos: [connectReply],
    })
    await runGoogleConnect({}, h.deps)
    expect(h.stderr.join('\n')).toContain(
      'Google did not grant permission to add photos to your library',
    )
  })

  test('waits for the missing permission', async () => {
    const h = await harness({
      GooglePhotosStatus: [
        status({ account: { ...account, canImport: false } }),
        status({ account: { ...account, canImport: false } }),
        status(),
      ],
      ConnectGooglePhotos: [connectReply],
    })
    await runGoogleConnect({}, h.deps)
    expect(h.stderr.join('\n')).toContain('Rawback is not allowed to read photos you pick')
    expect(h.operations().filter((operation) => operation === 'GooglePhotosStatus')).toHaveLength(3)
  })

  test('gives up when authorization does not finish in time', async () => {
    const h = await harness({
      GooglePhotosStatus: [status({ account: null })],
      ConnectGooglePhotos: [connectReply],
    })
    await expect(runGoogleConnect({}, h.deps)).rejects.toThrow(
      'Timed out waiting for Google authorization.',
    )
  })

  test('stops waiting on Ctrl-C', async () => {
    let h: Harness | undefined
    h = await harness({
      GooglePhotosStatus: [
        status({ account: null }),
        () => {
          h?.interrupt()
          return status({ account: null })
        },
      ],
      ConnectGooglePhotos: [connectReply],
    })
    await expect(runGoogleConnect({}, h.deps)).rejects.toThrow(
      'Stopped waiting for Google authorization.',
    )
  })

  test('needs the feature on the server', async () => {
    const h = await harness({ GooglePhotosStatus: [status({ available: false })] })
    await expect(runGoogleConnect({}, h.deps)).rejects.toThrow('not enabled on this server')
  })
})

describe('rawback google disconnect', () => {
  test('confirms, then revokes the link', async () => {
    const h = await harness({
      GooglePhotosStatus: [status()],
      DisconnectGooglePhotos: [{ data: { disconnectGooglePhotos: true } }],
    })
    await runGoogleDisconnect({}, h.deps)
    expect(h.prompts[0]?.message).toContain('Disconnect Google account ada@example.com?')
    expect(h.stdout.join('\n')).toContain('Disconnected Google account ada@example.com.')
  })

  test('keeps the link when declined', async () => {
    const h = await harness({ GooglePhotosStatus: [status()] }, { answer: false })
    await runGoogleDisconnect({}, h.deps)
    expect(h.operations()).not.toContain('DisconnectGooglePhotos')
    expect(h.stdout.join('\n')).toContain('Google Photos stays connected.')
  })

  test('reports JSON, including when nothing was linked', async () => {
    const h = await harness({
      GooglePhotosStatus: [status()],
      DisconnectGooglePhotos: [{ data: { disconnectGooglePhotos: true } }],
    })
    await runGoogleDisconnect({ json: true, yes: true }, h.deps)
    expect(JSON.parse(h.stdout.join('\n'))).toEqual({ disconnected: true })

    const none = await harness({ GooglePhotosStatus: [status({ account: null })] })
    await runGoogleDisconnect({ json: true, yes: true }, none.deps)
    expect(JSON.parse(none.stdout.join('\n'))).toEqual({ disconnected: false })

    const human = await harness({ GooglePhotosStatus: [status({ account: null })] })
    await runGoogleDisconnect({ yes: true }, human.deps)
    expect(human.stdout.join('\n')).toContain('No Google account is connected.')

    const raced = await harness({
      GooglePhotosStatus: [status()],
      DisconnectGooglePhotos: [{ data: { disconnectGooglePhotos: false } }],
    })
    await runGoogleDisconnect({ yes: true }, raced.deps)
    expect(raced.stdout.join('\n')).toContain('No Google account was connected.')
  })

  test('cannot prompt under --json, and needs the feature', async () => {
    const h = await harness({ GooglePhotosStatus: [status({ available: false })] })
    await expect(runGoogleDisconnect({ json: true }, h.deps)).rejects.toThrow('needs --yes')
    await expect(runGoogleDisconnect({ yes: true }, h.deps)).rejects.toThrow('not enabled')
  })
})

describe('rawback google jobs, job and cancel', () => {
  test('lists jobs with the requested page', async () => {
    const h = await harness({
      GooglePhotosJobs: [
        {
          data: {
            googlePhotosJobs: [
              job({ status: 'completed', doneItems: 2 }),
              job({
                id: 32,
                kind: 'export',
                status: 'failed',
                error: 'album_failed',
                upload: null,
              }),
            ],
          },
        },
      ],
    })
    await runGoogleJobs({ json: true, kind: 'export', limit: 5, offset: 10 }, h.deps)
    expect(h.calls[0]?.variables).toEqual({ kind: 'export', limit: 5, offset: 10 })
    expect((JSON.parse(h.stdout.join('\n')) as { jobs: unknown[] }).jobs).toHaveLength(2)

    const human = await harness({
      GooglePhotosJobs: [
        {
          data: {
            googlePhotosJobs: [job({ error: 'rate_limited', pausedUntil: '2026-10-07T11:00:00Z' })],
          },
        },
      ],
    })
    await runGoogleJobs({}, human.deps)
    expect(human.calls[0]?.variables).toEqual({ limit: 20, offset: 0 })
    expect(human.stdout.join('\n')).toContain('paused')
  })

  test('validates the job list options before any request', async () => {
    const h = await harness({})
    await expect(runGoogleJobs({ kind: 'sync' }, h.deps)).rejects.toThrow('--kind must be one of')
    await expect(runGoogleJobs({ limit: 0 }, h.deps)).rejects.toThrow(
      '--limit must be an integer between 1 and 100',
    )
    await expect(runGoogleJobs({ offset: -1 }, h.deps)).rejects.toThrow('--offset must be')
    expect(h.calls).toEqual([])
  })

  const detail = (overrides: Record<string, unknown> = {}) =>
    job({
      status: 'completed',
      doneItems: 1,
      skippedItems: 1,
      items: [
        {
          id: 1,
          status: 'done',
          filename: 'a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
          googleUrl: null,
          error: null,
          image: { id: 501 },
        },
        {
          id: 2,
          status: 'skipped',
          filename: 'b.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 0,
          googleUrl: null,
          error: 'duplicate',
          image: null,
        },
      ],
      ...overrides,
    })

  test('shows one job and a page of its items', async () => {
    const h = await harness({ GooglePhotosJob: [progress(detail())] })
    await runGoogleJob({ id: 31, items: 'skipped', limit: 10, offset: 5, json: true }, h.deps)
    expect(h.calls[0]?.variables).toEqual({
      id: 31,
      itemStatus: 'skipped',
      itemLimit: 10,
      itemOffset: 5,
    })
    expect(JSON.parse(h.stdout.join('\n'))).toMatchObject({
      job: {
        id: 31,
        items: [
          { id: 1, imageId: 501, error: null },
          { id: 2, imageId: null, error: 'duplicate' },
        ],
      },
    })

    const human = await harness({ GooglePhotosJob: [progress(detail())] })
    await runGoogleJob({ id: 31 }, human.deps)
    expect(human.stdout.join('\n')).toContain('already in your library')
  })

  test('watches a running job to the end before showing it', async () => {
    const h = await harness({
      GooglePhotosJob: [
        progress(detail({ status: 'running', doneItems: 0, items: [] })),
        progress(detail()),
      ],
      GooglePhotosJobProgress: [progress(job({ status: 'completed', doneItems: 2 }))],
    })
    await runGoogleJob({ id: 31, watch: true }, h.deps)
    expect(h.operations()).toEqual([
      'GooglePhotosJob',
      'GooglePhotosJobProgress',
      'GooglePhotosJob',
    ])

    const failed = await harness({
      GooglePhotosJob: [progress(detail({ status: 'failed', error: 'internal_error' }))],
    })
    await expect(runGoogleJob({ id: 31, watch: true }, failed.deps)).rejects.toThrow(
      'failed: internal error',
    )
  })

  test('reports a job that is not the caller’s', async () => {
    const h = await harness({ GooglePhotosJob: [progress(null)] })
    await expect(runGoogleJob({ id: 404 }, h.deps)).rejects.toThrow(
      'Google Photos job 404 was not found.',
    )
    const vanished = await harness({
      GooglePhotosJob: [progress(detail({ status: 'running' })), progress(null)],
      GooglePhotosJobProgress: [progress(job({ status: 'completed' }))],
    })
    await expect(runGoogleJob({ id: 31, watch: true }, vanished.deps)).rejects.toThrow(
      'was not found',
    )
  })

  test('validates job options before any request', async () => {
    const h = await harness({})
    await expect(runGoogleJob({ id: 0 }, h.deps)).rejects.toThrow(
      'Job ID must be a positive integer',
    )
    await expect(runGoogleJob({ id: 1, items: 'lost' }, h.deps)).rejects.toThrow(
      '--items must be one of',
    )
    await expect(runGoogleJob({ id: 1, limit: 201 }, h.deps)).rejects.toThrow(
      '--limit must be an integer between 1 and 200',
    )
    expect(h.calls).toEqual([])
  })

  test('cancels a running job and says when there was nothing to cancel', async () => {
    const h = await harness({
      CancelGooglePhotosJob: [
        { data: { cancelGooglePhotosJob: job({ status: 'cancelled', error: 'cancelled' }) } },
      ],
    })
    await runGoogleCancel({ id: 31 }, h.deps)
    expect(h.calls[0]?.variables).toEqual({ id: 31 })
    expect(h.stdout.join('\n')).toContain('Cancelled Google Photos import job 31.')

    const finished = await harness({
      CancelGooglePhotosJob: [{ data: { cancelGooglePhotosJob: job({ status: 'completed' }) } }],
    })
    await runGoogleCancel({ id: 31 }, finished.deps)
    expect(finished.stdout.join('\n')).toContain('Job 31 is completed; nothing was cancelled.')

    const json = await harness({
      CancelGooglePhotosJob: [{ data: { cancelGooglePhotosJob: job({ status: 'cancelled' }) } }],
    })
    await runGoogleCancel({ id: 31, json: true }, json.deps)
    expect(JSON.parse(json.stdout.join('\n'))).toMatchObject({ job: { status: 'cancelled' } })

    await expect(runGoogleCancel({ id: -1 }, json.deps)).rejects.toThrow('Job ID must be')
  })
})

describe('Google Photos errors and labels', () => {
  const failure = (reason: string) =>
    new RawbackGraphqlError(
      [{ message: 'refused', extensions: { code: 412, reason } }],
      undefined,
      {
        headers: new Headers({ 'x-trace-id': 'trace-123' }),
      },
    )

  test('names the next step for each server reason', () => {
    const cases: Array<[string, string]> = [
      ['google_photos_unavailable', 'not enabled on this server'],
      ['google_photos_not_connected', "Run 'rawback google connect' to link"],
      ['google_photos_needs_reauth', "Run 'rawback google connect' to reconnect"],
      ['google_photos_missing_scope', "allow access on Google's consent screen"],
      ['google_photos_job_active', 'already running'],
      ['google_photos_nothing_picked', 'pick at least one photo'],
    ]
    for (const [reason, expected] of cases) {
      const described = describeGooglePhotosError(failure(reason)) as Error
      expect(described.message).toContain(expected)
      expect(described.message).toContain('Trace ID: trace-123.')
    }
  })

  test('explains the SDK’s own waiting errors and passes everything else through', () => {
    expect(
      (describeGooglePhotosError(new GooglePhotosTimeoutError('connection', 'late')) as Error)
        .message,
    ).toContain('Timed out waiting for Google authorization')
    expect((describeGooglePhotosError(new GooglePhotosJobNotFoundError(3)) as Error).message).toBe(
      'Google Photos job 3 was not found.',
    )
    const other = new Error('boom')
    expect(describeGooglePhotosError(other)).toBe(other)
    const noReason = new RawbackGraphqlError(
      [{ message: 'busy', extensions: { code: 429 } }],
      undefined,
    )
    expect(describeGooglePhotosError(noReason)).toBe(noReason)
  })

  test('labels job errors, progress and upload sources', () => {
    expect(describeGoogleErrorLabel('duplicate')).toBe('already in your library')
    expect(describeGoogleErrorLabel('brand_new_label')).toBe('brand_new_label')
    expect(describeGoogleErrorLabel(null)).toBeUndefined()
    expect(jobProgressLabel(job({ status: 'pending' }) as never)).toBe(
      'Importing — waiting to start (job 31)…',
    )
    expect(
      jobProgressLabel(
        job({
          kind: 'export',
          doneItems: 3,
          skippedItems: 1,
          failedItems: 1,
          totalItems: 9,
          pausedUntil: '2026-10-07T11:00:00Z',
        }) as never,
      ),
    ).toBe(
      'Exporting 5/9 · 1 skipped · 1 failed · 0 Bytes · paused by Google until 2026-10-07 11:00 UTC',
    )
    expect(formatInstant('nope')).toBe('—')
    expect(formatInstant(null)).toBe('—')
    expect(uploadSourceLabel('google_photos')).toBe('GOOGLE PHOTOS')
    expect(uploadSourceLabel('sftp')).toBe('SFTP')
    expect(summarizePicks([item('a'), item('b', 'video') as never])).toEqual({
      total: 2,
      photos: 1,
      videos: 1,
    })
  })
})
