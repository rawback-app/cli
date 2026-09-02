import yargs from 'yargs'
import type { Argv } from 'yargs'

import { setSelectedEnvironment } from './environment.ts'
import { traceIdOf } from './trace.ts'
import { CommandOutput } from './ui/output.tsx'

/**
 * Appends the trace ID of a failed request so the user can quote it — the same
 * ID identifies the request in the server's traces. Messages that already
 * embed it (the device authorization errors) are left alone.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const traceID = traceIdOf(error)
  if (!traceID || message.includes(traceID)) return message
  return `${message} Trace ID: ${traceID}.`
}

async function runCommand(
  action: () => Promise<void>,
  cancellationMessage = 'Authentication cancelled.',
): Promise<void> {
  const output = new CommandOutput()
  try {
    await action()
  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') {
      output.info(cancellationMessage)
      process.exitCode = 130
      return
    }
    output.error(describeError(error))
    process.exitCode = 1
  }
}

/**
 * Options every camera subcommand accepts. Declared once so the target can be
 * named the same way everywhere.
 */
function cameraTargetOptions<T>(command: Argv<T>) {
  return command
    .option('camera', {
      describe: 'camera URL, e.g. http://user:password@192.168.0.1:8080',
      type: 'string',
    })
    .option('insecure', {
      default: false,
      describe: "accept the camera's self-signed TLS certificate",
      type: 'boolean',
    })
    .option('timeout', {
      default: 12000,
      describe: 'per-request timeout in milliseconds (0 disables it)',
      type: 'number',
    })
    .option('refresh', {
      default: false,
      describe: 're-read the camera capability map instead of using the cached one',
      type: 'boolean',
    })
}

/**
 * Validates the shared camera options before any network or filesystem access,
 * so a malformed target fails fast rather than after a connection attempt.
 */
function checkCameraTarget(args: {
  camera?: string | undefined
  insecure?: boolean | undefined
  timeout?: number | undefined
}): true {
  if (args.camera !== undefined) {
    let url: URL
    try {
      url = new URL(args.camera)
    } catch {
      throw new Error('--camera must be a URL like http://user:password@192.168.0.1:8080')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('--camera must use http:// or https://')
    }
    if (args.insecure === true && url.protocol === 'http:') {
      throw new Error('--insecure only applies to an https:// camera')
    }
  }
  if (args.timeout !== undefined && (!Number.isSafeInteger(args.timeout) || args.timeout < 0)) {
    throw new Error('--timeout must be a non-negative whole number of milliseconds')
  }
  return true
}

/** The shared camera options, shaped for the run functions. */
function cameraTargetArgs(args: {
  camera?: string | undefined
  insecure?: boolean | undefined
  timeout?: number | undefined
  refresh?: boolean | undefined
  json?: boolean | undefined
}) {
  return {
    insecure: args.insecure ?? false,
    timeout: args.timeout ?? 12000,
    refresh: args.refresh ?? false,
    json: args.json ?? false,
    ...(args.camera !== undefined ? { camera: args.camera } : {}),
  }
}

/**
 * A command that changes the camera confirms first. `--json` means a script is
 * driving, where a prompt would hang, so it has to carry `--force` too.
 */
function checkMutatingIsNonInteractive(
  args: { force?: boolean | undefined; json?: boolean | undefined },
  command: string,
): true {
  if (args.force === true) return true
  if (args.json === true) {
    throw new Error(`${command} --json also needs --force, because it cannot prompt`)
  }
  if (!process.stdin.isTTY) {
    throw new Error(`${command} needs an interactive terminal unless --force is provided`)
  }
  return true
}

function albumMetadataOptions<T>(command: Argv<T>) {
  return command
    .option('description', {
      describe: 'album description (use an empty value to clear it when editing)',
      type: 'string',
    })
    .option('permission', {
      choices: ['private', 'protected', 'public'] as const,
      describe: 'album visibility',
      type: 'string',
    })
    .option('tag-id', {
      array: true,
      describe: 'tag ID (repeat or comma-separate)',
      type: 'string',
    })
    .option('date-from', {
      describe: 'smart-filter start date (YYYY-MM-DD or RFC3339)',
      type: 'string',
    })
    .option('date-to', {
      describe: 'smart-filter end date (YYYY-MM-DD or RFC3339)',
      type: 'string',
    })
    .option('timezone', {
      describe: 'IANA timezone for smart-filter dates',
      type: 'string',
    })
    .option('camera-id', {
      describe: 'smart-filter camera ID',
      type: 'number',
    })
    .option('lens-id', {
      describe: 'smart-filter lens ID',
      type: 'number',
    })
}

