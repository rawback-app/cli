import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { UploadLedger, uploadLedgerScope, type UploadIdentityExtractor } from '@rawback/sdk'

import type { RawbackClient } from '../src/client.ts'
import type {
  SftpClientOptions,
  UploadTransport,
  UploadTransportFactory,
} from '../src/sftp-client.ts'
import { runUpload, scanUploadPath, SUPPORTED_UPLOAD_EXTENSIONS } from '../src/upload.ts'

const EXPECTED_UPLOAD_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.bmp',
  '.avif',
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.dng',
  '.raf',
  '.orf',
  '.pef',
  '.rw2',
  '.srw',
  '.x3f',
]

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-upload-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function writeConfig(
  directory: string,
  username = 'annatarhe',
  metadataConcurrency?: number,
): Promise<string> {
  const path = join(directory, 'config.yml')
  await Bun.write(
    path,
    [
      ...(metadataConcurrency === undefined
        ? []
        : ['metadata:', `  concurrency: ${metadataConcurrency}`]),
      'sftp:',
      '  endpoint: sftp://ftp.rawback.app:2222',
      `  username: ${username}`,
      '  password: "upload-secret"',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
  if (process.platform !== 'win32') await chmod(path, 0o600)
  return path
}

function operationName(query: unknown): string {
  const document = query as {
    definitions: Array<{ name?: { value?: string } }>
  }
  return document.definitions[0]?.name?.value ?? ''
}

const API_HOST = 'https://api.rawback.app'
const SCOPE = uploadLedgerScope({ apiHost: API_HOST, accountId: 1 })

/**
 * A server holding the photos named in `remote`. Pass a `Set` to share it with
 * a {@link RecordingTransport}, which adds what it uploads — the gateway
 * recording a photo before it answers the close.
 */
function fakeClient(
  remote: string[] | Set<string> = [],
  options: {
    credentials?: boolean
    enabled?: boolean
    duplicateQueryFails?: boolean
    identityQueries?: string[][]
  } = {},
): RawbackClient {
  const remoteSet = remote instanceof Set ? remote : new Set(remote)
  return {
    config: {},
    credentials:
      options.credentials === false
        ? null
        : { token: 'access-token', refreshToken: 'refresh-token' },
    graphql: {
      async query(request: {
        query: unknown
        variables?: {
          identities?: Array<{ clientKey: string; originalFilename: string; capturedAt: string }>
        }
      }) {
        if (operationName(request.query) === 'UploadPreflight') {
          return {
            data: {
              me: {
                id: 1,
                slug: 'annatarhe',
                storageQuotaBytes: 1_000_000_000,
                storageUsedBytes: 0,
              },
              sftpCredentials: [{ id: 1, enabled: options.enabled !== false }],
            },
          }
        }
        if (options.duplicateQueryFails) return { error: new Error('query unavailable') }
        const identities = request.variables?.identities ?? []
        options.identityQueries?.push(identities.map(({ originalFilename }) => originalFilename))
        return {
          data: {
            existingUploadIdentities: identities
              .filter(({ originalFilename }) => remoteSet.has(originalFilename))
              .map(({ clientKey }, index) => ({ clientKey, imageId: index + 1 })),
          },
        }
      },
    },
    http: { apiHost: API_HOST },
  } as unknown as RawbackClient
}

const capturedAt = '2026-06-04T09:57:01.123457Z'

const identityExtractor: UploadIdentityExtractor = async (candidates) => ({
  identities: candidates.map((candidate) => ({ ...candidate, capturedAt })),
  uncheckedClientKeys: [],
  failedClientKeys: [],
})

class RecordingTransport implements UploadTransport {
  active = 0
  closed = 0
  connected = 0
  maxActive = 0
  uploads: string[] = []

  constructor(
    private readonly fail = new Set<string>(),
    private readonly library?: Set<string>,
  ) {}

  async connect(): Promise<void> {
    this.connected += 1
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
  ): Promise<void> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    this.uploads.push(basename(remotePath))
    try {
      const information = await Bun.file(localPath).stat()
      onProgress(information.size)
      await Bun.sleep(15)
      if (this.fail.has(basename(remotePath))) throw new Error('rejected by test server')
      this.library?.add(basename(remotePath))
    } finally {
      this.active -= 1
    }
  }

  async close(): Promise<void> {
    this.closed += 1
  }
}

function factoryFor(
  transport: RecordingTransport,
  captured: SftpClientOptions[] = [],
): UploadTransportFactory {
  return (options) => {
    captured.push(options)
    return transport
  }
}

describe('upload path scanning', () => {
  test('accepts every supported image and RAW extension without regard to case', async () => {
    const directory = await temporaryDirectory()
    const filenames = EXPECTED_UPLOAD_EXTENSIONS.map(
      (extension, index) =>
        `photo-${index}${index % 2 === 0 ? extension : extension.toUpperCase()}`,
    )
    await Promise.all(filenames.map((filename) => Bun.write(join(directory, filename), filename)))

    const files = await scanUploadPath(directory)

    expect([...SUPPORTED_UPLOAD_EXTENSIONS]).toEqual(EXPECTED_UPLOAD_EXTENSIONS)
    expect(files.map((file) => file.basename).sort()).toEqual(filenames.sort())
  })

  test('recurses through directories, filters formats, and skips symlinks', async () => {
    const directory = await temporaryDirectory()
    await Bun.write(join(directory, 'first.JPG'), 'one')
    await Bun.write(join(directory, 'notes.txt'), 'ignored')
    await Bun.write(join(directory, 'nested', 'second.cr3'), 'two')
    await symlink(join(directory, 'first.JPG'), join(directory, 'linked.jpg'))
    const scanned: number[] = []

    const files = await scanUploadPath(directory, (completed) => {
      scanned.push(completed)
      if (completed === 1) throw new Error('observer failed')
    })

    expect(files.map((file) => file.basename).sort()).toEqual(['first.JPG', 'second.cr3'])
    expect(scanned).toEqual([1, 2, 3])
  })

  test('rejects paths that contain no supported files', async () => {
    const directory = await temporaryDirectory()
    const unsupportedFile = join(directory, 'notes.txt')

    await expect(scanUploadPath(directory)).rejects.toThrow('No supported image or RAW files found')

    await Bun.write(unsupportedFile, 'ignored')

    await expect(scanUploadPath(directory)).rejects.toThrow('Supported extensions: .jpg')
    await expect(scanUploadPath(unsupportedFile)).rejects.toThrow(
      'No supported image or RAW files found',
    )
  })

  test('allows basename collisions for identity-aware deduplication', async () => {
    const directory = await temporaryDirectory()
    await Bun.write(join(directory, 'a', 'same.jpg'), 'one')
    await Bun.write(join(directory, 'b', 'same.jpg'), 'two')

    await expect(scanUploadPath(directory)).resolves.toHaveLength(2)
  })
})

describe('upload command', () => {
  test('sizes the SFTP channel pool to pending work and resumes completed files', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    const statePath = join(directory, 'progress.sqlite')
    for (const filename of ['one.jpg', 'two.png', 'three.nef']) {
      await Bun.write(join(directory, filename), filename)
    }
    const transport = new RecordingTransport()
    const captured: SftpClientOptions[] = []
    const lines: string[] = []
    const dependencies = {
      client: fakeClient(),
      configPath,
      statePath,
      stdout: (message: string) => lines.push(message),
      transportFactory: factoryFor(transport, captured),
    }

    await runUpload({ concurrency: 8, dryRun: false, path: directory }, dependencies)

    expect(transport.connected).toBe(1)
    expect(transport.maxActive).toBeGreaterThan(1)
    expect(transport.uploads.sort()).toEqual(['one.jpg', 'three.nef', 'two.png'])
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      channelCount: 3,
      endpoint: 'sftp://ftp.rawback.app:2222',
      identity: { source: 'cli', version: expect.any(String) },
      password: 'upload-secret',
      username: 'annatarhe',
    })
    expect(lines.at(-1)).toContain('Failed       0')

    await runUpload({ concurrency: 8, dryRun: false, path: directory }, dependencies)
    expect(transport.uploads).toHaveLength(3)
    expect(lines.at(-1)).toContain('Nothing to upload')
  })

  test('dry-run filters remote files, estimates time, and does not create upload state', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    const statePath = join(directory, 'missing-progress.sqlite')
    await Bun.write(join(directory, 'local.jpg'), new Uint8Array(2_000_000))
    await Bun.write(join(directory, 'remote.jpg'), 'remote')
    const lines: string[] = []

    await runUpload(
      { concurrency: 4, dryRun: true, path: directory },
      {
        client: fakeClient(['remote.jpg']),
        configPath,
        statePath,
        stdout: (message) => lines.push(message),
        identityExtractor,
        transportFactory: () => {
          throw new Error('dry-run must not create an SFTP client')
        },
      },
    )

    expect(lines[0]).toContain('Files             1')
    expect(lines[0]).toContain('Remote            1')
    expect(lines[0]).toContain('10 Mbps fallback')
    await expect(Bun.file(statePath).stat()).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(Bun.file(join(directory, 'upload-ledger.jsonl')).stat()).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('uses configured metadata concurrency during upload review', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory, 'annatarhe', 12)
    await Bun.write(join(directory, 'photo.jpg'), 'photo')
    let receivedConcurrency: number | undefined
    const configuredExtractor: UploadIdentityExtractor = async (candidates, options) => {
      receivedConcurrency = options?.concurrency
      return {
        identities: candidates.map((candidate) => ({ ...candidate, capturedAt })),
        uncheckedClientKeys: [],
        failedClientKeys: [],
      }
    }

    await runUpload(
      { concurrency: 4, dryRun: true, path: directory },
      {
        client: fakeClient(),
        configPath,
        identityExtractor: configuredExtractor,
        statePath: join(directory, 'missing-state.json'),
        stdout: () => undefined,
      },
    )

    expect(receivedConcurrency).toBe(12)
  })

  test('collapses local exact identities and fails open when the API check fails', async () => {
    const directory = await temporaryDirectory()
    const first = join(directory, 'first')
    const second = join(directory, 'second')
    await Bun.write(join(first, 'same.jpg'), 'first')
    await Bun.write(join(second, 'same.jpg'), 'second')
    const configPath = await writeConfig(directory)
    const transport = new RecordingTransport()
    const warnings: string[] = []

    await runUpload(
      { concurrency: 2, dryRun: false, path: directory },
      {
        client: fakeClient([], { duplicateQueryFails: true }),
        configPath,
        identityExtractor,
        statePath: join(directory, 'progress.sqlite'),
        stderr: (message) => warnings.push(message),
        transportFactory: factoryFor(transport),
      },
    )

    expect(transport.uploads).toEqual(['same.jpg'])
    expect(warnings.some((message) => message.includes('continuing with SFTP'))).toBe(true)
  })

  test('checks stored authentication before scanning the upload path', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)

    await expect(
      runUpload(
        { concurrency: 4, dryRun: true, path: join(directory, 'does-not-exist') },
        { client: fakeClient([], { credentials: false }), configPath },
      ),
    ).rejects.toThrow('Authentication credentials are missing')
  })

  test('checks the authenticated username and enabled SFTP credentials', async () => {
    const directory = await temporaryDirectory()
    const mismatchedConfig = await writeConfig(directory, 'someone-else')
    await expect(
      runUpload(
        { concurrency: 4, dryRun: true, path: join(directory, 'does-not-exist') },
        { client: fakeClient(), configPath: mismatchedConfig },
      ),
    ).rejects.toThrow('authenticated account username is annatarhe')

    const configPath = await writeConfig(directory)
    await expect(
      runUpload(
        { concurrency: 4, dryRun: true, path: join(directory, 'does-not-exist') },
        { client: fakeClient([], { enabled: false }), configPath },
      ),
    ).rejects.toThrow('no enabled SFTP credential')
  })

  test('continues after a per-file failure and reports a partial batch', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'good.jpg'), 'good')
    await Bun.write(join(directory, 'bad.jpg'), 'bad')
    const transport = new RecordingTransport(new Set(['bad.jpg']))
    const errors: string[] = []

    await expect(
      runUpload(
        { concurrency: 2, dryRun: false, path: directory },
        {
          client: fakeClient(),
          configPath,
          statePath: join(directory, 'progress.sqlite'),
          stderr: (message) => errors.push(message),
          transportFactory: factoryFor(transport),
        },
      ),
    ).rejects.toThrow('1 failed file')

    expect(transport.uploads.sort()).toEqual(['bad.jpg', 'good.jpg'])
    expect(errors.some((message) => message.includes('Failed bad.jpg'))).toBe(true)
  })
})

