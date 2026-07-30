import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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

async function writeConfig(directory: string, username = 'annatarhe'): Promise<string> {
  const path = join(directory, 'config.yml')
  await writeFile(
    path,
    [
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

function fakeClient(
  remote: string[] = [],
  options: { credentials?: boolean; enabled?: boolean } = {},
): RawbackClient {
  const remoteSet = new Set(remote)
  return {
    config: {},
    credentials:
      options.credentials === false
        ? null
        : { token: 'access-token', refreshToken: 'refresh-token' },
    graphql: {
      async query(request: { query: unknown; variables?: { filenames?: string[] } }) {
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
        const filenames = request.variables?.filenames ?? []
        return {
          data: {
            imagesByFilenames: filenames
              .filter((filename) => remoteSet.has(filename))
              .map((originalFilename, index) => ({ id: index + 1, originalFilename })),
          },
        }
      },
    },
    http: {},
  } as unknown as RawbackClient
}

class RecordingTransport implements UploadTransport {
  active = 0
  closed = 0
  connected = 0
  maxActive = 0
  uploads: string[] = []

  constructor(private readonly fail = new Set<string>()) {}

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
      const information = await stat(localPath)
      onProgress(information.size)
      await Bun.sleep(15)
      if (this.fail.has(basename(remotePath))) throw new Error('rejected by test server')
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
    await Promise.all(filenames.map((filename) => writeFile(join(directory, filename), filename)))

    const files = await scanUploadPath(directory)

    expect([...SUPPORTED_UPLOAD_EXTENSIONS]).toEqual(EXPECTED_UPLOAD_EXTENSIONS)
    expect(files.map((file) => file.basename).sort()).toEqual(filenames.sort())
  })

  test('recurses through directories, filters formats, and skips symlinks', async () => {
    const directory = await temporaryDirectory()
    await mkdir(join(directory, 'nested'))
    await writeFile(join(directory, 'first.JPG'), 'one')
    await writeFile(join(directory, 'notes.txt'), 'ignored')
    await writeFile(join(directory, 'nested', 'second.cr3'), 'two')
    await symlink(join(directory, 'first.JPG'), join(directory, 'linked.jpg'))

    const files = await scanUploadPath(directory)

    expect(files.map((file) => file.basename).sort()).toEqual(['first.JPG', 'second.cr3'])
  })

  test('rejects paths that contain no supported files', async () => {
    const directory = await temporaryDirectory()
    const unsupportedFile = join(directory, 'notes.txt')

    await expect(scanUploadPath(directory)).rejects.toThrow('No supported image or RAW files found')

    await writeFile(unsupportedFile, 'ignored')

    await expect(scanUploadPath(directory)).rejects.toThrow('Supported extensions: .jpg')
    await expect(scanUploadPath(unsupportedFile)).rejects.toThrow(
      'No supported image or RAW files found',
    )
  })

  test('rejects basename collisions before upload', async () => {
    const directory = await temporaryDirectory()
    await mkdir(join(directory, 'a'))
    await mkdir(join(directory, 'b'))
    await writeFile(join(directory, 'a', 'same.jpg'), 'one')
    await writeFile(join(directory, 'b', 'same.jpg'), 'two')

    await expect(scanUploadPath(directory)).rejects.toThrow('unique basenames')
  })
})

describe('upload command', () => {
  test('uploads in parallel over one connection and resumes completed files', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    const statePath = join(directory, 'progress.sqlite')
    for (const filename of ['one.jpg', 'two.png', 'three.nef']) {
      await writeFile(join(directory, filename), filename)
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

    await runUpload({ concurrency: 3, dryRun: false, path: directory }, dependencies)

    expect(transport.connected).toBe(1)
    expect(transport.maxActive).toBeGreaterThan(1)
    expect(transport.uploads.sort()).toEqual(['one.jpg', 'three.nef', 'two.png'])
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      endpoint: 'sftp://ftp.rawback.app:2222',
      password: 'upload-secret',
      username: 'annatarhe',
    })
    expect(lines.at(-1)).toContain('Failed       0')

    await runUpload({ concurrency: 3, dryRun: false, path: directory }, dependencies)
    expect(transport.uploads).toHaveLength(3)
    expect(lines.at(-1)).toContain('Nothing to upload')
  })

  test('dry-run filters remote files, estimates time, and does not create upload state', async () => {
    const directory = await temporaryDirectory()
    const configPath = await writeConfig(directory)
    const statePath = join(directory, 'missing-progress.sqlite')
    await writeFile(join(directory, 'local.jpg'), new Uint8Array(2_000_000))
    await writeFile(join(directory, 'remote.jpg'), 'remote')
    const lines: string[] = []

    await runUpload(
      { concurrency: 4, dryRun: true, path: directory },
      {
        client: fakeClient(['remote.jpg']),
        configPath,
        statePath,
        stdout: (message) => lines.push(message),
        transportFactory: () => {
          throw new Error('dry-run must not create an SFTP client')
        },
      },
    )

    expect(lines[0]).toContain('Files           1')
    expect(lines[0]).toContain('Remote          1')
    expect(lines[0]).toContain('10 Mbps fallback')
    await expect(stat(statePath)).rejects.toMatchObject({ code: 'ENOENT' })
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
    await writeFile(join(directory, 'good.jpg'), 'good')
    await writeFile(join(directory, 'bad.jpg'), 'bad')
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