export function createProgram(version: string, output = new CommandOutput()): Argv {
  return yargs()
    .scriptName('rawback')
    .usage('$0 [options]\n\nRawback CLI for humans and AI agents')
    .help('help', 'display help for command')
    .alias('help', 'h')
    .version('version', 'output the current version', version)
    .alias('version', 'V')
    .option('env', {
      describe: 'environment from ~/.rawback/config.yml; defaults to its current: setting',
      global: true,
      type: 'string',
    })
    .middleware((args) => {
      setSelectedEnvironment(typeof args.env === 'string' ? args.env : undefined)
    })
    .command(
      'auth [subcommand]',
      'authenticate with Rawback',
      (command) =>
        command
          .positional('subcommand', {
            choices: ['status'] as const,
            describe: 'authentication action',
            type: 'string',
          })
          .option('force', {
            default: false,
            describe: 'reauthenticate without checking or confirming the current session',
            type: 'boolean',
          })
          .check((args) => {
            if (args.subcommand === 'status' && args.force) {
              throw new Error('rawback auth status does not accept login options')
            }
            return true
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) {
          return
        }
        const { runAuth, runAuthStatus } = await import('./auth.ts')
        if (args.subcommand === 'status') {
          await runCommand(() => runAuthStatus())
          return
        }

        await runCommand(() =>
          runAuth({
            force: args.force,
          }),
        )
      },
    )
    .command(
      ['credentials <subcommand> [id]', 'cred <subcommand> [id]'],
      'manage SFTP credentials',
      (command) =>
        command
          .positional('subcommand', {
            choices: ['list', 'add', 'delete', 'del'] as const,
            describe: 'credential action',
            type: 'string',
          })
          .positional('id', {
            describe: 'SFTP credential ID',
            type: 'number',
          })
          .option('name', {
            describe: 'credential name (prompted when omitted)',
            type: 'string',
          })
          .option('force', {
            default: false,
            describe: 'delete without confirmation',
            type: 'boolean',
          })
          .option('json', {
            default: false,
            describe: 'output machine-readable JSON',
            type: 'boolean',
          })
          .check((args) => {
            if (args.subcommand === 'list') {
              if (args.id !== undefined || args.name !== undefined || args.force) {
                throw new Error('rawback cred list only accepts --json')
              }
              return true
            }

            if (args.subcommand === 'add') {
              if (args.id !== undefined || args.force) {
                throw new Error('rawback cred add does not accept an ID or --force')
              }
              return true
            }

            if (args.id === undefined) {
              throw new Error(`rawback cred ${args.subcommand} requires a credential ID`)
            }
            if (args.name !== undefined) {
              throw new Error(`rawback cred ${args.subcommand} does not accept add options`)
            }
            return true
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) {
          return
        }
        const { runSftpCredentialAdd, runSftpCredentialDelete, runSftpCredentialList } =
          await import('./sftp-credentials.ts')

        if (args.subcommand === 'list') {
          await runCommand(
            () => runSftpCredentialList({ json: args.json }),
            'Credential operation cancelled.',
          )
          return
        }
        if (args.subcommand === 'add') {
          await runCommand(
            () =>
              runSftpCredentialAdd({
                json: args.json,
                ...(args.name !== undefined ? { name: args.name } : {}),
              }),
            'Credential operation cancelled.',
          )
          return
        }

        await runCommand(
          () =>
            runSftpCredentialDelete({
              force: args.force,
              id: args.id as number,
              json: args.json,
            }),
          'Credential operation cancelled.',
        )
      },
    )
    .command(
      'photos',
      'search, list and upload photos',
      (command) =>
        command
          .command(
            'search <prompt>',
            'find photos by describing them in plain language',
            (search) =>
              search
                .positional('prompt', {
                  describe: 'what to look for, e.g. "from 2012, all images in NYC"',
                  type: 'string',
                })
                .option('ai-search-id', {
                  describe:
                    "reuse a previous search's interpretation (from aiSearch.id) instead of spending another AI credit",
                  type: 'string',
                })
                .option('page', {
                  default: 1,
                  describe: 'page number',
                  type: 'number',
                })
                .option('page-size', {
                  default: 24,
                  describe: 'results per page',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runPhotoSearch } = await import('./photos.ts')
              await runCommand(() =>
                runPhotoSearch({
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                  ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
                  ...(args.aiSearchId !== undefined ? { aiSearchId: args.aiSearchId } : {}),
                }),
              )
            },
          )
          .command(
            'list',
            'list photos in the authenticated library',
            (list) =>
              list
                .option('prompt', {
                  describe:
                    'describe what you want in plain language; combines with the filters below',
                  type: 'string',
                })
                .option('ai-search-id', {
                  describe:
                    'reuse a previous --prompt interpretation (from aiSearch.id) instead of spending another AI credit',
                  type: 'string',
                })
                .option('search', {
                  describe: 'search filenames and photo metadata',
                  type: 'string',
                })
                .option('status', {
                  array: true,
                  describe: 'filter by status (repeat or comma-separate)',
                  type: 'string',
                })
                .option('camera-make', {
                  array: true,
                  describe: 'filter by camera make (repeat or comma-separate)',
                  type: 'string',
                })
                .option('camera-model', {
                  array: true,
                  describe: 'filter by camera model (repeat or comma-separate)',
                  type: 'string',
                })
                .option('lens-model', {
                  array: true,
                  describe: 'filter by lens model (repeat or comma-separate)',
                  type: 'string',
                })
                .option('captured-after', {
                  describe: 'ISO date/time or Unix timestamp in seconds',
                  type: 'string',
                })
                .option('captured-before', {
                  describe: 'ISO date/time or Unix timestamp in seconds',
                  type: 'string',
                })
                .option('aperture-min', {
                  describe: 'minimum aperture',
                  type: 'number',
                })
                .option('aperture-max', {
                  describe: 'maximum aperture',
                  type: 'number',
                })
                .option('focal-length-min', {
                  describe: 'minimum focal length in millimeters',
                  type: 'number',
                })
                .option('focal-length-max', {
                  describe: 'maximum focal length in millimeters',
                  type: 'number',
                })
                .option('rate', {
                  array: true,
                  describe: 'ratings 0-5 (default: 3,4,5; repeat or comma-separate)',
                  type: 'string',
                })
                .option('city', {
                  array: true,
                  describe: 'filter by city (repeat or comma-separate)',
                  type: 'string',
                })
                .option('country', {
                  array: true,
                  describe: 'filter by country (repeat or comma-separate)',
                  type: 'string',
                })
                .option('has-gps', {
                  default: false,
                  describe: 'only include photos with GPS coordinates',
                  type: 'boolean',
                })
                .option('page', {
                  default: 1,
                  describe: 'result page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 24,
                  describe: 'photos per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runPhotoList } = await import('./photos.ts')
              await runCommand(() =>
                runPhotoList({
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                  hasGps: args.hasGps,
                  ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
                  ...(args.aiSearchId !== undefined ? { aiSearchId: args.aiSearchId } : {}),
                  ...(args.search !== undefined ? { search: args.search } : {}),
                  ...(args.status !== undefined ? { status: args.status } : {}),
                  ...(args.cameraMake !== undefined ? { cameraMake: args.cameraMake } : {}),
                  ...(args.cameraModel !== undefined ? { cameraModel: args.cameraModel } : {}),
                  ...(args.lensModel !== undefined ? { lensModel: args.lensModel } : {}),
                  ...(args.capturedAfter !== undefined
                    ? { capturedAfter: args.capturedAfter }
                    : {}),
                  ...(args.capturedBefore !== undefined
                    ? { capturedBefore: args.capturedBefore }
                    : {}),
                  ...(args.apertureMin !== undefined ? { apertureMin: args.apertureMin } : {}),
                  ...(args.apertureMax !== undefined ? { apertureMax: args.apertureMax } : {}),
                  ...(args.focalLengthMin !== undefined
                    ? { focalLengthMin: args.focalLengthMin }
                    : {}),
                  ...(args.focalLengthMax !== undefined
                    ? { focalLengthMax: args.focalLengthMax }
                    : {}),
                  ...(args.rate !== undefined ? { rate: args.rate } : {}),
                  ...(args.city !== undefined ? { city: args.city } : {}),
                  ...(args.country !== undefined ? { country: args.country } : {}),
                }),
              )
            },
          )
          .command(
            'check',
            'check which local photos are already in Rawback',
            (check) =>
              check
                .option('path', {
                  demandOption: true,
                  describe: 'image/RAW file or directory to scan recursively',
                  type: 'string',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runPhotoCheck } = await import('./photo-check.ts')
              await runCommand(() =>
                runPhotoCheck({
                  json: args.json,
                  path: args.path,
                }),
              )
            },
          )
          .command(
            'upload',
            'upload photos and RAW files over SFTP',
            (upload) =>
              upload
                .option('path', {
                  demandOption: true,
                  describe: 'image/RAW file or directory to scan recursively',
                  type: 'string',
                })
                .option('concurrency', {
                  default: 4,
                  describe: 'number of parallel SFTP transfers',
                  type: 'number',
                })
                .option('dry-run', {
                  default: false,
                  describe: 'show upload count, size, and estimated time without uploading',
                  type: 'boolean',
                })
                .check((args) => {
                  if (
                    !Number.isInteger(args.concurrency) ||
                    args.concurrency < 1 ||
                    args.concurrency > 16
                  ) {
                    throw new Error('--concurrency must be an integer between 1 and 16')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runUpload } = await import('./upload.ts')
              await runCommand(() =>
                runUpload({
                  concurrency: args.concurrency,
                  dryRun: args.dryRun,
                  path: args.path,
                }),
              )
            },
          )
          .demandCommand(1, 'Choose a photos command: search, list, check, or upload')
          .strict(),
      () => {},
    )
    .command(
      'videos',
      'list, upload, and manage videos',
      (command) =>
        command
          .command(
            'list',
            'list videos in the authenticated library',
            (list) =>
              list
                .option('page', {
                  default: 1,
                  describe: 'page number',
                  type: 'number',
                })
                .option('page-size', {
                  default: 24,
                  describe: 'items per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runVideoList } = await import('./videos.ts')
              await runCommand(() =>
                runVideoList({
                  json: args.json,
                  page: args.page,
                  pageSize: args.pageSize,
                }),
              )
            },
          )
          .command(
            'upload',
            'upload a video directly to storage',
            (upload) =>
              upload
                .option('file', {
                  demandOption: true,
                  describe: 'video file to upload',
                  type: 'string',
                })
                .option('thumbnail', {
                  describe: 'JPEG or PNG to use as the poster frame instead of the first frame',
                  type: 'string',
                })
                .option('transcript', {
                  default: true,
                  describe:
                    'extract and upload the audio track so the video can be transcribed. --no-transcript skips it; the audio cannot be added later',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runVideoUpload } = await import('./videos.ts')
              await runCommand(() =>
                runVideoUpload({
                  file: args.file,
                  json: args.json,
                  transcript: args.transcript,
                  ...(args.thumbnail !== undefined ? { thumbnail: args.thumbnail } : {}),
                }),
              )
            },
          )
          .command(
            'update',
            'change a video title or description',
            (update) =>
              update
                .option('id', {
                  demandOption: true,
                  describe: 'video id',
                  type: 'number',
                })
                .option('title', {
                  describe: 'new title',
                  type: 'string',
                })
                .option('description', {
                  describe: 'new description',
                  type: 'string',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runVideoUpdate } = await import('./videos.ts')
              await runCommand(() =>
                runVideoUpdate({
                  id: args.id,
                  json: args.json,
                  ...(args.title !== undefined ? { title: args.title } : {}),
                  ...(args.description !== undefined ? { description: args.description } : {}),
                }),
              )
            },
          )
          .command(
            'delete',
            'delete a video and release its storage',
            (remove) =>
              remove
                .option('id', {
                  demandOption: true,
                  describe: 'video id',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runVideoDelete } = await import('./videos.ts')
              await runCommand(() =>
                runVideoDelete({
                  id: args.id,
                  json: args.json,
                }),
              )
            },
          )
          .demandCommand(1, 'Choose a videos command: list, upload, update, or delete')
          .strict(),
      () => {},
    )
    .command(
      'dream',
      'list, inspect, and retry daily photo recaps',
      (command) =>
        command
          .command(
            'list',
            'list dreams for the authenticated account',
            (list) =>
              list
                .option('page', {
                  default: 1,
                  describe: 'result page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 30,
                  describe: 'dreams per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runDreamList } = await import('./dreams.ts')
              await runCommand(() =>
                runDreamList({
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                }),
              )
            },
          )
          .command(
            ['get <id>', 'view <id>'],
            'show a dream and its contributing photos',
            (get) =>
              get
                .positional('id', {
                  describe: 'dream ID',
                  type: 'number',
                })
                .option('page', {
                  default: 1,
                  describe: 'dream photo page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 24,
                  describe: 'dream photos per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runDreamGet } = await import('./dreams.ts')
              await runCommand(() =>
                runDreamGet({
                  id: args.id!,
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                }),
              )
            },
          )
          .command(
            'retry <id>',
            'retry a failed dream',
            (retry) =>
              retry
                .positional('id', {
                  describe: 'dream ID',
                  type: 'number',
                })
                .option('force', {
                  default: false,
                  describe: 'retry without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runDreamRetry } = await import('./dreams.ts')
              await runCommand(
                () =>
                  runDreamRetry({
                    id: args.id!,
                    force: args.force,
                    json: args.json,
                  }),
                'Dream retry cancelled.',
              )
            },
          )
          .demandCommand(1, 'Choose a dream command: list, get, view, or retry')
          .strict(),
      () => {},
    )
    .command(
      'album',
      'manage albums and album articles',
      (command) =>
        command
          .command(
            'list',
            'list albums for the authenticated account',
            (list) =>
              list
                .option('search', {
                  describe: 'search non-secret albums by name',
                  type: 'string',
                })
                .option('page', {
                  default: 1,
                  describe: 'result page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 20,
                  describe: 'albums per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumList } = await import('./albums.ts')
              await runCommand(() =>
                runAlbumList({
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                  ...(args.search !== undefined ? { search: args.search } : {}),
                }),
              )
            },
          )
          .command(
            'view <id>',
            'show an album and its photos',
            (view) =>
              view
                .positional('id', {
                  describe: 'album ID',
                  type: 'number',
                })
                .option('page', {
                  default: 1,
                  describe: 'album image page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 24,
                  describe: 'album images per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumView } = await import('./albums.ts')
              await runCommand(() =>
                runAlbumView({
                  id: args.id!,
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                }),
              )
            },
          )
          .command(
            'create',
            'create an album',
            (create) =>
              albumMetadataOptions(
                create
                  .option('name', {
                    demandOption: true,
                    describe: 'album name',
                    type: 'string',
                  })
                  .option('json', {
                    default: false,
                    describe: 'output machine-readable JSON',
                    type: 'boolean',
                  }),
              ).default('permission', 'private'),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumCreate } = await import('./albums.ts')
              await runCommand(() =>
                runAlbumCreate({
                  name: args.name,
                  permission: args.permission,
                  json: args.json,
                  ...(args.description !== undefined ? { description: args.description } : {}),
                  ...(args.tagId !== undefined ? { tagId: args.tagId } : {}),
                  ...(args.dateFrom !== undefined ? { dateFrom: args.dateFrom } : {}),
                  ...(args.dateTo !== undefined ? { dateTo: args.dateTo } : {}),
                  ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
                  ...(args.cameraId !== undefined ? { cameraId: args.cameraId } : {}),
                  ...(args.lensId !== undefined ? { lensId: args.lensId } : {}),
                }),
              )
            },
          )
          .command(
            'edit <id>',
            'edit album metadata and smart filters',
            (edit) =>
              albumMetadataOptions(
                edit
                  .positional('id', {
                    describe: 'album ID',
                    type: 'number',
                  })
                  .option('name', {
                    describe: 'album name',
                    type: 'string',
                  })
                  .option('cover-image-id', {
                    describe: 'cover image ID',
                    type: 'number',
                  })
                  .option('clear-tags', {
                    default: false,
                    describe: 'remove all smart-filter tags',
                    type: 'boolean',
                  })
                  .option('clear-date-from', {
                    default: false,
                    describe: 'clear the smart-filter start date',
                    type: 'boolean',
                  })
                  .option('clear-date-to', {
                    default: false,
                    describe: 'clear the smart-filter end date',
                    type: 'boolean',
                  })
                  .option('clear-timezone', {
                    default: false,
                    describe: 'clear the smart-filter timezone',
                    type: 'boolean',
                  })
                  .option('clear-camera', {
                    default: false,
                    describe: 'clear the smart-filter camera',
                    type: 'boolean',
                  })
                  .option('clear-lens', {
                    default: false,
                    describe: 'clear the smart-filter lens',
                    type: 'boolean',
                  })
                  .option('json', {
                    default: false,
                    describe: 'output machine-readable JSON',
                    type: 'boolean',
                  }),
              ),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumEdit } = await import('./albums.ts')
              await runCommand(() =>
                runAlbumEdit({
                  id: args.id!,
                  json: args.json,
                  clearTags: args.clearTags,
                  clearDateFrom: args.clearDateFrom,
                  clearDateTo: args.clearDateTo,
                  clearTimezone: args.clearTimezone,
                  clearCamera: args.clearCamera,
                  clearLens: args.clearLens,
                  ...(args.name !== undefined ? { name: args.name } : {}),
                  ...(args.description !== undefined ? { description: args.description } : {}),
                  ...(args.permission !== undefined ? { permission: args.permission } : {}),
                  ...(args.coverImageId !== undefined ? { coverImageId: args.coverImageId } : {}),
                  ...(args.tagId !== undefined ? { tagId: args.tagId } : {}),
                  ...(args.dateFrom !== undefined ? { dateFrom: args.dateFrom } : {}),
                  ...(args.dateTo !== undefined ? { dateTo: args.dateTo } : {}),
                  ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
                  ...(args.cameraId !== undefined ? { cameraId: args.cameraId } : {}),
                  ...(args.lensId !== undefined ? { lensId: args.lensId } : {}),
                }),
              )
            },
          )
          .command(
            'delete <id>',
            'delete an album',
            (remove) =>
              remove
                .positional('id', {
                  describe: 'album ID',
                  type: 'number',
                })
                .option('force', {
                  default: false,
                  describe: 'delete without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumDelete } = await import('./albums.ts')
              await runCommand(
                () => runAlbumDelete({ id: args.id!, force: args.force, json: args.json }),
                'Album operation cancelled.',
              )
            },
          )
          .command(
            'refresh <id>',
            'recollect the photos matching an album smart filter',
            (refresh) =>
              refresh
                .positional('id', {
                  describe: 'album ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runAlbumRefresh } = await import('./albums.ts')
              await runCommand(
                () => runAlbumRefresh({ id: args.id!, json: args.json }),
                'Album operation cancelled.',
              )
            },
          )
          .command(
            'image',
            'manage album photo membership',
            (image) =>
              image
                .command(
                  'add <album-id> <image-id>',
                  'add a photo to an album',
                  (add) =>
                    add
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .positional('image-id', {
                        describe: 'image ID',
                        type: 'number',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runAlbumImageAdd } = await import('./albums.ts')
                    await runCommand(() =>
                      runAlbumImageAdd({
                        albumId: args.albumId!,
                        imageId: args.imageId!,
                        json: args.json,
                      }),
                    )
                  },
                )
                .command(
                  'remove <album-id> <image-id>',
                  'remove a photo from an album',
                  (remove) =>
                    remove
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .positional('image-id', {
                        describe: 'image ID',
                        type: 'number',
                      })
                      .option('force', {
                        default: false,
                        describe: 'remove without confirmation',
                        type: 'boolean',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runAlbumImageRemove } = await import('./albums.ts')
                    await runCommand(
                      () =>
                        runAlbumImageRemove({
                          albumId: args.albumId!,
                          imageId: args.imageId!,
                          force: args.force,
                          json: args.json,
                        }),
                      'Album operation cancelled.',
                    )
                  },
                )
                .demandCommand(1, 'Choose an album image command: add or remove')
                .strict(),
            () => {},
          )
          .command(
            'tag',
            'manage album smart-filter tags',
            (tag) =>
              tag
                .command(
                  'add <album-id> <tag-ids..>',
                  'add one or more tags to an album',
                  (add) =>
                    add
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .positional('tag-ids', {
                        array: true,
                        describe: 'tag IDs',
                        type: 'string',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runAlbumTagAdd } = await import('./albums.ts')
                    await runCommand(() =>
                      runAlbumTagAdd({
                        albumId: args.albumId!,
                        tagIds: args.tagIds ?? [],
                        json: args.json,
                      }),
                    )
                  },
                )
                .command(
                  'remove <album-id> <tag-ids..>',
                  'remove one or more tags from an album',
                  (remove) =>
                    remove
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .positional('tag-ids', {
                        array: true,
                        describe: 'tag IDs',
                        type: 'string',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runAlbumTagRemove } = await import('./albums.ts')
                    await runCommand(() =>
                      runAlbumTagRemove({
                        albumId: args.albumId!,
                        tagIds: args.tagIds ?? [],
                        json: args.json,
                      }),
                    )
                  },
                )
                .demandCommand(1, 'Choose an album tag command: add or remove')
                .strict(),
            () => {},
          )
          .command(
            'article',
            'manage album articles',
            (article) =>
              article
                .command(
                  'list',
                  'list album articles',
                  (list) =>
                    list
                      .option('page', {
                        default: 1,
                        describe: 'result page',
                        type: 'number',
                      })
                      .option('page-size', {
                        default: 12,
                        describe: 'articles per page (1-100)',
                        type: 'number',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticleList } = await import('./articles.ts')
                    await runCommand(() =>
                      runArticleList({
                        page: args.page,
                        pageSize: args.pageSize,
                        json: args.json,
                      }),
                    )
                  },
                )
                .command(
                  'view <album-id>',
                  'show an album article',
                  (view) =>
                    view
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .option('content-only', {
                        default: false,
                        describe: 'output only stored Markdown content',
                        type: 'boolean',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      })
                      .conflicts('content-only', 'json'),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticleView } = await import('./articles.ts')
                    await runCommand(() =>
                      runArticleView({
                        albumId: args.albumId!,
                        contentOnly: args.contentOnly,
                        json: args.json,
                      }),
                    )
                  },
                )
                .command(
                  'edit <album-id>',
                  'create or edit an album article',
                  (edit) =>
                    edit
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .option('title', {
                        describe: 'article title',
                        type: 'string',
                      })
                      .option('content-file', {
                        describe: 'Markdown file, or - to read stdin',
                        type: 'string',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      })
                      .check((args) => {
                        if (args.title === undefined && args.contentFile === undefined) {
                          throw new Error(
                            'rawback album article edit requires --title or --content-file',
                          )
                        }
                        return true
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticleEdit } = await import('./articles.ts')
                    await runCommand(() =>
                      runArticleEdit({
                        albumId: args.albumId!,
                        json: args.json,
                        ...(args.title !== undefined ? { title: args.title } : {}),
                        ...(args.contentFile !== undefined
                          ? { contentFile: args.contentFile }
                          : {}),
                      }),
                    )
                  },
                )
                .command(
                  'publish <album-id>',
                  'publish an album article',
                  (publish) =>
                    publish
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticlePublish } = await import('./articles.ts')
                    await runCommand(() =>
                      runArticlePublish({ albumId: args.albumId!, json: args.json }),
                    )
                  },
                )
                .command(
                  'unpublish <album-id>',
                  'return an album article to draft',
                  (unpublish) =>
                    unpublish
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticleUnpublish } = await import('./articles.ts')
                    await runCommand(() =>
                      runArticleUnpublish({ albumId: args.albumId!, json: args.json }),
                    )
                  },
                )
                .command(
                  'delete <album-id>',
                  'delete an album article',
                  (remove) =>
                    remove
                      .positional('album-id', {
                        describe: 'album ID',
                        type: 'number',
                      })
                      .option('force', {
                        default: false,
                        describe: 'delete without confirmation',
                        type: 'boolean',
                      })
                      .option('json', {
                        default: false,
                        describe: 'output machine-readable JSON',
                        type: 'boolean',
                      }),
                  async (args) => {
                    if (process.exitCode !== undefined && process.exitCode !== 0) return
                    const { runArticleDelete } = await import('./articles.ts')
                    await runCommand(
                      () =>
                        runArticleDelete({
                          albumId: args.albumId!,
                          force: args.force,
                          json: args.json,
                        }),
                      'Article operation cancelled.',
                    )
                  },
                )
                .demandCommand(
                  1,
                  'Choose an album article command: list, view, edit, publish, unpublish, or delete',
                )
                .strict(),
            () => {},
          )
          .demandCommand(
            1,
            'Choose an album command: list, view, create, edit, delete, refresh, image, tag, or article',
          )
          .strict(),
      () => {},
    )
    .command(
      'shares',
      'browse incoming shares and manage links shared with others',
      (command) =>
        command
          .command(
            'list',
            'list shares for the authenticated account',
            (list) =>
              list
                .option('scope', {
                  choices: ['by-me', 'with-me'] as const,
                  default: 'by-me' as const,
                  describe: 'list shares you sent or resources shared with you',
                  type: 'string',
                })
                .option('type', {
                  choices: ['photo', 'album', 'dream'] as const,
                  describe: 'filter by shared resource type',
                  type: 'string',
                })
                .option('kind', {
                  choices: ['link', 'direct'] as const,
                  describe: 'filter outgoing shares by link or direct grant',
                  type: 'string',
                })
                .option('status', {
                  choices: ['active', 'archived'] as const,
                  describe: 'filter outgoing shares by status (default: active)',
                  type: 'string',
                })
                .option('enabled', {
                  describe: 'filter enabled links (use --no-enabled for disabled links)',
                  type: 'boolean',
                })
                .option('access', {
                  choices: ['public', 'restricted'] as const,
                  describe: 'filter links by access type',
                  type: 'string',
                })
                .option('expiry', {
                  choices: ['valid', 'expired', 'never'] as const,
                  describe: 'filter links by expiration state',
                  type: 'string',
                })
                .option('after', {
                  describe: 'created on/after an ISO date/time or Unix timestamp',
                  type: 'string',
                })
                .option('before', {
                  describe: 'created on/before an ISO date/time or Unix timestamp',
                  type: 'string',
                })
                .option('page', {
                  default: 1,
                  describe: 'result page',
                  type: 'number',
                })
                .option('page-size', {
                  default: 20,
                  describe: 'shares per page (1-100)',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareList } = await import('./shares.ts')
              await runCommand(() =>
                runShareList({
                  scope: args.scope,
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                  ...(args.type !== undefined ? { type: args.type } : {}),
                  ...(args.kind !== undefined ? { kind: args.kind } : {}),
                  ...(args.status !== undefined ? { status: args.status } : {}),
                  ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
                  ...(args.access !== undefined ? { access: args.access } : {}),
                  ...(args.expiry !== undefined ? { expiry: args.expiry } : {}),
                  ...(args.after !== undefined ? { after: args.after } : {}),
                  ...(args.before !== undefined ? { before: args.before } : {}),
                }),
              )
            },
          )
          .command(
            ['get <share-id>', 'view <share-id>'],
            'show a link share and its settings',
            (get) =>
              get
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareGet } = await import('./shares.ts')
              await runCommand(() => runShareGet({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'archive <share-id>',
            'move a link share to the archive without disabling it',
            (archive) =>
              archive
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareArchive } = await import('./shares.ts')
              await runCommand(() => runShareArchive({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'unarchive <share-id>',
            'return an archived link share to the active list',
            (unarchive) =>
              unarchive
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareUnarchive } = await import('./shares.ts')
              await runCommand(() => runShareUnarchive({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'enable <share-id>',
            'enable an unexpired link share',
            (enable) =>
              enable
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareEnable } = await import('./shares.ts')
              await runCommand(() => runShareEnable({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'disable <share-id>',
            'disable access through a link share',
            (disable) =>
              disable
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareDisable } = await import('./shares.ts')
              await runCommand(() => runShareDisable({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'delete <share-id>',
            'permanently delete a link share',
            (remove) =>
              remove
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('force', {
                  default: false,
                  describe: 'delete without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  if (!args.force && (!process.stdin.isTTY || !process.stdout.isTTY)) {
                    throw new Error(
                      'Deleting a share requires an interactive terminal unless --force is provided.',
                    )
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareDelete } = await import('./shares.ts')
              await runCommand(
                () =>
                  runShareDelete({
                    id: args.shareId!,
                    force: args.force,
                    json: args.json,
                  }),
                'Share operation cancelled.',
              )
            },
          )
          .command(
            'recipients <share-id>',
            'list email recipients for a link share',
            (recipients) =>
              recipients
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareRecipients } = await import('./shares.ts')
              await runCommand(() => runShareRecipients({ id: args.shareId!, json: args.json }))
            },
          )
          .command(
            'link <share-id>',
            'print or copy a link share URL',
            (link) =>
              link
                .positional('share-id', {
                  describe: 'link share ID',
                  type: 'number',
                })
                .option('copy', {
                  default: false,
                  describe: 'copy the URL to the system clipboard',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runShareLink } = await import('./shares.ts')
              await runCommand(() =>
                runShareLink({ id: args.shareId!, copy: args.copy, json: args.json }),
              )
            },
          )
          .demandCommand(
            1,
            'Choose a shares command: list, get, archive, unarchive, enable, disable, delete, recipients, or link',
          )
          .strict(),
      () => {},
    )
    .command(
      'uploads',
      'list FTP and SFTP upload sessions',
      (command) =>
        command
          .option('status', {
            choices: ['in_progress', 'completed', 'failed'] as const,
            describe: 'filter by upload status',
            type: 'string',
          })
          .option('page', {
            default: 1,
            describe: 'result page',
            type: 'number',
          })
          .option('page-size', {
            default: 20,
            describe: 'upload sessions per page (1-100)',
            type: 'number',
          })
          .option('json', {
            default: false,
            describe: 'output machine-readable JSON',
            type: 'boolean',
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runUploadSessionList } = await import('./uploads.ts')
        await runCommand(() =>
          runUploadSessionList({
            page: args.page,
            pageSize: args.pageSize,
            json: args.json,
            ...(args.status !== undefined ? { status: args.status } : {}),
          }),
        )
      },
    )
    .command(
      'usage',
      'show storage, AI credit, and face recognition usage',
      (command) =>
        command
          .option('detail', {
            default: false,
            describe: 'add daily charts, recent AI operations, and top lists',
            type: 'boolean',
          })
          .option('json', {
            default: false,
            describe: 'output machine-readable JSON',
            type: 'boolean',
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runUsage } = await import('./usage.ts')
        await runCommand(() => runUsage({ detail: args.detail, json: args.json }))
      },
    )
    .command(
      'memory',
      'show the photography profile Rawback maintains for you',
      (command) =>
        command.option('json', {
          default: false,
          describe: 'output machine-readable JSON',
          type: 'boolean',
        }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runMemory } = await import('./memory.ts')
        await runCommand(() => runMemory({ json: args.json }))
      },
    )
    .command(
      'pricing',
      'show Rawback plans and add-ons',
      (command) =>
        command
          .option('interval', {
            choices: ['all', 'month', 'year'] as const,
            default: 'all' as const,
            describe: 'filter plans by billing interval',
            type: 'string',
          })
          .option('json', {
            default: false,
            describe: 'output machine-readable JSON',
            type: 'boolean',
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runPricing } = await import('./pricing.ts')
        await runCommand(() => runPricing({ interval: args.interval, json: args.json }))
      },
    )
    .command(
      'camera',
      'control a Canon camera over CCAPI',
      (command) =>
        command
          .command(
            'connect [url]',
            'connect to a camera and save it',
            (connect) =>
              cameraTargetOptions(connect)
                .positional('url', {
                  describe: 'camera URL, e.g. http://user:password@192.168.0.1:8080',
                  type: 'string',
                })
                .option('name', {
                  describe: 'label for the saved camera (defaults to the model name)',
                  type: 'string',
                })
                .option('save-password', {
                  default: false,
                  describe: 'store the CCAPI password in ~/.rawback/cameras.json',
                  type: 'boolean',
                })
                .option('default', {
                  default: true,
                  describe: 'target this camera when no --camera is given',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (args.url !== undefined && args.camera !== undefined) {
                    throw new Error('rawback camera connect takes a URL or --camera, not both')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraConnect } = await import('./camera.ts')
              await runCommand(
                () =>
                  runCameraConnect({
                    insecure: args.insecure,
                    timeout: args.timeout,
                    refresh: args.refresh,
                    json: args.json,
                    savePassword: args.savePassword,
                    makeDefault: args.default,
                    ...(args.url !== undefined ? { url: args.url } : {}),
                    ...(args.camera !== undefined ? { camera: args.camera } : {}),
                    ...(args.name !== undefined ? { name: args.name } : {}),
                  }),
                'Camera connection cancelled.',
              )
            },
          )
          .command(
            'list',
            'list saved cameras',
            (list) =>
              list.option('json', {
                default: false,
                describe: 'output machine-readable JSON',
                type: 'boolean',
              }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraList } = await import('./camera.ts')
              await runCommand(
                () => runCameraList({ json: args.json }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            'use <id>',
            'target a saved camera by default',
            (use) =>
              use
                .positional('id', { describe: 'saved camera ID (host:port)', type: 'string' })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraUse } = await import('./camera.ts')
              await runCommand(
                () => runCameraUse({ id: args.id as string, json: args.json }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            'forget <id>',
            'remove a saved camera',
            (forget) =>
              forget
                .positional('id', { describe: 'saved camera ID (host:port)', type: 'string' })
                .option('force', {
                  default: false,
                  describe: 'remove without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  if (!args.force && !process.stdin.isTTY) {
                    throw new Error(
                      'rawback camera forget needs an interactive terminal unless --force is provided',
                    )
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraForget } = await import('./camera.ts')
              await runCommand(
                () =>
                  runCameraForget({ id: args.id as string, force: args.force, json: args.json }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            'info',
            'show camera model, firmware, lens, and storage',
            (info) =>
              cameraTargetOptions(info)
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check(checkCameraTarget),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraInfo } = await import('./camera.ts')
              await runCommand(
                () =>
                  runCameraInfo({
                    insecure: args.insecure,
                    timeout: args.timeout,
                    refresh: args.refresh,
                    json: args.json,
                    ...(args.camera !== undefined ? { camera: args.camera } : {}),
                  }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            'status',
            'show battery, temperature, storage, and remaining capacity',
            (status) =>
              cameraTargetOptions(status)
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check(checkCameraTarget),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraStatus } = await import('./camera.ts')
              await runCommand(
                () =>
                  runCameraStatus({
                    insecure: args.insecure,
                    timeout: args.timeout,
                    refresh: args.refresh,
                    json: args.json,
                    ...(args.camera !== undefined ? { camera: args.camera } : {}),
                  }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            'shoot',
            'release the shutter',
            (shoot) =>
              cameraTargetOptions(shoot)
                .option('af', {
                  default: true,
                  describe: 'autofocus before releasing',
                  type: 'boolean',
                })
                .option('manual', {
                  choices: ['half_press', 'full_press', 'release'] as const,
                  describe: 'drive the shutter button by phase instead of a single release',
                  type: 'string',
                })
                .option('force', {
                  default: false,
                  describe: 'shoot without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  return checkMutatingIsNonInteractive(args, 'rawback camera shoot')
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraShoot } = await import('./camera.ts')
              await runCommand(
                () =>
                  runCameraShoot({
                    ...cameraTargetArgs(args),
                    af: args.af,
                    force: args.force,
                    ...(args.manual !== undefined ? { manual: args.manual } : {}),
                  }),
                'Shot cancelled.',
              )
            },
          )
          .command(
            'settings <action> [name] [value]',
            'read and change shooting settings',
            (settings) =>
              cameraTargetOptions(settings)
                .positional('action', {
                  choices: ['list', 'get', 'set'] as const,
                  describe: 'settings action',
                  type: 'string',
                })
                .positional('name', { describe: 'setting name, e.g. av', type: 'string' })
                .positional('value', { describe: 'new value', type: 'string' })
                .option('int', {
                  default: false,
                  describe: 'treat the value as an integer',
                  type: 'boolean',
                })
                .option('force', {
                  default: false,
                  describe: 'change the setting without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (args.action === 'list' && args.name !== undefined) {
                    throw new Error('rawback camera settings list does not take a setting name')
                  }
                  if (args.action !== 'list' && args.name === undefined) {
                    throw new Error(
                      `rawback camera settings ${args.action} requires a setting name`,
                    )
                  }
                  if (args.action === 'set') {
                    if (args.value === undefined) {
                      throw new Error('rawback camera settings set requires a value')
                    }
                    return checkMutatingIsNonInteractive(args, 'rawback camera settings set')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const settings = await import('./camera-settings.ts')
              const target = cameraTargetArgs(args)
              if (args.action === 'list') {
                await runCommand(
                  () => settings.runCameraSettingsList(target),
                  'Camera command cancelled.',
                )
                return
              }
              if (args.action === 'get') {
                await runCommand(
                  () => settings.runCameraSettingsGet({ ...target, name: args.name as string }),
                  'Camera command cancelled.',
                )
                return
              }
              await runCommand(
                () =>
                  settings.runCameraSettingsSet({
                    ...target,
                    name: args.name as string,
                    value: args.value as string,
                    int: args.int,
                    force: args.force,
                  }),
                'Setting change cancelled.',
              )
            },
          )
          .command(
            'contents <action> [a] [b]',
            'browse and download photos on the card',
            (contents) =>
              cameraTargetOptions(contents)
                .positional('action', {
                  choices: ['storages', 'dirs', 'list', 'info', 'get', 'delete'] as const,
                  describe: 'contents action',
                  type: 'string',
                })
                .positional('a', {
                  describe: 'storage name (dirs, list) or content locator (info, get, delete)',
                  type: 'string',
                })
                .positional('b', { describe: 'directory name, for list', type: 'string' })
                .option('type', {
                  choices: [
                    'all',
                    'jpeg',
                    'hif',
                    'cr2',
                    'cr3',
                    'wav',
                    'mp4',
                    'mov',
                    'crm',
                  ] as const,
                  describe: 'filter the listing by file type',
                  type: 'string',
                })
                .option('order', {
                  choices: ['asc', 'desc'] as const,
                  describe: 'listing order, with --all',
                  type: 'string',
                })
                .option('page', {
                  default: 1,
                  describe: 'listing page (100 per page)',
                  type: 'number',
                })
                .option('all', {
                  default: false,
                  describe: 'stream every page instead of one',
                  type: 'boolean',
                })
                .option('output', {
                  alias: 'o',
                  describe: 'destination file or directory, for get',
                  type: 'string',
                })
                .option('kind', {
                  choices: ['main', 'thumbnail', 'display', 'embedded'] as const,
                  describe: 'which rendition to download',
                  type: 'string',
                })
                .option('overwrite', {
                  default: false,
                  describe: 'replace an existing destination file',
                  type: 'boolean',
                })
                .option('force', {
                  default: false,
                  describe: 'delete without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (['dirs', 'list', 'info', 'get', 'delete'].includes(String(args.action))) {
                    if (args.a === undefined) {
                      throw new Error(
                        args.action === 'dirs' || args.action === 'list'
                          ? `rawback camera contents ${args.action} requires a storage name`
                          : `rawback camera contents ${args.action} requires a content locator`,
                      )
                    }
                  }
                  if (args.action === 'list' && args.b === undefined) {
                    throw new Error('rawback camera contents list requires a directory name')
                  }
                  if (args.action === 'get' && args.output === undefined) {
                    throw new Error('rawback camera contents get requires --output')
                  }
                  if (!Number.isSafeInteger(args.page) || args.page < 1) {
                    throw new Error('--page must be a positive whole number')
                  }
                  if (args.action === 'delete') {
                    return checkMutatingIsNonInteractive(args, 'rawback camera contents delete')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const contents = await import('./camera-contents.ts')
              const target = cameraTargetArgs(args)
              const first = args.a as string
              switch (args.action) {
                case 'storages':
                  await runCommand(() => contents.runCameraContentsStorages(target))
                  return
                case 'dirs':
                  await runCommand(() =>
                    contents.runCameraContentsDirs({ ...target, storage: first }),
                  )
                  return
                case 'info':
                  await runCommand(() =>
                    contents.runCameraContentsInfo({ ...target, locator: first }),
                  )
                  return
                case 'get':
                  await runCommand(() =>
                    contents.runCameraContentsGet({
                      ...target,
                      locator: first,
                      output: args.output as string,
                      overwrite: args.overwrite,
                      ...(args.kind !== undefined ? { kind: args.kind } : {}),
                    }),
                  )
                  return
                case 'delete':
                  await runCommand(
                    () =>
                      contents.runCameraContentsDelete({
                        ...target,
                        locator: first,
                        force: args.force,
                      }),
                    'Deletion cancelled.',
                  )
                  return
                default:
                  await runCommand(() =>
                    contents.runCameraContentsList({
                      ...target,
                      storage: first,
                      directory: args.b as string,
                      page: args.page,
                      all: args.all,
                      ...(args.type !== undefined ? { type: args.type } : {}),
                      ...(args.order !== undefined ? { order: args.order } : {}),
                    }),
                  )
              }
            },
          )
          .command(
            'liveview <action> [output]',
            'start, capture, stream, and stop live view',
            (liveview) =>
              cameraTargetOptions(liveview)
                .positional('action', {
                  choices: ['start', 'stop', 'frame', 'stream'] as const,
                  describe: 'live view action',
                  type: 'string',
                })
                .positional('output', {
                  describe: 'destination file, for frame',
                  type: 'string',
                })
                .option('size', {
                  choices: ['off', 'small', 'medium'] as const,
                  default: 'small',
                  describe: 'live view image size',
                  type: 'string',
                })
                .option('display', {
                  choices: ['on', 'keep', 'off'] as const,
                  default: 'keep',
                  describe: "what the camera's own screen does",
                  type: 'string',
                })
                .option('output-dir', {
                  describe: 'directory for streamed frames, or - for stdout',
                  type: 'string',
                })
                .option('frames', { describe: 'stop after this many frames', type: 'number' })
                .option('duration', { describe: 'stop after this many seconds', type: 'number' })
                .option('force', {
                  default: false,
                  describe: 'start without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (args.action === 'frame' && args.output === undefined) {
                    throw new Error('rawback camera liveview frame requires an output file')
                  }
                  if (args.action === 'stream') {
                    if (args.outputDir === undefined) {
                      throw new Error(
                        'rawback camera liveview stream requires --output-dir <dir> (or --output-dir - for stdout)',
                      )
                    }
                    if (args.outputDir === '-' && args.json) {
                      throw new Error(
                        'rawback camera liveview stream --output-dir - writes raw JPEG to stdout and cannot also emit --json',
                      )
                    }
                  }
                  if (args.action === 'start') {
                    return checkMutatingIsNonInteractive(args, 'rawback camera liveview start')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const liveview = await import('./camera-liveview.ts')
              const target = cameraTargetArgs(args)
              switch (args.action) {
                case 'stop':
                  await runCommand(() => liveview.runCameraLiveviewStop(target))
                  return
                case 'frame':
                  await runCommand(() =>
                    liveview.runCameraLiveviewFrame({
                      ...target,
                      output: args.output as string,
                    }),
                  )
                  return
                case 'stream':
                  await runCommand(
                    () =>
                      liveview.runCameraLiveviewStream({
                        ...target,
                        size: args.size,
                        display: args.display,
                        outputDir: args.outputDir as string,
                        ...(args.frames !== undefined ? { frames: args.frames } : {}),
                        ...(args.duration !== undefined ? { duration: args.duration } : {}),
                      }),
                    'Live view stopped.',
                  )
                  return
                default:
                  await runCommand(
                    () =>
                      liveview.runCameraLiveviewStart({
                        ...target,
                        size: args.size,
                        display: args.display,
                        force: args.force,
                      }),
                    'Live view cancelled.',
                  )
              }
            },
          )
          .command(
            'events <action>',
            'poll, watch, and clear camera events',
            (events) =>
              cameraTargetOptions(events)
                .positional('action', {
                  choices: ['poll', 'watch', 'clear'] as const,
                  describe: 'event action',
                  type: 'string',
                })
                .option('wait', {
                  default: false,
                  describe: 'hold the connection until something changes',
                  type: 'boolean',
                })
                .option('timeout-kind', {
                  choices: ['short', 'long'] as const,
                  describe: 'how long the camera holds a waiting poll',
                  type: 'string',
                })
                .option('count', { describe: 'stop after this many events', type: 'number' })
                .option('duration', { describe: 'stop after this many seconds', type: 'number' })
                .option('force', {
                  default: false,
                  describe: 'clear without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON (NDJSON for watch)',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (args.action === 'clear') {
                    return checkMutatingIsNonInteractive(args, 'rawback camera events clear')
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const events = await import('./camera-events.ts')
              const target = cameraTargetArgs(args)
              switch (args.action) {
                case 'watch':
                  await runCommand(
                    () =>
                      events.runCameraEventsWatch({
                        ...target,
                        ...(args.count !== undefined ? { count: args.count } : {}),
                        ...(args.duration !== undefined ? { duration: args.duration } : {}),
                      }),
                    'Stopped watching.',
                  )
                  return
                case 'clear':
                  await runCommand(
                    () => events.runCameraEventsClear({ ...target, force: args.force }),
                    'Camera command cancelled.',
                  )
                  return
                default:
                  await runCommand(() =>
                    events.runCameraEventsPoll({
                      ...target,
                      wait: args.wait,
                      ...(args.timeoutKind !== undefined ? { timeoutKind: args.timeoutKind } : {}),
                    }),
                  )
              }
            },
          )
          .command(
            'api [id]',
            'run any CCAPI endpoint by ID',
            (endpoint) =>
              cameraTargetOptions(endpoint)
                .positional('id', {
                  describe: 'endpoint ID, e.g. status.getBattery',
                  type: 'string',
                })
                .option('list', {
                  default: false,
                  describe: 'list every endpoint instead of running one',
                  type: 'boolean',
                })
                .option('namespace', { describe: 'filter --list by namespace', type: 'string' })
                .option('mutating', {
                  describe: 'filter --list to endpoints that do (or do not) change the camera',
                  type: 'boolean',
                })
                .option('describe', {
                  default: false,
                  describe: 'show an endpoint without calling the camera',
                  type: 'boolean',
                })
                .option('arg', {
                  array: true,
                  describe: 'endpoint argument as key=value (repeat for more)',
                  type: 'string',
                })
                .option('force', {
                  default: false,
                  describe: 'run a state-changing endpoint without confirmation',
                  type: 'boolean',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                })
                .check((args) => {
                  checkCameraTarget(args)
                  if (args.list && args.id !== undefined) {
                    throw new Error('rawback camera api takes an endpoint ID or --list, not both')
                  }
                  if (!args.list && args.id === undefined) {
                    throw new Error('rawback camera api needs an endpoint ID, or --list')
                  }
                  for (const pair of args.arg ?? []) {
                    if (!pair.includes('=')) {
                      throw new Error(`--arg must be key=value; got ${JSON.stringify(pair)}`)
                    }
                  }
                  return true
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraApi } = await import('./camera-api.ts')
              await runCommand(
                () =>
                  runCameraApi({
                    ...cameraTargetArgs(args),
                    list: args.list,
                    describe: args.describe,
                    force: args.force,
                    ...(args.id !== undefined ? { id: args.id } : {}),
                    ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
                    ...(args.mutating !== undefined ? { mutating: args.mutating } : {}),
                    ...(args.arg !== undefined ? { arg: args.arg } : {}),
                  }),
                'Camera command cancelled.',
              )
            },
          )
          .command(
            ['interactive', 'tui'],
            'browse and run endpoints in a full-screen explorer',
            (interactive) =>
              cameraTargetOptions(interactive).check((args) => {
                checkCameraTarget(args)
                if (!process.stdin.isTTY || !process.stdout.isTTY) {
                  throw new Error(
                    'rawback camera interactive needs an interactive terminal; use rawback camera api in a script',
                  )
                }
                return true
              }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runCameraInteractive } = await import('./camera-interactive.ts')
              await runCommand(
                () => runCameraInteractive(cameraTargetArgs(args)),
                'Explorer closed.',
              )
            },
          )
          .demandCommand(
            1,
            'Choose a camera command: connect, list, use, forget, info, status, shoot, settings, contents, liveview, events, api, or interactive',
          )
          .strict(),
      () => {},
    )
    .command(
      'config',
      'inspect local configuration',
      (command) =>
        command
          .command(
            'view',
            'view the local configuration',
            (view) =>
              view.option('json', {
                default: false,
                describe: 'output machine-readable JSON',
                type: 'boolean',
              }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runConfigView } = await import('./config-view.ts')
              await runCommand(() => runConfigView({ json: args.json }))
            },
          )
          .command(
            'env <subcommand>',
            'list the configured environments',
            (environment) =>
              environment
                .positional('subcommand', {
                  choices: ['list'] as const,
                  describe: 'environment action',
                  type: 'string',
                })
                .option('json', {
                  default: false,
                  describe: 'output machine-readable JSON',
                  type: 'boolean',
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runConfigEnvList } = await import('./config-env.ts')
              await runCommand(() => runConfigEnvList({ json: args.json }))
            },
          )
          .command(
            'use <environment>',
            'save the environment later commands should use',
            (use) =>
              use.positional('environment', {
                describe: 'environment name from config.yml, or default',
                type: 'string',
              }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return
              const { runConfigUse } = await import('./config-env.ts')
              await runCommand(() => runConfigUse(args.environment as string))
            },
          )
          .demandCommand(1, 'Choose a config command: view, env, or use')
          .strict(),
      () => {},
    )
    .command(
      'web',
      'open your Rawback profile in a web browser',
      () => {},
      async () => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runWeb } = await import('./web.ts')
        await runCommand(() => runWeb())
      },
    )
    .strict()
    .fail((message, error) => {
      output.error(error ? describeError(error) : message, "Run 'rawback --help' for usage.")
      process.exitCode = 1
    })
}