async function readLedger(path: string): Promise<UploadLedger> {
  const ledger = new UploadLedger({ path })
  await ledger.load()
  return ledger
}

function countingExtractor(seen: string[]): UploadIdentityExtractor {
  return async (candidates, options) => {
    seen.push(...candidates.map(({ originalFilename }) => originalFilename))
    return identityExtractor(candidates, options)
  }
}

describe('upload acknowledgements', () => {
  test('confirms uploads and skips them next time without reading metadata or asking', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'one.jpg'), 'one')
    await Bun.write(join(directory, 'two.jpg'), 'two')
    const library = new Set<string>()
    const transport = new RecordingTransport(new Set(), library)
    const lines: string[] = []
    const base = {
      configPath,
      statePath: join(directory, 'upload-state.json'),
      stdout: (message: string) => lines.push(message),
      transportFactory: factoryFor(transport),
    }

    await runUpload(
      { concurrency: 2, dryRun: false, path: directory },
      { ...base, client: fakeClient(library), identityExtractor },
    )

    expect(transport.uploads.sort()).toEqual(['one.jpg', 'two.jpg'])
    expect(lines.at(-1)).toContain('Confirmed    2')
    const ledger = await readLedger(join(directory, 'upload-ledger.jsonl'))
    expect(ledger.size).toBe(2)
    expect(ledger.findByIdentity(SCOPE, { name: 'one.jpg', capturedAt })).toMatchObject({
      ack: 'server',
      source: 'upload',
      imageId: expect.any(Number),
    })

    const extracted: string[] = []
    const identityQueries: string[][] = []
    await runUpload(
      { concurrency: 2, dryRun: false, path: directory },
      {
        ...base,
        client: fakeClient(library, { identityQueries }),
        identityExtractor: countingExtractor(extracted),
      },
    )

    expect(transport.uploads).toHaveLength(2)
    expect(extracted).toEqual([])
    expect(identityQueries).toEqual([])
    expect(lines.at(-1)).toContain('Nothing to upload')
  })

  test('uploads again a photo the server did not record', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'lost.jpg'), 'lost')
    const transport = new RecordingTransport()
    const warnings: string[] = []
    const dependencies = {
      client: fakeClient(),
      configPath,
      identityExtractor,
      statePath: join(directory, 'upload-state.json'),
      stderr: (message: string) => warnings.push(message),
      stdout: () => undefined,
      transportFactory: factoryFor(transport),
    }

    await runUpload({ concurrency: 1, dryRun: false, path: directory }, dependencies)
    expect(warnings.some((message) => message.includes('did not confirm 1 uploaded photo'))).toBe(
      true,
    )
    expect((await readLedger(join(directory, 'upload-ledger.jsonl'))).size).toBe(0)

    await runUpload({ concurrency: 1, dryRun: false, path: directory }, dependencies)
    expect(transport.uploads).toEqual(['lost.jpg', 'lost.jpg'])
  })

  test('asks the server again about a photo whose confirmation failed', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'photo.jpg'), 'photo')
    const library = new Set<string>()
    const transport = new RecordingTransport(new Set(), library)
    const warnings: string[] = []
    const base = {
      configPath,
      statePath: join(directory, 'upload-state.json'),
      stderr: (message: string) => warnings.push(message),
      stdout: () => undefined,
      transportFactory: factoryFor(transport),
    }

    await runUpload(
      { concurrency: 1, dryRun: false, path: directory },
      { ...base, client: fakeClient(library, { duplicateQueryFails: true }), identityExtractor },
    )
    expect(warnings.some((message) => message.includes('could not confirm'))).toBe(true)
    expect(
      (await readLedger(join(directory, 'upload-ledger.jsonl'))).findByIdentity(SCOPE, {
        name: 'photo.jpg',
        capturedAt,
      })?.ack,
    ).toBe('transfer')

    const extracted: string[] = []
    const identityQueries: string[][] = []
    await runUpload(
      { concurrency: 1, dryRun: false, path: directory },
      {
        ...base,
        client: fakeClient(library, { identityQueries }),
        identityExtractor: countingExtractor(extracted),
      },
    )

    // The capture time comes from the ledger; the server is asked, and has it.
    expect(extracted).toEqual([])
    expect(identityQueries).toEqual([['photo.jpg']])
    expect(transport.uploads).toEqual(['photo.jpg'])
    expect(
      (await readLedger(join(directory, 'upload-ledger.jsonl'))).findByIdentity(SCOPE, {
        name: 'photo.jpg',
        capturedAt,
      }),
    ).toMatchObject({ ack: 'server', source: 'remote' })
  })

  test('recognises a moved photo by identity and records its new path', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    const card = join(directory, 'card')
    const archive = join(directory, 'archive')
    await Bun.write(join(card, 'photo.jpg'), 'photo')
    await Bun.write(join(archive, 'photo.jpg'), 'photo')
    const library = new Set<string>()
    const transport = new RecordingTransport(new Set(), library)
    const identityQueries: string[][] = []
    const dependencies = {
      client: fakeClient(library, { identityQueries }),
      configPath,
      identityExtractor,
      statePath: join(directory, 'upload-state.json'),
      stdout: () => undefined,
      transportFactory: factoryFor(transport),
    }

    await runUpload({ concurrency: 1, dryRun: false, path: card }, dependencies)
    identityQueries.splice(0)
    await runUpload({ concurrency: 1, dryRun: false, path: archive }, dependencies)

    expect(transport.uploads).toEqual(['photo.jpg'])
    expect(identityQueries).toEqual([])
    const ledger = await readLedger(join(directory, 'upload-ledger.jsonl'))
    expect(
      ledger.findByFile(SCOPE, {
        canonicalPath: await realpath(join(archive, 'photo.jpg')),
        size: 5,
        mtimeMs: (await Bun.file(join(archive, 'photo.jpg')).stat()).mtimeMs,
      }),
    ).toMatchObject({ ack: 'server' })
  })

  test('--recheck ignores the ledger and asks the server about every file', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'photo.jpg'), 'photo')
    const library = new Set<string>()
    const transport = new RecordingTransport(new Set(), library)
    const extracted: string[] = []
    const identityQueries: string[][] = []
    const dependencies = {
      client: fakeClient(library, { identityQueries }),
      configPath,
      identityExtractor: countingExtractor(extracted),
      statePath: join(directory, 'upload-state.json'),
      stdout: () => undefined,
      transportFactory: factoryFor(transport),
    }

    await runUpload({ concurrency: 1, dryRun: false, path: directory }, dependencies)
    extracted.splice(0)
    identityQueries.splice(0)
    await runUpload({ concurrency: 1, dryRun: false, path: directory, recheck: true }, dependencies)

    expect(extracted).toEqual(['photo.jpg'])
    expect(identityQueries).toEqual([['photo.jpg']])
    expect(transport.uploads).toEqual(['photo.jpg'])
  })

  test('remembers a photo without a capture time once its upload succeeds', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'export.png'), 'png')
    const transport = new RecordingTransport()
    const noCaptureTime: UploadIdentityExtractor = async (candidates) => ({
      identities: [],
      uncheckedClientKeys: candidates.map(({ clientKey }) => clientKey),
      failedClientKeys: [],
    })
    const dependencies = {
      client: fakeClient(),
      configPath,
      identityExtractor: noCaptureTime,
      // A fresh state file each run: the ledger alone has to remember it.
      stdout: () => undefined,
      transportFactory: factoryFor(transport),
      ledgerPath: join(directory, 'ledger.jsonl'),
    }

    await runUpload(
      { concurrency: 1, dryRun: false, path: directory },
      { ...dependencies, statePath: join(directory, 'first.json') },
    )
    await runUpload(
      { concurrency: 1, dryRun: false, path: directory },
      { ...dependencies, statePath: join(directory, 'second.json') },
    )

    expect(transport.uploads).toEqual(['export.png'])
    expect((await readLedger(join(directory, 'ledger.jsonl'))).size).toBe(1)
  })

  test('keeps uploading when the ledger cannot be read', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    await Bun.write(join(directory, 'photo.jpg'), 'photo')
    const transport = new RecordingTransport()
    const warnings: string[] = []

    await runUpload(
      { concurrency: 1, dryRun: false, path: join(directory, 'photo.jpg') },
      {
        client: fakeClient(),
        configPath,
        identityExtractor,
        ledgerPath: directory,
        statePath: join(directory, 'upload-state.json'),
        stderr: (message: string) => warnings.push(message),
        stdout: () => undefined,
        transportFactory: factoryFor(transport),
      },
    )

    expect(transport.uploads).toEqual(['photo.jpg'])
    expect(warnings.some((message) => message.includes('could not be read'))).toBe(true)
  })
})
