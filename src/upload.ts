import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import type { RawbackClient } from './client.ts'
import { createRawbackClient } from './client.ts'
import { commandOutput, type ReadCommandDependencies } from './command.ts'
import { DEFAULT_CONFIG_PATH, readConfig, type SftpConfig } from './config.ts'
import { DEFAULT_CREDENTIALS_PATH } from './credentials.ts'
import { UploadProgressController } from './features/upload/progress.tsx'
import { uploadDryRunDocument, uploadSummaryDocument } from './features/upload/view.ts'
import {
  ExistingUploadImagesDocument,
  UploadPreflightDocument,
  type UploadPreflightQuery,
} from './gql/graphql.ts'
import {
  createSftpClient,
  isConnectionFailure,
  type SftpClientOptions,
  type UploadTransport,
  type UploadTransportFactory,
} from './sftp-client.ts'
import { formatBytes } from './ui/format.ts'
import { DEFAULT_UPLOAD_STATE_PATH, UploadState, type UploadStateFile } from './upload-state.ts'

export const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
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
])

export interface UploadCommandOptions {
  concurrency: number
  dryRun: boolean
  path: string
}

export interface UploadCommandDependencies extends ReadCommandDependencies {
  client?: RawbackClient
  sleep?: (milliseconds: number) => Promise<void>
  statePath?: string
  transportFactory?: UploadTransportFactory
}

export interface UploadFile {
  basename: string
  canonicalPath: string
  mtimeMs: number
  path: string
  size: number
}

interface UploadPreflight {
  account: string
  client: RawbackClient
  endpoint: string
  files: UploadFile[]
  password: string
  quotaBytes: number
  usedBytes: number
  username: string
}

interface UploadFailure {
  error: Error
  file: UploadFile
}

const REMOTE_QUERY_BATCH_SIZE = 200
const FALLBACK_BYTES_PER_SECOND = 10_000_000 / 8

function canonicalEndpoint(value: string): string {
  const url = new URL(value)
  return `sftp://${url.hostname}:${url.port || '22'}`
}

type RequiredSftpConfig = {
  [Key in 'endpoint' | 'username' | 'password']: NonNullable<SftpConfig[Key]>
} & {
  hostFingerprint?: NonNullable<SftpConfig['hostFingerprint']>
}

