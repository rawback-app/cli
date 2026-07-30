import yargs from 'yargs'
import type { Argv } from 'yargs'

import { CommandOutput } from './ui/output.tsx'

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
    output.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
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
      'list and upload photos',
      (command) =>
        command
          .command(
            'list',
            'list photos in the authenticated library',
            (list) =>
              list
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
                  describe: 'number of parallel uploads',
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
          .demandCommand(1, 'Choose a photos command: list or upload')
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
            'Choose an album command: list, view, create, edit, delete, image, tag, or article',
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
        command.option('json', {
          default: false,
          describe: 'output machine-readable JSON',
          type: 'boolean',
        }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return
        const { runUsage } = await import('./usage.ts')
        await runCommand(() => runUsage({ json: args.json }))
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
          .demandCommand(1, 'Choose a config command: view')
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
      output.error(error?.message ?? message, "Run 'rawback --help' for usage.")
      process.exitCode = 1
    })
}