function requiredSftpConfig(
  config: SftpConfig | undefined,
  configPath: string,
): RequiredSftpConfig {
  const missing = (['endpoint', 'username', 'password'] as const).filter((key) => !config?.[key])
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.map((key) => `sftp.${key}`).join(', ')} in ${configPath}`)
  }
  return {
    endpoint: config!.endpoint!,
    username: config!.username!,
    password: config!.password!,
    ...(config!.hostFingerprint ? { hostFingerprint: config!.hostFingerprint } : {}),
  }
}

async function checkConfigPermissions(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const information = await stat(path)
  if ((information.mode & 0o077) !== 0) {
    throw new Error(
      `Config ${path} contains an SFTP password and must not be accessible by group or others; run chmod 600 ${path}`,
    )
  }
}

export async function scanUploadPath(path: string): Promise<UploadFile[]> {
  const root = resolve(path)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink()) throw new Error(`Upload path must not be a symbolic link: ${path}`)

  const files: UploadFile[] = []
  const addFile = async (filePath: string) => {
    const name = basename(filePath)
    const extensionIndex = name.lastIndexOf('.')
    const extension = extensionIndex < 0 ? '' : name.slice(extensionIndex).toLowerCase()
    if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) return
    const information = await stat(filePath)
    files.push({
      basename: name,
      canonicalPath: await realpath(filePath),
      mtimeMs: information.mtimeMs,
      path: filePath,
      size: information.size,
    })
  }

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(entryPath)
      else if (entry.isFile()) await addFile(entryPath)
    }
  }

  if (rootInfo.isDirectory()) await walk(root)
  else if (rootInfo.isFile()) await addFile(root)
  else throw new Error(`Upload path is not a regular file or directory: ${path}`)

  if (files.length === 0) {
    throw new Error(
      `No supported image or RAW files found at ${path}. Supported extensions: ${[...SUPPORTED_UPLOAD_EXTENSIONS].join(', ')}`,
    )
  }

  files.sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath))
  const names = new Map<string, string>()
  for (const file of files) {
    const previous = names.get(file.basename)
    if (previous) {
      throw new Error(
        `Files must have unique basenames because the SFTP server stores a flat upload list: ${previous} and ${file.path}`,
      )
    }
    names.set(file.basename, file.path)
  }
  return files
}

async function createClient(dependencies: UploadCommandDependencies): Promise<RawbackClient> {
  if (dependencies.client) return dependencies.client
  return createRawbackClient({
    configPath: dependencies.configPath ?? DEFAULT_CONFIG_PATH,
    credentialsPath: dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  })
}

function requireAccount(data: UploadPreflightQuery): NonNullable<UploadPreflightQuery['me']> {
  if (!data.me) throw new Error('Authentication check did not return an account; run rawback auth')
  return data.me
}

async function preflight(
  options: UploadCommandOptions,
  dependencies: UploadCommandDependencies,
): Promise<UploadPreflight> {
  const configPath = dependencies.configPath ?? DEFAULT_CONFIG_PATH
  const config = await readConfig(configPath)
  const sftp = requiredSftpConfig(config.sftp, configPath)
  await checkConfigPermissions(configPath)
  const client = await createClient(dependencies)
  if (!client.credentials)
    throw new Error('Authentication credentials are missing; run rawback auth')

  const result = await client.graphql.query({ query: UploadPreflightDocument })
  if (result.error) throw result.error
  if (!result.data) throw new Error('Upload preflight did not return account data')
  const account = requireAccount(result.data)
  if (sftp.username !== account.slug) {
    throw new Error(
      `Config sftp.username is ${sftp.username}, but the authenticated account username is ${account.slug}`,
    )
  }
  if (!result.data.sftpCredentials.some((credential) => credential.enabled)) {
    throw new Error(
      'The authenticated account has no enabled SFTP credential; run rawback cred add',
    )
  }

  return {
    account: account.slug,
    client,
    endpoint: canonicalEndpoint(sftp.endpoint),
    files: await scanUploadPath(options.path),
    password: sftp.password,
    quotaBytes: Number(account.storageQuotaBytes),
    usedBytes: Number(account.storageUsedBytes),
    username: sftp.username,
  }
}

async function remoteFilenames(client: RawbackClient, files: UploadFile[]): Promise<Set<string>> {
  const result = new Set<string>()
  for (let index = 0; index < files.length; index += REMOTE_QUERY_BATCH_SIZE) {
    const filenames = files
      .slice(index, index + REMOTE_QUERY_BATCH_SIZE)
      .map((file) => file.basename)
    const response = await client.graphql.query({
      query: ExistingUploadImagesDocument,
      variables: { filenames },
    })
    if (response.error) throw response.error
    if (!response.data) throw new Error('Remote duplicate check did not return image data')
    const requested = new Set(filenames)
    for (const image of response.data.imagesByFilenames) {
      if (requested.has(image.originalFilename)) result.add(image.originalFilename)
    }
  }
  return result
}

function stateFile(preflightResult: UploadPreflight, file: UploadFile): UploadStateFile {
  return {
    account: preflightResult.account,
    endpoint: preflightResult.endpoint,
    path: file.canonicalPath,
    size: file.size,
    mtimeMs: file.mtimeMs,
  }
}

async function retryConnect(
  transport: UploadTransport,
  dependencies: UploadCommandDependencies,
): Promise<void> {
  const sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await transport.connect()
      return
    } catch (error) {
      lastError = error
      if (!isConnectionFailure(error) || attempt === 2) throw error
      await sleep(attempt === 0 ? 250 : 1_000)
    }
  }
  throw lastError
}

async function uploadRound(
  files: UploadFile[],
  concurrency: number,
  transport: UploadTransport,
  state: UploadState,
  preflightResult: UploadPreflight,
  dependencies: UploadCommandDependencies,
  progress: UploadProgressController,
  shouldStop: () => boolean,
): Promise<{ failures: UploadFailure[]; uploadedBytes: number }> {
  const failures: UploadFailure[] = []
  let uploadedBytes = 0
  let next = 0
  const worker = async () => {
    while (!shouldStop()) {
      const file = files[next++]
      if (!file) return
      const persisted = stateFile(preflightResult, file)
      state.setFileStatus(persisted, 'in_progress')
      progress.start(file)
      try {
        await transport.upload(file.path, `/${file.basename}`, (bytes) => {
          progress.update(file, bytes)
        })
        state.setFileStatus(persisted, 'completed')
        uploadedBytes += file.size
        progress.complete(file)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        progress.fail(file)
        state.setFileStatus(persisted, 'failed', failure.message)
        failures.push({ error: failure, file })
        commandOutput(dependencies).warning(`Failed ${file.basename}: ${failure.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return { failures, uploadedBytes }
}

function transportOptions(
  preflightResult: UploadPreflight,
  state: UploadState,
  configured: SftpConfig,
): SftpClientOptions {
  return {
    endpoint: preflightResult.endpoint,
    username: preflightResult.username,
    password: preflightResult.password,
    knownHosts: state,
    ...(configured.hostFingerprint ? { hostFingerprint: configured.hostFingerprint } : {}),
  }
}

export async function runUpload(
  options: UploadCommandOptions,
  dependencies: UploadCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const preflightResult = await ui.withActivity('Preparing upload…', () =>
    preflight(options, dependencies),
  )
  const config = await readConfig(dependencies.configPath ?? DEFAULT_CONFIG_PATH)
  const statePath = dependencies.statePath ?? DEFAULT_UPLOAD_STATE_PATH
  const state = options.dryRun
    ? await UploadState.openReadonly(statePath)
    : await UploadState.open(statePath)

  try {
    const locallyCompleted = new Set(
      state
        ? preflightResult.files
            .filter((file) => state.isCompleted(stateFile(preflightResult, file)))
            .map((file) => file.canonicalPath)
        : [],
    )
    const localPending = preflightResult.files.filter(
      (file) => !locallyCompleted.has(file.canonicalPath),
    )
    const remote = await remoteFilenames(preflightResult.client, localPending)
    const pending = localPending.filter((file) => !remote.has(file.basename))
    const pendingBytes = pending.reduce((sum, file) => sum + file.size, 0)
    const remainingQuota = Math.max(0, preflightResult.quotaBytes - preflightResult.usedBytes)
    if (pendingBytes > remainingQuota) {
      throw new Error(
        `Upload needs ${formatBytes(pendingBytes)}, but the account only has ${formatBytes(remainingQuota)} remaining`,
      )
    }

    if (options.dryRun) {
      const estimate = state?.throughput(
        preflightResult.account,
        preflightResult.endpoint,
        options.concurrency,
      )
      const rate = estimate?.bytesPerSecond ?? FALLBACK_BYTES_PER_SECOND
      const source = estimate?.source ?? '10 Mbps fallback'
      ui.document(
        uploadDryRunDocument({
          completed: locallyCompleted.size,
          estimatedSeconds: pendingBytes / rate,
          existingRemote: remote.size,
          files: pending.length,
          rate,
          rateSource: source,
          totalBytes: pendingBytes,
        }),
      )
      return
    }

    if (!state) throw new Error('Unable to open upload progress database')
    if (pending.length === 0) {
      ui.info('Nothing to upload; all supported files are already complete or remote.')
      return
    }

    state.acquireLock(preflightResult.account, preflightResult.endpoint)
    let transport: UploadTransport | null = null
    let interrupted = false
    let signalCount = 0
    const onInterrupt = () => {
      signalCount += 1
      interrupted = true
      if (signalCount === 1) {
        ui.warning(
          'Interrupt received; finishing active uploads. Press Ctrl-C again to disconnect.',
        )
      } else void transport?.close()
    }
    process.on('SIGINT', onInterrupt)

    try {
      state.resetInterrupted(preflightResult.account, preflightResult.endpoint)
      for (const file of pending) state.prepareFile(stateFile(preflightResult, file))
      const runId = state.beginRun(
        preflightResult.account,
        preflightResult.endpoint,
        options.concurrency,
      )
      const factory = dependencies.transportFactory ?? createSftpClient
      transport = factory(transportOptions(preflightResult, state, config.sftp ?? {}))
      await retryConnect(transport, dependencies)

      let remaining = pending
      let totalUploaded = 0
      const progress = new UploadProgressController(pendingBytes, pending.length, ui)
      const permanentFailures: UploadFailure[] = []
      for (let round = 0; round < 3 && remaining.length > 0 && !interrupted; round += 1) {
        const result = await uploadRound(
          remaining,
          options.concurrency,
          transport,
          state,
          preflightResult,
          dependencies,
          progress,
          () => interrupted,
        )
        totalUploaded += result.uploadedBytes
        const reconnectable = result.failures.filter(({ error }) => isConnectionFailure(error))
        permanentFailures.push(
          ...result.failures.filter(({ error }) => !isConnectionFailure(error)),
        )
        remaining = reconnectable.map(({ file }) => file)
        if (remaining.length > 0 && round < 2 && !interrupted) {
          ui.warning(`Connection dropped; reconnecting to retry ${remaining.length} file(s).`)
          await transport.close()
          await retryConnect(transport, dependencies)
        }
      }
      if (!interrupted) {
        permanentFailures.push(
          ...remaining.map((file) => ({
            file,
            error: new Error('SFTP connection retry limit reached'),
          })),
        )
      }
      await progress.finish()
      for (const failure of permanentFailures) {
        state.setFileStatus(
          stateFile(preflightResult, failure.file),
          'failed',
          failure.error.message,
        )
      }

      const status = interrupted
        ? 'cancelled'
        : permanentFailures.length > 0
          ? 'partial'
          : 'completed'
      state.finishRun(runId, totalUploaded, status)
      ui.document(
        uploadSummaryDocument({
          cancelled: interrupted,
          failedFiles: permanentFailures.length,
          totalBytes: totalUploaded,
        }),
      )
      if (interrupted) throw new Error('Upload cancelled')
      if (permanentFailures.length > 0) {
        throw new Error(`Upload completed with ${permanentFailures.length} failed file(s)`)
      }
    } finally {
      process.removeListener('SIGINT', onInterrupt)
      await transport?.close()
      state.releaseLock(preflightResult.account, preflightResult.endpoint)
    }
  } finally {
    state?.close()
  }
}
